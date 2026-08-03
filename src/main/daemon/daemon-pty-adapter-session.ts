import { parseDaemonResizeIfCurrentResponse } from './daemon-pty-resize-response'
import { type ColdRestoreInfo } from './history-reader'
import { type CreateOrAttachResult } from './types'
import type { PtySpawnResult } from '../providers/types'
import { normalizeWslColdRestoreCwd } from './wsl-cold-restore-cwd'
import { resolveSafePtyDefaultCwd } from '../providers/pty-default-cwd'
import { PtyWriteUnavailableError } from '../providers/pty-write-unavailable-error'
import { type ColdRestorePayload } from './cold-restore-payload-cache'


import { type PendingDaemonSpawnOperation, MAX_TOMBSTONES, remainingRequestTimeoutMs } from './daemon-pty-adapter-foundation'
import { DaemonPtyAdapterPhase1 } from './daemon-pty-adapter-creation'

export class DaemonPtyAdapterPhase2 extends DaemonPtyAdapterPhase1 {
  protected resultForExitBeforeSpawnReply(
    sessionId: string,
    result: CreateOrAttachResult,
    operation: PendingDaemonSpawnOperation
  ): PtySpawnResult | null {
    const matchingExit = (operation.exitsBySessionId.get(sessionId) ?? []).some(
      (exit) =>
        !(exit.incarnationId && operation.ignoredExitIncarnationIds.has(exit.incarnationId)) &&
        (!exit.incarnationId ||
          !result.incarnationId ||
          exit.incarnationId === result.incarnationId)
    )
    if (!matchingExit) {
      return null
    }
    // Why: stream exit can beat the control reply; return proof upward without republishing dead adapter state.
    const exitedResult: PtySpawnResult = {
      id: sessionId,
      exitedBeforeSpawnReply: true,
      ...(result.incarnationId ? { incarnationId: result.incarnationId } : {}),
      ...(result.agentSessionEnsure ? { agentSessionEnsure: result.agentSessionEnsure } : {}),
      ...(!result.isNew ? { isReattach: true } : {})
    }
    return exitedResult
  }

  didExitBeforeSpawnReply(result: PtySpawnResult): boolean {
    return result.exitedBeforeSpawnReply === true
  }

  async attach(id: string): Promise<void> {
    await this.ensureConnected()
    if (!this.canDelegateBackgroundToDaemon) {
      this.setPtyBackgrounded(id, false)
    }

    await this.client.request<CreateOrAttachResult>('createOrAttach', {
      sessionId: id,
      cols: 80,
      rows: 24
    })
    this.clearSessionAwaitingDaemonRecovery(id)
  }

  hasPty(id: string): boolean {
    return this.activeSessionIds.has(id)
  }

  async probePtyLiveness(id: string): Promise<boolean | null> {
    try {
      const result = await this.client.request<{ size: { cols: number; rows: number } | null }>(
        'getSize',
        { sessionId: id }
      )
      return result.size !== null
    } catch {
      return null
    }
  }

  write(id: string, data: string): void {
    this.markSessionDirty(id)
    // Why recoverable and not just active: rejecting a write asks the pane to remount,
    // which only helps if this endpoint can come back. A legacy adapter has no respawn,
    // so its reattach fails and the pane rebuilds empty — losing scrollback the user
    // could still read. Keep the pre-existing silent drop for those.
    const recoverable =
      this.activeSessionIds.has(id) && !this.respawnAdoptionClosed && Boolean(this.respawnFn)
    if (
      recoverable &&
      (this.sessionsAwaitingDaemonRecovery.has(id) || !this.client.isConnected())
    ) {
      this.sessionsAwaitingDaemonRecovery.add(id)
      this.reconnectAfterWriteFailure()
      throw new PtyWriteUnavailableError(`Daemon PTY "${id}" is awaiting recovery`)
    }
    const delivered = this.client.notify('write', { sessionId: id, data })
    if (!delivered && recoverable) {
      this.sessionsAwaitingDaemonRecovery.add(id)
      this.reconnectAfterWriteFailure()
      throw new PtyWriteUnavailableError(`Daemon PTY "${id}" is awaiting recovery`)
    }
  }

