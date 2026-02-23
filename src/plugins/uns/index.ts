// UNS Plugin — Unified Namespace functions for fnkit
// Provides: fnkit uns uns|cache|log|status

import { createPlugin } from '../base'
import logger from '../../utils/logger'
import { unsInit, unsStart, unsStop, unsStatus } from './uns'
import { unsCacheInit, unsCacheStart, unsCacheStop, unsCacheStatus } from './cache'
import { unsLogInit, unsLogStart, unsLogStop, unsLogStatus } from './log'
import { opcuaInit, opcuaStart, opcuaStop, opcuaBuild, opcuaStatus } from './opcua'

export const unsPlugin = createPlugin({
  name: 'uns',
  displayName: 'UNS',
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
            logger.error(`Unknown uns subcommand: ${subcmd}`)
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
            logger.error(`Unknown cache subcommand: ${subcmd}`)
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
            logger.error(`Unknown log subcommand: ${subcmd}`)
            logger.info('Available: init, start, stop')
            return false
        }
      },
    },
    {
      name: 'opcua',
      description:
        'OPC-UA → MQTT bridge — Go app that reads OPC-UA tags and publishes to MQTT',
      subcommands: ['init', 'start', 'stop', 'build'],
      handler: async (subcmd, args, options) => {
        switch (subcmd) {
          case 'init':
            return opcuaInit(args, options)
          case 'start':
            return opcuaStart(args, options)
          case 'stop':
            return opcuaStop(args, options)
          case 'build':
            return opcuaBuild(args, options)
          default:
            logger.error(`Unknown opcua subcommand: ${subcmd}`)
            logger.info('Available: init, start, stop, build')
            return false
        }
      },
    },
    {
      name: 'status',
      description: 'Show status of all MQTT/UNS components',
      subcommands: [],
      handler: async () => {
        logger.title('UNS Status')
        await unsStatus()
        await unsCacheStatus()
        await unsLogStatus()
        await opcuaStatus()
        return true
      },
    },
  ],
})
