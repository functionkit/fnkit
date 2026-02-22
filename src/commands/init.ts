// Init command - initialize existing project as a function

import { existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join, basename, resolve } from 'path'
import logger from '../utils/logger'
import * as git from '../utils/git'
import { getAllRuntimes, getRuntime, type Runtime } from '../runtimes'

export interface InitOptions {
  runtime?: string
}

export async function init(options: InitOptions = {}): Promise<boolean> {
  const projectDir = resolve(process.cwd())
  const projectName = basename(projectDir)

  logger.title(`Initializing function: ${projectName}`)

  // Detect or use specified runtime
  let runtime: Runtime | null = null

  if (options.runtime) {
    runtime = getRuntime(options.runtime) || null
    if (!runtime) {
      logger.error(`Unknown runtime: ${options.runtime}`)
      return false
    }
  } else {
    runtime = await detectRuntime(projectDir)
    if (!runtime) {
      logger.error('Could not auto-detect runtime')
      logger.info('Specify runtime with: fnkit init --runtime <runtime>')
      logger.info(
        'Available: nodejs, python, go, java, ruby, dotnet, php, dart, cpp',
      )
      return false
    }
  }

  logger.success(`Detected runtime: ${runtime.displayName}`)

  // Check if runtime is installed
  const isInstalled = await runtime.isInstalled()
  if (!isInstalled) {
    logger.warn(`${runtime.displayName} is not installed`)
    logger.dim(runtime.installHint)
  }

  // Initialize git if not already
  const isGitRepo = await git.isGitRepo(projectDir)
  if (!isGitRepo) {
    logger.step('Initializing git repository...')
    await git.init(projectDir)
    logger.success('Git repository initialized')
  } else {
    logger.success('Git repository already exists')
  }

  // Create Dockerfile if not exists
  const dockerfilePath = join(projectDir, 'Dockerfile')
  if (!existsSync(dockerfilePath)) {
    logger.step('Creating Dockerfile...')
    const dockerfile = runtime.generateDockerfile(projectName, 'helloWorld')
    await writeFile(dockerfilePath, dockerfile)
    logger.success('Created Dockerfile')
  } else {
    logger.success('Dockerfile already exists')
  }

  // Create .gitignore if not exists
  const gitignorePath = join(projectDir, '.gitignore')
  if (!existsSync(gitignorePath)) {
    logger.step('Creating .gitignore...')
    const gitignore = generateGitignore(runtime.name)
    await writeFile(gitignorePath, gitignore)
    logger.success('Created .gitignore')
  }

  logger.newline()
  logger.success('Function initialized!')
  logger.newline()
  logger.info('Next steps:')
  logger.dim('  fnkit run      # Run locally')
  logger.dim('  fnkit publish  # Build Docker container')
  logger.newline()

  return true
}

async function detectRuntime(projectDir: string): Promise<Runtime | null> {
  const runtimes = getAllRuntimes()

  for (const runtime of runtimes) {
    for (const pattern of runtime.filePatterns) {
      if (pattern.includes('*')) {
        const { readdir } = await import('fs/promises')
        const files = await readdir(projectDir)
        const ext = pattern.replace('*', '')
        if (files.some((f) => f.endsWith(ext))) {
          return runtime
        }
      } else {
        const filePath = join(projectDir, pattern)
        if (existsSync(filePath)) {
          return runtime
        }
      }
    }
  }

  return null
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
`,
    dotnet: `# .NET
bin/
obj/
*.user
`,
    php: `# PHP
vendor/
`,
    dart: `# Dart
.dart_tool/
.packages
build/
`,
    cpp: `# C++
build/
*.o
*.a
`,
  }

  return common + (runtimeSpecific[runtimeName] || '')
}

export default init
