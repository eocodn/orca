import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusIpcPayload,
  type AgentStatusEntry,
  normalizeCompatibleAgentStatusEntryForOwner,
  normalizeCompatibleAgentTitleForOwner,
  resolvePaneAgentOwner,
  type AgentProviderSessionMetadata,
  type SleepingAgentLaunchConfig,
  type RuntimeMobileSessionTerminalTab,
  FIRST_PANE_ID,
  isTerminalLeafId,
  makePaneKey,
  classifyAgentTitle,
  getLatestAgentCandidateTitle,
  getLatestPtyTitle,
  copySleepingAgentLaunchConfig,
  type RuntimePtyWorktreeRecord,
  type RuntimeAgentRowSnapshot
} from './orca-runtime-symbols'
import { OrcaRuntimeToMobileSessionTabsResultPart76 } from './orca-runtime-to-mobile-session-tabs-result-part-76'

export class OrcaRuntimeBuildPtyMobileAgentStatusPart77 extends OrcaRuntimeToMobileSessionTabsResultPart76 {
  protected buildPtyMobileAgentStatus(
    pty: RuntimePtyWorktreeRecord | null,
    tab: RuntimeMobileSessionTerminalTab,
    terminalHandle: string | null,
    retained: RuntimeAgentRowSnapshot | null,
    getHookRowsForPane: (paneKey: string) => AgentStatusIpcPayload[]
  ): { agentStatus: AgentStatusEntry } | Record<string, never> {
    const paneKey = this.getMobileTerminalPaneKey(tab)
    // Why: neither the OSC-retained row nor a title-derived status can carry a
    // provider session — only the hook payload does, and headless serve has no
    // renderer to publish `tab.agentStatus`. Without it mobile native chat has no
    // transcript to address and sits on the empty state forever.
    const hookRow = this.getHookAgentRowForPane(getHookRowsForPane(paneKey))
    // Why: the hook row is evidence in its own right. Returning early on a missing
    // PTY status/retained row put this check ahead of the only headless carrier, so
    // an agent that reported its session but never emitted a recognized title got no
    // `agentStatus` at all — exactly the hook-only case the fallback exists for.
    if (!pty?.lastAgentStatus && !retained && !hookRow.agentType && !hookRow.providerSession) {
      return {}
    }
    const providerSession = hookRow.providerSession
      ? { providerSession: hookRow.providerSession }
      : {}
    const leaf = this.leaves.get(this.getLeafKey(tab.parentTabId, tab.leafId)) ?? null
    const ptyTitle = pty
      ? getLatestAgentCandidateTitle(
          { title: pty.title, updatedAt: pty.titleUpdatedAt },
          { title: pty.lastOscTitle, updatedAt: pty.lastOscTitleAt }
        )
      : leaf
        ? getLatestAgentCandidateTitle(
            { title: leaf.paneTitle, updatedAt: leaf.paneTitleUpdatedAt },
            { title: leaf.lastOscTitle, updatedAt: leaf.lastOscTitleAt }
          )
        : null
    const ptyTitleClassification = classifyAgentTitle(ptyTitle)
    if (ptyTitle !== null && ptyTitleClassification !== 'agent') {
      // Why: non-agent title = shell reclaimed the pane; suppress to clear stuck spinners (#1437), though a live hook signal survives.
      const hasLiveHookSignal =
        retained?.payload.interactivePrompt != null ||
        retained?.payload.toolName != null ||
        // Why: headless serve has no renderer to retain an OSC row, so a fresh hook
        // agentType is the only live signal a hook-only pane can offer — and an agent
        // that reports over HTTP need never set a title this gate would recognize.
        // Scoped to panes with no PTY status at all, so it cannot revive a spinner:
        // this branch publishes `done`. It only keeps the transcript addressable.
        (!pty?.lastAgentStatus && (hookRow.agentType != null || hookRow.providerSession != null))
      if (!hasLiveHookSignal) {
        return {}
      }
    }
    // Why: a retained OMP hook stays stable while wrapper foreground reads can report Pi.
    const ownerAgent =
      resolvePaneAgentOwner({
        launchAgent: tab.launchAgent ?? pty?.launchAgent ?? null,
        hookAgent: retained?.payload.agentType ?? hookRow.agentType
      }) ??
      pty?.foregroundAgent ??
      null
    const terminalTitle = normalizeCompatibleAgentTitleForOwner(
      (pty ? getLatestPtyTitle(pty) : null) ?? tab.title,
      ownerAgent
    )
    // Why: OSC 9999 hook payload carries real state/prompt/agent; without preferring it, hook-only transitions never surfaced (#7970).
    if (retained) {
      return {
        agentStatus: normalizeCompatibleAgentStatusEntryForOwner(
          {
            ...retained.payload,
            paneKey,
            updatedAt: retained.updatedAt,
            stateStartedAt: retained.stateStartedAt,
            stateHistory: [],
            ...(terminalHandle ? { terminalHandle } : {}),
            ...((pty?.worktreeId ?? retained.worktreeId)
              ? { worktreeId: pty?.worktreeId ?? retained.worktreeId }
              : {}),
            tabId: tab.parentTabId,
            terminalTitle,
            ...providerSession
          },
          ownerAgent
        )
      }
    }
    // A hook-only pane has no PTY status to date the row from; `done` with a
    // now-stamp is the honest projection — the hook proves identity, not liveness.
    const now = pty?.lastOutputAt ?? Date.now()
    const agentType = ownerAgent ?? undefined
    return {
      agentStatus: {
        state:
          pty?.lastAgentStatus === 'working'
            ? 'working'
            : pty?.lastAgentStatus === 'permission'
              ? 'blocked'
              : 'done',
        prompt: '',
        updatedAt: now,
        stateStartedAt: now,
        paneKey,
        ...(terminalHandle ? { terminalHandle } : {}),
        ...(agentType ? { agentType } : {}),
        ...(pty?.worktreeId ? { worktreeId: pty.worktreeId } : {}),
        tabId: tab.parentTabId,
        terminalTitle,
        stateHistory: [],
        ...providerSession
      }
    }
  }

