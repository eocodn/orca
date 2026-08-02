import { basename, delimiter, win32 as pathWin32 } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveWindowsShellLaunchArgs } from './windows-shell-args'
import {
  resolveEffectiveWindowsPowerShell,
  shouldProbeWindowsPowerShellAvailability,
  type WindowsPowerShellShellFamily
} from './windows-powershell'
import { buildWindowsPowerShellSpawnAttempts } from './windows-shell-fallback-chain'
import { resolveProcessCwd } from './process-cwd'
import { existsSync } from 'node:fs'
import * as pty from 'node-pty'
import { getDefaultWslDistro, parseWslPath, isWslAvailable } from '../wsl'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree-id'
import {
  injectHistoryEnv,
  updateHistFileForFallback,
  logHistoryInjection
} from '../terminal-history'
import type { IPtyProvider, PtyProcessInfo, PtySpawnOptions, PtySpawnResult } from './types'
import {
  ensureNodePtySpawnHelperExecutable,
  validateWorkingDirectory,
  spawnShellWithFallback
} from './local-pty-utils'
import { prepareMacosTccLoginShell } from './macos-tcc-login-shell'
import {
  getAttributionShellLaunchConfig,
  getShellReadyLaunchConfig,
  createShellReadyScanState,
  drainShellReadyHeldBytes,
  scanForShellReady,
  writeStartupCommandWhenShellReady,
  STARTUP_COMMAND_READY_MAX_WAIT_MS
} from './local-pty-shell-ready'
import type { ShellReadySignal } from './local-pty-shell-ready'
import { removeInheritedNoColor } from '../pty/terminal-color-env'
import { removeAppImageRuntimeEnv } from '../pty/appimage-terminal-env'
import { stripInheritedBuildModeEnv } from '../pty/build-mode-env'
import { isHostCodexHomeForWsl, isWslCodexHomeForHost } from '../pty/codex-home-wsl-env'
import { addWslEnvKeys } from '../wsl-env'
import {
  POWERLEVEL10K_WIZARD_DISABLE_ENV,
  seedPowerlevel10kWizardEnv
} from '../pty/powerlevel10k-wizard-env'
import {
  isWindowsGitBashShellPath,
  resolveGitBashPath,
  resolveWindowsGitBashShellPath
} from '../git-bash'
import { WINDOWS_GIT_BASH_SHELL } from '../../shared/windows-terminal-shell'
import { resolveAgentForegroundProcessWithAvailability } from './agent-foreground-process'
import { resolveStableForegroundProcess } from './stable-foreground-process'
import { getAgentForegroundContextPaths } from './agent-foreground-context-paths'
import { recognizeAgentProcessFromCommandLine } from '../../shared/agent-process-recognition'
import { killWithDescendantSweep } from '../pty-descendant-termination'
import { readWindowsConptyProcessIds } from './windows-conpty-process-membership'
import { canConfirmAgentFromConsolePresence } from './windows-console-foreground'
import { forceKillPosixPtyProcessGroups } from '../pty/posix-pty-process-groups'
import { shouldUseShellReadyStartupDelivery } from '../../shared/codex-startup-delivery'
import { assertSafeAgentStartupCwd, resolveSafePtyDefaultCwd } from './pty-default-cwd'
import { ORCA_HERMES_STARTUP_QUERY_ENV } from '../../shared/hermes-startup-query'
import { PhysicalExitTracker } from '../../shared/physical-exit-tracker'
import { mergeGitConfigEnvProtocol } from '../../shared/git-credential-prompt-env'
import { PtyStartupIngress, type PtyIngressEmission } from '../../shared/pty-startup-ingress'
import { resolvePtyOwnerBackend } from '../../shared/pty-owner-backend'
import { PANE_IDENTITY_ENV_KEYS, ptyCounter, ptyProcesses, ptyIncarnations, ptyAgentSessionIds, ptyShutdownOperations, pendingLocalPtySpawns, ptyShellName, ptyAgentForegroundContextPaths, ptyLastRecognizedForeground, ptyTerminalHandle, ptyWorktreeId, ptyInitialCwd, ptyWslDistroById, ptyDisposables, ptyExitDisposables, ptyCleanupCallbacks, ptyTerminationMode, ptyPhysicalExits, ptyForceKillTimers, LOCAL_PTY_PHYSICAL_EXIT_TIMEOUT_MS, LOCAL_PTY_GRACEFUL_FORCE_TIMEOUT_MS, LOCAL_PTY_FORCE_KILL_RETRY_MS, loadGeneration, ptyLoadGeneration, dataListeners, exitListeners, startupIngressByPty, getDefaultCwd, removeUnspecifiedPaneIdentityEnv, promoteAgentTeamsShimPath, disposePtyListeners, disposePtyExitListener, clearLocalPtyForceKillTimer, runPtyCleanup, getWslContextFromWorktreeId, getWslContextFromPreferredDistro, clearPtyState, createPtyPhysicalExit, waitForPtyPhysicalExit, killLocalPtyProcess, armLocalPtyForceKill, allocatePtyId, cancelPendingLocalPtySpawns, cancelAllPendingLocalPtySpawns, normalizeLocalCallerSessionId, reattachLocalPty, normalizeForegroundProcessName, resolveForegroundFallbackProcess, getSpawnedShellName, destroyPtyProcess, requestPtyTermination } from './local-pty-state'
import type { PtyShutdownOperation, PendingLocalPtySpawn, DataCallback, ExitCallback } from './local-pty-state'

