// MQTT Plugin — UNS Log (uns-log)
// Scaffolds a Go HTTP function that logs UNS cache changes to PostgreSQL

import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import logger from '../../utils/logger'
import * as docker from '../../utils/docker'
import { exec } from '../../utils/shell'

const DEFAULT_DIR = 'uns-log'
const CONTAINER_NAME = 'uns-log'
const FNKIT_NETWORK = 'fnkit-network'

// ── Go source templates ──────────────────────────────────────────────

const FUNCTION_GO = `package function

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/GoogleCloudPlatform/functions-framework-go/functions"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// ── Configuration ────────────────────────────────────────────────────
// Config is loaded from Valkey cache using the function name as the key.
// e.g. FUNCTION_TARGET=uns-log-line1 → reads fnkit:config:uns-log-line1
//
// Config format (stored as JSON string in Valkey):
//
//	{
//	  "table": "uns_log",
//	  "topics": [
//	    "v1.0/acme/factory1/mixing/line1/temperature",
//	    "v1.0/acme/factory1/mixing/line1/pressure",
//	    "v1.0/acme/factory1/mixing/line1/speed"
//	  ]
//	}

// ── UNS Topic Parsing ───────────────────────────────────────────────
// Topics follow the UNS Framework (unsframework.com) ISA-95 hierarchy:
//   v1.0/{enterprise}/{site}/{area}/{line}/{tag...}

type unsLogConfig struct {
	Table  string   ` + "`" + `json:"table"` + "`" + `
	Topics []string ` + "`" + `json:"topics"` + "`" + `
}

type unsFields struct {
	Enterprise string
	Site       string
	Area       string
	Line       string
	Tag        string
}

var (
	ctx       = context.Background()
	cache     *redis.Client
	db        *pgxpool.Pool
	keyPrefix string

	// Config cache
	configMu      sync.RWMutex
	cachedConfig  *unsLogConfig
	configFetched time.Time
	configTTL     = 30 * time.Second

	// Last snapshot for change detection
	lastSnapshot   map[string]string
	lastSnapshotMu sync.Mutex
)

func init() {
	// ── Cache connection ─────────────────────────────────────────────
	cacheURL := envOrDefault("CACHE_URL", "redis://fnkit-cache:6379")
	keyPrefix = envOrDefault("CACHE_KEY_PREFIX", "uns")

	opts, err := redis.ParseURL(cacheURL)
	if err != nil {
		log.Fatalf("[uns-log] Failed to parse CACHE_URL: %v", err)
	}
	cache = redis.NewClient(opts)

	if err := cache.Ping(ctx).Err(); err != nil {
		log.Printf("[uns-log] Warning: cache not reachable at %s: %v", cacheURL, err)
	} else {
		log.Printf("[uns-log] Connected to cache at %s", cacheURL)
	}

	// ── Postgres connection ──────────────────────────────────────────
	dbURL := envOrDefault("DATABASE_URL", "postgres://fnkit:fnkit@fnkit-postgres:5432/fnkit?sslmode=disable")
	db, err = pgxpool.New(ctx, dbURL)
	if err != nil {
		log.Fatalf("[uns-log] Failed to create Postgres pool: %v", err)
	}

	if err := db.Ping(ctx); err != nil {
		log.Printf("[uns-log] Warning: Postgres not reachable: %v", err)
	} else {
		log.Printf("[uns-log] Connected to Postgres")
	}

	// ── Initialize last snapshot ─────────────────────────────────────
	lastSnapshot = make(map[string]string)

	// ── Register HTTP function ───────────────────────────────────────
	functionName := envOrDefault("FUNCTION_TARGET", "uns-log")
	functions.HTTP(functionName, unsLogHandler)
	log.Printf("[uns-log] Registered HTTP function: %s", functionName)
}

func unsLogHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// 1. Load config from Valkey
	config, err := loadConfig()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": fmt.Sprintf("Failed to load config: %v", err),
		})
		return
	}

	if len(config.Topics) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "No topics configured",
		})
		return
	}

	// 2. Ensure table exists
	if err := ensureTable(config.Table); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": fmt.Sprintf("Failed to ensure table: %v", err),
		})
		return
	}

	// 3. Read all topics from cache
	snapshot, err := readTopicsFromCache(config.Topics)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": fmt.Sprintf("Failed to read cache: %v", err),
		})
		return
	}

	// 4. Detect changes
	changed := detectChanges(config.Topics, snapshot)

	if len(changed) == 0 {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"logged":  false,
			"message": "No changes detected",
			"topics":  len(config.Topics),
		})
		return
	}

	// 5. Build values JSONB
	values := buildValuesJSON(config.Topics, snapshot)

	// 6. Parse UNS fields from first topic
	uns := parseTopic(config.Topics[0])

	// 7. INSERT row
	changedTag := changed[0]
	if err := insertRow(config.Table, uns, changedTag, values, changed); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": fmt.Sprintf("Failed to insert row: %v", err),
		})
		return
	}

	// 8. Update last snapshot
	updateLastSnapshot(config.Topics, snapshot)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"logged":  true,
		"table":   config.Table,
		"changed": changed,
		"values":  values,
		"uns": map[string]string{
			"enterprise": uns.Enterprise,
			"site":       uns.Site,
			"area":       uns.Area,
			"line":       uns.Line,
		},
	})
}

// ── Config Loading (from Valkey) ─────────────────────────────────────

func loadConfig() (*unsLogConfig, error) {
	configMu.RLock()
	if cachedConfig != nil && time.Since(configFetched) < configTTL {
		cfg := cachedConfig
		configMu.RUnlock()
		return cfg, nil
	}
	configMu.RUnlock()

	configMu.Lock()
	defer configMu.Unlock()

	if cachedConfig != nil && time.Since(configFetched) < configTTL {
		return cachedConfig, nil
	}

	configKey := "fnkit:config:" + envOrDefault("FUNCTION_TARGET", "uns-log")

	raw, err := cache.Get(ctx, configKey).Result()
	if err == redis.Nil {
		return nil, fmt.Errorf("config not found at key %s — set it with: docker exec fnkit-cache valkey-cli SET %s '<json>'", configKey, configKey)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to read config from cache key %s: %w", configKey, err)
	}

	var config unsLogConfig
	if err := json.Unmarshal([]byte(raw), &config); err != nil {
		return nil, fmt.Errorf("failed to parse config JSON: %w", err)
	}

	if config.Table == "" {
		config.Table = "uns_log"
	}

	cachedConfig = &config
	configFetched = time.Now()
	log.Printf("[uns-log] Loaded config from %s (%d topics, table: %s)",
		configKey, len(config.Topics), config.Table)

	return &config, nil
}

// ── Cache Reading ────────────────────────────────────────────────────

type topicSnapshot struct {
	Current  string
	Previous string
}

func readTopicsFromCache(topics []string) (map[string]*topicSnapshot, error) {
	pipe := cache.Pipeline()

	for _, topic := range topics {
		pipe.Get(ctx, fmt.Sprintf("%s:data:%s", keyPrefix, topic))
		pipe.Get(ctx, fmt.Sprintf("%s:prev:%s", keyPrefix, topic))
	}

	results, err := pipe.Exec(ctx)
	if err != nil && err != redis.Nil {
		// Pipeline may return errors for individual commands; that's OK
	}
	_ = err

	snapshot := make(map[string]*topicSnapshot)
	for i, topic := range topics {
		offset := i * 2
		current := ""
		previous := ""

		if offset < len(results) {
			if val, err := results[offset].(*redis.StringCmd).Result(); err == nil {
				current = val
			}
		}
		if offset+1 < len(results) {
			if val, err := results[offset+1].(*redis.StringCmd).Result(); err == nil {
				previous = val
			}
		}

		snapshot[topic] = &topicSnapshot{
			Current:  current,
			Previous: previous,
		}
	}

	return snapshot, nil
}

// ── Change Detection ─────────────────────────────────────────────────

func detectChanges(topics []string, snapshot map[string]*topicSnapshot) []string {
	lastSnapshotMu.Lock()
	defer lastSnapshotMu.Unlock()

	var changed []string
	for _, topic := range topics {
		tag := parseTopic(topic).Tag
		snap := snapshot[topic]
		if snap == nil {
			continue
		}

		lastVal, exists := lastSnapshot[topic]
		if !exists || lastVal != snap.Current {
			if snap.Current != "" {
				changed = append(changed, tag)
			}
		}
	}

	return changed
}

func updateLastSnapshot(topics []string, snapshot map[string]*topicSnapshot) {
	lastSnapshotMu.Lock()
	defer lastSnapshotMu.Unlock()

	for _, topic := range topics {
		if snap := snapshot[topic]; snap != nil && snap.Current != "" {
			lastSnapshot[topic] = snap.Current
		}
	}
}

// ── Values Builder ───────────────────────────────────────────────────

func buildValuesJSON(topics []string, snapshot map[string]*topicSnapshot) map[string]interface{} {
	values := make(map[string]interface{})

	for _, topic := range topics {
		tag := parseTopic(topic).Tag
		snap := snapshot[topic]
		if snap == nil || snap.Current == "" {
			values[tag] = nil
			continue
		}

		var parsed interface{}
		if err := json.Unmarshal([]byte(snap.Current), &parsed); err != nil {
			values[tag] = snap.Current
		} else {
			values[tag] = parsed
		}
	}

	return values
}

// ── UNS Topic Parsing ───────────────────────────────────────────────

func parseTopic(topic string) unsFields {
	parts := strings.Split(topic, "/")

	fields := unsFields{
		Enterprise: "unknown",
		Site:       "unknown",
		Area:       "unknown",
		Line:       "unknown",
		Tag:        "unknown",
	}

	if len(parts) >= 2 {
		fields.Enterprise = parts[1]
	}
	if len(parts) >= 3 {
		fields.Site = parts[2]
	}
	if len(parts) >= 4 {
		fields.Area = parts[3]
	}
	if len(parts) >= 5 {
		fields.Line = parts[4]
	}
	if len(parts) >= 6 {
		fields.Tag = strings.Join(parts[5:], "/")
	}

	return fields
}

// ── Postgres ─────────────────────────────────────────────────────────

func ensureTable(table string) error {
	query := fmt.Sprintf(` + "`" + `
		CREATE TABLE IF NOT EXISTS %s (
			id          BIGSERIAL    PRIMARY KEY,
			logged_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
			enterprise  TEXT         NOT NULL,
			site        TEXT         NOT NULL,
			area        TEXT         NOT NULL,
			line        TEXT         NOT NULL,
			tag         TEXT         NOT NULL,
			values      JSONB        NOT NULL,
			changed     TEXT[]       NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_%s_time ON %s (logged_at);
		CREATE INDEX IF NOT EXISTS idx_%s_line ON %s (enterprise, site, area, line);
	` + "`" + `, table, table, table, table, table)

	_, err := db.Exec(ctx, query)
	return err
}

func insertRow(table string, uns unsFields, tag string, values map[string]interface{}, changed []string) error {
	valuesJSON, err := json.Marshal(values)
	if err != nil {
		return fmt.Errorf("failed to marshal values: %w", err)
	}

	query := fmt.Sprintf(` + "`" + `
		INSERT INTO %s (enterprise, site, area, line, tag, values, changed)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	` + "`" + `, table)

	_, err = db.Exec(ctx, query,
		uns.Enterprise,
		uns.Site,
		uns.Area,
		uns.Line,
		tag,
		valuesJSON,
		changed,
	)

	if err != nil {
		return fmt.Errorf("failed to insert row: %w", err)
	}

	log.Printf("[uns-log] Logged row to %s: %s/%s/%s/%s tag=%s changed=%v",
		table, uns.Enterprise, uns.Site, uns.Area, uns.Line, tag, changed)

	return nil
}

// ── Helpers ──────────────────────────────────────────────────────────

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
`

