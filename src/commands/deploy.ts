// Deploy command - generate CI/CD workflows for git-push-to-deploy

import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, resolve, basename } from 'path'
import logger from '../utils/logger'
import { exec } from '../utils/shell'

// ─────────────────────────────────────────────────────────────────
// Forgejo Runner setup
// ─────────────────────────────────────────────────────────────────

const RUNNER_DIR = 'fnkit-runner'

const RUNNER_ENV_EXAMPLE = `# Forgejo Actions Runner — required environment variables
# Copy to .env and fill in your values

# Your Forgejo instance URL
FORGEJO_INSTANCE=https://git.example.com

# Runner registration token (from Site Administration → Actions → Runners → Create new runner)
FORGEJO_RUNNER_TOKEN=your-registration-token

# Runner display name (optional)
FORGEJO_RUNNER_NAME=fnkit-runner

# Runner labels — must match "runs-on" in workflows (optional)
FORGEJO_RUNNER_LABELS=ubuntu-latest:host
`

const RUNNER_DOCKER_COMPOSE = `# Forgejo Actions Runner for FnKit deployments
# Docker socket access allows the runner to build and deploy function containers
#
# Setup:
#   1. Copy .env.example to .env and fill in your values
#   2. Run: docker compose up -d
#   3. Check logs: docker logs forgejo-runner

services:
  forgejo-runner:
    image: code.forgejo.org/forgejo/runner:6
    user: "0:0"
    container_name: forgejo-runner
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - runner-data:/data
    environment:
      - DOCKER_HOST=unix:///var/run/docker.sock
      - FORGEJO_INSTANCE=\${FORGEJO_INSTANCE}
      - FORGEJO_RUNNER_TOKEN=\${FORGEJO_RUNNER_TOKEN}
      - FORGEJO_RUNNER_NAME=\${FORGEJO_RUNNER_NAME:-fnkit-runner}
      - FORGEJO_RUNNER_LABELS=\${FORGEJO_RUNNER_LABELS:-ubuntu-latest:host}
    entrypoint: /bin/sh
    command:
      - -c
      - |
        # Install Docker CLI, git, and Node.js (needed for host-mode builds + JS actions)
        apk add --no-cache docker-cli git nodejs

        cd /data
        if [ ! -f .runner ]; then
          echo "First run — registering runner with $$FORGEJO_INSTANCE..."
          forgejo-runner register \\
            --instance "$$FORGEJO_INSTANCE" \\
            --token "$$FORGEJO_RUNNER_TOKEN" \\
            --name "$$FORGEJO_RUNNER_NAME" \\
            --labels "$$FORGEJO_RUNNER_LABELS" \\
            --no-interactive
        else
          echo "Runner already registered, starting daemon..."
        fi
        forgejo-runner daemon
    healthcheck:
      test: ["CMD", "pgrep", "-f", "forgejo-runner"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

volumes:
  runner-data:
`

const RUNNER_README = `# FnKit Forgejo Runner

Forgejo Actions runner for deploying FnKit function containers. Auto-registers on first startup — just set the environment variables and deploy.

## Quick Start

\`\`\`bash
# Copy environment template and fill in your values
cp .env.example .env

# Start the runner
docker compose up -d

# Check it's running
docker logs forgejo-runner
\`\`\`

## Setup Steps

1. **Enable Actions in Forgejo** — Site Administration → Actions → Enable
   (or add \`FORGEJO__actions__ENABLED=true\` to your Forgejo service env vars)

2. **Get a registration token** — Site Administration → Actions → Runners → Create new runner

3. **Configure environment** — Copy \`.env.example\` to \`.env\` and set:

| Variable | Required | Description |
|----------|----------|-------------|
| \`FORGEJO_INSTANCE\` | ✅ | Your Forgejo URL (e.g. \`https://git.example.com\`) |
| \`FORGEJO_RUNNER_TOKEN\` | ✅ | Registration token from step 2 |
| \`FORGEJO_RUNNER_NAME\` | | Runner name (default: \`fnkit-runner\`) |
| \`FORGEJO_RUNNER_LABELS\` | | Runner labels (default: \`ubuntu-latest:host\`) |

4. **Start** — \`docker compose up -d\`

5. **Verify** — Check Site Administration → Actions → Runners — the runner should appear as online

## How It Works

On first startup, the runner checks if it's already registered (\`.runner\` file in the data volume). If not, it registers with Forgejo using the environment variables. On subsequent restarts it skips registration and goes straight to the daemon.

The runner mounts the host Docker socket (\`/var/run/docker.sock\`), so workflow steps that run \`docker build\` and \`docker run\` operate directly on the host Docker — the same Docker where your gateway and function containers live.

## Notes

- The runner label \`ubuntu-latest\` is used in workflow files (\`runs-on: ubuntu-latest\`)
- Function containers are deployed to the \`fnkit-network\` Docker network
- Registration persists in the \`runner-data\` volume — survives restarts and redeployments
- The healthcheck monitors the runner daemon process
`

