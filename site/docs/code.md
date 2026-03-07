---
layout: default
title: Code-Server
nav_order: 13
---

# Code-Server

FnKit includes a built-in [code-server](https://github.com/coder/code-server) integration — VS Code in the browser. Access a full development environment from anywhere, with automatic HTTPS via the Caddy proxy.

## Architecture

```
Browser → Caddy (code.example.com, auto-TLS) → fnkit-code:8443 (code-server)
                                                      ├── Full VS Code IDE
                                                      ├── Integrated terminal
                                                      ├── Host filesystem access
                                                      ├── Docker CLI + fnkit CLI
                                                      └── Persistent config & extensions
```

Code-server runs on `fnkit-network` and is accessed directly through Caddy — it bypasses the API gateway since it has its own password authentication.

## What's Included

Code-server starts with full host access out of the box:

| Feature | How |
|:--------|:----|
| **Host filesystem** | Your home directory is mounted as the workspace |
| **Docker CLI** | Docker socket mounted — run `docker ps`, `docker logs` |
| **fnkit CLI** | Auto-installed from GitHub releases on first startup |
| **Extensions** | Persisted in Docker volume across restarts |

When you open code-server, you'll see your host files directly:

```
📁 fnkit/
📁 fnkit-cache/
📁 fnkit-gateway/
📁 fnkit-proxy/
📁 fnkit-runner/
📁 ...
```

And from the integrated terminal:

```bash
fnkit container ls          # manage containers
fnkit cache start           # start services
docker ps                   # docker access
```

## Quick Start

```bash
# Create code-server project files
fnkit code init

# Configure passwords
cd fnkit-code
cp .env.example .env
# Edit .env with your passwords

# Start code-server
fnkit code start --password your-secret

# Access at http://localhost:8443
```

## Setup

### 1. Initialize

```bash
fnkit code init
```

Creates a `fnkit-code/` directory with:

| File | Purpose |
|:-----|:--------|
| `docker-compose.yml` | code-server container configuration |
| `.env.example` | Environment variable template |
| `README.md` | Code-server-specific documentation |

### 2. Start

```bash
# With default password ("changeme")
fnkit code start

# With a custom password
fnkit code start --password your-secret

# With all options
fnkit code start --password your-secret --sudo-password your-sudo --tz Europe/London

# Mount a specific host directory as workspace
fnkit code start --workspace /home/deploy
```

| Option | Description |
|:-------|:------------|
| `--password` | Password to access code-server (default: changeme) |
| `--sudo-password` | Sudo password inside the container |
| `--workspace` | Host directory to mount as workspace (default: /root) |
| `--tz` | Timezone (default: Europe/Madrid) |

On first start, code-server automatically:
1. Mounts your host directory as the workspace
2. Mounts the Docker socket for container management
3. Installs the `fnkit` CLI binary from GitHub releases
4. Installs the Docker CLI inside the container

### 3. Add a Domain (optional)

Route a domain through the Caddy proxy for automatic HTTPS:

```bash
fnkit code proxy code.example.com
```

This adds a Caddy route directly to `fnkit-code:8443` (not through the gateway). Make sure the proxy is running:

```bash
fnkit proxy init    # if not already done
cd fnkit-proxy && docker compose up -d
```

Then reload Caddy:

```bash
docker exec fnkit-proxy caddy reload --config /etc/caddy/Caddyfile
```

### 4. Stop

```bash
fnkit code stop
```

Data persists in the `fnkit-code-config` Docker volume.

## Configuration

| Variable | Default | Description |
|:---------|:--------|:------------|
| `PASSWORD` | changeme | Password to access code-server |
| `SUDO_PASSWORD` | changeme | Sudo password inside the container |
| `TZ` | Europe/Madrid | Container timezone |
| `WORKSPACE` | /root | Host directory to mount as workspace |

## Host Access

### Filesystem

The host's home directory (default `/root`) is bind-mounted into the container at `/config/workspace`. This is set as the default workspace, so code-server opens directly into your host files.

### Docker

The Docker socket (`/var/run/docker.sock`) is mounted into the container. This means you can run any Docker command from code-server's integrated terminal:

```bash
docker ps                    # list containers
docker logs fnkit-gateway    # view logs
docker restart fnkit-cache   # restart services
```

### fnkit CLI

The fnkit binary is automatically downloaded from [GitHub releases](https://github.com/functionkit/fnkit/releases) and installed to `/usr/local/bin/fnkit` on container startup. It's updated on each restart.

```bash
fnkit --version              # check version
fnkit container ls           # list fnkit containers
fnkit cache start            # start cache
fnkit deploy status          # check deploy status
```

## Persistent Data

All configuration and workspace files are stored in the `fnkit-code-config` Docker volume:

- `/config/workspace` — Mounted host directory (your home)
- `/config/data` — VS Code settings, extensions, state
- `/config/.config` — code-server configuration
- `/config/custom-cont-init.d/` — Startup scripts (fnkit + docker install)

Data survives container restarts and upgrades.

## Docker Compose

For teams that prefer `docker compose`, the generated `docker-compose.yml` can be used directly:

```bash
cd fnkit-code
cp .env.example .env
# Edit .env
docker compose up -d
```

## Notes

- Code-server has its own password authentication (separate from the fnkit gateway)
- The proxy routes directly to code-server (bypasses the gateway)
- Runs as root (PUID=0) so fnkit and docker commands work without permission issues
- The Docker socket is mounted so you can manage all containers from the terminal
- fnkit is pulled from GitHub releases and auto-updated on each container restart
- Extensions are persisted in the config volume
- To reset everything: `docker volume rm fnkit-code-config`
- Uses the [linuxserver/code-server](https://github.com/linuxserver/docker-code-server) image