const CMD_MAIN_GO = `package main

import (
	"log"
	"os"

	// Blank-import the function package so the init() runs
	_ "uns-log"
	"github.com/GoogleCloudPlatform/functions-framework-go/funcframework"
)

func main() {
	port := "8080"
	if envPort := os.Getenv("PORT"); envPort != "" {
		port = envPort
	}

	hostname := ""
	if localOnly := os.Getenv("LOCAL_ONLY"); localOnly == "true" {
		hostname = "127.0.0.1"
	}
	if err := funcframework.StartHostPort(hostname, port); err != nil {
		log.Fatalf("funcframework.StartHostPort: %v\\n", err)
	}
}
`

const GO_MOD = `module uns-log

go 1.21

require (
	github.com/GoogleCloudPlatform/functions-framework-go v1.8.0
	github.com/jackc/pgx/v5 v5.6.0
	github.com/redis/go-redis/v9 v9.7.0
)
`

function generateDockerfile(): string {
  return `FROM golang:1.21 AS builder
LABEL fnkit.fn="true"
WORKDIR /app
COPY . .
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -o server ./cmd/main.go

FROM gcr.io/distroless/static-debian11
COPY --from=builder /app/server /server

# Function target name — also used as Valkey config key
# e.g. uns-log → reads fnkit:config:uns-log from cache
ENV FUNCTION_TARGET=uns-log

# PostgreSQL connection (external)
ENV DATABASE_URL=postgres://fnkit:fnkit@fnkit-postgres:5432/fnkit?sslmode=disable

# Shared cache (Valkey/Redis) — available to all functions on fnkit-network
# Also used for config storage (fnkit:config:<function-target>)
ENV CACHE_URL=redis://fnkit-cache:6379
ENV CACHE_KEY_PREFIX=uns

EXPOSE 8080
CMD ["/server"]
`
}

