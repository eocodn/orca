import {
  type TerminalOscLinkRange,
  isTerminalLeafId,
  makePaneKey,
  parsePaneKey,
  isValidTerminalTabId,
  visibleNonBlankTerminalLines,
  HeadlessEmulator,
  withTimeout,
  type RuntimeVisibleTerminalState
} from './orca-runtime-symbols'
import { OrcaRuntimeSerializeTerminalBufferFromAvailableStatePart26 } from './orca-runtime-serialize-terminal-buffer-from-available-state-part-26'

export class OrcaRuntimeReadHeadlessVisibleTerminalStatePart27 extends OrcaRuntimeSerializeTerminalBufferFromAvailableStatePart26 {
  protected async readHeadlessVisibleTerminalState(
    ptyId: string
  ): Promise<RuntimeVisibleTerminalState | null> {
    const state = this.headlessTerminals.get(ptyId)
    if (!state) {
      return null
    }
    const generation = this.getPtyLifecycleGeneration(ptyId)
    await state.writeChain
    if (
      this.headlessTerminals.get(ptyId) !== state ||
      this.getPtyLifecycleGeneration(ptyId) !== generation
    ) {
      return null
    }
    return {
      lines: visibleNonBlankTerminalLines(state.emulator.getVisibleLines()),
      isAlternateScreen: state.emulator.isAlternateScreen,
      sequence: state.outputSequence,
      generation
    }
  }
  protected async parseVisibleSnapshotLines(snapshot: {
    data: string
    cols: number
    rows: number
  }): Promise<string[]> {
    if (snapshot.data.length === 0) {
      return []
    }
    const emulator = new HeadlessEmulator({
      cols: snapshot.cols,
      rows: snapshot.rows,
      scrollback: 0
    })
    try {
      await emulator.write(`\x1b[2J\x1b[3J\x1b[H${snapshot.data}`)
      return visibleNonBlankTerminalLines(emulator.getVisibleLines())
    } finally {
      emulator.dispose()
    }
  }
  protected async readRendererVisibleSnapshotLines(ptyId: string): Promise<string[]> {
    const controller = this.ptyController
    if (!controller?.serializeBuffer) {
      return []
    }
    if (controller.hasRendererSerializer && !controller.hasRendererSerializer(ptyId)) {
      return []
    }
    try {
      // Why: raw PTY tails can be whitespace-only while a full-screen TUI is
      // visibly nonblank in renderer xterm. Ask the renderer for the active
      // screen instead of reusing the headless transcript path.
      const snapshot = await withTimeout(
        controller.serializeBuffer(ptyId, {
          scrollbackRows: 0,
          altScreenForcesZeroRows: false
        }),
        VISIBLE_TERMINAL_SNAPSHOT_TIMEOUT_MS,
        null
      )
      if (!snapshot || snapshot.data.length === 0) {
        return []
      }
      return this.parseVisibleSnapshotLines(snapshot)
    } catch {
      return []
    }
  }
  protected async serializeHeadlessTerminalBuffer(
    ptyId: string,
    opts: { scrollbackRows?: number; includeEmpty?: boolean } = {}
  ): Promise<{
    data: string
    cols: number
    rows: number
    cwd?: string | null
    lastTitle?: string
    seq?: number
    source?: 'headless'
    oscLinks?: TerminalOscLinkRange[]
    alternateScreen?: boolean
    scrollbackAnsi?: string
    // Why: dangling mid-escape tail the restorer must write LAST, after any
    // reset, so the next live chunk completes it instead of rendering it
    // literally (Bug E / #7329).
    pendingEscapeTailAnsi?: string
  } | null> {
    const state = this.headlessTerminals.get(ptyId)
    if (!state) {
      return null
    }
    await state.writeChain
    // Why: normal history is separated from an active alternate frame, so the
    // caller's scrollback policy can be honored without painting it into alt.
    const isAlternateScreen = state.emulator.isAlternateScreen
    const scrollbackRows = opts.scrollbackRows ?? 0
    const snapshot = state.emulator.getSnapshot({ scrollbackRows })
    const data = snapshot.rehydrateSequences + snapshot.snapshotAnsi
    return data.length > 0 || opts.includeEmpty === true
      ? this.preferTrackedLastTitle(ptyId, {
          data,
          cols: snapshot.cols,
          rows: snapshot.rows,
          cwd: snapshot.cwd ?? this.terminalCwdByPtyId.get(ptyId),

          lastTitle: snapshot.lastTitle,
          seq: state.outputSequence,
          source: 'headless' as const,
          oscLinks: snapshot.oscLinks,
          scrollbackAnsi: snapshot.scrollbackAnsi,
          ...(snapshot.pendingEscapeTailAnsi
            ? { pendingEscapeTailAnsi: snapshot.pendingEscapeTailAnsi }
            : {}),
          // Why: lets the renderer skip the destructive scrollback clear when
          // restoring an alt-screen snapshot — clearing wipes xterm's own
          // history that the TUI relies on for scroll-up after a tab return.
          alternateScreen: isAlternateScreen,
          // Why NOT folded into data: the renderer writes its post-replay
          // reset after data, and any ESC after a dangling partial aborts it.
          // The restorer writes this last (Bug E fix).
          pendingEscapeTailAnsi: snapshot.pendingEscapeTailAnsi
        })
      : null
  }
  protected disposeHeadlessTerminal(ptyId: string): void {
    this.headlessHydrationState.delete(ptyId)
    const state = this.headlessTerminals.get(ptyId)
    if (!state) {
      return
    }
    this.headlessTerminals.delete(ptyId)
    // Why: queued chain links still parse below before the emulator disposes;
    // sever the reply sink now so they cannot write to a respawned PTY that
    // reused this id (belt to the sink's state-identity check).
    state.emulator.disableQueryReplyForwarding()
    state.writeChain.finally(() => state.emulator.dispose()).catch(() => state.emulator.dispose())
  }
  resolveLeafForHandle(handle: string): { ptyId: string | null } | null {
    const record = this.handles.get(handle)
    if (!record) {
      return null
    }
    if (record.tabId.startsWith('pty:')) {
      return { ptyId: record.ptyId }
    }
    const leaf = this.leaves.get(this.getLeafKey(record.tabId, record.leafId))
    if (!leaf) {
      return null
    }
    return { ptyId: leaf.ptyId }
  }

