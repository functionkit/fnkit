// Plugin registry - all registered plugins

import type { Plugin } from './base'
export type { Plugin, PluginCommand } from './base'

// Import plugins
import { mqttPlugin } from './mqtt'

// All registered plugins
export const plugins: Record<string, Plugin> = {
  mqtt: mqttPlugin,
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