// ─────────────────────────────────────────────────────────────────
// Forgejo Actions workflow
// ─────────────────────────────────────────────────────────────────

function generateForgejoWorkflow(functionName: string): string {
  return `# FnKit Deploy — Forgejo Actions
# Builds and deploys this function container on every push to main
# Requires: Forgejo runner with Docker socket access (fnkit deploy runner)
#
# Pipeline: git push → build image → deploy container → health check

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build image
        run: |
          FUNCTION_NAME="${functionName}"
          IMAGE_NAME="fnkit-fn-\${FUNCTION_NAME}:latest"
          IMAGE_PREV="fnkit-fn-\${FUNCTION_NAME}:prev"

          echo "🔨 Building \${FUNCTION_NAME}..."
          docker build -t \$IMAGE_NAME .

          echo "IMAGE_NAME=\$IMAGE_NAME" >> \$GITHUB_ENV
          echo "IMAGE_PREV=\$IMAGE_PREV" >> \$GITHUB_ENV
          echo "FUNCTION_NAME=\$FUNCTION_NAME" >> \$GITHUB_ENV

      - name: Deploy container
        run: |
          echo "🌐 Ensuring fnkit-network exists..."
          docker network create fnkit-network 2>/dev/null || true

          # Tag current image as :prev for rollback
          docker tag \$IMAGE_NAME \$IMAGE_PREV 2>/dev/null || true

          echo "♻️  Replacing running container..."
          docker stop \$FUNCTION_NAME 2>/dev/null || true
          docker rm \$FUNCTION_NAME 2>/dev/null || true

          echo "🚀 Starting \${FUNCTION_NAME}..."
          docker run -d \\
            --name \$FUNCTION_NAME \\
            --network fnkit-network \\
            --label fnkit.fn=true \\
            --label fnkit.deployed="\$(date -u +%Y-%m-%dT%H:%M:%SZ)" \\
            --restart unless-stopped \\
            -e CACHE_URL=redis://fnkit-cache:6379 \\
            \$IMAGE_NAME

      - name: Health check
        run: |
          echo "🏥 Checking container health..."
          sleep 3

          if docker ps --filter "name=\$FUNCTION_NAME" --filter "status=running" -q | grep -q .; then
            echo "✅ \${FUNCTION_NAME} is running"
            echo "🌐 Available at gateway: /\${FUNCTION_NAME}"
          else
            echo "❌ Container failed to start — rolling back..."
            docker logs \$FUNCTION_NAME 2>&1 || true

            # Rollback to previous image if available
            if docker image inspect \$IMAGE_PREV >/dev/null 2>&1; then
              echo "🔄 Rolling back to previous image..."
              docker rm \$FUNCTION_NAME 2>/dev/null || true
              docker run -d \\
                --name \$FUNCTION_NAME \\
                --network fnkit-network \\
                --label fnkit.fn=true \\
                --label fnkit.deployed="\$(date -u +%Y-%m-%dT%H:%M:%SZ)" \\
                --label fnkit.rollback=true \\
                --restart unless-stopped \\
                \$IMAGE_PREV
              echo "⚠️  Rolled back to previous version"
            fi
            exit 1
          fi

      - name: Cleanup old images
        run: |
          echo "🧹 Cleaning up dangling images..."
          docker image prune -f --filter "label=fnkit.fn=true" 2>/dev/null || true
`
}

// ─────────────────────────────────────────────────────────────────
// GitHub Actions workflow
// ─────────────────────────────────────────────────────────────────

