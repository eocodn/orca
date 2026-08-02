import { HeadlessEmulator } from './headless-emulator'
import { isValidPtySize, normalizePtySize } from './daemon-pty-size'
import { PostReadyFlushGate } from './post-ready-flush-gate'
import {
  createShellReadyScanState,
  drainShellReadyHeldBytes,
  scanForShellReady,
  type ShellReadyScanState
} from '../shell-ready-marker-scanner'
import { isPowerShellProcess } from '../../shared/shell-process-detection'
import { killWithDescendantSweep } from '../pty-descendant-termination'
import type { TuiAgent } from '../../shared/types'
import { randomUUID } from 'node:crypto'
import { PhysicalExitTracker } from '../../shared/physical-exit-tracker'
import {
  PtyStartupIngress,
  type PtyIngressEmission,
  type PtyStartupIngressIntent
} from '../../shared/pty-startup-ingress'
import type {
  PendingOutputRecord,
  SessionState,
  ShellReadyState,
  TakePendingOutputResult,
  TerminalSnapshot
} from './types'
import type { PtyOwnerBackend } from '../../shared/pty-owner-backend'

export const SHELL_READY_TIMEOUT_MS = 15_000
// Why: Codex skips marker-gated command delivery; this only bounds older daemon/local paths that still report shell-ready for Codex.
export const CODEX_SHELL_READY_TIMEOUT_MS = 300
export const KILL_TIMEOUT_MS = 5_000
export const IMMEDIATE_KILL_PHYSICAL_EXIT_TIMEOUT_MS = 8_000
export const SESSION_FORCE_KILL_RETRY_MS = 250
export const SESSION_FORCE_KILL_MAX_ATTEMPTS = 2
// Why: bounds in-memory pending output when no client drains it; past the cap we drop records and flag
// overflow so the next take falls back to one full snapshot. UTF-16 units; worst-case wire is ~6x, under NDJSON_MAX_LINE_BYTES (16MB).
export const PENDING_OUTPUT_MAX_BYTES = 2 * 1024 * 1024
// Why: pause is a fire-and-forget notify, so a resume can be lost (main crash, dropped socket); a lost
// resume must never wedge a shell, so auto-resume after this window — a still-flooded main re-pauses.
export const PRODUCER_PAUSE_FAILSAFE_MS = 5_000

export type SubprocessHandle = {
  pid: number
  /** Live foreground process name of the PTY (node-pty's `.process`), e.g.
   *  'claude' / 'codex' / 'zsh'. Null once the child has exited. */
  getForegroundProcess(): string | null
  /** Await process-table evidence captured after this confirmation request. */
  confirmForegroundProcess?(): Promise<string | null>
  /** True when shell launch args already delivered the startup command, so the host skips its stdin fallback write. */
  startupCommandDeliveredInShellArgs?: boolean
  /** Shell the subprocess actually spawned, after fallbacks. The host reconciles the caller's shell-ready
   *  assumption against it so a fallback shell without a ready marker never gates startup commands. */
  shellPath?: string
  write(data: string): void
  resize(cols: number, rows: number): void
  /** Stop reading the PTY fd (node-pty pause()) so a flooding child blocks on write. Optional:
   *  handles that cannot pause omit it and flow control degrades to a no-op. */
  pause?(): void
  resume?(): void
  /** Resync the native PTY's screen state after a frontend clear. No-op except on Windows/ConPTY,
   *  where a stale cursor row makes the next prompt repaint below a blank gap. */
  clear?(): void
  kill(): void
  forceKill(): void
  signal(sig: string): void
  onData(cb: (data: string) => void): void
  onExit(cb: (code: number) => void): void
  /** Release the native PTY handle via node-pty's destroy(). Idempotent; safe to call after exit. */
  dispose(): void
}

export type SessionOptions = {
  sessionId: string
  cols: number
  rows: number
  terminalHandle?: string
  launchAgent?: TuiAgent
  subprocess: SubprocessHandle
  shellReadySupported: boolean
  shellReadyTimeoutMs?: number
  historySeedChunks?: readonly string[]
  scrollback?: number
  wslDistro?: string
  // Fired once the session reaches a terminal state so the owner (TerminalHost) can reap it; without
  // a reaper, dead sessions and their scrollback emulators accumulate for the daemon's lifetime.
  onExit?: (code: number) => void
  startupIngress?: PtyStartupIngressIntent
  ownerBackend?: PtyOwnerBackend
}

