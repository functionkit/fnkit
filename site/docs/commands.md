---
layout: default
title: Command Reference
nav_order: 5
---

# Command Reference

Complete reference for all fnkit CLI commands, flags, and options.

Run `fnkit help` or `fnkit <command>` with no subcommand to see built-in help.

## Create & Develop

### `fnkit new <runtime> <name>`

Create a new function project.

```bash
fnkit new node my-api
fnkit new python my-api --remote git@github.com:user/my-api.git
```

| Option           | Description                       |
| ---------------- | --------------------------------- |
| `--remote`, `-r` | Git remote URL to add as `origin` |

### `fnkit <runtime> <name>`

Shorthand for `fnkit new`. All runtimes work as direct commands:

```bash
fnkit node my-api
fnkit python my-api
fnkit go my-api
fnkit java my-api
fnkit ruby my-api
fnkit dotnet my-api
fnkit php my-api
fnkit dart my-api
fnkit cpp my-api
fnkit node-mqtt my-handler
fnkit go-mqtt my-handler
fnkit dotnet-mqtt my-handler
```

### `fnkit init`

Initialize an existing directory as a function project. Detects the runtime from existing files.

```bash
fnkit init
fnkit init --runtime python
```

| Option      | Description                                          |
| ----------- | ---------------------------------------------------- |
| `--runtime` | Specify runtime explicitly instead of auto-detecting |

### `fnkit dev`

Run the function locally using the runtime's development server.

```bash
fnkit dev
fnkit dev --port 3000
fnkit dev --target myFunction
```

| Option         | Description                       |
| -------------- | --------------------------------- |
| `--port`, `-p` | Port to listen on (default: 8080) |
| `--target`     | Function target name              |

## Containers

### `fnkit container ls`

List deployed fnkit function containers.

```bash
fnkit container ls
fnkit container ls --all
```

| Option  | Description                                              |
| ------- | -------------------------------------------------------- |
| `--all` | Show all Docker containers, not just fnkit-labelled ones |

### `fnkit container logs <name>`

Tail live logs from a running container.

```bash
fnkit container logs my-api
```

### `fnkit container stop <name>`

Stop a running container.

```bash
fnkit container stop my-api
```

## Gateway

Manage the API gateway. See [Gateway docs](gateway.md) for architecture and detailed usage.

### `fnkit gateway init`

Create the gateway project files (`fnkit-gateway/` directory).

```bash
fnkit gateway init
fnkit gateway init --output custom-dir
```

| Option     | Description                                 |
| ---------- | ------------------------------------------- |
| `--output` | Output directory (default: `fnkit-gateway`) |

### `fnkit gateway build`

Build the gateway Docker image.

```bash
fnkit gateway build
```

### `fnkit gateway start`

Start the gateway container.

```bash
fnkit gateway start --token your-secret
```

| Option    | Description                                                   |
| --------- | ------------------------------------------------------------- |
| `--token` | Bearer token for authentication. Omit for open mode (no auth) |

### `fnkit gateway stop`

Stop the gateway container.

```bash
fnkit gateway stop
```

### `fnkit gateway orchestrate add <name>`

Add a multi-function pipeline. Stored in the shared Valkey cache.

```bash
fnkit gateway orchestrate add process-order --steps validate,charge,notify --mode sequential
fnkit gateway orchestrate add enrich-user --steps profile,prefs,history --mode parallel
```

| Option    | Description                                       |
| --------- | ------------------------------------------------- |
| `--steps` | Comma-separated list of function names (required) |
| `--mode`  | `sequential` or `parallel` (required)             |

### `fnkit gateway orchestrate ls`

List all defined pipelines.

```bash
fnkit gateway orchestrate ls
```

### `fnkit gateway orchestrate remove <name>`

Remove a pipeline.

```bash
fnkit gateway orchestrate remove process-order
```

## Cache

Manage the shared Valkey cache. See [Cache docs](cache.md) for language-specific examples.

### `fnkit cache init`

Create cache project files (`fnkit-cache/` directory).

```bash
fnkit cache init
fnkit cache init --output custom-dir
```

| Option     | Description                               |
| ---------- | ----------------------------------------- |
| `--output` | Output directory (default: `fnkit-cache`) |

### `fnkit cache start`

