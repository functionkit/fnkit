// MQTT Plugin — UNS (Unified Namespace) functions for fnkit
// Provides: fnkit mqtt uns|cache|log|status

import { createPlugin } from '../base'
import logger from '../../utils/logger'
import { unsInit, unsStart, unsStop, unsStatus } from './uns'
import { unsCacheInit, unsCacheStart, unsCacheStop, unsCacheStatus } from './cache'
import { unsLogInit, unsLogStart, unsLogStop, unsLogStatus } from './log'

export const mqttPlugin = createPlugin({
  name: 'mqtt',
  displayName: 'MQTT / UNS',
  description:
    'Unified Namespace (UNS) functions — MQTT topic monitor, cache reader, and PostgreSQL logger',
  commands: [
    {
      name: 'uns',
      description:
        'UNS topic monitor — Go MQTT function that subscribes to v1.0/# and caches all data',
      subcommands: ['init', 'start', 'stop'],
      handler: async (subcmd, args, options) => {
        switch (subcmd) {
          case 'init':
            return unsInit(args, options)
          case 'start':
            return unsStart(args, options)
          case 'stop':
            return unsStop(args, options)
          default:
            logger.error(`Unknown uns command: ${subcmd}`)
            logger.info('Available: init, start, stop')
            return false
        }
      },
    },
    {
      name: 'cache',
      description:
        'UNS cache reader — Node.js HTTP function that reads cached topic data and returns JSON',
      subcommands: ['init', 'start', 'stop'],
      handler: async (subcmd, args, options) => {
        switch (subcmd) {
          case 'init':
            return unsCacheInit(args, options)
          case 'start':
            return unsCacheStart(args, options)
          case 'stop':
            return unsCacheStop(args, options)
          default:
            logger.error(`Unknown cache command: ${subcmd}`)
            logger.info('Available: init, start, stop')
            return false
        }
      },
    },
    {
      name: 'log',
      description:
        'UNS PostgreSQL logger — Go HTTP function that logs cache changes to PostgreSQL',
      subcommands: ['init', 'start', 'stop'],
      handler: async (subcmd, args, options) => {
        switch (subcmd) {
          case 'init':
            return unsLogInit(args, options)
          case 'start':
            return unsLogStart(args, options)
          case 'stop':
            return unsLogStop(args, options)
          default:
            logger.error(`Unknown log command: ${subcmd}`)
            logger.info('Available: init, start, stop')
            return false
        }
      },
    },
    {
      name: 'status',
      description: 'Show status of all MQTT/UNS components',
      subcommands: [],
      handler: async () => {
        logger.title('MQTT / UNS Status')
        await unsStatus()
        await unsCacheStatus()
        await unsLogStatus()
        return true
      },
    },
  ],
})
