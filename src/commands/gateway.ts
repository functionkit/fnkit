// Gateway command - create and manage the FnKit API Gateway

import {
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'fs'
import { dirname, join, resolve } from 'path'
import logger from '../utils/logger'
import * as docker from '../utils/docker'

const GATEWAY_DIR = 'fnkit-gateway'
const GATEWAY_IMAGE = 'fnkit-gateway:latest'
const GATEWAY_CONTAINER = 'fnkit-gateway'
const FNKIT_NETWORK = 'fnkit-network'
const CACHE_CONTAINER = 'fnkit-cache'

// Nginx configuration template with token auth and dynamic routing
// Uses envsubst to inject FNKIT_AUTH_TOKEN at container startup
const NGINX_CONF_TEMPLATE = `# FnKit Gateway - Nginx configuration with token authentication
# Routes requests to function containers on the fnkit-network
# FNKIT_AUTH_TOKEN and FNKIT_AUTH_ENABLED are injected via envsubst at container startup

worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Increase hash bucket size for long map strings (e.g. Bearer token)
    map_hash_bucket_size 128;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent"';

    access_log /var/log/nginx/access.log main;

    sendfile on;
    keepalive_timeout 65;

    # Resolver for Docker DNS (container names)
    resolver 127.0.0.11 valid=10s ipv6=off;

    # Map to validate the Authorization header against the expected token
    # FNKIT_AUTH_TOKEN is substituted by envsubst at startup
    map $http_authorization $auth_valid {
        default                         0;
        "Bearer \${FNKIT_AUTH_TOKEN}"    1;
    }

    # FNKIT_AUTH_ENABLED is set to "0" or "1" by start.sh (never empty)
    map \${FNKIT_AUTH_ENABLED} $auth_required {
        default 0;
        "1"     1;
    }

    server {
        listen 80;
        listen [::]:80;
        listen 8080;
        listen [::]:8080;
        server_name _;

        # Health check endpoint (no auth required)
        location = /health {
            default_type text/plain;
            return 200 'OK';
        }

        # List available info
        location = / {
            default_type application/json;
            return 200 '{"service": "fnkit-gateway", "usage": "GET /<container-name>[/path]"}';
        }

        # Observe endpoints (no auth — internal monitoring)
        location ^~ /observe {
            default_type application/json;

            proxy_pass http://127.0.0.1:3000;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Connection "";
            proxy_connect_timeout 5s;
            proxy_read_timeout 10s;
            proxy_send_timeout 10s;
        }

        # Orchestrate pipelines
        location ^~ /orchestrate/ {
            default_type application/json;

            # Check authentication (if token is configured)
            set $auth_check "$auth_required:$auth_valid";

            # If auth is required (1) and token is invalid (0), return 401
            if ($auth_check = "1:0") {
                return 401 '{"error": "Unauthorized - Invalid or missing Bearer token"}';
            }

            proxy_pass http://127.0.0.1:3000;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Connection "";
            proxy_connect_timeout 10s;
            proxy_read_timeout 60s;
            proxy_send_timeout 60s;

            # Handle upstream errors
            proxy_intercept_errors on;
            error_page 502 503 504 = @upstream_error;
        }

        # All other requests route to containers by name
        # URL: /<container-name>[/optional/path]
        location ~ ^/([a-zA-Z0-9_-]+)(.*)$ {
            set $container_name $1;
            set $container_path $2;

            # default_type must be at location level (not inside if)
            default_type application/json;

            # Check authentication (if token is configured)
            set $auth_check "$auth_required:$auth_valid";

            # If auth is required (1) and token is invalid (0), return 401
            if ($auth_check = "1:0") {
                return 401 '{"error": "Unauthorized - Invalid or missing Bearer token"}';
            }

            # Proxy to the container on the Docker network
            proxy_pass http://$container_name:8080$container_path$is_args$args;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Connection "";
            proxy_connect_timeout 10s;
            proxy_read_timeout 60s;
            proxy_send_timeout 60s;

            # Handle upstream errors
            proxy_intercept_errors on;
            error_page 502 503 504 = @upstream_error;
        }

        # Error handler for upstream failures
        location @upstream_error {
            default_type application/json;
            return 502 '{"error": "Function not found or not running", "container": "$container_name"}';
        }
    }
}
`

// Dockerfile for the gateway - pure nginx, no Go needed
const DOCKERFILE = `# FnKit Gateway - Nginx + Bun orchestrator
FROM oven/bun:alpine AS orchestrator

WORKDIR /app
COPY orchestrator/package.json ./
RUN bun install --production
COPY orchestrator/index.ts ./index.ts

FROM nginx:alpine

LABEL fnkit.gateway="true"

# Copy bun runtime from builder
COPY --from=orchestrator /usr/local/bin/bun /usr/local/bin/bun

# Copy orchestrator app
COPY --from=orchestrator /app /opt/orchestrator

# Copy nginx config template
COPY nginx.conf.template /etc/nginx/nginx.conf.template

# Copy startup script
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 8080

# Default to empty token (open mode)
ENV FNKIT_AUTH_TOKEN=""
ENV CACHE_URL="redis://fnkit-cache:6379"

CMD ["/start.sh"]
`

// Startup script - uses envsubst to inject token into nginx config
const START_SCRIPT = `#!/bin/sh
set -e

# Compute auth enabled flag (always "0" or "1", never empty)
if [ -z "$FNKIT_AUTH_TOKEN" ]; then
    export FNKIT_AUTH_ENABLED=0
    echo "FnKit Gateway starting in OPEN mode (no authentication)"
else
    export FNKIT_AUTH_ENABLED=1
    echo "FnKit Gateway starting with token authentication enabled"
fi

# Substitute environment variables into nginx config
# Only substitute these two to avoid breaking nginx variables like $host, $remote_addr etc.
envsubst '\${FNKIT_AUTH_TOKEN} \${FNKIT_AUTH_ENABLED}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

# Start orchestrator (Bun)
echo "Starting orchestrator on port 3000"
bun /opt/orchestrator/index.ts &

# Start nginx
exec nginx -g 'daemon off;'
`

// Docker compose for easy local testing
const DOCKER_COMPOSE = `version: '3.8'

services:
  gateway:
    build: .
    container_name: fnkit-gateway
    ports:
      - "8080:8080"
    environment:
      - FNKIT_AUTH_TOKEN=\${FNKIT_AUTH_TOKEN:-}
      - CACHE_URL=\${CACHE_URL:-redis://fnkit-cache:6379}
    networks:
      - fnkit-network
    restart: unless-stopped
    labels:
      - fnkit.gateway=true

networks:
  fnkit-network:
    name: fnkit-network
    external: true
`

const ORCHESTRATOR_PACKAGE_JSON = `{
  "name": "fnkit-orchestrator",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "ioredis": "^5.4.1"
  }
}
`

const ORCHESTRATOR_INDEX = `import Redis from 'ioredis'

// ── Observability: Valkey-backed tracing, events, metrics ────────────
// Stores traces, events, and per-container metrics in Valkey so the CLI
// can display Node-RED-level observability via "fnkit observe".
//
// Key layout:
//   fnkit:traces              LIST  — recent request traces (capped at 1000)
//   fnkit:events              LIST  — recent events/errors (capped at 1000)
//   fnkit:metrics:<container> STRING — per-container counters (JSON)
//   fnkit:observe:started     STRING — gateway start timestamp

type Pipeline = {
  mode: 'sequential' | 'parallel'
  steps: string[]
}

type Metrics = {
  requests: number
  errors: number
  last_active: string
  status: string
}

const PORT = 3000
const CACHE_TTL_MS = 30_000
const PIPELINE_PREFIX = 'fnkit:pipeline:'
const TRACE_KEY = 'fnkit:traces'
const EVENT_KEY = 'fnkit:events'
const METRICS_PREFIX = 'fnkit:metrics:'
const MAX_TRACES = 1000
const MAX_EVENTS = 1000

const CACHE_URL = process.env.CACHE_URL || 'redis://fnkit-cache:6379'

const redis = new Redis(CACHE_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy(times: number) {
    if (times > 5) return null
    return Math.min(times * 200, 2000)
  },
})

let redisConnected = false

redis.on('error', (err: Error) => {
  console.error('[orchestrator] Redis error:', err.message)
  redisConnected = false
})

redis.on('connect', () => {
  redisConnected = true
})

redis.connect().catch(() => {})

const cache = new Map<string, { pipeline: Pipeline; fetchedAt: number }>()

// ── Observability helpers ────────────────────────────────────────────

async function recordTrace(trace: {
  timestamp: string
  method: string
  path: string
  container: string
  status: number
  latency_ms: number
  preview: string
  trace_id: string
  error?: string
}) {
  if (!redisConnected) return
  try {
    const json = JSON.stringify(trace)
    await redis.lpush(TRACE_KEY, json)
    await redis.ltrim(TRACE_KEY, 0, MAX_TRACES - 1)
  } catch { /* best-effort */ }
}

async function recordEvent(event: {
  timestamp: string
  level: string
  source: string
  message: string
  detail?: string
}) {
  if (!redisConnected) return
  try {
    const json = JSON.stringify(event)
    await redis.lpush(EVENT_KEY, json)
    await redis.ltrim(EVENT_KEY, 0, MAX_EVENTS - 1)
  } catch { /* best-effort */ }
}

async function updateMetrics(container: string, statusCode: number) {
  if (!redisConnected) return
  try {
    const key = METRICS_PREFIX + container
    const raw = await redis.get(key)
    let metrics: Metrics = raw
      ? JSON.parse(raw)
      : { requests: 0, errors: 0, last_active: '', status: 'running' }

    metrics.requests++
    metrics.last_active = new Date().toISOString()
    if (statusCode >= 400) metrics.errors++
    metrics.status = statusCode >= 500 ? 'error' : 'running'

    await redis.set(key, JSON.stringify(metrics))
  } catch { /* best-effort */ }
}

function generateTraceId(): string {
  return Math.random().toString(36).substring(2, 10) +
    Math.random().toString(36).substring(2, 6)
}

function truncatePreview(text: string, maxLen = 120): string {
  if (!text) return ''
  const oneLine = text.replace(/\\n/g, ' ').trim()
  if (oneLine.length <= maxLen) return oneLine
  return oneLine.substring(0, maxLen - 1) + '…'
}

// Record gateway start event
async function recordStartEvent() {
  await recordEvent({
    timestamp: new Date().toISOString(),
    level: 'info',
    source: 'fnkit-gateway',
    message: 'Gateway started',
    detail: 'Orchestrator listening on port ' + PORT,
  })
  if (redisConnected) {
    await redis.set('fnkit:observe:started', new Date().toISOString())
  }
}

// ── Core functions ───────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function loadPipeline(name: string): Promise<Pipeline> {
  const cached = cache.get(name)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.pipeline
  }

  const raw = await redis.get(PIPELINE_PREFIX + name)
  if (!raw) {
    throw new Error('Pipeline not found: ' + name)
  }

  const pipeline = JSON.parse(raw) as Pipeline

  cache.set(name, { pipeline, fetchedAt: Date.now() })
  return pipeline
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || ''
  const text = await response.text()

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  return text
}

async function callFunction(
  step: string,
  path: string,
  query: string,
  method: string,
  body: string,
  contentType: string,
): Promise<Response> {
  const effectiveMethod = body.length ? 'POST' : method
  return await fetch('http://' + step + ':8080' + path + query, {
    method: effectiveMethod,
    headers: {
      'content-type': contentType,
      accept: 'application/json',
    },
    body: body.length ? body : undefined,
  })
}

async function handleSequential(
  pipeline: Pipeline,
  path: string,
  query: string,
  method: string,
  body: string,
  contentType: string,
  traceId: string,
): Promise<Response> {
  let currentBody = body
  let currentContentType = contentType
  let lastStatus = 200

  for (const step of pipeline.steps) {
    const stepStart = Date.now()
    let response: Response

    try {
      response = await callFunction(
        step,
        path,
        query,
        method,
        currentBody,
        currentContentType,
      )
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await recordTrace({
        timestamp: new Date().toISOString(),
        method,
        path: '/' + step + path,
        container: step,
        status: 502,
        latency_ms: Date.now() - stepStart,
        preview: errMsg,
        trace_id: traceId,
        error: errMsg,
      })
      await recordEvent({
        timestamp: new Date().toISOString(),
        level: 'error',
        source: step,
        message: 'Function call failed',
        detail: errMsg,
      })
      await updateMetrics(step, 502)
      return jsonResponse({ error: 'Step failed', step, detail: errMsg }, 502)
    }

    const stepLatency = Date.now() - stepStart

    if (!response.ok) {
      const errorText = await response.text()
      await recordTrace({
        timestamp: new Date().toISOString(),
        method,
        path: '/' + step + path,
        container: step,
        status: response.status,
        latency_ms: stepLatency,
        preview: truncatePreview(errorText),
        trace_id: traceId,
        error: errorText,
      })
      await recordEvent({
        timestamp: new Date().toISOString(),
        level: 'error',
        source: step,
        message: 'Step returned ' + response.status,
        detail: truncatePreview(errorText),
      })
      await updateMetrics(step, response.status)
      return jsonResponse(
        { error: 'Step failed', step, status: response.status, body: errorText },
        response.status,
      )
    }

    currentBody = await response.text()
    currentContentType = response.headers.get('content-type') || currentContentType
    lastStatus = response.status

    // Record successful step trace
    await recordTrace({
      timestamp: new Date().toISOString(),
      method,
      path: '/' + step + path,
      container: step,
      status: response.status,
      latency_ms: stepLatency,
      preview: truncatePreview(currentBody),
      trace_id: traceId,
    })
    await updateMetrics(step, response.status)
  }

  return new Response(currentBody, {
    status: lastStatus,
    headers: { 'content-type': currentContentType },
  })
}

async function handleParallel(
  pipeline: Pipeline,
  path: string,
  query: string,
  method: string,
  body: string,
  contentType: string,
  traceId: string,
): Promise<Response> {
  const calls = pipeline.steps.map(async (step) => {
    const stepStart = Date.now()
    let response: Response

    try {
      response = await callFunction(step, path, query, method, body, contentType)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await recordTrace({
        timestamp: new Date().toISOString(),
        method,
        path: '/' + step + path,
        container: step,
        status: 502,
        latency_ms: Date.now() - stepStart,
        preview: errMsg,
        trace_id: traceId,
        error: errMsg,
      })
      await recordEvent({
        timestamp: new Date().toISOString(),
        level: 'error',
        source: step,
        message: 'Function call failed',
        detail: errMsg,
      })
      await updateMetrics(step, 502)
      throw new Error(JSON.stringify({ step, status: 502, body: errMsg }))
    }

    const stepLatency = Date.now() - stepStart

    if (!response.ok) {
      const errorText = await response.text()
      await recordTrace({
        timestamp: new Date().toISOString(),
        method,
        path: '/' + step + path,
        container: step,
        status: response.status,
        latency_ms: stepLatency,
        preview: truncatePreview(errorText),
        trace_id: traceId,
        error: errorText,
      })
      await recordEvent({
        timestamp: new Date().toISOString(),
        level: 'error',
        source: step,
        message: 'Step returned ' + response.status,
        detail: truncatePreview(errorText),
      })
      await updateMetrics(step, response.status)
      throw new Error(JSON.stringify({ step, status: response.status, body: errorText }))
    }

    const resultText = await response.text()
    await recordTrace({
      timestamp: new Date().toISOString(),
      method,
      path: '/' + step + path,
      container: step,
      status: response.status,
      latency_ms: stepLatency,
      preview: truncatePreview(resultText),
      trace_id: traceId,
    })
    await updateMetrics(step, response.status)

    let result: unknown = resultText
    const ct = response.headers.get('content-type') || ''
    if (ct.includes('application/json')) {
      try { result = JSON.parse(resultText) } catch { /* keep as string */ }
    }

    return { step, result }
  })

  try {
    const results = await Promise.all(calls)
    const merged: Record<string, unknown> = {}
    for (const { step, result } of results) {
      merged[step] = result
    }
    return jsonResponse(merged)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Parallel execution failed'
    return jsonResponse({ error: 'Parallel execution failed', details: message }, 502)
  }
}

// ── Observe API endpoints ────────────────────────────────────────────

async function handleObserve(url: URL): Promise<Response> {
  const subpath = url.pathname.replace('/observe', '').replace(/^\\//, '')

  switch (subpath) {
    case '':
    case 'status': {
      const started = await redis.get('fnkit:observe:started')
      const traceCount = await redis.llen(TRACE_KEY)
      const eventCount = await redis.llen(EVENT_KEY)
      const metricKeys = await redis.keys(METRICS_PREFIX + '*')
      const pipelineKeys = await redis.keys(PIPELINE_PREFIX + '*')

      const metrics: Record<string, unknown> = {}
      for (const key of metricKeys) {
        const raw = await redis.get(key)
        if (raw) {
          const name = key.replace(METRICS_PREFIX, '')
          try { metrics[name] = JSON.parse(raw) } catch { metrics[name] = raw }
        }
      }

      return jsonResponse({
        service: 'fnkit-gateway',
        started: started || null,
        traces: traceCount,
        events: eventCount,
        pipelines: pipelineKeys.length,
        containers: metrics,
      })
    }

    case 'traces': {
      const count = parseInt(url.searchParams.get('count') || '50')
      const raw = await redis.lrange(TRACE_KEY, 0, count - 1)
      const traces = raw.map((r: string) => { try { return JSON.parse(r) } catch { return r } })
      return jsonResponse({ count: traces.length, traces })
    }

    case 'events': {
      const count = parseInt(url.searchParams.get('count') || '50')
      const raw = await redis.lrange(EVENT_KEY, 0, count - 1)
      const events = raw.map((r: string) => { try { return JSON.parse(r) } catch { return r } })
      return jsonResponse({ count: events.length, events })
    }

    case 'metrics': {
      const metricKeys = await redis.keys(METRICS_PREFIX + '*')
      const metrics: Record<string, unknown> = {}
      for (const key of metricKeys) {
        const raw = await redis.get(key)
        if (raw) {
          const name = key.replace(METRICS_PREFIX, '')
          try { metrics[name] = JSON.parse(raw) } catch { metrics[name] = raw }
        }
      }
      return jsonResponse(metrics)
    }

    default:
      return jsonResponse({ error: 'Unknown observe endpoint', available: ['status', 'traces', 'events', 'metrics'] }, 404)
  }
}

// ── Server ───────────────────────────────────────────────────────────

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url)

    // ── Observe endpoints ────────────────────────────────────────────
    if (url.pathname.startsWith('/observe')) {
      return handleObserve(url)
    }

    // ── Orchestrate endpoints ────────────────────────────────────────
    if (!url.pathname.startsWith('/orchestrate/')) {
      return jsonResponse({ error: 'Not found' }, 404)
    }

    const match = url.pathname.match(/^\\/orchestrate\\/([^\\/]+)(.*)$/)
    if (!match) {
      return jsonResponse({ error: 'Pipeline name missing' }, 400)
    }

    const pipelineName = match[1]
    const path = match[2] || ''
    const query = url.search || ''
    const method = request.method || 'POST'
    const contentType = request.headers.get('content-type') || 'application/json'
    const body = await request.text()
    const traceId = generateTraceId()
    const startTime = Date.now()

    try {
      const pipeline = await loadPipeline(pipelineName)

      if (!pipeline.steps || pipeline.steps.length === 0) {
        return jsonResponse({ error: 'Pipeline has no steps' }, 400)
      }

      let response: Response

      if (pipeline.mode === 'parallel') {
        response = await handleParallel(pipeline, path, query, method, body, contentType, traceId)
      } else {
        response = await handleSequential(pipeline, path, query, method, body, contentType, traceId)
      }

      // Record top-level pipeline trace
      const totalLatency = Date.now() - startTime
      const responseBody = await response.clone().text()
      await recordTrace({
        timestamp: new Date().toISOString(),
        method,
        path: '/orchestrate/' + pipelineName + path,
        container: 'orchestrator',
        status: response.status,
        latency_ms: totalLatency,
        preview: truncatePreview(responseBody),
        trace_id: traceId,
      })

      return response
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      const totalLatency = Date.now() - startTime

      await recordTrace({
        timestamp: new Date().toISOString(),
        method,
        path: '/orchestrate/' + pipelineName + path,
        container: 'orchestrator',
        status: 500,
        latency_ms: totalLatency,
        preview: message,
        trace_id: traceId,
        error: message,
      })
      await recordEvent({
        timestamp: new Date().toISOString(),
        level: 'error',
        source: 'orchestrator',
        message: 'Pipeline failed: ' + pipelineName,
        detail: message,
      })

      return jsonResponse({ error: message }, 500)
    }
  },
})

// Record start event after a short delay (wait for Redis connection)
setTimeout(() => recordStartEvent(), 2000)

console.log('FnKit orchestrator listening on port ' + PORT)
console.log('Pipeline storage: Valkey at ' + CACHE_URL)
console.log('Observability: traces, events, metrics → Valkey')
`

const README = `# FnKit Gateway

A lightweight API gateway for your FnKit functions with token authentication.
Uses pure nginx - no additional dependencies.

## Quick Start

\`\`\`bash
# Create the Docker network
docker network create fnkit-network

# Build the gateway
docker build -t fnkit-gateway .

# Run with authentication
docker run -d \\
  --name fnkit-gateway \\
  --network fnkit-network \\
  -p 8080:8080 \\
  -e FNKIT_AUTH_TOKEN=your-secret-token \\
  fnkit-gateway

# Or run in open mode (no auth)
docker run -d \\
  --name fnkit-gateway \\
  --network fnkit-network \\
  -p 8080:8080 \\
  fnkit-gateway
\`\`\`

## Usage

Call your functions through the gateway:

\`\`\`bash
# With authentication
curl -H "Authorization: Bearer your-secret-token" \\
  http://localhost:8080/my-function-name

# The path after the function name is forwarded
curl -H "Authorization: Bearer your-secret-token" \\
  http://localhost:8080/my-function-name/api/users

# Health check (no auth required)
curl http://localhost:8080/health
\`\`\`

## Deploying Functions

Make sure your function containers:
1. Are on the \`fnkit-network\` Docker network
2. Have a container name matching the URL path

\`\`\`bash
# Example: Deploy a function named "hello"
docker run -d \\
  --name hello \\
  --network fnkit-network \\
  --label fnkit.fn=true \\
  my-hello-function:latest

# Call it through the gateway
curl -H "Authorization: Bearer token" http://localhost:8080/hello
\`\`\`

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| \`FNKIT_AUTH_TOKEN\` | Bearer token for authentication. If empty, gateway runs in open mode. | (empty) |
| \`CACHE_URL\` | Valkey/Redis URL for orchestrator pipeline configs. | \`redis://fnkit-cache:6379\` |

## Orchestrator

Pipeline configs are stored in the shared Valkey cache. Add pipelines with:

\`\`\`bash
fnkit gateway orchestrate add process-order --steps validate,charge,notify --mode sequential
\`\`\`

## Production Deployment

Deploy the gateway as a Docker container on your server. For HTTPS and domain management,
use \`fnkit proxy init\` to set up a Caddy reverse proxy in front of the gateway.

\`\`\`bash
# On your server
docker network create fnkit-network
docker build -t fnkit-gateway .
docker run -d \\
  --name fnkit-gateway \\
  --network fnkit-network \\
  -p 8080:8080 \\
  -e FNKIT_AUTH_TOKEN=your-secret-token \\
  --restart unless-stopped \\
  fnkit-gateway
\`\`\`

Or use docker-compose:

\`\`\`bash
# Set your token
export FNKIT_AUTH_TOKEN=your-secret-token

# Create network and start
docker network create fnkit-network
docker compose up -d
\`\`\`
`

export interface GatewayOptions {
  output?: string
  token?: string
  orchestrateSubcommand?: string
  name?: string
  steps?: string
  mode?: string
}

export async function gatewayInit(
  options: GatewayOptions = {},
): Promise<boolean> {
  const outputDir = options.output || GATEWAY_DIR
  const targetDir = resolve(process.cwd(), outputDir)

  logger.title('Creating FnKit Gateway')

  if (existsSync(targetDir)) {
    logger.error(`Directory already exists: ${outputDir}`)
    return false
  }

  // Create directory
  mkdirSync(targetDir, { recursive: true })
  mkdirSync(join(targetDir, 'orchestrator'), { recursive: true })

  // Write files
  const files = {
    'nginx.conf.template': NGINX_CONF_TEMPLATE.trim(),
    Dockerfile: DOCKERFILE.trim(),
    'start.sh': START_SCRIPT.trim(),
    'docker-compose.yml': DOCKER_COMPOSE.trim(),
    'orchestrator/package.json': ORCHESTRATOR_PACKAGE_JSON.trim(),
    'orchestrator/index.ts': ORCHESTRATOR_INDEX.trim(),
    'README.md': README.trim(),
  }

  for (const [filename, content] of Object.entries(files)) {
    const filePath = join(targetDir, filename)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content)
    logger.success(`Created ${filename}`)
  }

  logger.newline()
  logger.success(`Gateway created in ${outputDir}/`)
  logger.newline()
  logger.info('Next steps:')
  logger.dim(`  cd ${outputDir}`)
  logger.dim('  docker network create fnkit-network')
  logger.dim('  docker build -t fnkit-gateway .')
  logger.dim(
    '  docker run -d --name fnkit-gateway --network fnkit-network -p 8080:8080 -e FNKIT_AUTH_TOKEN=secret fnkit-gateway',
  )
  logger.newline()

  return true
}

