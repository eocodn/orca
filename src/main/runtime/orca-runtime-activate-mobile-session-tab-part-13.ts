import { navigationTargetsClients, navigationTargetsHost, type RuntimeNavigationTarget, type RuntimeMobileSessionTabCloseResult, type RuntimeMobileSessionTerminalTab, type RuntimeMobileSessionTabsResult, type RuntimeMobileSessionTabsSnapshot, parseAppSshPtyId, buildHeadlessTerminalSplitLayout, activateClientSessionTabSelection, deriveClientSessionTabSelection, projectClientSessionTabSelection } from './orca-runtime-symbols'
import type { OrcaRuntimeService } from './orca-runtime'
import { OrcaRuntimeCollectPersistedTerminalLeafIdsPart12 } from './orca-runtime-collect-persisted-terminal-leaf-ids-part-12'

export class OrcaRuntimeActivateMobileSessionTabPart13 extends OrcaRuntimeCollectPersistedTerminalLeafIdsPart12 {
  async activateMobileSessionTab(
    worktreeSelector: string,
    tabId: string,
    leafId?: string,
    opts: {
      notifyClients?: boolean
      clientNavigationId?: string
      navigation?: RuntimeNavigationTarget
    } = {}
  ): Promise<RuntimeMobileSessionTabsResult> {
    const navigation = opts.navigation ?? (opts.notifyClients === false ? 'caller' : 'all')
    const targetsHost = navigationTargetsHost(navigation)
    const explicitWorktreeId = this.getValidatedExplicitWorktreeIdSelector(worktreeSelector)
    const worktreeId =
      explicitWorktreeId ?? (await this.resolveWorktreeSelector(worktreeSelector)).id
    this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(worktreeId)
    await this.refreshMobileSessionPtyRecords(worktreeId)
    const snapshot = this.mobileSessionTabsByWorktree.get(worktreeId)
    const directTab = snapshot?.tabs.find((candidate) => candidate.id === tabId)
    const tab = leafId
      ? ((directTab?.type === 'terminal' && directTab.leafId === leafId ? directTab : undefined) ??
        snapshot?.tabs.find(
          (candidate) =>
            candidate.type === 'terminal' &&
            candidate.parentTabId === tabId &&
            candidate.leafId === leafId
        ))
      : (directTab ??
        snapshot?.tabs.find(
          (candidate) => candidate.type === 'terminal' && candidate.parentTabId === tabId
        ) ??
        snapshot?.tabs.find(
          (candidate) => candidate.type === 'browser' && candidate.browserWorkspaceId === tabId
        ))
    if (!tab) {
      throw new Error('tab_not_found')
    }

    if (tab.type === 'terminal') {
      const publicTab = this.toMobileSessionTabsResult(snapshot!).tabs.find(
        (candidate) => candidate.type === 'terminal' && candidate.id === tab.id
      )
      // Why: serve-created tabs can be visible before any renderer has adopted
      // their tab id, so focusing the renderer would silently no-op.
      // Phone-local activation also needs this path for inactive restored tabs:
      // desktop focus is intentionally suppressed, but the PTY still must exist.
      const shouldMaterializePendingTerminal =
        publicTab?.type === 'terminal' &&
        publicTab.status !== 'ready' &&
        (!targetsHost ||
          !this.notifier?.focusTerminal ||
          this.shouldMaterializeHeadlessMobileSessionTab(snapshot!, tab))
      if (shouldMaterializePendingTerminal) {
        const sessionId = tab.ptyId ?? tab.parentLayout?.ptyIdsByLeafId?.[tab.leafId] ?? undefined
        const targetGroupId = snapshot?.tabGroups?.find((group) =>
          group.tabOrder.includes(tab.parentTabId)
        )?.id
        // Why: a pending agent tab may exist without its startup command ever
        // having been delivered (the create's renderer stalled, #7587), so a
        // bare materialize would put a plain shell under the agent icon.
        // Re-resolve the launch like the create path; providers skip startup
        // commands when attaching to live sessions, so this cannot double-launch.
        let agentStartup: Awaited<
          ReturnType<OrcaRuntimeService['resolveMobileSessionTerminalCommand']>
        > = {}
        if (tab.launchAgent) {
          try {
            const workspace = await this.resolveTerminalWorkspaceLaunchScope(`id:${worktreeId}`)
            agentStartup = await this.resolveMobileSessionTerminalCommand(workspace, {
              agent: tab.launchAgent
            })
          } catch {
            // Why: a disabled or unresolvable agent must not make the tab
            // untappable; fall back to the plain-shell materialize.
          }
        }
        try {
          await this.createHeadlessMobileSessionTerminal(worktreeId, targetsHost, undefined, {
            identity: {
              tabId: tab.parentTabId,
              leafId: tab.leafId,
              sessionId
            },
            cwd: tab.startupCwd,
            command: agentStartup.command,
            env: agentStartup.env,
            startupCommandDelivery: agentStartup.startupCommandDelivery,
            launchConfig: agentStartup.launchConfig,
            launchAgent: tab.launchAgent,
            targetGroupId
          })
        } catch (err) {
          if (sessionId && parseAppSshPtyId(sessionId)) {
            // Why: an expired SSH reattach clears durable bindings in the store,
            // but this in-memory headless snapshot can still carry the old id.
            this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(worktreeId, { force: true })
          }
          throw err
        }
        return this.applyMobileSessionTabNavigation(
          this.getMobileSessionTabsForWorktree(worktreeId),
          tab.id,
          navigation,
          opts.clientNavigationId
        )
      }
      const callerSnapshot = this.getMobileSessionTabsForWorktree(
        worktreeId,
        opts.clientNavigationId
      )
      const activeSibling =
        tab.id === tabId || leafId
          ? null
          : (callerSnapshot.tabs.find(
              (candidate) =>
                candidate.type === 'terminal' &&
                candidate.parentTabId === tab.parentTabId &&
                candidate.isActive
            ) as RuntimeMobileSessionTerminalTab | undefined)
      const targetTab = activeSibling ?? tab
      if (targetsHost && !this.notifier?.focusTerminal) {
        if (
          !targetTab.isActive &&
          this.shouldPersistHeadlessMobileSessionActivation(snapshot!, targetTab)
        ) {
          this.activateHeadlessMobileSessionTerminalTab(worktreeId, snapshot!, targetTab)
        }
      } else if (targetsHost) {
        this.notifier?.focusTerminal?.(targetTab.parentTabId, worktreeId, targetTab.leafId)
      }
      return this.applyMobileSessionTabNavigation(
        this.getMobileSessionTabsForWorktree(worktreeId),
        targetTab.id,
        navigation,
        opts.clientNavigationId
      )
    } else if (tab.type === 'browser') {
      // Why: browser mobile tabs are renderer-owned unified tabs; focusing the
      // session tab keeps desktop tab order/group state authoritative.
      if (targetsHost) {
        this.notifier?.focusEditorTab?.(tab.id, worktreeId)
      }
    } else {
      if (targetsHost) {
        this.notifier?.focusEditorTab?.(tab.id, worktreeId)
      }
    }
    return this.applyMobileSessionTabNavigation(
      this.getMobileSessionTabsForWorktree(worktreeId),
      tab.id,
      navigation,
      opts.clientNavigationId
    )
  }
  protected applyMobileSessionTabNavigation(
    snapshot: RuntimeMobileSessionTabsResult,
    activeTabId: string,
    navigation: RuntimeNavigationTarget,
    clientNavigationId?: string
  ): RuntimeMobileSessionTabsResult {
    let callerSnapshot: RuntimeMobileSessionTabsResult | null = null
    if (navigationTargetsClients(navigation)) {
      // Why: follow is live intent; disconnected devices must not inherit stale navigation on reconnect.
      const ids = new Set(
        [...this.mobileSessionTabListeners]
          .map((subscription) => subscription.clientNavigationId)
          .filter((id): id is string => Boolean(id))
      )
      if (clientNavigationId) {
        ids.add(clientNavigationId)
      }
      for (const id of ids) {
        const projected = this.clientSessionTabSelections.activate(snapshot, id, activeTabId)
        this.emitMobileSessionTabsSnapshotToClient(projected, id, true)
        if (id === clientNavigationId) {
          callerSnapshot = projected
        }
      }
    } else if (clientNavigationId) {
      // Why: follow-host still starts as caller navigation; the host is an additional target, not a replacement owner.
      callerSnapshot = this.clientSessionTabSelections.activate(
        snapshot,
        clientNavigationId,
        activeTabId
      )
      this.emitMobileSessionTabsSnapshotToClient(callerSnapshot, clientNavigationId)
    }
    if (clientNavigationId) {
      return callerSnapshot ?? this.clientSessionTabSelections.project(snapshot, clientNavigationId)
    }
    if (navigation === 'caller') {
      const selection = activateClientSessionTabSelection(
        snapshot,
        deriveClientSessionTabSelection(snapshot),
        activeTabId
      )
      return projectClientSessionTabSelection(snapshot, selection).snapshot
    }
    return snapshot
  }
  protected shouldMaterializeHeadlessMobileSessionTab(
    snapshot: RuntimeMobileSessionTabsSnapshot,
    tab: RuntimeMobileSessionTerminalTab
  ): boolean {
    return (
      this.isHeadlessMobileSessionPublication(snapshot.publicationEpoch) ||
      this.hasServeOrSshOwnedBinding(tab)
    )
  }
  protected shouldPersistHeadlessMobileSessionActivation(
    snapshot: RuntimeMobileSessionTabsSnapshot,
    tab: RuntimeMobileSessionTerminalTab
  ): boolean {
    if (snapshot.publicationEpoch.includes(':headless-merge:')) {
      return false
    }
    if (this.authoritativeWindowId !== null && this.graphStatus === 'ready') {
      return false
    }
    return this.shouldMaterializeHeadlessMobileSessionTab(snapshot, tab)
  }
  protected activateHeadlessMobileSessionTerminalTab(
    worktreeId: string,
    snapshot: RuntimeMobileSessionTabsSnapshot,
    activeTab: RuntimeMobileSessionTerminalTab
  ): void {
    const tabs = snapshot.tabs.map((candidate) => ({
      ...candidate,
      isActive: candidate.id === activeTab.id
    }))
    const nextSnapshot: RuntimeMobileSessionTabsSnapshot = {
      ...snapshot,
      publicationEpoch: `headless:${Date.now().toString(36)}`,
      snapshotVersion: snapshot.snapshotVersion + 1,
      activeTabId: activeTab.id,
      activeTabType: 'terminal',
      tabGroups: this.buildHeadlessMobileSessionTabGroups(
        worktreeId,
        tabs,
        activeTab,
        snapshot.tabGroups
      ),
      tabs
    }
    this.persistHeadlessTerminalActiveLeaf(worktreeId, activeTab)
    this.mobileSessionTabsByWorktree.set(worktreeId, nextSnapshot)
    this.emitMobileSessionTabsSnapshot(nextSnapshot)
  }

