import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, win32 as pathWin32 } from 'node:path'
import { ORCA_GIT_COMMIT_TRAILER } from '../../shared/orca-attribution'
import { POSIX_GIT_WRAPPER, POSIX_GH_WRAPPER } from './terminal-attribution-posix-shims'
import {
  WIN32_GIT_CMD_WRAPPER,
  WIN32_GH_CMD_WRAPPER,
  WIN32_GIT_PS_WRAPPER,
  WIN32_GH_PS_WRAPPER
} from './terminal-attribution-windows-shims'

const ATTRIBUTION_ROOT_DIR = 'orca-terminal-attribution'
const ATTRIBUTION_SHIM_VERSION = '6'
const ORCA_PRODUCT_URL = 'https://github.com/stablyai/orca'
const ORCA_GH_FOOTER = `Made with [Orca](${ORCA_PRODUCT_URL}) 🐋`
const ATTRIBUTION_ENV_KEYS = [
  'ORCA_ENABLE_GIT_ATTRIBUTION',
  'ORCA_GIT_COMMIT_TRAILER',
  'ORCA_GH_PR_FOOTER',
  'ORCA_GH_ISSUE_FOOTER',
  'ORCA_ATTRIBUTION_SHIM_DIR',
  'ORCA_REAL_GIT',
  'ORCA_REAL_GH'
] as const

const writtenRoots = new Set<string>()

type AttributionShimPaths = {
  posixDir: string
  win32Dir: string
}

export type AttributionShellFamily = 'native-windows' | 'posix'

export function resolveAttributionShellFamily(options: {
  platform?: NodeJS.Platform
  shellPath?: string
  isWsl?: boolean
}): AttributionShellFamily | undefined {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32') {
    return undefined
  }
  const shellName = options.shellPath?.replaceAll('\\', '/').split('/').pop()?.toLowerCase()
  if (options.isWsl || shellName === 'wsl.exe' || shellName === 'wsl') {
    return 'posix'
  }
  if (shellName === 'bash.exe' || shellName === 'sh.exe' || shellName === 'zsh.exe') {
    return 'posix'
  }
  return 'native-windows'
}

export function applyTerminalAttributionEnv(
  baseEnv: Record<string, string>,
  options: {
    enabled: boolean
    userDataPath: string
    platform?: NodeJS.Platform
    shellFamily?: AttributionShellFamily
  }
): void {
  const platform = options.platform ?? process.platform
  if (!options.enabled) {
    clearTerminalAttributionEnv(baseEnv, platform)
    return
  }

  let shimPaths: AttributionShimPaths
  try {
    shimPaths = ensureAttributionShims(options.userDataPath)
  } catch {
    return
  }

  const pathDelimiter = platform === 'win32' ? ';' : ':'
  const basePath = baseEnv.PATH ?? process.env.PATH ?? ''
  // Why: resolve real Windows commands before prepending shims so cmd wrappers
  // cannot recursively point ORCA_REAL_* at themselves.
  const resolvedGit = platform === 'win32' ? resolveWindowsExecutable('git', basePath) : null
  const resolvedGh = platform === 'win32' ? resolveWindowsExecutable('gh', basePath) : null
  const { posixDir, win32Dir } = shimPaths
  const shellFamily = options.shellFamily ?? (platform === 'win32' ? 'native-windows' : 'posix')
  // Why: Windows native shells can try to open extensionless POSIX shims before
  // PATHEXT reaches git.cmd, which surfaces an "Open With" dialog.
  const prependDirs =
    platform === 'win32' && shellFamily === 'native-windows' ? [win32Dir] : [posixDir]
  const prependDirKeys = new Set(
    prependDirs.map((dir) => (platform === 'win32' ? dir.toLowerCase() : dir))
  )
  const cleanedBasePath = stripAttributionPathEntries(basePath, pathDelimiter)
    .split(pathDelimiter)
    .filter((entry) => {
      if (!entry) {
        return false
      }
      const key = platform === 'win32' ? entry.toLowerCase() : entry
      return !prependDirKeys.has(key)
    })
    .join(pathDelimiter)

  // Why: these wrappers should affect only Orca-managed PTYs. Prepending the
  // shim directory here keeps the attribution behavior scoped to Orca's live
  // terminal environment instead of mutating global git/gh config or the
  // user's external shell PATH.
  baseEnv.PATH = [...prependDirs, cleanedBasePath].filter(Boolean).join(pathDelimiter)
  baseEnv.ORCA_ENABLE_GIT_ATTRIBUTION = '1'
  baseEnv.ORCA_GIT_COMMIT_TRAILER = ORCA_GIT_COMMIT_TRAILER
  baseEnv.ORCA_GH_PR_FOOTER = ORCA_GH_FOOTER
  baseEnv.ORCA_GH_ISSUE_FOOTER = ORCA_GH_FOOTER
  if (shellFamily === 'posix') {
    baseEnv.ORCA_ATTRIBUTION_SHIM_DIR = posixDir
  } else {
    delete baseEnv.ORCA_ATTRIBUTION_SHIM_DIR
  }

  if (platform === 'win32') {
    if (resolvedGit) {
      baseEnv.ORCA_REAL_GIT = resolvedGit
    }
    if (resolvedGh) {
      baseEnv.ORCA_REAL_GH = resolvedGh
    }
  }
}

