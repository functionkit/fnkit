// Doctor command - check runtime dependencies

import logger from '../utils/logger'
import { commandExists, getCommandVersion } from '../utils/shell'
import { isDockerAvailable, isDockerRunning } from '../utils/docker'
import { getAllRuntimes, getRuntime } from '../runtimes'
import type { Runtime } from '../runtimes'

export async function doctor(runtimeName?: string): Promise<boolean> {
  logger.title('FNKIT Doctor')

  let allGood = true

  // Check essential tools
  logger.info('Checking essential tools...')
  logger.newline()

  // Git
  const gitInstalled = await commandExists('git')
  if (gitInstalled) {
    const version = await getCommandVersion('git', '--version')
    logger.success(`git: ${version}`)
  } else {
    logger.error('git: not installed')
    logger.dim('  Install: brew install git')
    allGood = false
  }

  // Docker
  const dockerInstalled = await isDockerAvailable()
  if (dockerInstalled) {
    const version = await getCommandVersion('docker', '--version')
    const running = await isDockerRunning()
    if (running) {
      logger.success(`docker: ${version}`)
    } else {
      logger.warn(`docker: ${version} (not running)`)
      logger.dim('  Please start Docker Desktop')
      allGood = false
    }
  } else {
    logger.error('docker: not installed')
    logger.dim('  Install from https://docker.com')
    allGood = false
  }

  logger.newline()

  // Check specific runtime or all runtimes
  if (runtimeName) {
    const runtime = getRuntime(runtimeName)
    if (!runtime) {
      logger.error(`Unknown runtime: ${runtimeName}`)
      return false
    }

    logger.info(`Checking ${runtime.displayName}...`)
    logger.newline()

    const runtimeOk = await checkRuntime(runtime)
    if (!runtimeOk) {
      allGood = false
    }
  } else {
    logger.info('Checking all runtimes...')
    logger.newline()

    const runtimes = getAllRuntimes()
    for (const runtime of runtimes) {
      const installed = await runtime.isInstalled()
      if (installed) {
        const version = await runtime.getVersion()
        logger.success(`${runtime.displayName}: ${version}`)
      } else {
        logger.dim(`${runtime.displayName}: not installed`)
      }
    }
  }

  logger.newline()

  if (allGood) {
    logger.success('All checks passed!')
  } else {
    logger.warn('Some checks failed. See above for details.')
  }

  return allGood
}

async function checkRuntime(runtime: Runtime): Promise<boolean> {
  let allGood = true

  // Check main runtime
  const installed = await runtime.isInstalled()
  if (installed) {
    const version = await runtime.getVersion()
    logger.success(`${runtime.displayName}: ${version}`)
  } else {
    logger.error(`${runtime.displayName}: not installed`)
    logger.dim(`  ${runtime.installHint}`)
    allGood = false
  }

  // Check build tools
  const buildToolsStatus = await runtime.getBuildToolsStatus()
  for (const { tool, installed, version } of buildToolsStatus) {
    if (installed) {
      logger.success(`${tool.name}: ${version}`)
    } else {
      logger.error(`${tool.name}: not installed`)
      logger.dim(`  ${tool.installHint}`)
      allGood = false
    }
  }

  return allGood
}

export default doctor
