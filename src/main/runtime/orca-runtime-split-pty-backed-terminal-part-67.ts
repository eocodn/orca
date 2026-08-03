import { randomUUID, type RuntimeTerminalSplit, type RuntimeWorktreeTerminalSleepResult, type TerminalPaneSplitSource, makePaneKey, parsePaneKey, type AgentTeamsTmuxCompatRequest, type AgentTeamsTmuxCompatResponse, ensureClaudeAgentTeamsShimDir, resolveClaudeAgentTeamsShimBin, teardownRpcDeadline, runtimeWorktreeIdentityKey, waitForWorktreeTerminalMutation, type RuntimePtyWorktreeRecord, ownerSurfacing } from './orca-runtime-symbols'
import { OrcaRuntimeWaitForLeafPtyIdPart66 } from './orca-runtime-wait-for-leaf-pty-id-part-66'

export class OrcaRuntimeSplitPtyBackedTerminalPart67 extends OrcaRuntimeWaitForLeafPtyIdPart66 {
  protected async splitPtyBackedTerminal(
    pty: RuntimePtyWorktreeRecord,
    opts: {
      direction?: 'horizontal' | 'vertical'
      command?: string
      env?: Record<string, string>
      envToDelete?: string[]
      activate?: boolean
      // Why: same split as createTerminal — adopt the pane without revealing its
      // workspace, for splits the user never asked to see.
      surfaceOwner?: false
      telemetrySource?: TerminalPaneSplitSource
    } = {}
  ): Promise<RuntimeTerminalSplit> {
    if (!this.ptyController?.spawn) {
      throw new Error('runtime_unavailable')
    }
    if (!pty.connected) {
      throw new Error('terminal_exited')
    }
    const parsedPaneKey = parsePaneKey(pty.paneKey ?? '')
    const parentTabId = pty.tabId?.trim()
    if (!parentTabId || !parsedPaneKey) {
      throw new Error('terminal_handle_stale')
    }
    const direction = opts.direction ?? 'horizontal'
    const workspace = await this.resolveTerminalWorkspaceLaunchScope(`id:${pty.worktreeId}`)
    const leafId = randomUUID()
    const preAllocatedHandle = this.createPreAllocatedTerminalHandle()
    const paneKey = makePaneKey(parentTabId, leafId)
    const result = await this.ptyController.spawn({
      cols: 120,
      rows: 40,
      cwd: workspace.path,
      command: opts.command,
      commandDelivery: 'provider',
      env: this.buildTerminalWorkspaceEnv(workspace, opts.env ?? {}, paneKey, parentTabId),
      envToDelete: opts.envToDelete,
      connectionId: workspace.connectionId,
      worktreeId: workspace.id,
      preAllocatedHandle,
      tabId: parentTabId,
      leafId,
      persistHostSessionBinding: true
    })
    this.registerPreAllocatedHandleForPty(result.id, preAllocatedHandle)
    if (result.wslDistro) {
      this.preparePtyExecutionContext(result.id, result.wslDistro)
    }
    const registeredIncarnation = this.registerPty(result.id, workspace.id, workspace.connectionId)
    result.incarnationId ??= registeredIncarnation ?? undefined
    const createdPty = this.getOrCreatePtyWorktreeRecord(result.id)
    if (createdPty) {
      createdPty.tabId = parentTabId
      createdPty.paneKey = paneKey
      createdPty.runtimeSessionOwned = pty.runtimeSessionOwned
    }

    try {
      await this.notifier?.revealTerminalSession?.(workspace.id, {
        ptyId: result.id,
        title: null,
        activate: opts.activate !== false,
        ...ownerSurfacing(opts.surfaceOwner !== false),
        tabId: parentTabId,
        leafId,
        splitFromLeafId: parsedPaneKey.leafId,
        splitDirection: direction,
        splitTelemetrySource: opts.telemetrySource
      })
    } catch (error) {
      this.ptyController.kill?.(result.id)
      throw error
    }
    if (createdPty) {
      this.publishPtyBackedMobileSessionTerminal(workspace.id, createdPty, {
        tabId: parentTabId,
        leafId,
        title: null,
        activate: opts.activate !== false,
        split: { splitFromLeafId: parsedPaneKey.leafId, direction }
      })
      // Why: persist the split so a later snapshot rebuild keeps it instead of collapsing to a single pane.
      this.persistHeadlessTerminalSplit({
        worktreeId: workspace.id,
        tabId: parentTabId,
        leafId,
        ptyId: createdPty.ptyId,
        splitFromLeafId: parsedPaneKey.leafId,
        direction
      })
    }

    return { handle: this.issuePtyHandle(createdPty ?? pty), tabId: parentTabId, paneRuntimeId: -1 }
  }
  async handleAgentTeamsTmuxCompat(
    request: AgentTeamsTmuxCompatRequest
  ): Promise<AgentTeamsTmuxCompatResponse> {
    return await this.claudeAgentTeams.handleTmuxCompat(request, {
      splitTerminal: (handle, opts) => this.splitTerminal(handle, opts),
      readTerminal: (handle, opts) => this.readTerminal(handle, opts),
      sendTerminal: (handle, action) => this.sendTerminal(handle, action),
      focusTerminal: (handle) => this.focusTerminal(handle),
      closeTerminal: (handle) => this.closeTerminal(handle),
      showTerminal: (handle) => this.showTerminal(handle)
    })
  }
  async prepareClaudeAgentTeamsLeader(args: {
    paneKey: string
    baseEnv?: Record<string, string>
  }): Promise<{ env: Record<string, string> }> {
    const handle = this.getTerminalHandleForPaneKey(args.paneKey)
    if (!handle) {
      throw new Error('claude_agent_teams_requires_orca_terminal')
    }
    return await this.prepareClaudeAgentTeamsLeaderForHandle({
      handle,
      baseEnv: args.baseEnv
    })
  }
  async prepareClaudeAgentTeamsLeaderForHandle(args: {
    handle: string
    baseEnv?: Record<string, string>
  }): Promise<{ env: Record<string, string> }> {
    const baseEnv = {
      ...process.env,
      ...args.baseEnv
    }
    const shimDir = await ensureClaudeAgentTeamsShimDir()
    const shimBin = resolveClaudeAgentTeamsShimBin(baseEnv)
    return this.claudeAgentTeams.createLaunchEnv({
      leaderHandle: args.handle,
      baseEnv,
      shimDir,
      shimBin
    })
  }
  protected waitForNewLeafInTab(
    tabId: string,
    existingLeafKeys: Set<string>,
    timeoutMs = 10_000
  ): Promise<string> {
    const tryResolve = (): string | null => {
      for (const [key, leaf] of this.leaves) {
        if (leaf.tabId === tabId && !existingLeafKeys.has(key) && leaf.ptyId !== null) {
          return this.issueHandle(leaf)
        }
      }
      return null
    }

    const existing = tryResolve()
    if (existing) {
      return Promise.resolve(existing)
    }

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.graphSyncCallbacks.indexOf(check)
        if (idx !== -1) {
          this.graphSyncCallbacks.splice(idx, 1)
        }
        reject(new Error('Timed out waiting for split pane handle'))
      }, timeoutMs)

      const check = (): void => {
        const handle = tryResolve()
        if (handle) {
          clearTimeout(timer)
          const idx = this.graphSyncCallbacks.indexOf(check)
          if (idx !== -1) {
            this.graphSyncCallbacks.splice(idx, 1)
          }
          resolve(handle)
        }
      }
      this.graphSyncCallbacks.push(check)
      check()
    })
  }
  async stopTerminalsForWorktree(
    worktreeSelector: string,
    options: {
      deadline?: number
      stopPty?: (
        ptyId: string,
        stop: () => boolean | Promise<boolean>
      ) => Promise<{ stopped: boolean; owner: boolean }>
    } = {}
  ): Promise<{ stopped: number }> {
    // Why: this mutates live PTYs, so reject while the graph is reloading rather than act on cached leaf ownership.
    const graphEpoch = this.captureReadyGraphEpoch()
    const worktree = await this.resolveWorktreeSelector(worktreeSelector)
    this.assertStableReadyGraph(graphEpoch)
    if (options.deadline !== undefined && Date.now() >= options.deadline) {
      return { stopped: 0 }
    }
    const ptyIds = new Set<string>()
    for (const leaf of this.leaves.values()) {
      if (leaf.worktreeId === worktree.id && leaf.ptyId) {
        ptyIds.add(leaf.ptyId)
      }
    }
    for (const pty of this.ptysById.values()) {
      if (pty.worktreeId === worktree.id && pty.connected) {
        ptyIds.add(pty.ptyId)
      }
    }

    let stopped = 0
    for (const ptyId of ptyIds) {
      if (options.deadline !== undefined && Date.now() >= options.deadline) {
        break
      }
      const stop = (): boolean | Promise<boolean> => {
        if (options.deadline !== undefined && Date.now() >= options.deadline) {
          return false
        }
        if (options.stopPty) {
          // Why: destructive worktree cleanup must not let its cross-surface
          // dedupe treat fire-and-forget controller.kill as physical exit.
          // Why: the RPC deadline makes shutdown/list RPCs settle before the sweep
          // deadline so a wedged daemon yields the accurate stop failure; no deadline
          // (non-destructive) keeps the provider default RPC timeout.
          if (options.deadline !== undefined) {
            return (
              this.ptyController?.stopAndWait?.(ptyId, {
                deadlineMs: teardownRpcDeadline(options.deadline)
              }) ?? false
            )
          }
          return this.ptyController?.stopAndWait?.(ptyId) ?? false
        }
        return Boolean(this.ptyController?.kill(ptyId))
      }
      const stopResult = options.stopPty
        ? await options.stopPty(ptyId, stop)
        : { stopped: stop(), owner: true }
      if (stopResult.owner && stopResult.stopped) {
        stopped += 1
      }
    }
    return { stopped }
  }
  async sleepTerminalsForWorktree(
    worktreeSelector: string
  ): Promise<RuntimeWorktreeTerminalSleepResult> {
    const worktree = await this.resolveWorktreeSelector(worktreeSelector)
    const existing = this.terminalSleepByWorktreeId.get(worktree.id)
    if (existing) {
      return await existing
    }

    const sleeping = this.sleepResolvedWorktreeTerminals(worktree)
    this.terminalSleepByWorktreeId.set(worktree.id, sleeping)
    try {
      return await sleeping
    } finally {
      if (this.terminalSleepByWorktreeId.get(worktree.id) === sleeping) {
        this.terminalSleepByWorktreeId.delete(worktree.id)
      }
    }
  }
  async acquireWorktreeTerminalSpawn(worktreeId?: string): Promise<() => void> {
    if (!worktreeId) {
      return () => {}
    }
    const release = await this.acquireWorktreeTerminalMutation(worktreeId)
    const key = runtimeWorktreeIdentityKey(worktreeId)
    const sleepState = this.terminalSleepStateByWorktreeId.get(key)
    if (sleepState?.phase === 'sleeping' || sleepState?.phase === 'partial') {
      this.terminalSleepStateByWorktreeId.delete(key)
      this.emitClientEvent({
        type: 'worktreeTerminalSleepState',
        worktreeId: sleepState.worktreeId,
        generation: sleepState.generation,
        phase: 'woken',
        ptyIds: sleepState.ptyIds,
        terminalHandles: sleepState.terminalHandles
      })
    }
    return release
  }
  protected async acquireWorktreeTerminalMutation(
    worktreeId: string,
    deadline?: number
  ): Promise<() => void> {
    const key = runtimeWorktreeIdentityKey(worktreeId)
    const previous = this.terminalMutationTailByWorktreeId.get(key) ?? Promise.resolve()
    let releaseCurrent = (): void => {}
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve
    })
    const tail = previous.catch(() => {}).then(() => current)
    this.terminalMutationTailByWorktreeId.set(key, tail)
    try {
      await waitForWorktreeTerminalMutation(
        previous.catch(() => {}),
        deadline
      )
    } catch (error) {
      // Why: resolve this abandoned queue node now so it can never acquire later and stop a terminal after the caller timed out.
      releaseCurrent()
      void tail.finally(() => {
        if (this.terminalMutationTailByWorktreeId.get(key) === tail) {
          this.terminalMutationTailByWorktreeId.delete(key)
        }
      })
      throw error
    }
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      releaseCurrent()
      void tail.finally(() => {
        if (this.terminalMutationTailByWorktreeId.get(key) === tail) {
          this.terminalMutationTailByWorktreeId.delete(key)
        }

      })
    }
  }
}
