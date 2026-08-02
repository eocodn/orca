import { basename } from 'node:path'
import { existsSync } from 'node:fs'
import * as pty from 'node-pty'
import { resolveProcessCwd } from './process-cwd'
import type { PtyProcessInfo } from './types'
import { killWithDescendantSweep } from '../pty-descendant-termination'
import { resolveAgentForegroundProcessWithAvailability } from './agent-foreground-process'
import { resolveStableForegroundProcess } from './stable-foreground-process'
import { getAgentForegroundContextPaths } from './agent-foreground-context-paths'
import { recognizeAgentProcessFromCommandLine } from '../../shared/agent-process-recognition'
import { readWindowsConptyProcessIds } from './windows-conpty-process-membership'
import { canConfirmAgentFromConsolePresence } from './windows-console-foreground'
import { resolveGitBashPath } from '../git-bash'
import { isWslAvailable } from '../wsl'
import { LocalPtyProviderSpawn, advanceLocalPtyGeneration, resetLocalPtyGeneration, ptyProcesses, ptyIncarnations, ptyAgentSessionIds, ptyShutdownOperations, ptyShellName, ptyAgentForegroundContextPaths, ptyLastRecognizedForeground, ptyTerminalHandle, ptyWorktreeId, ptyInitialCwd, ptyWslDistroById, ptyTerminationMode, ptyLoadGeneration, dataListeners, exitListeners, startupIngressByPty, disposePtyListeners, disposePtyExitListener, clearLocalPtyForceKillTimer, runPtyCleanup, clearPtyState, waitForPtyPhysicalExit, killLocalPtyProcess, armLocalPtyForceKill, cancelPendingLocalPtySpawns, cancelAllPendingLocalPtySpawns, resolveForegroundFallbackProcess, destroyPtyProcess, requestPtyTermination } from './local-pty-provider-spawn'
import type { PtyShutdownOperation, DataCallback, ExitCallback } from './local-pty-provider-spawn'
export class LocalPtyProvider extends LocalPtyProviderSpawn {
  // Local PTYs are always attached -- no-op. Remote providers use this to resubscribe.
  async attach(_id: string): Promise<void> {}
  hasPty(id: string): boolean {
    return ptyProcesses.has(id)
  }
  write(id: string, data: string): void {
    ptyProcesses.get(id)?.write(data)
  }
  resize(id: string, cols: number, rows: number): void {
    ptyProcesses.get(id)?.resize(cols, rows)
  }

  async resizeIfCurrent(
    id: string,
    expectedIncarnationId: string,
    cols: number,
    rows: number
  ): Promise<boolean> {
    const process = ptyProcesses.get(id)
    if (!process || ptyIncarnations.get(id) !== expectedIncarnationId) {
      return false
    }
    process.resize(cols, rows)
    return true
  }

  // Why: node-pty pause() stops reading the master fd, so a flooding child blocks on write — true producer backpressure.
  pauseProducer(id: string): void {
    try {
      ptyProcesses.get(id)?.pause()
    } catch {
      /* PTY already destroyed */
    }
  }

  resumeProducer(id: string): void {
    try {
      ptyProcesses.get(id)?.resume()
    } catch {
      /* PTY already destroyed */
    }
  }

  // Why: proc.cols/rows are node-pty's authoritative applied size (post-clamp/no-op), used by the renderer drift-check.
  async getAppliedSize(id: string): Promise<{ cols: number; rows: number } | null> {
    const proc = ptyProcesses.get(id)
    if (!proc || proc.cols <= 0 || proc.rows <= 0) {
      return null
    }
    return { cols: proc.cols, rows: proc.rows }
  }

  async shutdown(id: string, opts: { immediate?: boolean; keepHistory?: boolean }): Promise<void> {
    cancelPendingLocalPtySpawns(id)
    const pending = ptyShutdownOperations.get(id)
    if (pending) {
      if (opts.immediate === true) {
        pending.immediate = true
        if (pending.rootSignalled && ptyProcesses.get(id) === pending.proc) {
          this.requestTrackedPtyShutdown(id, pending.proc, true)
        }
      }
      await pending.promise
      return
    }
    const proc = ptyProcesses.get(id)
    if (!proc) {
      return
    }
    const entry: PtyShutdownOperation = {
      promise: Promise.resolve(),
      immediate: opts.immediate === true,
      rootSignalled: false,
      proc
    }
    entry.promise = this.shutdownTrackedPty(id, proc, entry)
    ptyShutdownOperations.set(id, entry)
    try {
      await entry.promise
    } finally {
      if (ptyShutdownOperations.get(id) === entry) {
        ptyShutdownOperations.delete(id)
      }
    }
  }