  resize(id: string, cols: number, rows: number): void {
    this.markSessionDirty(id)
    this.client.notify('resize', { sessionId: id, cols, rows })
  }

  async resizeIfCurrent(
    id: string,
    expectedIncarnationId: string,
    cols: number,
    rows: number
  ): Promise<boolean> {
    const response = await this.client.request<unknown>('resizeIfCurrent', {
      sessionId: id,
      expectedIncarnationId,
      cols,
      rows
    })
    const applied = parseDaemonResizeIfCurrentResponse(response)
    if (applied) {
      this.markSessionDirty(id)
    }
    return applied
  }

  pauseProducer(id: string): void {
    if (!this.supportsProducerFlowControl) {
      return
    }
    this.pausedProducerSessionIds.add(id)
    this.client.notify('pausePty', { sessionId: id })
  }

  resumeProducer(id: string): void {
    this.producerResumesOwedOnReconnect.delete(id)
    if (!this.supportsProducerFlowControl) {
      return
    }
    this.pausedProducerSessionIds.delete(id)
    this.client.notify('resumePty', { sessionId: id })
  }

  // Why fire-and-forget (like pausePty): just a delivery hint for the daemon's keep-tail stream thinning.
  setPtyBackgrounded(id: string, background: boolean): void {
    if (!this.supportsProducerFlowControl) {
      return
    }
    // Why: preserved v19 daemons can thin but can't return the absolute snapshot sequence to recover a gap; clear their stale hint too.
    // Why also gate on 2031 (#9993): backgrounding is what hands transient-fact scan
    // authority to the daemon. A pre-v29 daemon can announce a 2031 subscribe but never
    // retract it, so a TUI exiting while hidden would strand the subscription and the
    // next theme flip would inject CSI 997 into its replacement shell. Declining to
    // background keeps main's scanner — which emits both facts — authoritative.
    const safeBackground = this.canDelegateBackgroundToDaemon && background
    if (safeBackground) {
      this.backgroundedSessionIds.add(id)
    } else {
      this.backgroundedSessionIds.delete(id)
    }
    this.client.notify('setSessionBackground', { sessionId: id, background: safeBackground })
  }

  async shutdown(
    id: string,
    opts: { immediate?: boolean; keepHistory?: boolean; deadlineMs?: number }
  ): Promise<void> {
    if (opts.keepHistory && this.disconnectOnlyPromise) {
      throw new Error('Cannot keep history after daemon disconnect has started')
    }
    const shutdown = this.withHistorySpawnLock(id, () => this.shutdownWithHistoryLock(id, opts))
    if (!opts.keepHistory) {
      await shutdown
      return
    }
    this.keepHistoryShutdowns.add(shutdown)
    try {
      await shutdown
    } finally {
      this.keepHistoryShutdowns.delete(shutdown)
    }
  }

