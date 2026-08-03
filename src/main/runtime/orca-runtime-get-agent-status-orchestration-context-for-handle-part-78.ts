import { detectAgentStatusFromTitle, isClaudeManagementTitle, AGENT_STATUS_STALE_AFTER_MS, type AgentStatusOrchestrationContext, buildOrchestrationTaskDisplayMetadata, OrchestrationDb, type RuntimeTerminalSummary, isTerminalLeafId, makePaneKey, parsePaneKey, isAgentForegroundWrapperProcess, isExpectedAgentProcess, recognizeAgentProcess, type MessageWaitResult, isKnownReadyPromptPreview, buildTerminalWaitText, classifyAgentTitle, classifyLatestAgentTitle, getLatestAgentCandidateTitle, getLatestLeafTitle, getLatestPtyTitle, type RuntimeLeafRecord, type RuntimePtyWorktreeRecord, FOREGROUND_AGENT_WRAPPER_RETRY_INTERVAL_MS, FOREGROUND_AGENT_WRAPPER_RETRY_TIMEOUT_MS, type TerminalHandleRecord, type ResolvedWorktree } from './orca-runtime-symbols'
import { OrcaRuntimeBuildPtyMobileAgentStatusPart77 } from './orca-runtime-build-pty-mobile-agent-status-part-77'

