import { HEADLESS_RUNTIME_WINDOW_ID, type RuntimeSyncWindowGraphResult, type RuntimeSyncedTab, type RuntimeMobileSessionTabsResult, type RuntimeSyncWindowGraph, type RuntimeLeafRecord } from './orca-runtime-symbols'
import { OrcaRuntimeNotifyNativeChatLaunchDraftResolvedPart5 } from './orca-runtime-notify-native-chat-launch-draft-resolved-part-5'

export class OrcaRuntimeSyncWindowGraphPart6 extends OrcaRuntimeNotifyNativeChatLaunchDraftResolvedPart5 {
  syncWindowGraph(windowId: number, graph: RuntimeSyncWindowGraph): RuntimeSyncWindowGraphResult {
    if (this.authoritativeWindowId === null) {
      this.authoritativeWindowId = windowId
    }
    if (windowId !== this.authoritativeWindowId) {
      throw new Error('Runtime graph publisher does not match the authoritative window')
    }

    const previousTabs = this.tabs
    const previousLeaves = this.leaves
    this.tabs = new Map(graph.tabs.map((tab) => [tab.tabId, tab]))
    const lifecycleLeaves = this.reconcileMobileSessionRetirementFences(graph.leaves)
    const changedMobileWorktrees = this.syncMobileSessionTabs(graph.mobileSessionTabs)
    const nextLeaves = new Map<string, RuntimeLeafRecord>()
    const graphSyncedAt = this.nextTitleObservationSequence()

    // Why: renderer reloads can briefly republish the same leaf with no ptyId;
    // keep live CLI handles usable while the UI graph rebuilds.
    const preserveLivePtysDuringReload = this.graphStatus === 'reloading'
    for (const leaf of lifecycleLeaves) {
      const leafKey = this.getLeafKey(leaf.tabId, leaf.leafId)
      const existing = this.leaves.get(leafKey)
      const ptyId =
        preserveLivePtysDuringReload && leaf.ptyId === null && existing?.ptyId
          ? existing.ptyId
          : leaf.ptyId
      const sameExistingPty = existing?.ptyId === ptyId ? existing : undefined
      const ptyGeneration =
        existing && existing.ptyId !== ptyId
          ? existing.ptyGeneration + 1
          : (existing?.ptyGeneration ?? 0)
      const existingPty = ptyId ? this.ptysById.get(ptyId) : undefined
      const tailSource = existing?.ptyId === ptyId ? existing : existingPty
      const connected =
        ptyId !== null &&
        !this.rendererGraphLivenessBlockedPtys.has(ptyId) &&
        (existingPty?.connected ?? (sameExistingPty?.connected ?? true))

      nextLeaves.set(leafKey, {
        ...leaf,
        ptyId,
        ptyGeneration,
        connected,
        writable: this.graphStatus === 'ready' && connected,
        lastOutputAt: tailSource?.lastOutputAt ?? null,
        lastExitCode: tailSource?.lastExitCode ?? null,
        tailBuffer: tailSource?.tailBuffer ?? [],
        tailTranscriptBuffer: tailSource?.tailTranscriptBuffer ?? [],
        tailTranscriptChars: tailSource?.tailTranscriptChars ?? 0,
        tailPartialLine: tailSource?.tailPartialLine ?? '',
        tailPendingAnsi: tailSource?.tailPendingAnsi ?? '',
        tailRedrawCursor: tailSource?.tailRedrawCursor ?? null,
        tailTruncated: tailSource?.tailTruncated ?? false,
        tailLinesTotal: tailSource?.tailLinesTotal ?? 0,
        preview: tailSource?.preview ?? '',
        waitBlockedAt: tailSource?.waitBlockedAt ?? null,
        lastAgentStatus: tailSource?.lastAgentStatus ?? null,
        lastOscTitle: tailSource?.lastOscTitle ?? null,
        lastOscTitleAt: tailSource?.lastOscTitleAt ?? null,
        paneTitleUpdatedAt:
          sameExistingPty !== undefined && sameExistingPty.paneTitle === leaf.paneTitle
            ? sameExistingPty.paneTitleUpdatedAt
            : graphSyncedAt
      })

      if (leaf.ptyId) {
        this.recordPtyWorktree(leaf.ptyId, leaf.worktreeId, {
          connected,
          lastOutputAt:
            sameExistingPty !== undefined && sameExistingPty.ptyId === leaf.ptyId
              ? sameExistingPty.lastOutputAt
              : null,
          preview:
            sameExistingPty !== undefined && sameExistingPty.ptyId === leaf.ptyId
              ? sameExistingPty.preview
              : '',
          tabId: leaf.tabId,
          paneKey: this.makeRuntimePaneKey(leaf)
        })
      }

      if (existing && (existing.ptyId !== ptyId || existing.ptyGeneration !== ptyGeneration)) {
        // Why: mobile can subscribe while the pane is waiting for its first PTY.
        // Keep that handle usable after the recovery mount binds it.
        const adoptedFirstPty =
          existing.ptyId === null && this.adoptFirstPtyForLeafHandle(leafKey, ptyId, ptyGeneration)
        if (!adoptedFirstPty) {
          this.invalidateLeafHandle(leafKey)
        }
      }
    }

    // Why: computed BEFORE preserving stale leaves so preservation can refuse a
    // leaf whose PTY the incoming graph already rebound to a live leaf. Two
    // leaves on one PTY resolve to the same handle (handles are ptyId-keyed) and
    // crash paired clients with a duplicate React key.
    const nextPtyIds = new Set(
      [...nextLeaves.values()].map((leaf) => leaf.ptyId).filter((ptyId): ptyId is string => !!ptyId)
    )
    for (const oldLeafKey of this.leaves.keys()) {
      if (!nextLeaves.has(oldLeafKey)) {
        const oldLeaf = this.leaves.get(oldLeafKey)
        if (
          preserveLivePtysDuringReload &&
          oldLeaf?.ptyId &&
          this.handleByPtyId.has(oldLeaf.ptyId) &&
          !nextPtyIds.has(oldLeaf.ptyId)
        ) {
          // Why: a CLI-created agent keeps using its exported handle even if
          // the reloaded renderer has not rebound the pane yet.
          nextLeaves.set(oldLeafKey, oldLeaf)
          nextPtyIds.add(oldLeaf.ptyId)
        } else if (oldLeaf?.ptyId && nextPtyIds.has(oldLeaf.ptyId)) {
          // Why: the incoming graph already rebound this PTY to a live leaf (e.g.
          // a woken agent re-keyed to a new leaf during renderer reload). Keeping
          // the old leaf too would put two leaves on ONE PTY, which emit the same
          // terminal handle and crash paired clients. Drop the stale leaf; if its
          // handle is the shared ptyId-keyed one it belongs to the live leaf now,
          // so release only this dead leaf key's alias. A leaf-unique handle has
          // no next owner — invalidate it so in-flight CLI waiters fail fast
          // instead of hanging on a dead leaf.
          const oldHandle = this.handleByLeafKey.get(oldLeafKey)
          if (oldHandle !== undefined && oldHandle === this.handleByPtyId.get(oldLeaf.ptyId)) {
            this.handleByLeafKey.delete(oldLeafKey)
          } else {
            this.invalidateLeafHandle(oldLeafKey)
          }
        } else {
          this.invalidateLeafHandle(oldLeafKey)
        }
      }
    }

    for (const [ptyId, leaf] of this.detachedPreAllocatedLeaves) {
      if (nextPtyIds.has(ptyId) || !this.handleByPtyId.has(ptyId)) {
        this.detachedPreAllocatedLeaves.delete(ptyId)
        continue
      }
      nextLeaves.set(this.getLeafKey(leaf.tabId, leaf.leafId), leaf)
      nextPtyIds.add(ptyId)
    }

    this.leaves = nextLeaves
    this.rebuildLeafPtyIndex()
    // Why: the emitted client payload is a function of the stored snapshot AND
    // the tab/leaf graph (handles/titles/connected resolve from leaf state), so
    // a graph-only change — e.g. a restored leaf binding its ptyId while the
    // snapshot pair is unchanged — must also fan out, or a paired client stays
    // on pending-handle forever. Schedule the union on the same 50ms trailing
    // edge as the OSC-title path; the coalescer emit reads the latest state at
    // fire time so no final version is ever lost.
    for (const worktreeId of this.collectMobileVisibleGraphChangedWorktrees(
      previousTabs,
      previousLeaves
    )) {
      if (changedMobileWorktrees.has(worktreeId)) {
        continue
      }
      const stored = this.mobileSessionTabsByWorktree.get(worktreeId)
      if (!stored) {
        continue
      }
      // Why: web clients drop same-epoch frames whose version isn't strictly
      // newer, so a graph-only change must mint a fresh stored version (like
      // the PTY touch path does) or the re-emitted payload — e.g. the
      // pending-handle → ready flip — is discarded and the client stays stale.
      // The accepted-renderer tracking is untouched: this is a main-local bump.
      this.mobileSessionTabsByWorktree.set(worktreeId, {
        ...stored,
        snapshotVersion: stored.snapshotVersion + 1
      })
      changedMobileWorktrees.add(worktreeId)
    }
    for (const worktreeId of changedMobileWorktrees) {
      if (this.mobileSessionTabsByWorktree.has(worktreeId)) {
        this.mobileSessionTabsNotifyCoalescer.schedule(worktreeId)
      }
    }
    this.graphStatus = 'ready'
    this.setTerminalSideEffectConsumerAvailable(windowId !== HEADLESS_RUNTIME_WINDOW_ID)
    this.refreshWritableFlags()
    for (const leaf of this.leaves.values()) {
      this.adoptPreAllocatedHandle(leaf)
    }

    // Why: createTerminal waits for the renderer's graph sync to populate the
    // new leaf so it can return a handle. Drain callbacks after leaves update.
    for (const cb of [...this.graphSyncCallbacks]) {
      cb()
    }

    const agentOrchestrationByPaneKey = this.buildAgentOrchestrationByPaneKey()
    const nativeChatLaunchDraftResolutions =
      this.getNativeChatLaunchDraftResolutionClientEventSnapshot().map(
        ({ tabId, text, createdAt }) => ({ tabId, text, createdAt })
      )
    return {
      ...this.getStatus(),
      ...(agentOrchestrationByPaneKey ? { agentOrchestrationByPaneKey } : {}),
      ...(nativeChatLaunchDraftResolutions.length > 0 ? { nativeChatLaunchDraftResolutions } : {})
    }
  }

