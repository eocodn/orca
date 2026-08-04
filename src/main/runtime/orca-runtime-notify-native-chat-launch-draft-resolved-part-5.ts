import { type CreateWorktreeResult, type WorktreeStartupLaunch, type WorkspaceSessionState, type ExecutionHostId, toRuntimeActivateWorktreeEvent, type SshConnectionState, getPublicSshState, HEADLESS_RUNTIME_WINDOW_ID, type RuntimeMobileSessionTerminalTab, type RuntimeMobileSessionTabsSnapshot, splitWorktreeId, parsePaneKey, type AgentBrowserBridge, type BrowserBackend, runtimeWorktreeIdsEqual, type RuntimePtyWorktreeRecord, type RuntimeWorktreeLifecycleEvent, type NativeChatLaunchDraftResolutionTombstone, MAX_NATIVE_CHAT_LAUNCH_DRAFT_RESOLUTION_TOMBSTONES } from './orca-runtime-symbols'
import { OrcaRuntimeCallOrchestrationWorkerServerPart4 } from './orca-runtime-call-orchestration-worker-server-part-4'

export class OrcaRuntimeNotifyNativeChatLaunchDraftResolvedPart5 extends OrcaRuntimeCallOrchestrationWorkerServerPart4 {
  notifyNativeChatLaunchDraftResolved(
    handle: string,
    resolution: { text: string; createdAt: number }
  ): void {
    const owner = this.resolveNativeChatLaunchDraftOwner(handle)

    if (!owner) {
      return
    }
    const tombstone = { ...owner, ...resolution }
    this.nativeChatLaunchDraftResolutionByTabId.delete(owner.tabId)
    this.nativeChatLaunchDraftResolutionByTabId.set(owner.tabId, tombstone)
    while (
      this.nativeChatLaunchDraftResolutionByTabId.size >
      MAX_NATIVE_CHAT_LAUNCH_DRAFT_RESOLUTION_TOMBSTONES
    ) {
      const oldestTabId = this.nativeChatLaunchDraftResolutionByTabId.keys().next().value
      if (typeof oldestTabId !== 'string') {
        break
      }
      this.nativeChatLaunchDraftResolutionByTabId.delete(oldestTabId)
    }
    this.retireResolvedNativeChatLaunchDraftFromMobileSnapshot(tombstone)
    this.notifier?.nativeChatLaunchDraftResolved?.(owner.tabId, resolution)
    this.emitClientEvent({
      type: 'nativeChatLaunchDraftResolved',
      tabId: owner.tabId,
      ...resolution
    })
  }
  protected resolveNativeChatLaunchDraftOwner(
    handle: string
  ): { tabId: string; worktreeId: string } | null {
    const record = this.handles.get(handle)
    if (!record) {
      return null
    }
    if (!record.tabId.startsWith('pty:')) {
      return { tabId: record.tabId, worktreeId: record.worktreeId }
    }
    const pty = record.ptyId ? this.ptysById.get(record.ptyId) : null
    const tabId =
      pty?.tabId && !pty.tabId.startsWith('pty:')
        ? pty.tabId
        : parsePaneKey(pty?.paneKey ?? '')?.tabId
    if (!pty || !tabId || tabId.startsWith('pty:')) {
      return null
    }
    return { tabId, worktreeId: pty.worktreeId }
  }
  protected retireResolvedNativeChatLaunchDraftFromMobileSnapshot(
    resolution: NativeChatLaunchDraftResolutionTombstone
  ): void {
    for (const [worktreeId, snapshot] of this.mobileSessionTabsByWorktree) {
      if (!runtimeWorktreeIdsEqual(worktreeId, resolution.worktreeId)) {
        continue
      }
      const next = this.applyNativeChatLaunchDraftResolutionFence(snapshot)
      if (next === snapshot) {
        return
      }
      this.mobileSessionTabsByWorktree.set(worktreeId, {
        ...next,
        snapshotVersion: snapshot.snapshotVersion + 1
      })
      this.mobileSessionTabsNotifyCoalescer.schedule(worktreeId)
      return
    }
  }
  protected applyNativeChatLaunchDraftResolutionFence(
    snapshot: RuntimeMobileSessionTabsSnapshot
  ): RuntimeMobileSessionTabsSnapshot {
    let changed = false
    const tabs = snapshot.tabs.map((tab) => {
      if (tab.type !== 'terminal') {
        return tab
      }
      const resolution = this.nativeChatLaunchDraftResolutionByTabId.get(tab.parentTabId)
      if (
        !resolution ||
        !runtimeWorktreeIdsEqual(snapshot.worktree, resolution.worktreeId) ||
        tab.launchDraft !== resolution.text ||
        tab.launchDraftCreatedAt !== resolution.createdAt
      ) {
        return tab
      }
      changed = true
      const next = { ...tab }
      delete next.launchDraft
      delete next.launchDraftCreatedAt
      return next
    })
    return changed ? { ...snapshot, tabs } : snapshot
  }
  protected reconcileNativeChatLaunchDraftResolutionTombstones(
    snapshot: RuntimeMobileSessionTabsSnapshot
  ): void {
    for (const [tabId, resolution] of this.nativeChatLaunchDraftResolutionByTabId) {
      if (!runtimeWorktreeIdsEqual(snapshot.worktree, resolution.worktreeId)) {
        continue
      }
      const surfaces = snapshot.tabs.filter(
        (tab): tab is RuntimeMobileSessionTerminalTab =>
          tab.type === 'terminal' && tab.parentTabId === tabId
      )
      if (
        surfaces.length === 0 ||
        !surfaces.some(
          (tab) =>
            tab.launchDraft === resolution.text && tab.launchDraftCreatedAt === resolution.createdAt
        )
      ) {
        this.nativeChatLaunchDraftResolutionByTabId.delete(tabId)
      }
    }
  }
  protected notifyWorktreesChanged(repoId: string): void {
    this.notifier?.worktreesChanged(repoId)
    this.emitClientEvent({ type: 'worktreesChanged', repoId })
  }

