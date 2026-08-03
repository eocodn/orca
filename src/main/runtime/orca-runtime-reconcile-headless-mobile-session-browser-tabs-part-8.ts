import { type WorkspaceSessionState, type RuntimeMobileSessionTabGroup, type RuntimeMobileSessionSnapshotTab, type RuntimeMobileSessionTerminalTab, type RuntimeMobileSessionBrowserTab, type RuntimeMobileSessionTabsSnapshot, parseAppSshPtyId, type RuntimeStore, SSH_PANE_RECOVERY_GRACE_MS } from './orca-runtime-symbols'
import { OrcaRuntimeHydrateHeadlessMobileSessionTabsFromWorkspaceSessionPart7 } from './orca-runtime-hydrate-headless-mobile-session-tabs-from-workspace-session-part-7'

export class OrcaRuntimeReconcileHeadlessMobileSessionBrowserTabsPart8 extends OrcaRuntimeHydrateHeadlessMobileSessionTabsFromWorkspaceSessionPart7 {
  protected reconcileHeadlessMobileSessionBrowserTabs(
    worktreeId: string,
    existing: RuntimeMobileSessionTabsSnapshot
  ): void {
    if (!this.offscreenBrowserBackend) {
      return
    }
    const liveBrowserTabs = this.buildHeadlessMobileSessionBrowserTabs(worktreeId)
    const liveIds = liveBrowserTabs.map((tab) => tab.id)
    const existingBrowserTabs = existing.tabs.filter(
      (tab): tab is RuntimeMobileSessionBrowserTab => tab.type === 'browser'
    )
    const existingBrowserIds = existingBrowserTabs.map((tab) => tab.id)
    if (this.headlessBrowserTabsUnchanged(liveBrowserTabs, existingBrowserTabs)) {
      return
    }
    const nonBrowserTabs = existing.tabs.filter((tab) => tab.type !== 'browser')
    const nextTabs: RuntimeMobileSessionSnapshotTab[] = [...nonBrowserTabs, ...liveBrowserTabs]
    const liveIdSet = new Set(liveIds)
    const tabGroups = this.appendBrowserTabOrder(
      (existing.tabGroups ?? []).map((group) => ({
        ...group,
        // Drop closed browser ids; appendBrowserTabOrder re-adds the live ones.
        tabOrder: group.tabOrder.filter(
          (id) => liveIdSet.has(id) || !existingBrowserIds.includes(id)
        )
      })),
      liveIds
    )
    const activeStillPresent = nextTabs.some((tab) => tab.id === existing.activeTabId)
    const active = activeStillPresent
      ? null
      : (nextTabs.find((tab) => tab.isActive) ?? nextTabs[0] ?? null)
    this.mobileSessionTabsByWorktree.set(worktreeId, {
      ...existing,
      publicationEpoch: `headless-hydrated:${Date.now().toString(36)}`,
      snapshotVersion: existing.snapshotVersion + 1,
      ...(activeStillPresent
        ? {}
        : { activeTabId: active?.id ?? null, activeTabType: active?.type ?? null }),
      tabGroups,
      tabs: nextTabs
    })
  }

  // Why: browser session tabs have no parentTabId so the terminal-only group
  // builder drops them from tabOrder; this re-adds their ids to a group.
  // Browser tabs are live-only (no persisted session entry), but their GROUP
  // membership must still survive snapshot rebuilds like terminals'. The

