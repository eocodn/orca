import { detectAgentStatusFromTitle, isCursorNativeAgentTitle, normalizeTerminalTitle, stripBrailleSpinnerGlyphs, type TerminalSideEffectBatch, type TerminalSideEffectFact, createAgentStatusOscProcessor, type ProcessedAgentStatusChunk, type PtyTransientFact, type RuntimePtyTitleTrackerEntry } from './orca-runtime-symbols'
import { OrcaRuntimeOnPtyDataPart20 } from './orca-runtime-on-pty-data-part-20'

export class OrcaRuntimeClearWaitBlockedCheckStatePart21 extends OrcaRuntimeOnPtyDataPart20 {
  protected clearWaitBlockedCheckState(ptyId: string): void {

    const state = this.waitBlockedCheckStateByPtyId.get(ptyId)
    if (state?.timer) {
      clearTimeout(state.timer)
    }
    this.waitBlockedCheckStateByPtyId.delete(ptyId)
  }
  protected processAgentStatusOscForPty(ptyId: string, data: string): ProcessedAgentStatusChunk {
    let processor = this.agentStatusOscProcessorsByPtyId.get(ptyId)
    if (!processor) {
      processor = createAgentStatusOscProcessor()
      this.agentStatusOscProcessorsByPtyId.set(ptyId, processor)
    }
    return processor(data)
  }

  /** Emit the facts batched while applying one chunk/frame as a single
   *  pty:sideEffect batch, preserving byte order. */
  protected flushPendingTerminalSideEffectFacts(
    ptyId: string,
    entry: RuntimePtyTitleTrackerEntry
  ): void {
    if (entry.pendingFacts.length === 0) {
      return
    }
    const facts = entry.pendingFacts
    entry.pendingFacts = []
    this.emitTerminalSideEffectBatch(ptyId, facts)
  }

  /** Feed a main-fabricated OSC title/BEL frame (agent hook spinners) through
   *  the per-PTY tracker — NOT onPtyData, so emulator state, tails,
   *  transcripts, and stats never see synthetic bytes. Parsed via the
   *  tracker's stateless synthetic path: the shared chunk bell detector must
   *  never observe fabricated bytes, or a tick interleaved with a split real
   *  OSC corrupts its escape state (phantom/swallowed bells). While the
   *  side-effect kill switch is off the legacy pty:data copy still drives
   *  renderer parsers; this ingest keeps main's facts and records
   *  authoritative. */
  ingestSyntheticTitleFrame(ptyId: string, data: string): void {
    const entry = this.getOrCreatePtyTitleTrackerEntry(ptyId)
    entry.applyingChunk = true
    entry.applyingSyntheticFrame = true
    entry.chunkTouchedSessionTabs = false
    try {
      entry.tracker.applySyntheticTitleFrame(data)
    } finally {
      entry.applyingChunk = false
      entry.applyingSyntheticFrame = false
      this.flushPendingTerminalSideEffectFacts(ptyId, entry)
    }
    if (entry.chunkTouchedSessionTabs) {
      this.touchMobileSessionSnapshotsForPty(ptyId)
    }
  }

  /** Scan-authority handoff for a backgrounded PTY (daemon keep-tail
   *  thinning): while delegated, the daemon relays bell/133/pr-link/2031
   *  facts itself and the delivered bytes may be gapped — feeding them to
   *  main's transient scanners would mint phantom or duplicate facts. Title
   *  processing stays main-side either way. */
  setPtyTransientFactDelegation(
    ptyId: string,
    delegated: boolean,
    scanSeedAnsi?: string,
    mode2031PendingSubscribe?: true
  ): void {
    const entry = this.getOrCreatePtyTitleTrackerEntry(ptyId)
    entry.tracker.setTransientFactScanningSuppressed(delegated)
    if (!delegated && scanSeedAnsi) {
      // Prime the freshly reset scanner carry with the emulator's dangling
      // incomplete escape at the handoff position — a sequence split across
      // the un-background toggle must not mint a phantom bell or lose its
      // fact. titleScanData:'' keeps titles out (they were never suppressed).
      entry.tracker.handleChunk(scanSeedAnsi, {
        titleScanData: '',
        mode2031PendingSubscribe
      })
    }
  }