function generateDockerCompose(name: string): string {
  return `# Docker Compose for uns-log — PostgreSQL Change Logger
# Reads UNS topic data from Valkey cache and logs changes to PostgreSQL
#
# Requires: docker network create fnkit-network
# Requires: fnkit-cache running (fnkit cache start)
# Requires: uns-framework running (populates uns:* cache keys)
# Requires: PostgreSQL accessible (external or on fnkit-network)
# Requires: Config set in Valkey (fnkit:config:<function-target>)

services:
  ${name}:
    build: .
    container_name: ${name}
    env_file:
      - .env
    networks:
      - fnkit-network
    restart: unless-stopped

networks:
  fnkit-network:
    name: fnkit-network
    external: true

# Usage:
#   1. Copy .env.example to .env and configure
#   2. Set config in Valkey:
#      docker exec fnkit-cache valkey-cli SET fnkit:config:${name} '{"table":"uns_log","topics":["v1.0/enterprise/site1/area1/line1/temperature"]}'
#   3. docker compose up -d
#
# Multiple instances (different equipment/lines):
#   Copy this directory, change container_name and FUNCTION_TARGET in .env
#   Each instance reads its own config from Valkey
#
# Trigger via gateway:
#   curl -H "Authorization: Bearer <token>" http://localhost:8080/${name}
`
}

