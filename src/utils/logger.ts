// Logger utility with colored output

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
}

export const logger = {
  info: (msg: string) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg: string) =>
    console.log(`${colors.green}✓${colors.reset} ${msg}`),
  warn: (msg: string) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  error: (msg: string) => console.log(`${colors.red}✗${colors.reset} ${msg}`),

  step: (msg: string) => console.log(`${colors.cyan}→${colors.reset} ${msg}`),

  title: (msg: string) =>
    console.log(`\n${colors.bold}${colors.magenta}${msg}${colors.reset}\n`),

  dim: (msg: string) => console.log(`${colors.dim}${msg}${colors.reset}`),

  newline: () => console.log(),
}

export default logger