  /** A transient fact the daemon detected while it held scan authority —
   *  emitted through the same fact channel as byte-scanned facts. Arrives
   *  between chunks, so recordTerminalSideEffectFact emits it immediately. */
  emitDaemonPtyTransientFact(ptyId: string, fact: PtyTransientFact): void {
    switch (fact.kind) {
      case 'bell':
        this.recordTerminalSideEffectFact(ptyId, { kind: 'bell' })
        return
      case 'command-finished':
        this.retirePtyAgentLaunchAuthority(ptyId)
        this.recordTerminalSideEffectFact(ptyId, {
          kind: 'command-finished',
          exitCode: fact.exitCode
        })
        return
      case 'pr-link':
        this.recordTerminalSideEffectFact(ptyId, { kind: 'pr-link', link: fact.link })
        return
      case '2031-subscribe':
        this.recordTerminalSideEffectFact(ptyId, { kind: '2031-subscribe' })
        return
      case '2031-unsubscribe':
        this.recordTerminalSideEffectFact(ptyId, { kind: '2031-unsubscribe' })
    }
  }

  /** The daemon keep-tail dropped this PTY's oldest undelivered output; the
   *  next delivered chunk is discontinuous. Reset every cross-chunk parse
   *  carry so a half-open escape from before the gap cannot corrupt what
   *  follows, and drop the mobile headless mirror — it rebuilds from the
   *  delivered tail / snapshot seeds instead of parsing a gapped stream. */
  notePtyDataGap(ptyId: string, droppedChars = 0): void {
    if (droppedChars > 0) {
      // Why: the daemon snapshot's seq counts bytes its monitoring stream
      // dropped. Advancing without parsing preserves that absolute domain so
      // post-snapshot live chunks can be reconciled instead of duplicated.
      this.terminalOutputState.advanceSequence(ptyId, droppedChars)
    }
    const pty = this.getOrCreatePtyWorktreeRecord(ptyId)
    if (pty) {
      pty.tailPendingAnsi = ''
    }
    for (const leaf of this.getLeavesForPty(ptyId)) {
      leaf.tailPendingAnsi = ''
    }
    this.oscTitleScanTailByPtyId.delete(ptyId)
    this.osc7ScanTailByPtyId.delete(ptyId)
    this.agentStatusOscProcessorsByPtyId.delete(ptyId)
    this.disposeHeadlessTerminal(ptyId)
  }

  /** Record one derived side-effect fact: batched per chunk while applying
   *  bytes, emitted immediately for between-chunk facts (stale-title timer). */
  protected recordTerminalSideEffectFact(ptyId: string, fact: TerminalSideEffectFact): void {
    if (!this.terminalSideEffectConsumerAvailable) {
      return
    }
    const entry = this.ptyTitleTrackersByPtyId.get(ptyId)
    if (entry?.applyingChunk) {
      entry.pendingFacts.push(fact)
      return
    }
    this.emitTerminalSideEffectBatch(ptyId, [fact])
  }
  protected emitTerminalSideEffectBatch(
    ptyId: string,
    facts: TerminalSideEffectFact[],
    options: { replay?: boolean } = {}
  ): void {
    if (!this.terminalSideEffectConsumerAvailable || facts.length === 0) {
      return
    }
    const batch: TerminalSideEffectBatch = {
      ptyId,
      seq: this.terminalOutputState.getSequence(ptyId),
      facts,
      ...(options.replay ? { replay: true } : {}),
      ...this.resolveTerminalSideEffectAttribution(ptyId)
    }
    if (this.terminalSideEffectLocalConsumerAvailable) {
      try {
        this.onTerminalSideEffects?.(batch)
      } catch (err) {
        console.error('[runtime] terminal side-effect listener threw', { ptyId, err })
      }
    }
    if (this.countTerminalSideEffectConsumingClientEventListeners() > 0) {
      this.emitClientEvent({ type: 'terminalSideEffects', batch })
    }
  }

