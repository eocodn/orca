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

export async function installSymlink(installer: any, status: CliInstallStatus): Promise<void> {

    try {
      if (status.state === 'installed') {
        return
      }
      if (status.state === 'stale') {
        await unlink(status.commandPath as string)
      }
      // Why: mkdir stays here (not install()) so an EACCES falls into the privileged-runner catch below.
      await mkdir(dirname(status.commandPath as string), { recursive: true })
      await symlink(status.launcherPath as string, status.commandPath as string)
    } catch (error) {
      if (installer.platform !== 'darwin' || !isPermissionError(error)) {
        throw error
      }

      // Why: fall back to an elevated shell to place the /usr/local/bin symlink (VS Code-style) when direct write is denied.
      await installer.privilegedRunner(
        `mkdir -p ${quoteShell(dirname(status.commandPath as string))} && ` +
          `ln -sfn ${quoteShell(status.launcherPath as string)} ${quoteShell(status.commandPath as string)}`
      )
    }
}

export async function removeSymlink(installer: any, commandPath: string): Promise<void> {

    try {
      await unlink(commandPath)
    } catch (error) {
      if (installer.platform !== 'darwin' || !isPermissionError(error)) {
        throw error
      }
      await installer.privilegedRunner(
        `if [ -L ${quoteShell(commandPath)} ]; then rm ${quoteShell(commandPath)}; fi`
      )
    }
}

export async function removeLegacyLinuxCommandIfManaged(installer: any, launcherPath: string | null): Promise<void> {

    if (installer.platform !== 'linux' || installer.commandPathOverride || !launcherPath) {
      return
    }

    const legacyCommandPath = join(installer.homePath, '.local', 'bin', LEGACY_LINUX_COMMAND_NAME)
    try {
      const stats = await lstat(legacyCommandPath)
      if (!stats.isSymbolicLink()) {
        return
      }

      const currentTarget = await readlink(legacyCommandPath)
      const resolvedCurrentTarget = resolve(dirname(legacyCommandPath), currentTarget)
      if (!installer.isManagedLegacyLinuxTarget(resolvedCurrentTarget, launcherPath)) {
        return
      }

      // Why: after the Linux command rename, the old `orca` symlink would keep shadowing GNOME Orca.
      await unlink(legacyCommandPath)
    } catch (error) {
      if (isMissingError(error)) {
        return
      }
      throw error
    }
}

export function isManagedLegacyLinuxTarget(installer: any, resolvedTarget: string, launcherPath: string): boolean {

    const legacyLauncherPath = resolve(dirname(launcherPath), LEGACY_LINUX_COMMAND_NAME)
    if (resolvedTarget === legacyLauncherPath) {
      return true
    }

    if (basename(resolvedTarget) !== LEGACY_LINUX_COMMAND_NAME) {
      return false
    }

    const devLauncherDir = resolve(installer.userDataPath, ...DEV_LAUNCHER_DIR)
    const devRelative = relative(devLauncherDir, resolvedTarget)
    if (devRelative && !devRelative.startsWith('..') && !isAbsolute(devRelative)) {
      return true
    }

    // Why: AppImage upgrades can strand a legacy symlink into a now-gone FUSE mount that isn't a sibling of the stable path.
    return /(?:^|[/\\])resources[/\\]bin[/\\]orca$/.test(resolvedTarget)
}

export async function installWindowsWrapper(installer: any, commandPath: string, launcherPath: string): Promise<void> {

    await writeFile(commandPath, buildWindowsForwarder(launcherPath), 'utf8')
}

export async function installAppImageWrapper(installer: any, commandPath: string, appImagePath: string): Promise<void> {

    // Why: the AppImage command dir is user-writable, so create it before writing the wrapper.
    await mkdir(dirname(commandPath), { recursive: true })
    await writeFile(commandPath, buildAppImageCliWrapper(appImagePath), {
      encoding: 'utf8',
      mode: 0o755
    })
}

export async function inspectAppImageWrapper(installer: any,
    commandPath: string,
    appImagePath: string
  ): Promise<CliInstallStatus> {

    try {
      const stats = await lstat(commandPath)
      if (!stats.isFile()) {
        return installer.buildStatus({
          commandPath,
          launcherPath: appImagePath,
          installMethod: 'wrapper',
          supported: true,
          state: 'conflict',
          currentTarget: null,
          detail: `${commandPath} exists but is not an Orca launcher script.`
        })
      }

      const currentContent = await readFile(commandPath, 'utf8')
      const expectedContent = buildAppImageCliWrapper(appImagePath)
      return installer.buildStatus({
        commandPath,
        launcherPath: appImagePath,
        installMethod: 'wrapper',
        supported: true,
        state: currentContent === expectedContent ? 'installed' : 'stale',
        currentTarget: appImagePath,
        detail:
          currentContent === expectedContent
            ? `Registered at ${commandPath}.`
            : `${commandPath} points to a different launcher.`
      })
    } catch (error) {
      if (isMissingError(error)) {
        return installer.buildStatus({
          commandPath,
          launcherPath: appImagePath,
          installMethod: 'wrapper',
          supported: true,
          state: 'not_installed',
          currentTarget: null,
          detail: `Register ${commandPath} to use Orca from the terminal.`
        })
      }
      throw error
    }
}
