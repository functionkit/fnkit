// Plugin registry - all registered plugins

import type { Plugin } from './base'
export type { Plugin, PluginCommand } from './base'

// Import plugins
import { unsPlugin } from './uns'

// All registered plugins
export const plugins: Record<string, Plugin> = {
  uns: unsPlugin,
}

export function getPlugin(name: string): Plugin | undefined {
  return plugins[name.toLowerCase()]
}

export function getAllPlugins(): Plugin[] {
  return Object.values(plugins)
}

export function getPluginNames(): string[] {
  return Object.keys(plugins)
}
