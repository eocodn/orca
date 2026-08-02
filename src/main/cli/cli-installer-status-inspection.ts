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

export async function inspectSymlink(installer: any,
    commandPath: string,
    launcherPath: string
  ): Promise<CliInstallStatus> {

    try {
      const stats = await lstat(commandPath)
      if (!stats.isSymbolicLink()) {
        if (stats.isFile()) {
          const currentContent = await readFile(commandPath, 'utf8')
          const managedTarget = extractManagedUnixLauncherTarget(currentContent)
          if (managedTarget) {
            return installer.buildStatus({
              commandPath,
              launcherPath,
              installMethod: 'symlink',
              supported: true,
              state: 'stale',
              currentTarget: managedTarget,
              detail: `${commandPath} contains an older Orca launcher.`
            })
          }
        }

        return installer.buildStatus({
          commandPath,
          launcherPath,
          installMethod: 'symlink',
          supported: true,
          state: 'conflict',
          currentTarget: null,
          detail: `${commandPath} exists but is not an Orca symlink.`
        })
      }

      const currentTarget = await readlink(commandPath)
      const resolvedCurrentTarget = resolve(dirname(commandPath), currentTarget)
      const resolvedLauncher = resolve(launcherPath)
      const isInstalled = resolvedCurrentTarget === resolvedLauncher
      const isManagedStaleTarget =
        !isInstalled && installer.isManagedSymlinkTarget(resolvedCurrentTarget, launcherPath)
      return installer.buildStatus({
        commandPath,
        launcherPath,
        installMethod: 'symlink',
        supported: true,
        state: isInstalled ? 'installed' : isManagedStaleTarget ? 'stale' : 'conflict',
        currentTarget: resolvedCurrentTarget,
        detail: isInstalled
          ? `Registered at ${commandPath}.`
          : isManagedStaleTarget
            ? `${commandPath} points to an older Orca launcher.`
            : `${commandPath} points to a non-Orca launcher.`
      })
    } catch (error) {
      if (isMissingError(error)) {
        return installer.buildStatus({
          commandPath,
          launcherPath,
          installMethod: 'symlink',
          supported: true,
          state: 'not_installed',
          currentTarget: null,
          detail: `Register ${commandPath} to use Orca from the terminal.`
        })
      }
      throw error
    }
}

export function isManagedSymlinkTarget(installer: any, resolvedTarget: string, launcherPath: string): boolean {

    const expectedName = basename(launcherPath)
    if (installer.isPackaged && installer.isSiblingDevLauncherTarget(resolvedTarget, expectedName)) {
      return true
    }

    if (basename(resolvedTarget) !== expectedName) {
      return false
    }

    const devLauncherDir = resolve(installer.userDataPath, ...DEV_LAUNCHER_DIR)
    if (isPathInsideOrEqual(devLauncherDir, resolvedTarget)) {
      return true
    }

    if (installer.platform === 'darwin') {
      // Why: reclaim symlinks to an older Orca.app launcher, but never replace arbitrary user-owned symlinks.
      return /(?:^|[/\\])[^/\\]+\.app[/\\]Contents[/\\]Resources[/\\]bin[/\\][^/\\]+$/.test(
        resolvedTarget
      )
    }

    if (installer.platform === 'linux') {
      return /(?:^|[/\\])resources[/\\]bin[/\\][^/\\]+$/.test(resolvedTarget)
    }

    return false
}

export function isSiblingDevLauncherTarget(installer: any,
    resolvedTarget: string,
    packagedLauncherName: string
  ): boolean {

    if (![packagedLauncherName, DEV_COMMAND_NAME].includes(basename(resolvedTarget))) {
      return false
    }

    const packagedUserDataPath = resolve(installer.userDataPath)
    const siblingDevUserDataPath = `${packagedUserDataPath}-dev`
    const siblingDevLauncherDir = resolve(siblingDevUserDataPath, ...DEV_LAUNCHER_DIR)

    // Why: dev builds generate launchers under the sibling `*-dev` profile; packaged Orca must reclaim that command.
    return (
      basename(siblingDevUserDataPath) === `${basename(packagedUserDataPath)}-dev` &&
      isPathInsideOrEqual(siblingDevLauncherDir, resolvedTarget)
    )
}

export function isLinuxAppImage(installer: any): boolean {

    return installer.platform === 'linux' && Boolean(installer.appImagePath)
}

export function isWindowsPackagedBundledCommand(installer: any,
    commandPath: string | null,
    launcherPath: string | null
  ): boolean {

    return (
      installer.platform === 'win32' &&
      installer.isPackaged &&
      commandPath !== null &&
      launcherPath !== null &&
      samePathEntry('win32', commandPath, launcherPath)
    )
}

