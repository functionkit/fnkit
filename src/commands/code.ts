// Code command - code-server (VS Code in the browser) for remote development

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import logger from '../utils/logger'
import * as docker from '../utils/docker'

const CODE_DIR = 'fnkit-code'
const CODE_IMAGE = 'lscr.io/linuxserver/code-server:latest'
const CODE_CONTAINER = 'fnkit-code'
const FNKIT_NETWORK = 'fnkit-network'

const CODE_ENV_EXAMPLE = `# FnKit Code — code-server environment variables
# Copy to .env and fill in your values

# Password to access code-server in the browser
PASSWORD=changeme

# Sudo password inside the container (for installing packages etc.)
SUDO_PASSWORD=changeme

# Timezone (default: Europe/Madrid)
TZ=Europe/Madrid
`

const CODE_DOCKER_COMPOSE = `# FnKit Code — code-server (VS Code in the browser)
# Provides a full VS Code IDE accessible via the browser
# Uses linuxserver/code-server for easy setup with persistent config
#
# Setup:
#   1. Copy .env.example to .env and set your passwords
#   2. Run: docker compose up -d
#   3. Access at http://localhost:8443 or via your domain

services:
  code-server:
    image: lscr.io/linuxserver/code-server:latest
    container_name: fnkit-code
    restart: unless-stopped
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=\${TZ:-Europe/Madrid}
      - PASSWORD=\${PASSWORD:-changeme}
      - SUDO_PASSWORD=\${SUDO_PASSWORD:-changeme}
      - DEFAULT_WORKSPACE=/config/workspace
    volumes:
      - code-server-config:/config
    networks:
      - fnkit-network
    labels:
      - fnkit.code=true
    healthcheck:
      test:
        - CMD
        - curl
        - '-f'
        - 'http://127.0.0.1:8443'
      interval: 2s
      timeout: 10s
      retries: 15

volumes:
  code-server-config:

networks:
  fnkit-network:
    name: fnkit-network
    external: true
`

const CODE_README = `# FnKit Code

VS Code in the browser powered by [code-server](https://github.com/coder/code-server).
Access a full development environment from anywhere — edit code, use the terminal,
install extensions, and develop your fnkit functions remotely.

## Architecture

\`\`\`
Browser → Caddy (code.example.com, TLS) → fnkit-code:8443 (code-server)
                                                ├── Full VS Code IDE
                                                ├── Integrated terminal
                                                ├── Extension support
                                                └── Persistent config & workspace
\`\`\`

## Quick Start

\`\`\`bash
# Make sure fnkit-network exists
docker network create fnkit-network 2>/dev/null || true

# Configure passwords
cp .env.example .env
# Edit .env with your passwords

# Start code-server
docker compose up -d

# Access at http://localhost:8443
\`\`\`

## Adding a Domain

Route a domain through the fnkit proxy (Caddy) for automatic HTTPS:

\`\`\`bash
fnkit code proxy code.example.com
\`\`\`

Or manually add to your Caddyfile:

\`\`\`caddy
code.example.com {
    reverse_proxy fnkit-code:8443
}
\`\`\`

Then reload Caddy:

\`\`\`bash
docker exec fnkit-proxy caddy reload --config /etc/caddy/Caddyfile
\`\`\`

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| \`PASSWORD\` | changeme | Password to access code-server |
| \`SUDO_PASSWORD\` | changeme | Sudo password inside the container |
| \`TZ\` | Europe/Madrid | Container timezone |

## Persistent Data

All configuration and workspace files are stored in the \`code-server-config\` Docker volume:

- \`/config/workspace\` — Default workspace directory
- \`/config/data\` — VS Code settings, extensions, state
- \`/config/.config\` — code-server configuration

Data survives container restarts and upgrades.

## Notes

- code-server has its own password authentication (separate from the fnkit gateway)
- The proxy routes directly to code-server (bypasses the gateway)
- Install system packages with sudo inside the integrated terminal
- Extensions are persisted in the config volume
- To reset everything: \`docker volume rm code-server-config\`
`

export interface CodeOptions {
  output?: string
  password?: string
  sudoPassword?: string
  tz?: string
  domain?: string
}

export async function codeInit(options: CodeOptions = {}): Promise<boolean> {
  const outputDir = options.output || CODE_DIR
  const targetDir = resolve(process.cwd(), outputDir)

  logger.title('Creating FnKit Code (code-server)')

  if (existsSync(targetDir)) {
    logger.error(`Directory already exists: ${outputDir}`)
    return false
  }

  // Create directory
  mkdirSync(targetDir, { recursive: true })

  // Write files
  const files: Record<string, string> = {
    'docker-compose.yml': CODE_DOCKER_COMPOSE.trim(),
    '.env.example': CODE_ENV_EXAMPLE.trim(),
    'README.md': CODE_README.trim(),
  }

  for (const [filename, content] of Object.entries(files)) {
    const filePath = join(targetDir, filename)
    writeFileSync(filePath, content)
    logger.success(`Created ${filename}`)
  }

  logger.newline()
  logger.success(`Code-server created in ${outputDir}/`)
  logger.newline()

  console.log(
    '╔════════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║               💻 Code-Server Setup Steps                     ║',
  )
  console.log(
    '╚════════════════════════════════════════════════════════════════╝',
  )
  console.log('')
  console.log('   1. Configure passwords:')
  console.log(`      cd ${outputDir}`)
  console.log('      cp .env.example .env')
  console.log('      # Edit .env with your passwords')
  console.log('')
  console.log('   2. Ensure the Docker network exists:')
  console.log('      docker network create fnkit-network 2>/dev/null || true')
  console.log('')
  console.log('   3. Start code-server:')
  console.log(`      cd ${outputDir} && docker compose up -d`)
  console.log('')
  console.log('   4. Access at http://localhost:8443')
  console.log('')
  console.log('   5. (Optional) Add a domain with HTTPS:')
  console.log('      fnkit code proxy code.example.com')
  console.log('')
  console.log('   Architecture:')
  console.log('   Browser → Caddy (HTTPS) → fnkit-code:8443 (VS Code)')
  console.log('')

  return true
}

