// Node.js runtime
// https://github.com/GoogleCloudPlatform/functions-framework-nodejs

import { createRuntime } from './base'

export const nodejs = createRuntime({
  name: 'nodejs',
  displayName: 'Node.js',
  repo: 'https://github.com/GoogleCloudPlatform/functions-framework-nodejs',
  quickstartUrl:
    'https://github.com/GoogleCloudPlatform/functions-framework-nodejs?tab=readme-ov-file#quickstart-set-up-a-new-project',
  checkCommand: 'node',
  checkArgs: ['--version'],
  installHint:
    'Install Node.js from https://nodejs.org or use: brew install node',
  filePatterns: ['package.json'],
  runCommand: ['npm', 'start'],
  devCommand: ['npm', 'start'],
  dockerfile: `FROM node:20-slim
LABEL fnkit.fn="true"
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --only=production
COPY . .
# Shared cache (Valkey/Redis) — available to all functions on fnkit-network
ENV CACHE_URL=redis://fnkit-cache:6379
CMD ["npm", "start"]
`,
  template: (projectName: string) => ({
    files: {
      'package.json': JSON.stringify(
        {
          name: projectName,
          version: '1.0.0',
          main: 'index.js',
          scripts: {
            start: 'functions-framework --target=helloWorld',
          },
          dependencies: {
            '@google-cloud/functions-framework': '^3.0.0',
          },
        },
        null,
        2,
      ),
      'index.js': `const functions = require('@google-cloud/functions-framework');

// ── Shared cache (Valkey/Redis) ──────────────────────────────────────
// Uncomment to use the shared cache across all functions.
// Install: npm install ioredis
//
// const Redis = require('ioredis');
// const cache = new Redis(process.env.CACHE_URL || 'redis://fnkit-cache:6379');
//
// // Write to cache (with 5-minute TTL)
// await cache.set('mykey', JSON.stringify({ hello: 'world' }), 'EX', 300);
//
// // Read from cache
// const value = JSON.parse(await cache.get('mykey'));
// ─────────────────────────────────────────────────────────────────────

functions.http('helloWorld', (req, res) => {
  res.send('Hello, World!');
});
`,
    },
    postCreate: ['npm install'],
  }),
})