  // Why: remote clients hold handles across transport reconnects. A handle
  // minted for a concrete PTY must never silently adopt a different PTY that
  // later occupies the same pane — that misroutes keystrokes (#7718). Handles
  // still awaiting their first PTY (ptyId null) may adopt it, which preserves
  // the mobile pre-spawn subscribe flow.
  resolveLiveLeafForHandle(handle: string): { ptyId: string | null } | null {
    const record = this.handles.get(handle)
    if (!record) {
      return null
    }
    if (record.tabId.startsWith('pty:')) {
      return { ptyId: record.ptyId }
    }
    const leaf = this.leaves.get(this.getLeafKey(record.tabId, record.leafId))
    if (!leaf) {
      return null
    }
    if (
      record.ptyId !== null &&
      (leaf.ptyId !== record.ptyId || leaf.ptyGeneration !== record.ptyGeneration)
    ) {
      throw new Error('terminal_handle_stale')
    }
    return { ptyId: leaf.ptyId }
  }
  getOrchestrationCompatibilityHostId(): 'local' {
    return 'local'
  }
  protected retirePtyAgentLaunchAuthority(ptyId: string): void {
    const pty = this.ptysById.get(ptyId)
    if (!pty) {
      return
    }
    if (!pty.launchToken) {
      return
    }
    pty.launchToken = null
    const paneKeys = new Set<string>()
    if (pty.paneKey && parsePaneKey(pty.paneKey)) {
      paneKeys.add(pty.paneKey)
    }
    for (const leaf of this.getLeavesForPty(ptyId)) {
      if (isValidTerminalTabId(leaf.tabId) && isTerminalLeafId(leaf.leafId)) {
        paneKeys.add(makePaneKey(leaf.tabId, leaf.leafId))
      }
    }
    for (const paneKey of paneKeys) {
      this.retireAgentHookCompatibilityAuthorityFn?.(paneKey)
    }
  }
}
import { VISIBLE_TERMINAL_SNAPSHOT_TIMEOUT_MS } from './orca-runtime-tail-constants'
