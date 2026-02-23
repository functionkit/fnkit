// MQTT Plugin — UNS Framework Monitor (uns-framework)
// Scaffolds a Go MQTT function that subscribes to v1.0/# and caches all topic data

import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import logger from '../../utils/logger'
import * as docker from '../../utils/docker'
import { exec } from '../../utils/shell'

const DEFAULT_DIR = 'uns-framework'
const CONTAINER_NAME = 'uns-framework'
const FNKIT_NETWORK = 'fnkit-network'

// ── Templates ────────────────────────────────────────────────────────

const FUNCTION_GO = `package function

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/functionkit/function-framework-go/functions"
	"github.com/redis/go-redis/v9"
)

// ── Cache client ─────────────────────────────────────────────────────
// Connects to the shared Valkey/Redis cache on fnkit-network.
// All UNS topic data is written here for other functions to consume.

var (
	cache     *redis.Client
	ctx       = context.Background()
	keyPrefix string
	cacheTTL  time.Duration
)

func init() {
	// Parse cache configuration from environment
	cacheURL := envOrDefault("CACHE_URL", "redis://fnkit-cache:6379")
	keyPrefix = envOrDefault("CACHE_KEY_PREFIX", "uns")

	ttlSeconds, _ := strconv.Atoi(envOrDefault("CACHE_TTL", "0"))
	if ttlSeconds > 0 {
		cacheTTL = time.Duration(ttlSeconds) * time.Second
	}

	// Parse Redis URL
	opts, err := redis.ParseURL(cacheURL)
	if err != nil {
		log.Fatalf("Failed to parse CACHE_URL: %v", err)
	}
	cache = redis.NewClient(opts)

	// Verify cache connection
	if err := cache.Ping(ctx).Err(); err != nil {
		log.Printf("[uns-framework] Warning: cache not reachable at %s: %v", cacheURL, err)
	} else {
		log.Printf("[uns-framework] Connected to cache at %s", cacheURL)
	}

	// Register the UNS monitor function.
	// The wildcard subscription is configured via env vars:
	//   FUNCTION_TARGET=unsMonitor       (registry lookup)
	//   MQTT_SUBSCRIBE_TOPIC=v1.0/#      (actual MQTT subscription)
	//   MQTT_TOPIC_PREFIX=v1.0           (for topic param parsing)
	functions.MQTT("unsMonitor", unsMonitor)
}

// unsMonitor is invoked for every message on v1.0/#.
// It writes the payload to cache, shifts the previous value, and tracks metadata.
//
// Cache key layout:
//
//	uns:topics                          → SET of all discovered topic paths
//	uns:data:<full/topic/path>          → latest payload (raw JSON)
//	uns:prev:<full/topic/path>          → previous payload (raw JSON)
//	uns:meta:<full/topic/path>          → {"last_updated":..., "count":..., "first_seen":...}
func unsMonitor(req *functions.MqttRequest, res functions.MqttResponse) {
	topic := req.Topic
	payload := string(req.Payload)

	dataKey := fmt.Sprintf("%s:data:%s", keyPrefix, topic)
	prevKey := fmt.Sprintf("%s:prev:%s", keyPrefix, topic)
	metaKey := fmt.Sprintf("%s:meta:%s", keyPrefix, topic)
	topicsKey := fmt.Sprintf("%s:topics", keyPrefix)

	// Use a pipeline for atomic batch writes
	pipe := cache.Pipeline()

	// 1. Shift current value → previous value
	currentVal, err := cache.Get(ctx, dataKey).Result()
	if err == nil && currentVal != "" {
		pipe.Set(ctx, prevKey, currentVal, cacheTTL)
	}

	// 2. Write new value
	pipe.Set(ctx, dataKey, payload, cacheTTL)

	// 3. Track topic in the registry set
	pipe.SAdd(ctx, topicsKey, topic)

	// 4. Update metadata
	meta := buildMeta(metaKey)
	metaJSON, _ := json.Marshal(meta)
	pipe.Set(ctx, metaKey, metaJSON, 0) // metadata never expires

	// Execute pipeline
	if _, err := pipe.Exec(ctx); err != nil {
		log.Printf("[uns-framework] Cache pipeline error for %s: %v", topic, err)
	}

	// No response needed — this is a silent monitor.
	res.End()
}

// ── Metadata ─────────────────────────────────────────────────────────

type topicMeta struct {
	LastUpdated string \`json:"last_updated"\`
	Count       int64  \`json:"count"\`
	FirstSeen   string \`json:"first_seen"\`
}

func buildMeta(metaKey string) topicMeta {
	now := time.Now().UTC().Format(time.RFC3339)

	// Try to read existing metadata
	existing, err := cache.Get(ctx, metaKey).Result()
	if err == nil && existing != "" {
		var meta topicMeta
		if json.Unmarshal([]byte(existing), &meta) == nil {
			meta.LastUpdated = now
			meta.Count++
			return meta
		}
	}

	// First time seeing this topic
	return topicMeta{
		LastUpdated: now,
		Count:       1,
		FirstSeen:   now,
	}
}

// ── Helpers ──────────────────────────────────────────────────────────

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
`

