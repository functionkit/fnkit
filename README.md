# FnKit — Functions as a Service CLI

Scaffold, develop, and deploy serverless functions using Docker and Git push. No external platforms required.

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

→ [Full installation guide](docs/installation.md) · [Getting started tutorial](docs/getting-started.md)

## Features

| Feature                       | Description                                                        | Docs                                                   |
| ----------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| **Multi-runtime scaffolding** | Create functions in 9 HTTP runtimes + 3 MQTT runtimes              | [Runtimes](docs/runtimes.md)                           |
| **Local development**         | `fnkit dev` runs your function locally with hot reload             | [Getting started](docs/getting-started.md)             |
| **API Gateway**               | Nginx-based auth gateway with token validation and routing         | [Gateway](docs/gateway.md)                             |
| **Orchestrator**              | Multi-function pipelines — sequential chaining or parallel fan-out | [Gateway → Orchestrator](docs/gateway.md#orchestrator) |
| **Shared Cache**              | Redis-compatible Valkey cache accessible by all functions          | [Cache](docs/cache.md)                                 |
| **Reverse Proxy**             | Automatic HTTPS via Caddy with Let's Encrypt                       | [Proxy](docs/proxy.md)                                 |
| **Git-push Deploy**           | CI/CD via Forgejo Actions or GitHub Actions                        | [Deploy](docs/deploy.md)                               |
| **MQTT Functions**            | Event-driven functions that subscribe to MQTT topics               | [MQTT](docs/mqtt.md)                                   |
| **Container Management**      | List, log, and stop deployed function containers                   | [Commands](docs/commands.md#containers)                |

## Supported Runtimes

### HTTP (Google Cloud Functions Framework)

| Runtime | Command               |     | Runtime | Command               |
| ------- | --------------------- | --- | ------- | --------------------- |
| Node.js | `fnkit node <name>`   |     | Ruby    | `fnkit ruby <name>`   |
| Python  | `fnkit python <name>` |     | .NET    | `fnkit dotnet <name>` |
| Go      | `fnkit go <name>`     |     | PHP     | `fnkit php <name>`    |
| Java    | `fnkit java <name>`   |     | Dart    | `fnkit dart <name>`   |
| C++     | `fnkit cpp <name>`    |     |         |                       |

### MQTT (FnKit Function Framework)

| Runtime | Command                    |
| ------- | -------------------------- |
| Node.js | `fnkit node-mqtt <name>`   |
| Go      | `fnkit go-mqtt <name>`     |
| .NET    | `fnkit dotnet-mqtt <name>` |

→ [Full runtime details](docs/runtimes.md) · [MQTT deep dive](docs/mqtt.md)

## Commands

| Command                                    | Description                                 |
| ------------------------------------------ | ------------------------------------------- |
| `fnkit <runtime> <name>`                   | Create a new function project               |
| `fnkit init`                               | Initialize existing directory as a function |
| `fnkit dev`                                | Run function locally                        |
| `fnkit container ls\|logs\|stop`           | Manage deployed containers                  |
| `fnkit gateway init\|build\|start\|stop`   | Manage API gateway                          |
| `fnkit gateway orchestrate ...`            | Manage multi-function pipelines             |
| `fnkit cache init\|start\|stop`            | Manage shared Valkey cache                  |
| `fnkit proxy init\|add\|remove\|ls`        | Manage Caddy reverse proxy                  |
| `fnkit deploy setup\|init\|runner\|status` | Manage CI/CD pipelines                      |
| `fnkit image build\|push`                  | Build & push Docker images                  |
| `fnkit doctor [runtime]`                   | Check runtime dependencies                  |

→ [Full command reference](docs/commands.md)

## Documentation

- **[Installation](docs/installation.md)** — Binary downloads, building from source
- **[Getting Started](docs/getting-started.md)** — Create, develop, and deploy your first function
- **[Runtimes](docs/runtimes.md)** — All supported runtimes and frameworks
- **[Commands](docs/commands.md)** — Complete CLI reference with all flags and options
- **[API Gateway](docs/gateway.md)** — Token auth, routing, and orchestrator pipelines
- **[Shared Cache](docs/cache.md)** — Valkey cache setup with language-specific examples
- **[Reverse Proxy](docs/proxy.md)** — Automatic HTTPS and domain management via Caddy
- **[Deploy Pipelines](docs/deploy.md)** — Git-push-to-deploy with Forgejo or GitHub Actions
- **[MQTT Functions](docs/mqtt.md)** — Event-driven functions with MQTT topics
- **[Production Deployment](docs/production.md)** — Full server setup guide

## Development

```bash
bun run dev help          # Run in development mode
bun run build             # Build binary
bun run build:all         # Build for all platforms
bun run typecheck         # Type check
```

## License

MIT
