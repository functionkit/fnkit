#!/usr/bin/env bun
// FNKIT CLI - Functions as a Service scaffolding tool

import { create } from './commands/create'
import { publish } from './commands/publish'
import { doctor } from './commands/doctor'
import { run } from './commands/run'
import { init } from './commands/init'
import { global, uninstall } from './commands/global'
import { containers } from './commands/containers'
import { gateway } from './commands/gateway'
import { deploy } from './commands/deploy'
import { proxy } from './commands/proxy'
import { cache } from './commands/cache'
import { observe } from './commands/observe'
import { getPlugin, getPluginNames } from './plugins'
import logger from './utils/logger'

const VERSION = '0.9.0'

// Canonical runtime names only
const CANONICAL_RUNTIMES = [
  'node',
  'python',
  'go',
  'java',
  'ruby',
  'dotnet',
  'php',
  'dart',
  'cpp',
  'node-mqtt',
  'go-mqtt',
  'dotnet-mqtt',
]

function showHelp() {
  console.log(`
fnkit v${VERSION} — Functions as a Service CLI

Usage:
  fnkit <command> [options]
  fnkit <runtime> <name>              Quick create (shorthand for 'new')

Commands:
  new <runtime> <name>               Create a new function project
  init                               Initialize existing directory
  dev                                Run function locally

  container ...                      Manage deployed containers
  gateway ...                        Manage API gateway
  cache ...                          Manage shared cache (Valkey)
  proxy ...                          Manage reverse proxy (Caddy)
  deploy ...                         Manage CI/CD deploy pipeline
  image ...                          Build & push Docker images
  observe ...                        Observability dashboard & traces

  uns ...                            UNS plugin commands

  doctor [runtime]                   Check runtime dependencies
  install                            Install fnkit globally
  uninstall                          Remove global installation

Runtimes:
  ${CANONICAL_RUNTIMES.join(', ')}

Quick Start:
  fnkit node my-api                   Create a function
  fnkit deploy setup                  Set up CI/CD pipeline
  git push                           Deploy to production

Run 'fnkit <command>' for subcommand details.
`)
}

function showContainerHelp() {
  console.log(`
fnkit container — Manage deployed containers

Usage:
  fnkit container <command> [options]

Commands:
  ls                    List deployed fnkit containers
  logs <name>           View container logs (live)
  stop <name>           Stop a running container

Options:
  --all                 Show all containers (not just fnkit)

Examples:
  fnkit container ls             List running functions
  fnkit container ls --all       Include non-fnkit containers
  fnkit container logs my-api    Tail logs for my-api
  fnkit container stop my-api    Stop my-api container
`)
}

function showGatewayHelp() {
  console.log(`
fnkit gateway — Manage the API gateway

The gateway provides centralized token authentication and routing
for all your function containers via nginx.

Usage:
  fnkit gateway <command> [options]

Commands:
  init                  Create gateway project files
  build                 Build the gateway Docker image
  start                 Start the gateway container
  stop                  Stop the gateway container
  orchestrate add <name> Add a pipeline (stored in Valkey cache)
  orchestrate ls         List defined pipelines
  orchestrate remove     Remove a pipeline

Options:
  --token <token>       Auth token for the gateway
  --steps <a,b,c>       Comma-separated steps for add
  --mode <mode>         sequential | parallel

Examples:
  fnkit gateway init                    Create gateway project
  fnkit gateway build                   Build Docker image
  fnkit gateway start --token secret    Start with auth token
  fnkit gateway stop                    Stop the gateway
  fnkit gateway orchestrate add process-order --steps validate,charge,notify --mode sequential
  fnkit gateway orchestrate ls
`)
}