function generateGitHubWorkflow(functionName: string): string {
  return `# FnKit Deploy — GitHub Actions
# Builds image, pushes to GHCR, and deploys to remote server via SSH
#
# Pipeline: git push → build & push to GHCR → SSH deploy → health check
#
# Required GitHub Secrets:
#   DEPLOY_HOST    - Remote server IP or hostname
#   DEPLOY_USER    - SSH username (e.g. root)
#   DEPLOY_SSH_KEY - Private SSH key for the server
#   DEPLOY_GHCR_TOKEN - GitHub PAT with read:packages scope (for pulling on server)

name: Deploy Function

on:
  push:
    branches: [main]

env:
  FUNCTION_NAME: ${functionName}
  REGISTRY: ghcr.io

jobs:
  deploy:
    runs-on: ubuntu-latest

    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: \${{ env.REGISTRY }}
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}

      - name: Build and push image
        run: |
          IMAGE="\${{ env.REGISTRY }}/\${{ github.repository_owner }}/\${{ env.FUNCTION_NAME }}:latest"
          docker build -t \$IMAGE .
          docker push \$IMAGE
          echo "IMAGE=\$IMAGE" >> \$GITHUB_ENV

      - name: Deploy to server
        uses: appleboy/ssh-action@v1
        with:
          host: \${{ secrets.DEPLOY_HOST }}
          username: \${{ secrets.DEPLOY_USER }}
          key: \${{ secrets.DEPLOY_SSH_KEY }}
          envs: IMAGE,FUNCTION_NAME
          script: |
            IMAGE="\${{ env.REGISTRY }}/\${{ github.repository_owner }}/\${{ env.FUNCTION_NAME }}:latest"

            echo "🔑 Logging in to GHCR..."
            echo "\${{ secrets.DEPLOY_GHCR_TOKEN }}" | docker login ghcr.io -u "\${{ github.repository_owner }}" --password-stdin

            echo "📦 Pulling \$IMAGE..."
            docker pull \$IMAGE

            echo "🌐 Ensuring fnkit-network exists..."
            docker network create fnkit-network 2>/dev/null || true

            echo "♻️  Replacing running container..."
            docker stop \${{ env.FUNCTION_NAME }} 2>/dev/null || true
            docker rm \${{ env.FUNCTION_NAME }} 2>/dev/null || true

            echo "🚀 Starting \${{ env.FUNCTION_NAME }}..."
            docker run -d \\
              --name \${{ env.FUNCTION_NAME }} \\
              --network fnkit-network \\
              --label fnkit.fn=true \\
              --label fnkit.deployed="\$(date -u +%Y-%m-%dT%H:%M:%SZ)" \\
              --restart unless-stopped \\
              -e CACHE_URL=redis://fnkit-cache:6379 \\
              \$IMAGE

            # Health check
            sleep 3
            if docker ps --filter "name=\${{ env.FUNCTION_NAME }}" --filter "status=running" -q | grep -q .; then
              echo "✅ \${{ env.FUNCTION_NAME }} is running"
              echo "🌐 Available at gateway: /\${{ env.FUNCTION_NAME }}"
            else
              echo "❌ Container failed to start"
              docker logs \${{ env.FUNCTION_NAME }} 2>&1 || true
              exit 1
            fi

            echo "🧹 Cleaning up old images..."
            docker image prune -f 2>/dev/null || true

            echo "✅ Deploy complete!"
`
}

// ─────────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────────

export interface DeployOptions {
  provider?: 'forgejo' | 'github'
  output?: string
}