export async function gatewayBuild(
  options: GatewayOptions = {},
): Promise<boolean> {
  const gatewayDir = options.output || GATEWAY_DIR
  const targetDir = resolve(process.cwd(), gatewayDir)

  logger.title('Building FnKit Gateway')

  if (!existsSync(targetDir)) {
    logger.error(`Gateway directory not found: ${gatewayDir}`)
    logger.info('Run "fnkit gateway init" first to create the gateway')
    return false
  }

  // Check Docker
  if (!(await docker.isDockerAvailable())) {
    logger.error('Docker is not installed')
    return false
  }

  if (!(await docker.isDockerRunning())) {
    logger.error('Docker is not running')
    return false
  }

  // Build the image
  const success = await docker.build(targetDir, { tag: GATEWAY_IMAGE })

  if (success) {
    logger.newline()
    logger.success(`Built: ${GATEWAY_IMAGE}`)
    logger.newline()
    logger.info('Run the gateway:')
    logger.dim(`  docker network create ${FNKIT_NETWORK} 2>/dev/null || true`)
    logger.dim(
      `  docker run -d --name ${GATEWAY_CONTAINER} --network ${FNKIT_NETWORK} -p 8080:8080 -e FNKIT_AUTH_TOKEN=your-token ${GATEWAY_IMAGE}`,
    )
  }

  return success
}