  // passed-in groups already encode each browser's group (carried from the prior
  // snapshot / persisted tabGroups), so keep each existing browser id where it
  // is; only a genuinely-new browser id goes to its create-target group (when
  // that group exists) and otherwise to the first group. Previously every
  // browser was force-pushed into group[0], so opening a browser in the right
  // split group always snapped it back to the left on the next rebuild.
  protected appendBrowserTabOrder(
    groups: readonly RuntimeMobileSessionTabGroup[],
    browserTabIds: readonly string[],
    newTabAssignment?: { tabId: string; groupId: string },
    // browserPageId -> groupId from the prior/persisted groups. The terminal
    // distributor rebuilds tabOrder from terminal ids only and drops browser
    // ids, so this carries each browser's group across rebuilds.
    priorGroupByBrowserId?: ReadonlyMap<string, string>
  ): RuntimeMobileSessionTabGroup[] {
    if (browserTabIds.length === 0) {
      return [...groups]
    }
    const next = groups.map((group) => ({ ...group, tabOrder: [...group.tabOrder] }))
    if (next.length === 0) {
      return next
    }
    const groupById = new Map(next.map((group) => [group.id, group]))
    const ownerGroupByTabId = new Map<string, RuntimeMobileSessionTabGroup>()
    for (const group of next) {
      for (const id of group.tabOrder) {
        ownerGroupByTabId.set(id, group)
      }
    }
    for (const id of browserTabIds) {
      if (ownerGroupByTabId.has(id)) {
        continue
      }
      const priorGroupId = priorGroupByBrowserId?.get(id)
      const targetGroup =
        (newTabAssignment?.tabId === id ? groupById.get(newTabAssignment.groupId) : undefined) ??
        (priorGroupId ? groupById.get(priorGroupId) : undefined) ??
        next[0]!
      targetGroup.tabOrder.push(id)
    }
    return next
  }

  // browserPageId -> groupId from a set of groups (the persisted/prior layout),
  // so a browser stays in its group across rebuilds that drop browser ids.
  protected collectBrowserGroupAssignment(
    groups: readonly RuntimeMobileSessionTabGroup[] | undefined,
    browserTabIds: readonly string[]
  ): Map<string, string> {
    const browserIdSet = new Set(browserTabIds)
    const assignment = new Map<string, string>()
    for (const group of groups ?? []) {
      for (const id of group.tabOrder) {
        if (browserIdSet.has(id)) {
          assignment.set(id, group.id)
        }
      }
    }
    return assignment
  }
  protected isServeOwnedPtyId(ptyId: string | null | undefined): boolean {
    return typeof ptyId === 'string' && ptyId.startsWith('serve-')
  }
  protected isSshOwnedPtyId(ptyId: string | null | undefined): boolean {
    return typeof ptyId === 'string' && parseAppSshPtyId(ptyId) !== null
  }
  protected isRecoverableSshTransportLoss(
    ptyId: string,
    connectionId: string | null,
    exitCode: number
  ): boolean {
    return this.isSshOwnedPtyId(ptyId) && connectionId !== null && exitCode < 0
  }
  protected workspaceSessionHasRuntimeOwnedPtyCandidate(session: WorkspaceSessionState): boolean {
    for (const tabs of Object.values(session.tabsByWorktree ?? {})) {
      for (const tab of tabs) {
        if (this.isServeOrSshOwnedPtyId(tab.ptyId)) {
          return true
        }
        const leafPtyIds = session.terminalLayoutsByTabId?.[tab.id]?.ptyIdsByLeafId
        if (
          leafPtyIds &&
          Object.values(leafPtyIds).some((ptyId) => this.isServeOrSshOwnedPtyId(ptyId))
        ) {
          return true
        }
      }
    }
    // Why: expiry clears the stale PTY id but retains pane coordinates so paired viewers can ask the HUB for a fresh shell.
    return Object.entries(session.tabsByWorktree ?? {}).some(([worktreeId, tabs]) =>
      tabs.some((tab) => this.getRecentExpiredSshLease(worktreeId, tab.id, undefined) !== null)
    )
  }
  protected getRecentExpiredSshLease(
    worktreeId: string,
    tabId: string,
    leafId: string | undefined,
    ptyId?: string
  ): ReturnType<NonNullable<RuntimeStore['getSshRemotePtyLeases']>>[number] | null {
    const now = Date.now()
    return (
      this.store
        ?.getSshRemotePtyLeases?.()
        .find(
          (lease) =>
            lease.state === 'expired' &&
            lease.worktreeId === worktreeId &&
            lease.tabId === tabId &&
            (ptyId === undefined || lease.ptyId === ptyId) &&
            (leafId === undefined || lease.leafId === undefined || lease.leafId === leafId) &&
            lease.updatedAt <= now &&
            now - lease.updatedAt <= SSH_PANE_RECOVERY_GRACE_MS
        ) ?? null
    )
  }
  protected hasRecentExpiredSshLeasePane(
    worktreeId: string,
    tab: RuntimeMobileSessionTerminalTab
  ): boolean {
    return this.getRecentExpiredSshLease(worktreeId, tab.parentTabId, tab.leafId) !== null
  }