export async function deployInit(
  options: DeployOptions = {},
): Promise<boolean> {
  const provider = options.provider || 'forgejo'
  const projectDir = resolve(process.cwd())
  const projectName = basename(projectDir)

  logger.title(
    `Setting up ${provider === 'forgejo' ? 'Forgejo' : 'GitHub'} deploy pipeline`,
  )

  // Determine workflow directory and file
  const workflowDir =
    provider === 'forgejo'
      ? join(projectDir, '.forgejo', 'workflows')
      : join(projectDir, '.github', 'workflows')

  const workflowFile = join(workflowDir, 'deploy.yml')

  if (existsSync(workflowFile)) {
    logger.error('Deploy workflow already exists')
    logger.dim(`  ${workflowFile}`)
    return false
  }

  // Generate workflow
  const workflow =
    provider === 'forgejo'
      ? generateForgejoWorkflow(projectName)
      : generateGitHubWorkflow(projectName)

  // Write workflow file
  mkdirSync(workflowDir, { recursive: true })
  writeFileSync(workflowFile, workflow)
  logger.success(
    `Created ${provider === 'forgejo' ? '.forgejo' : '.github'}/workflows/deploy.yml`,
  )

  logger.newline()

  if (provider === 'forgejo') {
    logger.success('Forgejo deploy pipeline ready!')
    logger.newline()
    logger.info(
      'Pipeline: git push → build image → deploy container → health check',
    )
    logger.newline()
    logger.info('How it works:')
    logger.dim('  1. Push to main branch')
    logger.dim('  2. Forgejo runner builds the Docker image on the host')
    logger.dim(`  3. Container "${projectName}" deploys to fnkit-network`)
    logger.dim('  4. Health check verifies the container is running')
    logger.dim('  5. Auto-rollback to previous image on failure')
    logger.dim(`  6. Available at gateway: /${projectName}`)
    logger.newline()
    logger.info('Prerequisites:')
    logger.dim('  - Forgejo Actions enabled on your instance')
    logger.dim(
      '  - Forgejo runner with Docker socket access (fnkit deploy runner)',
    )
    logger.newline()
    logger.info('Deploy now:')
    logger.dim('  git add . && git commit -m "add deploy pipeline" && git push')
    logger.newline()
  } else {
    logger.success('GitHub Actions deploy pipeline ready!')
    logger.newline()
    logger.info(
      'Pipeline: git push → build & push to GHCR → SSH deploy → health check',
    )
    logger.newline()
    logger.info('Required GitHub Secrets (Settings → Secrets → Actions):')
    logger.dim('  DEPLOY_HOST       — Remote server IP or hostname')
    logger.dim('  DEPLOY_USER       — SSH username (e.g. root)')
    logger.dim('  DEPLOY_SSH_KEY    — Private SSH key for the server')
    logger.dim('  DEPLOY_GHCR_TOKEN — GitHub PAT with read:packages scope')
    logger.newline()
    logger.info('How it works:')
    logger.dim('  1. Push to main branch')
    logger.dim('  2. GitHub Actions builds image, pushes to ghcr.io')
    logger.dim(
      `  3. SSHs to server, pulls image, deploys "${projectName}" to fnkit-network`,
    )
    logger.dim('  4. Health check verifies the container is running')
    logger.dim(`  5. Available at gateway: /${projectName}`)
    logger.newline()
    logger.info('Deploy now:')
    logger.dim('  git add . && git commit -m "add deploy pipeline" && git push')
    logger.newline()
  }

  return true
}

export async function deployRunner(
  options: DeployOptions = {},
): Promise<boolean> {
  const outputDir = options.output || RUNNER_DIR
  const targetDir = resolve(process.cwd(), outputDir)

  logger.title('Creating Forgejo Actions Runner')

  if (existsSync(targetDir)) {
    logger.error(`Directory already exists: ${outputDir}`)
    return false
  }

  // Create directory
  mkdirSync(targetDir, { recursive: true })

  // Write files
  const files: Record<string, string> = {
    'docker-compose.yml': RUNNER_DOCKER_COMPOSE.trim(),
    '.env.example': RUNNER_ENV_EXAMPLE.trim(),
    'README.md': RUNNER_README.trim(),
  }

  for (const [filename, content] of Object.entries(files)) {
    const filePath = join(targetDir, filename)
    writeFileSync(filePath, content)
    logger.success(`Created ${filename}`)
  }

  logger.newline()
  logger.success(`Runner files created in ${outputDir}/`)
  logger.newline()

  // Print setup instructions
  console.log(
    '╔════════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║                  🏃 Runner Setup Steps                       ║',
  )
  console.log(
    '╚════════════════════════════════════════════════════════════════╝',
  )
  console.log('')
  console.log('   1. Enable Actions in Forgejo:')
  console.log('      Site Administration → Actions → Enable')
  console.log('')
  console.log('   2. Get a runner registration token:')
  console.log(
    '      Site Administration → Actions → Runners → Create new runner',
  )
  console.log('')
  console.log('   3. Configure environment:')
  console.log(`      cd ${outputDir}`)
  console.log('      cp .env.example .env')
  console.log('      # Edit .env with your values')
  console.log('')
  console.log('   4. Start the runner:')
  console.log('      docker compose up -d')
  console.log('')
  console.log('   5. Verify in Forgejo:')
  console.log('      Site Administration → Actions → Runners')
  console.log('      The runner should appear as online')
  console.log('')
  console.log('   The runner auto-registers on first startup and persists')
  console.log('   registration in the runner-data volume.')
  console.log('')

  return true
}

