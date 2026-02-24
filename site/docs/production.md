---
layout: default
title: Production Deployment
nav_order: 12
---

# Production Deployment

A step-by-step guide to deploying the full FnKit platform on a bare server — from Docker setup to git-push-to-deploy with automatic HTTPS.

## Overview

By the end of this guide you'll have:

- Docker and the `fnkit-network`
- The API gateway with token authentication
- A shared Valkey cache
- Automatic HTTPS via Caddy + Let's Encrypt
- Git-push-to-deploy (via remote hook — no Forgejo needed)
- Functions deployed in any of the 12 supported runtimes

```
Internet → Caddy (443, auto-TLS) → Gateway (8080, auth) → Function containers
                                                              ↑
                                              git push → post-receive hook → deploy
```

## Prerequisites

- A server (Ubuntu 22.04+ recommended) with a public IP
- A domain name pointing to the server (e.g. `api.example.com`)
- SSH access to the server

## 1. Server Setup

### Install Docker

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker
```

### Install fnkit

```bash
# For x64 Linux
curl -L https://github.com/functionkit/fnkit/releases/latest/download/fnkit-linux-x64 -o fnkit
chmod +x fnkit && ./fnkit install
```

### Create the Docker Network

```bash
docker network create fnkit-network
```

All FnKit components communicate over this network.

### Basic Hardening (recommended)

```bash
# Enable firewall
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# Add swap (if not present)
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 2. API Gateway

```bash
fnkit gateway init
fnkit gateway build
fnkit gateway start --token your-secret-token
```

Test it:

```bash
curl http://localhost:8080/health
# → OK
```

See [Gateway docs](gateway.md) for authentication details and orchestrator setup.

## 3. Shared Cache (optional)

```bash
fnkit cache init
fnkit cache start
```

Functions can now connect at `redis://fnkit-cache:6379`. See [Cache docs](cache.md).

## 4. HTTPS with Caddy

```bash
fnkit proxy init
fnkit proxy add api.example.com
```

```bash
cd fnkit-proxy && docker compose up -d
```

Make sure DNS A records point to your server. Caddy provisions TLS certificates automatically.

See [Proxy docs](proxy.md) for more details.

## 5. Deploy a Function

On your local machine:

```bash
# Create a function
fnkit node my-api
cd my-api

# Set up remote deploy (one-time)
fnkit deploy remote --host root@your-server

# Push to deploy
git add . && git commit -m "init" && git push deploy main
```

The post-receive hook builds the image, deploys the container, and runs a health check — all on the server. No Forgejo, no runner, no workflow files.

### Verify

```bash
# Check the container is running
curl -H "Authorization: Bearer your-secret-token" https://api.example.com/my-api
```

## Architecture Summary

```
Internet
  │
  └── api.example.com → Caddy (443) → fnkit-gateway (8080) → function containers
                                                                ├── my-api
                                                                ├── my-other-api
                                                                └── ...
                                                                  ↑
                                              git push deploy main → post-receive hook
                                              (bare repo at /opt/fnkit/repos/*.git)
```

## Deploying More Functions

Each function is an independent git repository:

```bash
fnkit python another-function
cd another-function
fnkit deploy remote --host root@your-server
git add . && git commit -m "init" && git push deploy main
```

It's automatically available at `https://api.example.com/another-function`.

## Alternative: Forgejo + Runner

If you want a web UI for git repos, pull requests, and issues, you can use Forgejo instead of bare repos. See [Deploy docs](deploy.md) for Forgejo and GitHub Actions setup.

## Troubleshooting

### Container won't start

```bash
# Check logs
docker logs my-api

# Check if it's on the right network
docker inspect my-api --format '{{json .NetworkSettings.Networks}}'
```

### Gateway returns 502

The function container isn't running or isn't on `fnkit-network`:

```bash
# List fnkit containers
fnkit container ls

# Check the container is on fnkit-network
docker network inspect fnkit-network
```

### Runner not picking up jobs

```bash
# Check runner logs
docker logs forgejo-runner

# Verify runner is registered
# Site Administration → Actions → Runners
```

### TLS certificate not provisioning

- Ensure DNS A record points to your server
- Ensure ports 80 and 443 are open
- Check Caddy logs: `docker logs fnkit-proxy`

### Build fails for a specific runtime

```bash
# Check runtime dependencies
fnkit doctor <runtime>

# Common issues:
# - Java: needs Maven (mvn)
# - C++: needs CMake
# - .NET: needs dotnet SDK
```

---

← [Back to README](../README.md) · [Deploy →](deploy.md)
