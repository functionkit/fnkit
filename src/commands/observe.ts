// Observe command — Node-RED-level observability for fnkit
// Provides: fnkit observe [status|events|traces|metrics]
// Reads observability data from the gateway's Valkey-backed trace store

import logger from '../utils/logger'
import { exec } from '../utils/shell'
import {
  isDockerAvailable,
  isDockerRunning,
  listContainers,
} from '../utils/docker'

const CACHE_CONTAINER = 'fnkit-cache'
const GATEWAY_CONTAINER = 'fnkit-gateway'

// ── Helpers ──────────────────────────────────────────────────────────

async function valkeyCmd(...args: string[]): Promise<string | null> {
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

async function valkeyLRange(
  key: string,
  start: number,
  stop: number,
): Promise<string[]> {
  const raw = await valkeyCmd('LRANGE', key, String(start), String(stop))
  if (!raw) return []
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

async function valkeyZRevRange(
  key: string,
  start: number,
  stop: number,
): Promise<string[]> {
  const raw = await valkeyCmd(
    'ZREVRANGE',
    key,
    String(start),
    String(stop),
  )
  if (!raw) return []
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

function parseJSON(raw: string): any {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  if (diff < 0) return 'just now'
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function shortTime(isoDate: string): string {
  try {
    const d = new Date(isoDate)
    return d.toLocaleTimeString('en-GB', { hour12: false })
  } catch {
    return isoDate
  }
}

function truncate(str: string, len: number): string {
  if (str.length <= len) return str
  return str.slice(0, len - 1) + '…'
}

const statusIcons: Record<string, string> = {
  online: '🟢',
  connected: '🟢',
  running: '🟢',
  healthy: '🟢',
  offline: '⚫',
  stopped: '⚫',
  error: '🔴',
  warning: '🟡',
  reconnecting: '🟡',
  degraded: '🟡',
}

const eventIcons: Record<string, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  error: '✗',
  trace: '→',
}

// ── Status ───────────────────────────────────────────────────────────

async function showStatus(): Promise<boolean> {
  console.log(
    '╔════════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║                    📊 FnKit Observability                     ║',
  )
  console.log(
    '╚════════════════════════════════════════════════════════════════╝',
  )
  console.log('')

  // ── Component Health ───────────────────────────────────────────────
  console.log('   Components')
  console.log('   ' + '─'.repeat(58))

  // Get all containers on fnkit-network
  const allContainers = await listContainers()
  const infraContainers = await listContainers('fnkit.gateway=true')
  const cacheContainers = await listContainers('fnkit.cache=true')

  // Merge all known containers
  const allKnown = [
    ...allContainers,
    ...infraContainers,
    ...cacheContainers,
  ]
  const seen = new Set<string>()
  const unique = allKnown.filter((c) => {
    if (seen.has(c.name)) return false
    seen.add(c.name)
    return true
  })

  // Also check for non-labelled but known containers
  const knownNames = [
    'fnkit-gateway',
    'fnkit-cache',
    'opcua-bridge',
    'uns-framework',
    'uns-cache',
    'uns-log',
  ]
  for (const name of knownNames) {
    if (!seen.has(name)) {
      const result = await exec('docker', [
        'ps',
        '-a',
        '--filter',
        `name=^${name}$`,
        '--format',
        '{{.Names}}\t{{.Status}}\t{{.State}}\t{{.Image}}',
      ])
      if (result.success && result.stdout.trim()) {
        const [cName, cStatus, cState, cImage] = result.stdout
          .trim()
          .split('\t')
        if (cName) {
          unique.push({
            id: '',
            name: cName,
            status: cStatus || '',
            state: cState || '',
            image: cImage || '',
            created: '',
            ports: '',
            labels: {},
          })
          seen.add(cName)
        }
      }
    }
  }

  if (unique.length === 0) {
    console.log('   No fnkit components found.')
    console.log('')
    return true
  }

  // Get metrics from Valkey for each container
  for (const container of unique) {
    const isRunning = container.state === 'running'
    const icon = isRunning ? '🟢' : '⚫'
    const stateText = isRunning ? 'running' : 'stopped'

    // Try to get extra info from Valkey metrics
    let extra = ''
    const metricsRaw = await valkeyGet(`fnkit:metrics:${container.name}`)
    if (metricsRaw) {
      const metrics = parseJSON(metricsRaw)
      if (metrics) {
        const parts: string[] = []
        if (metrics.requests !== undefined)
          parts.push(`reqs: ${metrics.requests}`)
        if (metrics.errors !== undefined)
          parts.push(`errs: ${metrics.errors}`)
        if (metrics.last_active) parts.push(timeAgo(metrics.last_active))
        if (metrics.status && metrics.status !== stateText)
          parts.push(metrics.status)
        if (metrics.topics !== undefined)
          parts.push(`topics: ${metrics.topics}`)
        if (metrics.rows !== undefined) parts.push(`rows: ${metrics.rows}`)
        if (metrics.keys !== undefined) parts.push(`keys: ${metrics.keys}`)
        if (parts.length > 0) extra = `  ${parts.join('  ')}`
      }
    }

    // For fnkit-cache, get key count
    if (container.name === 'fnkit-cache' && isRunning) {
      const dbsize = await valkeyCmd('DBSIZE')
      if (dbsize) {
        const match = dbsize.match(/(\d+)/)
        if (match) extra = `  keys: ${match[1]}`
      }
    }

    console.log(
      `   ${icon} ${container.name.padEnd(22)} ${stateText.padEnd(10)}${extra}`,
    )
  }

  console.log('')

  // ── Recent Events ──────────────────────────────────────────────────
  const events = await valkeyLRange('fnkit:events', 0, 9)
  if (events.length > 0) {
    console.log('   Recent Events')
    console.log('   ' + '─'.repeat(58))

    for (const raw of events) {
      const evt = parseJSON(raw)
      if (!evt) continue

      const time = evt.timestamp ? shortTime(evt.timestamp) : '??:??:??'
      const level = evt.level || 'info'
      const icon = eventIcons[level] || 'ℹ'
      const source = (evt.source || 'unknown').padEnd(18)
      const message = truncate(evt.message || '', 40)

      console.log(`   ${time}  ${icon}  ${source} ${message}`)
    }
    console.log('')
  }

  // ── Recent Traces ──────────────────────────────────────────────────
  const traces = await valkeyLRange('fnkit:traces', 0, 4)
  if (traces.length > 0) {
    console.log('   Recent Traces')
    console.log('   ' + '─'.repeat(58))

    for (const raw of traces) {
      const trace = parseJSON(raw)
      if (!trace) continue

      const time = trace.timestamp ? shortTime(trace.timestamp) : '??:??:??'
      const method = (trace.method || 'GET').padEnd(5)
      const path = truncate(trace.path || '/', 22).padEnd(22)
      const status = String(trace.status || '???')
      const latency = trace.latency_ms
        ? `${trace.latency_ms}ms`
        : ''
      const preview = trace.preview
        ? truncate(trace.preview, 20)
        : ''

      console.log(
        `   ${time}  ${method} ${path} ${status}  ${latency.padEnd(8)} ${preview}`,
      )
    }
    console.log('')
  }

  // If no events or traces, show hint
  if (events.length === 0 && traces.length === 0) {
    console.log('   No events or traces recorded yet.')
    console.log('')
    console.log('   The gateway records observability data automatically.')
    console.log(
      '   Rebuild the gateway after updating to enable tracing:',
    )
    console.log('     fnkit gateway build && fnkit gateway start --token <token>')
    console.log('')
  }

  return true
}

// ── Events ───────────────────────────────────────────────────────────

async function showEvents(count: number = 50): Promise<boolean> {
  logger.title('FnKit Events')

  const events = await valkeyLRange('fnkit:events', 0, count - 1)

  if (events.length === 0) {
    logger.info('No events recorded yet')
    logger.newline()
    logger.dim(
      '  Events are recorded by the gateway for connections, errors, and status changes.',
    )
    logger.dim(
      '  Rebuild the gateway to enable: fnkit gateway build && fnkit gateway start',
    )
    logger.newline()
    return true
  }

  console.log('')
  console.log(
    `   ${'TIME'.padEnd(10)} ${'LEVEL'.padEnd(8)} ${'SOURCE'.padEnd(20)} MESSAGE`,
  )
  console.log('   ' + '─'.repeat(70))

  for (const raw of events) {
    const evt = parseJSON(raw)
    if (!evt) continue

    const time = evt.timestamp ? shortTime(evt.timestamp) : '??:??:??'
    const level = (evt.level || 'info').padEnd(8)
    const icon = eventIcons[evt.level] || 'ℹ'
    const source = (evt.source || 'unknown').padEnd(20)
    const message = evt.message || ''
    const detail = evt.detail ? `  (${truncate(evt.detail, 40)})` : ''

    console.log(`   ${time.padEnd(10)} ${icon} ${level} ${source} ${message}${detail}`)
  }

  console.log('')
  logger.info(`${events.length} event${events.length !== 1 ? 's' : ''} shown`)
  console.log('')

  return true
}

// ── Traces ───────────────────────────────────────────────────────────

async function showTraces(count: number = 50): Promise<boolean> {
  logger.title('FnKit Request Traces')

  const traces = await valkeyLRange('fnkit:traces', 0, count - 1)

  if (traces.length === 0) {
    logger.info('No traces recorded yet')
    logger.newline()
    logger.dim(
      '  Traces are recorded for every request through the gateway.',
    )
    logger.dim(
      '  Rebuild the gateway to enable: fnkit gateway build && fnkit gateway start',
    )
    logger.newline()
    return true
  }

  console.log('')
  console.log(
    `   ${'TIME'.padEnd(10)} ${'METHOD'.padEnd(7)} ${'PATH'.padEnd(28)} ${'STATUS'.padEnd(7)} ${'LATENCY'.padEnd(10)} PREVIEW`,
  )
  console.log('   ' + '─'.repeat(80))

  for (const raw of traces) {
    const trace = parseJSON(raw)
    if (!trace) continue

    const time = trace.timestamp ? shortTime(trace.timestamp) : '??:??:??'
    const method = (trace.method || '?').padEnd(7)
    const path = truncate(trace.path || '/', 26).padEnd(28)
    const status = String(trace.status || '???').padEnd(7)
    const latency = trace.latency_ms
      ? `${trace.latency_ms}ms`.padEnd(10)
      : '?'.padEnd(10)
    const preview = trace.preview ? truncate(trace.preview, 30) : ''

    // Color status codes
    const statusNum = parseInt(String(trace.status))
    let statusDisplay = status
    if (statusNum >= 500) statusDisplay = `\x1b[31m${status}\x1b[0m`
    else if (statusNum >= 400) statusDisplay = `\x1b[33m${status}\x1b[0m`
    else if (statusNum >= 200 && statusNum < 300)
      statusDisplay = `\x1b[32m${status}\x1b[0m`

    console.log(
      `   ${time.padEnd(10)} ${method} ${path} ${statusDisplay} ${latency} ${preview}`,
    )
  }

  console.log('')
  logger.info(
    `${traces.length} trace${traces.length !== 1 ? 's' : ''} shown`,
  )
  console.log('')

  return true
}

// ── Metrics ──────────────────────────────────────────────────────────

async function showMetrics(): Promise<boolean> {
  logger.title('FnKit Metrics')

  // Get all metric keys
  const metricKeys = await valkeyKeys('fnkit:metrics:*')

  if (metricKeys.length === 0) {
    // Fall back to showing basic cache stats
    const dbsize = await valkeyCmd('DBSIZE')
    const info = await valkeyCmd('INFO', 'stats')

    console.log('')
    console.log('   Cache Stats')
    console.log('   ' + '─'.repeat(40))

    if (dbsize) {
      const match = dbsize.match(/(\d+)/)
      if (match) console.log(`   Keys:              ${match[1]}`)
    }

    if (info) {
      const cmdMatch = info.match(/total_commands_processed:(\d+)/)
      if (cmdMatch) console.log(`   Commands:          ${cmdMatch[1]}`)
      const connMatch = info.match(/total_connections_received:(\d+)/)
      if (connMatch) console.log(`   Connections:       ${connMatch[1]}`)
      const hitMatch = info.match(/keyspace_hits:(\d+)/)
      if (hitMatch) console.log(`   Cache hits:        ${hitMatch[1]}`)
      const missMatch = info.match(/keyspace_misses:(\d+)/)
      if (missMatch) console.log(`   Cache misses:      ${missMatch[1]}`)
    }

    // Show UNS topic count if available
    const topicCount = await valkeyCmd('SCARD', 'uns:topics')
    if (topicCount && topicCount !== '0') {
      console.log('')
      console.log('   UNS Stats')
      console.log('   ' + '─'.repeat(40))
      console.log(`   Discovered topics: ${topicCount}`)
    }

    // Show pipeline count
    const pipelines = await valkeyKeys('fnkit:pipeline:*')
    if (pipelines.length > 0) {
      console.log('')
      console.log('   Orchestrator')
      console.log('   ' + '─'.repeat(40))
      console.log(`   Pipelines:         ${pipelines.length}`)
    }

    console.log('')
    logger.dim(
      '  Per-container metrics are recorded by the gateway automatically.',
    )
    logger.dim(
      '  Rebuild the gateway to enable: fnkit gateway build && fnkit gateway start',
    )
    console.log('')
    return true
  }

  console.log('')
  console.log(
    `   ${'CONTAINER'.padEnd(24)} ${'REQUESTS'.padEnd(10)} ${'ERRORS'.padEnd(10)} ${'LAST ACTIVE'.padEnd(14)} STATUS`,
  )
  console.log('   ' + '─'.repeat(70))

  for (const key of metricKeys.sort()) {
    const raw = await valkeyGet(key)
    if (!raw) continue
    const metrics = parseJSON(raw)
    if (!metrics) continue

    const name = key.replace('fnkit:metrics:', '').padEnd(24)
    const requests = String(metrics.requests || 0).padEnd(10)
    const errors = String(metrics.errors || 0).padEnd(10)
    const lastActive = metrics.last_active
      ? timeAgo(metrics.last_active).padEnd(14)
      : 'never'.padEnd(14)
    const status = metrics.status || 'unknown'
    const icon = statusIcons[status] || '❓'

    console.log(`   ${name} ${requests} ${errors} ${lastActive} ${icon} ${status}`)
  }

  console.log('')

  // Also show cache stats
  const dbsize = await valkeyCmd('DBSIZE')
  if (dbsize) {
    const match = dbsize.match(/(\d+)/)
    if (match) {
      console.log(`   Cache keys: ${match[1]}`)
    }
  }

  const topicCount = await valkeyCmd('SCARD', 'uns:topics')
  if (topicCount && topicCount !== '0') {
    console.log(`   UNS topics: ${topicCount}`)
  }

  console.log('')

  return true
}

// ── Main Entry Point ─────────────────────────────────────────────────

export async function observe(
  subcommand?: string,
  options: Record<string, string | boolean> = {},
): Promise<boolean> {
  // Check Docker
  if (!(await isDockerAvailable())) {
    logger.error('Docker is not installed')
    return false
  }

  if (!(await isDockerRunning())) {
    logger.error('Docker is not running')
    return false
  }

  // Check cache is running (needed for observability data)
  const cacheCheck = await exec('docker', [
    'ps',
    '--filter',
    `name=^${CACHE_CONTAINER}$`,
    '--filter',
    'status=running',
    '--format',
    '{{.Names}}',
  ])

  const cacheRunning =
    cacheCheck.success && cacheCheck.stdout.trim() === CACHE_CONTAINER

  if (!cacheRunning && subcommand !== 'status') {
    logger.warn('fnkit-cache is not running — some data may be unavailable')
    logger.dim('  Start it with: fnkit cache start')
    logger.newline()
  }

  const count = options.count
    ? parseInt(options.count as string)
    : options.n
      ? parseInt(options.n as string)
      : 50

  switch (subcommand) {
    case 'status':
    case undefined:
    case '':
      return showStatus()
    case 'events':
    case 'event':
      return showEvents(count)
    case 'traces':
    case 'trace':
      return showTraces(count)
    case 'metrics':
    case 'metric':
      return showMetrics()
    default:
      logger.error(`Unknown observe command: ${subcommand}`)
      logger.info('Available: status, events, traces, metrics')
      return false
  }
}

export default observe
