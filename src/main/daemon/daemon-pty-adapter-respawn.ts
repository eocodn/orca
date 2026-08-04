import { getMacDaemonSystemResolverHealth } from './daemon-health'
import { supportsMode2031UnsubscribeFact, type DaemonEvent, type ListSessionsResult } from './types'
import type { IPtyProvider, PtyBackgroundStreamEvent } from '../providers/types'


import type { DaemonRespawnReason } from './daemon-pty-adapter-foundation'
import { DaemonPtyAdapterPhase5 } from './daemon-pty-adapter-events'

export class DaemonPtyAdapterPhase6 extends DaemonPtyAdapterPhase5 implements IPtyProvider {
  protected reconnectAfterWriteFailure(): void {
    if (
      this.writeRecoveryPromise ||
      this.writeRecoveryAttempted ||
      this.respawnAdoptionClosed ||
      !this.respawnFn
    ) {
      return
    }
    this.writeRecoveryAttempted = true
    // Why: the dead endpoint took down every session on this daemon. Signal all
    // active panes now — while they are still in activeSessionIds, so the
    // renderer's liveness gate still reads them live — so background panes
    // remount + re-attach alongside the one that was written, instead of being
    // left frozen with silently dropped input until each is typed into.
    this.notifyActiveSessionsWriteUnavailable()
    const recovery = this.withDaemonRetry(() => this.ensureConnected())
      .catch((error) => console.warn('[daemon] Failed to recover after rejected PTY input:', error))
      .finally(() => {
        this.releasePendingRespawnAdoptionLease()
        if (this.writeRecoveryPromise === recovery) {
          this.writeRecoveryPromise = null
        }
      })
    this.writeRecoveryPromise = recovery
  }

  protected notifyActiveSessionsWriteUnavailable(): void {
    // Snapshot first: a listener that kills a pane would mutate activeSessionIds
    // mid-iteration and silently skip the sibling this fan-out exists to reach.
    const ids = [...this.activeSessionIds]
    for (const id of ids) {
      this.sessionsAwaitingDaemonRecovery.add(id)
      this.emitWriteUnavailable(id)
    }
  }

  protected clearSessionAwaitingDaemonRecovery(sessionId: string): void {
    this.sessionsAwaitingDaemonRecovery.delete(sessionId)
    if (this.sessionsAwaitingDaemonRecovery.size === 0) {
      this.writeRecoveryAttempted = false
    }
  }

