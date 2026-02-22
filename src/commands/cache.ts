// Cache command - Valkey (Redis-compatible) shared cache for all functions

import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import logger from '../utils/logger'
import * as docker from '../utils/docker'

const CACHE_DIR = 'fnkit-cache'
const CACHE_IMAGE = 'valkey/valkey:8-alpine'
const CACHE_CONTAINER = 'fnkit-cache'
const FNKIT_NETWORK = 'fnkit-network'

const CACHE_DOCKER_COMPOSE = `# FnKit Cache — Valkey (Redis-compatible) shared cache
# Provides a fast key-value cache accessible by all function containers
# on the fnkit-network via redis://fnkit-cache:6379
#
# Setup:
#   1. Run: docker compose up -d
#   2. Functions connect using CACHE_URL=redis://fnkit-cache:6379

services:
  cache:
    image: valkey/valkey:8-alpine
    container_name: fnkit-cache
    restart: unless-stopped
    command: valkey-server --save 60 1 --loglevel warning --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - cache-data:/data
    networks:
      - fnkit-network
    labels:
      - fnkit.cache=true
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 5s

volumes:
  cache-data:

networks:
  fnkit-network:
    name: fnkit-network
    external: true
`

const CACHE_README = `# FnKit Cache

Valkey-based shared cache for all your FnKit functions. Valkey is a Redis-compatible,
open-source (BSD) key-value store maintained by the Linux Foundation.

## Architecture

\`\`\`
Function containers ──→ fnkit-cache:6379 (Valkey)
                         ├── Sub-millisecond reads/writes
                         ├── TTL support (auto-expire keys)
                         ├── Persistent (snapshots to disk)
                         └── 256 MB max memory (LRU eviction)
\`\`\`

## Quick Start

\`\`\`bash
# Make sure fnkit-network exists
docker network create fnkit-network 2>/dev/null || true

# Start the cache
docker compose up -d

# Test it
docker exec fnkit-cache valkey-cli SET hello world
docker exec fnkit-cache valkey-cli GET hello
# → "world"
\`\`\`

## Connecting from Functions

Every function container on \`fnkit-network\` can reach the cache at:

\`\`\`
redis://fnkit-cache:6379
\`\`\`

Set the \`CACHE_URL\` environment variable in your function's Dockerfile or deploy config.

### Node.js (ioredis)

\`\`\`js
const Redis = require('ioredis');
const cache = new Redis(process.env.CACHE_URL || 'redis://fnkit-cache:6379');

await cache.set('key', 'value', 'EX', 300);  // expires in 5 minutes
const value = await cache.get('key');
\`\`\`

### Python (redis-py)

\`\`\`python
import os, redis
cache = redis.from_url(os.environ.get('CACHE_URL', 'redis://fnkit-cache:6379'))

cache.set('key', 'value', ex=300)
value = cache.get('key')
\`\`\`

### Go (go-redis)

\`\`\`go
import "github.com/redis/go-redis/v9"

rdb := redis.NewClient(&redis.Options{Addr: "fnkit-cache:6379"})
rdb.Set(ctx, "key", "value", 5*time.Minute)
value, _ := rdb.Get(ctx, "key").Result()
\`\`\`

### Java (Jedis)

\`\`\`java
import redis.clients.jedis.Jedis;

Jedis cache = new Jedis("fnkit-cache", 6379);
cache.setex("key", 300, "value");
String value = cache.get("key");
\`\`\`

### Ruby (redis-rb)

\`\`\`ruby
require 'redis'
cache = Redis.new(url: ENV.fetch('CACHE_URL', 'redis://fnkit-cache:6379'))

cache.set('key', 'value', ex: 300)
value = cache.get('key')
\`\`\`

### .NET (StackExchange.Redis)

\`\`\`csharp
using StackExchange.Redis;

var redis = ConnectionMultiplexer.Connect("fnkit-cache:6379");
var db = redis.GetDatabase();
db.StringSet("key", "value", TimeSpan.FromMinutes(5));
var value = db.StringGet("key");
\`\`\`

### PHP (Predis)

\`\`\`php
require 'vendor/autoload.php';
$cache = new Predis\\Client(getenv('CACHE_URL') ?: 'redis://fnkit-cache:6379');

$cache->setex('key', 300, 'value');
$value = $cache->get('key');
\`\`\`

## Configuration

The cache runs with these defaults:

| Setting | Value | Description |
|---------|-------|-------------|
| Max memory | 256 MB | Configurable via \`--maxmemory\` |
| Eviction policy | allkeys-lru | Least recently used keys evicted when full |
| Persistence | RDB snapshots | Saves to disk every 60s if ≥1 key changed |
| Port | 6379 | Standard Redis port |

## Why Valkey?

Valkey is the community fork of Redis, maintained by the Linux Foundation with backing
from AWS, Google, Oracle, and others. It's wire-protocol compatible with Redis — every
Redis client library works unchanged. Fully open source (BSD license).

## Notes

- Cache data persists in the \`cache-data\` Docker volume (survives restarts)
- All function containers on \`fnkit-network\` can access the cache
- No authentication by default (internal network only)
- Monitor with: \`docker exec fnkit-cache valkey-cli INFO stats\`
- Flush all data: \`docker exec fnkit-cache valkey-cli FLUSHALL\`
`

