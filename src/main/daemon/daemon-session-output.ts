import {
  PENDING_OUTPUT_MAX_BYTES,
  SESSION_FORCE_KILL_MAX_ATTEMPTS,
  SESSION_FORCE_KILL_RETRY_MS,
  SessionFoundation
} from './daemon-session-foundation'
import { drainShellReadyHeldBytes, scanForShellReady } from '../shell-ready-marker-scanner'
import type { PtyIngressEmission } from '../../shared/pty-startup-ingress'
import type { PendingOutputRecord } from './types'

export class SessionPhase1 extends SessionFoundation {
  dispose(): void {
    if (this._disposed) {
      return
    }

    // Why: `wasTerminating` below must be read BEFORE the `_state = 'exited'` flip — it guards the
    // "dispose while kill() in flight" case and the invariant needs the pre-flip `_state`; do NOT move it down.
    this.releaseHeldShellReadyBytes()
    this.startupIngress.drainAndClose()
    const wasTerminating = this._isTerminating && this._state !== 'exited'
    const clientsToNotify = wasTerminating ? this.attachedClients.slice() : []
    if (wasTerminating) {
      try {
        this.subprocess.forceKill()
      } catch {
        /* child may already be gone */
      }
      this._exitCode = -1
      this._isTerminating = false
    }

    this.#teardownSubprocess()
    this._state = 'exited'

    this.attachedClients = []
    this.preReadyStdinQueue = []
    this.postReadyFlushGate.clear()
    this.emulator.dispose()

    for (const client of clientsToNotify) {
      client.onExit(-1, this.incarnationId)
    }
  }

  /** fd-release-only teardown for ALREADY-exited sessions still retained in the host map; skips
   *  SIGKILL, so callers MUST NOT use it on live sessions. Separate method because a reaped pid is
   *  eligible for POSIX reuse, so SIGKILL could otherwise hit an unrelated process. */
  disposeSubprocess(): void {
    this.#teardownSubprocess()
    this._state = 'exited'
  }

  /** Orderly-shutdown path (TerminalHost.dispose()) for live sessions: force-kills the child, then
   *  synchronously frees the ptmx fd, bypassing the 5s KILL_TIMEOUT_MS fallback. Does NOT fan out
   *  onExit (renderer reconnects cold after daemon exit). Callers MUST check isAlive first. */
  async forceKillAndDisposeSubprocess(): Promise<void> {
    // Why: daemon exit can't neutralize the native handle until a bounded retry lands and onExit proves the child was reaped.
    await this.forceKillAndWaitForExit()
    this.dispose()
  }