Start the Valkey cache container on `fnkit-network`.

```bash
fnkit cache start
fnkit cache start --maxmemory 512mb
```

| Option        | Description                                  |
| ------------- | -------------------------------------------- |
| `--maxmemory` | Maximum memory allocation (default: `256mb`) |

### `fnkit cache stop`

Stop the cache container. Data persists in the Docker volume.

```bash
fnkit cache stop
```

## Proxy

Manage the Caddy reverse proxy. See [Proxy docs](proxy.md) for details.

### `fnkit proxy init`

Create the Caddy proxy project files (`fnkit-proxy/` directory).

```bash
fnkit proxy init
fnkit proxy init --output custom-dir
```

| Option     | Description                               |
| ---------- | ----------------------------------------- |
| `--output` | Output directory (default: `fnkit-proxy`) |

### `fnkit proxy add <domain>`

Add a domain route to the Caddyfile, pointing to the gateway.

```bash
fnkit proxy add api.example.com
```

### `fnkit proxy remove <domain>`

Remove a domain route from the Caddyfile.

```bash
fnkit proxy remove api.example.com
```

### `fnkit proxy ls`

List all configured domain routes.

```bash
fnkit proxy ls
```

## Deploy

Manage CI/CD deploy pipelines. See [Deploy docs](deploy.md) for full details.

### `fnkit deploy remote`

Set up git-push deploy via SSH. Creates a bare git repo on the server with a post-receive hook that builds and deploys your function container. No Forgejo or GitHub Actions needed.

```bash
fnkit deploy remote --host root@your-server
fnkit deploy remote                            # uses host from .fnkit
```

| Option   | Description                                          |
| -------- | ---------------------------------------------------- |
| `--host` | SSH host (e.g. `root@server.com`). Saved to `.fnkit` |

On the server, creates:
- Bare git repo at `/opt/fnkit/repos/<function>.git`
- Post-receive hook with build → deploy → health check → rollback

Locally:
- Adds `deploy` git remote
- Saves host to `.fnkit` config file

### `fnkit deploy setup`

Interactive setup wizard for Forgejo or GitHub Actions. Checks prerequisites, generates the deploy workflow, and prints a checklist.

```bash
fnkit deploy setup
fnkit deploy setup --provider github
```

| Option       | Description                     |
| ------------ | ------------------------------- |
| `--provider` | `forgejo` (default) or `github` |

### `fnkit deploy init`

Generate a deploy workflow file without the interactive wizard.

```bash
fnkit deploy init
fnkit deploy init --provider github
```

| Option       | Description                     |
| ------------ | ------------------------------- |
| `--provider` | `forgejo` (default) or `github` |

### `fnkit deploy runner`

Generate Forgejo Actions runner setup files (`fnkit-runner/` directory).

```bash
fnkit deploy runner
fnkit deploy runner --output custom-dir
```

| Option     | Description                                |
| ---------- | ------------------------------------------ |
| `--output` | Output directory (default: `fnkit-runner`) |

### `fnkit deploy status`

Check the deployment status — pipeline config, git status, and container health.

```bash
fnkit deploy status
```

## Images

### `fnkit image build`

Build a Docker image for the current function project.

```bash
fnkit image build
fnkit image build --tag myapp:v1
```

| Option        | Description                                             |
| ------------- | ------------------------------------------------------- |
| `--tag`, `-t` | Docker image tag (default: `fnkit-fn-<project>:latest`) |
| `--target`    | Function target name                                    |

### `fnkit image push`

Build and push a Docker image to a registry.

```bash
fnkit image push --registry ghcr.io
fnkit image push --registry ghcr.io --tag myapp:v1
```

| Option        | Description                             |
| ------------- | --------------------------------------- |
| `--tag`, `-t` | Docker image tag                        |
| `--registry`  | Docker registry URL (required for push) |
| `--target`    | Function target name                    |

## MQTT / UNS Plugin

Manage UNS (Unified Namespace) functions and OPC-UA bridges for industrial IoT data. See [MQTT docs](mqtt.md) for architecture and detailed usage.

### `fnkit mqtt opcua init [name]`

Create an OPC-UA → MQTT bridge project. A Go application that reads OPC-UA tags and publishes to MQTT topics. Runs as Docker container or standalone `.exe`.

