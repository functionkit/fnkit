---
layout: default
title: Observability
nav_order: 11
---

# Observability

FnKit provides Node-RED-level observability for your function platform. The gateway automatically records request traces, events, errors, and per-container metrics to the shared Valkey cache. Query them via the CLI or HTTP API.

## Architecture

```
Request → Gateway (nginx)
  │
  ├── /<container>/*     → proxy to function → record trace + metrics
  ├── /orchestrate/*     → orchestrator      → record trace per step + events on error
  ├── /observe/*         → observe API       → read traces/events/metrics from Valkey
  └── /health            → 200 OK
                                    ↓
                              fnkit-cache (Valkey)
                                ├── fnkit:traces         (last 1000 request traces)
                                ├── fnkit:events         (last 1000 events/errors)
                                ├── fnkit:metrics:*      (per-container counters)
                                └── fnkit:observe:started (gateway start time)
```

## Quick Start

```bash
# View the unified dashboard
fnkit observe

# View recent events/errors
fnkit observe events

# View request traces
fnkit observe traces

# View per-container metrics
fnkit observe metrics
```

## CLI Commands

### `fnkit observe`

Show the unified status dashboard — component health, recent events, and recent traces.

```bash
fnkit observe
fnkit observe status
```

Example output:

```
╔════════════════════════════════════════════════════════════════╗
║                    📊 FnKit Observability                     ║
╚════════════════════════════════════════════════════════════════╝

   Components
   ──────────────────────────────────────────────────────────
   🟢 fnkit-gateway        running     reqs: 12451  3s ago
   🟢 fnkit-cache           running     keys: 194
   🟢 opcua-bridge          running     connected
   🟢 uns-framework         running     topics: 47
   🟢 uns-cache             running     reqs: 8322
   ⚫ uns-log               stopped

   Recent Events
   ──────────────────────────────────────────────────────────
   15:42:01  ℹ  fnkit-gateway      Gateway started
   15:41:58  ✓  uns-framework      subscribed to v1.0/#
   14:30:12  ⚠  opcua-bridge       read error: timeout

   Recent Traces
   ──────────────────────────────────────────────────────────
   15:42:05  GET   /uns-cache       200  12ms   {topic_count: 47}
   15:42:03  POST  /orchestrate/log 200  45ms   {logged: true}
```

### `fnkit observe events`

Show recent events — connections, errors, status changes.

```bash
fnkit observe events
fnkit observe events --count 100
```

| Option          | Description                        |
| --------------- | ---------------------------------- |
| `--count`, `-n` | Number of events to show (default: 50) |

### `fnkit observe traces`

Show recent request traces through the gateway — every orchestrator pipeline call is traced with method, path, status code, latency, and a response preview.

```bash
fnkit observe traces
fnkit observe traces --count 100
```

| Option          | Description                        |
| --------------- | ---------------------------------- |
| `--count`, `-n` | Number of traces to show (default: 50) |

### `fnkit observe metrics`

Show per-container request counts, error rates, and last activity. Also shows cache stats and UNS topic counts.

```bash
fnkit observe metrics
```

## HTTP API

The gateway exposes observability data via HTTP endpoints at `/observe/*`. These are **not authenticated** (designed for internal monitoring).

### `GET /observe/status`

Aggregated status overview.

```bash
curl http://localhost:8080/observe/status
```

```json
{
  "service": "fnkit-gateway",
  "started": "2026-02-24T12:00:00.000Z",
  "traces": 1234,
  "events": 56,
  "pipelines": 3,
  "containers": {
    "my-api": { "requests": 500, "errors": 2, "last_active": "2026-02-24T15:42:05Z", "status": "running" },
    "validate": { "requests": 200, "errors": 0, "last_active": "2026-02-24T15:42:03Z", "status": "running" }
  }
}
```

### `GET /observe/traces`

Recent request traces.

```bash
curl http://localhost:8080/observe/traces?count=20
```

```json
{
  "count": 20,
  "traces": [
    {
      "timestamp": "2026-02-24T15:42:05.123Z",
      "method": "POST",
      "path": "/orchestrate/process-order",
      "container": "orchestrator",
      "status": 200,
      "latency_ms": 45,
      "preview": "{\"result\":\"ok\"}",
      "trace_id": "a1b2c3d4ef"
    }
  ]
}
```

### `GET /observe/events`

Recent events and errors.

```bash
curl http://localhost:8080/observe/events?count=20
```