  /** Shared teardown for dispose()/forceKillAndDisposeSubprocess(). Does NOT set `_state` — the
   *  caller owns that after capturing pre-flip invariants (see the wasTerminating capture in dispose). */
  #teardownSubprocess(): void {
    if (this._disposed) {
      return
    }
    this._disposed = true
    // Why: never leave a paused fd behind on teardown; the handle's dead-guard makes this a no-op once the child is reaped.
    this.releaseProducerPause({ resume: true })
    if (this.killTimer) {
      clearTimeout(this.killTimer)
      this.killTimer = null
    }
    if (this.shellReadyTimer) {
      clearTimeout(this.shellReadyTimer)
      this.shellReadyTimer = null
    }
    this.shellReadyScanState = null
    this.preReadyStdinQueue = []
    this.postReadyFlushGate.clear()
    this.disposeSubprocessHandle()
  }

  protected disposeSubprocessHandle(): void {
    if (this.subprocessDisposed) {
      return
    }
    this.subprocessDisposed = true
    try {
      this.subprocess.dispose()
    } catch (err) {
      // Why: dispose() should never throw, but if it does, callers must still complete their own cleanup (fanout, map removal).
      console.warn('[Session] subprocess.dispose() threw:', err)
    }
  }

  protected recordPendingOutput(record: PendingOutputRecord): void {
    if (this.pendingOutputOverflowed) {
      return
    }
    const bytes = record.kind === 'output' ? record.data.length : 8
    if (this.pendingOutputBytes + bytes > PENDING_OUTPUT_MAX_BYTES) {
      this.pendingOutputRecords = []
      this.pendingOutputBytes = 0
      this.pendingOutputOverflowed = true
      return
    }
    // Why: coalesce the thousands of tiny TUI chunks per tick to keep take RPC/log frames compact; 64KB cap bounds append cost.
    const last = this.pendingOutputRecords.at(-1)
    if (record.kind === 'output' && last?.kind === 'output' && last.data.length < 64 * 1024) {
      last.data += record.data
    } else {
      this.pendingOutputRecords.push(record)
    }
    this.pendingOutputBytes += bytes
  }

  protected handleSubprocessData(data: string): void {
    if (this._disposed) {
      return
    }

    if (this._shellState === 'pending' && this.shellReadyScanState) {
      const scanned = scanForShellReady(this.shellReadyScanState, data)
      data = scanned.output
      if (scanned.matched) {
        this.transitionToReady(scanned.postMarkerBytesObserved)
      }
    } else {
      this.postReadyFlushGate.notifyData()
    }

    this.startupIngress.accept(data)
  }

  protected emitSubprocessOutput(emission: PtyIngressEmission): void {
    const { data } = emission
    const rawLength = emission.rawEndSeq - emission.rawStartSeq
    // Why: absolute raw count (daemon stream thinning can drop bytes) lets a snapshot cover the gaps while the renderer dedups the tail.
    this.outputSequence += rawLength
    if (data.length > 0) {
      this.emulator.write(data)
      this.recordPendingOutput({ kind: 'output', data })
    }

    // Broadcast to attached clients
    for (const client of this.attachedClients) {
      if (emission.transformed || rawLength !== data.length) {
        client.onData(data, rawLength, true, this.outputSequence, this.incarnationId)
      } else {
        client.onData(data, undefined, undefined, undefined, this.incarnationId)
      }
    }
  }

  protected handleSubprocessExit(code: number): void {
    this.physicalExit.markExited()
    if (this._disposed) {
      return
    }

    this.releaseHeldShellReadyBytes()
    this.startupIngress.drainAndClose()
    this._exitCode = code
    this._state = 'exited'
    this._isTerminating = false
    // Why resume:false — the child is reaped (nothing to unblock); only the failsafe timer must not outlive the session.
    this.releaseProducerPause({ resume: false })

    if (this.killTimer) {
      clearTimeout(this.killTimer)
      this.killTimer = null
    }
    if (this.shellReadyTimer) {
      clearTimeout(this.shellReadyTimer)
      this.shellReadyTimer = null
    }
    this.postReadyFlushGate.clear()

    // Why: release the ptmx fd here or node-pty's _socket leaks the master fd until GC (docs/fix-pty-fd-leak.md).
    // Not via #teardownSubprocess: it flips `_disposed`, short-circuiting the later Session.dispose() reaper.
    this.disposeSubprocessHandle()

    for (const client of this.attachedClients) {
      client.onExit(code, this.incarnationId)
    }

    // Why: hand off to the owner's reaper (disposes emulator, drops session from host map); else dead sessions accumulate.
    this.onSessionExit?.(code)
  }

  protected releaseHeldShellReadyBytes(): string {
    if (!this.shellReadyScanState) {
      return ''
    }
    const heldBytes = drainShellReadyHeldBytes(this.shellReadyScanState)
    this.shellReadyScanState = null
    // Why: scanning strips marker bytes before fan-out; if readiness never completes, release any held prefix before timeout/exit discards it.
    this.startupIngress.accept(heldBytes)
    return heldBytes
  }

  closeStartupQueryAuthority(): number {
    return this.startupIngress.closeQueryAuthority()
  }

  protected transitionToReady(postMarkerBytesObserved = false): void {
    this._shellState = 'ready'
    this.shellReadyScanState = null
    if (this.shellReadyTimer) {
      clearTimeout(this.shellReadyTimer)
      this.shellReadyTimer = null
    }
    if (this.preReadyStdinQueue.length === 0) {
      return
    }
    this.postReadyFlushGate.arm(postMarkerBytesObserved)
  }

  protected onShellReadyTimeout(): void {
    this.shellReadyTimer = null
    if (this._shellState !== 'pending') {
      return
    }
    this._shellState = 'timed_out'
    this.releaseHeldShellReadyBytes()
    this.flushPreReadyQueue()
  }

  protected flushPreReadyQueue(): void {
    const queued = this.preReadyStdinQueue
    this.preReadyStdinQueue = []
    for (const data of queued) {
      this.subprocess.write(data)
    }
  }

  protected requestForceKill(): void {
    if (this._state === 'exited' || this.forceKillSent) {
      return
    }
    this.forceKillSent = true
    try {
      this.subprocess.forceKill()
    } catch (error) {
      this.forceKillSent = false
      throw error
    }
  }

  protected async requestForceKillWithRetry(): Promise<void> {
    let lastError: unknown
    for (let attempt = 0; attempt < SESSION_FORCE_KILL_MAX_ATTEMPTS; attempt++) {
      try {
        this.requestForceKill()
        return
      } catch (error) {
        lastError = error
      }
      if (attempt + 1 < SESSION_FORCE_KILL_MAX_ATTEMPTS) {
        try {
          await this.physicalExit.waitForExit(
            SESSION_FORCE_KILL_RETRY_MS,
            () => new Error(`Retrying force-kill for PTY ${this.sessionId}`)
          )
          return
        } catch {
          // The bounded waiter detached; retry the still-owned subprocess.
        }
      }
    }
    throw lastError
  }

  protected waitForPhysicalExit(timeoutMs: number): Promise<void> {
    // Why: timed-out destructive retries must detach from an unkillable child, else each retry stays retained until it exits.
    return this.physicalExit.waitForExit(
      timeoutMs,
      () => new Error(`Timed out waiting for PTY process exit: ${this.sessionId}`)
    )
  }
}