  /** Hook-reported identity for this pane, newest wins per field.
   *
   *  `providerSession` is deliberately unbounded: it is resume identity, not live
   *  state, it stays correct until the pane relaunches (which overwrites the row
   *  under the same paneKey), and it is only ever read once an agent is already
   *  established. Bounding it would blank mobile native chat on an idle session.
   *
   *  `agentType` is bounded by the same staleness window the retained OSC path uses,
   *  because it is the signal that claims an agent owns the pane at all. A user who
   *  exits the agent leaves `pty.lastAgentStatus` behind forever, so an unbounded
   *  read would keep offering native chat for what is now a plain shell. */
  protected getHookAgentRowForPane(rows: readonly AgentStatusIpcPayload[]): {
    providerSession: AgentProviderSessionMetadata | null
    providerSessionAgentType: string | null
    providerSessionReceivedAt: number | null
    agentType: string | null
  } {
    let session: AgentStatusIpcPayload | null = null
    let agent: AgentStatusIpcPayload | null = null
    const agentTypeFreshAfter = Date.now() - AGENT_STATUS_STALE_AFTER_MS
    // Why pane key only: the sibling `terminalHandle` arm this used to carry never
    // matched. `toAgentStatusIpcPayload` does not emit the field on the hook path
    // (only the renderer's own store stamps it, and headless serve has no renderer),
    // and because it is optional TypeScript could not flag the dead comparison.
    for (const entry of rows) {
      if (entry.providerSession && (!session || entry.receivedAt > session.receivedAt)) {
        session = entry
      }
      if (
        entry.agentType &&
        (entry.providerSessionOnly !== true ||
          (entry.agentType === 'pi' && entry.providerSession != null)) &&
        entry.receivedAt >= agentTypeFreshAfter &&
        (!agent || entry.receivedAt > agent.receivedAt)
      ) {
        agent = entry
      }
    }
    return {
      providerSession: session?.providerSession ?? null,
      providerSessionAgentType: session?.agentType ?? null,
      providerSessionReceivedAt: session?.receivedAt ?? null,
      agentType: agent?.agentType ?? null
    }
  }

