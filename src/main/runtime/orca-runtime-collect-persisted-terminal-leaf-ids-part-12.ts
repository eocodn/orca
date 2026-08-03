import { createHash, randomUUID, type TerminalLayoutSnapshot, closeTerminalTabInWorkspaceSession, type RuntimeMobileSessionTabGroup, type RuntimeMobileSessionSnapshotTab, type RuntimeMobileSessionTerminalTab, type RuntimeMobileSessionTabsSnapshot, isTerminalLeafId, buildHeadlessTerminalSplitLayout, advanceTerminalTopologyRevision, FLOATING_TERMINAL_WORKTREE_ID } from './orca-runtime-symbols'
import { OrcaRuntimeRetireMobileSessionSurfacesForPtyPart11 } from './orca-runtime-retire-mobile-session-surfaces-for-pty-part-11'

export class OrcaRuntimeCollectPersistedTerminalLeafIdsPart12 extends OrcaRuntimeRetireMobileSessionSurfacesForPtyPart11 {
  protected collectPersistedTerminalLeafIds(layout: TerminalLayoutSnapshot | undefined): string[] {
    if (!layout) {
      return []
    }
    const leafIds = new Set<string>()
    const visit = (node: TerminalLayoutSnapshot['root']): void => {
      if (!node) {
        return
      }
      if (node.type === 'leaf') {
        if (isTerminalLeafId(node.leafId)) {
          leafIds.add(node.leafId)
        }
        return
      }
      visit(node.first)
      visit(node.second)
    }
    visit(layout.root)
    if (layout.activeLeafId && isTerminalLeafId(layout.activeLeafId)) {
      leafIds.add(layout.activeLeafId)
    }
    for (const leafId of Object.keys(layout.ptyIdsByLeafId ?? {})) {
      if (isTerminalLeafId(leafId)) {
        leafIds.add(leafId)
      }
    }
    return [...leafIds]
  }
  protected deriveHeadlessLegacyTerminalLeafId(tabId: string): string {
    const hash = createHash('sha256').update(`headless-terminal-leaf:${tabId}`).digest('hex')
    const variant = ((Number.parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8).toString(16)
    const leafId = [
      hash.slice(0, 8),
      hash.slice(8, 12),
      `4${hash.slice(13, 16)}`,
      `${variant}${hash.slice(17, 20)}`,
      hash.slice(20, 32)
    ].join('-')
    if (!isTerminalLeafId(leafId)) {
      return randomUUID()
    }
    return leafId
  }
  protected cloneTerminalLayoutSnapshot(layout: TerminalLayoutSnapshot): TerminalLayoutSnapshot {
    const cloned: TerminalLayoutSnapshot = {
      root: layout.root,
      activeLeafId: layout.activeLeafId,
      expandedLeafId: layout.expandedLeafId
    }
    if (layout.ptyIdsByLeafId) {
      cloned.ptyIdsByLeafId = { ...layout.ptyIdsByLeafId }
    }
    if (layout.buffersByLeafId) {
      cloned.buffersByLeafId = { ...layout.buffersByLeafId }
    }
    if (layout.scrollbackRefsByLeafId) {
      cloned.scrollbackRefsByLeafId = { ...layout.scrollbackRefsByLeafId }
    }
    if (layout.titlesByLeafId) {
      cloned.titlesByLeafId = { ...layout.titlesByLeafId }
    }
    return cloned
  }
  protected isPersistedTerminalLeafActive(
    worktreeId: string,
    tabId: string,
    leafId: string,
    layout: TerminalLayoutSnapshot | undefined
  ): boolean {
    const session = this.getWorkspaceSessionForWorktree(worktreeId)
    const activeTabId = session?.activeTabIdByWorktree?.[worktreeId] ?? session?.activeTabId
    return activeTabId === tabId && (!layout?.activeLeafId || layout.activeLeafId === leafId)
  }
  protected pickHeadlessActiveTerminalTab(
    tabs: readonly RuntimeMobileSessionTerminalTab[]
  ): RuntimeMobileSessionTerminalTab | null {
    return tabs.find((tab) => tab.isActive) ?? tabs.find((tab) => tab.parentTabId) ?? null
  }
  protected collectHeadlessParentTabOrder(
    tabs: readonly RuntimeMobileSessionTerminalTab[]
  ): string[] {
    const order: string[] = []
    const seen = new Set<string>()
    for (const tab of tabs) {
      if (!seen.has(tab.parentTabId)) {
        seen.add(tab.parentTabId)
        order.push(tab.parentTabId)
      }
    }
    return order
  }

  // Why: the group tab order must follow actual creation/insertion order across
  // both terminals and browsers, not list terminals first. A terminal's top-level
  // id is its parentTabId (split leaves share one); a browser's is its own id.
  protected collectHeadlessTopLevelTabOrder(
    tabs: readonly RuntimeMobileSessionSnapshotTab[]
  ): string[] {
    const order: string[] = []
    const seen = new Set<string>()
    for (const tab of tabs) {
      const topLevelId = tab.type === 'terminal' ? tab.parentTabId : tab.id
      if (!seen.has(topLevelId)) {
        seen.add(topLevelId)
        order.push(topLevelId)
      }
    }
    return order
  }
  protected getHeadlessMobileSessionGroupId(worktreeId: string): string {
    return `headless-terminals:${worktreeId}`
  }
  protected buildHeadlessMobileSessionTabGroups(
    worktreeId: string,
    tabs: readonly RuntimeMobileSessionSnapshotTab[],
    activeTab: RuntimeMobileSessionSnapshotTab | null,
    existingGroups?: readonly RuntimeMobileSessionTabGroup[],
    // Why: a new tab created via a specific group's "+" must land in THAT group,
    // not the active one — otherwise every "+" in a split funnels to one group.
    newTabAssignment?: { tabId: string; groupId: string }
  ): RuntimeMobileSessionTabGroup[] {
    // Why: order across terminals and browsers in their actual array order so a
    // tab opened after a browser tab lands to its right, not regrouped before it.
    const tabOrder = this.collectHeadlessTopLevelTabOrder(tabs)
    const topLevelOf = (tab: RuntimeMobileSessionSnapshotTab): string =>
      tab.type === 'terminal' ? tab.parentTabId : tab.id
    const activeTopLevelId =
      (activeTab ? topLevelOf(activeTab) : null) ??
      existingGroups?.[0]?.activeTabId ??
      (() => {
        const active = tabs.find((tab) => tab.isActive)
        return active ? topLevelOf(active) : null
      })() ??
      tabOrder[0] ??
      null

    // Why: when the user has split tabs into multiple groups, preserve that
    // assignment across rebuilds instead of coalescing back to one group.
    if (existingGroups && existingGroups.length > 1) {
      return this.distributeHeadlessTabsAcrossGroups(
        existingGroups,
        tabOrder,
        activeTopLevelId,
        newTabAssignment
      )
    }

    const groupId = existingGroups?.[0]?.id ?? this.getHeadlessMobileSessionGroupId(worktreeId)
    return [
      {
        id: groupId,
        activeTabId:
          activeTopLevelId && tabOrder.includes(activeTopLevelId)
            ? activeTopLevelId
            : (tabOrder[0] ?? null),
        tabOrder
      }
    ]
  }

  // Distribute live top-level tabs into the existing multi-group structure,
  // keeping each tab in its group; tabs new since the last snapshot join the
  // active group. Emptied groups are dropped so a closed split collapses.
  protected distributeHeadlessTabsAcrossGroups(
    existingGroups: readonly RuntimeMobileSessionTabGroup[],
    tabOrder: readonly string[],
    activeTopLevelId: string | null,
    newTabAssignment?: { tabId: string; groupId: string }
  ): RuntimeMobileSessionTabGroup[] {
    const groupIdByTabId = new Map<string, string>()
    for (const group of existingGroups) {
      for (const tabId of group.tabOrder) {
        groupIdByTabId.set(tabId, group.id)
      }
    }
    // Why: route a freshly-created tab to the group its "+" was clicked in,
    // when that group still exists; otherwise fall through to the active group.
    const hasTargetGroup =
      newTabAssignment !== undefined &&
      existingGroups.some((group) => group.id === newTabAssignment.groupId)
    if (hasTargetGroup) {
      groupIdByTabId.set(newTabAssignment!.tabId, newTabAssignment!.groupId)
    }
    const activeGroupId =
      (activeTopLevelId ? groupIdByTabId.get(activeTopLevelId) : undefined) ?? existingGroups[0]!.id
    const orderByGroup = new Map<string, string[]>(existingGroups.map((group) => [group.id, []]))
    for (const tabId of tabOrder) {
      const groupId = groupIdByTabId.get(tabId) ?? activeGroupId
      orderByGroup.get(groupId)?.push(tabId)
    }
    return existingGroups
      .map((group) => {
        const nextOrder = orderByGroup.get(group.id) ?? []
        return {
          ...group,
          tabOrder: nextOrder,
          activeTabId:
            activeTopLevelId && nextOrder.includes(activeTopLevelId)
              ? activeTopLevelId
              : group.activeTabId && nextOrder.includes(group.activeTabId)
                ? group.activeTabId
                : (nextOrder[0] ?? null)
        }
      })
      .filter((group) => group.tabOrder.length > 0)
  }
  protected buildMaterializedHeadlessParentLayout(
    leafId: string,
    ptyId: string,
    existingLayout: TerminalLayoutSnapshot | undefined,
    split?: { splitFromLeafId: string; direction: 'horizontal' | 'vertical' }
  ): TerminalLayoutSnapshot {
    if (!existingLayout) {
      return {
        root: { type: 'leaf', leafId },
        activeLeafId: leafId,
        expandedLeafId: null,
        ptyIdsByLeafId: { [leafId]: ptyId }
      }
    }
    // Why: a split must insert the new leaf into the live layout tree with the
    // requested direction, or the published snapshot keeps the old single-leaf
    // root and the split renders with a fallback direction ("Split Right" lands
    // as a top/bottom split). Reuse the persisted-split builder for parity.
    if (split) {
      return buildHeadlessTerminalSplitLayout(this.cloneTerminalLayoutSnapshot(existingLayout), {
        leafId,
        ptyId,
        splitFromLeafId: split.splitFromLeafId,
        direction: split.direction
      })
    }
    return {
      ...this.cloneTerminalLayoutSnapshot(existingLayout),
      ptyIdsByLeafId: {
        ...existingLayout.ptyIdsByLeafId,
        [leafId]: ptyId
      }
    }
  }
  protected removePersistedHeadlessTerminalTab(worktreeId: string, parentTabId: string): string[] {
    const session = this.getWorkspaceSessionForWorktree(worktreeId)
    if (!session || !this.store?.setWorkspaceSession) {
      throw new Error('workspace_session_unavailable')
    }
    const result = closeTerminalTabInWorkspaceSession(session, worktreeId, parentTabId)
    if (result.pinned) {
      throw new Error('terminal_tab_pinned')
    }
    if (!result.closed) {
      throw new Error('tab_not_found')
    }
    this.setWorkspaceSessionForWorktree(
      worktreeId,
      advanceTerminalTopologyRevision(result.session, worktreeId)
    )
    return result.ptyIdsToKill
  }
  protected persistHeadlessTerminalTabOrder(worktreeId: string, tabOrder: readonly string[]): void {
    const session = this.getWorkspaceSessionForWorktree(worktreeId)
    if (!session || !this.store?.setWorkspaceSession) {
      return
    }
    const orderIndexByTabId = new Map(tabOrder.map((tabId, index) => [tabId, index]))
    const tabs = session.tabsByWorktree[worktreeId] ?? []
    const reordered = [...tabs]
      .sort((a, b) => {
        const aIndex = orderIndexByTabId.get(a.id) ?? Number.MAX_SAFE_INTEGER
        const bIndex = orderIndexByTabId.get(b.id) ?? Number.MAX_SAFE_INTEGER
        return aIndex - bIndex || a.sortOrder - b.sortOrder || a.createdAt - b.createdAt
      })
      .map((tab, index) => ({
        ...tab,
        sortOrder: index
      }))
    this.setWorkspaceSessionForWorktree(worktreeId, {
      ...session,
      tabsByWorktree: {
        ...session.tabsByWorktree,
        [worktreeId]: reordered
      }
    })
  }
  protected emitMobileSessionTabsSnapshot(snapshot: RuntimeMobileSessionTabsSnapshot): void {
    if (this.mobileSessionTabListeners.size === 0) {
      return
    }
    const result = this.toMobileSessionTabsResult(snapshot)
    for (const subscription of this.mobileSessionTabListeners) {
      subscription.listener(
        this.clientSessionTabSelections.project(result, subscription.clientNavigationId)
      )
    }
  }
  protected async refreshMobileSessionPtyRecords(
    targetWorktreeId: string | null = null
  ): Promise<Set<string> | null> {
    if (targetWorktreeId !== FLOATING_TERMINAL_WORKTREE_ID) {
      const pending = this.pendingMobileSessionPtyInventoryRefresh
      if (pending) {
        return pending
      }
      // Why: reconnect exit bursts share one authoritative daemon inventory
      // instead of multiplying a full cross-generation list RPC per stale tab.
      const refresh = this.performMobileSessionPtyRecordsRefresh(targetWorktreeId).finally(() => {
        if (this.pendingMobileSessionPtyInventoryRefresh === refresh) {
          this.pendingMobileSessionPtyInventoryRefresh = null
        }
      })
      this.pendingMobileSessionPtyInventoryRefresh = refresh
      return refresh
    }
    return await this.performMobileSessionPtyRecordsRefresh(targetWorktreeId)
  }
  protected async performMobileSessionPtyRecordsRefresh(
    targetWorktreeId: string | null
  ): Promise<Set<string> | null> {
    if (!this.ptyController?.listProcesses && !this.ptyController?.hasPty) {
      return null
    }
    // Why: floating PTY identity is explicit, so polling must not resolve every Git/SSH worktree.
    const isFloatingWorkspace = targetWorktreeId === FLOATING_TERMINAL_WORKTREE_ID
    const resolvedWorktrees = isFloatingWorkspace ? [] : await this.listResolvedWorktrees()
    return await this.refreshPtyWorktreeRecordsFromController(
      resolvedWorktrees,
      isFloatingWorkspace ? targetWorktreeId : null
    )
  }
}
