---
layout: default
title: UNS Plugin
nav_order: 11
---

# UNS Plugin

FnKit includes a built-in plugin for [Unified Namespace (UNS)](https://www.unsframework.com) workflows — a common industrial IoT pattern where all enterprise data flows through a hierarchical MQTT topic structure following ISA-95.

The `fnkit uns` commands scaffold and manage three pre-built functions that work together to monitor, cache, and log UNS data.

## Architecture

```
MQTT Broker
  │
  │  v1.0/#  (wildcard subscription)
  │
  ▼
┌──────────────────────────────┐
│  uns-framework               │
│  Go MQTT function            │
│  Caches every message        │
└──────────────┬───────────────┘
               │
               ▼
      fnkit-cache (Valkey)
        │
        ├── uns-cache (Node.js HTTP function)
        │   Reads cached topics → JSON API
        │
        └── uns-log (Go HTTP function)
            Logs changes → PostgreSQL
```

The three components:

| Component | Runtime | Protocol | Purpose |
|:----------|:--------|:---------|:--------|
| **uns-framework** | Go | MQTT | Subscribes to `v1.0/#`, caches all messages to Valkey |
| **uns-cache** | Node.js | HTTP | Reads cached topic data, returns JSON with change detection |
| **uns-log** | Go | HTTP | Logs changed values to PostgreSQL |

## Quick Start

```bash
# 1. Start the shared cache
fnkit cache start

# 2. Create and configure the UNS monitor
fnkit uns uns init
cd uns-framework
cp .env.example .env
# Edit .env: set MQTT_BROKER, auth, TLS certs as needed
docker compose up -d

# 3. Create the cache reader (HTTP API for cached data)
cd ..
fnkit uns cache init
cd uns-cache
cp .env.example .env
docker compose up -d

# 4. (Optional) Create the PostgreSQL logger
cd ..
fnkit uns log init
cd uns-log
cp .env.example .env
# Set config in Valkey:
docker exec fnkit-cache valkey-cli SET fnkit:config:uns-log \
  '{"table":"uns_log","topics":["v1.0/enterprise/site/area/line/temperature"]}'
docker compose up -d

# 5. Check status
fnkit uns status
```

## Commands

| Command | Description |
|:--------|:------------|
| `fnkit uns uns init [name]` | Scaffold UNS topic monitor (default: `uns-framework/`) |
| `fnkit uns uns start [name]` | Build & start monitor container |
| `fnkit uns uns stop [name]` | Stop monitor container |
| `fnkit uns cache init [name]` | Scaffold UNS cache reader (default: `uns-cache/`) |
| `fnkit uns cache start [name]` | Build & start cache reader |
| `fnkit uns cache stop [name]` | Stop cache reader |
| `fnkit uns log init [name]` | Scaffold PostgreSQL logger (default: `uns-log/`) |
| `fnkit uns log start [name]` | Build & start logger |
| `fnkit uns log stop [name]` | Stop logger |
| `fnkit uns status` | Show status of all UNS components |

## UNS Topic Monitor (`uns-framework`)

A Go MQTT function that subscribes to the entire UNS namespace (`v1.0/#`) and writes every message to the shared Valkey cache.

### What It Does

For each incoming MQTT message:

1. **Shifts** the current cached value → previous value
2. **Writes** the new payload as the current value
3. **Tracks** the topic in a registry set
4. **Updates** metadata (last_updated, count, first_seen)

### Generated Files

| File | Purpose |
|:-----|:--------|
| `function.go` | UNS monitor handler with cache pipeline |
| `cmd/main.go` | Entry point — loads function, starts framework |
| `go.mod` | Go module with function-framework-go + go-redis |
| `Dockerfile` | Multi-stage build (Go builder → distroless) |
| `docker-compose.yml` | Service config with `env_file` + cert volume |
| `.env.example` | All configuration with documentation |
| `certs/` | Directory for TLS/mTLS certificates |
| `README.md` | Component-specific documentation |

### Configuration

All configuration is via `.env` (copy from `.env.example`):

| Variable | Default | Description |
|:---------|:--------|:------------|
| `MQTT_BROKER` | `mqtt://localhost:1883` | Broker URL (`mqtt://` or `mqtts://`) |
| `FUNCTION_TARGET` | `unsMonitor` | Function registry name |
| `MQTT_TOPIC_PREFIX` | `v1.0` | UNS namespace version prefix |
| `MQTT_SUBSCRIBE_TOPIC` | `v1.0/#` | Wildcard subscription |
| `MQTT_QOS` | `1` | QoS level (0, 1, or 2) |
| `MQTT_CLIENT_ID` | (auto) | MQTT client identifier |
| `MQTT_USERNAME` | — | Broker authentication |
| `MQTT_PASSWORD` | — | Broker authentication |
| `MQTT_CA` | — | CA certificate path (TLS) |
| `MQTT_CERT` | — | Client certificate path (mTLS) |
| `MQTT_KEY` | — | Client private key path (mTLS) |
| `MQTT_REJECT_UNAUTHORIZED` | `true` | Set `false` for self-signed certs |
| `CACHE_URL` | `redis://fnkit-cache:6379` | Valkey/Redis connection |
| `CACHE_KEY_PREFIX` | `uns` | Prefix for all cache keys |
| `CACHE_TTL` | `0` | TTL in seconds (0 = no expiry) |

### TLS / mTLS

The monitor includes full TLS and mutual TLS support:

1. Place certificates in the `certs/` directory
2. Configure paths in `.env`:

```env
# TLS (server verification)
MQTT_BROKER=mqtts://broker:8883
MQTT_CA=/certs/ca.crt

# mTLS (mutual authentication)
MQTT_CERT=/certs/client.crt
MQTT_KEY=/certs/client.key

# Self-signed certificates
MQTT_REJECT_UNAUTHORIZED=false
```

The `docker-compose.yml` mounts `./certs:/certs:ro` automatically. Certificate files are gitignored — only `.gitkeep` is tracked.

## Cache Key Layout

The UNS monitor writes to Valkey with this key structure:

| Key Pattern | Type | Description |
|:------------|:-----|:------------|
| `uns:topics` | SET | All discovered topic paths |
| `uns:data:<topic>` | STRING | Latest payload (raw JSON) |
| `uns:prev:<topic>` | STRING | Previous payload (raw JSON) |
| `uns:meta:<topic>` | STRING | Metadata: `{"last_updated", "count", "first_seen"}` |

### Querying the Cache

From CLI:

```bash
# List all discovered topics
docker exec fnkit-cache valkey-cli SMEMBERS uns:topics

# Get latest value
docker exec fnkit-cache valkey-cli GET "uns:data:v1.0/enterprise/site/area/line/temperature"

# Get previous value (for change detection)
docker exec fnkit-cache valkey-cli GET "uns:prev:v1.0/enterprise/site/area/line/temperature"

# Get metadata
docker exec fnkit-cache valkey-cli GET "uns:meta:v1.0/enterprise/site/area/line/temperature"
```

From a Go function:

```go
rdb := redis.NewClient(&redis.Options{Addr: "fnkit-cache:6379"})
topics, _ := rdb.SMembers(ctx, "uns:topics").Result()
val, _ := rdb.Get(ctx, "uns:data:v1.0/enterprise/site/area/line/temperature").Result()
```

## UNS Cache Reader (`uns-cache`)

A Node.js HTTP function that reads UNS topic data from the shared Valkey cache and returns JSON with change detection.

### API

**Get all cached topics:**

```bash
curl -H "Authorization: Bearer <token>" http://localhost:8080/uns-cache
```

**Get specific topics:**

```bash
curl -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"topics": ["v1.0/enterprise/site/area/line/temperature"]}' \
  http://localhost:8080/uns-cache
```

### Response Format

```json
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
```

- **`topics`** — Full data for every requested topic (value, previous, metadata, change flag)
- **`changes`** — Only topics where current ≠ previous

### Configuration

| Variable | Default | Description |
|:---------|:--------|:------------|
| `FUNCTION_TARGET` | `uns-cache` | Function name |
| `CACHE_URL` | `redis://fnkit-cache:6379` | Valkey/Redis connection |
| `CACHE_KEY_PREFIX` | `uns` | Must match uns-framework |

## UNS PostgreSQL Logger (`uns-log`)

A Go HTTP function that reads UNS topic data from the cache and logs snapshot rows to PostgreSQL when any value changes.

### How It Works

1. Fetches config from Valkey (cached 30s)
2. Reads all configured topics from cache
3. Compares current values vs last logged snapshot
4. If any topic changed → INSERTs a full snapshot row to PostgreSQL
5. Returns JSON summary

### Config in Valkey

Config is stored in the shared Valkey cache — **not** in `.env` files. The function reads its config using `FUNCTION_TARGET` as the key:

```bash
docker exec fnkit-cache valkey-cli SET fnkit:config:uns-log \
  '{"table":"uns_log","topics":["v1.0/acme/factory1/mixing/line1/temperature","v1.0/acme/factory1/mixing/line1/pressure"]}'
```

Config format:

```json
{
  "table": "uns_log",
  "topics": [
    "v1.0/acme/factory1/mixing/line1/temperature",
    "v1.0/acme/factory1/mixing/line1/pressure"
  ]
}
```

### PostgreSQL Table (auto-created)

```sql
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
```

Every row is a **complete snapshot** — unchanged values are copied forward. The `changed` column lists which tags triggered the log.

### UNS Topic Parsing

All hierarchy metadata is parsed directly from the topic path — no manual mapping needed:

```
v1.0/{enterprise}/{site}/{area}/{line}/{tag}
```

| UNS Level | Parsed From | Example |
|:----------|:------------|:--------|
| `enterprise` | `parts[1]` | acme |
| `site` | `parts[2]` | factory1 |
| `area` | `parts[3]` | mixing |
| `line` | `parts[4]` | line1 |
| `tag` | `parts[5:]` | temperature |

### Multiple Instances

Deploy the same image with different `FUNCTION_TARGET` values. Each reads its own config from Valkey:

```bash
# Instance 1 — line1 sensors
docker exec fnkit-cache valkey-cli SET fnkit:config:uns-log-line1 \
  '{"table":"uns_log","topics":["v1.0/acme/factory1/mixing/line1/temperature","v1.0/acme/factory1/mixing/line1/pressure"]}'

# Instance 2 — line2 sensors
docker exec fnkit-cache valkey-cli SET fnkit:config:uns-log-line2 \
  '{"table":"uns_log","topics":["v1.0/acme/factory1/mixing/line2/temperature","v1.0/acme/factory1/mixing/line2/speed"]}'
```

Trigger via the gateway:

```bash
curl -H "Authorization: Bearer <token>" http://localhost:8080/uns-log-line1
curl -H "Authorization: Bearer <token>" http://localhost:8080/uns-log-line2
```

### Configuration

| Variable | Default | Description |
|:---------|:--------|:------------|
| `FUNCTION_TARGET` | `uns-log` | Function name = Valkey config key |
| `DATABASE_URL` | `postgres://fnkit:fnkit@fnkit-postgres:5432/fnkit?sslmode=disable` | PostgreSQL connection |
| `CACHE_URL` | `redis://fnkit-cache:6379` | Valkey/Redis connection |
| `CACHE_KEY_PREFIX` | `uns` | Must match uns-framework |

## UNS Framework

The [Unified Namespace (UNS) Framework](https://www.unsframework.com) organises enterprise data in a hierarchical MQTT topic structure following ISA-95:

```
v1.0/{enterprise}/{site}/{area}/{line}/{cell}/...
```

By subscribing to `v1.0/#`, the UNS monitor captures the entire namespace and makes it queryable via the shared cache. This enables:

- **Real-time dashboards** — read current values from cache
- **Change detection** — compare current vs previous values
- **Historical logging** — log changes to PostgreSQL for analysis
- **Event-driven actions** — trigger functions when specific topics change

---

← [MQTT Functions](mqtt.md) · [Commands →](commands.md) · [Back to README](../README.md)