  /** Retained OSC 9999 hook row for this mobile tab if still fresh; looked up by pane identity, then PTY ownership (legacy `pane:N` ids can drift). */
  protected getFreshRetainedAgentStatusForMobileTab(
    paneKey: string,
    pty: RuntimePtyWorktreeRecord | null,
    tab: RuntimeMobileSessionTerminalTab
  ): RuntimeAgentRowSnapshot | null {
    let retained = this.latestAgentStatusByPaneKey.get(paneKey) ?? null
    if (!retained) {
      const ptyId = pty?.ptyId ?? tab.ptyId ?? null
      if (ptyId) {
        for (const snapshot of this.latestAgentStatusByPaneKey.values()) {
          if (snapshot.ptyId !== ptyId) {
            continue
          }
          if (!retained || snapshot.updatedAt > retained.updatedAt) {
            retained = snapshot
          }
        }
      }
    }
    if (!retained || Date.now() - retained.updatedAt > AGENT_STATUS_STALE_AFTER_MS) {
      return null
    }
    return retained
  }
  protected findPtyForMobileTerminalTab(
    worktreeId: string,
    tab: RuntimeMobileSessionTerminalTab,
    options: { allowWorktreeOnlyMatch?: boolean } = {}
  ): RuntimePtyWorktreeRecord | null {
    const snapshotPtyId = tab.ptyId ?? tab.parentLayout?.ptyIdsByLeafId?.[tab.leafId] ?? null
    const paneKey = this.getMobileTerminalPaneKey(tab)
    if (snapshotPtyId) {
      const pty = this.ptysById.get(snapshotPtyId)
      if (!pty) {
        return null
      }
      // Why: persisted PTY ids can collide with unrelated provider ids after restart; only a matching spawn-time pane identity is safe to expose.
      if (this.mobileTerminalTabMatchesPty(worktreeId, tab, pty, paneKey)) {
        return pty
      }
      if (
        options.allowWorktreeOnlyMatch === true &&
        pty.worktreeId === worktreeId &&
        pty.tabId === null &&
        pty.paneKey === null
      ) {
        return pty
      }
      return null
    }
    const paneKeys = new Set([`${tab.parentTabId}:${tab.leafId}`])
    if (tab.leafId === `pane:${FIRST_PANE_ID}`) {
      paneKeys.add(`${tab.parentTabId}:${FIRST_PANE_ID}`)
    }
    for (const pty of this.ptysById.values()) {
      if (pty.tabId === tab.parentTabId && pty.paneKey && paneKeys.has(pty.paneKey)) {
        return pty
      }
    }
    return null
  }
  protected getMobileTerminalPaneKey(tab: RuntimeMobileSessionTerminalTab): string {
    if (isTerminalLeafId(tab.leafId)) {
      return makePaneKey(tab.parentTabId, tab.leafId)
    }
    const legacyPaneId = /^pane:(\d+)$/.exec(tab.leafId)?.[1] ?? null
    return `${tab.parentTabId}:${legacyPaneId ?? tab.leafId}`
  }
  protected mobileTerminalTabMatchesPty(
    worktreeId: string,
    tab: RuntimeMobileSessionTerminalTab,
    pty: RuntimePtyWorktreeRecord,
    paneKey = this.getMobileTerminalPaneKey(tab)
  ): boolean {
    return pty.worktreeId === worktreeId && pty.tabId === tab.parentTabId && pty.paneKey === paneKey
  }

  // Why: group address resolution (Section 4.5) queries per-handle status and must not throw on stale handles; return null on any error.
  getAgentStatusForHandle(handle: string): string | null {
    try {
      const ptyId = this.getTerminalAgentStatusPtyId(handle)
      return this.getTerminalAgentStatusSnapshot(handle, ptyId).titleStatus
    } catch {
      return null
    }
  }
  getAgentStatusTerminalHandleForPaneKey(paneKey: string): string | undefined {
    return this.getTerminalHandleForPaneKey(paneKey) ?? undefined
  }
  getAgentStatusLaunchConfigForPaneKey(
    paneKey: string,
    args?: { launchToken?: string }
  ): SleepingAgentLaunchConfig | undefined {
    const pty = this.getPtyRecordForPaneKey(paneKey)
    if (!pty?.launchConfig) {
      return undefined
    }
    if (pty.launchToken === null || pty.launchToken !== args?.launchToken) {
      return undefined
    }
    return copySleepingAgentLaunchConfig(pty.launchConfig)
  }
}