function showProxyHelp() {
  console.log(`
fnkit proxy — Manage reverse proxy (Caddy)

Sets up Caddy for automatic HTTPS and domain management.
Caddy handles TLS certificates via Let's Encrypt automatically.

Usage:
  fnkit proxy <command> [options]

Commands:
  init                  Create Caddy proxy setup
  add <domain>          Add a domain route to the gateway
  remove <domain>       Remove a domain route
  ls                    List configured domains

Examples:
  fnkit proxy init                      Create proxy project
  fnkit proxy add api.example.com       Route domain to gateway
  fnkit proxy ls                        List all domains
  fnkit proxy remove api.example.com    Remove domain route
`)
}

function showDeployHelp() {
  console.log(`
fnkit deploy — Manage CI/CD deploy pipeline

Automated git-push-to-deploy via Forgejo (default) or GitHub Actions.

  Forgejo:  push → runner builds image → deploy container → health check
  GitHub:   push → build & push to GHCR → SSH deploy → health check

Usage:
  fnkit deploy <command> [options]

Commands:
  setup                 Guided deploy pipeline setup (recommended)
  init                  Generate deploy workflow file
  runner                Generate Forgejo runner setup files
  status                Check deployment status

Options:
  --provider <name>     Deploy provider: forgejo (default) or github

Examples:
  fnkit deploy setup                    Interactive setup wizard
  fnkit deploy init                     Generate Forgejo workflow
  fnkit deploy init --provider github   Generate GitHub Actions workflow
  fnkit deploy runner                   Create runner docker-compose
  fnkit deploy status                   Check pipeline & container status
`)
}

function showImageHelp() {
  console.log(`
fnkit image — Build & push Docker images

Usage:
  fnkit image <command> [options]

Commands:
  build                 Build Docker image for the current function
  push                  Build and push image to a registry

Options:
  --tag, -t <tag>       Docker image tag (default: function name)
  --registry <url>      Docker registry URL
  --target <function>   Function target name

Examples:
  fnkit image build                     Build with default tag
  fnkit image build --tag myapp:v1      Build with custom tag
  fnkit image push --registry ghcr.io   Build and push to registry
`)
}

function showUnsHelp() {
  console.log(`
fnkit uns — UNS Plugin

Unified Namespace (UNS) functions for industrial IoT data.
Monitors MQTT topics, caches data in Valkey, and logs changes to PostgreSQL.
OPC-UA bridge for reading tags from OPC-UA servers and publishing to MQTT.

Usage:
  fnkit uns <command> <subcommand> [name]

Commands:
  opcua <init|start|stop|build> [name] OPC-UA → MQTT bridge (Go → standalone .exe)
  uns <init|start|stop> [name]         UNS topic monitor (Go MQTT → Valkey cache)
  cache <init|start|stop> [name]       UNS cache reader (Node.js HTTP → JSON)
  log <init|start|stop> [name]         UNS PostgreSQL logger (Go HTTP → Postgres)
  status                               Show status of all components

Architecture:
  OPC-UA Server → opcua-bridge → MQTT Broker → uns-framework (v1.0/#)
                                                     ↓
                                                fnkit-cache (Valkey)
                                                     ↓
                                                uns-cache (HTTP JSON API)
                                                uns-log (PostgreSQL logger)

Examples:
  fnkit uns opcua init                  Create OPC-UA → MQTT bridge
  fnkit uns opcua start                 Build & start bridge (Docker)
  fnkit uns opcua build                 Cross-compile standalone binaries (.exe)
  fnkit uns uns init                    Create UNS topic monitor
  fnkit uns uns start                   Build & start monitor
  fnkit uns cache init                  Create UNS cache reader
  fnkit uns log init                    Create PostgreSQL logger
  fnkit uns status                      Check all components

Quick Start (OPC-UA):
  fnkit uns opcua init && cd opcua-bridge
  vi tags.yaml                          # Configure OPC-UA tags
  docker compose up -d                  # Start bridge
`)
}