  // Why: serve-* (local serve) and ssh:<conn>@@<relay> (SSH relay) ids are minted
  // ONLY for runtime-owned terminals and are preserved/re-hydrated, so tear them
  // down even if the renderer adopted a view (else they resurrect). The daemon
  // session form <worktreeId>@@<shortUuid> is deliberately NOT here: the daemon
  // mints it for ordinary renderer-owned local terminals too, so id shape can't
  // classify ownership for that form — renderer-graph membership does (below).
  protected isServeOrSshOwnedPtyId(ptyId: string | null | undefined): boolean {
    return this.isServeOwnedPtyId(ptyId) || this.isSshOwnedPtyId(ptyId)
  }
  protected hasServeOrSshOwnedBinding(tab: RuntimeMobileSessionTerminalTab): boolean {
    if (this.isServeOrSshOwnedPtyId(tab.ptyId)) {
      return true
    }
    return Object.values(tab.parentLayout?.ptyIdsByLeafId ?? {}).some((ptyId) =>
      this.isServeOrSshOwnedPtyId(ptyId)
    )
  }

  // Why: a snapshot tab can keep a serve/SSH-owned ptyId after the runtime
  // terminal died and was de-persisted, so id shape alone must not preserve it
  // against a renderer publication. Require the binding to be backed by a live
  // PTY or by the persisted workspace session (a dormant persisted serve/SSH
  // binding is still re-hydratable, so it stays preserved).
  protected hasLiveOrPersistedServeOrSshOwnedPtyBinding(
    worktreeId: string,
    tab: RuntimeMobileSessionTerminalTab
  ): boolean {
    const boundPtyIds = [
      tab.ptyId,
      ...Object.values(tab.parentLayout?.ptyIdsByLeafId ?? {})
    ].filter((ptyId): ptyId is string => this.isServeOrSshOwnedPtyId(ptyId))
    const boundSshPtyIds = boundPtyIds.filter((ptyId) => this.isSshOwnedPtyId(ptyId))
    if (boundPtyIds.length === 0) {
      return this.hasRecentExpiredSshLeasePane(worktreeId, tab)
    }
    // Why: exited PTY records are archived in ptysById, so require a connected
    // record — a dead serve shell whose persisted binding is also gone must
    // stop being preserved.
    if (boundPtyIds.some((ptyId) => this.ptysById.get(ptyId)?.connected === true)) {
      return true
    }
    const now = Date.now()
    if (
      boundPtyIds.some((ptyId) => {
        const pty = this.ptysById.get(ptyId)
        return (
          pty?.connectionId != null &&
          pty.lastExitCode != null &&
          pty.lastExitCode < 0 &&
          pty.disconnectedAt != null &&
          now - pty.disconnectedAt <= SSH_PANE_RECOVERY_GRACE_MS
        )
      })
    ) {
      // Why: an abnormal SSH transport exit can beat paired-viewer recovery; retain its pane briefly so the HUB remains addressable.
      return true
    }
    if (
      now - this.startedAt <= SSH_PANE_RECOVERY_GRACE_MS &&
      boundSshPtyIds.some((ptyId) => {
        const pty = this.ptysById.get(ptyId)
        return !pty || (!pty.connected && pty.lastExitCode === null)
      })
    ) {
      // Why: after a HUB restart, failed SSH reattach can remove persistence before the fresh runtime records an exit; keep the pane reachable for ensure.
      return true
    }
    const session = this.getWorkspaceSessionForWorktree(worktreeId)
    if (!session) {
      return false
    }
    const persistedTab = (session.tabsByWorktree?.[worktreeId] ?? []).find(
      (candidate) => candidate.id === tab.parentTabId
    )
    if (!persistedTab) {
      return false
    }
    const persistedPtyIds = new Set(
      [
        persistedTab.ptyId,
        ...Object.values(session.terminalLayoutsByTabId?.[persistedTab.id]?.ptyIdsByLeafId ?? {})
      ].filter((ptyId): ptyId is string => typeof ptyId === 'string')
    )
    return boundPtyIds.some((ptyId) => persistedPtyIds.has(ptyId))
  }
  protected hasLiveRuntimeSessionOwnedPtyBinding(
    worktreeId: string,
    tab: RuntimeMobileSessionTerminalTab
  ): boolean {
    const pty = this.findPtyForMobileTerminalTab(worktreeId, tab)
    return pty?.connected === true && pty.runtimeSessionOwned
  }
  protected clearRuntimeSessionOwnershipForMobileTab(
    worktreeId: string,
    snapshot: RuntimeMobileSessionTabsSnapshot,
    parentTabId: string
  ): void {
    for (const tab of snapshot.tabs) {
      if (tab.type !== 'terminal' || tab.parentTabId !== parentTabId) {
        continue
      }
      const ptyIds = [tab.ptyId, ...Object.values(tab.parentLayout?.ptyIdsByLeafId ?? {})].filter(
        (ptyId): ptyId is string => typeof ptyId === 'string'
      )
      for (const ptyId of ptyIds) {
        const pty = this.ptysById.get(ptyId)
        if (pty?.worktreeId === worktreeId && pty.tabId === parentTabId) {
          pty.runtimeSessionOwned = false
        }
      }
    }
  }

