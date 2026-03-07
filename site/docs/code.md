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
                                                      ├── Extension support
                                                      └── Persistent config & workspace
```

Code-server runs on `fnkit-network` and is accessed directly through Caddy — it bypasses the API gateway since it has its own password authentication.

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
```

| Option | Description |
|:-------|:------------|
| `--password` | Password to access code-server (default: changeme) |
| `--sudo-password` | Sudo password inside the container |
| `--tz` | Timezone (default: Europe/Madrid) |

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

## Persistent Data

All configuration and workspace files are stored in the `fnkit-code-config` Docker volume:

- `/config/workspace` — Default workspace directory
- `/config/data` — VS Code settings, extensions, state
- `/config/.config` — code-server configuration

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
- Install system packages with sudo inside the integrated terminal
- Extensions are persisted in the config volume
- To reset everything: `docker volume rm fnkit-code-config`
- Uses the [linuxserver/code-server](https://github.com/linuxserver/docker-code-server) image