  /** Detail-level worktree lifecycle tap (plugin event bus). The coarse
   *  worktreesChanged client event carries only repoId, which is not enough
   *  for subscribers that need the affected worktree's identity.
   *  Removal payloads carry no branch: the removal target resolves before
   *  the git worktree is torn down and only pins id + path. */
  onWorktreeLifecycle(listener: (event: RuntimeWorktreeLifecycleEvent) => void): () => void {
    this.worktreeLifecycleListeners.add(listener)
    return () => {
      this.worktreeLifecycleListeners.delete(listener)
    }
  }
  protected emitWorktreeLifecycle(event: RuntimeWorktreeLifecycleEvent): void {
    for (const listener of this.worktreeLifecycleListeners) {
      try {
        listener(event)
      } catch (err) {
        console.error('[runtime] worktree lifecycle listener threw', err)
      }
    }
  }
  protected notifyReposChanged(): void {
    this.notifier?.reposChanged()
    this.emitClientEvent({ type: 'reposChanged' })
  }

  // Why: SSH state changes originate in main's ssh handlers, not in runtime
  // methods, so they need a public entry point onto the client-event stream.
  notifySshStateChanged(targetId: string, state: SshConnectionState): void {
    this.bumpSshRelayRecoveryGeneration(targetId)
    this.invalidateSshWorktreeScanCache(targetId)
    if (state.status !== 'connected') {
      this.cancelLegacyWorkerTerminalRecoveryRetry(`ssh:${targetId}`)
    }
    this.emitClientEvent({ type: 'sshStateChanged', targetId, state: getPublicSshState(state)! })
  }
  notifySshRelayReady(targetId: string): void {
    const generation = this.bumpSshRelayRecoveryGeneration(targetId)
    const publish = async (): Promise<void> => {
      try {
        await this.publishRecoveredSshMobileSessionTabs(targetId, generation)
      } catch (error) {
        if (this.sshRelayRecoveryGenerationByTargetId.get(targetId) === generation) {
          console.warn('[runtime] failed to publish recovered SSH session tabs', {
            targetId,
            error
          })
        }
      }
    }
    const initialPublication = publish()
    void initialPublication
    void this.refreshRestoredOrchestrationAuthority(targetId)
      .then(() =>
        this.reconcileLegacyWorkerTerminals({
          connectionId: targetId,
          materializeRenderer: this.notifier !== null
        })
      )
      .then(async () => {
        await initialPublication
        await publish()
      })
      .catch((error) => {
        if (this.sshRelayRecoveryGenerationByTargetId.get(targetId) !== generation) {
          return
        }
        console.warn('[orchestration] legacy worker reconcile failed on relay ready', {
          targetId,
          error
        })
      })
  }
  protected bumpSshRelayRecoveryGeneration(targetId: string): number {
    const generation = (this.sshRelayRecoveryGenerationByTargetId.get(targetId) ?? 0) + 1
    this.sshRelayRecoveryGenerationByTargetId.set(targetId, generation)
    return generation
  }
  protected async publishRecoveredSshMobileSessionTabs(
    targetId: string,
    generation: number
  ): Promise<void> {
    const repoIds = new Set(
      (this.store?.getRepos() ?? [])
        .filter((repo) => repo.connectionId === targetId)
        .map((repo) => repo.id)
    )
    if (repoIds.size === 0) {
      return
    }
    const worktreeIds = new Set<string>()
    for (const worktreeId of [
      ...this.getKnownWorkspaceSessionWorktreeIds(),
      ...this.mobileSessionTabsByWorktree.keys()
    ]) {
      const parsed = splitWorktreeId(worktreeId)
      if (parsed && repoIds.has(parsed.repoId)) {
        worktreeIds.add(worktreeId)
      }
    }
    if (worktreeIds.size === 0) {
      return
    }

    // Why: relay readiness follows PTY reattach; rebuild the HUB-owned panes before paired clients consume the connected event.
    for (const worktreeId of worktreeIds) {
      this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(worktreeId, {
        allowAttachedWindow: true,
        onlyRuntimeOwnedTerminals: true
      })
    }
    await this.refreshMobileSessionPtyRecords()
    if (this.sshRelayRecoveryGenerationByTargetId.get(targetId) !== generation) {
      return
    }
    for (const worktreeId of worktreeIds) {
      this.notifyMobileSessionTabsChangedNow(worktreeId)
    }
  }
  invalidateSshWorktreeScanCache(targetId: string): void {
    this.invalidateSshWorktreeScanCacheInternal(targetId)
  }

