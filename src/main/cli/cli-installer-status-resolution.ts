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
import { getBundledLauncherPath } from './cli-installer'
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

export async function getStatus(installer: any): Promise<CliInstallStatus> {

    const defaultSpec = installer.resolveInstallSpec()
    if (!defaultSpec) {
      return {
        platform: installer.platform,
        commandName: installer.commandName,
        commandPath: null,
        pathDirectory: null,
        pathConfigured: false,
        launcherPath: null,
        installMethod: null,
        supported: false,
        state: 'unsupported',
        currentTarget: null,
        unsupportedReason: 'platform_not_supported',
        detail: 'CLI registration is not implemented on this platform.'
      }
    }

    const launcherPath = await installer.resolveLauncherPath()
    if (!launcherPath) {
      const detail =
        installer.isLinuxAppImage() && installer.appImagePath
          ? `The AppImage file at ${installer.appImagePath} is missing. Move it back or re-run CLI registration from the current AppImage location.`
          : installer.isPackaged
            ? 'The bundled CLI launcher is missing from this Orca build.'
            : 'Development mode uses a generated launcher for validation only.'
      return {
        platform: installer.platform,
        commandName: installer.commandName,
        commandPath: defaultSpec.commandPath,
        pathDirectory: dirname(defaultSpec.commandPath),
        pathConfigured: false,
        launcherPath: null,
        installMethod: defaultSpec.installMethod,
        supported: false,
        state: 'unsupported',
        currentTarget: null,
        unsupportedReason: installer.isPackaged ? 'launcher_missing' : 'launch_mode_unavailable',
        detail
      }
    }

    const spec = await installer.resolveActiveInstallSpec(defaultSpec, launcherPath)
    const baseStatus =
      spec.installMethod === 'symlink'
        ? await installer.inspectSymlink(spec.commandPath, launcherPath)
        : installer.isLinuxAppImage()
          ? await installer.inspectAppImageWrapper(spec.commandPath, launcherPath)
          : await installer.inspectWindowsWrapper(spec.commandPath, launcherPath)
    const pathDirectory = dirname(spec.commandPath)
    const pathProbe = await installer.probePathConfiguration(pathDirectory)
    return installer.withPathInfo(baseStatus, pathDirectory, pathProbe)
}

export function resolveInstallSpec(installer: any): InstallSpec | null {

    const commandPath = installer.resolveCommandPath()
    if (!commandPath) {
      return null
    }

    if (installer.platform === 'darwin' || installer.platform === 'linux') {
      return {
        commandPath,
        installMethod: installer.isLinuxAppImage() ? 'wrapper' : 'symlink'
      }
    }

    if (installer.platform === 'win32') {
      return {
        commandPath,
        installMethod: 'wrapper'
      }
    }

    return null
}

export async function resolveActiveInstallSpec(installer: any,
    defaultSpec: InstallSpec,
    launcherPath: string
  ): Promise<InstallSpec> {

    if (
      installer.commandPathOverride ||
      installer.platform !== 'darwin' ||
      defaultSpec.installMethod !== 'symlink'
    ) {
      return defaultSpec
    }

    const activeCommandPath = await installer.findActivePathCommand(
      launcherPath,
      defaultSpec.commandPath
    )
    return activeCommandPath
      ? {
          commandPath: activeCommandPath,
          installMethod: defaultSpec.installMethod
        }
      : defaultSpec
}

export async function findActivePathCommand(installer: any,
    launcherPath: string,
    defaultCommandPath: string
  ): Promise<string | null> {

    let reachedDefaultCommandPath = false
    for (const commandPath of installer.getPathCommandCandidates(defaultCommandPath)) {
      const isDefaultCommandPath = samePathEntry(installer.platform, commandPath, defaultCommandPath)
      reachedDefaultCommandPath ||= isDefaultCommandPath

      if (!(await isExecutableFile(commandPath))) {
        continue
      }

      const status = await installer.inspectSymlink(commandPath, launcherPath)
      if (status.state !== 'not_installed') {
        if (reachedDefaultCommandPath && !isDefaultCommandPath && status.state === 'conflict') {
          // Why: a non-Orca command after an empty default slot can be shadowed by installing there; no user file replaced.
          continue
        }
        // Why: PATH lookup is first-match-wins; return the command the shell will actually run, preserving shadowing conflicts.
        return commandPath
      }
    }
    return null
}

export function getPathCommandCandidates(installer: any, defaultCommandPath: string): string[] {

    const commandName = basename(defaultCommandPath)
    const pathCandidates = splitPathEntries(installer.platform, installer.processPathEnv ?? '').map((entry) =>
      join(entry, commandName)
    )
    return uniquePathEntries(installer.platform, pathCandidates)
}

export function resolveCommandPath(installer: any): string | null {

    if (installer.commandPathOverride) {
      return installer.commandPathOverride
    }

    if (!installer.isPackaged) {
      // Why: dev uses a separate command; tests/diagnostics still reach production paths via commandPathOverride.
      if (installer.platform === 'darwin') {
        return `/usr/local/bin/${DEV_COMMAND_NAME}`
      }
      if (installer.platform === 'linux') {
        return join(installer.homePath, '.local', 'bin', DEV_COMMAND_NAME)
      }
      if (installer.platform === 'win32') {
        return join(installer.localAppDataPath, 'Programs', 'Orca Dev', 'bin', `${DEV_COMMAND_NAME}.cmd`)
      }
    }

    if (installer.platform === 'darwin') {
      return installer.macCommandPath
    }

    if (installer.platform === 'linux') {
      // Why: Linux lacks a privileged global command flow; ~/.local/bin is the least-surprising user-scoped dir.
      // Why `orca-ide`: GNOME Orca ships /usr/bin/orca, so avoid shadowing that screen reader.
      return join(installer.homePath, '.local', 'bin', LINUX_COMMAND_NAME)
    }

    if (installer.platform === 'win32') {
      // Why: NSIS /D installs can live outside LOCALAPPDATA, so use the packaged resources dir as authoritative.
      return getBundledLauncherPath(installer.platform, installer.resourcesPath)
    }

    return null
}

export async function resolveLauncherPath(installer: any): Promise<string | null> {

    if (!['darwin', 'linux', 'win32'].includes(installer.platform)) {
      return null
    }

    if (installer.isLinuxAppImage()) {
      return installer.appImagePath && existsSync(installer.appImagePath) ? installer.appImagePath : null
    }

    if (installer.isPackaged) {
      const bundledPath = getBundledLauncherPath(installer.platform, installer.resourcesPath)
      return bundledPath && existsSync(bundledPath) ? bundledPath : null
    }

    return ensureDevLauncher({
      platform: installer.platform,
      userDataPath: installer.userDataPath,
      execPath: installer.execPathValue,
      cliEntryPath: join(installer.appPathValue, 'out', 'cli', 'index.js'),
      commandName: installer.commandName
    })
}
