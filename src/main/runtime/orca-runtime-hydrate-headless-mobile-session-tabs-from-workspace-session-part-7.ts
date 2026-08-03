import { type WorkspaceSessionState, type RuntimeMobileSessionTabGroup, type RuntimeMobileSessionSnapshotTab, type RuntimeMobileSessionTerminalTab, type RuntimeMobileSessionBrowserTab, type RuntimeMobileSessionTabsSnapshot, splitWorktreeIdForFilesystem } from './orca-runtime-symbols'
import { OrcaRuntimeSyncWindowGraphPart6 } from './orca-runtime-sync-window-graph-part-6'

export class OrcaRuntimeHydrateHeadlessMobileSessionTabsFromWorkspaceSessionPart7 extends OrcaRuntimeSyncWindowGraphPart6 {
  protected hydrateHeadlessMobileSessionTabsFromWorkspaceSession(
    worktreeId?: string,
    options: {
      force?: boolean
      allowAttachedWindow?: boolean
      onlyRuntimeOwnedTerminals?: boolean
    } = {}
  ): Set<string> {
    // Why: report which worktrees were reconciled in place so callers don't
    // reconcile them a second time (see notifyMobileSessionTabsChanged).
    const reconciledWorktreeIds = new Set<string>()
    if (this.getAvailableAuthoritativeWindow() && options.allowAttachedWindow !== true) {
      return reconciledWorktreeIds
    }
    let session: WorkspaceSessionState | null | undefined
    try {
      session = worktreeId
        ? this.getWorkspaceSessionForWorktree(worktreeId)
        : this.store?.getWorkspaceSession?.()
    } catch (error) {
      if (error instanceof Error && error.message === 'folder_workspace_not_found') {
        // Why: a deleted folder has no durable session to hydrate; retain its in-memory fence.
        return reconciledWorktreeIds
      }
      throw error
    }
    if (!session) {
      return reconciledWorktreeIds
    }
    // Why: with no runtime-owned candidate in the session and no offscreen
    // browser backend, this hydrate provably builds zero tabs for
    // every worktree — skip the per-worktree rebuild entirely (hot on every
    // graph sync). Scoped to onlyRuntimeOwnedTerminals so full hydrates are
    // untouched.
    if (
      options.onlyRuntimeOwnedTerminals === true &&
      !this.offscreenBrowserBackend &&
      !this.workspaceSessionHasRuntimeOwnedPtyCandidate(session)
    ) {
      return reconciledWorktreeIds
    }
    const entries =
      worktreeId !== undefined
        ? ([[worktreeId, session.tabsByWorktree[worktreeId] ?? []]] as const)
        : Object.entries(session.tabsByWorktree ?? {})
    // Why: workspaceSession keys are `${repoId}::${path}` and are not pruned when
    // a repo disappears from this client's view (e.g. removed on another client,
    // or a stale browser-persisted session). Hydrating such a key would surface a
    // phantom "unknown"/duplicate workspace with no live repo behind it. Only
    // hydrate sessions whose repo still exists; leave unparseable keys alone.
    // Resolved lazily so unparseable keys (floating terminals) never pay for a
    // repo inventory on the hot poll path, and `null` when the store cannot
    // report repos — an unavailable list must not read as "every repo is gone".
    let liveRepoIds: Set<string> | null | undefined
    for (const [entryWorktreeId, persistedTabs] of entries) {
      const ownerRepoId = splitWorktreeIdForFilesystem(entryWorktreeId)?.repoId
      if (ownerRepoId) {
        if (liveRepoIds === undefined) {
          const knownRepos = this.store?.getRepos?.()
          liveRepoIds = knownRepos ? new Set(knownRepos.map((repo) => repo.id)) : null
        }
        if (liveRepoIds && !liveRepoIds.has(ownerRepoId)) {
          continue
        }
      }
      const existing = this.mobileSessionTabsByWorktree.get(entryWorktreeId)
      if (
        existing &&
        existing.tabs.length > 0 &&
        options.force !== true &&
        options.onlyRuntimeOwnedTerminals !== true
      ) {
        // Why: terminals are stable/persisted so we normally skip a rebuild, but
        // offscreen browser tabs are live and may have been created/closed since.
        // Reconcile just the browser tabs against the live bridge instead of
        // leaving a stale snapshot that omits a freshly-opened browser tab.
        this.reconcileHeadlessMobileSessionBrowserTabs(entryWorktreeId, existing)
        reconciledWorktreeIds.add(entryWorktreeId)
        continue
      }
      const terminalTabs = this.buildHeadlessMobileSessionTerminalTabs(
        entryWorktreeId,
        persistedTabs
      ).filter(
        (tab) =>
          options.onlyRuntimeOwnedTerminals !== true ||
          this.hasServeOrSshOwnedBinding(tab) ||
          this.hasRecentExpiredSshLeasePane(entryWorktreeId, tab)
      )
      // Why: offscreen browser panes are live-only (no persisted session entry),
      // so include them on every hydrate regardless of the onlyRuntimeOwnedTerminals
      // filter, which is about terminal PTY ownership and never applies to browsers.
      const browserTabs = this.buildHeadlessMobileSessionBrowserTabs(entryWorktreeId)
      const tabs: RuntimeMobileSessionSnapshotTab[] = [...terminalTabs, ...browserTabs]
      if (tabs.length === 0) {
        continue
      }
      const activeTab = this.pickHeadlessActiveTerminalTab(terminalTabs)
      const tabOrder = [
        ...this.collectHeadlessParentTabOrder(terminalTabs),
        ...browserTabs.map((tab) => tab.id)
      ]
      const groupId = this.getHeadlessMobileSessionGroupId(entryWorktreeId)
      const mergedTabs =
        options.onlyRuntimeOwnedTerminals === true && existing
          ? this.mergeMobileSessionSnapshotTabs(existing.tabs, tabs)
          : tabs
      const mergedActiveTab =
        existing?.tabs.find((tab) => tab.id === existing.activeTabId) ??
        activeTab ??
        mergedTabs[0] ??
        null
      const mergedTerminalTabs = mergedTabs.filter(
        (tab): tab is RuntimeMobileSessionTerminalTab => tab.type === 'terminal'
      )
      const mergedBrowserOrder = mergedTabs
        .filter((tab): tab is RuntimeMobileSessionBrowserTab => tab.type === 'browser')
        .map((tab) => tab.id)
      // Why: a persisted multi-group split must be restored on cold rebuild, or
      // the headless serve coalesces the user's group layout back into one group
      // (the persisted tabGroups/tabGroupLayouts would otherwise be write-only).
      const persistedGroups = session.tabGroups?.[entryWorktreeId]
      const persistedLayout = session.tabGroupLayouts?.[entryWorktreeId]
      const hasPersistedSplit =
        options.onlyRuntimeOwnedTerminals !== true &&
        persistedGroups !== undefined &&
        persistedGroups.length > 1
      const activeTopLevelId = mergedActiveTab
        ? mergedActiveTab.type === 'terminal'
          ? mergedActiveTab.parentTabId
          : mergedActiveTab.id
        : null
      const nextTabGroups: RuntimeMobileSessionTabGroup[] = hasPersistedSplit
        ? this.appendBrowserTabOrder(
            this.distributeHeadlessTabsAcrossGroups(
              persistedGroups.map((group) => ({
                id: group.id,
                activeTabId: group.activeTabId,
                tabOrder: [...group.tabOrder],
                ...(group.recentTabIds ? { recentTabIds: [...group.recentTabIds] } : {})
              })),
              this.collectHeadlessParentTabOrder(mergedTerminalTabs),
              activeTopLevelId
            ),
            mergedBrowserOrder,
            undefined,
            // Why: distribute drops browser ids (terminal-only), so carry each
            // browser's persisted group forward instead of coalescing left.
            this.collectBrowserGroupAssignment(persistedGroups, mergedBrowserOrder)
          )
        : options.onlyRuntimeOwnedTerminals === true && existing?.tabGroups
          ? this.appendBrowserTabOrder(
              this.mergeMobileSessionTabGroups(
                entryWorktreeId,
                existing.tabGroups,
                mergedTerminalTabs,
                mergedActiveTab?.type === 'terminal' ? mergedActiveTab : null
              ),
              mergedBrowserOrder
            )
          : [
              {
                id: groupId,
                activeTabId: mergedActiveTab?.id
                  ? (activeTab?.parentTabId ?? mergedActiveTab.id)
                  : (tabOrder[0] ?? null),
                tabOrder
              }
            ]
      // Why: merging runtime tabs INTO a renderer publication must not reclass
      // the snapshot as headless-built — the preservation predicate would then
      // treat the renderer's own tabs as runtime-owned and resurrect tabs the
      // renderer later closes. Keep the renderer base epoch with a merge suffix
      // (idempotent) so ownership stays derivable from the epoch.
      const mergedIntoRendererPublication =
        options.onlyRuntimeOwnedTerminals === true &&
        existing !== undefined &&
        !this.isHeadlessBuiltMobileSessionPublicationBase(existing.publicationEpoch)
      const nextSnapshot: RuntimeMobileSessionTabsSnapshot = {
        worktree: existing?.worktree ?? entryWorktreeId,
        publicationEpoch: mergedIntoRendererPublication
          ? this.getMergedMobileSessionPublicationEpoch(existing, tabs)
          : `headless-hydrated:${Date.now().toString(36)}`,
        snapshotVersion: (existing?.snapshotVersion ?? 0) + 1,
        activeGroupId: existing?.activeGroupId ?? groupId,
        activeTabId: mergedActiveTab?.id ?? null,
        activeTabType: mergedActiveTab?.type ?? null,
        tabGroups: nextTabGroups,
        // Why: the runtime-owned rebuild runs on every graph sync — carry the
        // existing split layout forward or each sync drops it and fans out.
        ...(hasPersistedSplit && persistedLayout
          ? { tabGroupLayout: persistedLayout }
          : options.onlyRuntimeOwnedTerminals === true && existing?.tabGroupLayout
            ? { tabGroupLayout: existing.tabGroupLayout }
            : {}),
        tabs: mergedTabs
      }
      // Why: the runtime-owned hydrate runs on EVERY graph sync; when the rebuilt
      // projection matches the existing snapshot, keep the existing object and
      // (epoch, version) untouched so identity-based change detection stays a
      // pure no-op and unchanged runtime/browser worktrees never fan out.
      if (existing && this.headlessMobileSnapshotContentUnchanged(existing, nextSnapshot)) {
        continue
      }
      this.mobileSessionTabsByWorktree.set(entryWorktreeId, nextSnapshot)
    }
    return reconciledWorktreeIds
  }

