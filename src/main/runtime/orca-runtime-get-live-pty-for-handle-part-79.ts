import { isShellProcess, randomUUID, type RuntimeTerminalRead, detectTerminalWaitBlockedReason, isKnownReadyPromptPreview, buildTerminalWaitText, readTerminalTail, TUI_IDLE_POLL_INTERVAL_MS, TUI_IDLE_QUIESCENCE_MS, buildPtyTerminalWaitResult, buildTerminalWaitResult, buildTerminalWaitBlockedResult, detectExplicitIdleStatusFromTitle, type RuntimeLeafRecord, type RuntimePtyWorktreeRecord, type TerminalHandleRecord, type TerminalWaiter } from './orca-runtime-symbols'
import { OrcaRuntimeGetAgentStatusOrchestrationContextForHandlePart78 } from './orca-runtime-get-agent-status-orchestration-context-for-handle-part-78'

export class OrcaRuntimeGetLivePtyForHandlePart79 extends OrcaRuntimeGetAgentStatusOrchestrationContextForHandlePart78 {
  protected getLivePtyForHandle(handle: string): {
    record: TerminalHandleRecord
    pty: RuntimePtyWorktreeRecord
  } | null {
    let record = this.handles.get(handle)
    if (!record) {
      const ptyId = [...this.handleByPtyId.entries()].find(
        ([, mappedHandle]) => mappedHandle === handle
      )?.[0]
      const pty = ptyId ? this.ptysById.get(ptyId) : null
      if (pty) {
        // Why: graph reload clears renderer handle records, but runtime-owned PTY handles remain the caller's control identity.
        this.issuePtyHandle(pty)
        record = this.handles.get(handle)
      }
    }
    if (!record || record.runtimeId !== this.runtimeId || !record.tabId.startsWith('pty:')) {
      return null
    }
    if (!record.ptyId) {
      return null
    }
    const pty = this.ptysById.get(record.ptyId)
    if (!pty || pty.ptyId !== record.ptyId) {
      return null
    }
    // Why: renderer adoption can race with CLI reads; keep ptyId → handle populated so summaries don't mint a second handle for the same terminal.
    this.handleByPtyId.set(record.ptyId, handle)
    return { record, pty }
  }
  protected assertLiveTerminalHandleTargetsPty(handle: string, expectedPtyId: string): void {
    const runtimePty = this.getLivePtyForHandle(handle)
    if (runtimePty) {
      if (runtimePty.pty.ptyId !== expectedPtyId) {
        throw new Error('terminal_handle_stale')
      }
      return
    }
    const { leaf } = this.getLiveLeafForHandle(handle)
    if (leaf.ptyId !== expectedPtyId) {
      throw new Error('terminal_handle_stale')
    }
  }
  protected readPtyTerminal(
    handle: string,
    pty: RuntimePtyWorktreeRecord,
    opts: { cursor?: number; limit?: number } = {}
  ): RuntimeTerminalRead {
    return readTerminalTail({
      handle,
      status: pty.connected ? 'running' : pty.lastExitCode !== null ? 'exited' : 'unknown',
      previewLines: pty.tailBuffer,
      completedLines: pty.tailTranscriptBuffer,
      partialLine: pty.tailPartialLine,
      completedLineCount: pty.tailLinesTotal,
      bufferTruncated: pty.tailTruncated,
      cursor: opts.cursor,
      limit: opts.limit
    })
  }
  protected issueHandle(leaf: RuntimeLeafRecord): string {
    const leafKey = this.getLeafKey(leaf.tabId, leaf.leafId)
    const existingHandle = this.handleByLeafKey.get(leafKey)
    if (existingHandle) {
      const existingRecord = this.handles.get(existingHandle)
      if (
        existingRecord &&
        existingRecord.rendererGraphEpoch === this.rendererGraphEpoch &&
        existingRecord.ptyId === leaf.ptyId &&
        existingRecord.ptyGeneration === leaf.ptyGeneration
      ) {
        return existingHandle
      }
    }

    const preAllocatedHandle = this.adoptPreAllocatedHandle(leaf)
    const handle = preAllocatedHandle ?? `term_${randomUUID()}`
    if (!preAllocatedHandle) {
      this.syntheticTerminalHandles.add(handle)
    }
    if (this.handles.has(handle)) {
      return handle
    }
    this.handles.set(handle, {
      handle,
      runtimeId: this.runtimeId,
      rendererGraphEpoch: this.rendererGraphEpoch,
      worktreeId: leaf.worktreeId,
      tabId: leaf.tabId,
      leafId: leaf.leafId,
      ptyId: leaf.ptyId,
      ptyGeneration: leaf.ptyGeneration
    })
    this.handleByLeafKey.set(leafKey, handle)
    return handle
  }
  protected adoptPreAllocatedHandle(leaf: RuntimeLeafRecord): string | null {
    if (!leaf.ptyId) {
      return null
    }
    const preAllocated = this.handleByPtyId.get(leaf.ptyId)
    if (!preAllocated) {
      return null
    }
    const leafKey = this.getLeafKey(leaf.tabId, leaf.leafId)
    this.handles.set(preAllocated, {
      handle: preAllocated,
      runtimeId: this.runtimeId,
      rendererGraphEpoch: this.rendererGraphEpoch,
      worktreeId: leaf.worktreeId,
      tabId: leaf.tabId,
      leafId: leaf.leafId,
      ptyId: leaf.ptyId,
      ptyGeneration: leaf.ptyGeneration
    })
    this.handleByLeafKey.set(leafKey, preAllocated)
    return preAllocated
  }
  protected issuePtyHandle(pty: RuntimePtyWorktreeRecord): string {
    const existingHandle =
      this.handleByPtyId.get(pty.ptyId) ?? this.findHandleForPtyRecord(pty.ptyId)
    if (existingHandle) {
      const existingRecord = this.handles.get(existingHandle)
      if (
        existingRecord &&
        existingRecord.runtimeId === this.runtimeId &&
        existingRecord.ptyId === pty.ptyId
      ) {
        this.handleByPtyId.set(pty.ptyId, existingHandle)
        return existingHandle
      }
    }

    const handle = existingHandle ?? `term_${randomUUID()}`
    if (!existingHandle) {
      this.syntheticTerminalHandles.add(handle)
    }
    const syntheticId = `pty:${pty.ptyId}`
    this.handles.set(handle, {
      handle,
      runtimeId: this.runtimeId,
      rendererGraphEpoch: this.rendererGraphEpoch,
      worktreeId: pty.worktreeId,
      tabId: syntheticId,
      leafId: syntheticId,
      ptyId: pty.ptyId,
      ptyGeneration: 0
    })
    this.handleByPtyId.set(pty.ptyId, handle)
    return handle
  }
  protected findHandleForPtyRecord(ptyId: string): string | null {
    for (const [handle, record] of this.handles) {
      if (
        record.runtimeId === this.runtimeId &&
        record.ptyId === ptyId &&
        record.tabId.startsWith('pty:')
      ) {
        return handle
      }
    }
    return null
  }
  protected refreshWritableFlags(): void {
    for (const leaf of this.leaves.values()) {
      leaf.writable = this.graphStatus === 'ready' && leaf.connected && leaf.ptyId !== null
    }
  }
  protected invalidateLeafHandle(leafKey: string): void {
    const handle = this.handleByLeafKey.get(leafKey)
    if (!handle) {
      return
    }
    this.handleByLeafKey.delete(leafKey)
    this.handles.delete(handle)
    this.syntheticTerminalHandles.delete(handle)
    this.rejectWaitersForHandle(handle, 'terminal_handle_stale')
  }
  protected adoptFirstPtyForLeafHandle(
    leafKey: string,
    ptyId: string | null,
    ptyGeneration: number
  ): boolean {
    const handle = this.handleByLeafKey.get(leafKey)
    const record = handle ? this.handles.get(handle) : null
    if (!handle || !record || record.ptyId !== null || ptyId === null) {
      return false
    }
    this.handles.set(handle, { ...record, ptyId, ptyGeneration })
    return true
  }
  protected rememberDetachedPreAllocatedLeaves(): void {
    for (const leaf of this.leaves.values()) {
      if (leaf.ptyId && this.handleByPtyId.has(leaf.ptyId)) {
        // Why: ORCA_TERMINAL_HANDLE is an agent identity, so CLI control survives renderer graph loss while the PTY is alive.
        this.detachedPreAllocatedLeaves.set(leaf.ptyId, leaf)
      }
    }
  }
  protected resolveExitWaiters(leaf: RuntimeLeafRecord): void {
    const handle = this.issueHandle(leaf)
    if (!handle) {
      return
    }
    const waiters = this.waitersByHandle.get(handle)
    if (!waiters || waiters.size === 0) {
      return
    }
    for (const waiter of [...waiters]) {
      if (waiter.condition === 'exit') {
        this.resolveWaiter(waiter, buildTerminalWaitResult(handle, 'exit', leaf))
      } else {
        // Why: after exit, conditions like tui-idle can never be satisfied — reject now instead of spinning the poll until timeout on a dead process.
        this.removeWaiter(waiter)
        waiter.reject(new Error('terminal_exited'))
      }
    }
  }
  protected resolveTuiIdleWaiters(leaf: RuntimeLeafRecord): void {
    const handle = this.handleByLeafKey.get(this.getLeafKey(leaf.tabId, leaf.leafId))
    if (!handle) {
      return
    }
    const waiters = this.waitersByHandle.get(handle)
    if (!waiters || waiters.size === 0) {
      return
    }
    for (const waiter of [...waiters]) {
      if (waiter.condition === 'tui-idle') {
        this.resolveWaiter(waiter, buildTerminalWaitResult(handle, 'tui-idle', leaf))
      }
    }
  }
  protected resolvePtyExitWaiters(pty: RuntimePtyWorktreeRecord, ptyId: string): void {
    const handle = this.handleByPtyId.get(ptyId)
    if (!handle) {
      return
    }
    const waiters = this.waitersByHandle.get(handle)
    if (!waiters || waiters.size === 0) {
      return
    }
    for (const waiter of [...waiters]) {
      if (waiter.condition === 'exit') {
        this.resolveWaiter(waiter, buildPtyTerminalWaitResult(handle, 'exit', pty))
      } else {
        this.removeWaiter(waiter)
        waiter.reject(new Error('terminal_exited'))
      }
    }
  }
  protected resolvePtyTuiIdleWaiters(pty: RuntimePtyWorktreeRecord, ptyId: string): void {
    const handle = this.handleByPtyId.get(ptyId)
    if (!handle) {
      return
    }
    const waiters = this.waitersByHandle.get(handle)
    if (!waiters || waiters.size === 0) {
      return
    }
    for (const waiter of [...waiters]) {
      if (waiter.condition === 'tui-idle') {
        this.resolveWaiter(waiter, buildPtyTerminalWaitResult(handle, 'tui-idle', pty))
      }
    }
  }

