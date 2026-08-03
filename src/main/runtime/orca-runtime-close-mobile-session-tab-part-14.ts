import { type RuntimeMobileSessionTabCloseResult, type RuntimeMobileSessionTerminalTab, type RuntimeMobileSessionBrowserTab, type RuntimeMobileSessionTabsSnapshot, type RuntimeSessionTabCloseReason } from './orca-runtime-symbols'
import { OrcaRuntimeActivateMobileSessionTabPart13 } from './orca-runtime-activate-mobile-session-tab-part-13'

export class OrcaRuntimeCloseMobileSessionTabPart14 extends OrcaRuntimeActivateMobileSessionTabPart13 {
  async closeMobileSessionTab(
    worktreeSelector: string,
    tabId: string,
    options: {
      reason?: RuntimeSessionTabCloseReason
      expectedPublicationEpoch?: string
      expectedTerminalHandle?: string
    } = {}
  ): Promise<RuntimeMobileSessionTabCloseResult> {
    const explicitWorktreeId = this.getValidatedExplicitWorktreeIdSelector(worktreeSelector)
    const worktreeId =
      explicitWorktreeId ?? (await this.resolveWorktreeSelector(worktreeSelector)).id
    this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(worktreeId)
    const observedPtyIds = await this.refreshMobileSessionPtyRecords()
    const snapshot = this.mobileSessionTabsByWorktree.get(worktreeId)
    if (options.reason !== undefined && options.reason !== 'user' && observedPtyIds === null) {
      // Why: keep-on-unknown must also restore the mirror the caller already pruned.
      this.republishMobileSessionTabsSnapshot(worktreeId)
      return {
        closed: true,
        refused: true,
        refusalReason: 'unknown-liveness',
        ...(snapshot ? { snapshotRepublished: true as const } : {})
      }
    }
    if (
      options.expectedPublicationEpoch !== undefined &&
      snapshot?.publicationEpoch !== options.expectedPublicationEpoch
    ) {
      this.republishMobileSessionTabsSnapshot(worktreeId)
      return {
        closed: true,
        refused: true,
        refusalReason: 'stale-publication',
        ...(snapshot ? { snapshotRepublished: true as const } : {})
      }
    }
    const tab =
      snapshot?.tabs.find((candidate) => candidate.id === tabId) ??
      snapshot?.tabs.find(
        (candidate) => candidate.type === 'terminal' && candidate.parentTabId === tabId
      ) ??
      snapshot?.tabs.find(
        (candidate) => candidate.type === 'browser' && candidate.browserWorkspaceId === tabId
      )
    if (!tab) {
      throw new Error('tab_not_found')
    }
    if (options.expectedTerminalHandle !== undefined) {
      const terminalIncarnationMatches =
        tab.type === 'terminal' &&
        snapshot!.tabs.some(
          (candidate) =>
            candidate.type === 'terminal' &&
            candidate.parentTabId === tab.parentTabId &&
            this.getMobileSessionTerminalHandle(worktreeId, candidate) ===
              options.expectedTerminalHandle
        )
      if (!terminalIncarnationMatches) {
        this.republishMobileSessionTabsSnapshot(worktreeId)
        return {
          closed: true,
          refused: true,
          refusalReason: 'stale-terminal',
          snapshotRepublished: true
        }
      }
    }
    if (tab.type === 'terminal') {
      const parentLeafCount = snapshot!.tabs.filter(
        (candidate) => candidate.type === 'terminal' && candidate.parentTabId === tab.parentTabId
      ).length
      const closingWholeParent = tab.id !== tabId || parentLeafCount <= 1
      // Why: a non-'user' reason is a client-lifecycle echo ("terminal gone"),
      // not authorization to kill. Every destructive branch below can take the
      // whole parent down, so any live PTY under the parent means the echo is a
      // transport artifact: refuse the close and republish the snapshot so the
      // echoing client re-syncs and re-attaches. A reasonless close keeps
      // legacy behavior — old clients send user closes without the field.
      if (options.reason !== undefined && options.reason !== 'user') {
        const parentLeaves = snapshot!.tabs.filter(
          (candidate): candidate is RuntimeMobileSessionTerminalTab =>
            candidate.type === 'terminal' && candidate.parentTabId === tab.parentTabId
        )
        // Why: exited PTYs keep a disconnected record in ptysById for status
        // reads (and a still-synced leaf retains its record), so record
        // presence is not liveness — only `connected` counts, or a genuinely
        // dead tab never retires and the echo loops forever.
        const leafHasConnectedPty = (leaf: RuntimeMobileSessionTerminalTab): boolean => {
          const snapshotPtyIds = [
            leaf.ptyId,
            leaf.parentLayout?.ptyIdsByLeafId?.[leaf.leafId]
          ].filter((ptyId): ptyId is string => Boolean(ptyId))
          // Why: daemon discovery can prove the PTY live before its pane binding
          // reconnects; missing metadata is never authority to retire it.
          return (
            this.findPtyForMobileTerminalTab(worktreeId, leaf)?.connected === true ||
            snapshotPtyIds.some((ptyId) => observedPtyIds?.has(ptyId) === true)
          )
        }
        if (parentLeaves.some(leafHasConnectedPty)) {
          // Why: when the echo addresses a dead leaf under a live sibling we
          // still refuse (every reachable close path below destroys the whole
          // parent, live sibling included) but skip the republish — re-adding
          // the dead leaf on the echoing client would feed an endless
          // refuse→republish→re-echo cycle.
          const addressedDeadLeaf = tab.id === tabId && !leafHasConnectedPty(tab)
          if (!addressedDeadLeaf) {
            this.republishMobileSessionTabsSnapshot(worktreeId)
          }
          // Why: both markers are skew-safe; clients must restore a mirror only
          // when the host actually republished it, not for a dead leaf.
          return {
            closed: true,
            refused: true,
            refusalReason: 'live-host-pty',
            ...(!addressedDeadLeaf ? { snapshotRepublished: true as const } : {})
          }
        }
        if (!closingWholeParent || this.tabs.has(tab.parentTabId)) {
          // Why: only the renderer may retire its own tab or split leaf; a
          // remote lifecycle echo must never cross that boundary into a kill.
          return {

            closed: true,
            refused: true,
            refusalReason: 'retirement-owner'
          }
        }
      }
      // Why: a runtime-owned headless tab is absent from renderer state, so the
      // closeTerminalTab relay below would ack success without killing its PTY,
      // and syncMobileSessionTabs would republish the "closed" tab. Only bypass
      // the relay when no renderer owns the parent: an adopted tab needs the
      // renderer's live pin guard and durable close transaction.
      if (closingWholeParent && !this.tabs.has(tab.parentTabId)) {
        this.closeHeadlessMobileTerminalTab(worktreeId, snapshot!, tab, {
          killPtys: options.reason === undefined || options.reason === 'user'
        })
        this.notifyRendererOfHeadlessTerminalClose(tab.parentTabId)
        this.store?.flushOrThrow?.()
        return { closed: true }
      }
      if (closingWholeParent && this.notifier?.closeTerminalTab) {
        // Why: whole-tab close is a lifecycle transaction. The renderer reply
        // arrives only after canonical retirement and a forced session flush.
        await this.notifier.closeTerminalTab(tab.parentTabId)
        const remainingSnapshot = this.mobileSessionTabsByWorktree.get(worktreeId)
        const remainingTab = remainingSnapshot?.tabs.find(
          (candidate): candidate is RuntimeMobileSessionTerminalTab =>
            candidate.type === 'terminal' && candidate.parentTabId === tab.parentTabId
        )
        if (
          remainingSnapshot &&
          remainingTab &&
          this.isRuntimeOwnedHeadlessMobileTab(worktreeId, remainingTab)
        ) {
          // Why: after relay recovery the renderer can acknowledge a tab it no longer mirrors; the HUB must still retire its SSH-owned surface.
          this.closeHeadlessMobileTerminalTab(worktreeId, remainingSnapshot, remainingTab)
          this.notifyRendererOfHeadlessTerminalClose(tab.parentTabId)
          this.store?.flushOrThrow?.()
        }
        this.clearRuntimeSessionOwnershipForMobileTab(worktreeId, snapshot!, tab.parentTabId)
        return { closed: true }
      }
      // Why: notifier implementations without the acknowledged relay may expose
      // only raw pane close. Runtime-owned parents still need de-persist + kill.
      if (closingWholeParent && this.isRuntimeOwnedHeadlessMobileTab(worktreeId, tab)) {
        this.closeHeadlessMobileTerminalTab(worktreeId, snapshot!, tab)
        this.notifyRendererOfHeadlessTerminalClose(tab.parentTabId)
        this.store?.flushOrThrow?.()
        return { closed: true }
      }
      if (!this.notifier?.closeTerminal) {
        this.closeHeadlessMobileTerminalTab(worktreeId, snapshot!, tab)
        this.store?.flushOrThrow?.()
        return { closed: true }
      }
      if (tab.id === tabId) {
        const pty = this.findPtyForMobileTerminalTab(worktreeId, tab)
        if (pty) {
          this.ptyController?.kill(pty.ptyId)
        } else {
          this.notifier?.closeTerminal(tab.parentTabId)
        }
      } else {
        // Why: paired web tab bars represent a split terminal with one local
        // parent tab id. Closing that parent should close the desktop tab, not
        // just whichever leaf happened to be first in the session snapshot.
        this.notifier?.closeTerminal(tab.parentTabId)
        this.clearRuntimeSessionOwnershipForMobileTab(worktreeId, snapshot!, tab.parentTabId)
      }
    } else if (tab.type === 'browser' && this.offscreenBrowserBackend) {
      // Why: headless browser tabs are offscreen WebContents with no renderer to
      // route closeSessionTab to. Close the page directly and drop it from the
      // snapshot so paired clients stop showing it.
      await this.closeHeadlessMobileBrowserTab(worktreeId, snapshot!, tab)
    } else {
      this.notifier?.closeSessionTab?.(tab.id, worktreeId)
    }
    return { closed: true }
  }

