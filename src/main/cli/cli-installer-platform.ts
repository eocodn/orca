import { execFile } from 'node:child_process'
import { constants, existsSync } from 'node:fs'
import { access, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const DEV_COMMAND_NAME = 'orca-dev'
const DEV_LAUNCHER_DIR = ['cli', 'bin']
const WINDOWS_PATH_WRITE_TIMEOUT_MS = 5_000

export async function ensureDevLauncher(args: {
  platform: NodeJS.Platform
  userDataPath: string
  execPath: string
  cliEntryPath: string
  commandName: string
}): Promise<string | null> {
  if (
    !isAbsoluteForPlatform(args.platform, args.execPath) ||
    !isAbsolute(args.cliEntryPath) ||
    !existsSync(args.cliEntryPath)
  ) {
    return null
  }

  const launcherPath = join(
    args.userDataPath,
    ...DEV_LAUNCHER_DIR,
    args.platform === 'win32' ? `${args.commandName}.cmd` : args.commandName
  )
  await mkdir(dirname(launcherPath), { recursive: true })

  // Why: dev builds lack the packaged resources/bin launcher, so generate one in userData to validate the flow.
  const content =
    args.platform === 'win32'
      ? buildWindowsDevLauncher(args.execPath, args.cliEntryPath, args.userDataPath)
      : buildUnixDevLauncher(args.execPath, args.cliEntryPath, args.userDataPath)
  await writeFile(launcherPath, content, {
    encoding: 'utf8',
    mode: args.platform === 'win32' ? undefined : 0o755
  })
  if (args.commandName === DEV_COMMAND_NAME && args.platform !== 'win32') {
    // Why: dev PTYs prepend this dir to PATH, so keep a local `orca` alias without claiming the global command.
    await writeFile(join(dirname(launcherPath), 'orca'), content, {
      encoding: 'utf8',
      mode: 0o755
    })
  }
  return launcherPath
}

export function buildUnixDevLauncher(
  execPathValue: string,
  cliEntryPath: string,
  userDataPath: string
): string {
  return `#!/usr/bin/env bash
set -euo pipefail
ELECTRON=${quoteShell(execPathValue)}
CLI=${quoteShell(cliEntryPath)}
export ORCA_USER_DATA_PATH=${quoteShell(userDataPath)}
if [ -z "\${ORCA_APP_EXECUTABLE:-}" ]; then
  export ORCA_APP_EXECUTABLE="$ELECTRON"
  export ORCA_APP_EXECUTABLE_NEEDS_APP_ROOT=1
fi
export ORCA_NODE_OPTIONS="\${NODE_OPTIONS-}"
export ORCA_NODE_REPL_EXTERNAL_MODULE="\${NODE_REPL_EXTERNAL_MODULE-}"
unset NODE_OPTIONS
unset NODE_REPL_EXTERNAL_MODULE
ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" "$@"
`
}

export function buildWindowsDevLauncher(
  execPathValue: string,
  cliEntryPath: string,
  userDataPath: string
): string {
  return `@echo off
setlocal
set "ELECTRON=${escapeWindowsBatchValue(execPathValue)}"
set "CLI=${escapeWindowsBatchValue(cliEntryPath)}"
set "ORCA_USER_DATA_PATH=${escapeWindowsBatchValue(userDataPath)}"
if not defined ORCA_APP_EXECUTABLE (
  set "ORCA_APP_EXECUTABLE=%ELECTRON%"
  set "ORCA_APP_EXECUTABLE_NEEDS_APP_ROOT=1"
)
set "ORCA_NODE_OPTIONS=%NODE_OPTIONS%"
set "ORCA_NODE_REPL_EXTERNAL_MODULE=%NODE_REPL_EXTERNAL_MODULE%"
set NODE_OPTIONS=
set NODE_REPL_EXTERNAL_MODULE=
set ELECTRON_RUN_AS_NODE=1
"%ELECTRON%" "%CLI%" %*
`
}

export function buildWindowsForwarder(launcherPath: string): string {
  return `@echo off
setlocal
set "ORCA_LAUNCHER=${escapeWindowsBatchValue(launcherPath)}"
"%ORCA_LAUNCHER%" %*
`
}

export function extractManagedUnixLauncherTarget(content: string): string | null {
  if (
    !content.includes('ELECTRON_RUN_AS_NODE=1') ||
    !content.includes('ORCA_NODE_OPTIONS') ||
    !content.includes('NODE_REPL_EXTERNAL_MODULE')
  ) {
    return null
  }

  const cliPath = extractShellAssignment(content, 'CLI')
  if (!cliPath) {
    return null
  }

  // Why: only Orca's compiled CLI entrypoints count as managed; arbitrary Electron-launching scripts stay conflicts.
  return /(?:^|[/\\])(?:out|app\.asar\.unpacked[/\\]out)[/\\]cli[/\\]index\.js$/.test(cliPath)
    ? cliPath
    : null
}

export function extractShellAssignment(content: string, name: string): string | null {
  const match = new RegExp(`^${name}=('([^']*)'|"([^"]*)"|([^\\n]+))$`, 'm').exec(content)
  if (!match) {
    return null
  }
  return (match[2] ?? match[3] ?? match[4] ?? '').trim()
}

export function splitPathEntries(platform: NodeJS.Platform, value: string | null): string[] {
  if (!value) {
    return []
  }
  return value
    .split(platform === 'win32' ? ';' : ':')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function uniquePathEntries(platform: NodeJS.Platform, entries: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of entries) {
    const key = platform === 'win32' ? normalizeWindowsPath(entry) : entry
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(entry)
  }
  return result
}

export function samePathEntry(
  platform: NodeJS.Platform,
  left: string,
  right: string,
  windowsEnvironment: NodeJS.ProcessEnv = process.env,
  expandWindowsVariables = true
): boolean {
  return platform === 'win32'
    ? normalizeWindowsPath(left, windowsEnvironment, expandWindowsVariables) ===
        normalizeWindowsPath(right, windowsEnvironment, expandWindowsVariables)
    : left === right
}

export function isPathInsideOrEqual(parentPath: string, childPath: string): boolean {
  const childRelative = relative(parentPath, childPath)
  return childRelative === '' || (!childRelative.startsWith('..') && !isAbsolute(childRelative))
}

export async function isExecutableFile(commandPath: string): Promise<boolean> {
  try {
    const stats = await stat(commandPath)
    if (!stats.isFile()) {
      return false
    }
    await access(commandPath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function normalizeWindowsPath(
  value: string,
  env: NodeJS.ProcessEnv = process.env,
  expandEnvironmentVariables = true
): string {
  return (expandEnvironmentVariables ? expandWindowsEnvironmentVariables(value, env) : value)
    .replaceAll('/', '\\')
    .replace(/\\+$/, '')
    .toLowerCase()
}

export function expandWindowsEnvironmentVariables(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/%([^%]+)%/g, (match, rawName: string) => {
    const envKey = Object.keys(env).find((key) => key.toLowerCase() === rawName.toLowerCase())
    return envKey && env[envKey] ? env[envKey] : match
  })
}

export function escapeWindowsBatchValue(value: string): string {
  return value.replaceAll('"', '""')
}

export function isPermissionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    ((error as NodeJS.ErrnoException).code === 'EACCES' ||
      (error as NodeJS.ErrnoException).code === 'EPERM')
  )
}

export function isMissingError(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

// Why: localized permission errors keep these .NET/ACL markers even when the PowerShell text is mojibake.
export function isWindowsUserPathPermissionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const stderr =
    'stderr' in error && typeof (error as { stderr?: unknown }).stderr === 'string'
      ? (error as { stderr: string }).stderr
      : ''
  const haystack = `${error.message}\n${stderr}`
  return (
    haystack.includes('UnauthorizedAccessException') ||
    haystack.includes('SecurityException') ||
    haystack.includes('Requested registry access is not allowed') ||
    haystack.includes('Access is denied') ||
    haystack.includes('Access to the registry key')
  )
}

export function quoteShell(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

export async function runMacPrivilegedCommand(command: string): Promise<void> {
  await execFileAsync('osascript', [
    '-e',
    `do shell script ${quoteAppleScript(command)} with administrator privileges`
  ])
}

export function quoteAppleScript(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

export function isAbsoluteForPlatform(platform: NodeJS.Platform, value: string): boolean {
  if (platform === 'win32') {
    return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
  }
  return isAbsolute(value)
}

export async function writeWindowsUserPath(value: string): Promise<void> {
  await runWindowsPathCommand([
    '-NoProfile',
    '-Command',
    // Why: user-scoped PATH avoids requiring elevation or mutating machine-wide state.
    `[Environment]::SetEnvironmentVariable('Path', ${quotePowerShell(value)}, 'User')`
  ])
}

export function runWindowsPathCommand(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof execFile> | null = null
    let settled = false

    const finish = (error: Error | null, stdout = ''): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      if (error) {
        reject(error)
        return
      }
      resolve(stdout)
    }

    // Why: bound wedged PowerShell so PATH reads/writes can't leave CLI registration pending forever.
    const timeout = setTimeout(() => {
      child?.kill()
      finish(new Error(`Windows PATH command timed out after ${WINDOWS_PATH_WRITE_TIMEOUT_MS}ms.`))
    }, WINDOWS_PATH_WRITE_TIMEOUT_MS)

    try {
      child = execFile(
        'powershell',
        args,
        { encoding: 'utf8', timeout: WINDOWS_PATH_WRITE_TIMEOUT_MS },
        (error, stdout) => {
          finish(error ?? null, stdout)
        }
      )
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

export function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}
