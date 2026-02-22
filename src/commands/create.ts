// Create command - scaffold a new function project

import { existsSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { join, resolve, dirname } from 'path'
import logger from '../utils/logger'
import * as git from '../utils/git'
import { commandExists, execStream } from '../utils/shell'
import { getRuntime, getRuntimeNames } from '../runtimes'

export interface CreateOptions {
  remote?: string
  skipInstall?: boolean
}

export async function create(
  runtimeName: string,
  projectName: string,
  options: CreateOptions = {},
): Promise<boolean> {
  const runtime = getRuntime(runtimeName)

  if (!runtime) {
    logger.error(`Unknown runtime: ${runtimeName}`)
    logger.info(`Available runtimes: ${getRuntimeNames().join(', ')}`)
    return false
  }

  const targetDir = resolve(process.cwd(), projectName)

  // Check if directory already exists
  if (existsSync(targetDir)) {
    logger.error(`Directory already exists: ${projectName}`)
    return false
  }

  logger.title(`Creating ${runtime.displayName} function: ${projectName}`)

  // Check if runtime is installed
  const isInstalled = await runtime.isInstalled()
  if (!isInstalled) {
    logger.warn(`${runtime.displayName} is not installed`)
    logger.dim(runtime.installHint)
  } else {
    const version = await runtime.getVersion()
    if (version) {
      logger.success(`${runtime.displayName} detected: ${version}`)
    }
  }

  // Generate project from template
  logger.step('Generating project files...')
  const template = runtime.generateProject(projectName)

  // Create target directory
  await mkdir(targetDir, { recursive: true })

  // Write all template files
  for (const [filename, content] of Object.entries(template.files)) {
    const filePath = join(targetDir, filename)
    const fileDir = dirname(filePath)

    // Create subdirectories if needed
    if (fileDir !== targetDir) {
      await mkdir(fileDir, { recursive: true })
    }

    await writeFile(filePath, content)
    logger.dim(`  Created ${filename}`)
  }

  // Initialize git repo
  logger.step('Initializing git repository...')
  await git.init(targetDir)

  // Add remote if specified
  if (options.remote) {
    logger.step(`Adding remote: ${options.remote}`)
    await git.addRemote(targetDir, 'origin', options.remote)
  }

  // Create Dockerfile
  logger.step('Creating Dockerfile...')
  const dockerfile = runtime.generateDockerfile(projectName, 'helloWorld')
  await writeFile(join(targetDir, 'Dockerfile'), dockerfile)

  // Create .gitignore
  logger.step('Creating .gitignore...')
  const gitignore = generateGitignore(runtime.name)
  await writeFile(join(targetDir, '.gitignore'), gitignore)

  // Create docker-compose.yml for gateway/broker integration
  logger.step('Creating docker-compose.yml...')
  const isMqtt = runtime.name.endsWith('-mqtt')
  const dockerCompose = isMqtt
    ? generateMqttDockerCompose(projectName)
    : generateDockerCompose(projectName)
  await writeFile(join(targetDir, 'docker-compose.yml'), dockerCompose)

  // Run post-create commands (e.g., npm install)
  if (
    !options.skipInstall &&
    template.postCreate &&
    template.postCreate.length > 0
  ) {
    logger.step('Installing dependencies...')
    for (const cmd of template.postCreate) {
      const [command, ...args] = cmd.split(' ')

      // Check if the command exists before running
      const cmdExists = await commandExists(command)
      if (!cmdExists) {
        // Find the matching build tool hint
        const buildToolsStatus = await runtime.getBuildToolsStatus()
        const matchingTool = buildToolsStatus.find(
          (bt) => bt.tool.command === command,
        )
        if (matchingTool) {
          logger.warn(`Skipping: ${cmd} (${command} not found)`)
          logger.dim(`  ${matchingTool.tool.installHint}`)
        } else {
          logger.warn(`Skipping: ${cmd} (${command} not found in PATH)`)
        }
        continue
      }

      logger.dim(`  Running: ${cmd}`)
      const exitCode = await execStream(command, args, { cwd: targetDir })
      if (exitCode !== 0) {
        logger.warn(`Command "${cmd}" exited with code ${exitCode}`)
      }
    }
  }

  logger.newline()
  logger.success(`Created ${runtime.displayName} function in ./${projectName}`)
  logger.newline()
  logger.info('Next steps:')
  logger.dim(`  cd ${projectName}`)
  logger.dim('  fnkit run')
  logger.newline()
  logger.dim(`Quickstart guide: ${runtime.quickstartUrl}`)
  logger.newline()

  return true
}

function generateGitignore(runtimeName: string): string {
  const common = `# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Docker
Dockerfile.local
`

  const runtimeSpecific: Record<string, string> = {
    nodejs: `# Node.js
node_modules/
npm-debug.log
yarn-error.log
.env
`,
    python: `# Python
__pycache__/
*.py[cod]
.env
venv/
.venv/
`,
    go: `# Go
vendor/
*.exe
`,
    java: `# Java
target/
*.class
*.jar
`,
    ruby: `# Ruby
vendor/bundle/
.bundle/
Gemfile.lock
`,
    dotnet: `# .NET
bin/
obj/
*.user
`,
    php: `# PHP
vendor/
composer.lock
`,
    dart: `# Dart
.dart_tool/
.packages
build/
pubspec.lock
`,
    cpp: `# C++
build/
*.o
*.a
`,
    'nodejs-mqtt': `# Node.js
node_modules/
npm-debug.log
yarn-error.log
.env
`,
    'go-mqtt': `# Go
vendor/
*.exe
`,
    'dotnet-mqtt': `# .NET
bin/
obj/
*.user
`,
  }

  return common + (runtimeSpecific[runtimeName] || '')
}

function generateDockerCompose(projectName: string): string {
  return `# Docker Compose for FnKit function with gateway integration
# Requires: docker network create fnkit-network
# Requires: fnkit-gateway running (fnkit gateway init && fnkit gateway build && fnkit gateway start)

version: '3.8'

services:
  ${projectName}:
    build: .
    container_name: ${projectName}
    networks:
      - fnkit-network
    depends_on:
      fnkit-gateway:
        condition: service_started
    restart: unless-stopped

  # Uncomment to include gateway in this compose file
  # fnkit-gateway:
  #   image: fnkit-gateway:latest
  #   container_name: fnkit-gateway
  #   ports:
  #     - "8080:8080"
  #   environment:
  #     - FNKIT_AUTH_TOKEN=\${FNKIT_AUTH_TOKEN:-}
  #   networks:
  #     - fnkit-network

networks:
  fnkit-network:
    name: fnkit-network
    external: true

# Usage:
#   docker-compose up -d
#   curl -H "Authorization: Bearer <token>" http://localhost:8080/${projectName}
`
}

function generateMqttDockerCompose(projectName: string): string {
  return `# Docker Compose for FnKit MQTT function
# Requires: docker network create fnkit-network
# Requires: an MQTT broker (Mosquitto included below)

version: '3.8'

services:
  ${projectName}:
    build: .
    container_name: ${projectName}
    environment:
      # MQTT broker connection
      - MQTT_BROKER=mqtt://mosquitto:1883
      # Function target name
      - FUNCTION_TARGET=helloWorld
      # Topic prefix (subscribes to {prefix}/{target})
      - MQTT_TOPIC_PREFIX=fnkit
      # MQTT QoS level (0, 1, or 2)
      - MQTT_QOS=1
      # MQTT client identifier (auto-generated if empty)
      - MQTT_CLIENT_ID=
      # MQTT broker authentication
      - MQTT_USERNAME=
      - MQTT_PASSWORD=
      # TLS: path to CA certificate
      - MQTT_CA=
      # mTLS: path to client certificate and key
      - MQTT_CERT=
      - MQTT_KEY=
      # Whether to reject unauthorized TLS certificates
      - MQTT_REJECT_UNAUTHORIZED=true
      # Override subscribe topic (e.g. "v1.0/#" for wildcard). If empty, uses {prefix}/{target}
      - MQTT_SUBSCRIBE_TOPIC=
    networks:
      - fnkit-network
    depends_on:
      mosquitto:
        condition: service_started
    restart: unless-stopped

  # MQTT broker — uncomment to include in this compose file
  # mosquitto:
  #   image: eclipse-mosquitto:2
  #   container_name: mosquitto
  #   ports:
  #     - "1883:1883"
  #   volumes:
  #     - mosquitto-data:/mosquitto/data
  #     - mosquitto-log:/mosquitto/log
  #   networks:
  #     - fnkit-network
  #   restart: unless-stopped

networks:
  fnkit-network:
    name: fnkit-network
    external: true

# volumes:
#   mosquitto-data:
#   mosquitto-log:

# Usage:
#   docker-compose up -d
#   Publish to topic: fnkit/${projectName}
`
}

export default create