  /** Same attribution resolution as emitTerminalAgentStatusEvents: prefer the
   *  first mounted leaf, fall back to the spawn-time PTY record binding. */
  protected resolveTerminalSideEffectAttribution(ptyId: string): {
    worktreeId?: string
    tabId?: string
    paneKey?: string
    connectionId?: string | null
  } {
    const pty = this.ptysById.get(ptyId)
    const connectionId = pty?.connectionId ?? null
    for (const leaf of this.getLeavesForPty(ptyId)) {
      return {
        worktreeId: leaf.worktreeId,
        tabId: leaf.tabId,
        paneKey: this.makeRuntimePaneKey(leaf),
        connectionId
      }
    }
    if (pty?.paneKey) {
      return {
        worktreeId: pty.worktreeId,
        ...(pty.tabId ? { tabId: pty.tabId } : {}),
        paneKey: pty.paneKey,
        connectionId
      }
    }
    return {}
  }

  /** Title-only replay batch for renderer (re)attach — the no-attention-replay
   *  rule: snapshots restore title state, never historical bells/completions. */
  getTerminalSideEffectSnapshot(ptyId: string): TerminalSideEffectBatch | null {
    const tracker = this.ptyTitleTrackersByPtyId.get(ptyId)?.tracker
    const recordTitle = this.ptysById.get(ptyId)?.lastOscTitle
    // Why: the cursor-agent literal drop applies to every title surface; a
    // record-fallback snapshot must not replay the bare native title the
    // tracker would have refused to emit live.
    const rawTitle = recordTitle && !isCursorNativeAgentTitle(recordTitle) ? recordTitle : null
    const normalizedTitle = tracker?.getLastNormalizedTitle() ?? null
    if (normalizedTitle === null && !rawTitle) {
      return null
    }
    return {
      ptyId,
      seq: this.terminalOutputState.getSequence(ptyId),
      replay: true,
      facts: [
        {
          kind: 'title',
          normalizedTitle: normalizedTitle ?? normalizeTerminalTitle(rawTitle!),
          rawTitle: rawTitle ?? normalizedTitle!
        }
      ],
      ...this.resolveTerminalSideEffectAttribution(ptyId)
    }
  }

  /** Raw last title from main's tracked PTY/leaf records — the title surface
   *  the tracker (live bytes + synthetic frames) keeps current. */
  protected getTrackedRawTitleForPty(ptyId: string): string | null {
    const recordTitle = this.ptysById.get(ptyId)?.lastOscTitle
    if (recordTitle) {
      return recordTitle
    }
    for (const leaf of this.getLeavesForPty(ptyId)) {
      if (leaf.lastOscTitle) {
        return leaf.lastOscTitle
      }
    }
    return null
  }

  /** Why: synthetic agent title frames no longer ride pty:data, so neither
   *  renderer xterm nor the headless emulator observes them. Mobile-parity
   *  snapshot titles must prefer main's tracker over snapshot lastTitle, or
   *  hook-driven spinner/idle titles vanish from mobile tabs. */
  protected preferTrackedLastTitle<T extends { lastTitle?: string }>(ptyId: string, snapshot: T): T {
    const tracked = this.getTrackedRawTitleForPty(ptyId)
    if (!tracked) {
      return snapshot
    }
    return { ...snapshot, lastTitle: tracked }
  }

  /** Decorative comparison key: spinner frame glyphs stripped, derived agent
   *  status kept so a working→idle flip with an otherwise-equal label still
   *  counts as a change. */
  protected makeMobileTitleGateKey(rawTitle: string, normalizedTitle: string): string {
    return `${detectAgentStatusFromTitle(rawTitle) ?? ''}\u0000${stripBrailleSpinnerGlyphs(
      normalizedTitle
    )}`
  }
}