  // Why: content equality for the hydrate's idempotence check — compares every
  // client-visible field EXCEPT publicationEpoch/snapshotVersion (both are
  // freshly minted on each rebuild and would defeat the comparison). Tab and
  // group objects are rebuilt each hydrate, so compare by value, not identity.
  protected headlessMobileSnapshotContentUnchanged(
    existing: RuntimeMobileSessionTabsSnapshot,
    next: RuntimeMobileSessionTabsSnapshot
  ): boolean {
    if (
      existing.worktree !== next.worktree ||
      existing.activeGroupId !== next.activeGroupId ||
      existing.activeTabId !== next.activeTabId ||
      existing.activeTabType !== next.activeTabType
    ) {
      return false
    }
    // Why: this runs per persisted worktree on EVERY graph sync whenever a
    // serve PTY exists, so compare structurally instead of stable-stringifying
    // both sides (which allocated six full serialized trees per worktree).
    return (
      this.mobileSnapshotValueEqual(existing.tabs, next.tabs) &&
      this.mobileSnapshotValueEqual(existing.tabGroups ?? null, next.tabGroups ?? null) &&
      this.mobileSnapshotValueEqual(existing.tabGroupLayout ?? null, next.tabGroupLayout ?? null)
    )
  }

  // Deep structural equality over plain snapshot JSON (objects/arrays/scalars).
  // Key order is irrelevant; a mismatch only costs a coalesced no-op emit.
  protected mobileSnapshotValueEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
      return true
    }
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        return false
      }
      for (let index = 0; index < a.length; index++) {
        if (!this.mobileSnapshotValueEqual(a[index], b[index])) {
          return false
        }
      }
      return true
    }
    if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
      const aRecord = a as Record<string, unknown>
      const bRecord = b as Record<string, unknown>
      const aKeys = Object.keys(aRecord)
      if (aKeys.length !== Object.keys(bRecord).length) {
        return false
      }
      for (const key of aKeys) {
        if (
          !Object.hasOwn(bRecord, key) ||
          !this.mobileSnapshotValueEqual(aRecord[key], bRecord[key])
        ) {
          return false
        }
      }
      return true
    }
    return false
  }

  // Why: keep an existing snapshot's browser tabs in sync with the live bridge
  // without rebuilding stable terminal state. Replaces browser entries with the
  // current live set and rewrites the browser portion of the primary group order.
}