export async function gatewayStart(
  options: GatewayOptions = {},
): Promise<boolean> {
  logger.title('Starting FnKit Gateway')

  // Check Docker
  if (
    !(await docker.isDockerAvailable()) ||
    !(await docker.isDockerRunning())
  ) {
    logger.error('Docker is not available')
    return false
  }

  // Check if image exists
  if (!(await docker.imageExists(GATEWAY_IMAGE))) {
    logger.error(`Gateway image not found: ${GATEWAY_IMAGE}`)
    logger.info('Run "fnkit gateway build" first')
    return false
  }

  // Create network if needed
  const { exec } = await import('../utils/shell')
  await exec('docker', ['network', 'create', FNKIT_NETWORK])

  // Stop existing container if running
  await exec('docker', ['rm', '-f', GATEWAY_CONTAINER])

  // Start the gateway
  const args = [
    'run',
    '-d',
    '--name',
    GATEWAY_CONTAINER,
    '--network',
    FNKIT_NETWORK,
    '-p',
    '8080:8080',
    '--label',
    'fnkit.gateway=true',
    '--restart',
    'unless-stopped',
    '-e',
    `CACHE_URL=redis://${CACHE_CONTAINER}:6379`,
  ]

  if (options.token) {
    args.push('-e', `FNKIT_AUTH_TOKEN=${options.token}`)
  }

  args.push(GATEWAY_IMAGE)

  const result = await exec('docker', args)

  if (result.success) {
    logger.success('Gateway started on http://localhost:8080')
    if (!options.token) {
      logger.warn('No token set - gateway is running in OPEN mode')
    }
    logger.newline()
    logger.info('Orchestrator pipelines stored in Valkey cache')
    logger.dim(`  Requires fnkit-cache running on ${FNKIT_NETWORK}`)
    return true
  } else {
    logger.error('Failed to start gateway')
    logger.dim(result.stderr)
    return false
  }
}

