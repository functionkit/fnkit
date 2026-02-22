// Shell utility for executing commands

import { spawn } from 'bun'

export interface ExecResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number
}

export async function exec(
  command: string,
  args: string[] = [],
  options: { cwd?: string; silent?: boolean } = {},
): Promise<ExecResult> {
  const proc = spawn({
    cmd: [command, ...args],
    cwd: options.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited

  return {
    success: exitCode === 0,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode,
  }
}

export async function execStream(
  command: string,
  args: string[] = [],
  options: { cwd?: string } = {},
): Promise<number> {
  const proc = spawn({
    cmd: [command, ...args],
    cwd: options.cwd,
    stdout: 'inherit',
    stderr: 'inherit',
  })

  return await proc.exited
}

export async function commandExists(command: string): Promise<boolean> {
  const result = await exec('which', [command])
  return result.success
}

export async function getCommandVersion(
  command: string,
  versionFlag = '--version',
): Promise<string | null> {
  const result = await exec(command, [versionFlag])
  if (result.success) {
    return result.stdout.split('\n')[0]
  }
  return null
}
