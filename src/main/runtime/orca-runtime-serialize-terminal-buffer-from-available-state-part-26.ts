import { type TerminalOscLinkRange, TerminalKittyKeyboardModeTracker, type RuntimeTerminalRead, buildPreview, DEFAULT_TERMINAL_READ_LIMIT, terminalReadLimit, shouldFallbackToVisibleTerminalSnapshot, visibleNonBlankTerminalLines, buildVisibleSnapshotReadFallback, type PtyProviderBufferSnapshot, HeadlessEmulator, withTimeout, type RuntimeVisibleTerminalState } from './orca-runtime-symbols'
import { OrcaRuntimeMaybeHydrateHeadlessFromRendererPart25 } from './orca-runtime-maybe-hydrate-headless-from-renderer-part-25'

export class OrcaRuntimeSerializeTerminalBufferFromAvailableStatePart26 extends OrcaRuntimeMaybeHydrateHeadlessFromRendererPart25 {
  protected async serializeTerminalBufferFromAvailableState(
    ptyId: string,
    opts: { scrollbackRows?: number } = {}
  ): Promise<{
    data: string
    cols: number
    rows: number
    cwd?: string | null
    lastTitle?: string
    seq?: number
    source?: 'headless' | 'renderer'
    oscLinks?: TerminalOscLinkRange[]
    alternateScreen?: boolean
    pendingEscapeTailAnsi?: string
  } | null> {
    if (this.providerSnapshotPreferredPtys.has(ptyId)) {
      // Why: pre-attach stream bytes only form a suffix of restored state. A
      // sequenced provider snapshot safely reconciles live bytes; renderer is
      // the fallback when an older provider cannot expose that boundary.
      const providerSnapshot = await this.serializeProviderTerminalBuffer(ptyId, opts)
      if (providerSnapshot) {
        return providerSnapshot
      }
      const rendererSnapshot = await this.serializeRendererTerminalBuffer(ptyId, opts)
      if (rendererSnapshot) {
        return rendererSnapshot
      }
    }
    const headlessSnapshot = await this.serializeHeadlessTerminalBuffer(ptyId, opts)
    if (headlessSnapshot) {
      return headlessSnapshot
    }

    const rendererSnapshot = await this.serializeRendererTerminalBuffer(ptyId, opts)
    if (!rendererSnapshot) {
      return this.serializeProviderTerminalBuffer(ptyId, opts)
    }
    if (rendererSnapshot.data.length > 0) {
      return rendererSnapshot
    }
    // Why: parked desktop panes register serializers before their xterm has
    // hydrated. Treat that empty shell as provisional so retained provider
    // history can restore mobile without forcing the desktop pane to mount.
    const providerSnapshot = await this.serializeProviderTerminalBuffer(ptyId, opts)
    return providerSnapshot &&
      (providerSnapshot.data.length > 0 || Boolean(providerSnapshot.scrollbackAnsi))
      ? providerSnapshot
      : rendererSnapshot
  }
  async serializeRendererTerminalBuffer(
    ptyId: string,
    opts: { scrollbackRows?: number } = {}
  ): Promise<{
    data: string
    cols: number
    rows: number
    seq?: number
    cwd?: string | null
    lastTitle?: string
    source?: 'renderer'
    oscLinks?: TerminalOscLinkRange[]
  } | null> {
    if (this.ptyController?.hasRendererSerializer?.(ptyId) === false) {
      return null
    }
    let rendererSnapshot: {
      data: string
      cols: number
      rows: number
      seq?: number
      cwd?: string | null
      lastTitle?: string
      oscLinks?: TerminalOscLinkRange[]
    } | null = null
    try {
      // Why: recovery/read fallback wants visible alt-screen content (e.g. an
      // active TUI), so altScreenForcesZeroRows is FALSE here. Hydration is
      // the only path that suppresses alt-screen scrollback.
      rendererSnapshot = await (this.ptyController?.serializeBuffer?.(ptyId, {
        scrollbackRows: opts.scrollbackRows,
        altScreenForcesZeroRows: false
      }) ?? Promise.resolve(null))
    } catch {
      // Why: terminal snapshots should not depend on a mounted renderer pane.
      // If renderer serialization races reload/unmount, callers can still use
      // their existing null fallback paths.
    }
    return rendererSnapshot
      ? this.preferTrackedLastTitle(ptyId, {
          ...rendererSnapshot,
          cwd: rendererSnapshot.cwd ?? this.terminalCwdByPtyId.get(ptyId),
          source: 'renderer' as const
        })
      : null
  }
  protected async serializeProviderTerminalBuffer(
    ptyId: string,
    opts: { scrollbackRows?: number } = {},
    wait: { timeoutMs?: number; retireOnTimeout?: boolean } = {}
  ): Promise<PtyProviderBufferSnapshot | null> {
    const generation = this.getPtyLifecycleGeneration(ptyId)
    const scrollbackRows = Math.max(0, Math.floor(opts.scrollbackRows ?? 0))
    let acquisition = this.providerBufferAcquisitionsByPtyId.get(ptyId)
    if (
      !acquisition ||
      acquisition.generation !== generation ||
      acquisition.scrollbackRows < scrollbackRows
    ) {
      const promise = this.captureProviderTerminalBuffer(ptyId, opts, generation)
      acquisition = { generation, scrollbackRows, promise, timedOut: false }
      this.providerBufferAcquisitionsByPtyId.set(ptyId, acquisition)
      void promise.finally(() => {
        if (this.providerBufferAcquisitionsByPtyId.get(ptyId) === acquisition) {
          this.providerBufferAcquisitionsByPtyId.delete(ptyId)
        }
      })
    }
    if (acquisition.timedOut) {
      return null
    }
    if (typeof wait.timeoutMs !== 'number') {
      return acquisition.promise
    }
    const result = await withTimeout<
      { settled: true; value: PtyProviderBufferSnapshot | null } | { settled: false }
    >(
      acquisition.promise.then((value) => ({ settled: true as const, value })),
      wait.timeoutMs,
      { settled: false as const }
    )
    if (!result.settled) {
      if (wait.retireOnTimeout) {
        acquisition.timedOut = true
      }
      return null
    }
    return result.value
  }
  protected async captureProviderTerminalBuffer(
    ptyId: string,
    opts: { scrollbackRows?: number },
    generation: number
  ): Promise<PtyProviderBufferSnapshot | null> {
    const liveModeTracker = new TerminalKittyKeyboardModeTracker()
    let liveModeTrackers = this.providerModeSnapshotScansByPtyId.get(ptyId)
    if (!liveModeTrackers) {
      liveModeTrackers = new Set()
      this.providerModeSnapshotScansByPtyId.set(ptyId, liveModeTrackers)
    }
    liveModeTrackers.add(liveModeTracker)
    try {
      // Why: daemon PTYs survive an app relaunch before any renderer mounts.
      // Mobile still needs their retained history without navigating desktop.
      const snapshot = await this.ptyController?.serializeProviderBuffer?.(ptyId, opts)
      if (!snapshot || this.getPtyLifecycleGeneration(ptyId) !== generation) {
        return null
      }
      const snapshotModeTracker = new TerminalKittyKeyboardModeTracker()
      if (typeof snapshot.alternateScreen === 'boolean') {
        snapshotModeTracker.scan(snapshot.alternateScreen ? '\x1b[?1049h' : '\x1b[?1049l')
      } else {
        // Why: older providers omit mode metadata, but their ANSI snapshot
        // still carries the DECSET/DECRST needed to classify the active screen.
        snapshotModeTracker.scanReplay(snapshot.data)
      }
      const observedSnapshotMode = snapshotModeTracker.hasObservedAlternateScreenSwitch
      let effectiveAlternateScreen: boolean | undefined
      if (observedSnapshotMode || liveModeTracker.hasObservedAlternateScreenSwitch) {
        const modeTracker = new TerminalKittyKeyboardModeTracker()
        if (observedSnapshotMode) {
          modeTracker.scan(snapshotModeTracker.isAlternateScreen ? '\x1b[?1049h' : '\x1b[?1049l')
        }
        // Why: stream bytes received after the request began can be newer
        // than snapshot metadata, so an observed live transition wins.
        if (liveModeTracker.hasObservedAlternateScreenSwitch) {
          modeTracker.scan(liveModeTracker.isAlternateScreen ? '\x1b[?1049h' : '\x1b[?1049l')
        }
        this.providerModeTrackersByPtyId.set(ptyId, modeTracker)
        effectiveAlternateScreen = modeTracker.isAlternateScreen
      }
      const providerOffset = this.providerSequenceOffsetByPtyId.get(ptyId) ?? 0
      const reconciledSnapshot = this.preferTrackedLastTitle(ptyId, {
        ...snapshot,
        seq: providerOffset + snapshot.seq,
        ...(effectiveAlternateScreen !== undefined
          ? { alternateScreen: effectiveAlternateScreen }
          : {})
      })
      if (liveModeTracker.hasObservedAlternateScreenSwitch) {
        this.providerSnapshotsWithLiveModeTransition.add(reconciledSnapshot)
      }
      return reconciledSnapshot
    } catch {
      return null
    } finally {
      liveModeTrackers.delete(liveModeTracker)
      if (liveModeTrackers.size === 0) {
        this.providerModeSnapshotScansByPtyId.delete(ptyId)
      }
    }
  }
  protected async withVisibleSnapshotFallback(
    ptyId: string,
    read: RuntimeTerminalRead,
    opts: { cursor?: number; limit?: number } = {}
  ): Promise<RuntimeTerminalRead> {
    if (typeof opts.cursor === 'number') {
      return read
    }
    const blankFallback = shouldFallbackToVisibleTerminalSnapshot(read, opts)
    const recoveredWorkerFallback =
      read.tail.length === 0 && this.legacyWorkerRecoveredPtys.has(ptyId)
    if (recoveredWorkerFallback) {
      const providerLines = await this.readProviderTerminalTailLines(ptyId, opts.limit)
      if (providerLines.length > 0) {
        return buildVisibleSnapshotReadFallback(read, providerLines, opts.limit)
      }
    }
    const knownAlternateScreen = this.isTerminalAlternateScreen(ptyId)
    const providerModeUnknown =
      this.providerSnapshotPreferredPtys.has(ptyId) && !this.providerModeTrackersByPtyId.has(ptyId)
    if (
      !blankFallback &&
      !recoveredWorkerFallback &&
      !providerModeUnknown &&
      !knownAlternateScreen &&
      !this.headlessTerminals.has(ptyId)
    ) {
      return read
    }
    const visibleState = await this.readVisibleTerminalState(ptyId)
    if (
      !blankFallback &&
      !recoveredWorkerFallback &&
      !knownAlternateScreen &&
      !visibleState?.isAlternateScreen
    ) {
      return read
    }
    let lines = visibleState?.lines ?? []
    if (lines.length === 0) {
      lines = await this.readRendererVisibleSnapshotLines(ptyId)
    }
    if (lines.length === 0) {
      return read
    }
    return buildVisibleSnapshotReadFallback(read, lines, opts.limit)
  }
  protected async readProviderTerminalTailLines(
    ptyId: string,
    limit: number | undefined
  ): Promise<string[]> {
    const lineLimit = terminalReadLimit(limit, DEFAULT_TERMINAL_READ_LIMIT)
    const snapshot = await this.serializeProviderTerminalBuffer(ptyId, {
      scrollbackRows: lineLimit
    })
    const data = snapshot ? `${snapshot.scrollbackAnsi ?? ''}${snapshot.data}` : ''
    if (!snapshot || data.length === 0) {
      return []
    }
    const emulator = new HeadlessEmulator({
      cols: snapshot.cols,
      rows: snapshot.rows,
      scrollback: lineLimit
    })
    try {
      await emulator.write(data)
      return visibleNonBlankTerminalLines(emulator.getBufferTailLines(lineLimit))
    } finally {
      emulator.dispose()
    }
  }
  protected async visibleSnapshotPreview(ptyId: string, preview: string): Promise<string> {
    const knownAlternateScreen = this.isTerminalAlternateScreen(ptyId)
    const providerModeUnknown =
      this.providerSnapshotPreferredPtys.has(ptyId) && !this.providerModeTrackersByPtyId.has(ptyId)
    if (!providerModeUnknown && !knownAlternateScreen && !this.headlessTerminals.has(ptyId)) {
      return preview
    }
    const visibleState = await this.readVisibleTerminalState(ptyId)
    if (!knownAlternateScreen && !visibleState?.isAlternateScreen) {
      return preview
    }
    let lines = visibleState?.lines ?? []
    if (lines.length === 0) {
      lines = await this.readRendererVisibleSnapshotLines(ptyId)
    }
    return lines.length > 0 ? buildPreview(lines, '') : preview
  }
  protected async readVisibleTerminalState(
    ptyId: string
  ): Promise<RuntimeVisibleTerminalState | null> {
    if (!this.providerSnapshotPreferredPtys.has(ptyId)) {
      return this.readHeadlessVisibleTerminalState(ptyId)
    }

    const generation = this.getPtyLifecycleGeneration(ptyId)
    const outputSequence = this.getPtyOutputSequence(ptyId)
    const cached = this.providerVisibleStateByPtyId.get(ptyId)
    const trackedMode = this.providerModeTrackersByPtyId.get(ptyId)
    if (
      cached?.generation === generation &&
      outputSequence <= cached.sequence &&
      (!trackedMode || trackedMode.isAlternateScreen === cached.isAlternateScreen)
    ) {
      return cached
    }
    if (trackedMode && !trackedMode.isAlternateScreen) {
      const headlessState = await this.readHeadlessVisibleTerminalState(ptyId)
      return headlessState
        ? { ...headlessState, isAlternateScreen: false }
        : {
            lines: [],
            isAlternateScreen: false,
            sequence: outputSequence,
            generation
          }
    }
    if ((this.providerVisibleRetryAtByPtyId.get(ptyId) ?? 0) > Date.now()) {
      return null
    }

    const snapshot = await this.serializeProviderTerminalBuffer(
      ptyId,
      { scrollbackRows: 0 },
      { timeoutMs: VISIBLE_TERMINAL_SNAPSHOT_TIMEOUT_MS }
    )
    if (!snapshot || this.getPtyLifecycleGeneration(ptyId) !== generation) {
      this.providerVisibleRetryAtByPtyId.set(ptyId, Date.now() + VISIBLE_TERMINAL_SNAPSHOT_RETRY_MS)
      return null
    }
    this.providerVisibleRetryAtByPtyId.delete(ptyId)
    if (this.providerSnapshotsWithLiveModeTransition.has(snapshot)) {
      // Why: the provider frame can predate a mode switch observed while its
      // RPC was pending; the ordered live emulator owns the post-switch grid.
      const liveState = await this.readHeadlessVisibleTerminalState(ptyId)
      if (liveState && liveState.isAlternateScreen === (snapshot.alternateScreen ?? false)) {
        return liveState
      }
    }
    const lines = await this.parseVisibleSnapshotLines(snapshot)
    if (this.getPtyLifecycleGeneration(ptyId) !== generation) {
      return null
    }
    const visibleState: RuntimeVisibleTerminalState = {
      lines,
      isAlternateScreen: snapshot.alternateScreen ?? false,
      sequence: snapshot.seq,
      generation
    }
    if (this.getPtyOutputSequence(ptyId) <= snapshot.seq) {
      this.providerVisibleStateByPtyId.set(ptyId, visibleState)
    }
    return visibleState
  }
}
import { VISIBLE_TERMINAL_SNAPSHOT_TIMEOUT_MS, VISIBLE_TERMINAL_SNAPSHOT_RETRY_MS } from './orca-runtime-tail-constants'