function clearTerminalAttributionEnv(
  baseEnv: Record<string, string>,
  platform: NodeJS.Platform
): void {
  for (const key of ATTRIBUTION_ENV_KEYS) {
    delete baseEnv[key]
  }
  const pathDelimiter = platform === 'win32' ? ';' : ':'
  const cleanedPath = stripAttributionPathEntries(baseEnv.PATH ?? '', pathDelimiter)
  if (cleanedPath) {
    baseEnv.PATH = cleanedPath
  } else {
    delete baseEnv.PATH
  }
}

function stripAttributionPathEntries(pathValue: string, pathDelimiter: string): string {
  return pathValue
    .split(pathDelimiter)
    .filter((entry) => {
      const normalized = entry.replace(/\\/g, '/').toLowerCase()
      return !normalized.includes('/orca-terminal-attribution/')
    })
    .join(pathDelimiter)
}

function ensureAttributionShims(userDataPath: string): AttributionShimPaths {
  const rootDir = join(userDataPath, ATTRIBUTION_ROOT_DIR)
  const posixDir = join(rootDir, 'posix')
  const win32Dir = join(rootDir, 'win32')
  const versionFile = join(rootDir, 'VERSION')

  if (writtenRoots.has(rootDir)) {
    return { posixDir, win32Dir }
  }

  if (readShimVersion(versionFile) === ATTRIBUTION_SHIM_VERSION) {
    writtenRoots.add(rootDir)
    return { posixDir, win32Dir }
  }

  mkdirSync(posixDir, { recursive: true })
  mkdirSync(win32Dir, { recursive: true })

  writeExecutable(join(posixDir, 'git'), POSIX_GIT_WRAPPER)
  writeExecutable(join(posixDir, 'gh'), POSIX_GH_WRAPPER)

  writeExecutable(join(win32Dir, 'git.cmd'), WIN32_GIT_CMD_WRAPPER)
  writeExecutable(join(win32Dir, 'gh.cmd'), WIN32_GH_CMD_WRAPPER)
  writeExecutable(join(win32Dir, 'git-wrapper.ps1'), WIN32_GIT_PS_WRAPPER)
  writeExecutable(join(win32Dir, 'gh-wrapper.ps1'), WIN32_GH_PS_WRAPPER)
  writeFileSync(versionFile, `${ATTRIBUTION_SHIM_VERSION}\n`, 'utf8')

  writtenRoots.add(rootDir)

  return { posixDir, win32Dir }
}

function readShimVersion(versionFile: string): string | null {
  try {
    return readFileSync(versionFile, 'utf8').trim()
  } catch {
    return null
  }
}

function writeExecutable(filePath: string, contents: string): void {
  writeFileSync(filePath, contents, 'utf8')
  chmodSync(filePath, 0o755)
}

function resolveWindowsExecutable(command: string, pathValue: string): string | null {
  const pathExt = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((ext) => ext.toLowerCase())
  const searchDirs = pathValue.split(';').filter(Boolean)

  for (const dir of searchDirs) {
    for (const ext of pathExt) {
      const candidate = pathWin32.join(dir, `${command}${ext}`)
      if (existsSync(candidate)) {
        return candidate
      }
    }
    const bareCandidate = pathWin32.join(dir, command)
    if (existsSync(bareCandidate)) {
      return bareCandidate
    }
  }

  return null
}
