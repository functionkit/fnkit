// List deployed fnkit containers

import {
  isDockerAvailable,
  isDockerRunning,
  listContainers,
  type ContainerInfo,
} from '../utils/docker'
import logger from '../utils/logger'

export interface ContainersOptions {
  all?: boolean // Show all containers, not just fnkit.fn labeled ones
}

export async function containers(
  options: ContainersOptions = {},
): Promise<boolean> {
  // Check Docker availability
  if (!(await isDockerAvailable())) {
    logger.error('Docker is not installed')
    return false
  }

  if (!(await isDockerRunning())) {
    logger.error('Docker is not running')
    return false
  }

  console.log(
    '╔════════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║                    🐳 FNKIT Containers                       ║',
  )
  console.log(
    '╚════════════════════════════════════════════════════════════════╝',
  )
  console.log('')

  // Get containers - filter by fnkit.fn label unless --all is specified
  const labelFilter = options.all ? undefined : 'fnkit.fn=true'
  const containerList = await listContainers(labelFilter)

  if (containerList.length === 0) {
    if (options.all) {
      console.log('   No containers found.')
    } else {
      console.log('   No fnkit containers found.')
      console.log('')
      console.log(
        '   Containers must have the label fnkit.fn=true to appear here.',
      )
      console.log('   Use --all to show all containers.')
    }
    console.log('')
    return true
  }

  // Calculate column widths
  const nameWidth = Math.max(12, ...containerList.map((c) => c.name.length))
  const imageWidth = Math.max(10, ...containerList.map((c) => c.image.length))

  // Print header
  console.log(
    `   ${'NAME'.padEnd(nameWidth)}  STATUS     ${'IMAGE'.padEnd(imageWidth)}  PORTS`,
  )
  console.log(`   ${'─'.repeat(nameWidth + imageWidth + 30)}`)

  // Print containers
  for (const container of containerList) {
    const isRunning = container.state === 'running'
    const statusIcon = isRunning ? '🟢' : '⚫'
    const statusText = isRunning ? 'running' : 'stopped'
    const ports = container.ports || '-'

    console.log(
      `   ${statusIcon} ${container.name.padEnd(nameWidth)}  ${statusText.padEnd(9)}  ${container.image.padEnd(imageWidth)}  ${ports}`,
    )
  }

  console.log('')

  // Summary
  const running = containerList.filter((c) => c.state === 'running').length
  const stopped = containerList.length - running
  console.log(`   Summary: ${running} running, ${stopped} stopped`)
  console.log('')

  // Commands hint
  console.log('   Commands:')
  console.log('   - Logs:    fnkit container logs <name>')
  console.log('   - Stop:    fnkit container stop <name>')
  console.log('   - Shell:   docker exec -it <name> sh')
  console.log('   - Remove:  docker rm <name>')
  console.log('')

  return true
}