const ENV_EXAMPLE = `# ── Function Configuration ────────────────────────────────────────────
# Function target name — also used as Valkey config key
# e.g. uns-log → reads fnkit:config:uns-log from cache
FUNCTION_TARGET=uns-log

# ── PostgreSQL Connection ─────────────────────────────────────────────
# Connection string for the PostgreSQL database
DATABASE_URL=postgres://fnkit:fnkit@fnkit-postgres:5432/fnkit?sslmode=disable

# ── Cache Configuration ──────────────────────────────────────────────
# Shared Valkey/Redis cache on fnkit-network
# Also used for config storage (fnkit:config:<function-target>)
CACHE_URL=redis://fnkit-cache:6379

# Cache key prefix for UNS data (must match uns-framework)
CACHE_KEY_PREFIX=uns
`

const GITIGNORE = `# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Docker
Dockerfile.local

# Go
vendor/
*.exe

# Environment
.env
`

function generateReadme(name: string): string {
  return `# ${name} — PostgreSQL Change Logger

A Go HTTP function that reads [UNS Framework](https://www.unsframework.com) topic data from the shared Valkey cache (populated by uns-framework) and logs snapshot rows to PostgreSQL when any value changes.

Scaffolded with \`fnkit mqtt log init\`.

## How It Works

\`\`\`
POST /${name} (via gateway)
    │
    ▼
┌─────────────────────────────────────────────┐
│  ${name} (Go HTTP function)                 │
│                                             │
│  1. Fetch config from Valkey (cached 30s)   │
│  2. Read all topics from Valkey cache       │
│  3. Compare current vs last logged snapshot │
│  4. INSERT into PostgreSQL if changed       │
│  5. Return JSON summary                     │
└─────────────────────────────────────────────┘
         │              │
         ▼              ▼
   fnkit-cache      PostgreSQL
   (Valkey)
\`\`\`

## Quick Start

\`\`\`bash
# Ensure fnkit-network, cache, and uns-framework are running
docker network create fnkit-network 2>/dev/null || true
fnkit cache start

# Configure
cp .env.example .env
# Edit .env with your PostgreSQL connection details

# Set config in Valkey
docker exec fnkit-cache valkey-cli SET fnkit:config:${name} '{"table":"uns_log","topics":["v1.0/acme/factory1/mixing/line1/temperature"]}'

# Build and start
docker compose up -d

# Trigger a log run
curl http://localhost:8080/${name}
\`\`\`

## Config in Valkey

Config is stored in the shared Valkey cache. The function reads its config using FUNCTION_TARGET as the key:

\`\`\`json
{
  "table": "uns_log",
  "topics": [
    "v1.0/acme/factory1/mixing/line1/temperature",
    "v1.0/acme/factory1/mixing/line1/pressure"
  ]
}
\`\`\`

Set with:
\`\`\`bash
docker exec fnkit-cache valkey-cli SET fnkit:config:${name} '<json>'
\`\`\`

## PostgreSQL Table (auto-created)

\`\`\`sql
CREATE TABLE IF NOT EXISTS uns_log (
    id          BIGSERIAL    PRIMARY KEY,
    logged_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    enterprise  TEXT         NOT NULL,
    site        TEXT         NOT NULL,
    area        TEXT         NOT NULL,
    line        TEXT         NOT NULL,
    tag         TEXT         NOT NULL,
    values      JSONB        NOT NULL,
    changed     TEXT[]       NOT NULL
);
\`\`\`

## Multiple Instances

Deploy the same image with different FUNCTION_TARGET values. Each reads its own config:

\`\`\`bash
# Instance 1
docker exec fnkit-cache valkey-cli SET fnkit:config:uns-log-line1 '{"table":"uns_log","topics":[...]}'

# Instance 2
docker exec fnkit-cache valkey-cli SET fnkit:config:uns-log-line2 '{"table":"uns_log","topics":[...]}'
\`\`\`

## Configuration

See \`.env.example\` for all options:

| Variable           | Default                                                            | Description                            |
| ------------------ | ------------------------------------------------------------------ | -------------------------------------- |
| \`FUNCTION_TARGET\`  | \`uns-log\`                                                          | Function name = Valkey config key      |
| \`DATABASE_URL\`     | \`postgres://fnkit:fnkit@fnkit-postgres:5432/fnkit?sslmode=disable\` | PostgreSQL connection string           |
| \`CACHE_URL\`        | \`redis://fnkit-cache:6379\`                                         | Valkey/Redis connection                |
| \`CACHE_KEY_PREFIX\` | \`uns\`                                                              | Cache key prefix (match uns-framework) |

## Built With

- [fnkit](https://github.com/functionkit/fnkit)
- [functions-framework-go](https://github.com/GoogleCloudPlatform/functions-framework-go) — HTTP function framework
- [go-redis](https://github.com/redis/go-redis) — Valkey/Redis client
- [pgx](https://github.com/jackc/pgx) — PostgreSQL driver
`
}