export async function codeStart(options: CodeOptions = {}): Promise<boolean> {
  logger.title('Starting FnKit Code (code-server)')

  // Check Docker
  if (
    !(await docker.isDockerAvailable()) ||
    !(await docker.isDockerRunning())
  ) {
    logger.error('Docker is not available')
    return false
  }

  // Create network if needed
  const { exec } = await import('../utils/shell')
  await exec('docker', ['network', 'create', FNKIT_NETWORK])

  // Stop existing container if running
  await exec('docker', ['rm', '-f', CODE_CONTAINER])

  // Build the run args
  const password = options.password || 'changeme'
  const sudoPassword = options.sudoPassword || 'changeme'
  const tz = options.tz || 'Europe/Madrid'

  const args = [
    'run',
    '-d',
    '--name',
    CODE_CONTAINER,
    '--network',
    FNKIT_NETWORK,
    '--label',
    'fnkit.code=true',
    '--restart',
    'unless-stopped',
    '-v',
    'fnkit-code-config:/config',
    '-e',
    'PUID=1000',
    '-e',
    'PGID=1000',
    '-e',
    `TZ=${tz}`,
    '-e',
    `PASSWORD=${password}`,
    '-e',
    `SUDO_PASSWORD=${sudoPassword}`,
    '-e',
    'DEFAULT_WORKSPACE=/config/workspace',
    CODE_IMAGE,
  ]

  logger.step('Pulling code-server image...')
  await exec('docker', ['pull', CODE_IMAGE])

  logger.step('Starting code-server container...')
  const result = await exec('docker', args)

  if (result.success) {
    logger.success('Code-server started: http://localhost:8443')
    logger.newline()
    logger.info('Access VS Code in your browser at:')
    logger.dim('  http://localhost:8443')
    logger.newline()
    if (password === 'changeme') {
      logger.warn('Using default password "changeme" — change with --password')
    }
    logger.newline()
    logger.info('Add a domain with HTTPS:')
    logger.dim('  fnkit code proxy code.example.com')
    logger.newline()
    return true
  } else {
    logger.error('Failed to start code-server')
    logger.dim(result.stderr)
    return false
  }
}

export async function codeStop(): Promise<boolean> {
  logger.title('Stopping FnKit Code')

  const { exec } = await import('../utils/shell')
  const result = await exec('docker', ['rm', '-f', CODE_CONTAINER])

  if (result.success) {
    logger.success('Code-server stopped')
    logger.info('Data persists in the fnkit-code-config volume')
    logger.dim('  To remove data: docker volume rm fnkit-code-config')
    return true
  } else {
    logger.error('Failed to stop code-server (may not be running)')
    return false
  }
}

export async function codeProxy(
  domain: string,
  options: CodeOptions = {},
): Promise<boolean> {
  const proxyDir = options.output || 'fnkit-proxy'
  const caddyfilePath = resolve(process.cwd(), proxyDir, 'Caddyfile')

  logger.title(`Adding code-server domain: ${domain}`)

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

  // Append new domain block — routes directly to code-server (not gateway)
  const domainBlock = `
${domain} {
    reverse_proxy fnkit-code:8443
}
`

  writeFileSync(caddyfilePath, currentContent + domainBlock)
  logger.success(`Added ${domain} → fnkit-code:8443`)
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

export async function code(
  subcommand: string,
  options: CodeOptions = {},
): Promise<boolean> {
  switch (subcommand) {
    case 'init':
      return codeInit(options)
    case 'start':
      return codeStart(options)
    case 'stop':
      return codeStop()
    case 'proxy':
      if (!options.domain) {
        logger.error('Usage: fnkit code proxy <domain>')
        logger.info('Example: fnkit code proxy code.example.com')
        return false
      }
      return codeProxy(options.domain, options)
    default:
      logger.error(`Unknown code command: ${subcommand}`)
      logger.info('Available commands: init, start, stop, proxy')
      logger.newline()
      logger.dim(
        '  fnkit code init                    — Create code-server project files',
      )
      logger.dim(
        '  fnkit code start                   — Start code-server container',
      )
      logger.dim(
        '  fnkit code stop                    — Stop code-server container',
      )
      logger.dim(
        '  fnkit code proxy <domain>          — Add domain to Caddy proxy',
      )
      return false
  }
}

export default code
