import { randomUUID } from 'node:crypto'
import { PtyHandlerStage4 } from './pty-session-stage-4'
import {
  disposeManagedPty,
  IMMEDIATE_PTY_EXIT_TIMEOUT_MS,
  PTY_FORCE_KILL_MAX_ATTEMPTS,
  PTY_FORCE_KILL_RETRY_DELAY_MS,
  REPLAY_BUFFER_MAX,
  sanitizeEnvToDelete,
  type SerializedPtyEntry
} from './pty-session-stage-contracts'
import { resolveDefaultShell } from './pty-shell-utils'
import { getRelayShellLaunchConfig } from './pty-shell-launch'
import { gitCredentialPromptGuardEnv } from '../shared/git-credential-prompt-env'
import { resolvePtyOwnerBackend } from '../shared/pty-owner-backend'
import { RecentPtyOutputBuffer } from '../main/runtime/recent-pty-output-buffer'
import type { ManagedPty } from './pty-session-stage-contracts'

export {
  IMMEDIATE_PTY_EXIT_TIMEOUT_MS,
  MAX_RELAY_PTY_SESSIONS,
  REPLAY_BUFFER_MAX,
  attachIdentityMismatches,
  formatNodePtyUnavailableMessage
} from './pty-session-stage-contracts'
export type {
  PtyEnvAugmenter,
  PtyExitListener,
  RelayPtyWorktreeRemovalCoordinator
} from './pty-session-stage-contracts'

export class PtyHandler extends PtyHandlerStage4 {
  protected async reviveEntry(entry: SerializedPtyEntry): Promise<void> {
    const ptyMod = await this.loadPty()
    if (!ptyMod) {
      return
    }
    // Why: pane identity comes from the serialized entry (not env) since hook scripts exit without ORCA_PANE_KEY.
    const revivedEnv: Record<string, string> = {}
    if (entry.paneKey) {
      revivedEnv.ORCA_PANE_KEY = entry.paneKey
    }
    if (entry.tabId) {
      revivedEnv.ORCA_TAB_ID = entry.tabId
    }
    if (entry.worktreeId) {
      revivedEnv.ORCA_WORKTREE_ID = entry.worktreeId
    }
    if (entry.terminalHandle) {
      revivedEnv.ORCA_TERMINAL_HANDLE = entry.terminalHandle
    }
    const explicitTerm =
      typeof entry.explicitTerm === 'string' && entry.explicitTerm.length > 0
        ? entry.explicitTerm
        : undefined
    if (explicitTerm !== undefined) {
      revivedEnv.TERM = explicitTerm
    }
    // Why: serialized state may come from an older/untrusted client; reapply fresh-spawn bounds.
    const envToDelete = sanitizeEnvToDelete(entry.envToDelete)
    const shell = resolveDefaultShell()
    const spawnEnv = this.buildSpawnEnv(
      revivedEnv,
      { id: entry.id, paneKey: entry.paneKey, shell },
      envToDelete
    )
    // Why: revive lacks the original launch command, so reuse the fresh-spawn guard decision (legacy defaults to unguarded).
    const gitCredentialPromptGuarded = entry.gitCredentialPromptGuarded === true
    if (gitCredentialPromptGuarded) {
      Object.assign(spawnEnv, gitCredentialPromptGuardEnv(spawnEnv, process.platform))
    }
    const shellLaunch = getRelayShellLaunchConfig(shell, spawnEnv)
    const term = ptyMod.spawn(shell, shellLaunch.args, {
      name: spawnEnv.TERM ?? 'xterm-256color',
      cols: entry.cols,
      rows: entry.rows,
      cwd: entry.cwd,
      // Why: no provider-delivered command is waiting for a ready marker.
      env: { ...spawnEnv, ORCA_SHELL_READY_MARKER: '0', ...shellLaunch.env }
    })
    this.wireAndStore({
      id: entry.id,
      incarnationId: randomUUID(),
      pty: term,
      initialCwd: entry.cwd,
      buffered: new RecentPtyOutputBuffer({
        preserveChunkBoundaries: false,
        limit: REPLAY_BUFFER_MAX
      }),
      paneKey: entry.paneKey,
      tabId: entry.tabId,
      attachIdentity: entry.attachIdentity,
      worktreeId: entry.worktreeId,
      ...(explicitTerm !== undefined ? { explicitTerm } : {}),
      envToDelete,
      gitCredentialPromptGuarded,
      ownerBackend: resolvePtyOwnerBackend({
        platform: process.platform,
        shellPath: shell
      }),
      ...(entry.terminalHandle ? { terminalHandle: entry.terminalHandle } : {})
    })

    const match = entry.id.match(/^pty-(\d+)$/)
    if (match) {
      this.nextId = Math.max(this.nextId, Number.parseInt(match[1], 10) + 1)
    }
  }