export { PANE_IDENTITY_ENV_KEYS, ptyCounter, ptyProcesses, ptyIncarnations, ptyAgentSessionIds, ptyShutdownOperations, pendingLocalPtySpawns, ptyShellName, ptyAgentForegroundContextPaths, ptyLastRecognizedForeground, ptyTerminalHandle, ptyWorktreeId, ptyInitialCwd, ptyWslDistroById, ptyDisposables, ptyExitDisposables, ptyCleanupCallbacks, ptyTerminationMode, ptyPhysicalExits, ptyForceKillTimers, LOCAL_PTY_PHYSICAL_EXIT_TIMEOUT_MS, LOCAL_PTY_GRACEFUL_FORCE_TIMEOUT_MS, LOCAL_PTY_FORCE_KILL_RETRY_MS, loadGeneration, ptyLoadGeneration, dataListeners, exitListeners, startupIngressByPty, getDefaultCwd, removeUnspecifiedPaneIdentityEnv, promoteAgentTeamsShimPath, disposePtyListeners, disposePtyExitListener, clearLocalPtyForceKillTimer, runPtyCleanup, getWslContextFromWorktreeId, getWslContextFromPreferredDistro, clearPtyState, createPtyPhysicalExit, waitForPtyPhysicalExit, killLocalPtyProcess, armLocalPtyForceKill, allocatePtyId, cancelPendingLocalPtySpawns, cancelAllPendingLocalPtySpawns, normalizeLocalCallerSessionId, reattachLocalPty, normalizeForegroundProcessName, resolveForegroundFallbackProcess, getSpawnedShellName, destroyPtyProcess, requestPtyTermination, PtyShutdownOperation, PendingLocalPtySpawn, DataCallback, ExitCallback } from './local-pty-state'

export type LocalPtyProviderOptions = {
  /** Why: `ctx.command` (pi/omp/claude) must drive overlay source-dir selection — a disk-presence fallback shadows the other agent's extensions. */
  buildSpawnEnv?: (
    id: string,
    baseEnv: Record<string, string>,
    ctx?: {
      command?: string
      launchAgent?: PtySpawnOptions['launchAgent']
      codexHomePathOverride?: PtySpawnOptions['codexHomePathOverride']
      cwd?: string
      shellPath?: string
      isWsl?: boolean
      wslDistro?: string | null
    }
  ) => Record<string, string>
  /** Whether worktree-scoped shell history is enabled; when true (or absent) with a worktreeId, HISTFILE is scoped per-worktree. */
  isHistoryEnabled?: () => boolean
  /** Why: COMSPEC is always cmd.exe, so this callback injects the user's persisted shell preference. Undefined when none set. */
  getWindowsShell?: () => string | undefined
  getWindowsPowerShellImplementation?: () => 'auto' | 'powershell.exe' | 'pwsh.exe' | undefined
  pwshAvailable?: () => boolean
  onSpawned?: (id: string, incarnationId: string) => void
  onExit?: (id: string, code: number, incarnationId: string) => void
  onData?: (
    id: string,
    incarnationId: string,
    data: string,
    timestamp: number,
    sequenceChars?: number,
    transformed?: boolean
  ) => void
}


export function advanceLocalPtyGeneration(): number {
  return ++loadGeneration
}

export function resetLocalPtyGeneration(): void {
  loadGeneration = 0
}

export class LocalPtyProviderSpawn implements IPtyProvider {
  protected opts: LocalPtyProviderOptions

  constructor(opts: LocalPtyProviderOptions = {}) {
    this.opts = opts
  }

  /** Reconfigure the provider with new hooks (e.g. after window re-creation). */
  configure(opts: LocalPtyProviderOptions): void {
    this.opts = opts
  }