export async function inspectWindowsWrapper(installer: any,
    commandPath: string,
    launcherPath: string
  ): Promise<CliInstallStatus> {

    try {
      const stats = await lstat(commandPath)
      if (!stats.isFile()) {
        return installer.buildStatus({
          commandPath,
          launcherPath,
          installMethod: 'wrapper',
          supported: true,
          state: 'conflict',
          currentTarget: null,
          detail: `${commandPath} exists but is not an Orca launcher script.`
        })
      }

      if (installer.isWindowsPackagedBundledCommand(commandPath, launcherPath)) {
        return installer.buildStatus({
          commandPath,
          launcherPath,
          installMethod: 'wrapper',
          supported: true,
          state: 'installed',
          currentTarget: launcherPath,
          detail: `Registered at ${commandPath}.`
        })
      }

      const currentContent = await readFile(commandPath, 'utf8')
      const expectedContent = buildWindowsForwarder(launcherPath)
      return installer.buildStatus({
        commandPath,
        launcherPath,
        installMethod: 'wrapper',
        supported: true,
        state: currentContent === expectedContent ? 'installed' : 'stale',
        currentTarget: launcherPath,
        detail:
          currentContent === expectedContent
            ? `Registered at ${commandPath}.`
            : `${commandPath} points to a different launcher.`
      })
    } catch (error) {
      if (isMissingError(error)) {
        return installer.buildStatus({
          commandPath,
          launcherPath,
          installMethod: 'wrapper',
          supported: true,
          state: 'not_installed',
          currentTarget: null,
          detail: `Register ${commandPath} to use Orca from Command Prompt or PowerShell.`
        })
      }
      throw error
    }
}

export function buildStatus(installer: any, args: {
    commandPath: string
    launcherPath: string
    installMethod: CliInstallMethod
    supported: boolean
    state: CliInstallStatus['state']
    currentTarget: string | null
    detail: string | null
  }): CliInstallStatus {

    return {
      platform: installer.platform,
      commandName: installer.commandName,
      commandPath: args.commandPath,
      pathDirectory: dirname(args.commandPath),
      pathConfigured: false,
      launcherPath: args.launcherPath,
      installMethod: args.installMethod,
      supported: args.supported,
      state: args.state,
      currentTarget: args.currentTarget,
      unsupportedReason: null,
      detail: args.detail
    }
}

export async function probePathConfiguration(installer: any,
    pathDirectory: string
  ): Promise< {
 configured: boolean | null; detail: string | null }> {
    if (installer.platform !== 'win32') {
      return {
        configured: splitPathEntries(installer.platform, installer.processPathEnv ?? '').some((entry) =>
          samePathEntry(installer.platform, entry, pathDirectory)
        ),
        detail: null
      }
    }

    const result = await installer.userPathReader()
    if (result.state === 'unknown') {
      return { configured: null, detail: result.detail }
    }
    return {
      configured: splitPathEntries('win32', result.value).some((entry) =>
        samePathEntry('win32', entry, pathDirectory, installer.windowsEnvironment, result.expandable)
      ),
      detail: null
    }
}

export function withPathInfo(installer: any,
    status: CliInstallStatus,
    pathDirectory: string,
    pathProbe: { configured: boolean | null; detail: string | null }
  ): CliInstallStatus {

    const { configured: pathConfigured } = pathProbe
    if (
      installer.isWindowsPackagedBundledCommand(status.commandPath, status.launcherPath) &&
      status.state === 'installed' &&
      pathConfigured === false
    ) {
      return {
        ...status,
        pathDirectory,
        pathConfigured,
        state: 'not_installed',
        currentTarget: null,
        detail: `Register ${status.commandPath} to use Orca from Command Prompt or PowerShell.`
      }
    }

    if (pathConfigured === null) {
      return {
        ...status,
        pathDirectory,
        pathConfigured,
        detail:
          pathProbe.detail ??
          'The Orca launcher exists, but Orca could not check your Windows user PATH.'
      }
    }

    if (status.state !== 'installed') {
      return {
        ...status,
        pathDirectory,
        pathConfigured
      }
    }

    if (pathConfigured) {
      return {
        ...status,
        pathDirectory,
        pathConfigured
      }
    }

    return {
      ...status,
      pathDirectory,
      pathConfigured,
      detail:
        installer.platform === 'linux'
          ? `${status.commandPath} is registered, but ${pathDirectory} is not on PATH for this shell.`
          : `${status.commandPath} is registered. Restart your shell if the command is not visible yet.`
    }
}
