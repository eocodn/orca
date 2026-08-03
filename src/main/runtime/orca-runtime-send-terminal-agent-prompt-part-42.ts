import { detectAgentStatusFromTitle, isShellProcess, type AgentStatus, AGENT_STATUS_STALE_AFTER_MS, type AgentStatusEntry, hasCompatibleAgentTitleIdentity, AGENT_PROMPT_SUBMIT, buildAgentPromptPasteBytes, type RuntimeTerminalAgentStatus, type RuntimeTerminalSend, recognizeAgentProcess, detectTerminalWaitBlockedReason, buildTerminalWaitText, assertTerminalInputWithinLimitWithYield, getTerminalState, getLatestAgentCandidateTitleInfo, mapExplicitAgentStateToRuntimeTerminalStatus, terminalTitleBlocksExplicitAgentStatus, type RuntimePtyWorktreeRecord, type PtyForegroundAgentRefresh } from './orca-runtime-symbols'
import { OrcaRuntimeResolveTerminalPanePart41 } from './orca-runtime-resolve-terminal-pane-part-41'

export class OrcaRuntimeSendTerminalAgentPromptPart42 extends OrcaRuntimeResolveTerminalPanePart41 {
  async sendTerminalAgentPrompt(
    handle: string,
    prompt: string,
    options: {
      beforeWrite?: (ptyId: string) => void | Promise<void>
      suffixFailureError?: string
    } = {}
  ): Promise<RuntimeTerminalSend> {
    const payload = buildAgentPromptPasteBytes(prompt)
    const bytesWritten = Buffer.byteLength(`${payload}${AGENT_PROMPT_SUBMIT}`, 'utf8')
    const pty = this.getLivePtyForHandle(handle)
    if (pty) {
      if (!pty.pty.connected) {
        throw new Error('terminal_not_writable')
      }
      await assertTerminalInputWithinLimitWithYield(payload)
      await this.writeTerminalAgentPrompt(pty.pty.ptyId, payload, options)
      return { handle, accepted: true, bytesWritten }
    }

    const { leaf } = this.getLiveLeafForHandle(handle)
    if (!leaf.writable || !leaf.ptyId) {
      throw new Error('terminal_not_writable')
    }
    await assertTerminalInputWithinLimitWithYield(payload)
    await this.writeTerminalAgentPrompt(leaf.ptyId, payload, options)
    return { handle, accepted: true, bytesWritten }
  }
  async getTerminalAgentStatus(handle: string): Promise<RuntimeTerminalAgentStatus> {
    const ptyId = this.getTerminalAgentStatusPtyId(handle)
    const terminal = this.getTerminalAgentStatusSnapshot(handle, ptyId)
    const explicitStatus = this.getFreshExplicitAgentStatusForHandle(handle)
    const blockedByWaitText = detectTerminalWaitBlockedReason(terminal.waitText)
    const liveTitleClearsBlockedText =
      terminal.titleStatusIsLive &&
      terminal.titleStatus !== null &&
      terminal.titleStatus !== 'permission'
    if (terminal.titleStatus === 'permission' && terminal.titleStatusIsLive) {
      return { handle, isRunningAgent: true, status: 'permission' }
    }
    if (
      blockedByWaitText &&
      !liveTitleClearsBlockedText &&
      (!explicitStatus ||
        explicitStatus.status === 'permission' ||
        (terminal.waitBlockedAt !== null && terminal.waitBlockedAt >= explicitStatus.updatedAt))
    ) {
      return { handle, isRunningAgent: true, status: 'permission' }
    }
    if (explicitStatus) {
      // Why: permission titles can linger after hooks report the agent resumed.
      // Fresh hook state is tighter, but current shell/management evidence wins.
      const isRunningAgent =
        !terminalTitleBlocksExplicitAgentStatus(terminal.title) &&
        !(await this.terminalHasShellForegroundProcess(handle, ptyId))
      this.assertTerminalAgentStatusPtyBinding(handle, ptyId)
      return {
        handle,
        isRunningAgent,
        status: isRunningAgent ? explicitStatus.status : null
      }
    }
    if (terminal.titleStatus) {
      return { handle, isRunningAgent: true, status: terminal.titleStatus }
    }

    const isRunningAgent = await this.isTerminalRunningAgent(handle)
    this.assertTerminalAgentStatusPtyBinding(handle, ptyId)
    return { handle, isRunningAgent, status: null }
  }
  protected getTerminalAgentStatusPtyId(handle: string): string {
    const pty = this.getLivePtyForHandle(handle)
    if (pty) {
      if (!pty.pty.connected) {
        throw new Error('terminal_gone')
      }
      return pty.pty.ptyId
    }
    const { leaf } = this.getLiveLeafForHandle(handle)
    if (getTerminalState(leaf) !== 'running') {
      throw new Error('terminal_exited')
    }
    if (!leaf.ptyId) {
      throw new Error('terminal_gone')
    }
    return leaf.ptyId
  }
  protected assertTerminalAgentStatusPtyBinding(handle: string, expectedPtyId: string): void {
    if (this.getTerminalAgentStatusPtyId(handle) === expectedPtyId) {
      return
    }
    // Why: delayed process evidence belongs only to the PTY that started the
    // read, while callers still rely on the established stale-handle contract.
    throw new Error('terminal_handle_stale')
  }
  protected getTerminalAgentStatusSnapshot(
    handle: string,
    expectedPtyId: string
  ): {
    waitText: string
    waitBlockedAt: number | null
    title: string | null
    titleStatus: AgentStatus | null
    titleStatusIsLive: boolean
  } {
    const pty = this.getLivePtyForHandle(handle)
    if (pty) {
      if (!pty.pty.connected || pty.pty.ptyId !== expectedPtyId) {
        throw new Error('terminal_not_writable')
      }
      const leaf = this.getPrimaryLeafForPty(pty.pty.ptyId)
      const leafTitle = leaf
        ? getLatestAgentCandidateTitleInfo(
            { title: leaf.paneTitle, updatedAt: leaf.paneTitleUpdatedAt },
            { title: leaf.lastOscTitle, updatedAt: leaf.lastOscTitleAt }
          )
        : null
      const ptyTitle =
        leafTitle ??
        getLatestAgentCandidateTitleInfo(
          { title: pty.pty.title, updatedAt: pty.pty.titleUpdatedAt },
          { title: pty.pty.lastOscTitle, updatedAt: pty.pty.lastOscTitleAt }
        )
      const waitText = buildTerminalWaitText(
        pty.pty.tailBuffer,
        pty.pty.tailPartialLine,
        pty.pty.preview
      )
      return {
        waitText,
        waitBlockedAt: pty.pty.waitBlockedAt,
        title: ptyTitle?.title ?? null,
        titleStatus: ptyTitle
          ? detectAgentStatusFromTitle(ptyTitle.title)
          : pty.pty.lastAgentStatus,
        titleStatusIsLive: ptyTitle !== null
      }
    }

    const { leaf } = this.getLiveLeafForHandle(handle)
    if (getTerminalState(leaf) !== 'running') {
      throw new Error('terminal_exited')
    }
    if (!leaf.ptyId) {
      throw new Error('terminal_gone')
    }
    if (leaf.ptyId !== expectedPtyId) {
      throw new Error('terminal_not_writable')
    }
    const title = getLatestAgentCandidateTitleInfo(
      { title: leaf.paneTitle, updatedAt: leaf.paneTitleUpdatedAt },
      { title: leaf.lastOscTitle, updatedAt: leaf.lastOscTitleAt },
      { title: this.tabs.get(leaf.tabId)?.title, updatedAt: 0 }
    )
    return {
      waitText: buildTerminalWaitText(leaf.tailBuffer, leaf.tailPartialLine, leaf.preview),
      waitBlockedAt: leaf.waitBlockedAt,
      title: title?.title ?? null,
      titleStatus: title ? detectAgentStatusFromTitle(title.title) : leaf.lastAgentStatus,
      titleStatusIsLive: (title?.updatedAt ?? 0) > 0
    }
  }
  protected async terminalHasShellForegroundProcess(handle: string, ptyId: string): Promise<boolean> {
    if (!this.ptyController) {
      return false
    }
    let foregroundProcess: string | null
    try {
      foregroundProcess = await this.ptyController.getForegroundProcess(ptyId)
    } catch {
      this.assertTerminalAgentStatusPtyBinding(handle, ptyId)
      return false
    }
    this.assertTerminalAgentStatusPtyBinding(handle, ptyId)
    if (!foregroundProcess || !isShellProcess(foregroundProcess)) {
      return false
    }
    const confirmationController = this.ptyController
    if (!confirmationController?.confirmForegroundProcess) {
      return true
    }
    let confirmedProcess: string | null
    try {
      confirmedProcess = await confirmationController.confirmForegroundProcess(ptyId)
    } catch {
      this.assertTerminalAgentStatusPtyBinding(handle, ptyId)
      return true
    }
    this.assertTerminalAgentStatusPtyBinding(handle, ptyId)
    // Why: hook identity is generic; strong provider evidence only needs to
    // prove that some recognized agent still owns this exact PTY.
    return recognizeAgentProcess(confirmedProcess) === null
  }
  protected shouldDelayPtyBackedMobileSnapshotForForegroundAgent(
    pty: RuntimePtyWorktreeRecord,
    title: string
  ): boolean {
    return (
      !pty.launchAgent && pty.foregroundAgent === null && hasCompatibleAgentTitleIdentity(title)
    )
  }