export class OrcaRuntimeGetAgentStatusOrchestrationContextForHandlePart78 extends OrcaRuntimeBuildPtyMobileAgentStatusPart77 {
  protected getAgentStatusOrchestrationContextForHandle(
    handle: string,
    db = this.getOrchestrationDbIfAvailable()
  ): AgentStatusOrchestrationContext | undefined {
    // Why: active dispatch is authoritative for reused terminals; completed context stale-groups future work once its done row is gone.
    const dispatch =
      db?.getActiveDispatchForTerminal?.(handle) ??
      this.getRecentCompletedDispatchForTerminal(handle, db)
    if (!dispatch) {
      return undefined
    }
    const task = db?.getTask?.(dispatch.task_id)
    const display =
      typeof task?.spec === 'string'
        ? buildOrchestrationTaskDisplayMetadata({
            spec: task.spec,
            taskTitle: task.task_title,
            displayName: task.display_name
          })
        : { taskTitle: '', displayName: '' }
    const activeRun = dispatch.status === 'completed' ? undefined : db?.getActiveCoordinatorRun?.()
    const parentTerminalHandle =
      task?.created_by_terminal_handle ??
      (activeRun?.coordinator_handle && activeRun.coordinator_handle !== handle
        ? activeRun.coordinator_handle
        : undefined)
    const parentPaneKey = parentTerminalHandle
      ? this.getPaneKeyForTerminalHandle(parentTerminalHandle)
      : undefined

    return {
      taskId: dispatch.task_id,
      dispatchId: dispatch.id,
      ...(display.taskTitle ? { taskTitle: display.taskTitle } : {}),
      ...(display.displayName ? { displayName: display.displayName } : {}),
      ...(parentTerminalHandle ? { parentTerminalHandle } : {}),
      ...(parentPaneKey ? { parentPaneKey } : {}),
      ...(activeRun?.coordinator_handle ? { coordinatorHandle: activeRun.coordinator_handle } : {}),
      ...(activeRun?.id ? { orchestrationRunId: activeRun.id } : {})
    }
  }
  protected getRecentCompletedDispatchForTerminal(
    handle: string,
    db = this.getOrchestrationDbIfAvailable()
  ): ReturnType<OrchestrationDb['getLatestDispatchForTerminal']> {
    const dispatch = db?.getLatestDispatchForTerminal?.(handle)
    if (dispatch?.status !== 'completed' || !dispatch.completed_at) {
      return undefined
    }
    const completedAtMs = Date.parse(
      dispatch.completed_at.includes('T')
        ? dispatch.completed_at
        : `${dispatch.completed_at.replace(' ', 'T')}Z`
    )
    if (!Number.isFinite(completedAtMs)) {
      return undefined
    }
    return Date.now() - completedAtMs <= AGENT_STATUS_STALE_AFTER_MS ? dispatch : undefined
  }
  protected getTerminalHandleForPaneKey(paneKey: string): string | null {
    const parsed = parsePaneKey(paneKey)
    const leaf = parsed ? this.leaves.get(this.getLeafKey(parsed.tabId, parsed.leafId)) : undefined
    if (leaf?.ptyId && leaf.connected) {
      return this.issueHandle(leaf)
    }
    const panePty = this.getPtyRecordForPaneKey(paneKey)
    if (panePty?.connected) {
      return this.issuePtyHandle(panePty)
    }
    if (leaf?.ptyId) {
      return this.issueHandle(leaf)
    }
    return panePty ? this.issuePtyHandle(panePty) : null
  }
  protected getPtyRecordForPaneKey(paneKey: string): RuntimePtyWorktreeRecord | null {
    const parsed = parsePaneKey(paneKey)
    let leafPty: RuntimePtyWorktreeRecord | null = null
    if (parsed) {
      const leaf = this.leaves.get(this.getLeafKey(parsed.tabId, parsed.leafId))
      const pty = leaf?.ptyId ? this.ptysById.get(leaf.ptyId) : undefined
      if (pty?.connected) {
        return pty
      }
      leafPty = pty ?? null
    }
    let newestMatch: RuntimePtyWorktreeRecord | null = null
    for (const pty of this.ptysById.values()) {
      if (pty.paneKey === paneKey) {
        if (pty.connected) {
          return pty
        }
        newestMatch = pty
      }
    }
    return leafPty ?? newestMatch
  }
  protected getPaneKeyForTerminalHandle(handle: string): string | null {
    const livePty = this.getLivePtyForHandle(handle)
    if (livePty?.pty.paneKey) {
      return livePty.pty.paneKey
    }
    const record = this.handles.get(handle)
    if (!record || record.runtimeId !== this.runtimeId) {
      return null
    }
    if (!isTerminalLeafId(record.leafId)) {
      return null
    }
    return makePaneKey(record.tabId, record.leafId)
  }
  protected setPtyManagementTitleFromObservedTitle(
    pty: RuntimePtyWorktreeRecord,
    title: string | null | undefined,
    observedAt: number
  ): void {
    const trimmed = title?.trim()
    if (!trimmed) {
      return
    }
    if (isClaudeManagementTitle(trimmed)) {
      pty.managementTitle = trimmed
      pty.managementTitleAt = observedAt
      return
    }
    if (
      detectAgentStatusFromTitle(trimmed) !== null &&
      observedAt >= (pty.managementTitleAt ?? -1)
    ) {
      pty.managementTitle = null
      pty.managementTitleAt = null
    }
  }
  protected nextTitleObservationSequence(): number {
    this.titleObservationSequence += 1
    return this.titleObservationSequence
  }

