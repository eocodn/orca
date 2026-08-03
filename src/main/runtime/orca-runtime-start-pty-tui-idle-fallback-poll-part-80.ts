import { isShellProcess, type AgentStatus, formatMessagesForInjection, type LinearProjectListResult, type LinearIssueRequest, type LinearTeamLabelsResult, type LinearTeamListResult, type LinearTeamMembersResult, type LinearTeamStatesResult, type RuntimeTerminalWait, clampLinearSearchLimit, RuntimeLinearConnectionCommands, detectTerminalWaitBlockedReason, isKnownReadyPromptPreview, buildTerminalWaitText, TUI_IDLE_POLL_INTERVAL_MS, TUI_IDLE_QUIESCENCE_MS, buildPtyTerminalWaitResult, buildPtyTerminalWaitBlockedResult, detectExplicitIdleStatusFromTitle, readLinearIssueContext, sanitizeLinearErrorMessage, getLinearTeamMembersOrThrow, listLinearTeamsForAgent, isCursorAgentOrchestrationTarget, type RuntimeLeafRecord, type RuntimePtyWorktreeRecord, type TerminalWaiter } from './orca-runtime-symbols'
import { OrcaRuntimeGetLivePtyForHandlePart79 } from './orca-runtime-get-live-pty-for-handle-part-79'

export class OrcaRuntimeStartPtyTuiIdleFallbackPollPart80 extends OrcaRuntimeGetLivePtyForHandlePart79 {
  protected startPtyTuiIdleFallbackPoll(waiter: TerminalWaiter, pty: RuntimePtyWorktreeRecord): void {
    let foregroundPollInFlight = false
    waiter.pollInterval = setInterval(async () => {
      if (!waiter.pollInterval) {
        return
      }
      let startedForegroundPoll = false
      try {
        if (pty.lastAgentStatus === 'idle') {
          if (waiter.pollInterval) {
            clearInterval(waiter.pollInterval)
            waiter.pollInterval = null
          }
          this.resolveWaiter(waiter, buildPtyTerminalWaitResult(waiter.handle, 'tui-idle', pty))
          return
        }
        const ptyWaitText = buildTerminalWaitText(pty.tailBuffer, pty.tailPartialLine, pty.preview)
        const blockedReason = detectTerminalWaitBlockedReason(ptyWaitText)
        if (blockedReason) {
          if (waiter.pollInterval) {
            clearInterval(waiter.pollInterval)
            waiter.pollInterval = null
          }
          this.resolveWaiter(
            waiter,
            buildPtyTerminalWaitBlockedResult(waiter.handle, 'tui-idle', pty, blockedReason)
          )
          return
        }
        // Why: adopted background PTY handles use their live xterm title as the same readiness signal as leaf handles.
        if (
          this.getAdoptedPtyExplicitIdleStatus(pty) === 'idle' ||
          isKnownReadyPromptPreview(ptyWaitText)
        ) {
          if (waiter.pollInterval) {
            clearInterval(waiter.pollInterval)
            waiter.pollInterval = null
          }
          this.resolveWaiter(waiter, buildPtyTerminalWaitResult(waiter.handle, 'tui-idle', pty))
          return
        }
        if (pty.lastAgentStatus === null && this.ptyController && !foregroundPollInFlight) {
          foregroundPollInFlight = true
          startedForegroundPoll = true
          const fg = await this.ptyController.getForegroundProcess(pty.ptyId)
          if (fg && !isShellProcess(fg)) {
            const quietMs = pty.lastOutputAt ? Date.now() - pty.lastOutputAt : 0
            if (quietMs >= TUI_IDLE_QUIESCENCE_MS) {
              if (waiter.pollInterval) {
                clearInterval(waiter.pollInterval)
                waiter.pollInterval = null
              }
              this.resolveWaiter(waiter, buildPtyTerminalWaitResult(waiter.handle, 'tui-idle', pty))
            }
          }
        }
      } catch {
        // Swallow transient PTY inspection errors and keep polling.
      } finally {
        if (startedForegroundPoll) {
          foregroundPollInFlight = false
        }
      }
    }, TUI_IDLE_POLL_INTERVAL_MS)
  }
  protected getAdoptedPtyExplicitIdleStatus(pty: RuntimePtyWorktreeRecord): AgentStatus | null {
    for (const leaf of this.leaves.values()) {
      if (leaf.ptyId !== pty.ptyId) {
        continue
      }
      const title = leaf.paneTitle ?? this.tabs.get(leaf.tabId)?.title
      if (!title) {
        continue
      }
      const status = detectExplicitIdleStatusFromTitle(title)
      if (status !== null) {
        return status
      }
    }
    return null
  }