export async function deploySetup(
  options: DeployOptions = {},
): Promise<boolean> {
  const provider = options.provider || 'forgejo'
  const projectDir = resolve(process.cwd())
  const projectName = basename(projectDir)

  logger.title('FnKit Deploy Setup')

  // Check prerequisites
  logger.info('Checking prerequisites...')
  logger.newline()

  // Check git
  const { commandExists } = await import('../utils/shell')
  const gitInstalled = await commandExists('git')
  if (!gitInstalled) {
    logger.error('Git is not installed')
    return false
  }
  logger.success('Git installed')

  // Check if git repo
  const { isGitRepo } = await import('../utils/git')
  const isRepo = await isGitRepo(projectDir)
  if (!isRepo) {
    logger.warn('Not a git repository — initializing...')
    const { init } = await import('../utils/git')
    await init(projectDir)
    logger.success('Git repository initialized')
  } else {
    logger.success('Git repository found')
  }

  // Check for Dockerfile
  if (!existsSync(join(projectDir, 'Dockerfile'))) {
    logger.error('No Dockerfile found')
    logger.info('Run "fnkit init" to generate a Dockerfile for your project')
    return false
  }
  logger.success('Dockerfile found')

  // Check git remote
  const remoteResult = await exec('git', ['remote', '-v'], { cwd: projectDir })
  const hasRemote =
    remoteResult.success && remoteResult.stdout.includes('origin')
  if (!hasRemote) {
    logger.warn('No git remote configured')
    logger.newline()
    if (provider === 'forgejo') {
      logger.info('Add a remote:')
      logger.dim(
        `  git remote add origin https://your-forgejo/user/${projectName}.git`,
      )
    } else {
      logger.info('Add a remote:')
      logger.dim(
        `  git remote add origin https://github.com/user/${projectName}.git`,
      )
    }
    logger.newline()
  } else {
    logger.success('Git remote configured')
  }

  // Check Docker
  const { isDockerAvailable, isDockerRunning } = await import('../utils/docker')
  if (await isDockerAvailable()) {
    if (await isDockerRunning()) {
      logger.success('Docker is running')
    } else {
      logger.warn('Docker is installed but not running')
    }
  } else {
    logger.warn('Docker not found (needed on deploy server)')
  }

  logger.newline()

  // Generate workflow
  const initSuccess = await deployInit(options)
  if (!initSuccess) {
    return false
  }

  // Summary
  console.log(
    '╔════════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║                  📋 Deploy Checklist                         ║',
  )
  console.log(
    '╚════════════════════════════════════════════════════════════════╝',
  )
  console.log('')

  if (provider === 'forgejo') {
    console.log(`   ${hasRemote ? '✅' : '⬜'} Git remote configured`)
    console.log('   ✅ Deploy workflow created')
    console.log('   ⬜ Forgejo runner deployed (fnkit deploy runner)')
    console.log('   ⬜ Push to main to deploy')
  } else {
    console.log(`   ${hasRemote ? '✅' : '⬜'} Git remote configured`)
    console.log('   ✅ Deploy workflow created')
    console.log('   ⬜ GitHub secrets configured')
    console.log('   ⬜ Push to main to deploy')
  }
  console.log('')

  return true
}

