// Global install command - install fnkit globally

import { resolve, join } from 'path'
import { homedir, tmpdir } from 'os'
import logger from '../utils/logger'
import { exec, execStream } from '../utils/shell'

const isWindows = process.platform === 'win32'
const INSTALL_PATH = isWindows
  ? 'C:\\Program Files\\fnkit\\fnkit.exe'
  : '/usr/local/bin/fnkit'

const GITHUB_REPO = 'functionkit/fnkit'
const UPDATE_CHECK_DIR = join(homedir(), '.fnkit')
const UPDATE_CHECK_FILE = join(UPDATE_CHECK_DIR, 'update-check.json')
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

export async function global(): Promise<boolean> {
  logger.title('Installing FNKIT globally')

  // Get the path to the current executable
  const currentExe = process.execPath

  // Check if we're running from a compiled binary
  if (!currentExe || currentExe.includes('bun')) {
    logger.error('This command must be run from the compiled binary')
    logger.info('First build the binary with: bun run build')
    logger.info('Then run: ./dist/fnkit global')
    return false
  }

  logger.step(`Installing to ${INSTALL_PATH}...`)

  if (isWindows) {
    // Windows installation
    const { mkdir, copyFile } = await import('fs/promises')
    const { dirname } = await import('path')
    try {
      await mkdir(dirname(INSTALL_PATH), { recursive: true })
      await copyFile(currentExe, INSTALL_PATH)
      logger.info('Add to PATH: C:\\Program Files\\fnkit')
    } catch (err) {
      logger.error('Failed to install. Try running as Administrator.')
      return false
    }
  } else {
    // Unix installation
    const testResult = await exec('test', ['-w', '/usr/local/bin'])
    const needsSudo = !testResult.success

    if (needsSudo) {
      logger.info('Requires sudo for /usr/local/bin')
      const exitCode = await execStream('sudo', [
        'cp',
        currentExe,
        INSTALL_PATH,
      ])
      if (exitCode !== 0) {
        logger.error('Failed to install globally')
        return false
      }
      await execStream('sudo', ['chmod', '+x', INSTALL_PATH])
    } else {
      const { copyFile, chmod } = await import('fs/promises')
      await copyFile(currentExe, INSTALL_PATH)
      await chmod(INSTALL_PATH, 0o755)
    }
  }

  logger.newline()
  logger.success('FNKIT installed globally!')
  logger.newline()
  logger.info('You can now run fnkit from anywhere:')
  logger.dim('  fnkit --version')
  logger.dim('  fnkit doctor')
  logger.dim('  fnkit nodejs hello')
  logger.newline()

  return true
}

export async function uninstall(): Promise<boolean> {
  logger.title('Uninstalling FNKIT')

  const { existsSync } = await import('fs')
  if (!existsSync(INSTALL_PATH)) {
    logger.warn('FNKIT is not installed globally')
    return true
  }

  logger.step(`Removing ${INSTALL_PATH}...`)

  if (isWindows) {
    const { rm } = await import('fs/promises')
    try {
      await rm(INSTALL_PATH)
    } catch (err) {
      logger.error('Failed to uninstall. Try running as Administrator.')
      return false
    }
  } else {
    const testResult = await exec('test', ['-w', '/usr/local/bin'])
    const needsSudo = !testResult.success

    if (needsSudo) {
      const exitCode = await execStream('sudo', ['rm', INSTALL_PATH])
      if (exitCode !== 0) {
        logger.error('Failed to uninstall')
        return false
      }
    } else {
      const { rm } = await import('fs/promises')
      await rm(INSTALL_PATH)
    }
  }

  logger.newline()
  logger.success('FNKIT uninstalled!')
  logger.newline()

  return true
}

/**
 * Detect the correct binary name for the current platform
 */
function getBinaryName(): string | null {
  const platform = process.platform
  const arch = process.arch

  if (platform === 'darwin' && arch === 'arm64') return 'fnkit-macos-arm64'
  if (platform === 'darwin' && arch === 'x64') return 'fnkit-macos-x64'
  if (platform === 'linux' && arch === 'x64') return 'fnkit-linux-x64'
  if (platform === 'linux' && arch === 'arm64') return 'fnkit-linux-arm64'
  if (platform === 'win32' && arch === 'x64') return 'fnkit-windows-x64.exe'

  return null
}

/**
 * Fetch the latest release version from GitHub
 */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: { 'User-Agent': 'fnkit-cli' },
      },
    )
    if (!res.ok) return null
    const data = (await res.json()) as { tag_name: string }
    // tag_name is like "v0.13.0", strip the "v"
    return data.tag_name?.replace(/^v/, '') || null
  } catch {
    return null
  }
}

/**
 * Compare two semver strings. Returns:
 *  -1 if a < b, 0 if equal, 1 if a > b
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
  }
  return 0
}

/**
 * Install a binary from a temp path to the global install path
 */
