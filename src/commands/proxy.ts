// Proxy command - Caddy reverse proxy for TLS/domain management
// Replaces the need for external platforms to manage domains and HTTPS certificates

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import logger from '../utils/logger'

const PROXY_DIR = 'fnkit-proxy'

const CADDYFILE = `# FnKit Proxy — Caddy reverse proxy with automatic HTTPS
# Manages TLS certificates and routes domains to the fnkit-gateway
#
# Add domain routes below. Each entry maps a domain to the gateway.
# Caddy automatically provisions and renews TLS certificates via Let's Encrypt.
#
# Usage:
#   fnkit proxy add <domain>              — Add a domain route
#   Or manually edit this file and reload: docker exec fnkit-proxy caddy reload --config /etc/caddy/Caddyfile

# Example: route a domain to the fnkit-gateway
# api.example.com {
#     reverse_proxy fnkit-gateway:8080
# }
`

const PROXY_DOCKER_COMPOSE = `# FnKit Proxy — Caddy for automatic HTTPS and domain routing
# Routes external domains to the fnkit-gateway with automatic TLS
#
# Setup:
#   1. Edit Caddyfile to add your domain routes
#   2. Run: docker compose up -d
#   3. Point your DNS A/AAAA records to this server

services:
  caddy:
    image: caddy:2-alpine
    container_name: fnkit-proxy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
      - caddy-config:/config
    networks:
      - fnkit-network
    labels:
      - fnkit.proxy=true

volumes:
  caddy-data:
  caddy-config:

networks:
  fnkit-network:
    name: fnkit-network
    external: true
`

const PROXY_README = `# FnKit Proxy

Caddy-based reverse proxy with automatic HTTPS for your FnKit platform.
Handles TLS certificate provisioning and domain routing — no external platform needed.

## Architecture

\`\`\`
Internet → Caddy (TLS/domains, ports 80/443) → fnkit-gateway (auth, port 8080) → Function containers
\`\`\`

## Quick Start

\`\`\`bash
# Make sure fnkit-network exists and gateway is running
docker network create fnkit-network 2>/dev/null || true

# Start the proxy
docker compose up -d

# Add a domain route
# Edit Caddyfile and add:
#   api.example.com {
#       reverse_proxy fnkit-gateway:8080
#   }

# Reload Caddy to pick up changes
docker exec fnkit-proxy caddy reload --config /etc/caddy/Caddyfile
\`\`\`

## Adding Domains

### Option 1: Use the CLI

\`\`\`bash
fnkit proxy add api.example.com
\`\`\`

### Option 2: Edit Caddyfile manually

Add a block for each domain:

\`\`\`caddy
api.example.com {
    reverse_proxy fnkit-gateway:8080
}

docs.example.com {
    reverse_proxy fnkit-gateway:8080
}
\`\`\`

Then reload:

\`\`\`bash
docker exec fnkit-proxy caddy reload --config /etc/caddy/Caddyfile
\`\`\`

## DNS Setup

Point your domain's A record (and optionally AAAA for IPv6) to your server's IP address.
Caddy automatically provisions TLS certificates via Let's Encrypt once DNS is pointing correctly.

## How It Works

1. **Caddy** listens on ports 80 and 443
2. Incoming requests are matched by domain name
3. Caddy terminates TLS (auto-provisioned via Let's Encrypt / ZeroSSL)
4. Request is proxied to \`fnkit-gateway:8080\` on the Docker network
5. The gateway handles authentication and routes to the correct function container

## Notes

- Caddy data (certificates) persists in the \`caddy-data\` volume
- Caddy configuration persists in the \`caddy-config\` volume
- Port 80 is required for ACME HTTP challenges (certificate provisioning)
- For local development, use \`localhost\` domains (Caddy serves self-signed certs)
`

export interface ProxyOptions {
  output?: string
  domain?: string
}

export async function proxyInit(options: ProxyOptions = {}): Promise<boolean> {
  const outputDir = options.output || PROXY_DIR
  const targetDir = resolve(process.cwd(), outputDir)

  logger.title('Creating FnKit Proxy (Caddy)')

  if (existsSync(targetDir)) {
    logger.error(`Directory already exists: ${outputDir}`)
    return false
  }

  // Create directory
  mkdirSync(targetDir, { recursive: true })

  // Write files
  const files: Record<string, string> = {
    Caddyfile: CADDYFILE.trim(),
    'docker-compose.yml': PROXY_DOCKER_COMPOSE.trim(),
    'README.md': PROXY_README.trim(),
  }

  for (const [filename, content] of Object.entries(files)) {
    const filePath = join(targetDir, filename)
    writeFileSync(filePath, content)
    logger.success(`Created ${filename}`)
  }

  logger.newline()
  logger.success(`Proxy created in ${outputDir}/`)
  logger.newline()

  console.log(
    '╔════════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║               🔒 Proxy Setup Steps                           ║',
  )
  console.log(
    '╚════════════════════════════════════════════════════════════════╝',
  )
  console.log('')
  console.log('   1. Ensure the gateway is running:')
  console.log(
    '      fnkit gateway init && fnkit gateway build && fnkit gateway start',
  )
  console.log('')
  console.log('   2. Add a domain route:')
  console.log(`      fnkit proxy add api.example.com`)
  console.log('      (or edit Caddyfile manually)')
  console.log('')
  console.log('   3. Start the proxy:')
  console.log(`      cd ${outputDir} && docker compose up -d`)
  console.log('')
  console.log('   4. Point your DNS to this server')
  console.log('      Caddy auto-provisions TLS certificates')
  console.log('')
  console.log('   Architecture:')
  console.log('   Internet → Caddy (443) → Gateway (8080) → Functions')
  console.log('')

  return true
}