  startGraceTimer(onExpire: () => void, timeoutMs = this.graceTimeMs): void {
    this.cancelGraceTimer()
    if (timeoutMs === 0) {
      return
    }
    // Why: connected relays keep the configured grace so live PTYs survive restarts/reconnects.
    this.graceTimer = setTimeout(() => {
      onExpire()
    }, timeoutMs)
  }

  cancelGraceTimer(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer)
      this.graceTimer = null
    }
  }

  dispose(options: { waitForPhysicalExit?: boolean } = {}): Promise<void> {
    // Why: fence synchronously before the first await so a spawn/revive can't slip past disposal and escape exit.
    this.creationFenced = true
    if (this.disposePromise) {
      return this.disposePromise
    }
    this.removeLegacyCapacityListener?.()
    this.removeLegacyCapacityListener = null
    this.agentSessionCreateOperations.clear()
    const disposePromise = this.disposePtys(options.waitForPhysicalExit !== false)
    this.disposePromise = disposePromise
    void disposePromise.catch(() => {
      // Why: clear on rejected kill so a later shutdown can retry instead of joining a rejected promise.
      if (this.disposePromise === disposePromise) {
        this.disposePromise = null
      }
    })
    return disposePromise
  }

  protected async disposePtys(waitForPhysicalExit: boolean): Promise<void> {
    this.cancelGraceTimer()
    await this.waitForPendingPtyCreations()
    for (const managed of this.ptys.values()) {
      this.releaseRelayIngress(managed)
      this.flushPtyOutput(managed.id)
    }
    if (this.outputFlushTimer !== null) {
      clearTimeout(this.outputFlushTimer)
      this.outputFlushTimer = null
    }
    this.pendingOutputByPty.clear()
    this.pendingExitByPty.clear()
    this.pausedOutputPtys.clear()
    this.consumerPausedOutputPtys.clear()
    this.lastInputAtByPty.clear()
    this.interactiveOutputCharsByPty.clear()
    this.sourcePublication?.dispose()
    this.sourcePublication = null
    const results = await Promise.allSettled(
      [...this.ptys.values()].map((managed) =>
        this.disposePtyForRelayShutdown(managed, waitForPhysicalExit)
      )
    )
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
    if (rejected) {
      throw rejected.reason
    }
  }

  protected async disposePtyForRelayShutdown(
    managed: ManagedPty,
    waitForPhysicalExit: boolean
  ): Promise<void> {
    if (managed.killTimer) {
      clearTimeout(managed.killTimer)
      managed.killTimer = undefined
    }
    this.clearStartupCommandTimer(managed)
    this.releaseRelayIngress(managed)
    // Why: retain the native owner until SIGKILL is accepted (one bounded retry) or onExit proves it gone.
    await this.requestForceKillForRelayShutdown(managed)
    if (waitForPhysicalExit && this.ptys.get(managed.id) === managed && !managed.disposed) {
      try {
        await this.waitForPhysicalExit(managed, IMMEDIATE_PTY_EXIT_TIMEOUT_MS)
      } catch {
        // An accepted SIGKILL is the final boundary when an uninterruptible child can't report exit.
      }
    }
    if (this.ptys.get(managed.id) === managed && !managed.disposed) {
      this.notifyExitListener(managed)
      this.agentSessionOwners.release(managed.id)
      disposeManagedPty(managed)
      this.ptys.delete(managed.id)
      this.clearPtyFlowState(managed.id)
    }
  }

  protected async requestForceKillForRelayShutdown(managed: ManagedPty): Promise<void> {
    let lastError: unknown
    for (let attempt = 0; attempt < PTY_FORCE_KILL_MAX_ATTEMPTS; attempt++) {
      if (this.ptys.get(managed.id) !== managed || managed.disposed) {
        return
      }
      try {
        this.requestForceKill(managed)
        return
      } catch (error) {
        lastError = error
      }
      if (attempt + 1 < PTY_FORCE_KILL_MAX_ATTEMPTS) {
        const tracker = managed.physicalExit
        if (!tracker) {
          throw lastError
        }
        try {
          await tracker.waitForExit(
            PTY_FORCE_KILL_RETRY_DELAY_MS,
            () => new Error(`Retrying force-kill for PTY ${managed.id}`)
          )
          return
        } catch {
          // The bounded waiter detached; retry the still-owned native handle.
        }
      }
    }
    throw lastError
  }

  get activePtyCount(): number {
    return this.ptys.size
  }

  get retainedStartupCommandCount(): number {
    let count = 0
    for (const managed of this.ptys.values()) {
      if (managed.startupCommand) {
        count += 1
      }
    }
    return count
  }

  get graceTimerActive(): boolean {
    return this.graceTimer !== null
  }
}