```json
{
  "count": 5,
  "events": [
    {
      "timestamp": "2026-02-24T15:42:01.000Z",
      "level": "info",
      "source": "fnkit-gateway",
      "message": "Gateway started",
      "detail": "Orchestrator listening on port 3000"
    },
    {
      "timestamp": "2026-02-24T14:30:12.000Z",
      "level": "error",
      "source": "validate",
      "message": "Step returned 500",
      "detail": "Internal server error"
    }
  ]
}
```

### `GET /observe/metrics`

Per-container metrics.

```bash
curl http://localhost:8080/observe/metrics
```

```json
{
  "my-api": { "requests": 500, "errors": 2, "last_active": "2026-02-24T15:42:05Z", "status": "running" },
  "validate": { "requests": 200, "errors": 0, "last_active": "2026-02-24T15:42:03Z", "status": "running" }
}
```

## What Gets Recorded

### Traces

Every request through the gateway orchestrator is recorded as a trace:

| Field        | Description                                    |
| ------------ | ---------------------------------------------- |
| `timestamp`  | ISO 8601 timestamp                             |
| `method`     | HTTP method (GET, POST, etc.)                  |
| `path`       | Request path                                   |
| `container`  | Target container name                          |
| `status`     | HTTP status code                               |
| `latency_ms` | Response time in milliseconds                  |
| `preview`    | First 120 chars of response body               |
| `trace_id`   | Unique ID linking pipeline steps together      |
| `error`      | Error message (only on failure)                |

For orchestrator pipelines, each step gets its own trace plus a top-level pipeline trace — all sharing the same `trace_id`.

### Events

Significant events are recorded automatically:

| Event                  | Level   | Source          |
| ---------------------- | ------- | --------------- |
| Gateway started        | info    | fnkit-gateway   |
| Function call failed   | error   | container name  |
| Step returned 4xx/5xx  | error   | container name  |
| Pipeline failed        | error   | orchestrator    |

### Metrics

Per-container counters updated on every request:

| Field         | Description                          |
| ------------- | ------------------------------------ |
| `requests`    | Total request count                  |
| `errors`      | Requests with status ≥ 400           |
| `last_active` | Timestamp of last request            |
| `status`      | `running` or `error` (last request)  |

## Valkey Key Layout

| Key                        | Type   | TTL    | Description                    |
| -------------------------- | ------ | ------ | ------------------------------ |
| `fnkit:traces`             | LIST   | —      | Last 1000 request traces       |
| `fnkit:events`             | LIST   | —      | Last 1000 events               |
| `fnkit:metrics:<container>`| STRING | —      | Per-container metrics (JSON)   |
| `fnkit:observe:started`    | STRING | —      | Gateway start timestamp        |

Lists are capped at 1000 entries using `LTRIM` after each push.

## Node-RED Comparison

| Node-RED Feature           | fnkit Equivalent                                    |
| -------------------------- | --------------------------------------------------- |
| Debug sidebar              | `fnkit observe traces` / `GET /observe/traces`      |
| Status nodes               | `fnkit observe status` / `GET /observe/status`      |
| Catch nodes                | `fnkit observe events` / `GET /observe/events`      |
| Node status indicators     | `fnkit observe metrics` / `GET /observe/metrics`    |
| showStatusActivities       | Per-container metrics with last_active timestamp     |
| showErrors                 | Error count in metrics + error events               |
| Connection status → MQTT   | OPC-UA bridge `status_topic` (already built-in)     |

## Enabling Observability

Observability is built into the gateway. To enable it:

1. **Rebuild the gateway** (if you created it before this feature):
   ```bash
   rm -rf fnkit-gateway
   fnkit gateway init
   fnkit gateway build
   fnkit gateway start --token your-token
   ```

2. **Ensure fnkit-cache is running** (traces are stored in Valkey):
   ```bash
   fnkit cache start
   ```

3. **Query via CLI or HTTP**:
   ```bash
   fnkit observe
   curl http://localhost:8080/observe/status
   ```

## Integration with External Tools

The HTTP API returns JSON, making it easy to integrate with monitoring tools:

- **Grafana**: Point a JSON data source at `/observe/metrics`
- **Prometheus**: Write a simple exporter that reads `/observe/metrics`
- **Custom dashboards**: Poll `/observe/traces` and `/observe/events`
- **Alerting**: Monitor `/observe/events` for error-level events

---

← [Back to README](../README.md) · [Gateway →](gateway.md) · [Commands →](commands.md)