export type AttachedClient = {
  token: symbol
  onData: (
    data: string,
    rawLength?: number,
    transformed?: boolean,
    seq?: number,
    incarnationId?: string
  ) => void
  onExit: (code: number, incarnationId: string) => void
}


  [key: string]: any

  readonly sessionId: string
  readonly incarnationId = randomUUID()
  readonly terminalHandle: string | null
  readonly launchAgent: TuiAgent | null
  readonly wslDistro: string | null
  protected _state: SessionState = 'running'
  protected _shellState: ShellReadyState
  protected _exitCode: number | null = null
  protected _isTerminating = false
  protected _disposed = false
  protected emulator: HeadlessEmulator
  protected subprocess: SubprocessHandle
  protected readonly onSessionExit?: (code: number) => void
  protected attachedClients: AttachedClient[] = []
  protected preReadyStdinQueue: string[] = []
  protected shellReadyScanState: ShellReadyScanState | null = null
  protected shellReadyTimer: ReturnType<typeof setTimeout> | null = null
  protected killTimer: ReturnType<typeof setTimeout> | null = null
  protected postReadyFlushGate: PostReadyFlushGate
  protected pendingOutputRecords: PendingOutputRecord[] = []
  protected pendingOutputBytes = 0
  protected pendingOutputOverflowed = false
  protected pendingOutputSeq = 0
  protected outputSequence = 0
  protected producerPaused = false
  protected producerPauseFailsafeTimer: ReturnType<typeof setTimeout> | null = null
  protected readonly _historySeeded: boolean | undefined
  protected forceKillSent = false
  protected subprocessDisposed = false
  protected readonly physicalExit = new PhysicalExitTracker()
  protected readonly startupIngress: PtyStartupIngress

  constructor(opts: SessionOptions) {
    this.sessionId = opts.sessionId
    this.terminalHandle = opts.terminalHandle ?? null
    this.launchAgent = opts.launchAgent ?? null
    this.wslDistro = opts.wslDistro ?? null
    this.subprocess = opts.subprocess
    this.onSessionExit = opts.onExit
    const size = normalizePtySize(opts.cols, opts.rows)
    this.emulator = new HeadlessEmulator({
      cols: size.cols,
      rows: size.rows,
      scrollback: opts.scrollback,
      wslDistro: opts.wslDistro
      // No onData: the daemon emulator must never reply to query sequences — the renderer's xterm is
      // the authoritative responder and a daemon reply would race ahead and clobber it. See HeadlessEmulator.
    })
    // Why: seed recovery must precede listener registration; shells can emit their prompt synchronously once onData subscribes.
    // Why the every() short-circuit is safe: writeSync only fails emulator-wide (disposed / no sync write API), so later
    // chunks could not land either — and writing them past a dropped chunk would seed a torn stream.
    this._historySeeded =
      opts.historySeedChunks === undefined
        ? undefined
        : opts.historySeedChunks.every((chunk) => this.emulator.writeSync(chunk))

    if (opts.shellReadySupported) {
      this._shellState = 'pending'
      this.shellReadyScanState = createShellReadyScanState()
      this.shellReadyTimer = setTimeout(() => {
        this.onShellReadyTimeout()
      }, opts.shellReadyTimeoutMs ?? SHELL_READY_TIMEOUT_MS)
    } else {
      this._shellState = 'unsupported'
    }

    this.postReadyFlushGate = new PostReadyFlushGate(() => this.flushPreReadyQueue())
    this.startupIngress = new PtyStartupIngress({
      ...(opts.startupIngress ? { intent: opts.startupIngress } : {}),
      ...(opts.ownerBackend ? { ownerBackend: opts.ownerBackend } : {}),
      write: (data) => this.subprocess.write(data),
      onEmission: (emission) => this.emitSubprocessOutput(emission)
    })
    this.subprocess.onData((data) => this.handleSubprocessData(data))
    this.subprocess.onExit((code) => this.handleSubprocessExit(code))
  }

  get state(): SessionState {
    return this._state
  }

  get shellState(): ShellReadyState {
    return this._shellState
  }

  get historySeeded(): boolean | undefined {
    return this._historySeeded
  }

  get exitCode(): number | null {
    return this._exitCode
  }

  get isAlive(): boolean {
    return this._state !== 'exited'
  }

  get isTerminating(): boolean {
    return this._isTerminating
  }

  /** Claims termination synchronously so attach/re-entry cannot race async
   * teardown preparation. Returns false when another owner already claimed it. */
  beginTermination(): boolean {
    if (this._state === 'exited' || this._isTerminating) {
      return false
    }
    this._isTerminating = true
    // Why: a paused child can be blocked inside write(); resume before any async snapshot so it handles termination promptly.
    this.releaseProducerPause({ resume: true })
    return true
  }

  get pid(): number {
    return this.subprocess.pid
  }

  write(data: string): void {
    if (this._state === 'exited' || this._disposed) {
      return
    }

    // Why: keep queuing during the post-ready flush-gate window ('ready' but not yet flushed); a
    // direct write would race fresh input ahead of the buffered startup command.
    if (this._shellState === 'pending' || this.postReadyFlushGate.isPending) {
      this.preReadyStdinQueue.push(data)
      return
    }

    this.subprocess.write(data)
  }

  resize(cols: number, rows: number): void {
    if (this._state === 'exited' || this._disposed) {
      return
    }
    if (!isValidPtySize(cols, rows)) {
      return
    }
    this.emulator.resize(cols, rows)
    // Why: the record stream must mirror the emulator's apply order, or cold-restore replay reflows at the wrong point.
    this.recordPendingOutput({ kind: 'resize', cols, rows })
    this.subprocess.resize(cols, rows)
  }

  /** Producer-side flow control: stop reading the PTY fd so a flooding child blocks on write.
   *  Arms the lost-resume failsafe; re-pausing re-arms it. */
  pauseProducer(): void {
    if (this._state === 'exited' || this._disposed) {
      return
    }
    this.producerPaused = true
    this.subprocess.pause?.()
    if (this.producerPauseFailsafeTimer) {
      clearTimeout(this.producerPauseFailsafeTimer)
    }
    this.producerPauseFailsafeTimer = setTimeout(() => {
      this.producerPauseFailsafeTimer = null
      this.producerPaused = false
      this.subprocess.resume?.()
    }, PRODUCER_PAUSE_FAILSAFE_MS)
  }

  resumeProducer(): void {
    this.releaseProducerPause({ resume: true })
  }

  protected releaseProducerPause(opts: { resume: boolean }): void {
    if (this.producerPauseFailsafeTimer) {
      clearTimeout(this.producerPauseFailsafeTimer)
      this.producerPauseFailsafeTimer = null
    }
    if (!this.producerPaused) {
      return
    }
    this.producerPaused = false
    if (opts.resume) {
      this.subprocess.resume?.()
    }
  }

  kill(): void {
    if (!this.beginTermination()) {
      return
    }
    if (!this.launchAgent) {
      this.signalTerminationRoot()
    } else {
      // Why: agent tool children live in detached process groups a dying shell's SIGHUP never reaches, so sweep them.
      void Promise.resolve(
        killWithDescendantSweep(
          this.subprocess.pid,
          () => {
            this.signalTerminationRoot()
          },
          {
            // Why: if the root exits during ps its PID can be recycled; never apply that stale snapshot to a different process tree.
            ownsRoot: () => this.isAlive
          }
        )
      ).catch((error) => {
        if (this.isAlive) {
          this.resetTerminationAfterSignalFailure()
        }
        console.warn('[Session] descendant-aware graceful kill failed:', error)
      })
    }
    this.scheduleForceDisposeFallback()
  }

  /** Signals a root whose descendant snapshot has completed. */
  signalTerminationRoot(): void {
    if (this._state === 'exited') {
      return
    }
    try {
      this.subprocess.kill()
    } catch (error) {
      // Why: a rejected signal is not termination; reopen the session so a later retry can still target the live child.
      this.resetTerminationAfterSignalFailure()
      throw error
    }
  }

  /** Starts the graceful-kill deadline when a coordinator owns the snapshot-first portion of teardown. */
  scheduleForceDisposeFallback(): void {
    if (this.killTimer) {
      return
    }
    this.armForceKillFallback(KILL_TIMEOUT_MS, SESSION_FORCE_KILL_MAX_ATTEMPTS)
  }

  protected resetTerminationAfterSignalFailure(): void {
    this._isTerminating = false
    if (this.killTimer) {
      clearTimeout(this.killTimer)
      this.killTimer = null
    }
  }

  protected armForceKillFallback(delayMs: number, attemptsRemaining: number): void {
    this.killTimer = setTimeout(() => {
      this.killTimer = null
      if (this._state !== 'exited') {
        try {
          this.requestForceKill()
        } catch (error) {
          console.warn('[Session] failed to force-kill terminating subprocess:', error)
          // Why: a transient SIGKILL rejection must not consume the only fallback owner after graceful shutdown returned.
          if (attemptsRemaining > 1) {
            this.armForceKillFallback(SESSION_FORCE_KILL_RETRY_MS, attemptsRemaining - 1)
          }
        }
      }
    }, delayMs)
  }

  async forceKillAndWaitForExit(
    timeoutMs = IMMEDIATE_KILL_PHYSICAL_EXIT_TIMEOUT_MS
  ): Promise<void> {
    if (this._state === 'exited') {
      return
    }
    if (!this._isTerminating) {
      this._isTerminating = true
      this.releaseProducerPause({ resume: true })
    }
    // Why: escalate a graceful termination now; waiting for the 5s timer would spend most of the physical-exit budget.
    await this.requestForceKillWithRetry()
    await this.waitForPhysicalExit(timeoutMs)
  }

  signal(sig: string): void {
    if (this._state === 'exited') {
      return
    }
    this.subprocess.signal(sig)
  }

  attachClient(client: Omit<AttachedClient, 'token'>): symbol {
    const token = Symbol('attach')
    this.attachedClients.push({ token, ...client })
    return token
  }

  detachClient(token: symbol): void {
    const idx = this.attachedClients.findIndex((c) => c.token === token)
    if (idx !== -1) {
      this.attachedClients.splice(idx, 1)
    }
    // Why: with no attached client nobody will send resumePty, so a paused shell would wedge until the failsafe; resume eagerly.
    if (this.attachedClients.length === 0) {
      this.releaseProducerPause({ resume: true })
    }
  }

  detachAllClients(): void {
    this.attachedClients.length = 0
    this.releaseProducerPause({ resume: true })
  }

  getSnapshot(opts: { scrollbackRows?: number } = {}): TerminalSnapshot | null {
    this.startupIngress.snapshotBarrier()
    if (this._disposed) {
      return null
    }
    return { ...this.emulator.getSnapshot(opts), outputSequence: this.outputSequence }
  }

  getPartialEscapeTailAnsi(): string {
    if (this._disposed) {
      return ''
    }
    return this.emulator.partialEscapeTailAnsi
  }

  // Why: returns the size the PTY actually applied (emulator dims) so the renderer can detect a
  // resize dropped here (exited/disposed/invalid) instead of trusting its last-requested size.
  getAppliedSize(): { cols: number; rows: number } | null {
    if (this._disposed) {
      return null
    }
    return this.emulator.getAppliedSize()
  }

  /** Drains records accumulated since the last take. When includeSnapshot is set it serializes in
   *  the same turn so no PTY data lands between drain and snapshot (which would replay twice on cold restore). */
  takePendingOutput(
    includeSnapshot: boolean,
    opts: { teardownSnapshot?: boolean } = {}
  ): TakePendingOutputResult | null {
    if (this._disposed) {
      return null
    }
    const releasedHeldBytes =
      includeSnapshot && opts.teardownSnapshot === true ? this.prepareForFinalSnapshot() : ''
    const records = this.pendingOutputRecords
    const overflowed = this.pendingOutputOverflowed
    this.pendingOutputRecords = []
    this.pendingOutputBytes = 0
    this.pendingOutputOverflowed = false
    this.pendingOutputSeq += 1
    return {
      records: includeSnapshot
        ? releasedHeldBytes
          ? [{ kind: 'output', data: releasedHeldBytes }]
          : []
        : records,
      seq: this.pendingOutputSeq,
      overflowed,
      snapshot: includeSnapshot ? this.getSnapshot() : null
    }
  }

  getCwd(): string | null {
    return this.emulator.getCwd()
  }

  getForegroundProcess(): string | null {
    return this.subprocess.getForegroundProcess()
  }

  async confirmForegroundProcess(): Promise<string | null> {
    return this.subprocess.confirmForegroundProcess?.() ?? this.subprocess.getForegroundProcess()
  }

  clearScrollback(): void {
    if (this._disposed) {
      return
    }
    this.emulator.clearScrollback()
    this.recordPendingOutput({ kind: 'clear' })
    this.subprocess.clear?.()
    this.#nudgePowerShellPromptRepaint()
  }

  /** Why: ConPTY's buffer clear leaves PSReadLine's cached cursor row stale, so the next prompt
   *  repaints below a blank gap; a form feed (Ctrl+L) forces a repaint at the true origin. Gated to a
   *  PowerShell foreground (else a running command/TUI gets a stray 0x0C) and an empty prompt (PSReadLine
   *  repaints pending input at a stale cached row ConPTY's fixed viewport doesn't track). */
  #nudgePowerShellPromptRepaint(): void {
    if (process.platform !== 'win32') {
      return
    }
    // Why: before shell-ready, write() would queue this form feed behind the startup command and
    // fire it later when the gates below are stale; the nudge is cosmetic, so skip rather than defer.
    if (this._shellState === 'pending' || this.postReadyFlushGate.isPending) {
      return
    }
    if (!isPowerShellProcess(this.subprocess.getForegroundProcess())) {
      return
    }
    if (!this.emulator.isCursorOnEmptyPromptLine()) {
      return
    }
    this.subprocess.write('\x0c')
  }

  prepareForFinalSnapshot(): string {
    const held = this.releaseHeldShellReadyBytes()
    this.startupIngress.snapshotBarrier()
    return held
  }


}

