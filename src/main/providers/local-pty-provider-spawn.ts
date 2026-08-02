import { win32 as pathWin32 } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveWindowsShellLaunchArgs } from './windows-shell-args'
import { resolveProcessCwd } from './process-cwd'
import { existsSync } from 'node:fs'
import * as pty from 'node-pty'
import { parseWslPath } from '../wsl'
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
  createShellReadyScanState,
  drainShellReadyHeldBytes,
  scanForShellReady,
  writeStartupCommandWhenShellReady,
  STARTUP_COMMAND_READY_MAX_WAIT_MS
} from './local-pty-shell-ready'
import type { ShellReadySignal } from './local-pty-shell-ready'
import { resolveLocalPtyWindowsShellLaunch } from './local-pty-windows-shell-launch'
import { prepareLocalPtySpawnEnvironment } from './local-pty-spawn-environment'
import { resolveAgentForegroundProcessWithAvailability } from './agent-foreground-process'
import { resolveStableForegroundProcess } from './stable-foreground-process'
import { getAgentForegroundContextPaths } from './agent-foreground-context-paths'
import { recognizeAgentProcessFromCommandLine } from '../../shared/agent-process-recognition'
import { killWithDescendantSweep } from '../pty-descendant-termination'
import { readWindowsConptyProcessIds } from './windows-conpty-process-membership'
import { canConfirmAgentFromConsolePresence } from './windows-console-foreground'
import { forceKillPosixPtyProcessGroups } from '../pty/posix-pty-process-groups'
import { assertSafeAgentStartupCwd, resolveSafePtyDefaultCwd } from './pty-default-cwd'
import { PhysicalExitTracker } from '../../shared/physical-exit-tracker'
import { PtyStartupIngress, type PtyIngressEmission } from '../../shared/pty-startup-ingress'
import { resolvePtyOwnerBackend } from '../../shared/pty-owner-backend'
import {
  PANE_IDENTITY_ENV_KEYS,
  ptyCounter,
  ptyProcesses,
  ptyIncarnations,
  ptyAgentSessionIds,
  ptyShutdownOperations,
  pendingLocalPtySpawns,
  ptyShellName,
  ptyAgentForegroundContextPaths,
  ptyLastRecognizedForeground,
  ptyTerminalHandle,
  ptyWorktreeId,
  ptyInitialCwd,
  ptyWslDistroById,
  ptyDisposables,
  ptyExitDisposables,
  ptyCleanupCallbacks,
  ptyTerminationMode,
  ptyPhysicalExits,
  ptyForceKillTimers,
  LOCAL_PTY_PHYSICAL_EXIT_TIMEOUT_MS,
  LOCAL_PTY_GRACEFUL_FORCE_TIMEOUT_MS,
  LOCAL_PTY_FORCE_KILL_RETRY_MS,
  loadGeneration,
  ptyLoadGeneration,
  dataListeners,
  exitListeners,
  startupIngressByPty,
  getDefaultCwd,
  promoteAgentTeamsShimPath,
  disposePtyListeners,
  disposePtyExitListener,
  clearLocalPtyForceKillTimer,
  runPtyCleanup,
  getWslContextFromWorktreeId,
  getWslContextFromPreferredDistro,
  clearPtyState,
  createPtyPhysicalExit,
  waitForPtyPhysicalExit,
  killLocalPtyProcess,
  armLocalPtyForceKill,
  allocatePtyId,
  cancelPendingLocalPtySpawns,
  cancelAllPendingLocalPtySpawns,
  normalizeLocalCallerSessionId,
  reattachLocalPty,
  normalizeForegroundProcessName,
  resolveForegroundFallbackProcess,
  getSpawnedShellName,
  destroyPtyProcess,
  requestPtyTermination
} from './local-pty-state'
import type {
  PtyShutdownOperation,
  PendingLocalPtySpawn,
  DataCallback,
  ExitCallback
} from './local-pty-state'

