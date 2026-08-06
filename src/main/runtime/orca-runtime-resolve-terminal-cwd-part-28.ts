import { RECENT_PTY_OUTPUT_LIMIT, appendRecentPtyPathCandidates, recentTerminalOutputIncludesPath, recentTerminalPathCandidatesIncludePath, Notification, resolveLocalProjectRuntimeForWorktreeId, type ProjectExecutionRuntimeResolution, type ReplayableMobileNotification, type CommitMessageAgentEnvironmentResolvers, type RuntimePtyWorktreeRecord, type MobileNotificationEvent } from './orca-runtime-symbols'
import { OrcaRuntimeReadHeadlessVisibleTerminalStatePart27 } from './orca-runtime-read-headless-visible-terminal-state-part-27'

export class OrcaRuntimeResolveTerminalCwdPart28 extends OrcaRuntimeReadHeadlessVisibleTerminalStatePart27 {
  async resolveTerminalCwd(handle: string): Promise<string | null> {
    const ptyId = this.resolveLeafForHandle(handle)?.ptyId
    if (!ptyId) {
      return null
    }
    const tracked = this.terminalCwdByPtyId.get(ptyId)
    if (tracked) {
      return tracked
    }
    try {
      const cwd = await this.ptyController?.getCwd?.(ptyId)
      return cwd && cwd.trim().length > 0 ? cwd : null
    } catch {
      return null
    }
  }
  resolveTerminalFileUriHostname(handle: string): string | null {
    const ptyId = this.resolveLeafForHandle(handle)?.ptyId
    return ptyId ? (this.terminalFileUriHostnameByPtyId.get(ptyId) ?? null) : null
  }
  protected recordRecentPtyOutputForPathProvenance(ptyId: string, data: string): void {
    // Boundaries are only owed to the one-time activation backfill; once
    // tracking is live, new buffers keep the read-collapsing hot path.
    const recentOutputBuffer = this.terminalOutputState.getOrCreateRecent(
      ptyId,
      !this.recentPtyPathCandidateTrackingActive
    )
    recentOutputBuffer.append(data)
    if (
      this.recentPtyPathCandidateTrackingActive ||
      // Why: an over-window chunk is stored pre-sliced, so activation backfill
      // could never replay its original text. Extract while intact; oversized
      // chunks are rare, so the desktop-only gate still skips the hot path.
      data.length > RECENT_PTY_OUTPUT_LIMIT
    ) {
      this.recentPtyPathCandidatesById.set(
        ptyId,
        appendRecentPtyPathCandidates(this.recentPtyPathCandidatesById.get(ptyId), data)
      )
    }
  }
  activateRecentPtyPathCandidateTracking(): void {
    if (this.recentPtyPathCandidateTrackingActive) {
      return
    }
    this.recentPtyPathCandidateTrackingActive = true
    // Why: synchronous backfill from the retained raw windows so a file tap
    // right after first mobile connect resolves exactly as before the gate.
    // Replay each retained chunk in its original full form: joining or
    // trimming chunks would change the candidate set (e.g. a window cut can
    // shorten an over-4KiB line under the extractor's line guard, minting
    // candidates the eager extractor rejected).
    // Accepted best-effort loss: output that scrolled past the raw window
    // before the first-ever connect no longer yields candidates.
    for (const [ptyId, buffer] of this.terminalOutputState.entries()) {
      let candidates = this.recentPtyPathCandidatesById.get(ptyId)
      const { chunks, headChunkIsPartial } = buffer.retainedChunks()
      for (let index = 0; index < chunks.length; index += 1) {
        if (index === 0 && headChunkIsPartial) {
          // A pre-sliced over-window chunk was already extracted eagerly at
          // append time (while its original text was intact); replaying its
          // truncated remainder would mint or drop candidates spuriously.
          continue
        }
        candidates = appendRecentPtyPathCandidates(candidates, chunks[index]!)
      }
      if (candidates) {
        this.recentPtyPathCandidatesById.set(ptyId, candidates)
      }
      // Chunk boundaries were owed only to this one-time backfill; return
      // the buffer to the compact read-collapsing steady state.
      buffer.compact()
    }
  }
  resolveTerminalContext(
    handle: string
  ): { worktreeId: string; connectionId: string | null } | null {
    const ptyId = this.resolveLeafForHandle(handle)?.ptyId
    const pty = ptyId ? this.ptysById.get(ptyId) : null
    return pty ? { worktreeId: pty.worktreeId, connectionId: pty.connectionId } : null
  }

