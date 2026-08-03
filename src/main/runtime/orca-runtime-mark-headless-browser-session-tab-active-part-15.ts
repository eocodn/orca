import { type TerminalPaneLayoutNode, type WorkspaceSessionState, type RuntimeMobileSessionTabMove, type RuntimeMobileSessionTabMoveResult, type RuntimeMobileSessionSnapshotTab, type RuntimeMobileSessionTerminalTab, type RuntimeMobileSessionBrowserTab, type RuntimeMobileSessionTabsSnapshot, parseAppSshPtyId } from './orca-runtime-symbols'
import { OrcaRuntimeCloseMobileSessionTabPart14 } from './orca-runtime-close-mobile-session-tab-part-14'

export class OrcaRuntimeMarkHeadlessBrowserSessionTabActivePart15 extends OrcaRuntimeCloseMobileSessionTabPart14 {
  protected markHeadlessBrowserSessionTabActive(
    worktreeId: string | undefined,
    browserPageId: string,
    targetGroupId?: string
  ): void {
    if (!this.offscreenBrowserBackend || !worktreeId) {
      return
    }
    // Hydrate first so the freshly created browser tab is present in the snapshot.
    this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(worktreeId)
    const snapshot = this.mobileSessionTabsByWorktree.get(worktreeId)
    const tab = snapshot?.tabs.find(
      (candidate): candidate is RuntimeMobileSessionBrowserTab =>
        candidate.type === 'browser' && candidate.browserPageId === browserPageId
    )
    if (!snapshot || !tab) {
      return
    }
    const groups = snapshot.tabGroups ?? []
    const hasTargetGroup =
      targetGroupId !== undefined && groups.some((group) => group.id === targetGroupId)
    // Why: move the new browser into the group whose "+" was clicked, removing it
    // from wherever the rebuild placed it. Only the TARGET group's activeTabId
    // (and the global active) change — every other group's active tab is left
    // intact, so creating in the right group never resets the left group's tab.
    const nextGroups = hasTargetGroup
      ? groups.map((group) => {
          const withoutTab = group.tabOrder.filter((id) => id !== tab.id)
          if (group.id === targetGroupId) {
            return { ...group, tabOrder: [...withoutTab, tab.id], activeTabId: tab.id }
          }
          return withoutTab.length === group.tabOrder.length
            ? group
            : { ...group, tabOrder: withoutTab }
        })
      : groups.map((group) =>
          group.tabOrder.includes(tab.id) ? { ...group, activeTabId: tab.id } : group
        )
    const nextSnapshot: RuntimeMobileSessionTabsSnapshot = {
      ...snapshot,
      publicationEpoch: `headless:${Date.now().toString(36)}`,
      snapshotVersion: snapshot.snapshotVersion + 1,
      ...(hasTargetGroup ? { activeGroupId: targetGroupId } : {}),
      activeTabId: tab.id,
      activeTabType: 'browser',
      tabs: snapshot.tabs.map((candidate) => ({
        ...candidate,
        isActive: candidate.id === tab.id
      })),
      tabGroups: nextGroups
    }
    this.mobileSessionTabsByWorktree.set(worktreeId, nextSnapshot)
    // Why: browser group membership is otherwise live-only; persist it so a
    // later rebuild keeps the browser in its group instead of coalescing left.
    if (hasTargetGroup && nextSnapshot.tabGroupLayout) {
      this.persistHeadlessTabGroups(worktreeId, nextGroups, nextSnapshot.tabGroupLayout)
    }
    this.emitMobileSessionTabsSnapshot(nextSnapshot)
  }
  protected closeHeadlessMobileTerminalTab(
    worktreeId: string,
    snapshot: RuntimeMobileSessionTabsSnapshot,
    tab: RuntimeMobileSessionTerminalTab,
    options: { killPtys?: boolean } = {}
  ): void {
    const closedParentTabId = tab.parentTabId
    this.clearRuntimeSessionOwnershipForMobileTab(worktreeId, snapshot, closedParentTabId)
    const projectedPtyIds = this.removePersistedHeadlessTerminalTab(worktreeId, closedParentTabId)
    // Why: local provider ids can be reused after restart, so a dormant
    // persisted id is not kill authority. SSH relay ids remain durable exact
    // identities even before pane metadata reconnects.
    const ptyIdsToKill = new Set(projectedPtyIds.filter((ptyId) => parseAppSshPtyId(ptyId)))
    for (const candidate of snapshot.tabs) {
      if (candidate.type !== 'terminal' || candidate.parentTabId !== closedParentTabId) {
        continue
      }
      const livePty = this.findPtyForMobileTerminalTab(worktreeId, candidate)
      const ptyId = livePty?.ptyId ?? candidate.ptyId
      const hasOtherOwner = snapshot.tabs.some(
        (other) =>
          other.type === 'terminal' &&
          other.parentTabId !== closedParentTabId &&
          other.ptyId === ptyId
      )
      if (ptyId && !hasOtherOwner && (livePty || parseAppSshPtyId(ptyId))) {
        // Why: a live serve leaf can exist before its debounced binding reaches
        // persistence. Include it from the authoritative snapshot so split
        // close cannot leave a provider process behind.
        ptyIdsToKill.add(ptyId)
      }
    }
    if (options.killPtys !== false) {
      for (const ptyId of ptyIdsToKill) {
        this.ptyController?.kill(ptyId)
      }
    }
    const nextTabs = snapshot.tabs.filter((candidate) => {
      if (candidate.type !== 'terminal' || candidate.parentTabId !== closedParentTabId) {
        return true
      }
      return false
    })
    const active = nextTabs.find((candidate) => candidate.isActive) ?? nextTabs[0] ?? null
    const nextSnapshot: RuntimeMobileSessionTabsSnapshot = {
      ...snapshot,
      publicationEpoch: `headless:${Date.now().toString(36)}`,
      snapshotVersion: snapshot.snapshotVersion + 1,
      activeTabId: active?.id ?? null,
      activeTabType: active?.type ?? null,
      tabGroups: this.buildHeadlessMobileSessionTabGroups(
        worktreeId,
        nextTabs,
        active,
        snapshot.tabGroups
      ),
      tabs: nextTabs
    }
    this.mobileSessionTabsByWorktree.set(worktreeId, nextSnapshot)
    this.emitMobileSessionTabsSnapshot(nextSnapshot)
  }
  async moveMobileSessionTab(
    worktreeSelector: string,
    move: RuntimeMobileSessionTabMove
  ): Promise<RuntimeMobileSessionTabMoveResult> {
    const explicitWorktreeId = this.getValidatedExplicitWorktreeIdSelector(worktreeSelector)
    const worktreeId =
      explicitWorktreeId ?? (await this.resolveWorktreeSelector(worktreeSelector)).id
    this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(worktreeId)
    const snapshot = this.mobileSessionTabsByWorktree.get(worktreeId)
    if (!snapshot) {
      throw new Error('tab_not_found')
    }
    if (!this.notifier?.moveSessionTab) {
      return this.moveHeadlessMobileSessionTab(worktreeId, snapshot, move)
    }
    const hostTabId = this.resolveMobileSessionHostTabId(snapshot, move.tabId)
    if (!hostTabId) {
      throw new Error('tab_not_found')
    }
    const publicSnapshot = this.toMobileSessionTabsResult(snapshot)
    const targetGroup = publicSnapshot.tabGroups?.find((group) => group.id === move.targetGroupId)
    if (!targetGroup) {
      throw new Error('target_group_not_found')
    }

    // Why: web clients address terminal surfaces as tab::leaf, while desktop
    // tab grouping is owned by the outer terminal tab id.
    if (move.kind === 'reorder') {
      const tabOrder = this.normalizeMobileSessionTabOrder(snapshot, targetGroup, move.tabOrder)
      if (!tabOrder.includes(hostTabId)) {
        throw new Error('invalid_tab_order')
      }
      this.notifier.moveSessionTab(worktreeId, {
        ...move,
        tabId: hostTabId,
        tabOrder
      })
      return { moved: true }
    }
    this.notifier.moveSessionTab(worktreeId, {
      ...move,
      tabId: hostTabId
    })
    return { moved: true }
  }

