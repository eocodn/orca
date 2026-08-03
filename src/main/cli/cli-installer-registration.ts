import { app } from 'electron'
import { execFile } from 'node:child_process'
import { constants, existsSync } from 'node:fs'
import {
  access,
  lstat,
  mkdir,
  readFile,
  readlink,
  stat,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { CliInstallMethod, CliInstallStatus } from '../../shared/cli-install-types'
import { buildAppImageCliWrapper } from './appimage-cli-wrapper'
import {
  invalidateWindowsUserPathRegistryCache,
  readFreshWindowsUserPathRegistry,
  readWindowsUserPathRegistry,
  type WindowsUserPathReadResult
} from './windows-user-path-registry'

const execFileAsync = promisify(execFile)
const DEFAULT_MAC_COMMAND_PATH = '/usr/local/bin/orca'
const DEV_COMMAND_NAME = 'orca-dev'
const LINUX_COMMAND_NAME = 'orca-ide'
const LEGACY_LINUX_COMMAND_NAME = 'orca'
const DEV_LAUNCHER_DIR = ['cli', 'bin']
const WINDOWS_PATH_WRITE_TIMEOUT_MS = 5_000

type CliInstallerOptions = {
  platform?: NodeJS.Platform
  isPackaged?: boolean
  userDataPath?: string
  resourcesPath?: string
  execPath?: string
  appPath?: string
  homePath?: string
  localAppDataPath?: string
  processPathEnv?: string | null
  commandPathOverride?: string | null
  /** Feeds into the /usr/local/bin existence check at construction time; used in tests to simulate absent /usr/local/bin on arm64 without relying on real filesystem state. */
  defaultMacCommandPath?: string
  privilegedRunner?: (command: string) => Promise<void>
  userPathReader?: () => Promise<WindowsUserPathReadResult>
  userPathMutationReader?: () => Promise<WindowsUserPathReadResult>
  userPathWriter?: (value: string) => Promise<void>
  userPathCacheInvalidator?: () => void
  windowsEnvironment?: NodeJS.ProcessEnv
  /** Why: AppImage reports a stable outer file path via $APPIMAGE while bundled resources live in an ephemeral FUSE mount. */
  appImagePath?: string | null
}

type InstallSpec = {
  commandPath: string
  installMethod: CliInstallMethod
}

import { ensureDevLauncher, buildUnixDevLauncher, buildWindowsDevLauncher, buildWindowsForwarder, extractManagedUnixLauncherTarget, extractShellAssignment, splitPathEntries, uniquePathEntries, samePathEntry, isPathInsideOrEqual, isExecutableFile, normalizeWindowsPath, expandWindowsEnvironmentVariables, escapeWindowsBatchValue, isPermissionError, isMissingError, isWindowsUserPathPermissionError, quoteShell, runMacPrivilegedCommand, quoteAppleScript, isAbsoluteForPlatform, writeWindowsUserPath, runWindowsPathCommand, quotePowerShell } from './cli-installer-platform'

export async function install(installer: any): Promise<CliInstallStatus> {

    const status = await installer.getStatus()
    if (!status.supported || !status.commandPath || !status.launcherPath || !status.installMethod) {
      throw new Error(status.detail ?? 'CLI registration is unavailable on this build.')
    }
    if (status.state === 'conflict') {
      throw new Error(`Refusing to replace non-Orca command at ${status.commandPath}.`)
    }

    // eslint-disable-next-line unicorn/prefer-ternary -- Why: the install path performs async side effects and is easier to audit as an explicit branch than as an awaited ternary.
    if (status.installMethod === 'symlink') {
      await installer.installSymlink(status)
      await installer.removeLegacyLinuxCommandIfManaged(status.launcherPath)
    } else if (installer.isLinuxAppImage()) {
      await installer.installAppImageWrapper(status.commandPath, status.launcherPath)
      await installer.removeLegacyLinuxCommandIfManaged(status.launcherPath)
    } else if (installer.isWindowsPackagedBundledCommand(status.commandPath, status.launcherPath)) {
      // Why: packaged Windows already ships resources/bin/orca.exe; registration only owns the PATH entry.
    } else {
      // Why: the Windows wrapper dir is user-writable (%LOCALAPPDATA%), so mkdir here can't hit EACCES.
      await mkdir(dirname(status.commandPath), { recursive: true })
      await installer.installWindowsWrapper(status.commandPath, status.launcherPath)
    }

    if (installer.platform === 'win32') {
      // Why: Windows shells find commands via user PATH, so the installer owns that entry, not the desktop installer.
      await installer.ensureWindowsPathEntry(dirname(status.commandPath))
    }

    return installer.getStatus()
}
export async function remove(installer: any): Promise<CliInstallStatus> {

    const status = await installer.getStatus()
    if (!status.supported || !status.commandPath || !status.launcherPath || !status.installMethod) {
      return status
    }
    if (status.state === 'not_installed') {
      await installer.removeLegacyLinuxCommandIfManaged(status.launcherPath)
      if (installer.platform === 'win32') {
        await installer.removeWindowsPathEntry(dirname(status.commandPath))
        return installer.getStatus()
      }
      return status
    }
    if (status.state === 'conflict') {
      throw new Error(`Refusing to remove non-Orca command at ${status.commandPath}.`)
    }
    if (status.state === 'stale') {
      throw new Error(`Refusing to remove a command not owned by Orca at ${status.commandPath}.`)
    }

    if (status.installMethod === 'symlink') {
      await installer.removeSymlink(status.commandPath)
      await installer.removeLegacyLinuxCommandIfManaged(status.launcherPath)
    } else if (installer.isWindowsPackagedBundledCommand(status.commandPath, status.launcherPath)) {
      await installer.removeWindowsPathEntry(dirname(status.commandPath))
    } else {
      await unlink(status.commandPath)
      await installer.removeWindowsPathEntry(dirname(status.commandPath))
    }

    return installer.getStatus()
}
export async function ensureWindowsPathEntry(installer: any, pathDirectory: string): Promise<void> {

    const current = await installer.readWindowsUserPathForMutation()
    const entries = splitPathEntries('win32', current.value)
    if (
      entries.some((entry) =>
        samePathEntry('win32', entry, pathDirectory, installer.windowsEnvironment, current.expandable)
      )
    ) {
      return
    }
    entries.push(pathDirectory)
    await installer.writeWindowsUserPathEntry(entries.join(';'), pathDirectory, 'add')
}
export async function removeWindowsPathEntry(installer: any, pathDirectory: string): Promise<void> {

    if (installer.platform !== 'win32') {
      return
    }
    const current = await installer.readWindowsUserPathForMutation()
    const entries = splitPathEntries('win32', current.value)
    const nextEntries = entries.filter(
      (entry) =>
        !samePathEntry('win32', entry, pathDirectory, installer.windowsEnvironment, current.expandable)
    )
    if (nextEntries.length === entries.length) {
      return
    }
    await installer.writeWindowsUserPathEntry(nextEntries.join(';'), pathDirectory, 'remove')
}
export async function readWindowsUserPathForMutation(installer: any): Promise< {

    value: string | null
    expandable: boolean
  }> {
    const result = await installer.userPathMutationReader()
    if (result.state === 'success') {
      return { value: result.value, expandable: result.expandable }
    }
    // Why: PATH is read-modify-write; continuing after a failed read could clobber the user's PATH with a partial value.
    throw new Error(`${result.detail} No PATH changes were made.`)
}
export async function writeWindowsUserPathEntry(installer: any,
    value: string,
    pathDirectory: string,
    action: 'add' | 'remove'
  ): Promise<void> {

    try {
      await installer.userPathWriter(value)
      installer.userPathCacheInvalidator()
    } catch (error) {
      if (!isWindowsUserPathPermissionError(error)) {
        throw error
      }
      const guidance =
        action === 'add'
          ? `Add this folder to your PATH manually: ${pathDirectory}. Or run Orca as an administrator and try again.`
          : `Remove this folder from your PATH manually: ${pathDirectory}. Or run Orca as an administrator and try again.`
      throw new Error(
        `Windows blocked updating your user PATH (access denied). This usually means your PATH environment variable is managed by Group Policy or your organization's device management. ${guidance}`,
        { cause: error }
      )
    }
}
