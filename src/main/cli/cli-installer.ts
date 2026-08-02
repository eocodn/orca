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

import * as cliInstallerStatus from './cli-installer-status'
import * as cliInstallerRegistration from './cli-installer-registration'
import { runMacPrivilegedCommand, writeWindowsUserPath } from './cli-installer-platform'

export class CliInstaller {
  private readonly platform: NodeJS.Platform
  private readonly isPackaged: boolean
  private readonly userDataPath: string
  private readonly resourcesPath: string
  private readonly execPathValue: string
  private readonly appPathValue: string
  private readonly homePath: string
  private readonly localAppDataPath: string
  private readonly processPathEnv: string | null
  private readonly commandPathOverride: string | null
  private readonly macCommandPath: string
  private readonly privilegedRunner: (command: string) => Promise<void>
  private readonly userPathReader: () => Promise<WindowsUserPathReadResult>
  private readonly userPathMutationReader: () => Promise<WindowsUserPathReadResult>
  private readonly userPathWriter: (value: string) => Promise<void>
  private readonly userPathCacheInvalidator: () => void
  private readonly windowsEnvironment: NodeJS.ProcessEnv
  private readonly appImagePath: string | null

  private get commandName(): string {
    if (!this.isPackaged && !this.commandPathOverride) {
      // Why: development builds must not claim the production shell command.
      return DEV_COMMAND_NAME
    }
    // Why: packaged Linux uses `orca-ide` to avoid shadowing GNOME Orca's /usr/bin/orca.
    return this.platform === 'linux' ? LINUX_COMMAND_NAME : 'orca'
  }