export async function proxyAdd(
  domain: string,
  options: ProxyOptions = {},
): Promise<boolean> {
  const proxyDir = options.output || PROXY_DIR
  const caddyfilePath = resolve(process.cwd(), proxyDir, 'Caddyfile')

  logger.title(`Adding domain: ${domain}`)

  if (!existsSync(caddyfilePath)) {
    logger.error(`Caddyfile not found at ${proxyDir}/Caddyfile`)
    logger.info('Run "fnkit proxy init" first to create the proxy')
    return false
  }

  // Read current Caddyfile
  const currentContent = readFileSync(caddyfilePath, 'utf-8')

  // Check if domain already exists
  if (currentContent.includes(`${domain} {`)) {
    logger.error(`Domain "${domain}" already exists in Caddyfile`)
    return false
  }

  // Append new domain block
  const domainBlock = `
${domain} {
    reverse_proxy fnkit-gateway:8080
}
`

  writeFileSync(caddyfilePath, currentContent + domainBlock)
  logger.success(`Added ${domain} → fnkit-gateway:8080`)
  logger.newline()
  logger.info('Reload the proxy to apply:')
  logger.dim(
    '  docker exec fnkit-proxy caddy reload --config /etc/caddy/Caddyfile',
  )
  logger.newline()
  logger.info('Make sure DNS for this domain points to your server.')
  logger.newline()

  return true
}

export async function proxyRemove(
  domain: string,
  options: ProxyOptions = {},
): Promise<boolean> {
  const proxyDir = options.output || PROXY_DIR
  const caddyfilePath = resolve(process.cwd(), proxyDir, 'Caddyfile')

  logger.title(`Removing domain: ${domain}`)

  if (!existsSync(caddyfilePath)) {
    logger.error(`Caddyfile not found at ${proxyDir}/Caddyfile`)
    return false
  }

  const currentContent = readFileSync(caddyfilePath, 'utf-8')

  // Remove the domain block (domain { ... })
  const regex = new RegExp(
    `\\n${domain.replace(/\./g, '\\.')} \\{[^}]*\\}\\n?`,
    'g',
  )
  const newContent = currentContent.replace(regex, '\n')

  if (newContent === currentContent) {
    logger.error(`Domain "${domain}" not found in Caddyfile`)
    return false
  }

  writeFileSync(caddyfilePath, newContent)
  logger.success(`Removed ${domain}`)
  logger.newline()
  logger.info('Reload the proxy to apply:')
  logger.dim(
    '  docker exec fnkit-proxy caddy reload --config /etc/caddy/Caddyfile',
  )
  logger.newline()

  return true
}

export async function proxyList(options: ProxyOptions = {}): Promise<boolean> {
  const proxyDir = options.output || PROXY_DIR
  const caddyfilePath = resolve(process.cwd(), proxyDir, 'Caddyfile')

  logger.title('FnKit Proxy Domains')

  if (!existsSync(caddyfilePath)) {
    logger.error(`Caddyfile not found at ${proxyDir}/Caddyfile`)
    logger.info('Run "fnkit proxy init" first to create the proxy')
    return false
  }

  const content = readFileSync(caddyfilePath, 'utf-8')

  // Extract domain blocks
  const domainRegex = /^([a-zA-Z0-9._-]+(?:\.[a-zA-Z]{2,})+)\s*\{/gm
  const domains: string[] = []
  let match

  while ((match = domainRegex.exec(content)) !== null) {
    domains.push(match[1])
  }

  if (domains.length === 0) {
    logger.info('No domains configured')
    logger.newline()
    logger.dim('  Add a domain: fnkit proxy add api.example.com')
    logger.newline()
    return true
  }

  console.log('')
  for (const domain of domains) {
    console.log(`   🌐 ${domain} → fnkit-gateway:8080`)
  }
  console.log('')
  logger.info(
    `${domains.length} domain${domains.length > 1 ? 's' : ''} configured`,
  )
  logger.newline()

  return true
}

export async function proxy(
  subcommand: string,
  options: ProxyOptions = {},
): Promise<boolean> {
  switch (subcommand) {
    case 'init':
      return proxyInit(options)
    case 'add':
      if (!options.domain) {
        logger.error('Usage: fnkit proxy add <domain>')
        return false
      }
      return proxyAdd(options.domain, options)
    case 'remove':
    case 'rm':
      if (!options.domain) {
        logger.error('Usage: fnkit proxy remove <domain>')
        return false
      }
      return proxyRemove(options.domain, options)
    case 'ls':
    case 'list':
      return proxyList(options)
    default:
      logger.error(`Unknown proxy command: ${subcommand}`)
      logger.info('Available commands: init, add, remove, ls')
      logger.newline()
      logger.dim('  fnkit proxy init                — Create Caddy proxy setup')
      logger.dim('  fnkit proxy add <domain>        — Add domain route')
      logger.dim('  fnkit proxy remove <domain>     — Remove domain route')
      logger.dim('  fnkit proxy ls                  — List configured domains')
      return false
  }
}

export default proxy
