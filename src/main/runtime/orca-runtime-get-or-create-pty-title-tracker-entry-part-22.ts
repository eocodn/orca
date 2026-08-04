import { detectAgentStatusFromTitle, extractLastOsc7Uri, extractOscScanTail, parseFileUriPathParts, createTerminalTitleTracker, createCommandCodeOutputStatusDetector, type TerminalGitHubPRLink, splitWorktreeIdForFilesystem, isWindowsAbsolutePathLike, type RuntimePtyWorktreeRecord, type RuntimePtyTitleTrackerEntry } from './orca-runtime-symbols'
import { OrcaRuntimeClearWaitBlockedCheckStatePart21 } from './orca-runtime-clear-wait-blocked-check-state-part-21'

export class OrcaRuntimeGetOrCreatePtyTitleTrackerEntryPart22 extends OrcaRuntimeClearWaitBlockedCheckStatePart21 {
  protected getOrCreatePtyTitleTrackerEntry(ptyId: string): RuntimePtyTitleTrackerEntry {
    const existing = this.ptyTitleTrackersByPtyId.get(ptyId)
    if (existing) {
      return existing
    }
    // Why: trackers are created lazily on the first observed chunk. After an
    // app relaunch the PTY/leaf records can already hold a persisted title; a
    // cold tracker would miss the parked working→idle completion and never
    // arm the stale-title timer for a persisted 'working' title.
    let initialTitle = this.ptysById.get(ptyId)?.lastOscTitle ?? null
    if (initialTitle === null) {
      for (const leaf of this.getLeavesForPty(ptyId)) {
        if (leaf.lastOscTitle) {
          initialTitle = leaf.lastOscTitle
          break
        }
      }
    }
    const tracker = createTerminalTitleTracker(
      {
        onTitle: (normalizedTitle, rawTitle, meta) => {
          this.recordTerminalSideEffectFact(ptyId, {
            kind: 'title',
            normalizedTitle,
            rawTitle,
            ...(meta?.staleWorkingTitleClear ? { staleWorkingTitleClear: true } : {})
          })
          const changed = this.applyTrackedPtyTitle(ptyId, rawTitle, normalizedTitle)
          if (!changed) {
            return
          }
          const live = this.ptyTitleTrackersByPtyId.get(ptyId)
          const gateKey = this.makeMobileTitleGateKey(rawTitle, normalizedTitle)
          const decorativeOnly = live?.lastMobileTitleGateKey === gateKey
          if (live) {
            live.lastMobileTitleGateKey = gateKey
          }
          if (live?.applyingChunk) {
            // Why: synthetic spinner ticks change only the braille glyph
            // ~12.5x/sec; fanning out full mobile session snapshots per frame
            // is pure churn. Raw lastOscTitle updates above stay cheap.
            if (!(live.applyingSyntheticFrame && decorativeOnly)) {
              live.chunkTouchedSessionTabs = true
            }
          } else {
            // Stale-working-title timer path — fires between chunks, so the
            // per-chunk batching in onPtyData cannot pick it up.
            this.touchMobileSessionSnapshotsForPty(ptyId)
          }
        },
        // Why: agent transitions and bells become pty:sideEffect facts —
        // main is the single byte parser for local/SSH PTYs; the renderer
        // store handler decides what the facts mean (notification policy).
        onAgentBecameWorking: () => {
          this.recordTerminalSideEffectFact(ptyId, { kind: 'agent-working' })
        },
        onAgentBecameIdle: (title, meta) => {
          this.recordTerminalSideEffectFact(ptyId, {
            kind: 'agent-idle',
            title,
            ...(meta?.staleWorkingTitleClear ? { staleWorkingTitleClear: true } : {})
          })
        },
        onAgentExited: () => {
          this.recordTerminalSideEffectFact(ptyId, { kind: 'agent-exited' })
        },
        onCommandFinished: (exitCode: number | null) => {
          this.retirePtyAgentLaunchAuthority(ptyId)
          this.recordTerminalSideEffectFact(ptyId, { kind: 'command-finished', exitCode })
        },
        onBell: () => {
          this.recordTerminalSideEffectFact(ptyId, { kind: 'bell' })
        },
        onPrLink: (link: TerminalGitHubPRLink) => {
          this.recordTerminalSideEffectFact(ptyId, { kind: 'pr-link', link })
        },
        // Why: hidden-delivery-gated views never see 2031 bytes; facts keep their theme registry truthful.
        onMode2031Subscribe: () => {
          this.recordTerminalSideEffectFact(ptyId, { kind: '2031-subscribe' })
        },
        onMode2031Unsubscribe: () => {
          this.recordTerminalSideEffectFact(ptyId, { kind: '2031-unsubscribe' })
        }
      },
      initialTitle !== null ? { initialTitle } : {}
    )
    tracker.setTransientSideEffectScanningEnabled(this.terminalSideEffectConsumerAvailable)
    const entry: RuntimePtyTitleTrackerEntry = {
      tracker,
      applyingChunk: false,
      applyingSyntheticFrame: false,
      lastMobileTitleGateKey: null,
      chunkTouchedSessionTabs: false,
      pendingFacts: [],
      // Why: command-code facts exist only for the pty:sideEffect channel —
      // headless serve skips the per-chunk scrape entirely. The detector
      // self-arms on the Command Code banner; the spawn command (when main
      // saw one) mirrors the renderer detector's startupCommand fast-arm.
      commandCodeDetector: this.terminalSideEffectConsumerAvailable
        ? this.createTerminalSideEffectCommandCodeDetector(ptyId)
        : null
    }
    this.ptyTitleTrackersByPtyId.set(ptyId, entry)
    return entry
  }