  protected async shutdownWithHistoryLock(
    id: string,
    opts: { immediate?: boolean; keepHistory?: boolean; deadlineMs?: number }
  ): Promise<void> {
    // Why: shutdown can be the first lazy-client operation after restart; connect
    // before killing so a healthy daemon session is not orphaned (#7742). Connect
    // and kill share the caller's one absolute deadline, so a wedged handshake
    // cannot burn the whole teardown budget before the kill even starts.
    await this.ensureConnected(opts.deadlineMs)
    // Why: sleep/exact-stop kills the live PTY before the periodic checkpoint may run.
    // Force a final snapshot so wake can restore the pane users left.
    if (opts.keepHistory) {
      await this.runExclusiveCheckpoint(async () => {
        await this.checkpointSessions([id], { final: true, teardown: true })
      })
      const wslDistro = this.wslDistrosBySessionId.get(id)
      const detection = await this.historyReader?.detectColdRestoreState(id, { wslDistro })
      const detected = detection?.status === 'restored' ? detection.restoreInfo : null
      const restoreInfo = detected
        ? {
            ...detected,
            cwd:
              normalizeWslColdRestoreCwd({
                recoveredCwd: detected.cwd,
                requestedCwd: this.initialCwds.get(id) ?? resolveSafePtyDefaultCwd(),
                wslDistro
              }) ?? ''
          }
        : null
      const coldRestore = restoreInfo ? this.buildColdRestorePayload(restoreInfo) : null
      if (coldRestore) {
        this.coldRestoreCache.set(id, coldRestore)
        if (this.coldRestoreCache.has(id)) {
          this.sleepRestoreSessionIds.add(id)
        }
        // Why: physical exit must not mark intentional sleep as a clean end; the final checkpoint stays the wake-time recovery authority.
        this.historyManager?.suspendSession(id)
      } else if (
        detection?.status === 'unreadable' ||
        (detection?.status === 'restored' && detection.hasUnreadableRecovery)
      ) {
        this.historyManager?.suspendSession(id)
      }
    }
    await this.client.request(
      'kill',
      { sessionId: id, immediate: opts.immediate ?? false },
      remainingRequestTimeoutMs(opts.deadlineMs)
    )
    this.activeSessionIds.delete(id)
    this.clearSessionAwaitingDaemonRecovery(id)
    this.dirtySessionVersions.delete(id)
    if (!opts.keepHistory) {
      this.coldRestoreCache.delete(id)
      this.sleepRestoreSessionIds.delete(id)
    }
    // Why: the !keepHistory path takes no final checkpoint, so clear sessionsNeedingFullCheckpoint here or it stays stranded (no-op under keepHistory).
    this.sessionsNeedingFullCheckpoint.delete(id)
    this.lastFullCheckpointAt.delete(id)
    this.stopCheckpointTimerIfIdle()
    this.initialCwds.delete(id)
    this.wslDistrosBySessionId.delete(id)
    // Why: only remove history on explicit close; sleep also calls shutdown but wake needs the dir intact for cold restore (opts.keepHistory).
    if (this.historyManager && !opts.keepHistory) {
      await this.historyManager
        .removeSession(id)
        .catch((err) => console.warn('[history] removeSession failed:', id, err))
    }

    // Why: the tombstone rejects reattach to a user-killed session; sleep legitimately reattaches on wake, so skip it under keepHistory.
    if (!opts.keepHistory) {
      this.killedSessionTombstones.delete(id)
      this.killedSessionTombstones.set(id, Date.now())
      if (this.killedSessionTombstones.size > MAX_TOMBSTONES) {
        const oldest = this.killedSessionTombstones.keys().next().value
        if (oldest) {
          this.killedSessionTombstones.delete(oldest)
        }
      }
    }
  }

  ackColdRestore(sessionId: string): void {
    this.coldRestoreCache.delete(sessionId)
    this.sleepRestoreSessionIds.delete(sessionId)
  }

  clearTombstone(sessionId: string): void {
    this.killedSessionTombstones.delete(sessionId)
  }

  protected buildColdRestorePayload(restoreInfo: ColdRestoreInfo): ColdRestorePayload | null {
    // Why: alt-screen prefers normal scrollback, else snapshotAnsi alone — not rehydrate, which starts with \x1b[?1049h that POST_REPLAY_MODE_RESET won't undo — so a hibernated TUI's last frame isn't blank on wake.
    const scrollback = restoreInfo.modes.alternateScreen
      ? restoreInfo.scrollbackAnsi || restoreInfo.snapshotAnsi || null
      : restoreInfo.rehydrateSequences + restoreInfo.snapshotAnsi
    if (!scrollback) {
      return null
    }
    return {
      scrollback,
      cwd: restoreInfo.cwd,
      cols: restoreInfo.cols,
      rows: restoreInfo.rows,
      oscLinks: restoreInfo.oscLinks
    }
  }

  async sendSignal(id: string, signal: string): Promise<void> {
    await this.client.request('signal', { sessionId: id, signal })
  }

  async getCwd(id: string): Promise<string> {
    try {
      const result = await this.client.request<{ cwd: string | null }>('getCwd', {
        sessionId: id
      })
      return result.cwd ?? ''
    } catch {
      return ''
    }
  }

  async getInitialCwd(id: string): Promise<string> {
    return this.initialCwds.get(id) ?? ''
  }

  // Why: resize() is fire-and-forget and can be dropped daemon-side; read the actually-applied size so the renderer can detect drift and re-assert.
  async getAppliedSize(id: string): Promise<{ cols: number; rows: number } | null> {
    return this.readAppliedSize(id, false)
  }


}