  // Why: pane geometry inside a tab (split ratios, expanded pane, pane titles)
  // is host-authoritative for remote-server tabs but had no push path, so a
  // client divider-drag / expand / pane-rename reverted on the next snapshot.
  // Persist the structural fields onto the tab's layout, keeping host-owned
  // pty bindings and active leaf.
  async updateMobileSessionPaneLayout(
    worktreeSelector: string,
    args: {
      tabId: string
      root: TerminalPaneLayoutNode | null
      expandedLeafId: string | null
      titlesByLeafId?: Record<string, string>
    }
  ): Promise<{ updated: true }> {
    const explicitWorktreeId = this.getValidatedExplicitWorktreeIdSelector(worktreeSelector)
    const worktreeId =
      explicitWorktreeId ?? (await this.resolveWorktreeSelector(worktreeSelector)).id
    // Why: when a renderer is authoritative (desktop host reached via shared
    // control), it owns pane geometry and republishes it — a headless write here
    // would be overwritten and could fight the renderer. Persist only headlessly.
    if (this.getAvailableAuthoritativeWindow()) {
      return { updated: true }
    }
    // Why: resolve to the host tab id (older/raw-id clients) so the persisted
    // layout entry matches, matching setMobileSessionTabProps.
    const snapshot = this.mobileSessionTabsByWorktree.get(worktreeId)
    const hostTabId = snapshot
      ? (this.resolveMobileSessionHostTabId(snapshot, args.tabId) ?? args.tabId)
      : args.tabId
    const resolvedArgs = { ...args, tabId: hostTabId }
    const acceptedLayout = this.persistHeadlessTerminalPaneLayout(worktreeId, resolvedArgs)
    if (acceptedLayout) {
      this.applyHeadlessTerminalPaneLayoutToSnapshot(worktreeId, {
        tabId: hostTabId,
        root: acceptedLayout.root,
        expandedLeafId: acceptedLayout.expandedLeafId,
        ...(acceptedLayout.titlesByLeafId ? { titlesByLeafId: acceptedLayout.titlesByLeafId } : {})
      })
    }
    return { updated: true }
  }