  // Why: push-on-idle delivery is event-driven (no polling) because the runtime owns both the message store and terminal status detection.
  protected deliverPendingMessages(leaf: RuntimeLeafRecord): void {
    if (!this._orchestrationDb) {
      return
    }

    const handle = this.handleByLeafKey.get(this.getLeafKey(leaf.tabId, leaf.leafId))
    if (!handle) {
      return
    }

    const unread = this._orchestrationDb.getUndeliveredUnreadMessages(handle)
    if (unread.length === 0) {
      return
    }

    if (!leaf.writable || !leaf.ptyId) {
      return
    }

    const payload = formatMessagesForInjection(unread)
    const wrote = this.ptyController?.write(leaf.ptyId, payload) ?? false
    if (!wrote) {
      return
    }

    // The active coordinator prompt is user-owned input, so push-on-idle must not synthesize Enter.
    if (this._orchestrationDb.getActiveCoordinatorRun()?.coordinator_handle === handle) {
      this._orchestrationDb.markAsDelivered(unread.map((m) => m.id))
      return
    }

    const tabTitle = this.tabs.get(leaf.tabId)?.title
    if (isCursorAgentOrchestrationTarget(leaf, tabTitle)) {
      // Why: Cursor Agent treats injected PTY text as editable prompt input, so submitting must stay under user control.
      this._orchestrationDb.markAsDelivered(unread.map((m) => m.id))
      return
    }

    // Why: Claude Code treats a large PTY write as a paste and swallows a \r in the same write; send Enter separately after a delay, stamping delivered_at only once \r is confirmed.
    // Important (design doc §3.2, feedback #2): stamp delivered_at, not read — read means "a check-caller consumed this"; flipping it would hide the message from check --unread.
    const ptyId = leaf.ptyId
    setTimeout(() => {
      try {
        if (!leaf.writable) {
          return
        }
        const submitted = this.ptyController?.write(ptyId, '\r') ?? false
        if (submitted) {
          this._orchestrationDb?.markAsDelivered(unread.map((m) => m.id))
        }
      } catch {
        // Terminal may have closed during the delay — messages stay queued (delivered_at NULL) and re-deliver on next idle.
      }
    }, 500)
  }
  protected resolveWaiter(waiter: TerminalWaiter, result: RuntimeTerminalWait): void {
    this.removeWaiter(waiter)
    waiter.resolve(result)
  }
  protected bindTerminalWaiterAbort(
    waiter: TerminalWaiter,
    signal: AbortSignal | undefined
  ): boolean {
    if (!signal) {
      return true
    }
    if (signal.aborted) {
      return false
    }
    const onAbort = (): void => {
      this.removeWaiter(waiter)
      waiter.reject(new Error('request_aborted'))
    }
    waiter.abortCleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    return true
  }
  protected rejectWaitersForHandle(handle: string, code: string): void {
    const waiters = this.waitersByHandle.get(handle)
    if (!waiters || waiters.size === 0) {
      return
    }
    for (const waiter of [...waiters]) {
      this.removeWaiter(waiter)
      waiter.reject(new Error(code))
    }
  }
  protected rejectAllWaiters(code: string): void {
    for (const handle of [...this.waitersByHandle.keys()]) {
      this.rejectWaitersForHandle(handle, code)
    }
  }
  protected removeWaiter(waiter: TerminalWaiter): void {
    if (waiter.timeout) {
      clearTimeout(waiter.timeout)
    }
    if (waiter.pollInterval) {
      clearInterval(waiter.pollInterval)
    }
    if (waiter.abortCleanup) {
      waiter.abortCleanup()
      waiter.abortCleanup = null
    }
    const waiters = this.waitersByHandle.get(waiter.handle)
    if (!waiters) {
      return
    }
    waiters.delete(waiter)
    if (waiters.size === 0) {
      this.waitersByHandle.delete(waiter.handle)
    }
  }
  protected getLeafKey(tabId: string, leafId: string): string {
    return `${tabId}::${leafId}`
  }

  // ── Linear integration ──

  protected readonly linearConnectionCommands = new RuntimeLinearConnectionCommands()

