// Git utility functions

import { exec, execStream } from './shell'
import logger from './logger'

export async function clone(
  repoUrl: string,
  targetDir: string,
  options: { depth?: number; branch?: string } = {},
): Promise<boolean> {
  const args = ['clone']

  if (options.depth) {
    args.push('--depth', options.depth.toString())
  }

  if (options.branch) {
    args.push('--branch', options.branch)
  }

  args.push(repoUrl, targetDir)

  logger.step(`Cloning ${repoUrl}...`)
  const exitCode = await execStream('git', args)
  return exitCode === 0
}

export async function init(dir: string): Promise<boolean> {
  const result = await exec('git', ['init'], { cwd: dir })
  return result.success
}

export async function removeGitHistory(dir: string): Promise<boolean> {
  const { rm } = await import('fs/promises')
  try {
    await rm(`${dir}/.git`, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

export async function addRemote(
  dir: string,
  name: string,
  url: string,
): Promise<boolean> {
  const result = await exec('git', ['remote', 'add', name, url], { cwd: dir })
  return result.success
}

export async function isGitRepo(dir: string): Promise<boolean> {
  const result = await exec('git', ['rev-parse', '--git-dir'], { cwd: dir })
  return result.success
}