  constructor(options: CliInstallerOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.isPackaged = options.isPackaged ?? app.isPackaged
    this.userDataPath = options.userDataPath ?? app.getPath('userData')
    this.resourcesPath = options.resourcesPath ?? process.resourcesPath
    this.execPathValue = options.execPath ?? process.execPath
    this.appPathValue = options.appPath ?? app.getAppPath()
    this.homePath = options.homePath ?? homedir()
    this.localAppDataPath =
      options.localAppDataPath ??
      process.env.LOCALAPPDATA ??
      join(this.homePath, 'AppData', 'Local')
    this.processPathEnv = options.processPathEnv ?? process.env.PATH ?? process.env.Path ?? null
    this.commandPathOverride =
      options.commandPathOverride ?? process.env.ORCA_CLI_INSTALL_PATH ?? null
    // Why: resolved once here (getStatus is hot); /usr/local/bin is absent on Apple Silicon, so fall back to user-writable ~/.local/bin.
    const candidateMacPath = options.defaultMacCommandPath ?? DEFAULT_MAC_COMMAND_PATH
    this.macCommandPath = existsSync(dirname(candidateMacPath))
      ? candidateMacPath
      : join(this.homePath, '.local', 'bin', 'orca')
    this.privilegedRunner = options.privilegedRunner ?? runMacPrivilegedCommand
    this.userPathReader = options.userPathReader ?? readWindowsUserPathRegistry
    this.userPathMutationReader =
      options.userPathMutationReader ?? options.userPathReader ?? readFreshWindowsUserPathRegistry
    this.userPathWriter = options.userPathWriter ?? ((value) => writeWindowsUserPath(value))
    this.userPathCacheInvalidator =
      options.userPathCacheInvalidator ?? invalidateWindowsUserPathRegistryCache
    this.windowsEnvironment = options.windowsEnvironment ?? process.env
    this.appImagePath =
      this.platform === 'linux' && this.isPackaged
        ? (options.appImagePath ?? process.env.APPIMAGE ?? null)
        : null
  }

async getStatus(): Promise<CliInstallStatus> {
    return cliInstallerStatus.getStatus(this)
  }

async install(): Promise<CliInstallStatus> {
    return cliInstallerRegistration.install(this)
  }

async remove(): Promise<CliInstallStatus> {
    return cliInstallerRegistration.remove(this)
  }

private resolveInstallSpec(): InstallSpec | null {
    return cliInstallerStatus.resolveInstallSpec(this)
  }

private async resolveActiveInstallSpec(
    defaultSpec: InstallSpec,
    launcherPath: string
  ): Promise<InstallSpec> {
    return cliInstallerStatus.resolveActiveInstallSpec(this, defaultSpec, launcherPath)
  }

private async findActivePathCommand(
    launcherPath: string,
    defaultCommandPath: string
  ): Promise<string | null> {
    return cliInstallerStatus.findActivePathCommand(this, launcherPath, defaultCommandPath)
  }

private getPathCommandCandidates(defaultCommandPath: string): string[] {
    return cliInstallerStatus.getPathCommandCandidates(this, defaultCommandPath)
  }

private resolveCommandPath(): string | null {
    return cliInstallerStatus.resolveCommandPath(this)
  }

private async resolveLauncherPath(): Promise<string | null> {
    return cliInstallerStatus.resolveLauncherPath(this)
  }

private async installSymlink(status: CliInstallStatus): Promise<void> {
    return cliInstallerStatus.installSymlink(this, status)
  }

private async removeSymlink(commandPath: string): Promise<void> {
    return cliInstallerStatus.removeSymlink(this, commandPath)
  }

private async removeLegacyLinuxCommandIfManaged(launcherPath: string | null): Promise<void> {
    return cliInstallerStatus.removeLegacyLinuxCommandIfManaged(this, launcherPath)
  }

private isManagedLegacyLinuxTarget(resolvedTarget: string, launcherPath: string): boolean {
    return cliInstallerStatus.isManagedLegacyLinuxTarget(this, resolvedTarget, launcherPath)
  }

private async installWindowsWrapper(commandPath: string, launcherPath: string): Promise<void> {
    return cliInstallerStatus.installWindowsWrapper(this, commandPath, launcherPath)
  }

private async installAppImageWrapper(commandPath: string, appImagePath: string): Promise<void> {
    return cliInstallerStatus.installAppImageWrapper(this, commandPath, appImagePath)
  }

private async inspectAppImageWrapper(
    commandPath: string,
    appImagePath: string
  ): Promise<CliInstallStatus> {
    return cliInstallerStatus.inspectAppImageWrapper(this, commandPath, appImagePath)
  }

private async inspectSymlink(
    commandPath: string,
    launcherPath: string
  ): Promise<CliInstallStatus> {
    return cliInstallerStatus.inspectSymlink(this, commandPath, launcherPath)
  }

private isManagedSymlinkTarget(resolvedTarget: string, launcherPath: string): boolean {
    return cliInstallerStatus.isManagedSymlinkTarget(this, resolvedTarget, launcherPath)
  }

private isSiblingDevLauncherTarget(
    resolvedTarget: string,
    packagedLauncherName: string
  ): boolean {
    return cliInstallerStatus.isSiblingDevLauncherTarget(this, resolvedTarget, packagedLauncherName)
  }

private isLinuxAppImage(): boolean {
    return cliInstallerStatus.isLinuxAppImage(this)
  }

private isWindowsPackagedBundledCommand(
    commandPath: string | null,
    launcherPath: string | null
  ): boolean {
    return cliInstallerStatus.isWindowsPackagedBundledCommand(this, commandPath, launcherPath)
  }

private async inspectWindowsWrapper(
    commandPath: string,
    launcherPath: string
  ): Promise<CliInstallStatus> {
    return cliInstallerStatus.inspectWindowsWrapper(this, commandPath, launcherPath)
  }

private buildStatus(args: {
    commandPath: string
    launcherPath: string
    installMethod: CliInstallMethod
    supported: boolean
    state: CliInstallStatus['state']
    currentTarget: string | null
    detail: string | null
  }): CliInstallStatus {
    return cliInstallerStatus.buildStatus(this, args)
  }

private async probePathConfiguration(
    pathDirectory: string
  ): Promise< {
    return cliInstallerStatus.probePathConfiguration(this, pathDirectory)
  }

private withPathInfo(
    status: CliInstallStatus,
    pathDirectory: string,
    pathProbe: { configured: boolean | null; detail: string | null }
  ): CliInstallStatus {
    return cliInstallerStatus.withPathInfo(this, status, pathDirectory, pathProbe)
  }

private async ensureWindowsPathEntry(pathDirectory: string): Promise<void> {
    return cliInstallerRegistration.ensureWindowsPathEntry(this, pathDirectory)
  }

private async removeWindowsPathEntry(pathDirectory: string): Promise<void> {
    return cliInstallerRegistration.removeWindowsPathEntry(this, pathDirectory)
  }

private async readWindowsUserPathForMutation(): Promise< {
    return cliInstallerRegistration.readWindowsUserPathForMutation(this)
  }

private async writeWindowsUserPathEntry(
    value: string,
    pathDirectory: string,
    action: 'add' | 'remove'
  ): Promise<void> {
    return cliInstallerRegistration.writeWindowsUserPathEntry(this, value, pathDirectory, action)
  }
}
export function getBundledLauncherPath(
  platform: NodeJS.Platform,
  resourcesPath: string
): string | null {
  if (platform === 'darwin') {
    return join(resourcesPath, 'bin', 'orca')
  }
  if (platform === 'linux') {
    return join(resourcesPath, 'bin', LINUX_COMMAND_NAME)
  }
  if (platform === 'win32') {
    return join(resourcesPath, 'bin', 'orca.exe')
  }
  return null
}
