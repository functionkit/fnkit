// Base runtime interface and types

export interface ProjectTemplate {
  files: Record<string, string> // filename -> content
  postCreate?: string[] // commands to run after creating files (e.g., npm install)
}

export interface BuildTool {
  name: string
  command: string
  args: string[]
  installHint: string
}

export interface BuildToolStatus {
  tool: BuildTool
  installed: boolean
  version: string | null
}

export interface RuntimeConfig {
  name: string
  displayName: string
  repo: string
  quickstartUrl: string
  checkCommand: string
  checkArgs: string[]
  installHint: string
  dockerfile: string
  runCommand: string[]
  devCommand?: string[]
  filePatterns: string[] // Files that identify this runtime
  buildTools?: BuildTool[] // Additional tools needed (e.g., Maven for Java)
  template: (projectName: string) => ProjectTemplate
}

export interface Runtime extends RuntimeConfig {
  isInstalled(): Promise<boolean>
  getVersion(): Promise<string | null>
  getBuildToolsStatus(): Promise<BuildToolStatus[]>
  generateDockerfile(projectName: string, entrypoint?: string): string
  generateProject(projectName: string): ProjectTemplate
}

import { commandExists, getCommandVersion } from '../utils/shell'

export function createRuntime(config: RuntimeConfig): Runtime {
  return {
    ...config,
    async isInstalled(): Promise<boolean> {
      return await commandExists(config.checkCommand)
    },
    async getVersion(): Promise<string | null> {
      return await getCommandVersion(config.checkCommand, config.checkArgs[0])
    },
    async getBuildToolsStatus(): Promise<BuildToolStatus[]> {
      if (!config.buildTools || config.buildTools.length === 0) {
        return []
      }
      const results: BuildToolStatus[] = []
      for (const tool of config.buildTools) {
        const installed = await commandExists(tool.command)
        const version = installed
          ? await getCommandVersion(tool.command, tool.args[0])
          : null
        results.push({ tool, installed, version })
      }
      return results
    },
    generateDockerfile(projectName: string, entrypoint?: string): string {
      return config.dockerfile
        .replace(/\{\{PROJECT_NAME\}\}/g, projectName)
        .replace(/\{\{ENTRYPOINT\}\}/g, entrypoint || 'helloWorld')
    },
    generateProject(projectName: string): ProjectTemplate {
      return config.template(projectName)
    },
  }
}