  /**
   * Schedules an asynchronous query to check which agent process is currently
   * running in the foreground of a PTY.
   */
  protected refreshPtyForegroundAgent(ptyId: string): void {
    void this.refreshPtyForegroundAgentFromController(ptyId)
  }
  protected getPendingForegroundAgentRefreshForTitle(
    ptyId: string,
    titleObservedAt: number
  ): Promise<boolean> | undefined {
    if (!this.ptyForegroundAgentRefreshes.has(ptyId)) {
      return undefined
    }
    return this.refreshPtyForegroundAgentFromController(ptyId, {
      afterTitleObservation: titleObservedAt
    })
  }
  protected delayPtyBackedMobileSnapshotForForegroundAgent(
    ptyId: string,
    titleObservedAt: number,
    foregroundRefresh: Promise<boolean>
  ): void {
    this.ptyDelayedForegroundSnapshotTitleObservations.set(ptyId, titleObservedAt)
    void foregroundRefresh.then((foregroundAgentChanged) => {
      if (this.ptyDelayedForegroundSnapshotTitleObservations.get(ptyId) !== titleObservedAt) {
        return
      }
      this.ptyDelayedForegroundSnapshotTitleObservations.delete(ptyId)
      if (!foregroundAgentChanged) {
        this.touchMobileSessionSnapshotsForPty(ptyId)
      }
    })
  }