  private async shutdownTrackedPty(
    id: string,
    proc: pty.IPty,
    operation: PtyShutdownOperation
  ): Promise<void> {
    const physicalExit = ptyPhysicalExits.get(id)
    const signalRoot = (): void => {
      // Why: natural exit can race the sweep — never signal after this PTY loses ownership.
      if (ptyProcesses.get(id) !== proc) {
        return
      }
      // Cancel startup delivery now, but keep the exit listener and ownership maps until node-pty reports physical exit.
      runPtyCleanup(id)
      operation.rootSignalled = true
      this.requestTrackedPtyShutdown(id, proc, operation.immediate)
    }
    if (ptyAgentSessionIds.has(id)) {
      // Why: POSIX needs a pre-kill descendant snapshot; Windows tree-kills only when the
      // identity probe returns `own` so agent/MCP orphans cannot hold the worktree cwd
      // (#10004). `unknown`/`foreign`/`absent` skip taskkill and rely on root close alone.
      await killWithDescendantSweep(proc.pid, signalRoot, {
        ownsRoot: () => ptyProcesses.get(id) === proc
      })
    } else if (process.platform === 'win32' && operation.immediate) {
      // Why: a plain shell's ConPTY teardown doesn't reap orphaned children (useConptyDll
      // skips the console reap), so a live `pnpm i`/`node` keeps the ConPTY console alive and
      // holds the worktree cwd. Tree kill runs only when the OS identity probe returns `own`;
      // otherwise root close alone, and detached children may block physical stop (#10004).
      await killWithDescendantSweep(proc.pid, signalRoot, {
        ownsRoot: () => ptyProcesses.get(id) === proc
      })
    } else {
      signalRoot()
    }
    await waitForPtyPhysicalExit(id, physicalExit)
  }

  private requestTrackedPtyShutdown(id: string, proc: pty.IPty, immediate: boolean): void {
    const previousMode = ptyTerminationMode.get(id)
    // Why: ConPTY has no graceful signal — its first bare kill closes the pseudoconsole, so treat it as a final force request.
    const requestedMode = immediate || process.platform === 'win32' ? 'force' : 'graceful'
    if (!previousMode || (requestedMode === 'force' && previousMode !== 'force')) {
      ptyTerminationMode.set(id, requestedMode)
      try {
        killLocalPtyProcess(proc, immediate)
        if (requestedMode === 'graceful') {
          armLocalPtyForceKill(id, proc)
        } else {
          clearLocalPtyForceKillTimer(id)
        }
      } catch (error) {
        if (previousMode) {
          ptyTerminationMode.set(id, previousMode)
        } else {
          ptyTerminationMode.delete(id)
        }
        throw error
      }
    }
  }

  async sendSignal(id: string, signal: string): Promise<void> {
    const proc = ptyProcesses.get(id)
    if (!proc) {
      return
    }
    try {
      process.kill(proc.pid, signal)
    } catch {
      /* Process may already be dead */
    }
  }

  async getCwd(id: string): Promise<string> {
    const proc = ptyProcesses.get(id)
    // Why: '' not throw on unknown id — renderer reads empty as "try next fallback"; throwing is noisy for a normal case.
    if (!proc) {
      return ''
    }
    // Why: let resolveProcessCwd's '' surface for the renderer fallback chain; a fabricated cwd would short-circuit it.
    return resolveProcessCwd(proc.pid)
  }
  async getInitialCwd(_id: string): Promise<string> {
    return ''
  }
  async clearBuffer(id: string): Promise<void> {
    // Why: ConPTY keeps its own screen buffer, so xterm clear() alone leaves a stale-cursor gap on the next prompt; POSIX no-op.
    // No PSReadLine form-feed nudge here (unlike the daemon): safe only at an empty prompt, which this provider can't detect.
    try {
      startupIngressByPty.get(id)?.snapshotBarrier()
      ptyProcesses.get(id)?.clear()
    } catch {
      /* PTY may have just exited */
    }
  }
  closeStartupQueryAuthority(id: string): number {
    return startupIngressByPty.get(id)?.closeQueryAuthority() ?? 0
  }
  acknowledgeDataEvent(_id: string, _charCount: number): void {
    /* no flow control for local */
  }

