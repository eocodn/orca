import { type AgentStatusIpcPayload, indexAgentStatusRowsByPaneKey, normalizeCompatibleAgentStatusEntryForOwner, normalizeCompatibleAgentTitleForOwner, resolveCompatibleAgentTypeForOwner, resolvePaneAgentOwner, type RuntimeMobileSessionClientTab, type RuntimeMobileSessionTabsResult, type RuntimeMobileSessionTabsSnapshot, isTerminalLeafId, makePaneKey, classifyAgentTitle, getLatestAgentCandidateTitle } from './orca-runtime-symbols'
import { OrcaRuntimeBuildPreservedHeadlessMobileSessionSnapshotPart75 } from './orca-runtime-build-preserved-headless-mobile-session-snapshot-part-75'

export class OrcaRuntimeToMobileSessionTabsResultPart76 extends OrcaRuntimeBuildPreservedHeadlessMobileSessionSnapshotPart75 {
  protected toMobileSessionTabsResult(
    snapshot: RuntimeMobileSessionTabsSnapshot
  ): RuntimeMobileSessionTabsResult {
    const tabs: RuntimeMobileSessionClientTab[] = []
    const liveBrowserTabsByPageId = this.getLiveBrowserTabsByPageId(snapshot.worktree)
    // Production reads hook rows by pane; the snapshot fallback remains for tests
    // and embedders that have not adopted the narrow getter.
    let hookRowsByPaneKey: Map<string, AgentStatusIpcPayload[]> | null = null
    const hookRowsForPane = new Map<string, AgentStatusIpcPayload[]>()
    const getHookRowsForPane = (paneKey: string): AgentStatusIpcPayload[] => {
      const cached = hookRowsForPane.get(paneKey)
      if (cached) {
        return cached
      }
      const direct = this.getAgentProviderSessionRowsForPaneFn?.(paneKey)
      if (direct) {
        hookRowsForPane.set(paneKey, direct)
        return direct
      }
      hookRowsByPaneKey ??= indexAgentStatusRowsByPaneKey(
        this.getAgentProviderSessionSnapshotFn?.() ?? []
      )
      const rows = hookRowsByPaneKey.get(paneKey) ?? []
      hookRowsForPane.set(paneKey, rows)
      return rows
    }
    // Why: a live PTY backs one surface; claim each once so two leaves resolving to it can't emit duplicate React keys and crash the client.
    const claimedLivePtyIds = new Set<string>()
    for (const tab of snapshot.tabs) {
      if (tab.type === 'browser') {
        const liveTab = tab.browserPageId
          ? liveBrowserTabsByPageId.get(tab.browserPageId)
          : undefined
        if (!liveTab) {
          continue
        }
        // Why: renderer snapshots lag BrowserView teardown/process swaps; only surface pages the browser bridge can still route to.
        tabs.push({
          ...tab,
          title: liveTab.title || tab.title,
          url: liveTab.url || tab.url,
          // Why: bridge "active" means active BrowserView/webContents, not active Orca tab; preserve the renderer's session focus.
          isActive: tab.isActive
        })
        continue
      }
      if (tab.type === 'markdown' || tab.type === 'file') {
        tabs.push(tab)
        continue
      }
      const syncedTab = this.tabs.get(tab.parentTabId)
      const leaf = this.leaves.get(this.getLeafKey(tab.parentTabId, tab.leafId)) ?? null
      const liveLeaf = leaf?.ptyId && leaf.connected ? leaf : null
      const liveLeafPtyId = liveLeaf?.ptyId ?? null
      const liveLeafPty = liveLeafPtyId ? (this.ptysById.get(liveLeafPtyId) ?? null) : null
      const pty = liveLeaf
        ? null
        : this.findPtyForMobileTerminalTab(snapshot.worktree, tab, {
            allowWorktreeOnlyMatch: !snapshot.publicationEpoch.startsWith('headless')
          })
      const livePty = pty?.connected ? pty : null
      // Why: enforce one-live-PTY-per-tab; drop a later tab resolving to an already-claimed PTY so no two tabs share a handle.
      const resolvedLivePtyId = liveLeafPtyId ?? livePty?.ptyId ?? null
      if (resolvedLivePtyId !== null) {
        if (claimedLivePtyIds.has(resolvedLivePtyId)) {
          continue
        }
        claimedLivePtyIds.add(resolvedLivePtyId)
      }
      const legacyPaneId = /^pane:(\d+)$/.exec(tab.leafId)?.[1] ?? null
      const paneKey = isTerminalLeafId(tab.leafId)
        ? makePaneKey(tab.parentTabId, tab.leafId)
        : `${tab.parentTabId}:${legacyPaneId ?? tab.leafId}`
      const mobileStatusPty = livePty ?? pty
      // Why: headless hooks live only in main's retained rows; reuse this lookup
      // for both title ownership and status publication so the two cannot diverge.
      const retainedAgentStatus = tab.agentStatus
        ? null
        : this.getFreshRetainedAgentStatusForMobileTab(paneKey, liveLeafPty ?? mobileStatusPty, tab)
      const hookAgentStatus = tab.agentStatus
        ? this.getHookAgentRowForPane(getHookRowsForPane(paneKey))
        : null
      const leafTitle = leaf
        ? getLatestAgentCandidateTitle(
            { title: leaf.paneTitle, updatedAt: leaf.paneTitleUpdatedAt },
            { title: leaf.lastOscTitle, updatedAt: leaf.lastOscTitleAt }
          )
        : null
      const ptyTitle = pty
        ? getLatestAgentCandidateTitle(
            { title: pty.title, updatedAt: pty.titleUpdatedAt },
            { title: pty.lastOscTitle, updatedAt: pty.lastOscTitleAt }
          )
        : null
      const launchAgent = tab.launchAgent ?? liveLeafPty?.launchAgent ?? pty?.launchAgent ?? null
      // Why: a retained OMP hook stays stable while wrapper foreground reads can report Pi.
      const ownerAgent =
        resolvePaneAgentOwner({
          launchAgent,
          hookAgent:
            tab.agentStatus?.agentType ??
            hookAgentStatus?.agentType ??
            retainedAgentStatus?.payload.agentType ??
            null
        }) ??
        liveLeafPty?.foregroundAgent ??
        pty?.foregroundAgent ??
        null
      const title = normalizeCompatibleAgentTitleForOwner(
        leafTitle ?? ptyTitle ?? syncedTab?.title ?? tab.title,
        ownerAgent
      )
      const liveTitleEvidence = leafTitle ?? ptyTitle
      const liveTitleEvidenceClassification = classifyAgentTitle(liveTitleEvidence)
      // Why: renderer status can precede hook session identity, leaving native chat with no transcript address.
      const rendererStatusAgent =
        resolveCompatibleAgentTypeForOwner(tab.agentStatus?.agentType, ownerAgent) ??
        ownerAgent ??
        undefined
      const hookSessionAgent = resolveCompatibleAgentTypeForOwner(
        hookAgentStatus?.providerSessionAgentType,
        ownerAgent
      )
      const hookSessionMatchesRenderer =
        !rendererStatusAgent || !hookSessionAgent || rendererStatusAgent === hookSessionAgent
      const hookProviderSession =
        hookAgentStatus?.providerSession &&
        hookSessionMatchesRenderer &&
        (!tab.agentStatus?.providerSession ||
          (hookAgentStatus.providerSessionReceivedAt ?? -1) >= tab.agentStatus.updatedAt)
          ? hookAgentStatus.providerSession
          : tab.agentStatus?.providerSession
      const normalizedTabAgentStatus = tab.agentStatus
        ? normalizeCompatibleAgentStatusEntryForOwner(
            {
              ...tab.agentStatus,
              ...(hookProviderSession ? { providerSession: hookProviderSession } : {})
            },
            ownerAgent
          )
        : null
      // Why: keep rich hook status on a live prompt/tool (authoritative even under a non-agent title), else interactivePrompt is lost.
      const hasLiveAgentSignal =
        normalizedTabAgentStatus?.interactivePrompt != null ||
        normalizedTabAgentStatus?.toolName != null
      const keepFullAgentStatus =
        normalizedTabAgentStatus &&
        (liveTitleEvidence === null ||
          liveTitleEvidenceClassification === 'agent' ||
          hasLiveAgentSignal)
      const agentStatus = keepFullAgentStatus
        ? { agentStatus: normalizedTabAgentStatus }
        : // Why: idle live title → drop stale "working" (no spinner) but keep agent identity so native chat can still address the transcript.
          normalizedTabAgentStatus?.agentType != null
          ? {
              agentStatus: {
                state: 'done' as const,
                prompt: '',
                updatedAt: normalizedTabAgentStatus.updatedAt,
                stateStartedAt: normalizedTabAgentStatus.stateStartedAt,
                paneKey: normalizedTabAgentStatus.paneKey,
                stateHistory: [],
                agentType: normalizedTabAgentStatus.agentType,
                ...(normalizedTabAgentStatus.providerSession
                  ? { providerSession: normalizedTabAgentStatus.providerSession }
                  : {})
              }
            }
          : null
      // Why: web/mobile clients hold handles across renderer graph syncs; leaf handles are epoch-bound but PTY handles stay streamable.
      const terminalHandle = liveLeafPtyId
        ? this.issuePtyHandle(
            this.recordPtyWorktree(liveLeafPtyId, snapshot.worktree, {
              tabId: tab.parentTabId,
              paneKey
            })
          )
        : livePty
          ? this.issuePtyHandle(livePty)
          : null
      tabs.push({
        type: 'terminal',
        id: tab.id,
        parentTabId: tab.parentTabId,
        leafId: tab.leafId,
        title,
        ...(tab.ptyId ? { ptyId: tab.ptyId } : {}),
        ...(tab.terminalTheme ? { terminalTheme: tab.terminalTheme } : {}),
        ...(launchAgent ? { launchAgent } : {}),
        ...(agentStatus ??
          this.buildPtyMobileAgentStatus(
            mobileStatusPty,
            tab,
            terminalHandle,
            retainedAgentStatus,
            getHookRowsForPane
          )),
        ...(tab.parentLayout ? { parentLayout: tab.parentLayout } : {}),
        ...(tab.startupCwd ? { startupCwd: tab.startupCwd } : {}),
        ...(tab.color != null ? { color: tab.color } : {}),
        ...(tab.isPinned ? { isPinned: true } : {}),
        ...(tab.viewMode ? { viewMode: tab.viewMode } : {}),
        ...(tab.launchDraft ? { launchDraft: tab.launchDraft } : {}),
        ...(tab.launchDraftCreatedAt !== undefined
          ? { launchDraftCreatedAt: tab.launchDraftCreatedAt }
          : {}),
        isActive: tab.isActive,
        ...(terminalHandle
          ? { status: 'ready' as const, terminal: terminalHandle }
          : { status: 'pending-handle' as const, terminal: null })
      })
    }
    const active =
      tabs.find((tab) => tab.isActive && tab.id === snapshot.activeTabId) ??
      tabs.find((tab) => tab.isActive) ??
      (snapshot.activeTabId ? (tabs[0] ?? null) : null)
    const normalizedTabs =
      active && !tabs.some((tab) => tab.isActive)
        ? tabs.map((tab) => (tab.id === active.id ? { ...tab, isActive: true } : tab))
        : tabs
    const tabGroups = this.sanitizeMobileSessionTabGroups(snapshot.tabGroups, normalizedTabs)
    const validGroupIds = new Set(tabGroups?.map((group) => group.id) ?? [])
    const tabGroupLayout =
      snapshot.tabGroupLayout === undefined
        ? undefined
        : this.pruneMobileSessionTabGroupLayout(snapshot.tabGroupLayout, validGroupIds)
    const activeGroupId =
      snapshot.activeGroupId && validGroupIds.has(snapshot.activeGroupId)
        ? snapshot.activeGroupId
        : (tabGroups?.find((group) =>
            active
              ? group.tabOrder.some((tabId) =>
                  this.collectReturnedSessionTabIds([active]).has(tabId)
                )
              : false

          )?.id ??
          tabGroups?.[0]?.id ??
          null)
    return {
      worktree: snapshot.worktree,
      publicationEpoch: snapshot.publicationEpoch,
      snapshotVersion: snapshot.snapshotVersion,
      activeGroupId,
      activeTabId: active?.id ?? null,
      activeTabType: active?.type ?? null,
      ...(tabGroups ? { tabGroups } : {}),
      ...(snapshot.tabGroupLayout !== undefined ? { tabGroupLayout } : {}),
      tabs: normalizedTabs
    }
  }

  /** Mobile-friendly status entry for a PTY, aligning agentType and titles with the active owner. */
}
