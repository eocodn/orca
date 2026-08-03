import { normalizeCompatibleAgentTitleForOwner, type RuntimeSyncedLeaf, type RuntimeMobileSessionTabGroup, type RuntimeMobileSessionSnapshotTab, type RuntimeMobileSessionTerminalTab, type RuntimeMobileSessionTabsSnapshot, getRepoIdFromWorktreeId, parsePaneKey, parseWorkspaceKey, hasHostAuthoritativeTerminalMembership, getLatestPtyTitle, type RuntimePtyWorktreeRecord } from './orca-runtime-symbols'
import { OrcaRuntimeReconcileHeadlessMobileSessionBrowserTabsPart8 } from './orca-runtime-reconcile-headless-mobile-session-browser-tabs-part-8'

export class OrcaRuntimeGetMobileSessionSnapshotTabIdentityKeysPart9 extends OrcaRuntimeReconcileHeadlessMobileSessionBrowserTabsPart8 {
  protected getMobileSessionSnapshotTabIdentityKeys(tab: RuntimeMobileSessionSnapshotTab): string[] {
    if (tab.type === 'terminal') {
      // Why: split terminal leaves share one parent tab; merge dedup must stay
      // leaf-scoped or preserved siblings collapse into a single surface.
      const keys = [tab.id, `${tab.parentTabId}::${tab.leafId}`]
      if (typeof tab.ptyId === 'string' && tab.ptyId.length > 0) {
        // Why: renderer and headless sources can derive different leafIds for the same
        // terminal; real PTYs collapse those duplicates without merging pending splits.
        keys.push(`${tab.parentTabId}::pty:${tab.ptyId}`)
      }
      return keys
    }
    if (tab.type === 'browser') {
      return [tab.id, tab.browserWorkspaceId]
    }
    return [tab.id]
  }
  protected mergeMobileSessionTabGroups(
    worktreeId: string,
    groups: readonly RuntimeMobileSessionTabGroup[],
    terminalTabs: readonly RuntimeMobileSessionTerminalTab[],
    activeTab: RuntimeMobileSessionTerminalTab | null
  ): RuntimeMobileSessionTabGroup[] {
    const parentTabOrder = this.collectHeadlessParentTabOrder(terminalTabs)
    if (parentTabOrder.length === 0) {
      return [...groups]
    }
    const targetGroupId = groups[0]?.id ?? this.getHeadlessMobileSessionGroupId(worktreeId)
    const nextGroups =
      groups.length > 0
        ? groups.map((group) => ({ ...group, tabOrder: [...group.tabOrder] }))
        : [
            {
              id: targetGroupId,
              activeTabId: null,
              tabOrder: []
            }
          ]
    // Why: keep each tab in the group that already owns it (a multi-group split
    // must survive the merge), drop tabs no longer present, and route only
    // genuinely-new tabs into the active group — never funnel everything into
    // group[0], which duplicated/coalesced tabs that lived in other groups.
    const ownerGroupId = new Map<string, string>()
    for (const group of nextGroups) {
      for (const tabId of group.tabOrder) {
        ownerGroupId.set(tabId, group.id)
      }
    }
    const liveTabIds = new Set(parentTabOrder)
    const activeParentId = activeTab?.parentTabId ?? null
    const activeGroupId =
      (activeParentId ? ownerGroupId.get(activeParentId) : undefined) ?? nextGroups[0]!.id
    const retainedOrder = new Map<string, string[]>(nextGroups.map((group) => [group.id, []]))
    for (const tabId of parentTabOrder) {
      const groupId = ownerGroupId.get(tabId) ?? activeGroupId
      retainedOrder.get(groupId)?.push(tabId)
    }
    return nextGroups
      .map((group) => {
        const tabOrder = retainedOrder.get(group.id) ?? []
        const keptActive =
          group.activeTabId &&
          tabOrder.includes(group.activeTabId) &&
          liveTabIds.has(group.activeTabId)
            ? group.activeTabId
            : null
        return {
          ...group,
          tabOrder,
          activeTabId:
            activeParentId && tabOrder.includes(activeParentId)
              ? activeParentId
              : (keptActive ?? tabOrder[0] ?? null)
        }
      })
      .filter((group) => group.tabOrder.length > 0)
  }