  async hasChildProcesses(id: string): Promise<boolean> {
    const proc = ptyProcesses.get(id)
    if (!proc) {
      return false
    }
    try {
      const foreground = proc.process
      const shell = ptyShellName.get(id)
      if (!shell) {
        return true
      }
      return foreground !== shell
    } catch {
      return false
    }
  }

  async getForegroundProcess(id: string): Promise<string | null> {
    const proc = ptyProcesses.get(id)
    if (!proc) {
      ptyLastRecognizedForeground.delete(id)
      return null
    }
    const fallbackProcess = resolveForegroundFallbackProcess(
      proc.process || null,
      ptyShellName.get(id)
    )
    const cachedAgent = ptyLastRecognizedForeground.get(id) ?? null
    let consoleMembershipUnavailable = false
    // Why: console membership preserves a live cached agent without the whole-table scan (incomplete under Windows load).
    if (
      process.platform === 'win32' &&
      canConfirmAgentFromConsolePresence(cachedAgent, fallbackProcess)
    ) {
      try {
        const consoleProcessIds = await readWindowsConptyProcessIds(proc.pid)
        if (ptyProcesses.get(id) !== proc) {
          return null
        }
        if (consoleProcessIds !== null && consoleProcessIds.size > 1 && cachedAgent !== null) {
          return cachedAgent
        }
        consoleMembershipUnavailable = consoleProcessIds === null
      } catch {
        consoleMembershipUnavailable = true
      }
    }
    try {
      const resolution = await resolveAgentForegroundProcessWithAvailability(
        proc.pid,
        fallbackProcess,
        {
          contextPaths: ptyAgentForegroundContextPaths.get(id)
        }
      )
      // Why: the scan can outlive PTY teardown/id reuse; stale results must not resurrect cache for a foreign id.
      if (ptyProcesses.get(id) !== proc) {
        return null
      }
      // Why: a degraded scan reporting shell-as-foreground fires a false "agent done"; keep last recognized agent instead.
      const lastRecognizedAgent = ptyLastRecognizedForeground.get(id) ?? null
      const resolvedAgent = resolution.processName
        ? recognizeAgentProcessFromCommandLine(resolution.processName)
        : null
      // Why: incomplete snapshot + unavailable console probe isn't exit proof; only shell-only membership may clear the cache.
      const stable = resolveStableForegroundProcess(
        consoleMembershipUnavailable && resolvedAgent === null
          ? { ...resolution, available: false }
          : resolution,
        lastRecognizedAgent
      )
      if (stable.lastRecognizedAgent) {
        ptyLastRecognizedForeground.set(id, stable.lastRecognizedAgent)
      } else {
        ptyLastRecognizedForeground.delete(id)
      }
      return stable.processName
    } catch {
      if (ptyProcesses.get(id) !== proc) {
        return null
      }
      // Why: an inspection error is a degraded read; fall back to last recognized agent (null reads as an exit).
      return ptyLastRecognizedForeground.get(id) ?? null
    }
  }

  async confirmForegroundProcess(id: string): Promise<string | null> {
    const proc = ptyProcesses.get(id)
    if (!proc) {
      return null
    }
    try {
      const resolution = await resolveAgentForegroundProcessWithAvailability(
        proc.pid,
        resolveForegroundFallbackProcess(proc.process || null, ptyShellName.get(id)),
        {
          contextPaths: ptyAgentForegroundContextPaths.get(id),
          fresh: true,
          ...(process.platform === 'win32'
            ? {
                forceProcessScan: true,
                readWindowsConptyProcessIds: () => readWindowsConptyProcessIds(proc.pid)
              }
            : {})
        }
      )
      // Why: a fresh scan can outlive this PTY id; never publish identity from an exited or same-id-reusing session.
      if (ptyProcesses.get(id) !== proc) {
        return null
      }
      return resolution.available ? resolution.processName : null
    } catch {
      return null
    }
  }