  // Why: title is the tightest agent-presence signal, but a Claude management title is negative evidence for task activity.
  async isTerminalRunningAgent(handle: string): Promise<boolean> {
    try {
      const pty = this.getLivePtyForHandle(handle)
      if (pty) {
        const leaf = this.getPrimaryLeafForPty(pty.pty.ptyId)
        return await this.isPtyRunningAgent(pty.pty, leaf)
      }
      const { leaf } = this.getLiveLeafForHandle(handle)
      // Why: check the leaf pane title and the tab title, which already carries OSC-enriched agent indicators (e.g. ✳ prefix).
      const paneTitle = getLatestLeafTitle(leaf, null)
      const paneTitleClassification = classifyAgentTitle(paneTitle)
      if (paneTitleClassification === 'agent') {
        return true
      }
      const tabTitle = this.tabs.get(leaf.tabId)?.title?.trim() || null
      const tabTitleClassification = paneTitle === null ? classifyAgentTitle(tabTitle) : 'neutral'
      if (tabTitleClassification === 'agent') {
        return true
      }
      const waitText = buildTerminalWaitText(leaf.tailBuffer, leaf.tailPartialLine, leaf.preview)
      if (isKnownReadyPromptPreview(waitText)) {
        return true
      }
      const hasCurrentTitleEvidence = paneTitle !== null || tabTitle !== null
      if (leaf.lastAgentStatus !== null && !hasCurrentTitleEvidence) {
        return true
      }
      if (!leaf.ptyId || !this.ptyController) {
        return false
      }
      const fg = await this.ptyController.getForegroundProcess(leaf.ptyId)
      if (!fg) {
        return false
      }
      // Why: Claude's management UI runs under the Claude process but isn't a task-capable session; suppress only that process.
      const shouldSuppressClaudeForeground =
        paneTitleClassification === 'management' || tabTitleClassification === 'management'
      if (shouldSuppressClaudeForeground && isExpectedAgentProcess(fg, 'claude')) {
        return false
      }
      // Why: review-note delivery auto-submits with Enter, so only known agent processes are safe (not arbitrary focused TUIs).
      return await this.isRecognizedForegroundAgentProcess(leaf.ptyId, fg, {
        suppressClaude: shouldSuppressClaudeForeground
      })
    } catch {
      return false
    }
  }
  protected async isPtyRunningAgent(
    pty: RuntimePtyWorktreeRecord,
    leaf: RuntimeLeafRecord | null = null
  ): Promise<boolean> {
    const leafTitle = leaf
      ? getLatestAgentCandidateTitle(
          { title: leaf.paneTitle, updatedAt: leaf.paneTitleUpdatedAt },
          { title: leaf.lastOscTitle, updatedAt: leaf.lastOscTitleAt }
        )
      : null
    const leafTitleClassification = classifyAgentTitle(leafTitle)
    if (leafTitleClassification === 'agent') {
      return true
    }
    const ptyTitle = getLatestAgentCandidateTitle(
      { title: pty.title, updatedAt: pty.titleUpdatedAt },
      { title: pty.lastOscTitle, updatedAt: pty.lastOscTitleAt }
    )
    const ptyTitleClassification = classifyAgentTitle(ptyTitle)
    if (leafTitle === null && ptyTitleClassification === 'agent') {
      return true
    }
    const managementTitleClassification = classifyLatestAgentTitle({
      title: pty.managementTitle,
      updatedAt: pty.managementTitleAt
    })
    const waitText = buildTerminalWaitText(pty.tailBuffer, pty.tailPartialLine, pty.preview)
    if (isKnownReadyPromptPreview(waitText)) {
      return true
    }
    // Why: stale status is a fallback only when no current title evidence exists; neutral titles (shells) clear it.
    if (
      pty.lastAgentStatus !== null &&
      leafTitle === null &&
      ptyTitle === null &&
      managementTitleClassification !== 'management'
    ) {
      return true
    }
    if (!this.ptyController) {
      return false
    }
    const fg = await this.ptyController.getForegroundProcess(pty.ptyId)
    if (!fg) {
      return false
    }
    const shouldSuppressClaudeForeground =
      leafTitle !== null
        ? leafTitleClassification === 'management'
        : managementTitleClassification === 'management'
    if (shouldSuppressClaudeForeground && isExpectedAgentProcess(fg, 'claude')) {
      return false
    }
    // Why: review-note delivery auto-submits with Enter, so only known agent processes are safe (not arbitrary focused TUIs).
    return await this.isRecognizedForegroundAgentProcess(pty.ptyId, fg, {
      suppressClaude: shouldSuppressClaudeForeground
    })
  }
  protected async isRecognizedForegroundAgentProcess(
    ptyId: string,
    foregroundProcess: string,
    options: { suppressClaude?: boolean } = {}
  ): Promise<boolean> {
    const initialRecognition = recognizeAgentProcess(foregroundProcess)
    if (initialRecognition !== null) {
      return !(
        options.suppressClaude === true &&
        isExpectedAgentProcess(initialRecognition.processName, 'claude')
      )
    }
    if (!this.isAgentWrapperForegroundProcess(foregroundProcess) || !this.ptyController) {
      return false
    }
    const startedAt = Date.now()
    while (Date.now() - startedAt < FOREGROUND_AGENT_WRAPPER_RETRY_TIMEOUT_MS) {
      await new Promise((resolve) =>
        setTimeout(resolve, FOREGROUND_AGENT_WRAPPER_RETRY_INTERVAL_MS)
      )
      const refreshedProcess = await this.ptyController.getForegroundProcess(ptyId)
      const refreshedRecognition = recognizeAgentProcess(refreshedProcess)
      if (refreshedRecognition !== null) {
        return !(
          options.suppressClaude === true &&
          isExpectedAgentProcess(refreshedRecognition.processName, 'claude')
        )
      }
      if (!refreshedProcess || !this.isAgentWrapperForegroundProcess(refreshedProcess)) {
        return false
      }
    }
    return false
  }
  protected isAgentWrapperForegroundProcess(processName: string): boolean {
    // Why: daemon/SSH PTYs can report the interpreter before the async cmdline cache resolves; retry only known wrappers.
    return isAgentForegroundWrapperProcess(processName)
  }
  protected getPrimaryLeafForPty(ptyId: string): RuntimeLeafRecord | null {
    return this.getLeavesForPty(ptyId)[0] ?? null
  }
  deliverPendingMessagesForHandle(handle: string): void {
    try {
      const { leaf } = this.getLiveLeafForHandle(handle)
      if (leaf.lastAgentStatus === 'idle') {
        this.deliverPendingMessages(leaf)
      }
    } catch {
      // Unknown/stale handles can't be pushed now; the persisted message stays available via explicit check or future idle delivery.
    }
  }

