---
layout: default
title: Home
nav_order: 1
description: 'FnKit — Scaffold, develop, and deploy serverless functions using Docker and Git push.'
permalink: /
---

# FnKit — Functions as a Service CLI

{: .fs-9 }

Scaffold, develop, and deploy serverless functions using Docker and Git push. No external platforms required.
{: .fs-6 .fw-300 }

[Get Started]({% link docs/getting-started.md %}){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View on GitHub](https://github.com/functionkit/fnkit){: .btn .fs-5 .mb-4 .mb-md-0 }

---

```
Internet → Caddy (TLS/domains) → fnkit-gateway (auth/routing) → Function containers
                                                                    ↑
                                                    Forgejo/GitHub Actions
                                                    (git push → docker build → deploy)
```

**Dependencies:** Docker + Git. That's it.

## Quick Start

```bash
# Install
curl -L https://github.com/functionkit/fnkit/releases/latest/download/fnkit-macos-arm64 -o fnkit
chmod +x fnkit && ./fnkit install

# Create a function
fnkit node my-api
cd my-api

# Run locally
fnkit dev

# Set up CI/CD and deploy
fnkit deploy setup
git add . && git commit -m "init" && git push
```

## Features

| Feature                       | Description                                                        |
| :---------------------------- | :----------------------------------------------------------------- |
| **Multi-runtime scaffolding** | Create functions in 9 HTTP runtimes + 3 MQTT runtimes              |
| **Local development**         | `fnkit dev` runs your function locally with hot reload             |
| **API Gateway**               | Nginx-based auth gateway with token validation and routing         |
| **Orchestrator**              | Multi-function pipelines — sequential chaining or parallel fan-out |
| **Shared Cache**              | Redis-compatible Valkey cache accessible by all functions          |
| **Reverse Proxy**             | Automatic HTTPS via Caddy with Let's Encrypt                       |
| **Git-push Deploy**           | CI/CD via Forgejo Actions or GitHub Actions                        |
| **MQTT Functions**            | Event-driven functions that subscribe to MQTT topics               |
| **UNS Plugin**                | Industrial IoT: MQTT monitor → cache → PostgreSQL logger           |
| **Container Management**      | List, log, and stop deployed function containers                   |

## Supported Runtimes

### HTTP (Google Cloud Functions Framework)

| Runtime | Command               |     | Runtime | Command               |
| :------ | :-------------------- | --- | :------ | :-------------------- |
| Node.js | `fnkit node <name>`   |     | Ruby    | `fnkit ruby <name>`   |
| Python  | `fnkit python <name>` |     | .NET    | `fnkit dotnet <name>` |
| Go      | `fnkit go <name>`     |     | PHP     | `fnkit php <name>`    |
| Java    | `fnkit java <name>`   |     | Dart    | `fnkit dart <name>`   |
| C++     | `fnkit cpp <name>`    |     |         |                       |

### MQTT (FnKit Function Framework)

| Runtime | Command                    |
| :------ | :------------------------- |
| Node.js | `fnkit node-mqtt <name>`   |
| Go      | `fnkit go-mqtt <name>`     |
| .NET    | `fnkit dotnet-mqtt <name>` |

## Commands

| Command                                    | Description                                 |
| :----------------------------------------- | :------------------------------------------ |
| `fnkit <runtime> <name>`                   | Create a new function project               |
| `fnkit init`                               | Initialize existing directory as a function |
| `fnkit dev`                                | Run function locally                        |
| `fnkit container ls\|logs\|stop`           | Manage deployed containers                  |
| `fnkit gateway init\|build\|start\|stop`   | Manage API gateway                          |
| `fnkit gateway orchestrate ...`            | Manage multi-function pipelines             |
| `fnkit cache init\|start\|stop`            | Manage shared Valkey cache                  |
| `fnkit proxy init\|add\|remove\|ls`        | Manage Caddy reverse proxy                  |
| `fnkit deploy setup\|init\|runner\|status` | Manage CI/CD pipelines                      |
| `fnkit mqtt uns\|cache\|log\|status`       | MQTT / UNS plugin commands                  |
| `fnkit image build\|push`                  | Build & push Docker images                  |
| `fnkit doctor [runtime]`                   | Check runtime dependencies                  |

## Documentation

- **[Installation]({% link docs/installation.md %})** — Binary downloads, building from source
- **[Getting Started]({% link docs/getting-started.md %})** — Create, develop, and deploy your first function
- **[Runtimes]({% link docs/runtimes.md %})** — All supported runtimes and frameworks
- **[Commands]({% link docs/commands.md %})** — Complete CLI reference with all flags and options
- **[API Gateway]({% link docs/gateway.md %})** — Token auth, routing, and orchestrator pipelines
- **[Shared Cache]({% link docs/cache.md %})** — Valkey cache setup with language-specific examples
- **[Reverse Proxy]({% link docs/proxy.md %})** — Automatic HTTPS and domain management via Caddy
- **[Deploy Pipelines]({% link docs/deploy.md %})** — Git-push-to-deploy with Forgejo or GitHub Actions
- **[MQTT Functions]({% link docs/mqtt.md %})** — Event-driven functions with MQTT topics
- **[UNS Plugin]({% link docs/uns-plugin.md %})** — Industrial IoT: MQTT monitor → cache → PostgreSQL logger
- **[Production Deployment]({% link docs/production.md %})** — Full server setup guide