export {
  PANE_IDENTITY_ENV_KEYS,
  ptyCounter,
  ptyProcesses,
  ptyIncarnations,
  ptyAgentSessionIds,
  ptyShutdownOperations,
  pendingLocalPtySpawns,
  ptyShellName,
  ptyAgentForegroundContextPaths,
  ptyLastRecognizedForeground,
  ptyTerminalHandle,
  ptyWorktreeId,
  ptyInitialCwd,
  ptyWslDistroById,
  ptyDisposables,
  ptyExitDisposables,
  ptyCleanupCallbacks,
  ptyTerminationMode,
  ptyPhysicalExits,
  ptyForceKillTimers,
  LOCAL_PTY_PHYSICAL_EXIT_TIMEOUT_MS,
  LOCAL_PTY_GRACEFUL_FORCE_TIMEOUT_MS,
  LOCAL_PTY_FORCE_KILL_RETRY_MS,
  loadGeneration,
  ptyLoadGeneration,
  dataListeners,
  exitListeners,
  startupIngressByPty,
  getDefaultCwd,
  promoteAgentTeamsShimPath,
  disposePtyListeners,
  disposePtyExitListener,
  clearLocalPtyForceKillTimer,
  runPtyCleanup,
  getWslContextFromWorktreeId,
  getWslContextFromPreferredDistro,
  clearPtyState,
  createPtyPhysicalExit,
  waitForPtyPhysicalExit,
  killLocalPtyProcess,
  armLocalPtyForceKill,
  allocatePtyId,
  cancelPendingLocalPtySpawns,
  cancelAllPendingLocalPtySpawns,
  normalizeLocalCallerSessionId,
  reattachLocalPty,
  normalizeForegroundProcessName,
  resolveForegroundFallbackProcess,
  getSpawnedShellName,
  destroyPtyProcess,
  requestPtyTermination,
  PtyShutdownOperation,
  PendingLocalPtySpawn,
  DataCallback,
  ExitCallback
} from './local-pty-state'

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
    let windowsFallbackAttempts: ReturnType<
      typeof resolveLocalPtyWindowsShellLaunch
    >['windowsFallbackAttempts'] = []
    if (wslInfo) {
      shellPath = 'wsl.exe'
      const resolved = resolveWindowsShellLaunchArgs(shellPath, cwd, defaultCwd)
      shellArgs = resolved.shellArgs
      effectiveCwd = resolved.effectiveCwd
      validationCwd = resolved.validationCwd
    } else if (process.platform === 'win32') {
      const resolved = resolveLocalPtyWindowsShellLaunch({
        shellOverride: args.shellOverride,
        configuredShell: this.opts.getWindowsShell?.(),
        command: args.command,
        cwd,
        defaultCwd,
        worktreeWslContext,
        launchWslContext,
        getWindowsPowerShellImplementation: this.opts.getWindowsPowerShellImplementation,
        pwshAvailable: this.opts.pwshAvailable
      })
      shellPath = resolved.shellPath
      shellArgs = resolved.shellArgs
      effectiveCwd = resolved.effectiveCwd
      validationCwd = resolved.validationCwd
      startupCommandDeliveredInShellArgs = resolved.startupCommandDeliveredInShellArgs
      windowsFallbackAttempts = resolved.windowsFallbackAttempts
      launchWslContext = resolved.launchWslContext
    } else {
      shellPath = args.env?.SHELL || process.env.SHELL || '/bin/zsh'
      shellArgs = ['-l']
      effectiveCwd = cwd
      validationCwd = cwd
    }

    ensureNodePtySpawnHelperExecutable()
    validateWorkingDirectory(validationCwd)

    const environment = prepareLocalPtySpawnEnvironment({
      id,
      args,
      cwd,
      defaultCwd,
      shellPath,
      shellArgs,
      effectiveCwd,
      validationCwd,
      startupCommandDeliveredInShellArgs,
      startupAgentRecognition,
      wslInfo,
      worktreeWslContext,
      preferredWslContext,
      launchWslContext,
      buildSpawnEnv: this.opts.buildSpawnEnv
    })
    const finalEnv = environment.finalEnv
    shellArgs = environment.shellArgs
    effectiveCwd = environment.effectiveCwd
    validationCwd = environment.validationCwd
    startupCommandDeliveredInShellArgs = environment.startupCommandDeliveredInShellArgs
    const launchWslDistro = environment.launchWslDistro
    let shellReadyLaunch = environment.shellReadyLaunch
    const getFallbackShellReadyConfig = environment.getFallbackShellReadyConfig
    promoteAgentTeamsShimPath(finalEnv, args.env?.PATH)

    // Why: worktree-scoped HISTFILE — without it worktrees share one global history (terminal-history-scope-design §7–§10).
    const worktreeId = args.worktreeId
    const historyEnabled = worktreeId && (this.opts.isHistoryEnabled?.() ?? true)
    // Effective shell for history injection: WSL's outer exe is wsl.exe but the inner login shell is bash.
    const isWslTerminal =
      Boolean(wslInfo || worktreeWslContext || preferredWslContext) ||
      pathWin32.basename(shellPath).toLowerCase() === 'wsl.exe'
    const effectiveShellPath = isWslTerminal ? 'bash' : shellPath
    let historyResult: ReturnType<typeof injectHistoryEnv> | null = null
    if (historyEnabled) {
      historyResult = injectHistoryEnv(finalEnv, worktreeId, effectiveShellPath, cwd, {
        wslDistro: launchWslDistro
      })
      logHistoryInjection(worktreeId, historyResult)
    }

    await prepareLocalPtySpawn(id)
    if (args.signal?.aborted) {
      throw new Error('client_disconnected')
    }
    // Why: another same-id request can win while this one awaits preflight; attach before launching a redundant shell.
    const concurrentWinner = reattachId ? reattachLocalPty(id, args.cols, args.rows) : null
    if (concurrentWinner) {
      return concurrentWinner
    }
    const spawnResult = spawnShellWithFallback({
      shellPath,
      shellArgs,
      cols: args.cols,
      rows: args.rows,
      cwd: effectiveCwd,
      env: finalEnv,
      termName: finalEnv.TERM,
      ptySpawn: pty.spawn,
      getShellReadyConfig: getFallbackShellReadyConfig,
      // Why: on zsh→bash fallback HISTFILE still points to zsh_history; update before spawn so the child inherits it (design doc §8).
      onBeforeFallbackSpawn: historyResult?.histFile
        ? (env, fallbackShell) => updateHistFileForFallback(env, fallbackShell)
        : undefined,
      windowsFallbackAttempts
    })
    args.onPtySpawnCommitted?.()
    shellPath = spawnResult.shellPath
    // Why: a Windows fallback embeds its startup command in argv; honor the winning shell's delivery flag to avoid a double write.
    if (spawnResult.startupCommandDeliveredInShellArgs !== undefined) {
      startupCommandDeliveredInShellArgs = spawnResult.startupCommandDeliveredInShellArgs
    }
    if (args.command && getFallbackShellReadyConfig) {
      shellReadyLaunch = getFallbackShellReadyConfig(shellPath)
    }

    if (process.platform !== 'win32') {
      finalEnv.SHELL = shellPath
    }

    const proc = spawnResult.process
    const spawnedShellIsWsl =
      process.platform === 'win32' && pathWin32.basename(shellPath).toLowerCase() === 'wsl.exe'
    const spawnedWslDistro = spawnedShellIsWsl
      ? (launchWslDistro ?? undefined)
      : process.platform === 'win32'
        ? null
        : undefined
    createPtyPhysicalExit(id)
    ptyProcesses.set(id, proc)
    ptyInitialCwd.set(id, cwd)
    if (spawnedWslDistro !== undefined) {
      ptyWslDistroById.set(id, spawnedWslDistro)
    }
    // Why both: launchAgent is explicit intent that survives command rewrites; recognition catches bare agent command lines.
    if (args.launchAgent || startupAgentRecognition) {
      ptyAgentSessionIds.add(id)
    }
    ptyShellName.set(id, getSpawnedShellName(shellPath))
    if (finalEnv.ORCA_TERMINAL_HANDLE) {
      ptyTerminalHandle.set(id, finalEnv.ORCA_TERMINAL_HANDLE)
    }
    if (args.worktreeId) {
      ptyWorktreeId.set(id, args.worktreeId)
    }
    ptyAgentForegroundContextPaths.set(
      id,
      getAgentForegroundContextPaths({ cwd: args.cwd, worktreeId: args.worktreeId })
    )
    ptyLoadGeneration.set(id, loadGeneration)
    ptyIncarnations.set(id, incarnationId)
    this.opts.onSpawned?.(id, incarnationId)

    const emitIngressData = (emission: PtyIngressEmission): void => {
      const sequenceChars = emission.rawEndSeq - emission.rawStartSeq
      if (emission.transformed || sequenceChars !== emission.data.length) {
        this.opts.onData?.(id, incarnationId, emission.data, Date.now(), sequenceChars, true)
      } else {
        this.opts.onData?.(id, incarnationId, emission.data, Date.now())
      }
      for (const cb of dataListeners) {
        cb(
          emission.transformed || sequenceChars !== emission.data.length
            ? {
                id,
                incarnationId,
                data: emission.data,
                sequenceChars,
                seq: emission.rawEndSeq,
                transformed: true
              }
            : { id, incarnationId, data: emission.data }
        )
      }
    }
    const startupIngress = new PtyStartupIngress({
      ...(args.startupIngress ? { intent: args.startupIngress } : {}),
      ownerBackend: resolvePtyOwnerBackend({
        platform: process.platform,
        shellPath,
        wslDistro: spawnedWslDistro
      }),
      write: (data) => proc.write(data),
      onEmission: emitIngressData
    })
    startupIngressByPty.set(id, startupIngress)

    // Shell-ready startup command support
    let resolveShellReady: ((signal: ShellReadySignal) => void) | null = null
    let shellReadyTimeout: ReturnType<typeof setTimeout> | null = null
    const shellReadyScanState = shellReadyLaunch?.supportsReadyMarker
      ? createShellReadyScanState()
      : null
    const shellReadyPromise = args.command
      ? new Promise<ShellReadySignal>((resolve) => {
          resolveShellReady = resolve
        })
      : Promise.resolve({ postMarkerBytesObserved: false })
    const finishShellReady = (signal: ShellReadySignal): void => {
      if (!resolveShellReady) {
        return
      }
      if (shellReadyTimeout) {
        clearTimeout(shellReadyTimeout)
        shellReadyTimeout = null
      }
      const resolve = resolveShellReady
      resolveShellReady = null
      resolve(signal)
    }
    const releaseHeldShellReadyBytes = (): void => {
      if (!shellReadyScanState) {
        return
      }
      const heldBytes = drainShellReadyHeldBytes(shellReadyScanState)
      if (heldBytes.length === 0) {
        return
      }
      startupIngress.accept(heldBytes)
    }
    if (args.command) {
      if (shellReadyLaunch?.supportsReadyMarker) {
        shellReadyTimeout = setTimeout(() => {
          releaseHeldShellReadyBytes()
          finishShellReady({ postMarkerBytesObserved: false })
        }, STARTUP_COMMAND_READY_MAX_WAIT_MS)
      } else {
        finishShellReady({ postMarkerBytesObserved: false })
      }
    }
    let startupCommandCleanup: (() => void) | null = null
    if (args.command) {
      ptyCleanupCallbacks.set(id, () => {
        if (shellReadyTimeout) {
          clearTimeout(shellReadyTimeout)
          shellReadyTimeout = null
        }
        releaseHeldShellReadyBytes()
        startupCommandCleanup?.()
        startupCommandCleanup = null
        resolveShellReady = null
      })
    }

    const disposables: { dispose: () => void }[] = []
    const onDataDisposable = proc.onData((rawData) => {
      let data = rawData
      if (shellReadyScanState && resolveShellReady) {
        const scanned = scanForShellReady(shellReadyScanState, rawData)
        data = scanned.output
        if (scanned.matched) {
          finishShellReady({ postMarkerBytesObserved: scanned.postMarkerBytesObserved })
        }
      }
      startupIngress.accept(data)
    })
    if (onDataDisposable) {
      disposables.push(onDataDisposable)
    }

    const onExitDisposable = proc.onExit(({ exitCode }) => {
      const wasTerminationRequested = ptyTerminationMode.has(id)
      ptyPhysicalExits.get(id)?.markExited()
      // Why: neutralize proc.kill before destroy — node-pty SIGHUPs on socket 'close', which can race here and signal a reaped/recycled pid.
      if (process.platform !== 'win32') {
        ;(proc as unknown as { kill: (sig?: string) => void }).kill = () => {}
      }
      if (shellReadyTimeout) {
        clearTimeout(shellReadyTimeout)
        shellReadyTimeout = null
      }
      startupCommandCleanup?.()
      clearPtyState(id)
      startupIngress.drainAndClose()
      startupIngressByPty.delete(id)
      // Why: release the master ptmx fd on natural exit, else a clean exit leaks the fd until GC. See docs/fix-pty-fd-leak.md.
      destroyPtyProcess(proc, { alreadyKilled: wasTerminationRequested })
      this.opts.onExit?.(id, exitCode, incarnationId)
      for (const cb of exitListeners) {
        cb({ id, code: exitCode, incarnationId })
      }
    })
    if (onExitDisposable) {
      ptyExitDisposables.set(id, onExitDisposable)
    }
    ptyDisposables.set(id, disposables)

    if (args.command && !startupCommandDeliveredInShellArgs) {
      // Why: only POSIX bash/zsh have bracketed-paste armed so multiline startup prompts paste literally; others use raw submit.
      const spawnedShellName = getSpawnedShellName(shellPath).toLowerCase()
      const bracketedPasteSafe =
        process.platform !== 'win32' && (spawnedShellName === 'bash' || spawnedShellName === 'zsh')
      writeStartupCommandWhenShellReady(
        shellReadyPromise,
        proc,
        args.command,
        (cleanup) => {
          startupCommandCleanup = cleanup
        },
        { bracketedPasteSafe }
      )
    }

    // Why: publish the OS pid for the memory collector; proc.pid can be briefly 0/undefined before node-pty sees the child.
    const rawPid = proc.pid
    const pid = typeof rawPid === 'number' && Number.isFinite(rawPid) && rawPid > 0 ? rawPid : null
    return {
      id,
      incarnationId,
      pid,
      ...(spawnedWslDistro !== undefined ? { wslDistro: spawnedWslDistro } : {})
    }
  }
}