  /**
   * Spawns or reattaches a local PTY session for the renderer process.
   *
   * Windows launches can pre-deliver startup commands in argv, so the stdin fallback only runs when needed.
   */
  async spawn(args: PtySpawnOptions): Promise<PtySpawnResult> {
    const reattachId = normalizeLocalCallerSessionId(args.sessionId)
    if (reattachId) {
      const pendingShutdown = ptyShutdownOperations.get(reattachId)
      if (pendingShutdown) {
        await pendingShutdown.promise
      }
      const existing = reattachLocalPty(reattachId, args.cols, args.rows)
      if (existing) {
        return existing
      }
    }
    const id = allocatePtyId(reattachId ?? undefined)
    const incarnationId = randomUUID()

    const startupAgentRecognition = args.command
      ? recognizeAgentProcessFromCommandLine(args.command)
      : null

    const defaultCwd = getDefaultCwd()
    const cwd = args.cwd || defaultCwd
    // Why: gate on the effective cwd, not raw args.cwd — an omitted cwd becomes a safe default and must not be rejected as root-like.
    if (args.command && startupAgentRecognition) {
      assertSafeAgentStartupCwd(cwd, args.command)
    }
    const wslInfo = process.platform === 'win32' ? parseWslPath(cwd) : null
    const worktreeWslContext =
      process.platform === 'win32' ? getWslContextFromWorktreeId(args.worktreeId) : undefined
    const preferredWslContext =
      process.platform === 'win32'
        ? getWslContextFromPreferredDistro(args.terminalWindowsWslDistro)
        : undefined
    let launchWslContext =
      wslInfo !== null
        ? getWslContextFromPreferredDistro(wslInfo.distro)
        : (worktreeWslContext ?? preferredWslContext)

    let shellPath: string
    let shellArgs: string[]
    let effectiveCwd: string
    let validationCwd: string
    let startupCommandDeliveredInShellArgs = false
    let windowsFallbackAttempts: ReturnType<typeof buildWindowsPowerShellSpawnAttempts> = []
    let shellReadyLaunch: ReturnType<typeof getShellReadyLaunchConfig> | null = null
    let getFallbackShellReadyConfig:
      | ((shell: string) => ReturnType<typeof getShellReadyLaunchConfig>)
      | undefined
    if (wslInfo) {
      shellPath = 'wsl.exe'
      const resolved = resolveWindowsShellLaunchArgs(shellPath, cwd, defaultCwd)
      shellArgs = resolved.shellArgs
      effectiveCwd = resolved.effectiveCwd
      validationCwd = resolved.validationCwd
    } else if (process.platform === 'win32') {
      // Why: shellOverride opens one tab in a non-default shell without changing the user's setting; it wins over the setting.
      const requestedShellFamily =
        args.shellOverride ||
        this.opts.getWindowsShell?.() ||
        process.env.COMSPEC ||
        'powershell.exe'
      const shellFamily = worktreeWslContext ? 'wsl.exe' : requestedShellFamily
      if (!launchWslContext && pathWin32.basename(shellFamily).toLowerCase() === 'wsl.exe') {
        launchWslContext = getWslContextFromPreferredDistro(getDefaultWslDistro())
      }
      const normalizedShellFamily = pathWin32.basename(shellFamily).toLowerCase()
      const resolvedGitBashPath = resolveWindowsGitBashShellPath(shellFamily)
      // Why: normalize setting-value and path forms to the PowerShell family so the resolver can fall back to inbox powershell.exe.
      const powerShellImplementation = this.opts.getWindowsPowerShellImplementation?.()
      const resolvedShellFamily: WindowsPowerShellShellFamily =
        normalizedShellFamily === 'powershell.exe' || normalizedShellFamily === 'pwsh.exe'
          ? normalizedShellFamily
          : normalizedShellFamily === 'cmd.exe' || normalizedShellFamily === 'wsl.exe'
            ? normalizedShellFamily
            : undefined
      const shouldProbePwsh = shouldProbeWindowsPowerShellAvailability({
        shellFamily: resolvedShellFamily,
        implementation: powerShellImplementation
      })
      const shouldResolvePowerShellFamily =
        powerShellImplementation !== undefined || pathWin32.basename(shellFamily) === shellFamily
      if (resolvedGitBashPath) {
        shellPath = resolvedGitBashPath
      } else if (shellFamily === WINDOWS_GIT_BASH_SHELL) {
        shellPath = 'powershell.exe'
      } else {
        shellPath = shouldResolvePowerShellFamily
          ? (resolveEffectiveWindowsPowerShell({
              shellFamily: resolvedShellFamily,
              implementation: powerShellImplementation,
              pwshAvailable: shouldProbePwsh ? (this.opts.pwshAvailable?.() ?? false) : false
            }) ?? shellFamily)
          : shellFamily
      }