  /** Apply one observed OSC title (raw form) to the PTY and leaf records.
   *  Returns true when the PTY record's title or status changed. */
  protected applyTrackedPtyTitle(ptyId: string, rawTitle: string, normalizedTitle: string): boolean {
    // Why: status is detected from the RAW title (mirrors the renderer tracker),
    // so working/idle transitions are unaffected by normalization; the records
    // store the NORMALIZED title so rotating Grok/Pi/Gemini frames collapse to
    // one stable stored label (#7880) instead of churning `ps`/mobile tabs.
    const agentStatus = detectAgentStatusFromTitle(rawTitle)
    let ptyRecordChanged = false
    const pty = this.ptysById.get(ptyId)
    if (pty) {
      const prevStatus = pty.lastAgentStatus
      const prevTitle = pty.lastOscTitle
      const observedAt = this.nextTitleObservationSequence()
      pty.lastOscTitle = normalizedTitle
      pty.lastOscTitleAt = observedAt
      pty.lastAgentStatus = agentStatus
      this.setPtyManagementTitleFromObservedTitle(pty, normalizedTitle, observedAt)
      ptyRecordChanged = prevTitle !== normalizedTitle || prevStatus !== agentStatus
      if (agentStatus === 'idle' && prevStatus !== 'idle') {
        this.resolvePtyTuiIdleWaiters(pty, ptyId)
      }
      const shouldDelayMobileSnapshot =
        ptyRecordChanged &&
        this.shouldDelayPtyBackedMobileSnapshotForForegroundAgent(pty, normalizedTitle)
      let foregroundRefresh: Promise<boolean> | undefined
      // Why: gate on an actual status transition — braille spinner frames
      // mutate the title every tick, so probing per-title-change would stream
      // a foreground query per frame during active work.
      if (prevStatus !== agentStatus) {
        foregroundRefresh = this.refreshPtyForegroundAgentFromController(ptyId, {
          afterTitleObservation: observedAt
        })
      } else if (shouldDelayMobileSnapshot) {
        // Why: same-status compatible title changes can arrive before the
        // foreground owner probe settles; publishing them would flicker.
        foregroundRefresh = this.getPendingForegroundAgentRefreshForTitle(ptyId, observedAt)
      }
      if (foregroundRefresh && shouldDelayMobileSnapshot) {
        // Why: report "unchanged" so the per-chunk batch skips the mobile
        // snapshot fan-out; the delayed publish fires when the probe settles.
        ptyRecordChanged = false
        this.delayPtyBackedMobileSnapshotForForegroundAgent(ptyId, observedAt, foregroundRefresh)
      }
    }
    for (const leaf of this.getLeavesForPty(ptyId)) {
      // Why: keep the latest OSC title on the leaf so worktree.ps can
      // recompute status from the live title each call. Without this,
      // daemon-hosted terminals (no renderer pushing pane titles) had no
      // way to clear a stale 'working' status after the agent exited and
      // the shell took over the title — the stuck-spinner bug in #1437.
      leaf.lastOscTitle = normalizedTitle
      leaf.lastOscTitleAt = this.nextTitleObservationSequence()
      const prevStatus = leaf.lastAgentStatus
      // Why: when a new OSC title doesn't classify as an agent state (e.g.
      // bare shell title after the agent exits), clear lastAgentStatus so
      // it is no longer sticky. Tui-idle waiters that needed the previous
      // 'idle' transition were already resolved at the moment of the
      // transition below; only fresh waiters registered after the agent
      // exits would observe the cleared value, and they correctly fall
      // back to title-based detection / polling.
      leaf.lastAgentStatus = agentStatus
      // Why: resolve tui-idle on any transition TO idle (not just working→idle).
      // Claude Code may skip "working" entirely on fast tasks, going null→idle,
      // and the coordinator's tui-idle waiter would hang forever waiting for a
      // working→idle transition that never comes. Permission→idle is excluded:
      // it means the agent was blocked on user approval and the user said no,
      // which isn't a task-completion signal.
      if (agentStatus === 'idle' && prevStatus !== 'idle') {
        this.resolveTuiIdleWaiters(leaf)
      }
    }
    return ptyRecordChanged
  }