function showUnsCommandHelp(command: string) {
  switch (command) {
    case 'uns':
      console.log(`
fnkit uns uns — UNS Topic Monitor

A Go MQTT function that subscribes to v1.0/# and caches all topic data
in the shared Valkey cache. Uses the FnKit Function Framework for Go.

Usage:
  fnkit uns uns <command> [name]

Commands:
  init [name]           Create UNS monitor project (default: uns-framework)
  start [name]          Build and start the monitor container
  stop [name]           Stop the monitor container

The monitor writes to Valkey cache:
  uns:topics            → SET of all discovered topic paths
  uns:data:<topic>      → latest payload (raw JSON)
  uns:prev:<topic>      → previous payload (raw JSON)
  uns:meta:<topic>      → metadata (last_updated, count, first_seen)

Examples:
  fnkit uns uns init                    Create with default name
  fnkit uns uns init my-monitor         Create with custom name
  fnkit uns uns start                   Build & start
  fnkit uns uns stop                    Stop container
`)
      break
    case 'cache':
      console.log(`
fnkit uns cache — UNS Cache Reader

A Node.js HTTP function that reads UNS topic data from the shared Valkey
cache (populated by uns-framework) and returns JSON with change detection.

Usage:
  fnkit uns cache <command> [name]

Commands:
  init [name]           Create cache reader project (default: uns-cache)
  start [name]          Build and start the cache reader container
  stop [name]           Stop the cache reader container

Accessible via the fnkit gateway:
  curl http://localhost:8080/uns-cache                    # All topics
  curl -d '{"topics":["v1.0/..."]}' http://localhost:8080/uns-cache  # Specific

Examples:
  fnkit uns cache init                  Create with default name
  fnkit uns cache start                 Build & start
  fnkit uns cache stop                  Stop container
`)
      break
    case 'log':
      console.log(`
fnkit uns log — UNS PostgreSQL Logger

A Go HTTP function that reads UNS topic data from the shared Valkey cache
and logs snapshot rows to PostgreSQL when any value changes.

Config is stored in Valkey (not .env):
  docker exec fnkit-cache valkey-cli SET fnkit:config:uns-log '{"table":"uns_log","topics":[...]}'

Usage:
  fnkit uns log <command> [name]

Commands:
  init [name]           Create logger project (default: uns-log)
  start [name]          Build and start the logger container
  stop [name]           Stop the logger container

Examples:
  fnkit uns log init                    Create with default name
  fnkit uns log init uns-log-line1      Create named instance
  fnkit uns log start                   Build & start
  fnkit uns log stop                    Stop container
`)
      break
    case 'opcua':
      console.log(`
fnkit uns opcua — OPC-UA → MQTT Bridge

A Go application that connects to an OPC-UA server, reads tags (poll or
subscribe), and publishes data to MQTT topics. Runs as a Docker container
or a standalone binary (.exe) on edge devices.

Usage:
  fnkit uns opcua <command> [name]

Commands:
  init [name]           Create OPC-UA bridge project (default: opcua-bridge)
  start [name]          Build and start the bridge container
  stop [name]           Stop the bridge container
  build [name]          Cross-compile standalone binaries for all platforms

Tag configuration is in tags.yaml with groups:
  - poll mode:      Read tags on a fixed interval (e.g. every 10s, 60s)
  - subscribe mode: OPC-UA subscription (real-time server push)

Security: None, Basic256Sha256, Sign, SignAndEncrypt, certs, insecure mode
MQTT: plain, TLS, mTLS, username/password, insecure mode

Examples:
  fnkit uns opcua init                  Create with default name
  fnkit uns opcua init mill8-bridge     Create with custom name
  fnkit uns opcua start                 Build & start (Docker)
  fnkit uns opcua build                 Cross-compile .exe for edge
  fnkit uns opcua stop                  Stop container
`)
      break
    default:
      console.log(`Run "fnkit uns" for available commands.`)
  }
}

