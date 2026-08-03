import { extractOscTitleScanTail, type TerminalOutputSourceRange, type PtyIncarnationId, advertisedUrlWatcher, buildPreview, computeTerminalTailWaitState, MAX_TAIL_CHARS, tailGainedNewerBlockedReason, type TerminalTailWaitState, appendNormalizedToTailBuffer, appendCompletedTerminalTranscript, tailStateMatches, normalizeTerminalChunk } from './orca-runtime-symbols'
import { OrcaRuntimeRememberObservedPtyExitPart19 } from './orca-runtime-remember-observed-pty-exit-part-19'

export class OrcaRuntimeOnPtyDataPart20 extends OrcaRuntimeRememberObservedPtyExitPart19 {
  onPtyData(
    ptyId: string,
    data: string,
    at: number,
    sequenceChars = data.length,
    transformed = false,
    captureModelReceipt?: (completion: Promise<void>) => void,
    sourceRanges?: readonly TerminalOutputSourceRange[],
    captureAdmission?: (admitted: boolean) => void,
    incarnationId?: PtyIncarnationId
  ): number {
    const existingPty = this.ptysById.get(ptyId)
    const accepted = incarnationId
      ? this.acceptsPtyDataForIncarnation(ptyId, incarnationId)
      : this.acceptsPtyDataForCurrentLifecycle(ptyId)
    if (!accepted || (existingPty && !existingPty.connected && !incarnationId)) {
      captureAdmission?.(false)
      captureModelReceipt?.(Promise.resolve())
      return this.terminalOutputState.getSequence(ptyId)
    }
    captureAdmission?.(true)
    const outputSequence = this.terminalOutputState.advanceSequence(ptyId, sequenceChars)
    this.providerModeTrackersByPtyId.get(ptyId)?.scan(data)
    for (const tracker of this.providerModeSnapshotScansByPtyId.get(ptyId) ?? []) {
      tracker.scan(data)
    }
    const osc7Metadata = this.recordOsc7MetadataForPty(ptyId, data)
    const cwd = osc7Metadata.cwd
    const cwdChanged = osc7Metadata.cwdChanged
    const agentStatusChunk = this.processAgentStatusOscForPty(ptyId, data)
    this.recordRecentPtyOutputForPathProvenance(ptyId, data)
    // Agent detection runs on raw data before leaf processing, since the
    // tail buffer logic normalizes away the OSC sequences we need.
    this.agentDetector?.onData(ptyId, data, at)
    // Why: watch terminal output for advertised dev-server URLs (e.g. Vite's
    // `Network: https://local.example.com:3001/`) so the workspace ports
    // panel can surface them in place of the kernel bind address.
    advertisedUrlWatcher.ingest(ptyId, data, at)
    // Why: reply ownership is captured per chunk, here at ingestion — the
    // same module state and tick as the hidden-gate drop sites — and rides
    // the writeChain link. A mark/setting/subscriber flip before the queued
    // emulator write runs must not change who answers (terminal-query-
    // authority.md invariant 1).
    const forwardQueryReplies = this.shouldAnswerQueriesForLiveChunk(ptyId)
    // Ordering invariant (DO NOT REORDER): maybeHydrateHeadlessFromRenderer
    // MUST run before trackHeadlessTerminalData so the eager-state pattern
    // (set headlessTerminals + writeChain head = seedPromise) is in place
    // before the live byte's chain link is queued. Without this ordering,
    // trackHeadlessTerminalData would lazy-create a fresh state at PTY dims
    // that the later seed-resolve would overwrite, dropping the live byte.
    // See docs/mobile-prefer-renderer-scrollback.md.
    this.maybeHydrateHeadlessFromRenderer(ptyId)
    // Our structure wins: OSC title/agent-status extraction runs through the
    // shared per-PTY title tracker below (getOrCreatePtyTitleTrackerEntry →
    // applyTrackedPtyTitle) in byte order, superseding main's inline
    // extractLastOscTitleForPty block (#7880/#7852 title/status semantics are
    // preserved via the tracker + detectAgentStatusFromTitle path).
    const modelCompletion = this.trackHeadlessTerminalData(
      ptyId,
      data,
      outputSequence,
      forwardQueryReplies
    )
    captureModelReceipt?.(modelCompletion)

    const pty = this.getOrCreatePtyWorktreeRecord(ptyId)
    const ptyTailBefore = pty
      ? {
          lines: pty.tailBuffer,
          transcriptLines: pty.tailTranscriptBuffer,
          partialLine: pty.tailPartialLine,
          pendingAnsi: pty.tailPendingAnsi,
          redrawCursor: pty.tailRedrawCursor,
          truncated: pty.tailTruncated,
          linesTotal: pty.tailLinesTotal
        }
      : null
    let ptyTailAfter: ReturnType<typeof appendNormalizedToTailBuffer> | null = null
    if (pty) {
      pty.lastOutputAt = at
      const normalized = normalizeTerminalChunk(data, pty.tailPendingAnsi)
      pty.tailPendingAnsi = normalized.pendingAnsi
      const nextTail = appendNormalizedToTailBuffer(
        pty.tailBuffer,
        pty.tailPartialLine,
        normalized.text,
        pty.tailRedrawCursor
      )
      ptyTailAfter = nextTail
      const nextTranscript = appendCompletedTerminalTranscript(
        pty.tailTranscriptBuffer,
        pty.tailTranscriptChars,
        nextTail.newlyCompletedLines,
        nextTail.newCompleteLines
      )
      pty.tailBuffer = nextTail.lines
      pty.tailTranscriptBuffer = nextTranscript.lines
      pty.tailTranscriptChars = nextTranscript.characters
      pty.tailPartialLine = nextTail.partialLine
      pty.tailRedrawCursor = nextTail.redrawCursor
      pty.tailTruncated = pty.tailTruncated || nextTail.truncated || nextTranscript.truncated
      pty.tailLinesTotal += nextTail.newCompleteLines
      pty.preview = buildPreview(pty.tailBuffer, pty.tailPartialLine)
      this.scheduleWaitBlockedCheck(ptyId, normalized.text, at)
    }

    for (const leaf of this.getLeavesForPty(ptyId)) {
      this.recordPtyWorktree(ptyId, leaf.worktreeId, {
        lastOutputAt: pty?.lastOutputAt ?? at,
        preview: pty?.preview ?? leaf.preview,
        tabId: leaf.tabId,
        paneKey: this.makeRuntimePaneKey(leaf)
      })
      leaf.connected = true
      leaf.writable = this.graphStatus === 'ready'
      leaf.lastOutputAt = at
      if (
        pty &&
        ptyTailBefore &&
        ptyTailAfter &&
        tailStateMatches(
          leaf.tailBuffer,
          leaf.tailTranscriptBuffer,
          leaf.tailPartialLine,
          leaf.tailPendingAnsi,
          leaf.tailRedrawCursor,
          leaf.tailTruncated,
          leaf.tailLinesTotal,
          ptyTailBefore
        )
      ) {
        // Why: the leaf and PTY record usually mirror the same terminal. Reuse
        // the PTY tail update instead of splitting large output twice.
        leaf.tailBuffer = pty.tailBuffer
        leaf.tailTranscriptBuffer = pty.tailTranscriptBuffer
        leaf.tailTranscriptChars = pty.tailTranscriptChars
        leaf.tailPartialLine = pty.tailPartialLine
        leaf.tailPendingAnsi = pty.tailPendingAnsi
        leaf.tailRedrawCursor = pty.tailRedrawCursor
        leaf.tailTruncated = pty.tailTruncated
        leaf.tailLinesTotal = pty.tailLinesTotal
        leaf.preview = pty.preview
        leaf.waitBlockedAt = pty.waitBlockedAt
        // Why undefined on this branch: the PTY record's wait scan is throttled
        // (scheduleWaitBlockedCheck), so pty.tailWaitState is never populated;
        // copying it here intentionally invalidates the leaf cache and the
        // mismatch branch below recomputes an exact state on its next chunk.
        leaf.tailWaitState = pty.tailWaitState
      } else {
        const normalized = normalizeTerminalChunk(data, leaf.tailPendingAnsi)
        leaf.tailPendingAnsi = normalized.pendingAnsi
        const previousWaitState =
          leaf.tailWaitState?.fromTail === true
            ? leaf.tailWaitState
            : computeTerminalTailWaitState(leaf.tailBuffer, leaf.tailPartialLine, leaf.preview)
        const nextTail = appendNormalizedToTailBuffer(
          leaf.tailBuffer,
          leaf.tailPartialLine,
          normalized.text,
          leaf.tailRedrawCursor
        )
        const nextTranscript = appendCompletedTerminalTranscript(
          leaf.tailTranscriptBuffer,
          leaf.tailTranscriptChars,
          nextTail.newlyCompletedLines,
          nextTail.newCompleteLines
        )
        const nextWaitState = computeTerminalTailWaitState(
          nextTail.lines,
          nextTail.partialLine,
          leaf.preview
        )
        if (tailGainedNewerBlockedReason(previousWaitState, nextWaitState, normalized.text)) {
          leaf.waitBlockedAt = at
        }
        leaf.tailWaitState = nextWaitState
        leaf.tailBuffer = nextTail.lines
        leaf.tailTranscriptBuffer = nextTranscript.lines
        leaf.tailTranscriptChars = nextTranscript.characters
        leaf.tailPartialLine = nextTail.partialLine
        leaf.tailRedrawCursor = nextTail.redrawCursor
        leaf.tailTruncated = leaf.tailTruncated || nextTail.truncated || nextTranscript.truncated
        leaf.tailLinesTotal += nextTail.newCompleteLines
        leaf.preview = buildPreview(leaf.tailBuffer, leaf.tailPartialLine)
      }
    }

    // Why: feed the chunk's OSC titles through the shared per-PTY tracker in
    // byte order — the same ordering the renderer transport uses — so
    // coalesced working→idle transitions reach tui-idle waiters and
    // pending-message delivery instead of being masked by the chunk's last
    // title (issue #1083). Uses the OSC 9999-stripped cleanData like the
    // renderer, so pure status chunks don't perturb the stale-title probe.
    const titleTrackerEntry = this.getOrCreatePtyTitleTrackerEntry(ptyId)
    const previousTitleScanTail = this.oscTitleScanTailByPtyId.get(ptyId)
    const titleInput = previousTitleScanTail
      ? `${previousTitleScanTail}${agentStatusChunk.cleanData}`
      : agentStatusChunk.cleanData
    const nextTitleScanTail = extractOscTitleScanTail(titleInput)
    if (nextTitleScanTail.length > 0) {
      this.oscTitleScanTailByPtyId.set(ptyId, nextTitleScanTail)
    } else {
      this.oscTitleScanTailByPtyId.delete(ptyId)
    }
    titleTrackerEntry.applyingChunk = true
    titleTrackerEntry.chunkTouchedSessionTabs = false
    let retainedAgentStatusChanged = false
    try {
      for (const payload of agentStatusChunk.payloads) {
        titleTrackerEntry.pendingFacts.push({ kind: 'agent-status', payload })
      }
      titleTrackerEntry.tracker.handleChunk(agentStatusChunk.cleanData, {
        titleScanData: titleInput
      })
      // Why: the Command Code scrape rides the same per-chunk batch (its facts
      // trail the tracker's). cleanData keeps OSC 9999 payloads out of the
      // detector's bounded recent-text window; the detector strips remaining
      // control sequences itself, exactly like the renderer byte path.
      titleTrackerEntry.commandCodeDetector?.observe(agentStatusChunk.cleanData)
    } finally {
      titleTrackerEntry.applyingChunk = false
      try {
        // Why: per-chunk cross-channel contract order is status → titles →
        // bell — the chunk's agentStatus:set events must reach the renderer
        // before its pty:sideEffect batch.
        retainedAgentStatusChanged = this.emitTerminalAgentStatusEvents(ptyId, agentStatusChunk)
      } finally {
        // Why: flushed in the finally so a throwing tracker callback cannot
        // strand this chunk's facts to be emitted under the next chunk's seq.
        this.flushPendingTerminalSideEffectFacts(ptyId, titleTrackerEntry)
      }
    }
    // Why: hook (OSC 9999) transitions often arrive without a title change, so
    // headless-serve snapshots would never republish and paired remote clients
    // kept the stale agent state until the next title change (#7970).
    if (titleTrackerEntry.chunkTouchedSessionTabs || retainedAgentStatusChanged) {
      this.touchMobileSessionSnapshotsForPty(ptyId)
    }

    this.terminalOutputState.publish(ptyId, data, {
      seq: outputSequence,
      rawLength: sequenceChars,
      ...(transformed ? { transformed: true } : {}),
      ...(cwdChanged && cwd !== null ? { cwd } : {}),
      ...(sourceRanges && sourceRanges.length > 0 ? { sourceRanges } : {})
    })
    return outputSequence
  }
  protected scheduleWaitBlockedCheck(ptyId: string, appendedText: string, at: number): void {
    let state = this.waitBlockedCheckStateByPtyId.get(ptyId)
    if (!state) {
      state = { lastAt: 0, lastWaitState: null, appended: '', keywordCarry: '', timer: null }
      this.waitBlockedCheckStateByPtyId.set(ptyId, state)
    }
    const appendedLower = appendedText.toLowerCase()
    const keywordHit = WAIT_BLOCKED_KEYWORD_PATTERN.test(`${state.keywordCarry}${appendedLower}`)
    state.keywordCarry = appendedLower.slice(-WAIT_BLOCKED_KEYWORD_CARRY_CHARS)
    // Why the cap keeps the tail: the accumulated text only anchors boundary-
    // spanning prompt detection; anything past the tail cap has scrolled out
    // of the retained tail the check reads anyway.
    state.appended =
      state.appended.length + appendedText.length > MAX_TAIL_CHARS
        ? `${state.appended}${appendedText}`.slice(-MAX_TAIL_CHARS)
        : `${state.appended}${appendedText}`
    const elapsed = at - state.lastAt
    if (keywordHit || elapsed >= WAIT_BLOCKED_CHECK_MIN_INTERVAL_MS || elapsed < 0) {
      this.runWaitBlockedCheck(ptyId, state, at)
      return
    }
    if (!state.timer) {
      // Why trailing edge: the final chunks of a burst must still be
      // evaluated or a prompt arriving right after a flood would go
      // unstamped until the next output.
      state.timer = setTimeout(() => {
        state.timer = null
        this.runWaitBlockedCheck(ptyId, state, Date.now())
      }, WAIT_BLOCKED_CHECK_MIN_INTERVAL_MS - elapsed)
    }
  }
  protected runWaitBlockedCheck(
    ptyId: string,
    state: {
      lastAt: number
      lastWaitState: TerminalTailWaitState | null
      appended: string
      keywordCarry: string
      timer: ReturnType<typeof setTimeout> | null
    },
    at: number
  ): void {
    const pty = this.ptysById.get(ptyId)
    if (!pty) {
      state.appended = ''
      return
    }
    const nextWaitState = computeTerminalTailWaitState(
      pty.tailBuffer,
      pty.tailPartialLine,
      pty.preview
    )
    const previousWaitState = state.lastWaitState ?? {
      waitText: '',
      signal: null,
      fromTail: false
    }
    if (tailGainedNewerBlockedReason(previousWaitState, nextWaitState, state.appended)) {
      pty.waitBlockedAt = at
    }
    state.lastAt = at
    state.lastWaitState = nextWaitState
    state.appended = ''
  }
}
import { WAIT_BLOCKED_CHECK_MIN_INTERVAL_MS, WAIT_BLOCKED_KEYWORD_PATTERN, WAIT_BLOCKED_KEYWORD_CARRY_CHARS } from './orca-runtime-tail-constants'
