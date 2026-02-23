// MQTT Plugin — UNS Cache Reader (uns-cache)
// Scaffolds a Node.js HTTP function that reads UNS topic data from Valkey cache

import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import logger from '../../utils/logger'
import * as docker from '../../utils/docker'
import { exec } from '../../utils/shell'

const DEFAULT_DIR = 'uns-cache'
const CONTAINER_NAME = 'uns-cache'
const FNKIT_NETWORK = 'fnkit-network'

// ── Templates ────────────────────────────────────────────────────────

const INDEX_JS = `const functions = require('@google-cloud/functions-framework')
const Redis = require('ioredis')

// ── Cache connection ─────────────────────────────────────────────────
// Connects to the shared Valkey/Redis cache on fnkit-network.
// Reads UNS topic data written by the uns-framework monitor.

const CACHE_URL = process.env.CACHE_URL || 'redis://fnkit-cache:6379'
const KEY_PREFIX = process.env.CACHE_KEY_PREFIX || 'uns'

let cache

function connectCache() {
  if (!cache) {
    cache = new Redis(CACHE_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null
        return Math.min(times * 200, 2000)
      },
    })
    cache.on('error', (err) =>
      console.error('[uns-cache] Cache error:', err.message),
    )
  }
  return cache
}

// ── Main function ────────────────────────────────────────────────────
//
// POST /uns-cache
//   Body: { "topics": ["v1.0/enterprise/site1/...", ...] }
//   If topics is empty or omitted, reads ALL topics from uns:topics set.
//
// Returns JSON with topic data and change detection:
//   { topic_count, changed_count, topics: [...], changes: [...] }
//
// The "changed" flag on each topic indicates whether current !== previous,
// useful for downstream actions (e.g. DB insert on change).

functions.http('uns-cache', async (req, res) => {
  const rdb = connectCache()

  try {
    await rdb.connect().catch(() => {}) // no-op if already connected

    // ── Resolve topic list ───────────────────────────────────────────
    let topicNames = []

    if (
      req.body &&
      Array.isArray(req.body.topics) &&
      req.body.topics.length > 0
    ) {
      topicNames = req.body.topics
    } else {
      // No topics specified — read all discovered topics from the registry
      const topicsKey = \`\${KEY_PREFIX}:topics\`
      topicNames = await rdb.smembers(topicsKey)
      topicNames.sort() // alphabetical for consistent output
    }

    if (topicNames.length === 0) {
      res.status(200).json({
        topic_count: 0,
        changed_count: 0,
        topics: [],
        changes: [],
      })
      return
    }

    // ── Batch read from cache using pipeline ─────────────────────────
    const pipe = rdb.pipeline()

    for (const topic of topicNames) {
      pipe.get(\`\${KEY_PREFIX}:data:\${topic}\`) // current value
      pipe.get(\`\${KEY_PREFIX}:prev:\${topic}\`) // previous value
      pipe.get(\`\${KEY_PREFIX}:meta:\${topic}\`) // metadata
    }

    const results = await pipe.exec()

    // ── Build response ───────────────────────────────────────────────
    const topics = []
    const changes = []

    for (let i = 0; i < topicNames.length; i++) {
      const topic = topicNames[i]
      const offset = i * 3

      // Pipeline results are [err, value] tuples
      const currentRaw = results[offset]?.[1] || null
      const previousRaw = results[offset + 1]?.[1] || null
      const metaRaw = results[offset + 2]?.[1] || '{}'

      // Parse values — try JSON, fall back to raw string
      let current = currentRaw
      try {
        if (currentRaw) current = JSON.parse(currentRaw)
      } catch {
        // keep as string
      }

      let previous = previousRaw
      try {
        if (previousRaw) previous = JSON.parse(previousRaw)
      } catch {
        // keep as string
      }

      // Parse metadata
      let meta = {}
      try {
        meta = JSON.parse(metaRaw)
      } catch {
        // ignore parse errors
      }

      // Change detection: compare current vs previous raw values
      const changed =
        currentRaw !== null &&
        previousRaw !== null &&
        currentRaw !== previousRaw

      const topicData = {
        topic,
        value: current,
        previous_value: previous,
        changed,
        last_updated: meta.last_updated || null,
        count: meta.count || 0,
        first_seen: meta.first_seen || null,
      }

      topics.push(topicData)

      // Track changes separately for easy filtering
      if (changed) {
        changes.push({
          topic,
          current,
          previous,
          last_updated: meta.last_updated || null,
        })
      }
    }

    res.status(200).json({
      topic_count: topics.length,
      changed_count: changes.length,
      topics,
      changes,
    })
  } catch (err) {
    console.error('[uns-cache] Error:', err)
    res.status(500).json({ error: 'Failed to read cache', detail: err.message })
  }
})
`

