# Reverse Proxy

FnKit uses [Caddy](https://caddyserver.com/) as a reverse proxy for automatic HTTPS and domain management. Caddy handles TLS certificate provisioning and renewal via Let's Encrypt — no manual certificate management required.

## Architecture

```
Internet → Caddy (ports 80/443, auto-TLS) → fnkit-gateway (port 8080, auth) → Function containers
```

Caddy sits in front of the gateway on `fnkit-network`, terminates TLS, and forwards requests to the gateway which handles authentication and routing.

## Quick Start

```bash
# Create proxy project files
fnkit proxy init

# Add a domain route
fnkit proxy add api.example.com

# Start the proxy
cd fnkit-proxy && docker compose up -d
```

Make sure the gateway is running first:

```bash
fnkit gateway init && fnkit gateway build && fnkit gateway start --token secret
```

## Adding Domains

### Using the CLI

```bash
fnkit proxy add api.example.com
fnkit proxy add docs.example.com
```

Each domain is added to the Caddyfile and routes to `fnkit-gateway:8080`.

### Editing the Caddyfile Manually

You can also edit `fnkit-proxy/Caddyfile` directly:

```caddy
api.example.com {
    reverse_proxy fnkit-gateway:8080
}

docs.example.com {
    reverse_proxy fnkit-gateway:8080
}
```

After editing, reload Caddy:

```bash
docker exec fnkit-proxy caddy reload --config /etc/caddy/Caddyfile
```

## Managing Domains

```bash
# List all configured domains
fnkit proxy ls

# Remove a domain
fnkit proxy remove api.example.com
```

After adding or removing domains, reload Caddy to apply changes:

```bash
docker exec fnkit-proxy caddy reload --config /etc/caddy/Caddyfile
```

## DNS Setup

Point your domain's DNS records to your server:

1. **A record** — Your server's IPv4 address
2. **AAAA record** (optional) — Your server's IPv6 address

Once DNS is pointing correctly, Caddy automatically provisions TLS certificates via Let's Encrypt or ZeroSSL. No configuration needed.

## How It Works

1. **Caddy** listens on ports 80 and 443
2. Incoming requests are matched by domain name
3. Caddy terminates TLS (certificates auto-provisioned)
4. Request is proxied to `fnkit-gateway:8080` on the Docker network
5. The gateway handles authentication and routes to the correct function container

## Local Development

For local development, use `localhost` domains. Caddy serves self-signed certificates automatically:

```caddy
localhost {
    reverse_proxy fnkit-gateway:8080
}
```

## Proxy Project Files

`fnkit proxy init` creates a `fnkit-proxy/` directory with:

| File                 | Purpose                               |
| -------------------- | ------------------------------------- |
| `Caddyfile`          | Domain routes and proxy configuration |
| `docker-compose.yml` | Caddy container with volume mounts    |
| `README.md`          | Proxy-specific documentation          |

## Docker Volumes

| Volume         | Purpose                                |
| -------------- | -------------------------------------- |
| `caddy-data`   | TLS certificates and ACME account data |
| `caddy-config` | Caddy runtime configuration            |

These volumes persist across container restarts, so certificates survive redeployments.

## Ports

| Port    | Purpose                                                             |
| ------- | ------------------------------------------------------------------- |
| 80      | HTTP — required for ACME HTTP challenges (certificate provisioning) |
| 443     | HTTPS — serves your domains with auto-provisioned TLS               |
| 443/udp | HTTP/3 (QUIC) support                                               |

## Notes

- Port 80 must be open for Let's Encrypt certificate provisioning
- Caddy automatically redirects HTTP → HTTPS
- Certificate renewal happens automatically before expiry
- For production, ensure your firewall allows ports 80 and 443

---

← [Back to README](../README.md) · [Gateway →](gateway.md) · [Deploy →](deploy.md)