function showVersion() {
  console.log(`fnkit v${VERSION}`)
}

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    showHelp()
    process.exit(0)
  }

  const command = args[0]

  // Parse options
  const options: Record<string, string | boolean> = {}
  const positionalArgs: string[] = []

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const nextArg = args[i + 1]
      if (nextArg && !nextArg.startsWith('-')) {
        options[key] = nextArg
        i++
      } else {
        options[key] = true
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1)
      const nextArg = args[i + 1]
      // Map short flags
      const keyMap: Record<string, string> = {
        r: 'remote',
        t: 'tag',
        p: 'port',
      }
      const fullKey = keyMap[key] || key
      if (nextArg && !nextArg.startsWith('-')) {
        options[fullKey] = nextArg
        i++
      } else {
        options[fullKey] = true
      }
    } else {
      positionalArgs.push(arg)
    }
  }

  try {
    switch (command) {
      case 'help':
      case '--help':
      case '-h':
        showHelp()
        break

      case 'version':
      case '--version':
      case '-v':
        showVersion()
        break

      // ─────────────────────────────────────────────────────────────────
      // Function creation & development
      // ─────────────────────────────────────────────────────────────────

      case 'new':
        if (positionalArgs.length < 2) {
          logger.error('Usage: fnkit new <runtime> <name>')
          logger.info(`Runtimes: ${CANONICAL_RUNTIMES.join(', ')}`)
          process.exit(1)
        }
        const newSuccess = await create(positionalArgs[0], positionalArgs[1], {
          remote: options.remote as string,
        })
        process.exit(newSuccess ? 0 : 1)
        break

      case 'init':
        const initSuccess = await init({
          runtime: options.runtime as string,
        })
        process.exit(initSuccess ? 0 : 1)
        break

      case 'dev':
        const devSuccess = await run({
          target: options.target as string,
          port: options.port ? parseInt(options.port as string) : undefined,
        })
        process.exit(devSuccess ? 0 : 1)
        break

      // ─────────────────────────────────────────────────────────────────
      // Container management: fnkit container <subcommand>
      // ─────────────────────────────────────────────────────────────────

      case 'container':
        const containerSubcmd = positionalArgs[0]
        if (!containerSubcmd || options.help || options.h) {
          showContainerHelp()
          process.exit(0)
        }

        switch (containerSubcmd) {
          case 'ls':
          case 'list':
            const lsSuccess = await containers({
              all: options.all as boolean,
            })
            process.exit(lsSuccess ? 0 : 1)
            break

          case 'logs':
            if (!positionalArgs[1]) {
              logger.error('Usage: fnkit container logs <name>')
              process.exit(1)
            }
            const { exec } = await import('./utils/shell')
            const logsResult = await exec('docker', [
              'logs',
              '-f',
              positionalArgs[1],
            ])
            process.exit(logsResult.success ? 0 : 1)
            break

          case 'stop':
            if (!positionalArgs[1]) {
              logger.error('Usage: fnkit container stop <name>')
              process.exit(1)
            }
            const { exec: execStop } = await import('./utils/shell')
            const stopResult = await execStop('docker', [
              'stop',
              positionalArgs[1],
            ])
            if (stopResult.success) {
              logger.success(`Stopped container: ${positionalArgs[1]}`)
            } else {
              logger.error(`Failed to stop container: ${positionalArgs[1]}`)
            }
            process.exit(stopResult.success ? 0 : 1)
            break

          default:
            logger.error(`Unknown container command: ${containerSubcmd}`)
            logger.info('Available: ls, logs, stop')
            process.exit(1)
        }
        break

      // ─────────────────────────────────────────────────────────────────
      // Gateway management: fnkit gateway <subcommand>
      // ─────────────────────────────────────────────────────────────────

      case 'gateway':
        const gatewaySubcmd = positionalArgs[0]
        if (!gatewaySubcmd || options.help || options.h) {
          showGatewayHelp()
          process.exit(0)
        }

        const gatewayOptions = {
          output: options.output as string,
          token: options.token as string,
        }

        if (gatewaySubcmd === 'orchestrate') {
          const orchestrateSubcmd = positionalArgs[1]
          const orchestrateSuccess = await gateway('orchestrate', {
            ...gatewayOptions,
            orchestrateSubcommand: orchestrateSubcmd,
            name: positionalArgs[2],
            steps: options.steps as string,
            mode: options.mode as string,
          })
          process.exit(orchestrateSuccess ? 0 : 1)
          break
        }

        const gatewaySuccess = await gateway(gatewaySubcmd, gatewayOptions)
        process.exit(gatewaySuccess ? 0 : 1)
        break

      // ─────────────────────────────────────────────────────────────────
      // Cache management: fnkit cache <subcommand>
      // ─────────────────────────────────────────────────────────────────

      case 'cache':
        const cacheSubcmd = positionalArgs[0]
        if (!cacheSubcmd || options.help || options.h) {
          console.log(`
fnkit cache — Manage shared cache (Valkey)

A Redis-compatible shared cache accessible by all function containers.
Powered by Valkey (open-source, BSD licensed).

Usage:
  fnkit cache <command> [options]

Commands:
  init                  Create cache project files
  start                 Start the cache container
  stop                  Stop the cache container

Options:
  --maxmemory <size>    Max memory (default: 256mb)

Examples:
  fnkit cache init                      Create cache project
  fnkit cache start                     Start cache (Valkey)
  fnkit cache start --maxmemory 512mb   Start with custom memory limit
  fnkit cache stop                      Stop the cache
`)
          process.exit(0)
        }
        const cacheSuccess = await cache(cacheSubcmd, {
          output: options.output as string,
          maxmemory: options.maxmemory as string,
        })
        process.exit(cacheSuccess ? 0 : 1)
        break

      // ─────────────────────────────────────────────────────────────────
      // Proxy management: fnkit proxy <subcommand>
      // ─────────────────────────────────────────────────────────────────

      case 'proxy':
        const proxySubcmd = positionalArgs[0]
        if (!proxySubcmd || options.help || options.h) {
          showProxyHelp()
          process.exit(0)
        }
        const proxySuccess = await proxy(proxySubcmd, {
          output: options.output as string,
          domain: positionalArgs[1],
        })
        process.exit(proxySuccess ? 0 : 1)
        break

      // ─────────────────────────────────────────────────────────────────
      // Deploy management: fnkit deploy <subcommand>
      // ─────────────────────────────────────────────────────────────────

      case 'deploy':
        const deploySubcmd = positionalArgs[0]
        if (!deploySubcmd || options.help || options.h) {
          showDeployHelp()
          process.exit(0)
        }
        const deploySuccess = await deploy(deploySubcmd, {
          provider: options.provider as 'forgejo' | 'github' | undefined,
          output: options.output as string,
        })
        process.exit(deploySuccess ? 0 : 1)
        break

      // ─────────────────────────────────────────────────────────────────
      // Image management: fnkit image <subcommand>
      // ─────────────────────────────────────────────────────────────────

      case 'image':
        const imageSubcmd = positionalArgs[0]
        if (!imageSubcmd || options.help || options.h) {
          showImageHelp()
          process.exit(0)
        }

        switch (imageSubcmd) {
          case 'build':
            const buildSuccess = await publish({
              tag: options.tag as string,
              target: options.target as string,
              registry: options.registry as string,
              push: false,
            })
            process.exit(buildSuccess ? 0 : 1)
            break

          case 'push':
            const pushSuccess = await publish({
              tag: options.tag as string,
              target: options.target as string,
              registry: options.registry as string,
              push: true,
            })
            process.exit(pushSuccess ? 0 : 1)
            break

          default:
            logger.error(`Unknown image command: ${imageSubcmd}`)
            logger.info('Available: build, push')
            process.exit(1)
        }
        break

      // ─────────────────────────────────────────────────────────────────
      // Utilities
      // ─────────────────────────────────────────────────────────────────

      case 'doctor':
        const doctorSuccess = await doctor(positionalArgs[0])
        process.exit(doctorSuccess ? 0 : 1)
        break

      case 'install':
        const installSuccess = await global()
        process.exit(installSuccess ? 0 : 1)
        break

      case 'uninstall':
        const uninstallSuccess = await uninstall()
        process.exit(uninstallSuccess ? 0 : 1)
        break

      // ─────────────────────────────────────────────────────────────────
      // Observability: fnkit observe [status|events|traces|metrics]
      // ─────────────────────────────────────────────────────────────────

      case 'observe': {
        const observeSubcmd = positionalArgs[0]
        if (options.help || options.h) {
          console.log(`
fnkit observe — Observability dashboard

Node-RED-level observability for your fnkit platform. Shows component health,
request traces, events/errors, and per-container metrics.

Data is recorded automatically by the gateway and stored in Valkey.

Usage:
  fnkit observe [command] [options]

Commands:
  status                Unified dashboard (default)
  events                Recent events and errors
  traces                Recent request traces through the gateway
  metrics               Per-container request counts and error rates

Options:
  --count, -n <num>     Number of items to show (default: 50)

Examples:
  fnkit observe                         Show status dashboard
  fnkit observe events                  Show recent events
  fnkit observe traces                  Show request traces
  fnkit observe traces --count 100      Show last 100 traces
  fnkit observe metrics                 Show per-container metrics

HTTP API (via gateway):
  curl http://localhost:8080/observe/status
  curl http://localhost:8080/observe/traces?count=20
  curl http://localhost:8080/observe/events
  curl http://localhost:8080/observe/metrics
`)
          process.exit(0)
        }
        const observeSuccess = await observe(observeSubcmd, options)
        process.exit(observeSuccess ? 0 : 1)
        break
      }

      // ─────────────────────────────────────────────────────────────────
      // Plugin system: fnkit <plugin> <command> <subcommand> [args]
      // ─────────────────────────────────────────────────────────────────

      case 'uns': {
        const plugin = getPlugin('uns')
        if (!plugin) {
          logger.error('UNS plugin not found')
          process.exit(1)
          break
        }

        const pluginCmd = positionalArgs[0]
        if (!pluginCmd || options.help || options.h) {
          showUnsHelp()
          process.exit(0)
          break
        }

        // Find the matching plugin command
        const cmd = plugin.commands.find((c) => c.name === pluginCmd)
        if (!cmd) {
          logger.error(`Unknown uns command: ${pluginCmd}`)
          logger.info(
            `Available: ${plugin.commands.map((c) => c.name).join(', ')}`,
          )
          process.exit(1)
          break
        }

        // For commands with subcommands (init/start/stop)
        const subcmd = positionalArgs[1] || ''
        const cmdArgs = positionalArgs.slice(2)

        // If no subcommand and the command has subcommands, show help
        if (!subcmd && cmd.subcommands.length > 0) {
          showUnsCommandHelp(cmd.name)
          process.exit(0)
          break
        }

        // For status (no subcommands), pass empty string
        const pluginSuccess = await cmd.handler(
          subcmd || '',
          cmdArgs,
          options,
        )
        process.exit(pluginSuccess ? 0 : 1)
        break
      }

      // ─────────────────────────────────────────────────────────────────
      // Shorthand: fnkit <runtime> <name> → fnkit new <runtime> <name>
      // ─────────────────────────────────────────────────────────────────

      default:
        // Check if command is a canonical runtime name (shorthand for new)
        if (CANONICAL_RUNTIMES.includes(command.toLowerCase())) {
          if (positionalArgs.length < 1) {
            logger.error(`Usage: fnkit ${command} <name>`)
            process.exit(1)
          }
          const shorthandSuccess = await create(command, positionalArgs[0], {
            remote: options.remote as string,
          })
          process.exit(shorthandSuccess ? 0 : 1)
        }
        // Check if command is a plugin name
        else if (getPlugin(command)) {
          logger.info(`Run "fnkit ${command}" with no args for help`)
          process.exit(0)
        } else {
          logger.error(`Unknown command: ${command}`)
          logger.info('Run "fnkit help" for usage information')
          process.exit(1)
        }
    }
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
}

main()
