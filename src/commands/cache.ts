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
  pattern?: string
  key?: string
  name?: string
  value?: string
  confirm?: boolean
}

// ── Valkey CLI helpers ───────────────────────────────────────────────

async function valkeyCmd(...args: string[]): Promise<string | null> {
  const { exec } = await import('../utils/shell')
  const result = await exec('docker', [
    'exec',
    CACHE_CONTAINER,
    'valkey-cli',
    ...args,
  ])
  if (!result.success) return null
  return result.stdout.trim()
}

async function valkeyKeys(pattern: string): Promise<string[]> {
  const raw = await valkeyCmd('KEYS', pattern)
  if (!raw) return []
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

async function valkeyGet(key: string): Promise<string | null> {
  return valkeyCmd('GET', key)
}

async function valkeyType(key: string): Promise<string | null> {
  return valkeyCmd('TYPE', key)
}

function parseJSON(raw: string): any {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function prettyValue(raw: string): string {
  const parsed = parseJSON(raw)
  if (parsed !== null) {
    return JSON.stringify(parsed, null, 2)
  }
  return raw
}

async function ensureCacheRunning(): Promise<boolean> {
  const { exec } = await import('../utils/shell')
  if (
    !(await docker.isDockerAvailable()) ||
    !(await docker.isDockerRunning())
  ) {
    logger.error('Docker is not available')
    return false
  }

  const result = await exec('docker', [
    'ps',
    '--filter',
    `name=^${CACHE_CONTAINER}$`,
    '--filter',
    'status=running',
    '--format',
    '{{.Names}}',
  ])

  if (!result.success || result.stdout.trim() !== CACHE_CONTAINER) {
    logger.error('fnkit-cache is not running')
    logger.dim('  Start it with: fnkit cache start')
    return false
  }

  return true
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

// ── View: list keys ──────────────────────────────────────────────────

export async function cacheView(
  pattern?: string,
): Promise<boolean> {
  if (!(await ensureCacheRunning())) return false

  const searchPattern = pattern || '*'
  const keys = await valkeyKeys(searchPattern)

  if (keys.length === 0) {
    logger.info(
      pattern
        ? `No keys matching "${pattern}"`
        : 'Cache is empty',
    )
    return true
  }

  // Group keys by namespace prefix
  const groups: Record<string, string[]> = {}
  for (const key of keys.sort()) {
    const prefix = key.includes(':')
      ? key.split(':').slice(0, key.startsWith('fnkit:') || key.startsWith('uns:') ? 2 : 1).join(':')
      : '(other)'
    if (!groups[prefix]) groups[prefix] = []
    groups[prefix].push(key)
  }

  logger.title('Cache Keys')

  const dbsize = await valkeyCmd('DBSIZE')
  if (dbsize) {
    const match = dbsize.match(/(\d+)/)
    if (match) {
      logger.info(
        pattern
          ? `${keys.length} key${keys.length !== 1 ? 's' : ''} matching "${pattern}" (${match[1]} total)`
          : `${match[1]} key${match[1] !== '1' ? 's' : ''} total`,
      )
    }
  }
  logger.newline()

  for (const [prefix, groupKeys] of Object.entries(groups).sort()) {
    console.log(`   ${prefix}  (${groupKeys.length})`)
    console.log('   ' + '─'.repeat(56))
    for (const key of groupKeys) {
      const type = await valkeyType(key)
      const typeLabel = type && type !== 'string' ? `  [${type}]` : ''
      console.log(`     ${key}${typeLabel}`)
    }
    console.log('')
  }

  return true
}

// ── Get: show value of a key ─────────────────────────────────────────

export async function cacheGet(key: string): Promise<boolean> {
  if (!(await ensureCacheRunning())) return false

  const type = await valkeyType(key)
  if (!type || type === 'none') {
    logger.error(`Key not found: ${key}`)
    return false
  }

  logger.title(`Key: ${key}`)
  logger.dim(`  Type: ${type}`)
  logger.newline()

  switch (type) {
    case 'string': {
      const val = await valkeyGet(key)
      if (val !== null) {
        console.log(prettyValue(val))
      } else {
        logger.dim('  (empty)')
      }
      break
    }

    case 'list': {
      const len = await valkeyCmd('LLEN', key)
      logger.info(`Length: ${len || 0}`)
      logger.newline()
      const items = await valkeyCmd('LRANGE', key, '0', '49')
      if (items) {
        const lines = items.split('\n').filter(Boolean)
        for (let i = 0; i < lines.length; i++) {
          const display = prettyValue(lines[i])
          if (display.includes('\n')) {
            console.log(`   [${i}]:`)
            for (const line of display.split('\n')) {
              console.log(`     ${line}`)
            }
          } else {
            console.log(`   [${i}]: ${display}`)
          }
        }
        if (len && parseInt(len) > 50) {
          logger.dim(`\n   ... and ${parseInt(len) - 50} more`)
        }
      }
      break
    }

    case 'set': {
      const count = await valkeyCmd('SCARD', key)
      logger.info(`Members: ${count || 0}`)
      logger.newline()
      const members = await valkeyCmd('SMEMBERS', key)
      if (members) {
        const lines = members.split('\n').filter(Boolean).sort()
        for (const member of lines) {
          console.log(`   • ${member}`)
        }
      }
      break
    }

    case 'hash': {
      const len = await valkeyCmd('HLEN', key)
      logger.info(`Fields: ${len || 0}`)
      logger.newline()
      const raw = await valkeyCmd('HGETALL', key)
      if (raw) {
        const lines = raw.split('\n').filter(Boolean)
        for (let i = 0; i < lines.length; i += 2) {
          const field = lines[i]
          const value = lines[i + 1] || ''
          console.log(`   ${field}: ${prettyValue(value)}`)
        }
      }
      break
    }

    case 'zset': {
      const count = await valkeyCmd('ZCARD', key)
      logger.info(`Members: ${count || 0}`)
      logger.newline()
      const raw = await valkeyCmd('ZRANGE', key, '0', '49', 'WITHSCORES')
      if (raw) {
        const lines = raw.split('\n').filter(Boolean)
        for (let i = 0; i < lines.length; i += 2) {
          const member = lines[i]
          const score = lines[i + 1] || '0'
          console.log(`   ${member}  (score: ${score})`)
        }
        if (count && parseInt(count) > 50) {
          logger.dim(`\n   ... and ${parseInt(count) - 50} more`)
        }
      }
      break
    }

    default:
      logger.warn(`Unsupported type: ${type}`)
      return false
  }

  // Show TTL
  const ttl = await valkeyCmd('TTL', key)
  if (ttl && ttl !== '-1' && ttl !== '-2') {
    logger.newline()
    logger.dim(`  TTL: ${ttl}s`)
  }

  logger.newline()
  return true
}

// ── Config: manage fnkit:config:* keys ───────────────────────────────

export async function cacheConfigLs(): Promise<boolean> {
  if (!(await ensureCacheRunning())) return false

  const keys = await valkeyKeys('fnkit:config:*')

  logger.title('Function Configs')

  if (keys.length === 0) {
    logger.info('No configs found')
    logger.newline()
    logger.dim('  Set a config with:')
    logger.dim('    fnkit cache config set <name> \'{"key":"value"}\'')
    logger.newline()
    return true
  }

  logger.info(`${keys.length} config${keys.length !== 1 ? 's' : ''} found`)
  logger.newline()

  for (const key of keys.sort()) {
    const name = key.replace('fnkit:config:', '')
    const raw = await valkeyGet(key)

    console.log(`   ${name}`)
    console.log('   ' + '─'.repeat(56))
    if (raw) {
      const lines = prettyValue(raw).split('\n')
      for (const line of lines) {
        console.log(`     ${line}`)
      }
    } else {
      console.log('     (empty)')
    }
    console.log('')
  }

  return true
}

export async function cacheConfigGet(name: string): Promise<boolean> {
  if (!(await ensureCacheRunning())) return false

  const key = `fnkit:config:${name}`
  const raw = await valkeyGet(key)

  if (raw === null) {
    logger.error(`Config not found: ${name}`)
    logger.dim(`  Key: ${key}`)
    logger.newline()
    logger.dim('  Set it with:')
    logger.dim(`    fnkit cache config set ${name} '{"key":"value"}'`)
    return false
  }

  logger.title(`Config: ${name}`)
  logger.dim(`  Key: ${key}`)
  logger.newline()
  console.log(prettyValue(raw))
  logger.newline()

  return true
}

export async function cacheConfigSet(
  name: string,
  value: string,
): Promise<boolean> {
  if (!(await ensureCacheRunning())) return false

  // Validate JSON
  const parsed = parseJSON(value)
  if (parsed === null) {
    logger.error('Invalid JSON value')
    logger.dim('  Value must be valid JSON, e.g.:')
    logger.dim(`    fnkit cache config set ${name} '{"table":"uns_log","topics":["v1.0/..."]}'`)
    return false
  }

  const key = `fnkit:config:${name}`
  const result = await valkeyCmd('SET', key, value)

  if (result === 'OK') {
    logger.success(`Config set: ${name}`)
    logger.dim(`  Key: ${key}`)
    logger.newline()
    console.log(prettyValue(value))
    logger.newline()
    return true
  }

  logger.error(`Failed to set config: ${name}`)
  return false
}

export async function cacheConfigRemove(name: string): Promise<boolean> {
  if (!(await ensureCacheRunning())) return false

  const key = `fnkit:config:${name}`

  // Check it exists first
  const existing = await valkeyGet(key)
  if (existing === null) {
    logger.error(`Config not found: ${name}`)
    return false
  }

  const result = await valkeyCmd('DEL', key)

  if (result && parseInt(result) > 0) {
    logger.success(`Config removed: ${name}`)
    logger.dim(`  Key: ${key}`)
    return true
  }

  logger.error(`Failed to remove config: ${name}`)
  return false
}

// ── Remove: delete a key ─────────────────────────────────────────────

export async function cacheRemove(key: string): Promise<boolean> {
  if (!(await ensureCacheRunning())) return false

  // Check it exists
  const type = await valkeyType(key)
  if (!type || type === 'none') {
    logger.error(`Key not found: ${key}`)
    return false
  }

  const result = await valkeyCmd('DEL', key)

  if (result && parseInt(result) > 0) {
    logger.success(`Removed: ${key}`)
    return true
  }

  logger.error(`Failed to remove: ${key}`)
  return false
}

// ── Flush: clear all data ────────────────────────────────────────────

export async function cacheFlush(): Promise<boolean> {
  if (!(await ensureCacheRunning())) return false

  // Show what will be deleted
  const dbsize = await valkeyCmd('DBSIZE')
  const match = dbsize?.match(/(\d+)/)
  const keyCount = match ? match[1] : '?'

  logger.warn(`This will delete ALL ${keyCount} keys from the cache!`)
  logger.newline()

  const result = await valkeyCmd('FLUSHALL')

  if (result === 'OK') {
    logger.success('Cache flushed — all data removed')
    return true
  }

  logger.error('Failed to flush cache')
  return false
}

// ── Stats: show cache statistics ─────────────────────────────────────

export async function cacheStats(): Promise<boolean> {
  if (!(await ensureCacheRunning())) return false

  logger.title('Cache Statistics')

  // Key count
  const dbsize = await valkeyCmd('DBSIZE')
  const keyMatch = dbsize?.match(/(\d+)/)

  // Memory info
  const memInfo = await valkeyCmd('INFO', 'memory')
  const statsInfo = await valkeyCmd('INFO', 'stats')
  const serverInfo = await valkeyCmd('INFO', 'server')
  const clientsInfo = await valkeyCmd('INFO', 'clients')

  // ── General ────────────────────────────────────────────────────────
  console.log('   General')
  console.log('   ' + '─'.repeat(50))

  if (keyMatch) console.log(`   Keys:                ${keyMatch[1]}`)

  if (serverInfo) {
    const uptimeMatch = serverInfo.match(/uptime_in_seconds:(\d+)/)
    if (uptimeMatch) {
      const secs = parseInt(uptimeMatch[1])
      const days = Math.floor(secs / 86400)
      const hours = Math.floor((secs % 86400) / 3600)
      const mins = Math.floor((secs % 3600) / 60)
      const parts: string[] = []
      if (days > 0) parts.push(`${days}d`)
      if (hours > 0) parts.push(`${hours}h`)
      parts.push(`${mins}m`)
      console.log(`   Uptime:              ${parts.join(' ')}`)
    }
    const versionMatch = serverInfo.match(/(?:valkey|redis)_version:(.+)/)
    if (versionMatch) console.log(`   Version:             ${versionMatch[1].trim()}`)
  }

  if (clientsInfo) {
    const connMatch = clientsInfo.match(/connected_clients:(\d+)/)
    if (connMatch) console.log(`   Connected clients:   ${connMatch[1]}`)
  }

  console.log('')

  // ── Memory ─────────────────────────────────────────────────────────
  console.log('   Memory')
  console.log('   ' + '─'.repeat(50))

  if (memInfo) {
    const usedMatch = memInfo.match(/used_memory_human:(.+)/)
    if (usedMatch) console.log(`   Used:                ${usedMatch[1].trim()}`)
    const peakMatch = memInfo.match(/used_memory_peak_human:(.+)/)
    if (peakMatch) console.log(`   Peak:                ${peakMatch[1].trim()}`)
    const maxMatch = memInfo.match(/maxmemory_human:(.+)/)
    if (maxMatch) console.log(`   Max:                 ${maxMatch[1].trim()}`)
    const policyMatch = memInfo.match(/maxmemory_policy:(.+)/)
    if (policyMatch) console.log(`   Eviction policy:     ${policyMatch[1].trim()}`)
    const fragMatch = memInfo.match(/mem_fragmentation_ratio:(.+)/)
    if (fragMatch) console.log(`   Fragmentation ratio: ${fragMatch[1].trim()}`)
  }

  console.log('')

  // ── Performance ────────────────────────────────────────────────────
  console.log('   Performance')
  console.log('   ' + '─'.repeat(50))

  if (statsInfo) {
    const cmdMatch = statsInfo.match(/total_commands_processed:(\d+)/)
    if (cmdMatch) console.log(`   Commands processed:  ${parseInt(cmdMatch[1]).toLocaleString()}`)
    const connMatch = statsInfo.match(/total_connections_received:(\d+)/)
    if (connMatch) console.log(`   Connections total:   ${parseInt(connMatch[1]).toLocaleString()}`)
    const hitMatch = statsInfo.match(/keyspace_hits:(\d+)/)
    const missMatch = statsInfo.match(/keyspace_misses:(\d+)/)
    if (hitMatch) console.log(`   Cache hits:          ${parseInt(hitMatch[1]).toLocaleString()}`)
    if (missMatch) console.log(`   Cache misses:        ${parseInt(missMatch[1]).toLocaleString()}`)
    if (hitMatch && missMatch) {
      const hits = parseInt(hitMatch[1])
      const misses = parseInt(missMatch[1])
      const total = hits + misses
      if (total > 0) {
        const ratio = ((hits / total) * 100).toFixed(1)
        console.log(`   Hit ratio:           ${ratio}%`)
      }
    }
    const evictMatch = statsInfo.match(/evicted_keys:(\d+)/)
    if (evictMatch) console.log(`   Evicted keys:        ${parseInt(evictMatch[1]).toLocaleString()}`)
    const expMatch = statsInfo.match(/expired_keys:(\d+)/)
    if (expMatch) console.log(`   Expired keys:        ${parseInt(expMatch[1]).toLocaleString()}`)
  }

  console.log('')

  // ── Key Namespaces ─────────────────────────────────────────────────
  const allKeys = await valkeyKeys('*')
  if (allKeys.length > 0) {
    const groups: Record<string, number> = {}
    for (const key of allKeys) {
      const prefix = key.includes(':')
        ? key.split(':').slice(0, key.startsWith('fnkit:') || key.startsWith('uns:') ? 2 : 1).join(':')
        : '(other)'
      groups[prefix] = (groups[prefix] || 0) + 1
    }

    console.log('   Key Namespaces')
    console.log('   ' + '─'.repeat(50))
    for (const [prefix, count] of Object.entries(groups).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${prefix.padEnd(30)} ${count}`)
    }
    console.log('')
  }

  return true
}

// ── Existing commands ────────────────────────────────────────────────

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
  positionalArgs: string[] = [],
): Promise<boolean> {
  switch (subcommand) {
    case 'init':
      return cacheInit(options)
    case 'start':
      return cacheStart(options)
    case 'stop':
      return cacheStop()

    // ── Observe / Admin commands ───────────────────────────────────────
    case 'view':
      return cacheView(positionalArgs[0])
    case 'get':
      if (!positionalArgs[0]) {
        logger.error('Usage: fnkit cache get <key>')
        return false
      }
      return cacheGet(positionalArgs[0])
    case 'remove':
    case 'rm':
      if (!positionalArgs[0]) {
        logger.error('Usage: fnkit cache remove <key>')
        return false
      }
      return cacheRemove(positionalArgs[0])
    case 'flush':
      return cacheFlush()
    case 'stats':
      return cacheStats()

    // ── Config sub-subcommands ─────────────────────────────────────────
    case 'config': {
      const configSubcmd = positionalArgs[0]
      if (!configSubcmd) {
        // Default to listing configs
        return cacheConfigLs()
      }
      switch (configSubcmd) {
        case 'ls':
        case 'list':
          return cacheConfigLs()
        case 'get':
        case 'view':
          if (!positionalArgs[1]) {
            logger.error('Usage: fnkit cache config get <name>')
            return false
          }
          return cacheConfigGet(positionalArgs[1])
        case 'set':
          if (!positionalArgs[1] || !positionalArgs[2]) {
            logger.error("Usage: fnkit cache config set <name> '<json>'")
            return false
          }
          return cacheConfigSet(positionalArgs[1], positionalArgs[2])
        case 'remove':
        case 'rm':
          if (!positionalArgs[1]) {
            logger.error('Usage: fnkit cache config remove <name>')
            return false
          }
          return cacheConfigRemove(positionalArgs[1])
        default:
          logger.error(`Unknown config command: ${configSubcmd}`)
          logger.info('Available: ls, get, set, remove')
          return false
      }
    }

    default:
      logger.error(`Unknown cache command: ${subcommand}`)
      logger.info('Available commands: init, start, stop, view, get, remove, flush, stats, config')
      logger.newline()
      logger.dim('  fnkit cache init                — Create cache project files')
      logger.dim('  fnkit cache start               — Start the cache container')
      logger.dim('  fnkit cache stop                — Stop the cache container')
      logger.dim('  fnkit cache view [pattern]      — List keys (grouped by namespace)')
      logger.dim('  fnkit cache get <key>           — Show value of a key')
      logger.dim('  fnkit cache remove <key>        — Delete a key')
      logger.dim('  fnkit cache flush               — Delete ALL keys')
      logger.dim('  fnkit cache stats               — Show cache statistics')
      logger.dim('  fnkit cache config              — Manage function configs')
      return false
  }
}

export default cache