  /** Cancel the per-PTY title tracker (stale-title timer included) on PTY
   *  teardown so it cannot fire into pruned records. */
  protected disposePtyTitleTracker(ptyId: string): void {
    this.ptyTitleTrackersByPtyId.get(ptyId)?.tracker.dispose()
    this.ptyTitleTrackersByPtyId.delete(ptyId)
  }
  protected resetTrackedTerminalStateForProviderGeneration(ptyId: string): void {
    // Why: a replacement daemon session can reuse the PTY id, but title/parser
    // state from the prior process must not bleed into its snapshots or chunks.
    this.disposePtyTitleTracker(ptyId)
    this.oscTitleScanTailByPtyId.delete(ptyId)
    this.osc7ScanTailByPtyId.delete(ptyId)
    this.agentStatusOscProcessorsByPtyId.delete(ptyId)
    const pty = this.ptysById.get(ptyId)
    if (pty) {
      pty.lastOscTitle = null
      pty.lastOscTitleAt = null
      pty.lastAgentStatus = null
      pty.managementTitle = null
      pty.managementTitleAt = null
    }
    for (const leaf of this.getLeavesForPty(ptyId)) {
      leaf.lastOscTitle = null
      leaf.lastOscTitleAt = null
      leaf.lastAgentStatus = null
    }
    this.clearAgentRowSnapshotsForPty(ptyId)
  }
  protected setTerminalSideEffectConsumerAvailable(available: boolean): void {
    this.terminalSideEffectLocalConsumerAvailable = available && this.onTerminalSideEffects !== null
    this.refreshTerminalSideEffectConsumerAvailability()
  }
  protected refreshTerminalSideEffectConsumerAvailability(): void {
    const nextAvailable =
      this.terminalSideEffectLocalConsumerAvailable ||
      this.countTerminalSideEffectConsumingClientEventListeners() > 0
    if (nextAvailable === this.terminalSideEffectConsumerAvailable) {
      return
    }
    this.terminalSideEffectConsumerAvailable = nextAvailable
    for (const [ptyId, entry] of this.ptyTitleTrackersByPtyId) {
      entry.tracker.setTransientSideEffectScanningEnabled(nextAvailable)
      entry.commandCodeDetector = nextAvailable
        ? this.createTerminalSideEffectCommandCodeDetector(ptyId)
        : null
    }
  }
  protected createTerminalSideEffectCommandCodeDetector(
    ptyId: string
  ): NonNullable<RuntimePtyTitleTrackerEntry['commandCodeDetector']> {
    return createCommandCodeOutputStatusDetector({
      startupCommand: this.terminalSpawnCommandsByPtyId.get(ptyId) ?? null,
      onWorking: (prompt) => {
        this.recordTerminalSideEffectFact(ptyId, { kind: 'command-code-working', prompt })
      },
      onDone: (prompt) => {
        this.recordTerminalSideEffectFact(ptyId, { kind: 'command-code-done', prompt })
      }
    })
  }
  protected extractLastOsc7CwdForPty(
    ptyId: string,
    data: string
  ): { path: string; hostname: string } | null {
    const previousTail = this.osc7ScanTailByPtyId.get(ptyId)
    if (!previousTail && !data.includes('\x1b]7;')) {
      return null
    }
    const input = `${previousTail ?? ''}${data}`
    const scanTail = extractOscScanTail(input, 4096)
    if (scanTail.length > 0) {
      this.osc7ScanTailByPtyId.set(ptyId, scanTail)
    } else {
      this.osc7ScanTailByPtyId.delete(ptyId)
    }
    const uri = extractLastOsc7Uri(input)
    const pty = this.ptysById.get(ptyId)
    const pathFlavor = this.pathFlavorForPty(pty)
    return uri
      ? parseFileUriPathParts(uri, {
          pathFlavor,
          remotePosixAuthority: !!pty?.connectionId && pathFlavor !== 'win32',
          wslDistro: pty?.connectionId
            ? undefined
            : (this.wslDistroByPtyId.get(ptyId) ?? pty?.wslDistro ?? undefined)
        })
      : null
  }
  protected recordOsc7MetadataForPty(
    ptyId: string,
    data: string
  ): { cwd: string | null; cwdChanged: boolean } {
    const osc7 = this.extractLastOsc7CwdForPty(ptyId, data)
    const cwd = osc7?.path ?? null
    const cwdChanged =
      cwd !== null && cwd.trim().length > 0 && this.terminalCwdByPtyId.get(ptyId) !== cwd
    if (cwdChanged) {
      this.terminalCwdByPtyId.set(ptyId, cwd)
    }
    if (osc7) {
      if (osc7.hostname) {
        this.terminalFileUriHostnameByPtyId.set(ptyId, osc7.hostname)
      } else {
        this.terminalFileUriHostnameByPtyId.delete(ptyId)
      }
    }
    return { cwd, cwdChanged }
  }
  protected pathFlavorForPty(pty?: RuntimePtyWorktreeRecord | null): 'posix' | 'win32' {
    if (!pty?.connectionId) {
      return process.platform === 'win32' ? 'win32' : 'posix'
    }
    const worktreePath = splitWorktreeIdForFilesystem(pty.worktreeId)?.worktreePath
    return worktreePath && isWindowsAbsolutePathLike(worktreePath) ? 'win32' : 'posix'
  }

  /** Returns true when any retained agent-row snapshot changed in a
   *  client-visible way, so the caller can republish session snapshots. */
}
