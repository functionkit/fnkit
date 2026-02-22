---
layout: default
title: Getting Started
nav_order: 3
---

# Getting Started

This guide walks you through creating, developing, and deploying your first function with FnKit.

## Prerequisites

- [Docker](https://docker.com) installed and running
- [Git](https://git-scm.com) installed
- [fnkit]({% link docs/installation.md %}) installed
- A runtime installed for your language of choice (e.g., Node.js, Python, Go)

Check everything is ready:

```bash
fnkit doctor
```

## 1. Create a Function

```bash
fnkit node my-api
cd my-api
```

This creates a new directory with:

- A function source file with a hello world handler
- A `Dockerfile` for containerised deployment
- A `docker-compose.yml` for gateway integration
- A `.gitignore` tailored to the runtime
- Dependencies installed (e.g., `node_modules/`)

You can use any supported runtime — just swap `node` for `python`, `go`, `java`, `ruby`, `dotnet`, `php`, `dart`, or `cpp`.

### With a Git Remote

```bash
fnkit node my-api --remote git@github.com:user/my-api.git
```

### Using the Explicit Form

```bash
fnkit new node my-api
```

## 2. Develop Locally

```bash
fnkit dev
```

Your function starts on `http://localhost:8080`. Edit the source file and restart to see changes.

### Options

```bash
fnkit dev --port 3000           # Custom port
fnkit dev --target myFunction   # Specific function target
```

## 3. Set Up the Platform

Before deploying, you need the infrastructure running on your server. This is a one-time setup.

### Create the Docker Network

```bash
docker network create fnkit-network
```

### Start the API Gateway

```bash
fnkit gateway init
fnkit gateway build
fnkit gateway start --token your-secret-token
```

The gateway runs on port 8080 and authenticates requests with a Bearer token. See [Gateway docs]({% link docs/gateway.md %}) for details.

### (Optional) Start the Shared Cache

```bash
fnkit cache init
fnkit cache start
```

All functions can now access a Redis-compatible cache at `redis://fnkit-cache:6379`. See [Cache docs]({% link docs/cache.md %}).

### (Optional) Set Up HTTPS

```bash
fnkit proxy init
fnkit proxy add api.example.com
cd fnkit-proxy && docker compose up -d
```

Caddy handles TLS certificates automatically via Let's Encrypt. See [Proxy docs]({% link docs/proxy.md %}).

## 4. Deploy

### Set Up CI/CD

```bash
fnkit deploy setup
```

This interactive wizard checks prerequisites and generates a deploy workflow for Forgejo (default) or GitHub Actions.

### Push to Deploy

```bash
git add . && git commit -m "init" && git push
```

The CI pipeline will:

1. Build a Docker image from your `Dockerfile`
2. Deploy the container to `fnkit-network`
3. Run a health check
4. Auto-rollback on failure

### Verify

```bash
fnkit deploy status
```

### Call Your Function

```bash
# Through the gateway
curl -H "Authorization: Bearer your-secret-token" http://localhost:8080/my-api

# With a custom domain (if proxy is set up)
curl https://api.example.com/my-api
```

## What's Next?

- **[Runtimes]({% link docs/runtimes.md %})** — Explore all 12 supported runtimes
- **[Gateway]({% link docs/gateway.md %})** — Set up orchestrator pipelines for multi-function workflows
- **[Cache]({% link docs/cache.md %})** — Add caching to your functions
- **[Deploy]({% link docs/deploy.md %})** — Configure Forgejo or GitHub Actions in detail
- **[MQTT]({% link docs/mqtt.md %})** — Build event-driven functions with MQTT
- **[Production]({% link docs/production.md %})** — Full server setup guide