  linearConnect: RuntimeLinearConnectionCommands['linearConnect'] =
    this.linearConnectionCommands.linearConnect.bind(this.linearConnectionCommands)
  linearDisconnect: RuntimeLinearConnectionCommands['linearDisconnect'] =
    this.linearConnectionCommands.linearDisconnect.bind(this.linearConnectionCommands)
  linearSelectWorkspace: RuntimeLinearConnectionCommands['linearSelectWorkspace'] =
    this.linearConnectionCommands.linearSelectWorkspace.bind(this.linearConnectionCommands)
  linearStatus: RuntimeLinearConnectionCommands['linearStatus'] =
    this.linearConnectionCommands.linearStatus.bind(this.linearConnectionCommands)
  linearTestConnection: RuntimeLinearConnectionCommands['linearTestConnection'] =
    this.linearConnectionCommands.linearTestConnection.bind(this.linearConnectionCommands)
  linearSearchIssues: RuntimeLinearConnectionCommands['linearSearchIssues'] =
    this.linearConnectionCommands.linearSearchIssues.bind(this.linearConnectionCommands)
  linearSearchForAgents: RuntimeLinearConnectionCommands['linearSearchForAgents'] =
    this.linearConnectionCommands.linearSearchForAgents.bind(this.linearConnectionCommands)
  linearIssueContext(request: LinearIssueRequest): ReturnType<typeof readLinearIssueContext> {
    return readLinearIssueContext(request, (context) => this.linearResolveCurrentIssue(context))
  }
  async linearTeamListForAgents(params: {
    workspaceId?: string | 'all'
  }): Promise<LinearTeamListResult> {
    try {
      const result = await listLinearTeamsForAgent(params.workspaceId)
      const workspaceErrors = result.errors.map((error) => ({
        workspace: { id: error.workspaceId, name: error.workspaceName ?? error.workspaceId },
        code: this.linearWorkspaceErrorCode(error.type),
        message: sanitizeLinearErrorMessage(error.message)
      }))
      return {
        teams: result.teams.map((team) => this.linearTeamSummary(team)),
        meta: {
          workspaceId: params.workspaceId,
          returned: result.teams.length,
          partial: workspaceErrors.length > 0,
          workspaceErrors
        }
      }
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
  }
  async linearTeamMembersForAgents(params: {
    teamInput: string
    workspaceId?: string
  }): Promise<LinearTeamMembersResult> {
    const team = await this.resolveLinearTeamInput(params.teamInput, params.workspaceId)
    try {
      const members = await getLinearTeamMembersOrThrow(team.id, team.workspaceId)
      return {
        team: this.linearTeamSummary(team),
        members: members.map((member) => ({
          id: member.id,
          displayName: member.displayName,
          avatarUrl: member.avatarUrl
        })),
        meta: { workspaceId: team.workspaceId, returned: members.length }
      }
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
  }
  async linearTeamStatesForAgents(params: {
    teamInput: string
    workspaceId?: string
  }): Promise<LinearTeamStatesResult> {
    const team = await this.resolveLinearTeamInput(params.teamInput, params.workspaceId)
    const states = await this.getLinearTeamStatesForWrite(team.id, team.workspaceId)
    return {
      team: this.linearTeamSummary(team),
      states: states.map((state) => ({
        id: state.id,
        name: state.name,
        type: state.type,
        color: state.color,
        position: state.position
      })),
      meta: { workspaceId: team.workspaceId, returned: states.length }
    }
  }
  async linearTeamLabelsForAgents(params: {
    teamInput: string
    workspaceId?: string
  }): Promise<LinearTeamLabelsResult> {
    const team = await this.resolveLinearTeamInput(params.teamInput, params.workspaceId)
    const labels = await this.getLinearTeamLabelsForWrite(team.id, team.workspaceId)
    return {
      team: this.linearTeamSummary(team),
      labels: labels.map((label) => ({ id: label.id, name: label.name, color: label.color })),
      meta: { workspaceId: team.workspaceId, returned: labels.length }
    }
  }
  async linearProjectListForAgents(params: {
    query?: string
    limit?: number
    workspaceId?: string | 'all'
  }): Promise<LinearProjectListResult> {
    const limit = clampLinearSearchLimit(params.limit)
    try {
      const result = await this.linearListProjects(params.query, limit, params.workspaceId, true)
      const projects = result.items.slice(0, limit).map((project) => ({
        id: project.id,
        name: project.name,
        ...(project.url ? { url: project.url } : {}),
        ...(project.workspaceId ? { workspaceId: project.workspaceId } : {}),
        ...(project.workspaceName ? { workspaceName: project.workspaceName } : {}),
        ...(project.teams ? { teams: project.teams } : {})
      }))
      const workspaceErrors = (result.errors ?? []).map((error) => ({
        workspace: { id: error.workspaceId, name: error.workspaceName ?? error.workspaceId },
        code: this.linearWorkspaceErrorCode(error.type),
        message: sanitizeLinearErrorMessage(error.message)
      }))
      return {
        projects,
        meta: {
          query: params.query,
          workspaceId: params.workspaceId,
          limit,
          returned: projects.length,
          hasMore: result.hasMore === true || result.items.length > limit,
          partial: workspaceErrors.length > 0,
          workspaceErrors
        }
      }
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
  }
}