// ── Command Handlers ─────────────────────────────────────────────────

export async function unsLogInit(
  args: string[],
  options: Record<string, string | boolean>,
): Promise<boolean> {
  const name = args[0] || DEFAULT_DIR
  const targetDir = resolve(process.cwd(), name)

  logger.title('Creating UNS PostgreSQL Logger')

  if (existsSync(targetDir)) {
    logger.error(`Directory already exists: ${name}`)
    return false
  }

  // Create directories
  mkdirSync(targetDir, { recursive: true })
  mkdirSync(join(targetDir, 'cmd'), { recursive: true })

  // Write files
  const files: Record<string, string> = {
    'function.go': FUNCTION_GO,
    'cmd/main.go': CMD_MAIN_GO,
    'go.mod': GO_MOD,
    Dockerfile: generateDockerfile(),
    'docker-compose.yml': generateDockerCompose(name),
    '.env.example': ENV_EXAMPLE,
    '.gitignore': GITIGNORE,
    'README.md': generateReadme(name),
  }

  for (const [filename, content] of Object.entries(files)) {
    const filePath = join(targetDir, filename)
    const dir = join(targetDir, filename.split('/').slice(0, -1).join('/'))
    if (dir !== targetDir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(filePath, content)
    logger.success(`Created ${filename}`)
  }

  logger.newline()
  logger.success(`UNS logger created in ${name}/`)
  logger.newline()
  logger.info('Next steps:')
  logger.dim(`  cd ${name}`)
  logger.dim('  cp .env.example .env')
  logger.dim('  # Edit .env with your PostgreSQL connection details')
  logger.dim(
    `  docker exec fnkit-cache valkey-cli SET fnkit:config:${name} '{"table":"uns_log","topics":["v1.0/enterprise/site/area/line/tag"]}'`,
  )
  logger.dim('  docker compose up -d')
  logger.newline()

  return true
}

export async function unsLogStart(
  args: string[],
  options: Record<string, string | boolean>,
): Promise<boolean> {
  const dir = args[0] || DEFAULT_DIR
  const targetDir = resolve(process.cwd(), dir)

  logger.title('Starting UNS PostgreSQL Logger')

  if (!existsSync(targetDir)) {
    logger.error(`Directory not found: ${dir}`)
    logger.info('Run "fnkit mqtt log init" first')
    return false
  }

  if (
    !(await docker.isDockerAvailable()) ||
    !(await docker.isDockerRunning())
  ) {
    logger.error('Docker is not available')
    return false
  }

  // Ensure network exists
  await exec('docker', ['network', 'create', FNKIT_NETWORK])

  // Build and start with docker compose
  logger.step('Building and starting...')
  const { execStream } = await import('../../utils/shell')
  const exitCode = await execStream(
    'docker',
    ['compose', 'up', '-d', '--build'],
    { cwd: targetDir },
  )

  if (exitCode === 0) {
    logger.newline()
    logger.success('UNS logger started')
    logger.dim('  Accessible via gateway or direct HTTP')
    logger.dim(`  Logs: docker logs -f ${dir}`)
    return true
  }

  logger.error('Failed to start UNS logger')
  return false
}

export async function unsLogStop(
  args: string[],
  options: Record<string, string | boolean>,
): Promise<boolean> {
  const name = args[0] || CONTAINER_NAME

  logger.title('Stopping UNS PostgreSQL Logger')

  const result = await exec('docker', ['rm', '-f', name])

  if (result.success) {
    logger.success(`Stopped: ${name}`)
    return true
  }

  logger.error(`Failed to stop ${name} (may not be running)`)
  return false
}

export async function unsLogStatus(): Promise<boolean> {
  const result = await exec('docker', [
    'ps',
    '--filter',
    `name=${CONTAINER_NAME}`,
    '--format',
    '{{.Names}}\t{{.Status}}\t{{.State}}',
  ])

  if (result.success && result.stdout.trim()) {
    const [name, status, state] = result.stdout.trim().split('\t')
    logger.success(`${name}: ${status} (${state})`)
    return true
  }

  logger.dim('uns-log: not running')
  return true
}