export async function deployStatus(): Promise<boolean> {
  const projectDir = resolve(process.cwd())
  const projectName = basename(projectDir)

  logger.title(`Deploy Status: ${projectName}`)

  // Check if deploy workflow exists
  const forgejoWorkflow = join(
    projectDir,
    '.forgejo',
    'workflows',
    'deploy.yml',
  )
  const githubWorkflow = join(projectDir, '.github', 'workflows', 'deploy.yml')

  let provider: string | null = null
  if (existsSync(forgejoWorkflow)) {
    provider = 'forgejo'
    logger.success('Pipeline: Forgejo Actions')
  } else if (existsSync(githubWorkflow)) {
    provider = 'github'
    logger.success('Pipeline: GitHub Actions')
  } else {
    logger.warn('No deploy pipeline configured')
    logger.info(
      'Run "fnkit deploy init" or "fnkit deploy setup" to set up CI/CD',
    )
    return true
  }

  // Check git status
  const remoteResult = await exec('git', ['remote', '-v'], { cwd: projectDir })
  if (remoteResult.success && remoteResult.stdout.trim()) {
    const lines = remoteResult.stdout.trim().split('\n')
    const pushRemote = lines.find((l) => l.includes('(push)'))
    if (pushRemote) {
      logger.success(
        `Remote: ${pushRemote.split('\t')[1]?.split(' ')[0] || 'configured'}`,
      )
    }
  } else {
    logger.warn('No git remote configured')
  }

  // Check local git status
  const statusResult = await exec('git', ['status', '--porcelain'], {
    cwd: projectDir,
  })
  if (statusResult.success) {
    const changes = statusResult.stdout.trim()
    if (changes) {
      const fileCount = changes.split('\n').length
      logger.warn(`${fileCount} uncommitted change${fileCount > 1 ? 's' : ''}`)
    } else {
      logger.success('Working tree clean')
    }
  }

  // Check last commit
  const logResult = await exec('git', ['log', '-1', '--format=%h %s (%cr)'], {
    cwd: projectDir,
  })
  if (logResult.success && logResult.stdout.trim()) {
    logger.info(`Last commit: ${logResult.stdout.trim()}`)
  }

  // Check if container is running (if Docker is available)
  const { isDockerAvailable, isDockerRunning } = await import('../utils/docker')
  if ((await isDockerAvailable()) && (await isDockerRunning())) {
    logger.newline()
    logger.info('Container status:')

    const containerResult = await exec('docker', [
      'ps',
      '-a',
      '--filter',
      `name=^${projectName}$`,
      '--format',
      '{{.Status}}\t{{.Image}}\t{{.CreatedAt}}',
    ])

    if (containerResult.success && containerResult.stdout.trim()) {
      const [status, image, created] = containerResult.stdout.trim().split('\t')
      const isRunning = status?.startsWith('Up')
      if (isRunning) {
        logger.success(`Running: ${status}`)
      } else {
        logger.warn(`Stopped: ${status}`)
      }
      logger.dim(`  Image: ${image}`)
      logger.dim(`  Created: ${created}`)

      // Check deploy timestamp label
      const labelResult = await exec('docker', [
        'inspect',
        '--format',
        '{{index .Config.Labels "fnkit.deployed"}}',
        projectName,
      ])
      if (labelResult.success && labelResult.stdout.trim()) {
        logger.dim(`  Deployed: ${labelResult.stdout.trim()}`)
      }
    } else {
      logger.dim('  Container not found (not deployed yet)')
    }
  }

  logger.newline()
  return true
}

export async function deploy(
  subcommand: string,
  options: DeployOptions = {},
): Promise<boolean> {
  switch (subcommand) {
    case 'init':
      return deployInit(options)
    case 'runner':
      return deployRunner(options)
    case 'setup':
      return deploySetup(options)
    case 'status':
      return deployStatus()
    default:
      logger.error(`Unknown deploy command: ${subcommand}`)
      logger.info('Available commands: init, runner, setup, status')
      logger.newline()
      logger.dim(
        '  fnkit deploy setup                  — Guided pipeline setup',
      )
      logger.dim(
        '  fnkit deploy init                   — Generate deploy workflow (Forgejo)',
      )
      logger.dim(
        '  fnkit deploy init --provider github — Generate deploy workflow (GitHub)',
      )
      logger.dim(
        '  fnkit deploy runner                 — Generate Forgejo runner setup',
      )
      logger.dim(
        '  fnkit deploy status                 — Check deployment status',
      )
      return false
  }
}

export default deploy