function generatePackageJson(name: string): string {
  return JSON.stringify(
    {
      name,
      version: '1.0.0',
      main: 'index.js',
      scripts: {
        start: 'functions-framework --target=uns-cache',
      },
      dependencies: {
        '@google-cloud/functions-framework': '^3.0.0',
        ioredis: '^5.9.3',
      },
    },
    null,
    2,
  )
}

function generateDockerfile(): string {
  return `FROM node:20-slim
LABEL fnkit.fn="true"
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --only=production
COPY . .

# Function target name
ENV FUNCTION_TARGET=uns-cache

# Shared cache (Valkey/Redis) — available to all functions on fnkit-network
ENV CACHE_URL=redis://fnkit-cache:6379

# Cache key prefix for UNS data (matches uns-framework)
ENV CACHE_KEY_PREFIX=uns

CMD ["npm", "start"]
`
}

function generateDockerCompose(name: string): string {
  return `# Docker Compose for uns-cache — UNS Cache Reader
# Reads UNS topic data from Valkey cache (populated by uns-framework) and returns JSON
#
# Requires: docker network create fnkit-network
# Requires: fnkit-cache running (fnkit cache start)
# Requires: uns-framework running (populates uns:* cache keys)

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
#   2. docker compose up -d
#
# The function reads UNS topic data from cache and returns JSON:
#   curl -H "Authorization: Bearer <token>" http://localhost:8080/${name}
#
# With specific topics:
#   curl -H "Authorization: Bearer <token>" \\
#     -H "Content-Type: application/json" \\
#     -d '{"topics": ["v1.0/enterprise/site1/area1/line1/temperature"]}' \\
#     http://localhost:8080/${name}
`
}

const ENV_EXAMPLE = `# ── Function Configuration ────────────────────────────────────────────
# Function target name
FUNCTION_TARGET=uns-cache

# ── Cache Configuration ──────────────────────────────────────────────
# Shared Valkey/Redis cache on fnkit-network
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

# Node.js
node_modules/
npm-debug.log
yarn-error.log

# Environment
.env
`