  // Why: remote clients cannot resolve this runtime's WSL project preference,
  // so host-affecting RPCs (skill discovery) resolve it from the owning store.
  resolveProjectRuntimeForWorktree(
    worktreeId: string | null | undefined
  ): ProjectExecutionRuntimeResolution | undefined {
    return this.store && worktreeId
      ? resolveLocalProjectRuntimeForWorktreeId(this.requireStore(), worktreeId)
      : undefined
  }
  hasRecentTerminalOutputPath(handle: string, pathText: string, absolutePath: string): boolean {
    // Why: safety net for any query path that never saw a mobile onReady —
    // lazily backfill so the answer matches pre-gate behavior.
    if (!this.recentPtyPathCandidateTrackingActive) {
      this.activateRecentPtyPathCandidateTracking()
    }
    const ptyId = this.resolveLeafForHandle(handle)?.ptyId
    const recentOutput = ptyId ? this.terminalOutputState.getRecent(ptyId)?.read() : null
    if (recentOutput && recentTerminalOutputIncludesPath(recentOutput, pathText, absolutePath)) {
      return true
    }
    const candidates = ptyId ? this.recentPtyPathCandidatesById.get(ptyId) : null
    return candidates
      ? recentTerminalPathCandidatesIncludePath(candidates, pathText, absolutePath)
      : false
  }
  registerSubscriptionCleanup(
    subscriptionId: string,
    cleanup: () => void | Promise<void>,
    connectionId?: string
  ): void {
    // Why: mobile clients reconnect frequently (phone lock, network switch).
    // The RPC client re-sends terminal.subscribe on reconnect, creating a new
    // handler before the old one is cleaned up. Without this, the old data
    // listener leaks in dataListeners and duplicates every PTY data event.
    const existing = this.subscriptionCleanups.get(subscriptionId)
    if (existing) {
      // Why: the stable id is about to belong to a newer connection; detach
      // the old owner before its asynchronous cleanup can overlap the rebind.
      this.removeSubscriptionConnectionIndex(subscriptionId)
      this.cleanupSubscription(subscriptionId)
    }
    this.subscriptionCleanups.set(subscriptionId, cleanup)
    if (connectionId) {
      let set = this.subscriptionsByConnection.get(connectionId)
      if (!set) {
        set = new Set()
        this.subscriptionsByConnection.set(connectionId, set)
      }
      set.add(subscriptionId)
      this.subscriptionConnectionByEntry.set(subscriptionId, connectionId)
    }
  }
  cleanupSubscription(subscriptionId: string): void {
    void this.cleanupSubscriptionAndWait(subscriptionId).catch((error) => {
      console.error(`[runtime] subscription cleanup failed for ${subscriptionId}:`, error)
    })
  }
  retrySubscriptionCleanupAfter(
    subscriptionId: string,
    cleanupOwner: () => void | Promise<void>,
    gate: Promise<void>
  ): void {
    const failedGeneration = this.subscriptionCleanupPromises.get(subscriptionId)
    void gate.then(
      async () => {
        await (failedGeneration?.cleanup === cleanupOwner
          ? failedGeneration.promise.catch(() => undefined)
          : undefined)
        while (this.subscriptionCleanups.get(subscriptionId) === cleanupOwner) {
          const newerGeneration = this.subscriptionCleanupPromises.get(subscriptionId)
          if (newerGeneration?.cleanup === cleanupOwner) {
            // Why: a caller may already be retrying this owner; wait for that
            // exact generation so a rejected join cannot consume our retry.
            await newerGeneration.promise.catch(() => undefined)
            continue
          }
          this.cleanupSubscription(subscriptionId)
          return
        }
      },
      () => undefined
    )
  }
  async cleanupSubscriptionAndWait(subscriptionId: string): Promise<void> {
    const cleanup = this.subscriptionCleanups.get(subscriptionId)
    if (!cleanup) {
      return
    }
    const inFlight = this.subscriptionCleanupPromises.get(subscriptionId)
    if (inFlight?.cleanup === cleanup) {
      return inFlight.promise
    }
    let cleanupResult: void | Promise<void>
    try {
      cleanupResult = cleanup()
    } catch (error) {
      cleanupResult = Promise.reject(error)
    }
    const promise = Promise.resolve(cleanupResult)
      .then(() => {
        // Why: a reconnect can replace this id while old async cleanup runs;
        // only the generation that registered this callback may remove it.
        if (this.subscriptionCleanups.get(subscriptionId) !== cleanup) {
          return
        }
        this.subscriptionCleanups.delete(subscriptionId)
        this.removeSubscriptionConnectionIndex(subscriptionId)
      })
      .finally(() => {
        if (this.subscriptionCleanupPromises.get(subscriptionId)?.promise === promise) {
          this.subscriptionCleanupPromises.delete(subscriptionId)
        }
      })
    this.subscriptionCleanupPromises.set(subscriptionId, { cleanup, promise })
    return promise
  }
  protected removeSubscriptionConnectionIndex(subscriptionId: string): void {
    const connectionId = this.subscriptionConnectionByEntry.get(subscriptionId)
    if (connectionId) {
      this.subscriptionConnectionByEntry.delete(subscriptionId)
      const set = this.subscriptionsByConnection.get(connectionId)
      if (set) {
        set.delete(subscriptionId)
        if (set.size === 0) {
          this.subscriptionsByConnection.delete(connectionId)
        }
      }
    }
  }
  cleanupSubscriptionsByPrefix(prefix: string): void {
    const ids = Array.from(this.subscriptionCleanups.keys()).filter((id) => id.startsWith(prefix))
    for (const id of ids) {
      this.cleanupSubscription(id)
    }
  }