  // Why: a headless split only updated the LIVE session snapshot, never the
  // persisted workspace session layout. So a later snapshot rebuild (e.g. on the
  // next terminal create) re-derived from the stale single-leaf persisted layout
  // and collapsed the split. Persist the new split leaf into the workspace
  // session's terminalLayoutsByTabId so the split survives rebuilds.
  protected persistHeadlessTerminalSplit(args: {
    worktreeId: string
    tabId: string
    leafId: string
    ptyId: string
    splitFromLeafId: string
    direction: 'horizontal' | 'vertical'
  }): void {
    const session = this.getWorkspaceSessionForWorktree(args.worktreeId)
    if (!session || !this.store?.setWorkspaceSession) {
      return
    }
    const existing = session.terminalLayoutsByTabId?.[args.tabId]
    const nextLayout = buildHeadlessTerminalSplitLayout(
      existing ? this.cloneTerminalLayoutSnapshot(existing) : undefined,
      args
    )
    this.setWorkspaceSessionForWorktree(args.worktreeId, {
      ...session,
      terminalLayoutsByTabId: {
        ...session.terminalLayoutsByTabId,
        [args.tabId]: nextLayout
      }
    })
  }
  protected persistHeadlessTerminalActiveLeaf(
    worktreeId: string,
    tab: RuntimeMobileSessionTerminalTab
  ): void {
    const session = this.getWorkspaceSessionForWorktree(worktreeId)
    if (!session || !this.store?.setWorkspaceSession) {
      return
    }
    const existingLayout = session.terminalLayoutsByTabId?.[tab.parentTabId]
    const nextLayouts = existingLayout
      ? {
          ...session.terminalLayoutsByTabId,
          [tab.parentTabId]: {
            ...this.cloneTerminalLayoutSnapshot(existingLayout),
            activeLeafId: tab.leafId
          }
        }
      : session.terminalLayoutsByTabId
    this.setWorkspaceSessionForWorktree(worktreeId, {
      ...session,
      activeTabId: tab.parentTabId,
      activeTabIdByWorktree: {
        ...session.activeTabIdByWorktree,
        [worktreeId]: tab.parentTabId
      },
      terminalLayoutsByTabId: nextLayouts
    })
  }
  async refuseUnattributedMobileSessionTabClose(
    worktreeSelector: string,
    tabId: string
  ): Promise<RuntimeMobileSessionTabCloseResult> {
    const snapshot = await this.listMobileSessionTabs(worktreeSelector)
    const tabExists = snapshot.tabs.some(
      (candidate) =>
        candidate.id === tabId ||
        (candidate.type === 'terminal' && candidate.parentTabId === tabId) ||
        (candidate.type === 'browser' && candidate.browserWorkspaceId === tabId)
    )
    if (!tabExists) {
      throw new Error('tab_not_found')
    }
    // Why: a legacy client may already have hidden its mirror; a new snapshot
    // restores it without granting an unattributed request destructive authority.
    this.republishMobileSessionTabsSnapshot(snapshot.worktree)
    return {
      closed: true,
      refused: true,
      refusalReason: 'missing-intent',
      snapshotRepublished: true
    }
  }
}
