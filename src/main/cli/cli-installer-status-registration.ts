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