  /**
   * Publishes a PTY-backed terminal tab snapshot to the synced mobile session,
   * normalizing Pi-compatible titles based on launch or foreground ownership.
   */
  protected publishPtyBackedMobileSessionTerminal(
    worktreeId: string,
    pty: RuntimePtyWorktreeRecord,
    args: {
      tabId: string
      leafId: string
      title: string | null
      activate: boolean
      selectIfNoActiveTab?: boolean
      startupCwd?: string
      viewMode?: 'terminal' | 'chat'
      split?: { splitFromLeafId: string; direction: 'horizontal' | 'vertical' }
    }
  ): void {
    if (
      !this.isMobileSessionSurfaceMembershipAllowed(worktreeId, args.tabId, args.leafId, pty.ptyId)
    ) {
      return
    }
    const existing = this.mobileSessionTabsByWorktree.get(worktreeId)
    const ownerAgent = pty.launchAgent ?? pty.foregroundAgent
    const title = normalizeCompatibleAgentTitleForOwner(
      args.title ?? getLatestPtyTitle(pty) ?? 'Terminal',
      ownerAgent
    )
    const existingTab = existing?.tabs.find(
      (candidate): candidate is RuntimeMobileSessionTerminalTab =>
        candidate.type === 'terminal' &&
        candidate.parentTabId === args.tabId &&
        candidate.leafId === args.leafId
    )
    // Why: a split inserts into the parent tab's layout, which lives on the
    // sibling surface, not this new leaf's (empty) existing surface.
    const baseLayout = args.split
      ? (existing?.tabs.find(
          (candidate): candidate is RuntimeMobileSessionTerminalTab =>
            candidate.type === 'terminal' &&
            candidate.parentTabId === args.tabId &&
            candidate.leafId === args.split!.splitFromLeafId
        )?.parentLayout ?? existingTab?.parentLayout)
      : existingTab?.parentLayout
    const parentLayout = this.buildMaterializedHeadlessParentLayout(
      args.leafId,
      pty.ptyId,
      baseLayout,
      args.split
    )
    // Why: a main-side PTY rescue or split publication must not erase the
    // host's explicit tab mode before the renderer graph catches up.
    const viewMode =
      args.viewMode ??
      existingTab?.viewMode ??
      existing?.tabs.find(
        (candidate): candidate is RuntimeMobileSessionTerminalTab =>
          candidate.type === 'terminal' &&
          candidate.parentTabId === args.tabId &&
          candidate.viewMode !== undefined
      )?.viewMode
    const tab: RuntimeMobileSessionTerminalTab = {
      type: 'terminal',
      id: `${args.tabId}::${args.leafId}`,
      parentTabId: args.tabId,
      leafId: args.leafId,
      ptyId: pty.ptyId,
      title,
      ...(pty.launchAgent ? { launchAgent: pty.launchAgent } : {}),
      ...(args.startupCwd ? { startupCwd: args.startupCwd } : {}),
      ...(viewMode ? { viewMode } : {}),
      parentLayout,
      isActive:
        args.activate || (args.selectIfNoActiveTab !== false && existing?.activeTabId == null)
    }
    const existingTabs = (existing?.tabs ?? []).filter(
      (candidate) =>
        !(
          candidate.type === 'terminal' &&
          candidate.parentTabId === args.tabId &&
          candidate.leafId === args.leafId
        )
    )
    const tabs = this.mergeMobileSessionSnapshotTabs(
      existingTabs.map((candidate) => ({
        ...candidate,
        // Why: the client picks one sibling's parentLayout to render the whole
        // tab; a split must update every sibling surface to the new tree, or a
        // stale single-leaf sibling makes the client fall back to a default
        // direction ("Split Right" renders as down).
        ...(args.split && candidate.type === 'terminal' && candidate.parentTabId === args.tabId
          ? { parentLayout }
          : {}),
        isActive: tab.isActive ? false : candidate.isActive
      })),
      [tab]
    )
    const activeTab =
      (tab.isActive ? tab : tabs.find((candidate) => candidate.id === existing?.activeTabId)) ??
      tabs.find((candidate) => candidate.isActive) ??
      (args.selectIfNoActiveTab !== false ? tabs[0] : null) ??
      null
    const terminalTabs = tabs.filter(
      (candidate): candidate is RuntimeMobileSessionTerminalTab => candidate.type === 'terminal'
    )
    const next: RuntimeMobileSessionTabsSnapshot = {
      worktree: worktreeId,
      publicationEpoch:
        existing?.publicationEpoch ?? `headless:pty-backed:${Date.now().toString(36)}`,
      snapshotVersion: (existing?.snapshotVersion ?? 0) + 1,
      activeGroupId: existing?.activeGroupId ?? this.getHeadlessMobileSessionGroupId(worktreeId),
      activeTabId: activeTab?.id ?? null,
      activeTabType: activeTab?.type ?? null,
      tabGroups: this.mergeMobileSessionTabGroups(
        worktreeId,
        existing?.tabGroups ?? [],
        terminalTabs,
        activeTab?.type === 'terminal' ? activeTab : null
      ),
      ...(existing?.tabGroupLayout ? { tabGroupLayout: existing.tabGroupLayout } : {}),
      tabs
    }
    this.mobileSessionTabsByWorktree.set(worktreeId, next)
    this.notifyMobileSessionTabsChanged(worktreeId)
  }
  protected touchMobileSessionSnapshotsForPty(
    ptyId: string,
    options: { immediate?: boolean } = {}
  ): void {
    for (const [worktreeId, snapshot] of this.mobileSessionTabsByWorktree) {
      const hasPtyBackedTab = snapshot.tabs.some(
        (tab) =>
          tab.type === 'terminal' &&
          (tab.ptyId === ptyId || tab.parentLayout?.ptyIdsByLeafId?.[tab.leafId] === ptyId)
      )
      if (!hasPtyBackedTab) {
        continue
      }
      this.mobileSessionTabsByWorktree.set(worktreeId, {
        ...snapshot,
        snapshotVersion: snapshot.snapshotVersion + 1
      })
      if (options.immediate) {
        // Why: readiness/lifecycle changes are structural and must not wait
        // behind the title/status coalescing window.
        this.notifyMobileSessionTabsChanged(worktreeId)
      } else {
        // Why: title/status flips several times a second under spinner-in-title
        // agents. Coalesce the emit instead of fanning out every version.
        this.mobileSessionTabsNotifyCoalescer.schedule(worktreeId)
      }
    }
  }
  protected mobileSessionSnapshotHasSurface(
    worktreeId: string,
    parentTabId: string,
    leafId: string
  ): boolean {
    return Boolean(
      this.mobileSessionTabsByWorktree
        .get(worktreeId)
        ?.tabs.some(
          (tab) =>
            tab.type === 'terminal' && tab.parentTabId === parentTabId && tab.leafId === leafId
        )
    )
  }
  protected isMobileSessionSurfaceMembershipAllowed(
    worktreeId: string,
    parentTabId: string,
    leafId: string,
    candidatePtyId: string | null | undefined
  ): boolean {
    const workspaceScope = parseWorkspaceKey(worktreeId)
    if (workspaceScope?.type === 'folder') {
      const fencePrefix = `${worktreeId}\0`
      const folderStillExists = this.store
        ?.getFolderWorkspaces?.()
        ?.some((workspace) => workspace.id === workspaceScope.folderWorkspaceId)
      if (folderStillExists === true) {
        for (const fence of this.deletedFolderTerminalRetirementFences) {
          if (fence.startsWith(fencePrefix)) {
            this.deletedFolderTerminalRetirementFences.delete(fence)
          }
        }
      } else if (folderStillExists === false) {
        if (
          this.deletedFolderTerminalRetirementFences.has(`${worktreeId}\0${parentTabId}\0${leafId}`)
        ) {
          return false
        }
        const candidatePty = candidatePtyId ? this.ptysById.get(candidatePtyId) : undefined
        if (!candidatePtyId || !candidatePty) {
          // Why: missing candidate identity is not evidence against an unrelated retained surface.
          return true
        }
        const candidatePane = parsePaneKey(candidatePty?.paneKey ?? '')
        // Why: an absent folder host cannot authorize a stale graph frame; only the exact live PTY surface may survive.
        return Boolean(
          candidatePty?.connected &&
          candidatePty.worktreeId === worktreeId &&
          candidatePty.tabId === parentTabId &&
          candidatePane?.leafId === leafId
        )
      }
    }
    const session = this.getWorkspaceSessionForWorktree(worktreeId)
    const repoId = getRepoIdFromWorktreeId(worktreeId)
    const paneKey = `${parentTabId}:${leafId}`
    if (session?.terminalSurfaceTombstonesByPaneKey?.[paneKey]?.worktreeId === worktreeId) {
      return false
    }
    const hasHostAuthoritativeMembership = hasHostAuthoritativeTerminalMembership(
      session ?? undefined,
      worktreeId
    )
    const pty = candidatePtyId ? this.ptysById.get(candidatePtyId) : undefined
    const pane = parsePaneKey(pty?.paneKey ?? '')
    const candidateMatchesCurrentSurface = Boolean(
      pty?.connected &&
      pty.worktreeId === worktreeId &&
      pty.tabId === parentTabId &&
      pane?.leafId === leafId
    )
    const retirementFenceKey = `${worktreeId}\0${parentTabId}\0${leafId}`
    if (this.terminalSurfaceRetirementFences.has(retirementFenceKey)) {
      if (candidateMatchesCurrentSurface) {
        this.terminalSurfaceRetirementFences.delete(retirementFenceKey)
      } else {
        return false
      }
    }
    if (
      !hasHostAuthoritativeMembership &&
      ((session !== null && session !== undefined) ||
        !this.terminalTopologyRevisionByRepoId.has(repoId))
    ) {
      return true
    }
    const hasAuthoritativePtyIdentity = Boolean(pty?.tabId && pty.paneKey)
    const runtimeSnapshotHasSurface = this.mobileSessionSnapshotHasSurface(
      worktreeId,
      parentTabId,
      leafId
    )
    if (
      hasHostAuthoritativeMembership &&
      pty &&
      ((!pty.connected && !runtimeSnapshotHasSurface) ||
        (pty.connected &&
          hasAuthoritativePtyIdentity &&
          !candidateMatchesCurrentSurface &&
          !runtimeSnapshotHasSurface))
    ) {
      // Why: host authority rejects an exited surface only after the runtime snapshot drops it.
      return false
    }
    if (this.mobileSessionSnapshotHasSurface(worktreeId, parentTabId, leafId)) {
      return true
    }
    if (!candidatePtyId) {
      return false
    }
    return candidateMatchesCurrentSurface
  }
  protected reconcileMobileSessionRetirementFences(
    leaves: readonly RuntimeSyncedLeaf[]
  ): RuntimeSyncedLeaf[] {
    return leaves.filter((leaf) =>
      this.isMobileSessionSurfaceMembershipAllowed(
        leaf.worktreeId,
        leaf.tabId,
        leaf.leafId,
        leaf.ptyId
      )
    )
  }
}
