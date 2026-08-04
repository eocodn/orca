import type {
  TerminalOutputSourceRange,
  RemoteTerminalSourceRangeConsumerHooks,
  RemoteTerminalSourceRangeReplacementPublication,
  RemoteTerminalSourceRangeReplacementReservation,
  RemoteTerminalSourceRangeStreamIdentity,
  ParsedAgentStatusPayload,
  ProcessedAgentStatusChunk,
  PtyIncarnationId,
  RuntimeTerminalDataMeta,
  RuntimePtyWorktreeRecord
} from './orca-runtime-symbols'
import { OrcaRuntimeGetOrCreatePtyTitleTrackerEntryPart22 } from './orca-runtime-get-or-create-pty-title-tracker-entry-part-22'

export class OrcaRuntimeEmitTerminalAgentStatusEventsPart23 extends OrcaRuntimeGetOrCreatePtyTitleTrackerEntryPart22 {
  protected emitTerminalAgentStatusEvents(
    ptyId: string,
    chunk: ProcessedAgentStatusChunk
  ): boolean {
    // Why: snapshot retention (for mobile worktree.ps) must run even when no
    // renderer listener is attached, so we don't early-return on a missing
    // onTerminalAgentStatus — only the per-target emit below is gated on it.
    if (chunk.payloads.length === 0) {
      return false
    }
    const targets = new Map<
      string,
      {
        source: 'mounted-leaf' | 'pty-record'
        paneKey: string
        tabId?: string
        worktreeId?: string
        connectionId?: string | null
      }
    >()
    const pty = this.ptysById.get(ptyId)
    const connectionId = pty?.connectionId ?? null
    for (const leaf of this.getLeavesForPty(ptyId)) {
      const paneKey = this.makeRuntimePaneKey(leaf)
      targets.set(paneKey, {
        source: 'mounted-leaf',
        paneKey,
        tabId: leaf.tabId,
        worktreeId: leaf.worktreeId,
        connectionId
      })
    }
    if (targets.size === 0 && pty?.paneKey) {
      targets.set(pty.paneKey, {
        source: 'pty-record',
        paneKey: pty.paneKey,
        tabId: pty.tabId ?? undefined,
        worktreeId: pty.worktreeId,
        connectionId
      })
    }
    let retainedChanged = false
    for (const payload of chunk.payloads) {
      for (const target of targets.values()) {
        retainedChanged =
          this.retainAgentRowSnapshot(
            ptyId,
            target.paneKey,
            target.worktreeId,
            target.tabId,
            payload
          ) || retainedChanged
        if (!this.onTerminalAgentStatus) {
          continue
        }
        try {
          this.onTerminalAgentStatus({
            ptyId,
            ...target,
            payload
          })
        } catch (err) {
          console.error('[runtime] terminal agent status listener threw', {
            ptyId,
            paneKey: target.paneKey,
            state: payload.state,
            agentType: payload.agentType,
            err
          })
        }
      }
    }
    return retainedChanged
  }
  protected retainAgentRowSnapshot(
    ptyId: string,
    paneKey: string,
    worktreeId: string | undefined,
    tabId: string | undefined,
    payload: ParsedAgentStatusPayload
  ): boolean {
    const now = Date.now()
    const previous = this.latestAgentStatusByPaneKey.get(paneKey)
    // Why: stateStartedAt must mark the transition into the current state, not
    // every within-state ping (tool/prompt updates keep the state but refresh
    // updatedAt) — mirrors AgentStatusEntry.stateStartedAt on the desktop side.
    const stateStartedAt =
      previous && previous.payload.state === payload.state ? previous.stateStartedAt : now
    this.latestAgentStatusByPaneKey.set(paneKey, {
      paneKey,
      ptyId,
      worktreeId,
      tabId,
      payload,
      stateStartedAt,
      updatedAt: now
    })
    // Client-visible change detection: snapshot republish is gated on this so
    // repeated same-state hook pings don't fan a rebuild out to every client.
    return (
      !previous ||
      previous.payload.state !== payload.state ||
      previous.payload.prompt !== payload.prompt ||
      (previous.payload.agentType ?? null) !== (payload.agentType ?? null) ||
      (previous.payload.toolName ?? null) !== (payload.toolName ?? null) ||
      (previous.payload.interactivePrompt ?? null) !== (payload.interactivePrompt ?? null) ||
      (previous.payload.interrupted ?? false) !== (payload.interrupted ?? false)
    )
  }
  protected clearAgentRowSnapshotsForPty(ptyId: string): void {
    for (const [paneKey, snapshot] of this.latestAgentStatusByPaneKey) {
      if (snapshot.ptyId === ptyId) {
        this.latestAgentStatusByPaneKey.delete(paneKey)
      }
    }
  }
  getPtyOutputSequence(ptyId: string): number {
    return this.terminalOutputState.getSequence(ptyId)
  }
  protected getPtyLifecycleGeneration(ptyId: string): number {
    const existing = this.ptyLifecycleGenerationById.get(ptyId)
    if (existing !== undefined) {
      return existing
    }
    const generation = this.nextPtyLifecycleGeneration++
    this.ptyLifecycleGenerationById.set(ptyId, generation)
    return generation
  }
  protected advancePtyLifecycleGeneration(ptyId: string): void {
    this.ptyLifecycleGenerationById.set(ptyId, this.nextPtyLifecycleGeneration++)
    // Why: a provider response belongs to the process generation that issued
    // it; a respawn must neither reuse its frame nor join its in-flight call.
    this.providerBufferAcquisitionsByPtyId.delete(ptyId)
    this.providerVisibleStateByPtyId.delete(ptyId)
    this.providerVisibleRetryAtByPtyId.delete(ptyId)
  }
  protected admitPtyLifecycle(
    pty: RuntimePtyWorktreeRecord,
    incarnationId?: PtyIncarnationId,
    options: { adoptHandles?: boolean } = {}
  ): void {
    const incarnationChanged = incarnationId !== undefined && pty.incarnationId !== incarnationId
    const lifecycleRestarted = !pty.connected || pty.lastExitCode !== null || incarnationChanged
    const admittedIncarnation =
      lifecycleRestarted && incarnationId === undefined
        ? `runtime-${this.runtimeId}-${this.nextSyntheticPtyIncarnation++}`
        : incarnationId
    const shouldAdoptHandles =
      options.adoptHandles === true || (options.adoptHandles !== false && lifecycleRestarted)
    if (lifecycleRestarted) {
      this.advancePtyLifecycleGeneration(pty.ptyId)
    }
    if (admittedIncarnation !== undefined) {
      pty.incarnationId = admittedIncarnation
    }
    this.rendererGraphLivenessBlockedPtys.delete(pty.ptyId)
    pty.connected = true
    pty.disconnectedAt = null
    pty.lastExitCode = null
    for (const leaf of this.getLeavesForPty(pty.ptyId)) {
      leaf.connected = true
      leaf.writable = this.graphStatus === 'ready'
      leaf.lastExitCode = null
      if (shouldAdoptHandles) {
        this.adoptPreAllocatedHandle(leaf)
      }
    }
  }
  protected markPtyDisconnected(pty: RuntimePtyWorktreeRecord): void {
    if (pty.connected) {
      const generation = this.getPtyLifecycleGeneration(pty.ptyId)
      this.cancelLayoutQueue(pty.ptyId, generation)
      this.freshSubscribeGuard.clear(pty.ptyId, generation)
      this.layouts.delete(pty.ptyId)
      this.advancePtyLifecycleGeneration(pty.ptyId)
      this.rendererGraphLivenessBlockedPtys.add(pty.ptyId)
    }
    pty.connected = false
    pty.disconnectedAt ??= Date.now()
    for (const leaf of this.getLeavesForPty(pty.ptyId)) {
      leaf.connected = false
      leaf.writable = false
    }
  }
  synchronizePtyOutputSequenceFromProvider(
    ptyId: string,
    providerSequence: { value: number; generation: 'continued' | 'reset' },
    runtimeSequenceAtSpawnStart = 0
  ): number {
    if (
      !Number.isFinite(providerSequence.value) ||
      providerSequence.value < 0 ||
      !Number.isFinite(runtimeSequenceAtSpawnStart) ||
      runtimeSequenceAtSpawnStart < 0
    ) {
      return this.getPtyOutputSequence(ptyId)
    }
    const baseline = Math.floor(providerSequence.value)
    const currentSequence = this.getPtyOutputSequence(ptyId)
    const sequenceAtSpawnStart = Math.min(currentSequence, Math.floor(runtimeSequenceAtSpawnStart))
    const postSpawnSequence = currentSequence - sequenceAtSpawnStart
    const wasInitialized = this.providerSequenceInitializedPtys.has(ptyId)
    const replacesExistingRuntimeGeneration = wasInitialized || sequenceAtSpawnStart > 0
    const providerOffset =
      providerSequence.generation === 'reset'
        ? sequenceAtSpawnStart
        : (this.providerSequenceOffsetByPtyId.get(ptyId) ?? 0)
    const providerBaseline = providerOffset + baseline

    if (providerSequence.generation === 'reset') {
      this.advancePtyLifecycleGeneration(ptyId)
      // Why: daemon respawn/cold restore starts a new absolute domain. Old
      // emulator state cannot remain authoritative over the replacement.
      if (replacesExistingRuntimeGeneration) {
        this.disposeHeadlessTerminal(ptyId)
      }
      this.providerModeTrackersByPtyId.delete(ptyId)
      this.wslDistroByPtyId.delete(ptyId)
      this.terminalCwdByPtyId.delete(ptyId)
      this.terminalFileUriHostnameByPtyId.delete(ptyId)
      const pty = this.ptysById.get(ptyId)
      if (pty) {
        pty.wslDistro = null
      }
      if (replacesExistingRuntimeGeneration && postSpawnSequence === 0) {
        this.resetTrackedTerminalStateForProviderGeneration(ptyId)
      }
    }

    const synchronizedSequence =
      providerSequence.generation === 'reset'
        ? currentSequence
        : wasInitialized
          ? currentSequence
          : providerBaseline + postSpawnSequence
    this.terminalOutputState.setSequence(ptyId, synchronizedSequence)
    this.providerSequenceInitializedPtys.add(ptyId)
    this.providerSequenceOffsetByPtyId.set(ptyId, providerOffset)

    const snapshotMayCoverMissingState =
      (providerSequence.generation === 'continued' && !wasInitialized) ||
      (postSpawnSequence > 0 &&
        providerSequence.generation === 'reset' &&
        replacesExistingRuntimeGeneration) ||
      (providerSequence.generation === 'continued' &&
        wasInitialized &&
        providerBaseline > currentSequence)
    if (snapshotMayCoverMissingState) {
      // Why: bytes can cross the control/stream sockets around attach. Until a
      // full renderer/provider snapshot is available, a partial model is unsafe.
      this.providerSnapshotPreferredPtys.add(ptyId)
    } else if (providerSequence.generation === 'reset') {
      this.providerSnapshotPreferredPtys.delete(ptyId)
    }

    const headless = this.headlessTerminals.get(ptyId)
    if (headless && !wasInitialized && providerSequence.generation === 'continued') {
      // Why: daemon bytes can reach main just before spawn resolves. Queue the
      // baseline behind those writes so their emulator sequence is rebased too.
      headless.writeChain = headless.writeChain.then(() => {
        headless.outputSequence = synchronizedSequence
      })
    }
    return synchronizedSequence
  }
  subscribeToTerminalData(
    ptyId: string,
    listener: (data: string, meta?: RuntimeTerminalDataMeta) => void
  ): () => void {
    return this.terminalOutputState.subscribe(ptyId, listener)
  }
  setRemoteTerminalSourceRangeConsumerHooks(
    hooks: RemoteTerminalSourceRangeConsumerHooks | null
  ): void {
    this.remoteTerminalSourceRangeConsumerHooks = hooks
  }
  attachRemoteTerminalSourceRangeConsumer(
    identity: RemoteTerminalSourceRangeStreamIdentity
  ): boolean {
    return this.remoteTerminalSourceRangeConsumerHooks?.attach(identity) ?? false
  }
  settleRemoteTerminalSourceRanges(
    identity: RemoteTerminalSourceRangeStreamIdentity,
    ranges: readonly TerminalOutputSourceRange[]
  ): void {
    this.remoteTerminalSourceRangeConsumerHooks?.settle(identity, ranges)
  }
  reserveRemoteTerminalSourceRangeReplacement(
    identity: RemoteTerminalSourceRangeStreamIdentity,
    requiredSeq: number,
    reason: string
  ): RemoteTerminalSourceRangeReplacementReservation | null {
    return (
      this.remoteTerminalSourceRangeConsumerHooks?.reserveReplacement(
        identity,
        requiredSeq,
        reason
      ) ?? null
    )
  }
  commitRemoteTerminalSourceRangeReplacement(
    reservation: RemoteTerminalSourceRangeReplacementReservation,
    publication: RemoteTerminalSourceRangeReplacementPublication
  ): boolean {
    return (
      this.remoteTerminalSourceRangeConsumerHooks?.commitReplacement(reservation, publication) ??
      false
    )
  }
  rollbackRemoteTerminalSourceRangeReplacement(
    reservation: RemoteTerminalSourceRangeReplacementReservation,
    reason: string
  ): boolean {
    return (
      this.remoteTerminalSourceRangeConsumerHooks?.rollbackReplacement(reservation, reason) ?? false
    )
  }
  cancelRemoteTerminalSourceRanges(
    identity: RemoteTerminalSourceRangeStreamIdentity,
    ranges: readonly TerminalOutputSourceRange[],
    reason: string
  ): void {
    this.remoteTerminalSourceRangeConsumerHooks?.cancel(identity, ranges, reason)
  }