  // Why: renderer-initiated meta updates intentionally skip the renderer
  // notifier (the renderer already applied them optimistically), but remote
  // clients hold no optimistic copy and need the invalidation event.
  notifyWorktreesChangedForRemoteClients(repoId: string): void {
    this.invalidateResolvedWorktreeCache()
    this.emitClientEvent({ type: 'worktreesChanged', repoId })
  }
  protected notifyActivateWorktree(
    repoId: string,
    worktreeId: string,
    setup?: CreateWorktreeResult['setup'],
    startup?: WorktreeStartupLaunch,
    defaultTabs?: CreateWorktreeResult['defaultTabs']
  ): void {
    this.notifyHostActivateWorktree(repoId, worktreeId, setup, startup, defaultTabs)
    this.notifyClientsActivateWorktree(repoId, worktreeId, setup, startup, defaultTabs)
  }
  protected notifyHostActivateWorktree(
    repoId: string,
    worktreeId: string,
    setup?: CreateWorktreeResult['setup'],
    startup?: WorktreeStartupLaunch,
    defaultTabs?: CreateWorktreeResult['defaultTabs']
  ): void {
    this.notifier?.activateWorktree(repoId, worktreeId, setup, startup, defaultTabs)
  }
  protected notifyClientsActivateWorktree(
    repoId: string,
    worktreeId: string,
    setup?: CreateWorktreeResult['setup'],
    startup?: WorktreeStartupLaunch,
    defaultTabs?: CreateWorktreeResult['defaultTabs']
  ): void {
    this.emitClientEvent(
      toRuntimeActivateWorktreeEvent(repoId, worktreeId, setup, startup, defaultTabs)
    )
  }
  setAgentBrowserBridge(bridge: AgentBrowserBridge | null): void {
    this.agentBrowserBridge = bridge
  }
  getAgentBrowserBridge(): AgentBrowserBridge | null {
    return this.agentBrowserBridge
  }
  setOffscreenBrowserBackend(backend: BrowserBackend | null): void {
    this.offscreenBrowserBackend = backend
  }
  getOffscreenBrowserBackend(): BrowserBackend | null {
    return this.offscreenBrowserBackend
  }
  attachWindow(windowId: number): void {
    if (this.authoritativeWindowId === HEADLESS_RUNTIME_WINDOW_ID) {
      // Why: promotion is a renderer reload of the same graph owner, not a new
      // runtime; stale handles must transition before the real window publishes.
      this.persistWindowlessPtyBindingsForDesktopAttach()
      this.markRendererReloading(HEADLESS_RUNTIME_WINDOW_ID)
      this.authoritativeWindowId = windowId
      return
    }
    if (this.authoritativeWindowId === null) {
      // Why: a promoted serve can close and later reopen its window while new
      // background PTYs keep arriving; every windowless gap needs this handoff.
      this.persistWindowlessPtyBindingsForDesktopAttach()
      this.authoritativeWindowId = windowId
    }
  }
  protected persistWindowlessPtyBindingsForDesktopAttach(): void {
    if (!this.store?.getWorkspaceSession || !this.store.setWorkspaceSession) {
      return
    }
    const partitions = new Map<
      ExecutionHostId,
      { session: WorkspaceSessionState; ptys: RuntimePtyWorktreeRecord[] }
    >()
    for (const pty of this.ptysById.values()) {
      if (!pty.connected || !pty.tabId) {
        continue
      }
      const hostId = this.getWorkspaceSessionHostIdForWorktree(pty.worktreeId)
      const session = this.store.getWorkspaceSession(hostId)
      const tab = session.tabsByWorktree[pty.worktreeId]?.find(
        (candidate) => candidate.id === pty.tabId
      )
      if (!tab) {
        continue
      }
      const layoutPtyIds = Object.values(
        session.terminalLayoutsByTabId[pty.tabId]?.ptyIdsByLeafId ?? {}
      )
      if (tab.ptyId !== pty.ptyId && !layoutPtyIds.includes(pty.ptyId)) {
        continue
      }
      const partition = partitions.get(hostId) ?? { session, ptys: [] }
      partition.ptys.push(pty)
      partitions.set(hostId, partition)
    }

    for (const [hostId, { session, ptys }] of partitions) {
      // Why: windowless SSH PTYs must be handed to the desktop through their SSH partition, never the local session.
      const activeWorktreeIdsOnShutdown = [
        ...new Set([
          ...(session.activeWorktreeIdsOnShutdown ?? []),
          ...ptys.map((pty) => pty.worktreeId)
        ])
      ]
      const activeConnectionIdsAtShutdown = [
        ...new Set([
          ...(session.activeConnectionIdsAtShutdown ?? []),
          ...ptys
            .map((pty) => pty.connectionId)
            .filter((connectionId): connectionId is string => connectionId !== null)
        ])
      ]
      const remoteSessionIdsByTabId = { ...session.remoteSessionIdsByTabId }
      for (const pty of ptys) {
        if (pty.connectionId && pty.tabId) {
          remoteSessionIdsByTabId[pty.tabId] = pty.ptyId
        }
      }

      this.store.setWorkspaceSession(
        {
          ...session,
          activeWorktreeIdsOnShutdown,
          ...(activeConnectionIdsAtShutdown.length > 0 ? { activeConnectionIdsAtShutdown } : {}),
          ...(Object.keys(remoteSessionIdsByTabId).length > 0 ? { remoteSessionIdsByTabId } : {})
        },
        hostId
      )
    }
  }
}