  async serialize(_ids: string[]): Promise<string> {
    return '{}'
  }
  async revive(_state: string): Promise<void> {
    /* re-spawning handles local revival */
  }

  async listProcesses(): Promise<PtyProcessInfo[]> {
    return Array.from(ptyProcesses.entries()).map(([id, proc]) => ({
      id,
      ...(ptyIncarnations.get(id) ? { incarnationId: ptyIncarnations.get(id) } : {}),
      cwd: ptyInitialCwd.get(id) ?? '',
      title: proc.process || ptyShellName.get(id) || 'shell',
      ...(ptyWorktreeId.get(id) ? { worktreeId: ptyWorktreeId.get(id) } : {}),
      ...(ptyTerminalHandle.get(id) ? { terminalHandle: ptyTerminalHandle.get(id) } : {}),
      ...(ptyWslDistroById.has(id) ? { wslDistro: ptyWslDistroById.get(id) ?? null } : {})
    }))
  }

  async getDefaultShell(): Promise<string> {
    if (process.platform === 'win32') {
      return this.opts.getWindowsShell?.() || process.env.COMSPEC || 'powershell.exe'
    }
    return process.env.SHELL || '/bin/zsh'
  }

  async getProfiles(): Promise<{ name: string; path: string }[]> {
    if (process.platform === 'win32') {
      const profiles: { name: string; path: string }[] = [
        { name: 'PowerShell', path: 'powershell.exe' },
        { name: 'Command Prompt', path: 'cmd.exe' }
      ]
      const gitBashPath = resolveGitBashPath()
      if (gitBashPath) {
        profiles.push({ name: 'Git Bash', path: gitBashPath })
      }
      if (isWslAvailable()) {
        profiles.push({ name: 'WSL', path: 'wsl.exe' })
      }
      return profiles
    }
    const shells = ['/bin/zsh', '/bin/bash', '/bin/sh']
    return shells.filter((s) => existsSync(s)).map((s) => ({ name: basename(s), path: s }))
  }

  onData(callback: DataCallback): () => void {
    dataListeners.add(callback)
    return () => dataListeners.delete(callback)
  }

  // Local PTYs don't replay -- this is for remote reconnection
  onReplay(_callback: (payload: { id: string; data: string }) => void): () => void {
    return () => {}
  }

  onExit(callback: ExitCallback): () => void {
    exitListeners.add(callback)
    return () => exitListeners.delete(callback)
  }

  // ─── Local-only helpers (not part of IPtyProvider interface) ───────

  /** Kill orphaned PTYs from previous page loads. */
  killOrphanedPtys(currentGeneration: number): { id: string }[] {
    const killed: { id: string }[] = []
    for (const [id, proc] of ptyProcesses) {
      if ((ptyLoadGeneration.get(id) ?? -1) < currentGeneration) {
        requestPtyTermination(id, proc)
        killed.push({ id })
      }
    }
    return killed
  }

  /** Advance the load generation counter (called on renderer reload). */
  advanceGeneration(): number {
    return advanceLocalPtyGeneration()
  }

  /** Get a writable reference to a PTY (for runtime controller). */
  getPtyProcess(id: string): pty.IPty | undefined {
    return ptyProcesses.get(id)
  }

  /** Kill all in-process local PTYs. Call on app quit. */
  killAll(): void {
    cancelAllPendingLocalPtySpawns()
    for (const [id, proc] of ptyProcesses) {
      runPtyCleanup(id)
      disposePtyListeners(id)
      disposePtyExitListener(id)
      if (!(process.platform === 'win32' && ptyTerminationMode.has(id))) {
        try {
          proc.kill()
        } catch {
          /* Process may already be dead. */
        }
      }
      // Why: app quit can't retain NAPI callbacks into FreeEnvironment; process exit is the final handle boundary here.
      destroyPtyProcess(proc, { alreadyKilled: true })
      // Why: app quit replaces node-pty's onExit as final owner; overlapping shutdown waiters must join this boundary.
      ptyPhysicalExits.get(id)?.markExited()
      clearPtyState(id)
    }
  }
}
export function _resetLocalPtyProviderStateForTest(): void {
  cancelAllPendingLocalPtySpawns()
  pendingLocalPtySpawns.clear()
  for (const id of ptyProcesses.keys()) {
    clearPtyState(id)
  }
  resetLocalPtyGeneration()
}