function generateReadme(name: string): string {
  return `# ${name} — UNS Cache Reader

A Node.js HTTP function that reads [UNS Framework](https://www.unsframework.com) topic data from the shared Valkey cache (populated by uns-framework) and returns JSON with change detection.

Scaffolded with \`fnkit uns cache init\`.

## How It Works

\`\`\`
Request (topic list or all) → ${name} → reads Valkey cache → JSON response
\`\`\`

## Quick Start

\`\`\`bash
# Ensure fnkit-network, cache, and uns-framework are running
docker network create fnkit-network 2>/dev/null || true
fnkit cache start

# Configure
cp .env.example .env

# Build and start
docker compose up -d
\`\`\`

## API Usage

### Get all cached topics

\`\`\`bash
curl -H "Authorization: Bearer <token>" http://localhost:8080/${name}
\`\`\`

### Get specific topics

\`\`\`bash
curl -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"topics": ["v1.0/enterprise/site1/area1/line1/temperature"]}' \\
  http://localhost:8080/${name}
\`\`\`

## JSON Response

\`\`\`json
{
  "topic_count": 1,
  "changed_count": 1,
  "topics": [
    {
      "topic": "v1.0/enterprise/site1/area1/line1/temperature",
      "value": { "value": 23.1, "unit": "C" },
      "previous_value": { "value": 22.5, "unit": "C" },
      "changed": true,
      "last_updated": "2026-02-20T15:10:44Z",
      "count": 2,
      "first_seen": "2026-02-20T15:10:42Z"
    }
  ],
  "changes": [
    {
      "topic": "v1.0/enterprise/site1/area1/line1/temperature",
      "current": { "value": 23.1, "unit": "C" },
      "previous": { "value": 22.5, "unit": "C" },
      "last_updated": "2026-02-20T15:10:44Z"
    }
  ]
}
\`\`\`

## Configuration

See \`.env.example\` for all options:

| Variable           | Default                    | Description                                      |
| ------------------ | -------------------------- | ------------------------------------------------ |
| \`FUNCTION_TARGET\`  | \`uns-cache\`                | Function name for framework                      |
| \`CACHE_URL\`        | \`redis://fnkit-cache:6379\` | Valkey/Redis connection                          |
| \`CACHE_KEY_PREFIX\` | \`uns\`                      | Prefix for cache keys (must match uns-framework) |

## Built With

- [fnkit](https://github.com/functionkit/fnkit)
- [@google-cloud/functions-framework](https://github.com/GoogleCloudPlatform/functions-framework-nodejs) — HTTP function framework
- [ioredis](https://github.com/redis/ioredis) — Valkey/Redis client
`
}

// ── Command Handlers ─────────────────────────────────────────────────

export async function unsCacheInit(
  args: string[],
  options: Record<string, string | boolean>,
): Promise<boolean> {
  const name = args[0] || DEFAULT_DIR
  const targetDir = resolve(process.cwd(), name)

  logger.title('Creating UNS Cache Reader')

  if (existsSync(targetDir)) {
    logger.error(`Directory already exists: ${name}`)
    return false
  }

  // Create directory
  mkdirSync(targetDir, { recursive: true })

  // Write files
  const files: Record<string, string> = {
    'index.js': INDEX_JS,
    'package.json': generatePackageJson(name),
    Dockerfile: generateDockerfile(),
    'docker-compose.yml': generateDockerCompose(name),
    '.env.example': ENV_EXAMPLE,
    '.gitignore': GITIGNORE,
    'README.md': generateReadme(name),
  }

  for (const [filename, content] of Object.entries(files)) {
    const filePath = join(targetDir, filename)
    writeFileSync(filePath, content)
    logger.success(`Created ${filename}`)
  }

  logger.newline()
  logger.success(`UNS cache reader created in ${name}/`)
  logger.newline()
  logger.info('Next steps:')
  logger.dim(`  cd ${name}`)
  logger.dim('  cp .env.example .env')
  logger.dim('  npm install')
  logger.dim('  docker compose up -d')
  logger.newline()

  return true
}

export async function unsCacheStart(
  args: string[],
  options: Record<string, string | boolean>,
): Promise<boolean> {
  const dir = args[0] || DEFAULT_DIR
  const targetDir = resolve(process.cwd(), dir)

  logger.title('Starting UNS Cache Reader')

  if (!existsSync(targetDir)) {
    logger.error(`Directory not found: ${dir}`)
    logger.info('Run "fnkit uns cache init" first')
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
    logger.success('UNS cache reader started')
    logger.dim('  Accessible via gateway or direct HTTP')
    logger.dim(`  Logs: docker logs -f ${dir}`)
    return true
  }

  logger.error('Failed to start UNS cache reader')
  return false
}

export async function unsCacheStop(
  args: string[],
  options: Record<string, string | boolean>,
): Promise<boolean> {
  const name = args[0] || CONTAINER_NAME

  logger.title('Stopping UNS Cache Reader')

  const result = await exec('docker', ['rm', '-f', name])

  if (result.success) {
    logger.success(`Stopped: ${name}`)
    return true
  }

  logger.error(`Failed to stop ${name} (may not be running)`)
  return false
}

export async function unsCacheStatus(): Promise<boolean> {
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

  logger.dim('uns-cache: not running')
  return true
}