export interface CacheOptions {
  output?: string
  maxmemory?: string
}

export async function cacheInit(options: CacheOptions = {}): Promise<boolean> {
  const outputDir = options.output || CACHE_DIR
  const targetDir = resolve(process.cwd(), outputDir)

  logger.title('Creating FnKit Cache (Valkey)')

  if (existsSync(targetDir)) {
    logger.error(`Directory already exists: ${outputDir}`)
    return false
  }

  // Create directory
  mkdirSync(targetDir, { recursive: true })

  // Write files
  const files: Record<string, string> = {
    'docker-compose.yml': CACHE_DOCKER_COMPOSE.trim(),
    'README.md': CACHE_README.trim(),
  }

  for (const [filename, content] of Object.entries(files)) {
    const filePath = join(targetDir, filename)
    writeFileSync(filePath, content)
    logger.success(`Created ${filename}`)
  }

  logger.newline()
  logger.success(`Cache created in ${outputDir}/`)
  logger.newline()

  console.log(
    '╔════════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║               ⚡ Cache Setup Steps                            ║',
  )
  console.log(
    '╚════════════════════════════════════════════════════════════════╝',
  )
  console.log('')
  console.log('   1. Ensure the Docker network exists:')
  console.log('      docker network create fnkit-network 2>/dev/null || true')
  console.log('')
  console.log('   2. Start the cache:')
  console.log(`      cd ${outputDir} && docker compose up -d`)
  console.log('')
  console.log('   3. Verify:')
  console.log('      docker exec fnkit-cache valkey-cli ping')
  console.log('      → PONG')
  console.log('')
  console.log('   4. Connect from functions using:')
  console.log('      CACHE_URL=redis://fnkit-cache:6379')
  console.log('')
  console.log('   Architecture:')
  console.log('   Functions → fnkit-cache:6379 (Valkey, sub-ms latency)')
  console.log('')

  return true
}

export async function cacheStart(options: CacheOptions = {}): Promise<boolean> {
  logger.title('Starting FnKit Cache')

  // Check Docker
  if (
    !(await docker.isDockerAvailable()) ||
    !(await docker.isDockerRunning())
  ) {
    logger.error('Docker is not available')
    return false
  }

  // Create network if needed
  const { exec } = await import('../utils/shell')
  await exec('docker', ['network', 'create', FNKIT_NETWORK])

  // Stop existing container if running
  await exec('docker', ['rm', '-f', CACHE_CONTAINER])

  // Build the run args
  const maxmemory = options.maxmemory || '256mb'
  const args = [
    'run',
    '-d',
    '--name',
    CACHE_CONTAINER,
    '--network',
    FNKIT_NETWORK,
    '--label',
    'fnkit.cache=true',
    '--restart',
    'unless-stopped',
    '-v',
    'fnkit-cache-data:/data',
    CACHE_IMAGE,
    'valkey-server',
    '--save',
    '60',
    '1',
    '--loglevel',
    'warning',
    '--maxmemory',
    maxmemory,
    '--maxmemory-policy',
    'volatile-lru',
  ]

  const result = await exec('docker', args)

  if (result.success) {
    logger.success('Cache started: redis://fnkit-cache:6379')
    logger.newline()
    logger.info('Functions can connect using:')
    logger.dim('  CACHE_URL=redis://fnkit-cache:6379')
    logger.newline()
    logger.info('Test with:')
    logger.dim('  docker exec fnkit-cache valkey-cli ping')
    logger.newline()
    return true
  } else {
    logger.error('Failed to start cache')
    logger.dim(result.stderr)
    return false
  }
}

export async function cacheStop(): Promise<boolean> {
  logger.title('Stopping FnKit Cache')

  const { exec } = await import('../utils/shell')
  const result = await exec('docker', ['rm', '-f', CACHE_CONTAINER])

  if (result.success) {
    logger.success('Cache stopped')
    logger.info('Data persists in the fnkit-cache-data volume')
    logger.dim('  To remove data: docker volume rm fnkit-cache-data')
    return true
  } else {
    logger.error('Failed to stop cache (may not be running)')
    return false
  }
}

export async function cache(
  subcommand: string,
  options: CacheOptions = {},
): Promise<boolean> {
  switch (subcommand) {
    case 'init':
      return cacheInit(options)
    case 'start':
      return cacheStart(options)
    case 'stop':
      return cacheStop()
    default:
      logger.error(`Unknown cache command: ${subcommand}`)
      logger.info('Available commands: init, start, stop')
      logger.newline()
      logger.dim('  fnkit cache init     — Create cache project files (Valkey)')
      logger.dim('  fnkit cache start    — Start the cache container')
      logger.dim('  fnkit cache stop     — Stop the cache container')
      return false
  }
}

export default cache
