---
layout: default
title: Orchestrator
nav_order: 7
---

# Orchestrator

The orchestrator enables multi-function pipelines — call several functions in a single request. It runs as a Bun-based server inside the [API Gateway](gateway.md) and is accessed via the `/orchestrate/<name>` route. Pipeline configurations are stored in the shared Valkey cache (`fnkit-cache`).

## Adding Pipelines

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

## Sequential Pipelines

Each step receives the output of the previous step as its input. The final step's output is returned to the caller.

```bash
curl -H "Authorization: Bearer token" \
  -d '{"orderId": 123}' \
  http://localhost:8080/orchestrate/process-order
```

Flow: `input → validate-order → charge-payment → send-email → response`

If any step fails, the pipeline stops and returns the error.

## Parallel Pipelines

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

## Managing Pipelines

```bash
# List all pipelines
fnkit gateway orchestrate ls

# Remove a pipeline
fnkit gateway orchestrate remove process-order
```

## Pipeline Config Format

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

## Environment Variables

| Variable           | Description                                        | Default                    |
| ------------------ | -------------------------------------------------- | -------------------------- |
| `CACHE_URL`        | Valkey/Redis URL for pipeline configs              | `redis://fnkit-cache:6379` |

---

← [Back to README](../README.md) · [Gateway →](gateway.md) · [Cache →](cache.md)
