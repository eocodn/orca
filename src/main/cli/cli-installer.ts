import { app } from 'electron'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CliInstallMethod, CliInstallStatus } from '../../shared/cli-install-types'
import {
  invalidateWindowsUserPathRegistryCache,
  readFreshWindowsUserPathRegistry,
  readWindowsUserPathRegistry,
  type WindowsUserPathReadResult
} from './windows-user-path-registry'

const DEFAULT_MAC_COMMAND_PATH = '/usr/local/bin/orca'
const DEV_COMMAND_NAME = 'orca-dev'
const LINUX_COMMAND_NAME = 'orca-ide'

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
  readonly platform: NodeJS.Platform
  readonly isPackaged: boolean
  readonly userDataPath: string
  readonly resourcesPath: string
  readonly execPathValue: string
  readonly appPathValue: string
  readonly homePath: string
  readonly localAppDataPath: string
  readonly processPathEnv: string | null
  readonly commandPathOverride: string | null
  readonly macCommandPath: string
  readonly privilegedRunner: (command: string) => Promise<void>
  readonly userPathReader: () => Promise<WindowsUserPathReadResult>
  readonly userPathMutationReader: () => Promise<WindowsUserPathReadResult>
  readonly userPathWriter: (value: string) => Promise<void>
  readonly userPathCacheInvalidator: () => void
  readonly windowsEnvironment: NodeJS.ProcessEnv
  readonly appImagePath: string | null

  get commandName(): string {
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

resolveInstallSpec(): InstallSpec | null {
    return cliInstallerStatus.resolveInstallSpec(this)
  }

async resolveActiveInstallSpec(
    defaultSpec: InstallSpec,
    launcherPath: string
  ): Promise<InstallSpec> {
    return cliInstallerStatus.resolveActiveInstallSpec(this, defaultSpec, launcherPath)
  }

async findActivePathCommand(
    launcherPath: string,
    defaultCommandPath: string
  ): Promise<string | null> {
    return cliInstallerStatus.findActivePathCommand(this, launcherPath, defaultCommandPath)
  }

getPathCommandCandidates(defaultCommandPath: string): string[] {
    return cliInstallerStatus.getPathCommandCandidates(this, defaultCommandPath)
  }

resolveCommandPath(): string | null {
    return cliInstallerStatus.resolveCommandPath(this)
  }

async resolveLauncherPath(): Promise<string | null> {
    return cliInstallerStatus.resolveLauncherPath(this)
  }

async installSymlink(status: CliInstallStatus): Promise<void> {
    return cliInstallerStatus.installSymlink(this, status)
  }

async removeSymlink(commandPath: string): Promise<void> {
    return cliInstallerStatus.removeSymlink(this, commandPath)
  }

async removeLegacyLinuxCommandIfManaged(launcherPath: string | null): Promise<void> {
    return cliInstallerStatus.removeLegacyLinuxCommandIfManaged(this, launcherPath)
  }

isManagedLegacyLinuxTarget(resolvedTarget: string, launcherPath: string): boolean {
    return cliInstallerStatus.isManagedLegacyLinuxTarget(this, resolvedTarget, launcherPath)
  }

async installWindowsWrapper(commandPath: string, launcherPath: string): Promise<void> {
    return cliInstallerStatus.installWindowsWrapper(this, commandPath, launcherPath)
  }

async installAppImageWrapper(commandPath: string, appImagePath: string): Promise<void> {
    return cliInstallerStatus.installAppImageWrapper(this, commandPath, appImagePath)
  }

async inspectAppImageWrapper(
    commandPath: string,
    appImagePath: string
  ): Promise<CliInstallStatus> {
    return cliInstallerStatus.inspectAppImageWrapper(this, commandPath, appImagePath)
  }

async inspectSymlink(
    commandPath: string,
    launcherPath: string
  ): Promise<CliInstallStatus> {
    return cliInstallerStatus.inspectSymlink(this, commandPath, launcherPath)
  }

isManagedSymlinkTarget(resolvedTarget: string, launcherPath: string): boolean {
    return cliInstallerStatus.isManagedSymlinkTarget(this, resolvedTarget, launcherPath)
  }

isSiblingDevLauncherTarget(
    resolvedTarget: string,
    packagedLauncherName: string
  ): boolean {
    return cliInstallerStatus.isSiblingDevLauncherTarget(this, resolvedTarget, packagedLauncherName)
  }

isLinuxAppImage(): boolean {
    return cliInstallerStatus.isLinuxAppImage(this)
  }

isWindowsPackagedBundledCommand(
    commandPath: string | null,
    launcherPath: string | null
  ): boolean {
    return cliInstallerStatus.isWindowsPackagedBundledCommand(this, commandPath, launcherPath)
  }

async inspectWindowsWrapper(
    commandPath: string,
    launcherPath: string
  ): Promise<CliInstallStatus> {
    return cliInstallerStatus.inspectWindowsWrapper(this, commandPath, launcherPath)
  }

buildStatus(args: {
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

async probePathConfiguration(
    pathDirectory: string
  ): Promise<{
    configured: boolean | null
    detail: string | null
  }> {
    return cliInstallerStatus.probePathConfiguration(this, pathDirectory)
  }

withPathInfo(
    status: CliInstallStatus,
    pathDirectory: string,
    pathProbe: { configured: boolean | null; detail: string | null }
  ): CliInstallStatus {
    return cliInstallerStatus.withPathInfo(this, status, pathDirectory, pathProbe)
  }

async ensureWindowsPathEntry(pathDirectory: string): Promise<void> {
    return cliInstallerRegistration.ensureWindowsPathEntry(this, pathDirectory)
  }

async removeWindowsPathEntry(pathDirectory: string): Promise<void> {
    return cliInstallerRegistration.removeWindowsPathEntry(this, pathDirectory)
  }

async readWindowsUserPathForMutation(): Promise<{
    value: string | null
    expandable: boolean
  }> {
    return cliInstallerRegistration.readWindowsUserPathForMutation(this)
  }

async writeWindowsUserPathEntry(
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