const CMD_MAIN_GO = `package main

import (
	"log"

	// Blank-import the function package so the init() runs
	_ "uns-framework"
	"github.com/functionkit/function-framework-go/funcframework"
)

func main() {
	if err := funcframework.Start(); err != nil {
		log.Fatalf("funcframework.Start: %v\\n", err)
	}
}
`

const GO_MOD = `module uns-framework

go 1.21

require (
	github.com/functionkit/function-framework-go v0.2.0
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

# MQTT broker connection
ENV MQTT_BROKER=mqtt://localhost:1883
# Function target name
ENV FUNCTION_TARGET=unsMonitor
# Topic prefix
ENV MQTT_TOPIC_PREFIX=v1.0
# MQTT QoS level (0, 1, or 2)
ENV MQTT_QOS=1
# MQTT client identifier (auto-generated if empty)
ENV MQTT_CLIENT_ID=
# MQTT broker authentication
ENV MQTT_USERNAME=
ENV MQTT_PASSWORD=
# TLS: path to CA certificate
ENV MQTT_CA=
# mTLS: path to client certificate and key
ENV MQTT_CERT=
ENV MQTT_KEY=
# Whether to reject unauthorized TLS certificates
ENV MQTT_REJECT_UNAUTHORIZED=true
# Override subscribe topic for wildcard (v1.0/#)
ENV MQTT_SUBSCRIBE_TOPIC=v1.0/#
# Shared cache (Valkey/Redis) — available to all functions on fnkit-network
ENV CACHE_URL=redis://fnkit-cache:6379
# Cache key prefix for UNS data
ENV CACHE_KEY_PREFIX=uns
# Cache TTL in seconds (0 = no expiry)
ENV CACHE_TTL=0

CMD ["/server"]
`
}

function generateDockerCompose(name: string): string {
  return `# Docker Compose for uns-framework — UNS Topic Monitor
# Subscribes to v1.0/# and caches all topic data in Valkey
#
# Requires: docker network create fnkit-network
# Requires: fnkit-cache running (fnkit cache start)
# Requires: an MQTT broker

services:
  ${name}:
    build: .
    container_name: ${name}
    env_file:
      - .env
    volumes:
      # Mount certificates directory for TLS/mTLS
      - ./certs:/certs:ro
    networks:
      - fnkit-network
    restart: unless-stopped

networks:
  fnkit-network:
    name: fnkit-network
    external: true

# Usage:
#   1. Copy .env.example to .env and configure
#   2. Place TLS certificates in ./certs/ (if using TLS/mTLS)
#   3. docker compose up -d
#
# Cache key layout:
#   uns:topics                     → SET of all discovered topics
#   uns:data:<topic>               → latest payload
#   uns:prev:<topic>               → previous payload
#   uns:meta:<topic>               → {last_updated, count, first_seen}
#
# Query from any function or CLI:
#   docker exec fnkit-cache valkey-cli SMEMBERS uns:topics
#   docker exec fnkit-cache valkey-cli GET "uns:data:v1.0/enterprise/site1/area1/line1"
`
}