  // Why: invoked from the WebSocket transport's on-close hook so streaming
  // listeners registered for this exact socket get torn down even when other
  // sockets sharing the same deviceToken are still alive (multi-screen
  // mobile). Without this sweep, listeners leak across every reconnect.
  cleanupSubscriptionsForConnection(connectionId: string): void {
    const set = this.subscriptionsByConnection.get(connectionId)
    if (!set) {
      return
    }
    // Why: snapshot the ids before iterating because cleanupSubscription
    // mutates both the set and the index map.
    const ids = Array.from(set)
    for (const id of ids) {
      if (this.subscriptionConnectionByEntry.get(id) !== connectionId) {
        set.delete(id)
        continue
      }
      this.cleanupSubscription(id)
    }
    if (set.size === 0) {
      this.subscriptionsByConnection.delete(connectionId)
    }
  }

  // Why: mobile clients subscribe via notifications.subscribe streaming RPC.
  // Each subscriber gets its own listener. Returns an unsubscribe function
  // that the subscription cleanup mechanism calls on disconnect.
  onNotificationDispatched(listener: (event: MobileNotificationEvent) => void): () => void {
    return this.notificationRegistry.subscribe(listener)
  }
  getMobileNotificationListenerCount(): number {
    return this.notificationRegistry.listenerCount
  }

  // Why: bounded replay buffer for the mobile reconnect catch-up (#8129).
  // Every dispatched notification is recorded with a monotonic seq so a
  // reconnecting client can fetch exactly the events it missed. Kept on the
  // service instance (not per-client) because the buffer is a global,
  // idempotent-by-seq source of truth; clients watermark their own position.
  dispatchMobileNotification(event: MobileNotificationEvent): void {
    this.notificationRegistry.dispatch(event)
  }

  // Returns notifications dispatched after lastSeenSeq. Idempotent: the same
  // watermark always yields the same set, so a client cannot be re-pushed an
  // already-delivered event (the adversarial-review gate for #8129).
  getMissedNotificationsSince(lastSeenSeq: number, epoch?: string): ReplayableMobileNotification[] {
    return this.notificationRegistry.missedSince(lastSeenSeq, epoch)
  }

  // Why (#8591): the seq counter is per-process and restarts at 0 on every desktop
  // launch, but the client's watermark is persisted. Clients need the epoch to tell
  // a stale watermark from a valid one — see MobileNotificationReplayBuffer.
  getMobileNotificationEpoch(): string {
    return this.notificationRegistry.epoch
  }
  dismissMobileNotification(notificationId: string): void {
    this.dispatchMobileNotification({ type: 'dismiss', notificationId })
  }

  /** Plugin panel action notifications.show. Native on desktop, relayed to
   *  paired mobile clients either way (mirrors notifications:dispatch). */
  async dispatchPluginNotification(input: {
    pluginId: string
    title: string
    body?: string
  }): Promise<{ delivered: boolean }> {
    // Why: prefix with the plugin id so a plugin cannot spoof an Orca system
    // notification or impersonate another plugin.
    const title = `${input.pluginId}: ${input.title}`
    const body = input.body ?? ''
    let delivered = false
    try {
      if (Notification.isSupported()) {
        new Notification({ title, body }).show()
        delivered = true
      }
    } catch {
      // Headless serve has no notification display; the mobile relay below
      // still runs.
    }
    this.dispatchMobileNotification({ type: 'notification', source: 'plugin', title, body })
    return { delivered }
  }

  setCommitMessageAgentEnvironmentResolvers(
    resolvers: CommitMessageAgentEnvironmentResolvers
  ): void {
    this.commitMessageAgentEnv = resolvers
  }
}