  // Why: a tab needs authoritative runtime teardown (kill + de-persist + prune)
  // only when the renderer can't durably tear it down: either it's serve/SSH
  // (preserved + re-hydrated, would resurrect) or the renderer graph never
  // published it (a leaked/unadopted shell — incl. daemon-session `@@` tabs the
  // host materialized but the renderer never showed). A tab the renderer graph
  // DOES list — including an ordinary daemon-backed local terminal or a pending
  // tab whose PTY hasn't bound — is renderer-owned: delegate, do not de-persist.
  protected isRuntimeOwnedHeadlessMobileTab(
    worktreeId: string,
    tab: RuntimeMobileSessionTerminalTab
  ): boolean {
    if (this.hasServeOrSshOwnedBinding(tab)) {
      return true
    }
    const pty = this.findPtyForMobileTerminalTab(worktreeId, tab)
    if (pty && this.isServeOrSshOwnedPtyId(pty.ptyId)) {
      return true
    }
    return !this.tabs.has(tab.parentTabId)
  }
  protected mergeMobileSessionSnapshotTabs(
    baseTabs: readonly RuntimeMobileSessionSnapshotTab[],
    extraTabs: readonly RuntimeMobileSessionSnapshotTab[]
  ): RuntimeMobileSessionSnapshotTab[] {
    const seenIds = new Set<string>()
    const merged: RuntimeMobileSessionSnapshotTab[] = []
    const add = (tab: RuntimeMobileSessionSnapshotTab): void => {
      const ids = this.getMobileSessionSnapshotTabIdentityKeys(tab)
      if (ids.some((id) => seenIds.has(id))) {
        return
      }
      for (const id of ids) {
        seenIds.add(id)
      }
      merged.push(tab)
    }
    for (const tab of baseTabs) {
      add(tab)
    }
    for (const tab of extraTabs) {
      add(tab)
    }
    return merged
  }
}