  // Why: toMobileSessionTabsResult resolves handles/titles from this.tabs and
  // this.leaves, so any tab/leaf delta a graph sync installs can flip the
  // client payload (pending-handle → ready, tab title) with zero change to the
  // stored snapshot. Compare exactly the projection-relevant fields and report
  // the affected worktrees; false positives only cost a coalesced no-op emit.
  protected collectMobileVisibleGraphChangedWorktrees(
    previousTabs: Map<string, RuntimeSyncedTab>,
    previousLeaves: Map<string, RuntimeLeafRecord>
  ): Set<string> {
    const changed = new Set<string>()
    for (const [tabId, tab] of this.tabs) {
      const prev = previousTabs.get(tabId)
      if (!prev || prev.title !== tab.title) {
        changed.add(tab.worktreeId)
      }
    }
    for (const [tabId, tab] of previousTabs) {
      if (!this.tabs.has(tabId)) {
        changed.add(tab.worktreeId)
      }
    }
    for (const [leafKey, leaf] of this.leaves) {
      const prev = previousLeaves.get(leafKey)
      if (
        !prev ||
        prev.ptyId !== leaf.ptyId ||
        prev.connected !== leaf.connected ||
        prev.paneTitle !== leaf.paneTitle
      ) {
        changed.add(leaf.worktreeId)
      }
    }
    for (const [leafKey, leaf] of previousLeaves) {
      if (!this.leaves.has(leafKey)) {
        changed.add(leaf.worktreeId)
      }
    }
    return changed
  }
  async listMobileSessionTabs(
    worktreeSelector: string,
    clientNavigationId?: string
  ): Promise<RuntimeMobileSessionTabsResult> {
    const explicitWorktreeId = this.getValidatedExplicitWorktreeIdSelector(worktreeSelector)
    if (explicitWorktreeId) {
      this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(explicitWorktreeId, {
        allowAttachedWindow: true,
        onlyRuntimeOwnedTerminals: true
      })
      this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(explicitWorktreeId)
      await this.refreshMobileSessionPtyRecords(explicitWorktreeId)
      return this.getMobileSessionTabsForWorktree(explicitWorktreeId, clientNavigationId)
    }
    const worktree = await this.resolveWorktreeSelector(worktreeSelector)
    this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(worktree.id, {
      allowAttachedWindow: true,
      onlyRuntimeOwnedTerminals: true
    })
    this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(worktree.id)
    await this.refreshMobileSessionPtyRecords()
    return this.getMobileSessionTabsForWorktree(worktree.id, clientNavigationId)
  }
  async listAllMobileSessionTabs(
    clientNavigationId?: string
  ): Promise<RuntimeMobileSessionTabsResult[]> {
    for (const worktreeId of this.getKnownWorkspaceSessionWorktreeIds()) {
      this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(worktreeId, {
        allowAttachedWindow: true,
        onlyRuntimeOwnedTerminals: true
      })
    }
    this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession()
    await this.refreshMobileSessionPtyRecords()
    return [...this.mobileSessionTabsByWorktree.values()].map((snapshot) =>
      this.clientSessionTabSelections.project(
        this.toMobileSessionTabsResult(snapshot),
        clientNavigationId
      )
    )
  }
}