  // Why: the primary OSC-title signal can't fire for daemon-hosted terminals (no PTY data through the runtime), so this fallback polls the renderer-synced tab title + foreground-process quiescence; self-cancels when the OSC path fires.
  protected startTuiIdleFallbackPoll(waiter: TerminalWaiter, leaf: RuntimeLeafRecord): void {
    let foregroundPollInFlight = false
    waiter.pollInterval = setInterval(async () => {
      if (!waiter.pollInterval) {
        return
      }
      let startedForegroundPoll = false
      try {
        if (leaf.lastAgentStatus === 'idle') {
          if (waiter.pollInterval) {
            clearInterval(waiter.pollInterval)

            waiter.pollInterval = null
          }
          this.resolveWaiter(waiter, buildTerminalWaitResult(waiter.handle, 'tui-idle', leaf))
          return
        }
        // Why: the renderer-synced title is the only path where OSC titles are visible for daemon-hosted terminals.
        const pollTitle = leaf.paneTitle ?? this.tabs.get(leaf.tabId)?.title
        if (pollTitle) {
          const titleStatus = detectExplicitIdleStatusFromTitle(pollTitle)
          if (titleStatus === 'idle') {
            if (waiter.pollInterval) {
              clearInterval(waiter.pollInterval)
              waiter.pollInterval = null
            }
            this.resolveWaiter(waiter, buildTerminalWaitResult(waiter.handle, 'tui-idle', leaf))
            return
          }
        }
        const leafWaitText = buildTerminalWaitText(
          leaf.tailBuffer,
          leaf.tailPartialLine,
          leaf.preview
        )
        const blockedReason = detectTerminalWaitBlockedReason(leafWaitText)
        if (blockedReason) {
          if (waiter.pollInterval) {
            clearInterval(waiter.pollInterval)
            waiter.pollInterval = null
          }
          this.resolveWaiter(
            waiter,
            buildTerminalWaitBlockedResult(waiter.handle, 'tui-idle', leaf, blockedReason)
          )
          return
        }
        if (isKnownReadyPromptPreview(leafWaitText)) {
          if (waiter.pollInterval) {
            clearInterval(waiter.pollInterval)
            waiter.pollInterval = null
          }
          this.resolveWaiter(waiter, buildTerminalWaitResult(waiter.handle, 'tui-idle', leaf))
          return
        }
        // Foreground fallback: a reported non-shell process with quiet output is treated as idle.
        if (
          leaf.lastAgentStatus === null &&
          leaf.ptyId &&
          this.ptyController &&
          !foregroundPollInFlight
        ) {
          foregroundPollInFlight = true
          startedForegroundPoll = true
          const fg = await this.ptyController.getForegroundProcess(leaf.ptyId)
          if (fg && !isShellProcess(fg)) {
            const quietMs = leaf.lastOutputAt ? Date.now() - leaf.lastOutputAt : 0
            if (quietMs >= TUI_IDLE_QUIESCENCE_MS) {
              if (waiter.pollInterval) {
                clearInterval(waiter.pollInterval)
                waiter.pollInterval = null
              }
              this.resolveWaiter(waiter, buildTerminalWaitResult(waiter.handle, 'tui-idle', leaf))
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
}
