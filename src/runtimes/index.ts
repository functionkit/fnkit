// Runtime registry - all supported runtimes

import type { Runtime, RuntimeConfig } from './base'
export type { Runtime, RuntimeConfig }

// Import all runtimes from individual files
import { nodejs } from './nodejs'
import { python } from './python'
import { go } from './go'
import { java } from './java'
import { ruby } from './ruby'
import { dotnet } from './dotnet'
import { php } from './php'
import { dart } from './dart'
import { cpp } from './cpp'
import { nodejsMqtt } from './nodejs-mqtt'
import { goMqtt } from './go-mqtt'
import { dotnetMqtt } from './dotnet-mqtt'

// Canonical runtime names only - no aliases
export const runtimes: Record<string, Runtime> = {
  node: nodejs,
  python,
  go,
  java,
  ruby,
  dotnet,
  php,
  dart,
  cpp,
  'node-mqtt': nodejsMqtt,
  'go-mqtt': goMqtt,
  'dotnet-mqtt': dotnetMqtt,
}

export function getRuntime(name: string): Runtime | undefined {
  return runtimes[name.toLowerCase()]
}

export function getAllRuntimes(): Runtime[] {
  return Object.values(runtimes)
}

export function getRuntimeNames(): string[] {
  return Object.keys(runtimes)
}
