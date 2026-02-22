# Production Deployment

A step-by-step guide to deploying the full FnKit platform on a bare server — from Docker setup to git-push-to-deploy with automatic HTTPS.

## Overview

By the end of this guide you'll have:

- Docker and the `fnkit-network`
- The API gateway with token authentication
- A shared Valkey cache
- Automatic HTTPS via Caddy + Let's Encrypt
- Self-hosted Forgejo for git + CI/CD
- A Forgejo Actions runner for git-push-to-deploy
- Functions deployed in any of the 12 supported runtimes

```
Internet → Caddy (443, auto-TLS) → Gateway (8080, auth) → Function containers
                                                              ↑
                                              Forgejo + Runner (git push → deploy)
```

## Prerequisites

- A server (Ubuntu 22.04+ recommended) with a public IP
- A domain name pointing to the server (e.g. `api.example.com`, `git.example.com`)
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

## 4. Forgejo (Git + CI/CD)

Forgejo is a lightweight, self-hosted Git forge with built-in CI/CD (Actions).

### Install Forgejo

Create a `forgejo/` directory and a `docker-compose.yml`:

```yaml
services:
  forgejo:
    image: codeberg.org/forgejo/forgejo:9
    container_name: forgejo
    restart: unless-stopped
    ports:
      - '3000:3000'
      - '2222:22'
    volumes:
      - forgejo-data:/data
    environment:
      - USER_UID=1000
      - USER_GID=1000
      - FORGEJO__actions__ENABLED=true
    networks:
      - fnkit-network

volumes:
  forgejo-data:

networks:
  fnkit-network:
    name: fnkit-network
    external: true
```

```bash
docker compose up -d
```

Visit `http://your-server:3000` to complete the initial setup wizard.

### Enable Actions

If not set via environment variable, enable in: **Site Administration → Actions → Enable**

## 5. Forgejo Runner

```bash
fnkit deploy runner
cd fnkit-runner
cp .env.example .env
```

Edit `.env`:

```env
FORGEJO_INSTANCE=https://git.example.com
FORGEJO_RUNNER_TOKEN=your-registration-token
```

Get the registration token from: **Site Administration → Actions → Runners → Create new runner**

```bash
docker compose up -d
```

Verify the runner appears in **Site Administration → Actions → Runners**.

See [Deploy docs](deploy.md) for full runner configuration.

## 6. HTTPS with Caddy

```bash
fnkit proxy init
fnkit proxy add api.example.com
fnkit proxy add git.example.com
```

Edit `fnkit-proxy/Caddyfile` to customise the Forgejo route (it needs to proxy to port 3000, not the gateway):

```caddy
api.example.com {
    reverse_proxy fnkit-gateway:8080
}

git.example.com {
    reverse_proxy forgejo:3000
}
```

```bash
cd fnkit-proxy && docker compose up -d
```

Make sure DNS A records for both domains point to your server. Caddy provisions TLS certificates automatically.

See [Proxy docs](proxy.md) for more details.

## 7. Deploy a Function

On your local machine:

```bash
# Create a function
fnkit node my-api
cd my-api

# Add the Forgejo remote
git remote add origin https://git.example.com/your-user/my-api.git

# Set up the deploy pipeline
fnkit deploy init

# Push to deploy
git add . && git commit -m "init" && git push -u origin main
```

The runner builds the image, deploys the container, and runs a health check.

### Verify

```bash
# Check the container is running
curl -H "Authorization: Bearer your-secret-token" https://api.example.com/my-api
```

## Architecture Summary

```
Internet
  │
  ├── api.example.com → Caddy (443) → fnkit-gateway (8080) → function containers
  │                                                              ├── my-api
  │                                                              ├── my-other-api
  │                                                              └── ...
  │
  └── git.example.com → Caddy (443) → Forgejo (3000)
                                          │
                                          └── push → runner → docker build → deploy
```

## Deploying More Functions

Each function is an independent git repository:

```bash
fnkit python another-function
cd another-function
git remote add origin https://git.example.com/your-user/another-function.git
fnkit deploy init
git add . && git commit -m "init" && git push -u origin main
```

It's automatically available at `https://api.example.com/another-function`.

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