  protected async withHistorySpawnLock<T>(
    sessionId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    if (!this.historyManager) {
      return await operation()
    }
    const previous = this.historySpawnLocks.get(sessionId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(
      () => current,
      () => current
    )
    this.historySpawnLocks.set(sessionId, tail)
    await previous.catch(() => {})
    try {
      return await operation()
    } finally {
      release()
      if (this.historySpawnLocks.get(sessionId) === tail) {
        this.historySpawnLocks.delete(sessionId)
      }
    }
  }

  protected async replaceUnhealthyMacResolverDaemonBeforeNewPty(): Promise<void> {
    if (!this.respawnFn) {
      return
    }

    const health = await getMacDaemonSystemResolverHealth(
      this.socketPath,
      this.tokenPath,
      this.protocolVersion
    )
    if (health !== 'unhealthy') {
      return
    }

    const daemonLiveSessionCount = await this.getDaemonLiveSessionCount()
    const liveSessionCount = Math.max(this.activeSessionIds.size, daemonLiveSessionCount ?? 0)
    if (daemonLiveSessionCount === null || liveSessionCount > 0) {
      console.warn(
        daemonLiveSessionCount === null
          ? '[daemon] macOS system resolver unavailable - preserving daemon because live session state could not be verified'
          : `[daemon] macOS system resolver unavailable - preserving daemon because it owns ${liveSessionCount} live session${liveSessionCount === 1 ? '' : 's'}`
      )
      return
    }

    // Why: replacing the daemon kills its sessions without exit fanout; emit exits first so panes don't write to dead PTYs.
    this.fanoutSyntheticExits(-1)
    if (!this.respawnPromise) {
      this.respawnPromise = this.doRespawn(
        '[daemon] macOS system resolver unavailable - respawning daemon',
        'unhealthy_resolver'
      ).finally(() => {
        this.respawnPromise = null
      })
    }
    await this.respawnPromise
  }

  protected async getDaemonLiveSessionCount(): Promise<number | null> {
    try {
      await this.client.ensureConnected()
      const result = await this.client.request<ListSessionsResult>('listSessions', undefined)
      return result.sessions.filter((session) => session.isAlive).length
    } catch {
      return null
    }
  }

  protected emitBackgroundStreamEvent(payload: PtyBackgroundStreamEvent): void {
    // oxlint-disable-next-line unicorn/no-useless-spread -- copy-safe: listeners may unsubscribe during iteration
    for (const listener of [...this.backgroundStreamListeners]) {
      listener(payload)
    }
  }

  protected async doRespawn(
    message = '[daemon] Daemon died — respawning',
    reason: DaemonRespawnReason = 'daemon_died'
  ): Promise<void> {
    console.warn(message)
    this.removeEventListener?.()
    this.removeEventListener = null
    this.client.disconnect()
    const releaseAdoptionLease = await this.respawnFn!(reason)
    if (this.respawnAdoptionClosed) {
      // Why: app teardown may win mid-respawn; a late result must not reinstall a lease nobody owns.
      releaseAdoptionLease?.()
      throw new Error('Daemon adapter closed during respawn')
    }
    this.pendingRespawnAdoptionRelease = releaseAdoptionLease ?? null
  }

  protected releasePendingRespawnAdoptionLease(): void {
    const release = this.pendingRespawnAdoptionRelease
    this.pendingRespawnAdoptionRelease = null
    release?.()
  }

  protected setupEventRouting(): void {
    if (this.removeEventListener) {
      return
    }

    this.removeEventListener = this.client.onEvent((raw) => {
      const event = raw as DaemonEvent
      if (event.type !== 'event') {
        return
      }

      if (event.event === 'data') {
        if (!event.payload.incarnationId) {
          return
        }
        this.markSessionDirty(event.sessionId)
        // oxlint-disable-next-line unicorn/no-useless-spread -- copy-safe: listeners may unsubscribe during iteration
        for (const listener of [...this.dataListeners]) {
          listener({
            id: event.sessionId,
            incarnationId: event.payload.incarnationId,
            data: event.payload.data,
            ...((event.payload.rawLength ?? event.payload.sequenceChars) === undefined
              ? {}
              : { sequenceChars: event.payload.rawLength ?? event.payload.sequenceChars }),
            ...(event.payload.transformed ? { transformed: true } : {}),
            ...(event.payload.seq === undefined ? {} : { seq: event.payload.seq })
          })
        }
      } else if (event.event === 'sessionBackgroundMarker') {
        this.emitBackgroundStreamEvent({
          id: event.sessionId,
          kind: 'backgroundMarker',
          background: event.payload.background,
          ...(event.payload.scanSeedAnsi !== undefined
            ? { scanSeedAnsi: event.payload.scanSeedAnsi }
            : {}),
          ...(event.payload.mode2031PendingSubscribe
            ? { mode2031PendingSubscribe: true as const }
            : {})
        })
      } else if (event.event === 'dataGap') {
        this.emitBackgroundStreamEvent({
          id: event.sessionId,
          kind: 'dataGap',
          droppedChars: event.payload.droppedChars,
          ...(event.payload.sequenceChars === undefined
            ? {}
            : { sequenceChars: event.payload.sequenceChars })
        })
      } else if (event.event === 'transientFact') {
        // Why (#9993): belt-and-braces behind the setPtyBackgrounded gate. A pre-v29
        // daemon is never asked to background, so it should emit no transient facts at
        // all — but one preserved across a reconnect could still have a stale relay
        // tracker. An unretractable subscribe is the harmful direction, so drop it.
        // An unsubscribe is always forwarded: retiring a subscription main registered
        // can only ever help, never strand one.
        if (
          event.payload.kind === '2031-subscribe' &&
          !supportsMode2031UnsubscribeFact(this.protocolVersion)
        ) {
          return
        }
        this.emitBackgroundStreamEvent({
          id: event.sessionId,
          kind: 'transientFact',
          fact: event.payload
        })
      } else if (event.event === 'exit') {
        const pendingOperations = new Set([
          ...(this.pendingSpawnOperationsBySessionId.get(event.sessionId) ?? []),
          ...this.pendingClaimSpawnOperations
        ])
        for (const operation of pendingOperations) {
          if (operation.ignoreNextExit) {
            operation.ignoreNextExit = false
            continue
          }
          const exits = operation.exitsBySessionId.get(event.sessionId) ?? []
          exits.push(
            event.payload.incarnationId ? { incarnationId: event.payload.incarnationId } : {}
          )
          operation.exitsBySessionId.set(event.sessionId, exits)
        }
        const currentIncarnationId = this.sessionIncarnations.get(event.sessionId)
        if (
          event.payload.incarnationId &&
          currentIncarnationId &&
          event.payload.incarnationId !== currentIncarnationId
        ) {
          return
        }
        this.activeSessionIds.delete(event.sessionId)
        this.clearSessionAwaitingDaemonRecovery(event.sessionId)
        this.dirtySessionVersions.delete(event.sessionId)
        // Why: a reused sessionId must not inherit the dead session's owed resume (stray resumePty) or backgrounded/thinned state.
        this.pausedProducerSessionIds.delete(event.sessionId)
        this.producerResumesOwedOnReconnect.delete(event.sessionId)
        this.backgroundedSessionIds.delete(event.sessionId)
        if (!this.sleepRestoreSessionIds.has(event.sessionId)) {
          this.coldRestoreCache.delete(event.sessionId)
        }
        // Why: an exited session can't be checkpointed again; clearing its pending-full flag prevents a permanent leak.
        this.sessionsNeedingFullCheckpoint.delete(event.sessionId)
        // Why: a reused sessionId (renderer respawns a persisted ptyId) must not inherit the dead session's snapshot cooldown.
        this.lastFullCheckpointAt.delete(event.sessionId)
        this.stopCheckpointTimerIfIdle()
        if (this.historyManager) {
          void this.historyManager
            .closeSession(event.sessionId, event.payload.code)
            .catch((err) => console.warn('[history] closeSession failed:', event.sessionId, err))
        }
        this.initialCwds.delete(event.sessionId)
        this.wslDistrosBySessionId.delete(event.sessionId)
        this.sessionIncarnations.delete(event.sessionId)
        // oxlint-disable-next-line unicorn/no-useless-spread -- copy-safe: listeners may unsubscribe during iteration
        for (const listener of [...this.exitListeners]) {
          listener({
            id: event.sessionId,
            code: event.payload.code,
            ...(event.payload.incarnationId ? { incarnationId: event.payload.incarnationId } : {})
          })
        }
      }
    })
  }

  async closeStartupQueryAuthority(id: string): Promise<number> {
    if (!this.supportsStartupIngress) {
      return 0
    }
    const result = await this.client.request<{ appliedSeq: number }>('closeStartupQueryAuthority', {
      sessionId: id
    })
    return result.appliedSeq
  }
}