```bash
fnkit mqtt opcua init                   # Creates opcua-bridge/
fnkit mqtt opcua init mill8-bridge      # Creates mill8-bridge/
```

### `fnkit mqtt opcua start [name]`

Build and start the OPC-UA bridge container.

```bash
fnkit mqtt opcua start
```

### `fnkit mqtt opcua stop [name]`

Stop the OPC-UA bridge container.

```bash
fnkit mqtt opcua stop
```

### `fnkit mqtt opcua build [name]`

Cross-compile standalone binaries for all platforms. Builds via Docker and extracts binaries to `dist/`.

```bash
fnkit mqtt opcua build
# → dist/opcua-bridge-linux-amd64
# → dist/opcua-bridge-linux-arm64
# → dist/opcua-bridge-windows-amd64.exe
# → dist/opcua-bridge-darwin-arm64
```

### `fnkit mqtt uns init [name]`

Create a UNS topic monitor project. A Go MQTT function that subscribes to `v1.0/#` and caches all topic data in Valkey.

```bash
fnkit mqtt uns init                   # Creates uns-framework/
fnkit mqtt uns init my-monitor        # Creates my-monitor/
```

### `fnkit mqtt uns start [name]`

Build and start the UNS monitor container.

```bash
fnkit mqtt uns start
```

### `fnkit mqtt uns stop [name]`

Stop the UNS monitor container.

```bash
fnkit mqtt uns stop
```

### `fnkit mqtt cache init [name]`

Create a UNS cache reader project. A Node.js HTTP function that reads cached topic data and returns JSON with change detection.

```bash
fnkit mqtt cache init                 # Creates uns-cache/
fnkit mqtt cache init my-reader       # Creates my-reader/
```

### `fnkit mqtt cache start [name]`

Build and start the UNS cache reader container.

```bash
fnkit mqtt cache start
```

### `fnkit mqtt cache stop [name]`

Stop the UNS cache reader container.

```bash
fnkit mqtt cache stop
```

### `fnkit mqtt log init [name]`

Create a UNS PostgreSQL logger project. A Go HTTP function that logs cache changes to PostgreSQL.

```bash
fnkit mqtt log init                   # Creates uns-log/
fnkit mqtt log init uns-log-line1     # Creates uns-log-line1/
```

### `fnkit mqtt log start [name]`

Build and start the UNS logger container.

```bash
fnkit mqtt log start
```

### `fnkit mqtt log stop [name]`

Stop the UNS logger container.

```bash
fnkit mqtt log stop
```

### `fnkit mqtt status`

Show status of all MQTT/UNS components.

```bash
fnkit mqtt status
```

## Observability

Manage observability — traces, events, metrics. See [Observability docs](observe.md) for full details.

### `fnkit observe`

Show the unified status dashboard — component health, recent events, and recent traces.

```bash
fnkit observe
fnkit observe status
```

### `fnkit observe events`

Show recent events — connections, errors, status changes.

```bash
fnkit observe events
fnkit observe events --count 100
```

| Option          | Description                            |
| --------------- | -------------------------------------- |
| `--count`, `-n` | Number of events to show (default: 50) |

### `fnkit observe traces`

Show recent request traces through the gateway.

```bash
fnkit observe traces
fnkit observe traces --count 100
```

| Option          | Description                            |
| --------------- | -------------------------------------- |
| `--count`, `-n` | Number of traces to show (default: 50) |

### `fnkit observe metrics`

Show per-container request counts, error rates, and last activity.

```bash
fnkit observe metrics
```

## Utilities

### `fnkit doctor [runtime]`

Check that runtime dependencies are installed and available.

```bash
fnkit doctor          # Check all runtimes
fnkit doctor node     # Check Node.js
fnkit doctor java     # Check Java + Maven
```

### `fnkit install`

Install the fnkit binary to `/usr/local/bin` for global access.

```bash
fnkit install
```

### `fnkit uninstall`

Remove the fnkit binary from `/usr/local/bin`.

```bash
fnkit uninstall
```

### `fnkit --version`

Print the current version.

```bash
fnkit --version
fnkit -v
```

### `fnkit help`

Show the help screen.

```bash
fnkit help
fnkit --help
fnkit -h
```

---

← [Back to README](../README.md)
