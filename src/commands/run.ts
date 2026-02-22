// Run command - local development server

import { existsSync } from 'fs'
import { join, resolve } from 'path'
import logger from '../utils/logger'
import { execStream } from '../utils/shell'
import { getAllRuntimes, type Runtime } from '../runtimes'

export interface RunOptions {
  target?: string
  port?: number
}

export async function run(options: RunOptions = {}): Promise<boolean> {
  const projectDir = resolve(process.cwd())

  // Detect runtime
  const runtime = await detectRuntime(projectDir)
  if (!runtime) {
    logger.error('Could not detect runtime')
    logger.info('Make sure you are in a function project directory')
    return false
  }

  logger.title(`Running ${runtime.displayName} function`)

  // Check if runtime is installed
  const isInstalled = await runtime.isInstalled()
  if (!isInstalled) {
    logger.error(`${runtime.displayName} is not installed`)
    logger.dim(runtime.installHint)
    return false
  }

  const version = await runtime.getVersion()
  logger.success(`${runtime.displayName}: ${version}`)

  // Build run command with options
  let runCmd = [...runtime.runCommand]

  if (options.target) {
    // Replace target in command
    runCmd = runCmd.map((arg) =>
      arg.includes('--target=') ? `--target=${options.target}` : arg,
    )
  }

  if (options.port) {
    // Add or replace port
    const portArgIndex = runCmd.findIndex(
      (arg) => arg.includes('--port') || arg.includes('-p'),
    )
    if (portArgIndex >= 0) {
      runCmd[portArgIndex] = `--port=${options.port}`
    } else {
      runCmd.push(`--port=${options.port}`)
    }
  }

  logger.step(`Running: ${runCmd.join(' ')}`)
  logger.newline()

  const exitCode = await execStream(runCmd[0], runCmd.slice(1), {
    cwd: projectDir,
  })

  return exitCode === 0
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

export default run