export async function gatewayStop(): Promise<boolean> {
  logger.title('Stopping FnKit Gateway')

  const { exec } = await import('../utils/shell')
  const result = await exec('docker', ['rm', '-f', GATEWAY_CONTAINER])

  if (result.success) {
    logger.success('Gateway stopped')
    return true
  } else {
    logger.error('Failed to stop gateway (may not be running)')
    return false
  }
}

// ── Orchestrate commands (using Valkey) ──────────────────────────────

export async function orchestrateAdd(
  name: string | undefined,
  options: GatewayOptions = {},
): Promise<boolean> {
  if (!name) {
    logger.error(
      'Usage: fnkit gateway orchestrate add <name> --steps a,b,c --mode sequential',
    )
    return false
  }

  const steps = (options.steps || '')
    .split(',')
    .map((step) => step.trim())
    .filter(Boolean)

  if (steps.length === 0) {
    logger.error('Provide steps with --steps step1,step2,step3')
    return false
  }

  const mode = options.mode?.toLowerCase()
  if (mode !== 'sequential' && mode !== 'parallel') {
    logger.error('Mode must be "sequential" or "parallel"')
    return false
  }

  const pipeline = JSON.stringify({ mode, steps })
  const key = `fnkit:pipeline:${name}`

  logger.step(`Saving pipeline: ${name}`)

  const { exec } = await import('../utils/shell')
  const result = await exec('docker', [
    'exec',
    CACHE_CONTAINER,
    'valkey-cli',
    'SET',
    key,
    pipeline,
  ])

  if (result.success) {
    logger.success(`Pipeline saved: ${name}`)
    logger.dim(`  mode: ${mode}`)
    logger.dim(`  steps: ${steps.join(' → ')}`)
    logger.dim(`  key: ${key}`)
    return true
  }

  logger.error('Failed to save pipeline')
  logger.dim(result.stderr || result.stdout)
  logger.info('Make sure fnkit-cache is running: fnkit cache start')
  return false
}

