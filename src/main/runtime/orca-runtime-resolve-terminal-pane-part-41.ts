import { assertTerminalDimensions, type RuntimeTerminalRead, type RuntimeTerminalSend, type RuntimeTerminalResolvePane, type RuntimeTerminalShow, type RuntimeTerminalInspect, type RuntimeTerminalResize, parsePaneKey, type PtyIncarnationId, readTerminalTail, assertTerminalInputWithinLimitWithYield, buildSendPayload, getTerminalState } from './orca-runtime-symbols'
import { OrcaRuntimeGetTerminalOrphanAdoptionSnapshotPart40 } from './orca-runtime-get-terminal-orphan-adoption-snapshot-part-40'

export class OrcaRuntimeResolveTerminalPanePart41 extends OrcaRuntimeGetTerminalOrphanAdoptionSnapshotPart40 {
  resolveTerminalPane(paneKey: string, expectedWorktreeId?: string): RuntimeTerminalResolvePane {
    // Why: the renderer context menu only knows the stable pane key; main owns
    // the runtime terminal handle that agents and CLI commands can address.
    const handle = this.getTerminalHandleForPaneKey(paneKey)
    if (!handle) {
      throw new Error('terminal_not_found')
    }
    const record = this.handles.get(handle)
    const parsed = parsePaneKey(paneKey)
    const leaf = parsed ? this.leaves.get(this.getLeafKey(parsed.tabId, parsed.leafId)) : null
    const pty = this.getPtyRecordForPaneKey(paneKey)
    const candidateWorktreeIds = [leaf?.worktreeId, pty?.worktreeId].filter(
      (worktreeId): worktreeId is string => Boolean(worktreeId)
    )
    const worktreeId = candidateWorktreeIds[0] ?? null
    if (
      (candidateWorktreeIds.length > 1 && new Set(candidateWorktreeIds).size > 1) ||
      (expectedWorktreeId && candidateWorktreeIds.some((id) => id !== expectedWorktreeId)) ||
      (expectedWorktreeId && candidateWorktreeIds.length === 0)
    ) {
      // Why: pane coordinates restored by a paired client must not cross workspace ownership.
      throw new Error('terminal_not_found')
    }
    return {
      handle,
      tabId: parsed?.tabId ?? record?.tabId ?? '',
      leafId: parsed?.leafId ?? record?.leafId ?? '',
      ptyId: record?.ptyId ?? null,
      ...(worktreeId ? { worktreeId } : {}),
      ...this.getPtyExecutionHostMetadata(record?.ptyId ?? pty?.ptyId ?? null)
    }
  }
  async recoverTerminalPane(
    paneKey: string,
    expectedWorktreeId: string,
    expectedHandle?: string
  ): Promise<RuntimeTerminalResolvePane> {
    const parsed = parsePaneKey(paneKey)
    const pty = this.getPtyRecordForPaneKey(paneKey)
    if (
      !parsed ||
      !pty ||
      !expectedHandle ||
      pty.worktreeId !== expectedWorktreeId ||
      this.getPaneKeyForTerminalHandle(expectedHandle) !== paneKey
    ) {
      throw new Error('terminal_not_found')
    }
    const recoveryKey = `${expectedWorktreeId}\0${paneKey}`
    const pending = this.terminalPaneRecoveryByIdentity.get(recoveryKey)
    if (pending) {
      return pending
    }
    if (pty?.connected) {
      const current = this.resolveTerminalPane(paneKey, expectedWorktreeId)
      if (expectedHandle === undefined || current.handle !== expectedHandle) {
        return current
      }
      throw new Error('terminal_not_recoverable')
    }
    if (
      !this.getRecentExpiredSshLease(expectedWorktreeId, parsed.tabId, parsed.leafId, pty.ptyId)
    ) {
      // Why: an explicit close leaves a terminated lease; only relay expiry authorizes shell recreation.
      throw new Error('terminal_not_recoverable')
    }
    // Why: disconnected PTYs can reissue handles during graph cleanup; only a connected replacement satisfies the pane CAS.
    const recovery = this.createTerminal(`id:${expectedWorktreeId}`, {
      tabId: parsed.tabId,
      leafId: parsed.leafId,
      focus: false,
      // Why: the HUB renderer may publish its exited layout while recovery is in flight; persist the replacement before that stale graph can orphan it.
      persistHostSessionBinding: true
    }).then((terminal) => ({
      handle: terminal.handle,
      tabId: parsed.tabId,
      leafId: parsed.leafId,
      ptyId: terminal.ptyId ?? null,
      worktreeId: expectedWorktreeId
    }))
    this.terminalPaneRecoveryByIdentity.set(recoveryKey, recovery)
    const clearRecovery = (): void => {
      if (this.terminalPaneRecoveryByIdentity.get(recoveryKey) === recovery) {
        this.terminalPaneRecoveryByIdentity.delete(recoveryKey)
      }
    }
    void recovery.then(clearRecovery, clearRecovery)
    return recovery
  }
  async showTerminal(handle: string): Promise<RuntimeTerminalShow> {
    const pty = this.getLivePtyForHandle(handle)
    if (pty) {
      const worktreesById = await this.getResolvedWorktreeMap()
      const summary = this.buildPtyTerminalSummary(pty.pty, worktreesById)
      const preview = await this.visibleSnapshotPreview(pty.pty.ptyId, summary.preview)
      this.assertLiveTerminalHandleTargetsPty(handle, pty.pty.ptyId)
      return {
        ...summary,
        preview,
        tabId: pty.pty.tabId ?? pty.record.tabId,
        leafId: parsePaneKey(pty.pty.paneKey ?? '')?.leafId ?? pty.record.leafId,
        paneRuntimeId: -1,
        ptyId: pty.pty.ptyId,
        rendererGraphEpoch: this.rendererGraphEpoch
      }
    }
    const graphEpoch = this.captureReadyGraphEpoch()
    const worktreesById = await this.getResolvedWorktreeMap()
    this.assertStableReadyGraph(graphEpoch)
    const { leaf } = this.getLiveLeafForHandle(handle)
    const summary = this.buildTerminalSummary(leaf, worktreesById)
    const preview = leaf.ptyId
      ? await this.visibleSnapshotPreview(leaf.ptyId, summary.preview)
      : summary.preview
    this.assertStableReadyGraph(graphEpoch)
    if (leaf.ptyId) {
      this.assertLiveTerminalHandleTargetsPty(handle, leaf.ptyId)
    }
    return {
      ...summary,
      preview,
      paneRuntimeId: leaf.paneRuntimeId,
      ptyId: leaf.ptyId,
      rendererGraphEpoch: this.rendererGraphEpoch
    }
  }
  async inspectTerminal(handle: string): Promise<RuntimeTerminalInspect> {
    const owner = this.getTerminalControlOwner(handle)
    const processIncarnation = this.getTerminalProcessIncarnation(handle)
    if (!processIncarnation) {
      throw new Error('terminal_incarnation_unavailable')
    }
    const lifecycleGeneration = this.getPtyLifecycleGeneration(owner.ptyId)
    const show = await this.showTerminal(handle)
    const history = await this.readTerminal(handle, { cursor: 0, limit: 1 })
    let size: { cols: number; rows: number } | null = null
    try {
      size = (await this.ptyController?.getAppliedSize?.(owner.ptyId)) ?? null
    } catch {
      throw new Error('terminal_size_read_failed')
    }
    this.assertTerminalControlFence(
      handle,
      owner.ptyId,
      processIncarnation,
      lifecycleGeneration,
      false
    )
    const transportLoss =
      !owner.connected &&
      owner.lastExitCode !== null &&
      this.isRecoverableSshTransportLoss(owner.ptyId, owner.connectionId, owner.lastExitCode)
    const state = owner.connected ? 'running' : transportLoss ? 'disconnected' : 'exited'
    return {
      ...show,
      processIncarnation,
      lifecycle: {
        state,
        exit:
          owner.lastExitCode === null
            ? null
            : {
                code: owner.lastExitCode,
                reason: transportLoss ? 'transport-loss' : 'process-exit'
              }
      },
      size,
      history: {
        oldestCursor: history.oldestCursor ?? '0',
        latestCursor: history.latestCursor ?? '0',
        truncated: history.truncated,
        bounded: true
      },
      reattach: {
        disposition: owner.connected
          ? 'attached'
          : transportLoss
            ? 'provider-reconnect-required'
            : 'exited'
      }
    }
  }
  async resizeTerminal(
    handle: string,
    expectedIncarnation: string,
    cols: number,
    rows: number
  ): Promise<RuntimeTerminalResize> {
    assertTerminalDimensions(cols, rows)
    const owner = this.getTerminalControlOwner(handle)
    if (!owner.connected) {
      throw new Error('terminal_not_running')
    }
    const lifecycleGeneration = this.getPtyLifecycleGeneration(owner.ptyId)
    this.assertTerminalControlFence(
      handle,
      owner.ptyId,
      expectedIncarnation,
      lifecycleGeneration,
      true
    )
    if (!owner.incarnationId || !this.ptyController?.resizeIfCurrent) {
      throw new Error('terminal_resize_unconfirmed')
    }
    const freshSubscribeGeneration = this.beginFreshSubscribe(owner.ptyId)
    let applied: { cols: number; rows: number } | null = null
    try {
      await this.enqueueExactLayout(
        owner.ptyId,
        { kind: 'desktop', cols, rows },
        {
          beforeApply: () => {
            this.assertTerminalControlFence(
              handle,
              owner.ptyId,
              expectedIncarnation,
              lifecycleGeneration,
              true
            )
          },
          resizeMutation: async (nextCols, nextRows) =>
            await this.ptyController!.resizeIfCurrent!(
              owner.ptyId,
              owner.incarnationId!,
              nextCols,
              nextRows
            ),
          afterApply: async (result) => {
            this.assertTerminalControlFence(
              handle,
              owner.ptyId,
              expectedIncarnation,
              lifecycleGeneration,
              true
            )
            if (!result.ok) {
              throw new Error('terminal_resize_failed')
            }
            try {
              applied = (await this.ptyController?.getAppliedSize?.(owner.ptyId)) ?? null
            } catch {
              throw new Error('terminal_resize_unconfirmed')
            }
            if (!applied) {
              throw new Error('terminal_resize_unconfirmed')
            }
            this.assertTerminalControlFence(
              handle,
              owner.ptyId,
              expectedIncarnation,
              lifecycleGeneration,
              true
            )
            if (applied.cols !== cols || applied.rows !== rows) {
              throw new Error('terminal_resize_mismatch')
            }
          }
        }
      )
    } finally {
      this.endFreshSubscribe(owner.ptyId, freshSubscribeGeneration)
    }
    if (!applied) {
      throw new Error('terminal_resize_unconfirmed')
    }
    return {
      handle,
      ptyId: owner.ptyId,
      processIncarnation: expectedIncarnation,
      requested: { cols, rows },
      applied,
      authoritative: true
    }
  }
  protected assertTerminalControlFence(
    handle: string,
    expectedPtyId: string,
    expectedIncarnation: string,
    expectedLifecycleGeneration: number,
    requireConnected: boolean
  ): void {
    const owner = this.getTerminalControlOwner(handle)
    if (
      (requireConnected && !owner.connected) ||
      owner.ptyId !== expectedPtyId ||
      this.getPtyLifecycleGeneration(owner.ptyId) !== expectedLifecycleGeneration ||
      this.getTerminalProcessIncarnation(handle) !== expectedIncarnation
    ) {
      throw new Error('terminal_incarnation_stale')
    }
  }
  protected getTerminalControlOwner(handle: string): {
    ptyId: string
    incarnationId: PtyIncarnationId | null
    connected: boolean
    lastExitCode: number | null
    connectionId: string | null
  } {
    const live = this.getLivePtyForHandle(handle)
    if (live) {
      return {
        ptyId: live.pty.ptyId,
        incarnationId: live.pty.incarnationId,
        connected: live.pty.connected,
        lastExitCode: live.pty.lastExitCode,
        connectionId: live.pty.connectionId
      }
    }
    const { leaf } = this.getLiveLeafForHandle(handle)
    if (!leaf.ptyId) {
      throw new Error('no_connected_pty')
    }
    return {
      ptyId: leaf.ptyId,
      incarnationId: this.ptysById.get(leaf.ptyId)?.incarnationId ?? null,
      connected: leaf.connected,
      lastExitCode: leaf.lastExitCode,
      connectionId: this.ptysById.get(leaf.ptyId)?.connectionId ?? null
    }
  }
  async readTerminal(
    handle: string,
    opts: { cursor?: number; limit?: number } = {}
  ): Promise<RuntimeTerminalRead> {
    const pty = this.getLivePtyForHandle(handle)
    if (pty) {
      const read = this.readPtyTerminal(handle, pty.pty, opts)
      const visibleRead = await this.withVisibleSnapshotFallback(pty.pty.ptyId, read, opts)
      this.assertLiveTerminalHandleTargetsPty(handle, pty.pty.ptyId)
      return visibleRead
    }

    const { leaf } = this.getLiveLeafForHandle(handle)
    const read = readTerminalTail({
      handle,
      status: getTerminalState(leaf),
      previewLines: leaf.tailBuffer,
      completedLines: leaf.tailTranscriptBuffer,
      partialLine: leaf.tailPartialLine,
      completedLineCount: leaf.tailLinesTotal,
      bufferTruncated: leaf.tailTruncated,
      cursor: opts.cursor,
      limit: opts.limit
    })
    if (!leaf.ptyId) {
      return read
    }
    const visibleRead = await this.withVisibleSnapshotFallback(leaf.ptyId, read, opts)
    this.assertLiveTerminalHandleTargetsPty(handle, leaf.ptyId)
    return visibleRead
  }
  async sendTerminal(
    handle: string,
    action: {
      text?: string
      enter?: boolean
      interrupt?: boolean
    },
    options: {
      beforeWrite?: (ptyId: string) => void | Promise<void>
      reserveWrite?: (ptyId: string) => void
      afterWrite?: (ptyId: string) => void | Promise<void>
      suffixFailureError?: string
    } = {}
  ): Promise<RuntimeTerminalSend> {
    const pty = this.getLivePtyForHandle(handle)
    if (pty) {
      if (!pty.pty.connected) {
        throw new Error('terminal_not_writable')
      }
      const payload = buildSendPayload(action)
      if (payload === null) {
        throw new Error('invalid_terminal_send')
      }
      await assertTerminalInputWithinLimitWithYield(action.text)
      await this.writeTerminalAction(pty.pty.ptyId, action, payload, options)
      return {
        handle,
        accepted: true,
        bytesWritten: Buffer.byteLength(payload, 'utf8')
      }
    }

    const { leaf } = this.getLiveLeafForHandle(handle)
    if (!leaf.writable || !leaf.ptyId) {
      throw new Error('terminal_not_writable')
    }
    const payload = buildSendPayload(action)
    if (payload === null) {
      throw new Error('invalid_terminal_send')
    }
    await assertTerminalInputWithinLimitWithYield(action.text)

    await this.writeTerminalAction(leaf.ptyId, action, payload, options)

    return {
      handle,
      accepted: true,
      bytesWritten: Buffer.byteLength(payload, 'utf8')
    }
  }
}