  /** Set by pty IPC: fires when a PTY gains/loses remote view subscribers so
   *  the daemon background mark (keep-tail stream thinning) can resync — a
   *  live mobile/web view consumes raw bytes and must never be thinned, even
   *  while the desktop pane is hidden. */
  onRemoteTerminalViewPresenceChanged: ((ptyId: string) => void) | null = null
  protected notifyRemoteTerminalViewPresenceChanged(ptyId: string): void {
    try {
      this.onRemoteTerminalViewPresenceChanged?.(ptyId)
    } catch (err) {
      console.error('[runtime] remote view presence listener threw', { ptyId, err })
    }
  }

  /** Registered by terminal-RPC subscribe/multiplex streams: while a remote
   *  view subscriber is attached its xterm answers queries with view
   *  authority and the model responder must stay silent. Returns an
   *  idempotent release. */
  registerRemoteTerminalViewSubscriber(ptyId: string): () => void {
    this.remoteTerminalViewSubscriberCounts.set(
      ptyId,
      (this.remoteTerminalViewSubscriberCounts.get(ptyId) ?? 0) + 1
    )
    this.notifyRemoteTerminalViewPresenceChanged(ptyId)
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      const next = (this.remoteTerminalViewSubscriberCounts.get(ptyId) ?? 1) - 1
      if (next <= 0) {
        this.remoteTerminalViewSubscriberCounts.delete(ptyId)
      } else {
        this.remoteTerminalViewSubscriberCounts.set(ptyId, next)
      }
      this.notifyRemoteTerminalViewPresenceChanged(ptyId)
    }
  }

  /** Mark a raw-output viewer without transferring terminal query authority. */
}