  // Why: a refused echoed close means the echoing client already pruned its
  // local mirror. Bump the version and emit the unchanged snapshot so clients
  // that dedupe by snapshotVersion re-add and re-attach the still-live tab.
  protected republishMobileSessionTabsSnapshot(worktreeId: string): void {
    const snapshot = this.mobileSessionTabsByWorktree.get(worktreeId)
    if (snapshot) {
      this.mobileSessionTabsByWorktree.set(worktreeId, {
        ...snapshot,
        snapshotVersion: snapshot.snapshotVersion + 1
      })
    }
    this.notifyMobileSessionTabsChanged(worktreeId)
  }
  protected getMobileSessionTerminalHandle(
    worktreeId: string,
    tab: RuntimeMobileSessionTerminalTab
  ): string | null {
    const pty = this.findPtyForMobileTerminalTab(worktreeId, tab)
    if (!pty) {
      return null
    }
    return this.handleByPtyId.get(pty.ptyId) ?? this.findHandleForPtyRecord(pty.ptyId)
  }
  protected notifyRendererOfHeadlessTerminalClose(parentTabId: string): void {
    // Why: this relay is advisory after main owns teardown; renderer failure must
    // not prevent the authoritative session flush or turn the close into failure.
    try {
      this.notifier?.closeTerminal(parentTabId)
    } catch (error) {
      console.warn('[runtime] failed to notify renderer after headless terminal close', {
        parentTabId,
        error
      })
    }
  }
  protected async closeHeadlessMobileBrowserTab(
    worktreeId: string,
    snapshot: RuntimeMobileSessionTabsSnapshot,
    tab: RuntimeMobileSessionBrowserTab
  ): Promise<void> {
    if (tab.browserPageId) {
      await this.offscreenBrowserBackend?.closeTab(tab.browserPageId).catch(() => {})
    }
    const nextTabs = snapshot.tabs.filter((candidate) => candidate.id !== tab.id)
    const active = nextTabs.find((candidate) => candidate.isActive) ?? nextTabs[0] ?? null
    const nextSnapshot: RuntimeMobileSessionTabsSnapshot = {
      ...snapshot,
      publicationEpoch: `headless:${Date.now().toString(36)}`,
      snapshotVersion: snapshot.snapshotVersion + 1,
      activeTabId: active?.id ?? null,
      activeTabType: active?.type ?? null,
      tabGroups: (snapshot.tabGroups ?? []).map((group) => ({
        ...group,
        tabOrder: group.tabOrder.filter((id) => id !== tab.id),
        activeTabId: group.activeTabId === tab.id ? null : group.activeTabId
      })),
      tabs: nextTabs
    }
    this.mobileSessionTabsByWorktree.set(worktreeId, nextSnapshot)
    this.emitMobileSessionTabsSnapshot(nextSnapshot)
  }
}