  // Why: tab color/pin are host-authoritative for remote-server tabs but had no
  // push path, so pinning or coloring a tab reverted on the next snapshot and
  // was never persisted. Persist to the workspace session + live snapshot.
  async setMobileSessionTabProps(
    worktreeSelector: string,
    args: {
      tabId: string
      color?: string | null
      isPinned?: boolean
      viewMode?: 'terminal' | 'chat'
    }
  ): Promise<{ updated: true }> {
    const explicitWorktreeId = this.getValidatedExplicitWorktreeIdSelector(worktreeSelector)
    const worktreeId =
      explicitWorktreeId ?? (await this.resolveWorktreeSelector(worktreeSelector)).id
    // Why: a renderer-authoritative host owns + republishes tab props, so a
    // headless write would be overwritten. Persist only when headless.
    if (this.getAvailableAuthoritativeWindow()) {
      return { updated: true }
    }
    const snapshot = this.mobileSessionTabsByWorktree.get(worktreeId)
    const hostTabId = snapshot
      ? (this.resolveMobileSessionHostTabId(snapshot, args.tabId) ?? args.tabId)
      : args.tabId
    this.persistHeadlessSessionTabProps(worktreeId, hostTabId, args)
    this.applyHeadlessSessionTabPropsToSnapshot(worktreeId, hostTabId, args)
    return { updated: true }
  }
  protected persistHeadlessSessionTabProps(
    worktreeId: string,
    tabId: string,
    props: { color?: string | null; isPinned?: boolean; viewMode?: 'terminal' | 'chat' }
  ): void {
    const session = this.getWorkspaceSessionForWorktree(worktreeId)
    if (!session || !this.store?.setWorkspaceSession) {
      return
    }
    const tabs = session.tabsByWorktree[worktreeId]
    const nextSession: WorkspaceSessionState = { ...session }
    let changed = false
    if (tabs?.some((tab) => tab.id === tabId)) {
      changed = true
      nextSession.tabsByWorktree = {
        ...session.tabsByWorktree,
        [worktreeId]: tabs.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                ...(props.color !== undefined ? { color: props.color } : {}),
                ...(props.isPinned !== undefined ? { isPinned: props.isPinned } : {}),
                ...(props.viewMode !== undefined ? { viewMode: props.viewMode } : {})
              }
            : tab
        )
      }
    }

    const unifiedTabs = session.unifiedTabs?.[worktreeId]
    if (unifiedTabs?.some((tab) => tab.id === tabId || tab.entityId === tabId)) {
      changed = true
      nextSession.unifiedTabs = {
        ...session.unifiedTabs,
        [worktreeId]: unifiedTabs.map((tab) =>
          tab.id === tabId || tab.entityId === tabId
            ? {
                ...tab,
                ...(props.color !== undefined ? { color: props.color } : {}),
                ...(props.isPinned !== undefined ? { isPinned: props.isPinned } : {})
              }
            : tab
        )
      }
    }

    if (!changed) {
      return
    }
    this.setWorkspaceSessionForWorktree(worktreeId, nextSession)
  }
  protected applyHeadlessSessionTabPropsToSnapshot(
    worktreeId: string,
    tabId: string,
    props: { color?: string | null; isPinned?: boolean; viewMode?: 'terminal' | 'chat' }
  ): void {
    const snapshot = this.mobileSessionTabsByWorktree.get(worktreeId)
    if (!snapshot) {
      return
    }
    let changed = false
    const tabs = snapshot.tabs.map((tab) => {
      if (this.getMobileSessionTopLevelTabId(tab) !== tabId) {
        return tab
      }
      changed = true
      return {
        ...tab,
        ...(props.color !== undefined ? { color: props.color } : {}),
        ...(props.isPinned !== undefined ? { isPinned: props.isPinned } : {}),
        ...(props.viewMode !== undefined ? { viewMode: props.viewMode } : {})
      }
    })
    if (!changed) {
      return
    }
    const nextSnapshot: RuntimeMobileSessionTabsSnapshot = {
      ...snapshot,
      publicationEpoch: `headless:${Date.now().toString(36)}`,
      snapshotVersion: snapshot.snapshotVersion + 1,
      tabs
    }
    this.mobileSessionTabsByWorktree.set(worktreeId, nextSnapshot)
    this.emitMobileSessionTabsSnapshot(nextSnapshot)
  }
  protected getMobileSessionTopLevelTabId(tab: RuntimeMobileSessionSnapshotTab): string {
    return tab.type === 'terminal' ? tab.parentTabId : tab.id
  }

  // Merge the client's pane structure into the persisted tab layout. PTY
  // bindings and active leaf stay host-owned; only ratios/expand/titles change.
  // terminalLayoutsByTabId is keyed by tab id (worktree-independent).
}