  // Why: wake blocking orchestration.check --wait calls on this handle so they return the new message immediately instead of polling.
  notifyMessageArrived(handle: string, messageType?: string): void {
    this.messageWaiters.notify(handle, messageType)
  }
  waitForMessage(
    handle: string,
    options?: {
      typeFilter?: string[]
      timeoutMs?: number
      signal?: AbortSignal
      exclusive?: boolean
    }
  ): Promise<MessageWaitResult> {
    return this.messageWaiters.wait(handle, options)
  }
  cancelMessageWaiters(handle: string): void {
    this.messageWaiters.cancel(handle)
  }
  protected buildPtyTerminalSummary(
    pty: RuntimePtyWorktreeRecord,
    worktreesById: Map<string, ResolvedWorktree>
  ): RuntimeTerminalSummary {
    const worktree = worktreesById.get(pty.worktreeId)

    const pane = parsePaneKey(pty.paneKey ?? '')
    const orphaned = !pty.tabId || !pane || pane.tabId !== pty.tabId
    return {
      handle: this.issuePtyHandle(pty),
      ptyId: pty.ptyId,
      incarnationId: pty.incarnationId,
      orphaned,
      worktreeId: pty.worktreeId,
      worktreePath: worktree?.path ?? '',
      branch: worktree?.branch ?? '',
      tabId: orphaned ? `pty:${pty.ptyId}` : pty.tabId!,
      leafId: orphaned ? `pty:${pty.ptyId}` : pane.leafId,
      title: getLatestPtyTitle(pty),
      connected: pty.connected,
      writable: pty.connected,
      lastOutputAt: pty.lastOutputAt,
      preview: pty.preview
    }
  }
  protected getLiveLeafForHandle(handle: string): {
    record: TerminalHandleRecord
    leaf: RuntimeLeafRecord
  } {
    this.assertGraphReady()
    const record = this.handles.get(handle)
    if (!record || record.runtimeId !== this.runtimeId) {
      throw new Error('terminal_handle_stale')
    }
    if (record.rendererGraphEpoch !== this.rendererGraphEpoch) {
      throw new Error('terminal_handle_stale')
    }

    const leaf = this.leaves.get(this.getLeafKey(record.tabId, record.leafId))
    if (!leaf || leaf.ptyId !== record.ptyId || leaf.ptyGeneration !== record.ptyGeneration) {
      throw new Error('terminal_handle_stale')
    }
    return { record, leaf }
  }
}