export async function orchestrateList(): Promise<boolean> {
  logger.title('FnKit Orchestrations')

  const { exec } = await import('../utils/shell')
  const result = await exec('docker', [
    'exec',
    CACHE_CONTAINER,
    'valkey-cli',
    'KEYS',
    'fnkit:pipeline:*',
  ])

  if (!result.success) {
    logger.error('Failed to list pipelines')
    logger.dim(result.stderr || result.stdout)
    logger.info('Make sure fnkit-cache is running: fnkit cache start')
    return false
  }

  const lines = result.stdout.split('\n').filter((l) => l.trim())
  const names = lines
    .map((line) => line.replace('fnkit:pipeline:', ''))
    .filter(Boolean)

  if (names.length === 0) {
    logger.info('No pipelines found')
    logger.newline()
    logger.dim(
      '  Add one: fnkit gateway orchestrate add <name> --steps a,b --mode sequential',
    )
    logger.newline()
    return true
  }

  console.log('')
  for (const name of names) {
    console.log(`   🔗 ${name}`)
  }
  console.log('')
  logger.info(
    `${names.length} pipeline${names.length > 1 ? 's' : ''} configured`,
  )
  logger.newline()

  return true
}

export async function orchestrateRemove(
  name: string | undefined,
): Promise<boolean> {
  if (!name) {
    logger.error('Usage: fnkit gateway orchestrate remove <name>')
    return false
  }

  const key = `fnkit:pipeline:${name}`

  const { exec } = await import('../utils/shell')
  const result = await exec('docker', [
    'exec',
    CACHE_CONTAINER,
    'valkey-cli',
    'DEL',
    key,
  ])

  if (result.success) {
    logger.success(`Removed pipeline: ${name}`)
    return true
  }

  logger.error('Failed to remove pipeline')
  logger.dim(result.stderr || result.stdout)
  return false
}

export async function gateway(
  subcommand: string,
  options: GatewayOptions = {},
): Promise<boolean> {
  switch (subcommand) {
    case 'init':
      return gatewayInit(options)
    case 'build':
      return gatewayBuild(options)
    case 'start':
      return gatewayStart(options)
    case 'stop':
      return gatewayStop()
    case 'orchestrate':
      switch (options.orchestrateSubcommand) {
        case 'add':
          return orchestrateAdd(options.name, options)
        case 'ls':
        case 'list':
          return orchestrateList()
        case 'remove':
        case 'rm':
          return orchestrateRemove(options.name)
        default:
          logger.error(
            `Unknown orchestrate command: ${options.orchestrateSubcommand || ''}`,
          )
          logger.info('Available: add, remove, ls')
          return false
      }
    default:
      logger.error(`Unknown gateway command: ${subcommand}`)
      logger.info('Available commands: init, build, start, stop, orchestrate')
      return false
  }
}

export default gateway
