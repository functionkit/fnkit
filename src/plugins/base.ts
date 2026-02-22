// Plugin system base interface and types

export interface PluginCommand {
  name: string
  description: string
  subcommands: string[]
  handler: (
    subcmd: string,
    args: string[],
    options: Record<string, string | boolean>,
  ) => Promise<boolean>
}

export interface Plugin {
  name: string
  displayName: string
  description: string
  commands: PluginCommand[]
}

export function createPlugin(config: Plugin): Plugin {
  return config
}