const ENV_EXAMPLE = `# ── MQTT Broker Connection ────────────────────────────────────────────
# Protocol: mqtt:// (plain) or mqtts:// (TLS)
MQTT_BROKER=mqtt://localhost:1883

# ── Function Target ──────────────────────────────────────────────────
# Registry lookup name for the handler function
FUNCTION_TARGET=unsMonitor

# ── Topic Configuration ──────────────────────────────────────────────
# Topic prefix (UNS framework v1.0 namespace)
MQTT_TOPIC_PREFIX=v1.0

# Override subscribe topic for wildcard subscription
# Subscribes to all topics under the v1.0 namespace
MQTT_SUBSCRIBE_TOPIC=v1.0/#

# MQTT QoS level (0 = at most once, 1 = at least once, 2 = exactly once)
MQTT_QOS=1

# MQTT client identifier (auto-generated if empty)
MQTT_CLIENT_ID=

# ── MQTT Authentication ──────────────────────────────────────────────
MQTT_USERNAME=
MQTT_PASSWORD=

# ── TLS Configuration ────────────────────────────────────────────────
# For TLS: set MQTT_BROKER to mqtts:// and provide CA certificate
# Paths are relative to the container — mount certs via docker-compose volumes
MQTT_CA=
# Example: MQTT_CA=/certs/ca.crt

# ── mTLS (Mutual TLS) Configuration ──────────────────────────────────
# For mTLS: provide client certificate and private key in addition to CA
MQTT_CERT=
MQTT_KEY=
# Example: MQTT_CERT=/certs/client.crt
# Example: MQTT_KEY=/certs/client.key

# Whether to reject unauthorized TLS certificates
# Set to false for self-signed certificates
MQTT_REJECT_UNAUTHORIZED=true

# ── Cache Configuration ──────────────────────────────────────────────
# Shared Valkey/Redis cache on fnkit-network
CACHE_URL=redis://fnkit-cache:6379

# Cache key prefix for UNS data
CACHE_KEY_PREFIX=uns

# Cache TTL in seconds (0 = no expiry)
CACHE_TTL=0
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

# Certificates (keep .example files)
certs/*.crt
certs/*.key
certs/*.pem
!certs/.gitkeep
`

function generateReadme(name: string): string {
  return `# ${name} — UNS Topic Monitor

A Go MQTT function that monitors the [UNS Framework](https://www.unsframework.com) namespace and caches all topic data in the shared Valkey cache.

Scaffolded with \`fnkit uns uns init\`.

## How It Works

\`\`\`
MQTT Broker (v1.0/#)
    │
    │  wildcard subscription via function-framework-go
    │
    ▼
┌──────────────────────────────┐
│  ${name}                     │
│  Receives every message on   │
│  v1.0/# and writes to cache │
│                              │
│  For each message:           │
│  1. Shift current → prev    │
│  2. Write new value          │
│  3. Track topic in registry  │
│  4. Update metadata          │
└──────────────┬───────────────┘
               │
               ▼
      fnkit-cache (Valkey)
\`\`\`

## Quick Start

\`\`\`bash
# Ensure fnkit-network and cache are running
docker network create fnkit-network 2>/dev/null || true
fnkit cache start

# Configure
cp .env.example .env
# Edit .env with your MQTT broker details

# Build and start
docker compose up -d

# Check logs
docker logs -f ${name}
\`\`\`

## TLS / mTLS

Place certificates in the \`certs/\` directory:

\`\`\`bash
# TLS (server verification)
cp ca.crt certs/
# Edit .env: MQTT_CA=/certs/ca.crt

# mTLS (mutual authentication)
cp client.crt client.key certs/
# Edit .env: MQTT_CERT=/certs/client.crt  MQTT_KEY=/certs/client.key
\`\`\`

## Cache Key Layout

| Key Pattern        | Type   | Description                               |
| ------------------ | ------ | ----------------------------------------- |
| \`uns:topics\`       | SET    | All discovered topic paths                |
| \`uns:data:<topic>\` | STRING | Latest payload (raw JSON)                 |
| \`uns:prev:<topic>\` | STRING | Previous payload (raw JSON)               |
| \`uns:meta:<topic>\` | STRING | \`{"last_updated", "count", "first_seen"}\` |

## Configuration

See \`.env.example\` for all options. Key settings:

| Variable                   | Default                    | Description                          |
| -------------------------- | -------------------------- | ------------------------------------ |
| \`MQTT_BROKER\`              | \`mqtt://localhost:1883\`    | MQTT broker URL                      |
| \`MQTT_SUBSCRIBE_TOPIC\`     | \`v1.0/#\`                   | Wildcard subscription                |
| \`MQTT_USERNAME\`            | —                          | Broker authentication                |
| \`MQTT_PASSWORD\`            | —                          | Broker authentication                |
| \`MQTT_CA\`                  | —                          | CA certificate path (TLS)            |
| \`MQTT_CERT\`                | —                          | Client certificate path (mTLS)       |
| \`MQTT_KEY\`                 | —                          | Client private key path (mTLS)       |
| \`MQTT_REJECT_UNAUTHORIZED\` | \`true\`                     | Set \`false\` for self-signed certs    |
| \`CACHE_URL\`                | \`redis://fnkit-cache:6379\` | Valkey/Redis connection              |
| \`CACHE_KEY_PREFIX\`         | \`uns\`                      | Prefix for all cache keys            |
| \`CACHE_TTL\`                | \`0\`                        | TTL in seconds (0 = no expiry)       |

## Built With

- [fnkit](https://github.com/functionkit/fnkit)
- [function-framework-go](https://github.com/functionkit/function-framework-go) — MQTT function framework
- [go-redis](https://github.com/redis/go-redis) — Valkey/Redis client
`
}

