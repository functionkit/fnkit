// Docker utility functions

import { exec, execStream, commandExists } from './shell'
import logger from './logger'

export async function isDockerAvailable(): Promise<boolean> {
  return await commandExists('docker')
}

export async function isDockerRunning(): Promise<boolean> {
  const result = await exec('docker', ['info'])
  return result.success
}

export async function build(
  contextDir: string,
  options: {
    tag?: string
    dockerfile?: string
    buildArgs?: Record<string, string>
  } = {},
): Promise<boolean> {
  const args = ['build']

  if (options.tag) {
    args.push('-t', options.tag)
  }

  if (options.dockerfile) {
    args.push('-f', options.dockerfile)
  }

  if (options.buildArgs) {
    for (const [key, value] of Object.entries(options.buildArgs)) {
      args.push('--build-arg', `${key}=${value}`)
    }
  }

  args.push(contextDir)

  logger.step(`Building Docker image...`)
  const exitCode = await execStream('docker', args)
  return exitCode === 0
}

export async function push(tag: string): Promise<boolean> {
  logger.step(`Pushing ${tag}...`)
  const exitCode = await execStream('docker', ['push', tag])
  return exitCode === 0
}

export async function tag(source: string, target: string): Promise<boolean> {
  const result = await exec('docker', ['tag', source, target])
  return result.success
}

export async function imageExists(tag: string): Promise<boolean> {
  const result = await exec('docker', ['image', 'inspect', tag])
  return result.success
}

export interface ContainerInfo {
  id: string
  name: string
  status: string
  state: string
  image: string
  created: string
  ports: string
  labels: Record<string, string>
}

export async function listContainers(
  labelFilter?: string,
): Promise<ContainerInfo[]> {
  const args = [
    'ps',
    '-a',
    '--format',
    '{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.State}}\t{{.Image}}\t{{.CreatedAt}}\t{{.Ports}}',
  ]

  if (labelFilter) {
    args.push('--filter', `label=${labelFilter}`)
  }

  const result = await exec('docker', args)
  if (!result.success || !result.stdout.trim()) {
    return []
  }

  const lines = result.stdout.trim().split('\n')
  const containers: ContainerInfo[] = []

  for (const line of lines) {
    const [id, name, status, state, image, created, ports] = line.split('\t')
    if (id) {
      // Get labels for this container
      const labels = await getContainerLabels(id)
      containers.push({
        id,
        name,
        status,
        state,
        image,
        created,
        ports: ports || '',
        labels,
      })
    }
  }

  return containers
}

export async function getContainerLabels(
  containerId: string,
): Promise<Record<string, string>> {
  const result = await exec('docker', [
    'inspect',
    '--format',
    '{{json .Config.Labels}}',
    containerId,
  ])

  if (!result.success || !result.stdout.trim()) {
    return {}
  }

  try {
    return JSON.parse(result.stdout.trim()) || {}
  } catch {
    return {}
  }
}