  /**
   * Deduplicates and manages in-flight foreground agent refresh queries
   * for a specific PTY.
   */
  protected refreshPtyForegroundAgentFromController(
    ptyId: string,
    options: { afterTitleObservation?: number } = {}
  ): Promise<boolean> {
    const startedAfterTitleObservation = options.afterTitleObservation ?? 0
    const pendingRefresh = this.ptyForegroundAgentRefreshes.get(ptyId)

    if (pendingRefresh) {
      pendingRefresh.requestedAfterTitleObservation = Math.max(
        pendingRefresh.requestedAfterTitleObservation,
        startedAfterTitleObservation
      )
      return pendingRefresh.promise
    }
    const entry: PtyForegroundAgentRefresh = {
      promise: Promise.resolve(false),
      startedAfterTitleObservation,
      requestedAfterTitleObservation: startedAfterTitleObservation
    }
    const refresh = (async (): Promise<boolean> => {
      while (true) {
        entry.startedAfterTitleObservation = entry.requestedAfterTitleObservation
        const foregroundAgentChanged = await this.loadPtyForegroundAgentFromController(ptyId)
        if (
          foregroundAgentChanged ||
          entry.requestedAfterTitleObservation <= entry.startedAfterTitleObservation
        ) {
          return foregroundAgentChanged
        }
      }
    })().finally(() => {
      if (this.ptyForegroundAgentRefreshes.get(ptyId) === entry) {
        this.ptyForegroundAgentRefreshes.delete(ptyId)
      }
    })
    entry.promise = refresh
    this.ptyForegroundAgentRefreshes.set(ptyId, entry)
    return refresh
  }

  /**
   * Queries the PTY controller for the active foreground process, identifies if it
   * is a recognized agent, and updates the PTY's foreground agent state if changed.
   */
  protected async loadPtyForegroundAgentFromController(ptyId: string): Promise<boolean> {
    if (!this.ptyController) {
      return false
    }
    const pty = this.ptysById.get(ptyId)
    if (!pty?.connected) {
      return false
    }
    // Why: foregroundAgent is only consulted as the owner fallback when
    // launchAgent is unknown, so a known launchAgent makes the relay
    // getForegroundProcess round-trip pure waste (covers all launched agents).
    if (pty.launchAgent) {
      return false
    }
    let foregroundProcess: string | null
    try {
      foregroundProcess = await this.ptyController.getForegroundProcess(ptyId)
    } catch {
      return false
    }
    const foregroundAgent = foregroundProcess
      ? (recognizeAgentProcess(foregroundProcess)?.agent ?? null)
      : null
    if (pty.foregroundAgent === foregroundAgent) {
      return false
    }
    pty.foregroundAgent = foregroundAgent
    this.touchMobileSessionSnapshotsForPty(ptyId)
    return true
  }
  protected getFreshExplicitAgentStatusForHandle(handle: string): {
    status: NonNullable<RuntimeTerminalAgentStatus['status']>
    updatedAt: number
  } | null {
    const paneKey = this.getPaneKeyForTerminalHandle(handle)
    const now = Date.now()
    let bestStatus: NonNullable<RuntimeTerminalAgentStatus['status']> | null = null
    let bestUpdatedAt = -1

    const consider = (
      state: AgentStatusEntry['state'] | undefined,
      updatedAt: number | null | undefined
    ): void => {
      if (!state) {
        return
      }
      if (typeof updatedAt !== 'number' || now - updatedAt > AGENT_STATUS_STALE_AFTER_MS) {
        return
      }
      const status = mapExplicitAgentStateToRuntimeTerminalStatus(state)
      // Why: older retained permission rows can remain visible after the agent
      // resumes. Prefer the newest explicit state; only let permission win ties.
      if (updatedAt > bestUpdatedAt || (updatedAt === bestUpdatedAt && status === 'permission')) {
        bestStatus = status
        bestUpdatedAt = updatedAt
      }
    }

    if (paneKey) {
      const retained = this.latestAgentStatusByPaneKey.get(paneKey)
      consider(retained?.payload.state, retained?.updatedAt)
    }

    for (const entry of this.getAgentStatusSnapshotFn?.() ?? []) {
      if (entry.terminalHandle !== handle && (!paneKey || entry.paneKey !== paneKey)) {
        continue
      }
      consider(entry.state, entry.receivedAt)
    }

    return bestStatus ? { status: bestStatus, updatedAt: bestUpdatedAt } : null
  }
}