// ── Command Handlers ─────────────────────────────────────────────────

export async function unsInit(
  args: string[],
  options: Record<string, string | boolean>,
): Promise<boolean> {
  const name = args[0] || DEFAULT_DIR
  const targetDir = resolve(process.cwd(), name)

  logger.title('Creating UNS Framework Monitor')

  if (existsSync(targetDir)) {
    logger.error(`Directory already exists: ${name}`)
    return false
  }

  // Create directories
  mkdirSync(targetDir, { recursive: true })
  mkdirSync(join(targetDir, 'cmd'), { recursive: true })
  mkdirSync(join(targetDir, 'certs'), { recursive: true })

  // Write files
  const files: Record<string, string> = {
    'function.go': FUNCTION_GO,
    'cmd/main.go': CMD_MAIN_GO,
    'go.mod': GO_MOD,
    'Dockerfile': generateDockerfile(),
    'docker-compose.yml': generateDockerCompose(name),
    '.env.example': ENV_EXAMPLE,
    '.gitignore': GITIGNORE,
    'certs/.gitkeep': '',
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
  logger.success(`UNS monitor created in ${name}/`)
  logger.newline()
  logger.info('Next steps:')
  logger.dim(`  cd ${name}`)
  logger.dim('  cp .env.example .env')
  logger.dim('  # Edit .env with your MQTT broker details')
  logger.dim('  # Place TLS certs in certs/ if needed')
  logger.dim('  docker compose up -d')
  logger.newline()

  return true
}

export async function unsStart(
  args: string[],
  options: Record<string, string | boolean>,
): Promise<boolean> {
  const dir = args[0] || DEFAULT_DIR
  const targetDir = resolve(process.cwd(), dir)

  logger.title('Starting UNS Framework Monitor')

  if (!existsSync(targetDir)) {
    logger.error(`Directory not found: ${dir}`)
    logger.info('Run "fnkit uns uns init" first')
    return false
  }

  if (!(await docker.isDockerAvailable()) || !(await docker.isDockerRunning())) {
    logger.error('Docker is not available')
    return false
  }

  // Ensure network exists
  await exec('docker', ['network', 'create', FNKIT_NETWORK])

  // Build and start with docker compose
  logger.step('Building and starting...')
  const { execStream } = await import('../../utils/shell')
  const exitCode = await execStream('docker', ['compose', 'up', '-d', '--build'], {
    cwd: targetDir,
  })

  if (exitCode === 0) {
    logger.newline()
    logger.success('UNS monitor started')
    logger.dim('  Subscribing to MQTT topics and caching to Valkey')
    logger.dim(`  Logs: docker logs -f ${dir}`)
    return true
  }

  logger.error('Failed to start UNS monitor')
  return false
}

export async function unsStop(
  args: string[],
  options: Record<string, string | boolean>,
): Promise<boolean> {
  const name = args[0] || CONTAINER_NAME

  logger.title('Stopping UNS Framework Monitor')

  const result = await exec('docker', ['rm', '-f', name])

  if (result.success) {
    logger.success(`Stopped: ${name}`)
    return true
  }

  logger.error(`Failed to stop ${name} (may not be running)`)
  return false
}

export async function unsStatus(): Promise<boolean> {
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

  logger.dim('uns-framework: not running')
  return true
}