async function installBinary(binaryPath: string): Promise<boolean> {
  if (isWindows) {
    const { mkdir, copyFile } = await import('fs/promises')
    const { dirname } = await import('path')
    try {
      await mkdir(dirname(INSTALL_PATH), { recursive: true })
      await copyFile(binaryPath, INSTALL_PATH)
    } catch {
      logger.error('Failed to install. Try running as Administrator.')
      return false
    }
  } else {
    const testResult = await exec('test', ['-w', '/usr/local/bin'])
    const needsSudo = !testResult.success

    if (needsSudo) {
      logger.info('Requires sudo for /usr/local/bin')
      const exitCode = await execStream('sudo', ['cp', binaryPath, INSTALL_PATH])
      if (exitCode !== 0) return false
      await execStream('sudo', ['chmod', '+x', INSTALL_PATH])
    } else {
      const { copyFile, chmod } = await import('fs/promises')
      await copyFile(binaryPath, INSTALL_PATH)
      await chmod(INSTALL_PATH, 0o755)
    }
  }
  return true
}

/**
 * Update fnkit to the latest version
 */
export async function update(currentVersion: string): Promise<boolean> {
  logger.title('Updating FNKIT')

  // Detect platform binary
  const binaryName = getBinaryName()
  if (!binaryName) {
    logger.error(`Unsupported platform: ${process.platform}-${process.arch}`)
    return false
  }

  // Check latest version
  logger.step('Checking for latest version...')
  const latestVersion = await fetchLatestVersion()
  if (!latestVersion) {
    logger.error('Failed to check for updates. Check your internet connection.')
    return false
  }

  logger.info(`Current version: v${currentVersion}`)
  logger.info(`Latest version:  v${latestVersion}`)

  if (compareSemver(currentVersion, latestVersion) >= 0) {
    logger.newline()
    logger.success('Already up to date!')
    return true
  }

  // Download latest binary
  const downloadUrl = `https://github.com/${GITHUB_REPO}/releases/latest/download/${binaryName}`
  const tempPath = join(tmpdir(), `fnkit-update-${Date.now()}`)

  logger.step(`Downloading ${binaryName}...`)
  const curlResult = await exec('curl', ['-fSL', downloadUrl, '-o', tempPath])
  if (!curlResult.success) {
    logger.error('Failed to download update')
    logger.dim(curlResult.stderr)
    return false
  }

  // Make executable on Unix
  if (!isWindows) {
    const { chmod } = await import('fs/promises')
    await chmod(tempPath, 0o755)
  }

  // Install
  logger.step(`Installing to ${INSTALL_PATH}...`)
  const success = await installBinary(tempPath)

  // Clean up temp file
  try {
    const { rm } = await import('fs/promises')
    await rm(tempPath)
  } catch {}

  if (!success) {
    logger.error('Failed to install update')
    return false
  }

  // Update the check cache
  await saveUpdateCheck(latestVersion)

  logger.newline()
  logger.success(`Updated to v${latestVersion}!`)
  logger.newline()

  return true
}

/**
 * Save update check result to cache file
 */
async function saveUpdateCheck(latestVersion: string): Promise<void> {
  try {
    const { mkdir, writeFile } = await import('fs/promises')
    await mkdir(UPDATE_CHECK_DIR, { recursive: true })
    await writeFile(
      UPDATE_CHECK_FILE,
      JSON.stringify({
        lastCheck: Date.now(),
        latestVersion,
      }),
    )
  } catch {}
}

/**
 * Background update check — prints a notice if a newer version is available.
 * Only checks once every 24 hours. Non-blocking.
 */
export async function checkForUpdates(currentVersion: string): Promise<void> {
  try {
    const { readFile } = await import('fs/promises')
    const { existsSync } = await import('fs')

    // Read cached check
    let cachedVersion: string | null = null
    if (existsSync(UPDATE_CHECK_FILE)) {
      const raw = await readFile(UPDATE_CHECK_FILE, 'utf-8')
      const data = JSON.parse(raw) as {
        lastCheck: number
        latestVersion: string
      }

      // If checked recently, use cached result
      if (Date.now() - data.lastCheck < CHECK_INTERVAL_MS) {
        cachedVersion = data.latestVersion
        if (cachedVersion && compareSemver(currentVersion, cachedVersion) < 0) {
          logger.newline()
          logger.warn(
            `A new version of fnkit is available: v${cachedVersion} (current: v${currentVersion})`,
          )
          logger.dim('  Run "fnkit update" to upgrade')
        }
        return
      }
    }

    // Fetch in background — don't await in the critical path
    fetchLatestVersion().then(async (latest) => {
      if (!latest) return
      await saveUpdateCheck(latest)
      if (compareSemver(currentVersion, latest) < 0) {
        logger.newline()
        logger.warn(
          `A new version of fnkit is available: v${latest} (current: v${currentVersion})`,
        )
        logger.dim('  Run "fnkit update" to upgrade')
      }
    }).catch(() => {})
  } catch {}
}

export default global
