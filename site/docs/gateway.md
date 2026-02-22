# API Gateway

The FnKit gateway provides centralized token authentication and routing for all your function containers. It's an nginx-based reverse proxy with a built-in Bun orchestrator for multi-function pipelines.

## Architecture

```
Request → Gateway (port 8080)
  ├── /health              → 200 OK (no auth)
  ├── /orchestrate/<name>  → Bun orchestrator (pipelines)
  └── /<container-name>/*  → proxy to function container
```

All function containers and the gateway sit on the same Docker network (`fnkit-network`). The gateway resolves container names via Docker DNS and proxies requests to port 8080 on each container.

## Quick Start

```bash
# Create the Docker network
docker network create fnkit-network

# Generate gateway project files
fnkit gateway init

# Build the Docker image
fnkit gateway build

# Start with token authentication
fnkit gateway start --token your-secret-token
```

## Calling Functions

```bash
# Call a function through the gateway
curl -H "Authorization: Bearer your-secret-token" http://localhost:8080/my-function

# Path forwarding — everything after the function name is forwarded
curl -H "Authorization: Bearer your-secret-token" http://localhost:8080/my-function/api/users?page=2

# Health check (no auth required)
curl http://localhost:8080/health
```

## Authentication

The gateway supports two modes:

### Token Mode (recommended)

Start with `--token` to require a Bearer token on all requests:

```bash
fnkit gateway start --token your-secret-token
```

Requests must include `Authorization: Bearer your-secret-token`. Invalid or missing tokens return `401 Unauthorized`.

### Open Mode

Start without `--token` for open access (useful for development):

```bash
fnkit gateway start
```

All requests are proxied without authentication.

## How Routing Works

The gateway uses nginx with Docker DNS resolution:

1. Request arrives at `http://gateway:8080/<container-name>/path`
2. If auth is enabled, validates the `Authorization: Bearer <token>` header
3. Resolves `<container-name>` via Docker DNS on `fnkit-network`
4. Proxies to `http://<container-name>:8080/path`
5. Returns the function's response

If the container doesn't exist or isn't running, the gateway returns:

```json
{ "error": "Function not found or not running", "container": "my-function" }
```

## Orchestrator

The orchestrator enables multi-function pipelines — call several functions in a single request. Pipeline configurations are stored in the shared Valkey cache (`fnkit-cache`).

### Adding Pipelines

```bash
# Add a sequential pipeline
fnkit gateway orchestrate add process-order \
  --steps validate-order,charge-payment,send-email \
  --mode sequential

# Add a parallel pipeline
fnkit gateway orchestrate add enrich-user \
  --steps get-profile,get-preferences,get-history \
  --mode parallel
```

Pipelines are stored as keys in Valkey with the prefix `fnkit:pipeline:`.

### Sequential Pipelines

Each step receives the output of the previous step as its input. The final step's output is returned to the caller.

```bash
curl -H "Authorization: Bearer token" \
  -d '{"orderId": 123}' \
  http://localhost:8080/orchestrate/process-order
```

Flow: `input → validate-order → charge-payment → send-email → response`

If any step fails, the pipeline stops and returns the error.

### Parallel Pipelines

All steps are called simultaneously with the same input. Results are merged into a single response object.

```bash
curl -H "Authorization: Bearer token" \
  -d '{"userId": 456}' \
  http://localhost:8080/orchestrate/enrich-user
```

Response:

```json
{
  "get-profile": { "name": "Alice", "email": "alice@example.com" },
  "get-preferences": { "theme": "dark", "lang": "en" },
  "get-history": [{ "action": "login", "ts": "2025-01-01" }]
}
```

### Managing Pipelines

```bash
# List all pipelines
fnkit gateway orchestrate ls

# Remove a pipeline
fnkit gateway orchestrate remove process-order
```

### Pipeline Config Format

Pipelines are stored as JSON values in Valkey at `fnkit:pipeline:<name>`:

```json
{
  "mode": "sequential",
  "steps": ["validate-order", "charge-payment", "send-email"]
}
```

You can also set them directly with valkey-cli:

```bash
docker exec fnkit-cache valkey-cli SET fnkit:pipeline:process-order '{"mode":"sequential","steps":["validate-order","charge-payment","send-email"]}'
```

## Gateway Project Files

`fnkit gateway init` creates a `fnkit-gateway/` directory with:

| File                        | Purpose                                             |
| --------------------------- | --------------------------------------------------- |
| `nginx.conf.template`       | Nginx config with token auth and dynamic routing    |
| `Dockerfile`                | Multi-stage build (nginx + Bun orchestrator)        |
| `start.sh`                  | Startup script — injects env vars into nginx config |
| `docker-compose.yml`        | For local testing with `docker compose up`          |
| `orchestrator/index.ts`     | Bun-based orchestrator server                       |
| `orchestrator/package.json` | Orchestrator dependencies (ioredis)                 |
| `README.md`                 | Gateway-specific documentation                      |

## Using Docker Compose

You can also run the gateway with Docker Compose:

```bash
cd fnkit-gateway

# Set your token
export FNKIT_AUTH_TOKEN=your-secret-token

# Start
docker compose up -d
```

## Environment Variables

| Variable           | Description                                        | Default                    |
| ------------------ | -------------------------------------------------- | -------------------------- |
| `FNKIT_AUTH_TOKEN`  | Bearer token for authentication. Empty = open mode | (empty)                    |
| `CACHE_URL`        | Valkey/Redis URL for pipeline configs              | `redis://fnkit-cache:6379` |

---

← [Back to README](../README.md) · [Cache →](cache.md) · [Commands →](commands.md)
