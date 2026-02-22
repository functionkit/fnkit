// Publish command - build deployable container using Docker

import { existsSync } from 'fs'
import { basename, resolve } from 'path'
import logger from '../utils/logger'
import * as docker from '../utils/docker'

export interface PublishOptions {
  tag?: string
  target?: string
  registry?: string
  push?: boolean
}

export async function publish(options: PublishOptions = {}): Promise<boolean> {
  const projectDir = resolve(process.cwd())
  const projectName = basename(projectDir)

  logger.title(`Publishing: ${projectName}`)

  // Check for Dockerfile
  const dockerfilePath = `${projectDir}/Dockerfile`
  if (!existsSync(dockerfilePath)) {
    logger.error('No Dockerfile found in project directory')
    logger.info('Run "fnkit init" to generate a Dockerfile for your project')
    return false
  }

  // Check Docker availability
  if (!(await docker.isDockerAvailable())) {
    logger.error('Docker is not installed')
    logger.dim('Install Docker from https://docker.com')
    return false
  }

  if (!(await docker.isDockerRunning())) {
    logger.error('Docker is not running')
    logger.dim('Please start Docker and try again')
    return false
  }

  logger.success('Docker is available')

  // Determine tag
  const tag = options.tag || `fnkit-fn-${projectName}:latest`
  const fullTag = options.registry ? `${options.registry}/${tag}` : tag

  // Build with Docker
  const buildSuccess = await docker.build(projectDir, {
    tag: fullTag,
  })

  if (!buildSuccess) {
    logger.error('Build failed')
    return false
  }

  logger.success(`Built image: ${fullTag}`)

  // Push if requested
  if (options.push && options.registry) {
    logger.step(`Pushing to ${options.registry}...`)
    const pushSuccess = await docker.push(fullTag)
    if (!pushSuccess) {
      logger.error('Failed to push image')
      return false
    }
    logger.success(`Pushed: ${fullTag}`)
  }

  logger.newline()
  logger.success('Build complete!')
  logger.newline()
  logger.info('Run with gateway (recommended):')
  logger.dim(
    `  docker run -d --name ${projectName} --network fnkit-network --label fnkit.fn=true ${fullTag}`,
  )
  logger.dim(
    `  curl -H "Authorization: Bearer <token>" http://localhost:8080/${projectName}`,
  )
  logger.newline()
  logger.info('Or run standalone:')
  logger.dim(`  docker run -p 8080:8080 ${fullTag}`)
  logger.dim('  curl http://localhost:8080')
  logger.newline()

  return true
}

export default publish
