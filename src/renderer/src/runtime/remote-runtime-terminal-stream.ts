import { exposeE2eRemoteTerminalMultiplexAckGate, resetE2eRemoteTerminalMultiplexersState } from './remote-runtime-terminal-e2e-gate'
import { handleRemoteTerminalResponse, handleRemoteTerminalBinary, detectRemoteTerminalOutputGap } from './remote-runtime-terminal-frame-handlers'
import { requestRemoteTerminalResyncSnapshot, sendDeferredRemoteTerminalResyncSnapshot, sendRemoteTerminalResyncSnapshot, scheduleRemoteTerminalResyncRetry, startRemoteTerminalResyncTimer, requestRemoteTerminalSnapshot, allocateRemoteTerminalSnapshotRequestId } from './remote-runtime-terminal-snapshot'
import { acknowledgeRemoteTerminalOutput, sendRemoteTerminalInput, setRemoteTerminalOutputPaused, probeRemoteTerminalCommandResponse, recoverRemoteTerminalStalledStream, queueRemoteTerminalOutputAcknowledgement, flushRemoteTerminalOutputAcknowledgement, getRemoteTerminalStreamsForE2e, releaseRemoteTerminalHeldAcksForE2e, sendRemoteTerminalInputForE2e } from './remote-runtime-terminal-flow-control'
import { sendRemoteTerminalFrame, resolveRemoteTerminalReadyIfConnected, failRemoteTerminalConnection, handleRemoteTerminalClose, closeRemoteTerminalIfIdle } from './remote-runtime-terminal-lifecycle'

import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import { isRecoverableRemoteRuntimeConnectionError } from '../../../shared/remote-runtime-client-error-classification'
import {
  TerminalStreamOpcode,
  decodeTerminalStreamFrame,
  decodeTerminalStreamJson,
  decodeTerminalStreamText,
  encodeTerminalStreamFrame,
  encodeTerminalStreamJson,
  encodeTerminalStreamText
} from '../../../shared/terminal-stream-protocol'
import { e2eConfig, e2eDisableRemoteTerminalStallRecovery } from '@/lib/e2e-config'
import { recordRendererCrashBreadcrumb } from '@/lib/crash-breadcrumb-recorder'
import { deliverTerminalDataWithDeferredCredit } from '@/lib/pane-manager/terminal-delivery-credit'
import { unwrapRuntimeRpcResult } from './runtime-rpc-client'
import { getRuntimeEnvironmentRevision } from './runtime-environment-revision'
import {
  TERMINAL_MULTIPLEX_ACK_BATCH_BYTES,
  TERMINAL_MULTIPLEX_ACK_FLUSH_MS,
  TERMINAL_MULTIPLEX_STREAM_LIMIT_ERROR
} from '../../../shared/terminal-multiplex-flow-control'
import {
  createRemoteTerminalStreamWatchdog,
  type RemoteTerminalStreamWatchdog
} from './remote-terminal-stream-watchdog'

export type RuntimeEnvironmentSubscriptionHandle = {
  unsubscribe: () => void
  sendBinary: (bytes: Uint8Array<ArrayBufferLike>) => void
}

export type TerminalMultiplexEvent =
  | { type: 'ready' }
  | {
      type: 'subscribed'
      streamId: number
      streamGeneration?: string
      capabilities?: { ackOutputSourceRanges?: 1; outputPause?: 1 }
    }
  | { type: 'end'; streamId: number }
  | { type: 'error'; streamId: number; message?: string }
  | {
      type: 'fit-override-changed'
      streamId: number
      mode: 'mobile-fit' | 'remote-desktop-fit' | 'desktop-fit'
      cols: number
      rows: number
    }
  | {
      type: 'driver-changed'
      streamId: number
      driver: { kind: 'idle' } | { kind: 'desktop' } | { kind: 'mobile'; clientId: string }
    }
  | { type: string; streamId?: number; [key: string]: unknown }

export type RemoteRuntimeMultiplexedTerminalCallbacks = {
  onData: (data: string, meta?: { seq?: number; rawLength?: number; transformed?: boolean }) => void
  onSnapshot: (data: string, meta?: { pendingEscapeTailAnsi?: string }) => void
  onSubscribed?: () => void
  onOutputPauseCapability?: () => void
  onEnd?: () => void
  onError?: (message: string) => void
  onFitOverrideChanged?: (event: {
    mode: 'mobile-fit' | 'remote-desktop-fit' | 'desktop-fit'
    cols: number
    rows: number
  }) => void
  onDriverChanged?: (
    driver: { kind: 'idle' } | { kind: 'desktop' } | { kind: 'mobile'; clientId: string }
  ) => void
  onTransportClose?: (event: { recoverable: boolean; retryWithBackoff?: boolean }) => void
}

export type RemoteRuntimeMultiplexedTerminal = {
  streamId: number
  sendInput: (text: string) => boolean
  resize: (cols: number, rows: number) => boolean
  claimViewport: (cols: number, rows: number) => boolean
  setOutputPaused: (paused: boolean) => boolean
  serializeBuffer: (opts?: { scrollbackRows?: number }) => Promise<{
    data: string
    cols: number
    rows: number
    seq?: number
    source?: 'headless' | 'renderer'
  } | null>
  close: () => void
}

export type RemoteRuntimeMultiplexedTerminalState = {
  streamId: number
  terminal: string
  callbacks: RemoteRuntimeMultiplexedTerminalCallbacks
  subscriptionRequested: boolean
  acknowledgeOutput: boolean
  acknowledgeOutputSourceRanges: boolean
  supportsOutputPause: boolean
  outputPaused: boolean
  streamGeneration: string | null
  sourceAckedEndByte: number
  heldAckBytes: number
  pendingAckBytes: number
  ackFlushTimer: ReturnType<typeof setTimeout> | null
  snapshotChunks: Uint8Array<ArrayBufferLike>[]
  snapshotBytes: number
  snapshotOverflowed: boolean
  snapshotTarget: 'initial' | 'request' | 'recovery'
  snapshotInfo: RemoteRuntimeSnapshotInfo | null
  initialSnapshotReceived: boolean
  pendingSnapshotRequest: RemoteRuntimeSnapshotRequest | null
  // Why: Output frames carry a UTF-16 offset high-water `seq`; a jump past the
  // expected next offset means the server dropped frames under backpressure.
  // Track it so a gap triggers a self-healing snapshot resync instead of
  // silently rendering corrupt/missing output (frame-drop resync).
  expectedSeq: number | undefined
  // Why: compare command probes when initial/live frames supplied no high-water.
  commandProbeBaselineSeq: number | undefined
  recoverySnapshotSeq: number | undefined
  resyncInFlight: boolean
  resyncPendingSend: boolean
  resyncTimer: ReturnType<typeof setTimeout> | null
  resyncAttempts: number
  capacityRejected: boolean
  watchdog: RemoteTerminalStreamWatchdog
}

export type RemoteRuntimeSnapshotInfo = {
  cols?: number
  rows?: number
  seq?: number
  source?: 'headless' | 'renderer'
  requestId?: number
  truncated?: boolean
  // Why: a mid-escape tail the emulator could not serialize; the transport
  // must write it AFTER the replay reset so the next live chunk completes it
  // instead of rendering literally (#7329).
  pendingEscapeTailAnsi?: string
}

export type RemoteRuntimeSnapshotRequest = {
  requestId: number
  resolve: (
    snapshot: {
      data: string
      cols: number
      rows: number
      seq?: number
      source?: 'headless' | 'renderer'
      pendingEscapeTailAnsi?: string
    } | null
  ) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export const CONTROL_STREAM_ID = 0
export const MAX_REMOTE_TERMINAL_SNAPSHOT_BYTES = 2 * 1024 * 1024
export const REMOTE_TERMINAL_SNAPSHOT_REQUEST_TIMEOUT_MS = 10_000
export const REMOTE_TERMINAL_RESYNC_TIMEOUT_MS = 10_000
// Why: a truncated recovery means the server is too flooded to serialize;
// retrying once per incoming chunk would stampede it, so back off instead.
export const REMOTE_TERMINAL_RESYNC_RETRY_BASE_MS = 500
export const REMOTE_TERMINAL_RESYNC_RETRY_MAX_MS = 5_000
// Why: exported so the transport can classify it as benign — the snapshot was
// skipped but live output continues, so it must not surface a fatal red banner.
export const REMOTE_TERMINAL_SNAPSHOT_TOO_LARGE =
  'Remote terminal snapshot exceeded the 2 MiB replay limit; live output will continue.'


export class RemoteRuntimeTerminalMultiplexer {
  readonly streams = new Map<number, RemoteRuntimeMultiplexedTerminalState>()
  subscription: RuntimeEnvironmentSubscriptionHandle | null = null
  connectPromise: Promise<void> | null = null
  readyResolver: (() => void) | null = null
  readyRejecter: ((error: Error) => void) | null = null
  ready = false
  nextStreamId = 1
  nextSnapshotRequestId = 1

  constructor(
    readonly environmentId: string,
    readonly environmentRevision: number | undefined,
    readonly releaseIfCurrent: (
      environmentId: string,
      multiplexer: RemoteRuntimeTerminalMultiplexer
    ) => void
  ) {}

  matchesCurrentEnvironmentRevision(): boolean {
    return getRuntimeEnvironmentRevision(this.environmentId) === this.environmentRevision
  }

  closeForEnvironmentReplacement(): void {
    this.handleClose('Runtime environment pairing changed.')
  }

  async subscribeTerminal(args: {
    terminal: string
    client: { id: string; type: 'desktop' | 'mobile' }
    viewport?: { cols: number; rows: number }
    callbacks: RemoteRuntimeMultiplexedTerminalCallbacks
  }): Promise<RemoteRuntimeMultiplexedTerminal> {
    const streamId = this.allocateStreamId()
    const state: RemoteRuntimeMultiplexedTerminalState = {
      streamId,
      terminal: args.terminal,
      callbacks: args.callbacks,
      subscriptionRequested: false,
      acknowledgeOutput: true,
      acknowledgeOutputSourceRanges: false,
      supportsOutputPause: false,
      outputPaused: false,
      streamGeneration: null,
      sourceAckedEndByte: 0,
      heldAckBytes: 0,
      pendingAckBytes: 0,
      ackFlushTimer: null,
      snapshotChunks: [],
      snapshotBytes: 0,
      snapshotOverflowed: false,
      snapshotTarget: 'initial',
      snapshotInfo: null,
      initialSnapshotReceived: false,
      pendingSnapshotRequest: null,
      expectedSeq: undefined,
      commandProbeBaselineSeq: undefined,
      recoverySnapshotSeq: undefined,
      resyncInFlight: false,
      resyncPendingSend: false,
      resyncTimer: null,
      resyncAttempts: 0,
      capacityRejected: false,
      watchdog: createRemoteTerminalStreamWatchdog((stall) => {
        if (e2eDisableRemoteTerminalStallRecovery) {
          state.watchdog.completeCommandResponseProbe()
          return
        }
        recordRendererCrashBreadcrumb('remote_terminal_stream_stall_recovery', {
          environmentId: this.environmentId,
          expectedSeq: state.expectedSeq ?? null,
          inactiveForMs: stall.inactiveForMs,
          outstandingDeliveryBytes: stall.outstandingDeliveryBytes,
          pendingAckBytes: state.pendingAckBytes,
          reason: stall.reason,
          resyncAttempts: state.resyncAttempts,
          snapshotPending: state.pendingSnapshotRequest !== null,
          streamId: state.streamId,
          terminal: state.terminal
        })
        if (stall.reason === 'command-response-timeout') {
          this.probeCommandResponse(state)
        } else {
          this.recoverStalledStream(state)
        }
      })
    }
    this.streams.set(streamId, state)

    const stream: RemoteRuntimeMultiplexedTerminal = {
      streamId,
      sendInput: (text) => this.sendInput(state, text),
      resize: (cols, rows) =>
        this.sendFrame(
          streamId,
          TerminalStreamOpcode.Resize,
          encodeTerminalStreamJson({ cols, rows })
        ),
      claimViewport: (cols, rows) => {
        const claimed = this.sendFrame(
          streamId,
          TerminalStreamOpcode.ClaimViewport,
          encodeTerminalStreamJson({ cols, rows })
        )
        // Why: older runtimes ignore the claim opcode but still understand
        // Resize. Claim first keeps new-runtime ownership precise and leaves a
        // backwards-compatible resize immediately behind it.
        const resized = this.sendFrame(
          streamId,
          TerminalStreamOpcode.Resize,
          encodeTerminalStreamJson({ cols, rows })
        )
        return claimed && resized
      },
      setOutputPaused: (paused) => this.setOutputPaused(state, paused),
      serializeBuffer: (opts) => this.requestSnapshot(state, opts),
      close: () => {
        if (this.streams.get(streamId) === state) {
          discardOutputAcknowledgements(state)
          state.watchdog.dispose()
          this.sendFrame(streamId, TerminalStreamOpcode.Unsubscribe)
          clearResyncTimer(state)
          rejectPendingSnapshotRequest(state, 'Remote terminal stream closed.')
          this.streams.delete(streamId)
          this.closeIfIdle()
        }
      }
    }

    try {
      await this.ensureConnected()
      if (this.streams.get(streamId) !== state) {
        return stream
      }
      const sent = this.sendFrame(
        CONTROL_STREAM_ID,
        TerminalStreamOpcode.Subscribe,
        encodeTerminalStreamJson({
          streamId,
          terminal: args.terminal,
          client: args.client,
          viewport: args.viewport,
          capabilities: {
            ackOutput: 1,
            ackOutputSourceRanges: 1,
            outputPause: 1,
            ...(args.client.type === 'desktop' ? { desktopViewportClaims: 1 } : {})
          }
        })
      )
      if (!sent) {
        throw new Error('Remote terminal stream is not connected.')
      }
      state.subscriptionRequested = true
    } catch (error) {
      const terminalError = error instanceof Error ? error : new Error(String(error))
      if (this.streams.get(streamId) === state) {
        this.streams.delete(streamId)
        this.closeIfIdle()
      }
      throw terminalError
    }

    return stream
  }

  allocateStreamId(): number {
    const start = this.nextStreamId
    do {
      const candidate = this.nextStreamId
      this.nextStreamId = this.nextStreamId >= 0x7fffffff ? 1 : this.nextStreamId + 1
      if (!this.streams.has(candidate)) {
        return candidate
      }
    } while (this.nextStreamId !== start)
    throw new Error('No remote terminal stream ids available.')
  }

  ensureConnected(): Promise<void> {
    if (this.ready && this.subscription) {
      return Promise.resolve()
    }
    if (this.connectPromise) {
      return this.connectPromise
    }
    const connectPromise = new Promise<void>((resolve, reject) => {
      this.readyResolver = resolve
      this.readyRejecter = reject
      void window.api.runtimeEnvironments
        .subscribe(
          {
            selector: this.environmentId,
            method: 'terminal.multiplex',
            params: {},
            timeoutMs: 15_000,
            expectedEnvironmentPairingRevision: this.environmentRevision
          },
          {
            onResponse: (response) => this.handleResponse(response),
            onBinary: (bytes) => this.handleBinary(bytes),
            onError: (error) => {
              if (isRecoverableRemoteRuntimeConnectionError(error)) {
                this.handleClose(error.message)
              } else {
                this.failConnection(Object.assign(new Error(error.message), { code: error.code }))
              }
            },
            onClose: () => this.handleClose('Remote Orca runtime closed the connection.')
          }
        )
        .then((subscription) => {
          if (this.connectPromise !== connectPromise || (!this.ready && !this.readyRejecter)) {
            // Why: close/error can arrive before subscribe() resolves because
            // preload listens before ipcMain.handle() returns. The multiplexer
            // may already be released; do not retain the late handle.
            subscription.unsubscribe()
            return
          }
          this.subscription = subscription
          this.resolveReadyIfConnected()
        })
        .catch((error) => {
          if (this.connectPromise === connectPromise) {
            this.connectPromise = null
            this.readyResolver = null
            this.readyRejecter = null
          }
          reject(error instanceof Error ? error : new Error(String(error)))
        })
    })
    this.connectPromise = connectPromise
    return this.connectPromise
  }

  handleResponse(response: RuntimeRpcResponse<unknown>) {
    handleRemoteTerminalResponse(this, response)
  }
  handleBinary(bytes: Uint8Array<ArrayBufferLike>) {
    handleRemoteTerminalBinary(this, bytes)
  }
  detectOutputGap(stream: RemoteRuntimeMultiplexedTerminalState, seq: number | undefined, rawLength: number) {
    detectRemoteTerminalOutputGap(this, stream, seq, rawLength)
  }
  requestResyncSnapshot(stream: RemoteRuntimeMultiplexedTerminalState) {
    requestRemoteTerminalResyncSnapshot(this, stream)
  }
  sendDeferredResyncSnapshot(stream: RemoteRuntimeMultiplexedTerminalState) {
    sendDeferredRemoteTerminalResyncSnapshot(this, stream)
  }
  sendResyncSnapshot(stream: RemoteRuntimeMultiplexedTerminalState) {
    sendRemoteTerminalResyncSnapshot(this, stream)
  }
  scheduleResyncRetry(stream: RemoteRuntimeMultiplexedTerminalState) {
    scheduleRemoteTerminalResyncRetry(this, stream)
  }
  startResyncTimer(stream: RemoteRuntimeMultiplexedTerminalState) {
    startRemoteTerminalResyncTimer(this, stream)
  }
  requestSnapshot(stream: RemoteRuntimeMultiplexedTerminalState, opts?: { scrollbackRows?: number }) {
    return requestRemoteTerminalSnapshot(this, stream, opts)
  }
  allocateSnapshotRequestId() {
    return allocateRemoteTerminalSnapshotRequestId(this)
  }
  acknowledgeOutput(stream: RemoteRuntimeMultiplexedTerminalState, bytes: number) {
    return acknowledgeRemoteTerminalOutput(this, stream, bytes)
  }
  sendInput(stream: RemoteRuntimeMultiplexedTerminalState, text: string) {
    return sendRemoteTerminalInput(this, stream, text)
  }
  setOutputPaused(stream: RemoteRuntimeMultiplexedTerminalState, paused: boolean) {
    return setRemoteTerminalOutputPaused(this, stream, paused)
  }
  probeCommandResponse(stream: RemoteRuntimeMultiplexedTerminalState) {
    return probeRemoteTerminalCommandResponse(this, stream)
  }
  recoverStalledStream(stream: RemoteRuntimeMultiplexedTerminalState) {
    return recoverRemoteTerminalStalledStream(this, stream)
  }
  queueOutputAcknowledgement(stream: RemoteRuntimeMultiplexedTerminalState, bytes: number) {
    return queueRemoteTerminalOutputAcknowledgement(this, stream, bytes)
  }
  flushOutputAcknowledgement(stream: RemoteRuntimeMultiplexedTerminalState) {
    return flushRemoteTerminalOutputAcknowledgement(this, stream)
  }
  getStreamsForE2e() {
    return getRemoteTerminalStreamsForE2e(this)
  }
  releaseHeldAcksForE2e() {
    return releaseRemoteTerminalHeldAcksForE2e(this)
  }
  sendInputForE2e(terminal: string, text: string) {
    return sendRemoteTerminalInputForE2e(this, terminal, text)
  }
  sendFrame(streamId: number, opcode: TerminalStreamOpcode, payload: Uint8Array<ArrayBufferLike> = new Uint8Array()) {
    return sendRemoteTerminalFrame(this, streamId, opcode, payload)
  }
  resolveReadyIfConnected() {
    resolveRemoteTerminalReadyIfConnected(this)
  }
  failConnection(error: Error) {
    failRemoteTerminalConnection(this, error)
  }
  handleClose(message?: string, recoverable = true) {
    handleRemoteTerminalClose(this, message, recoverable)
  }
  closeIfIdle() {
    closeRemoteTerminalIfIdle(this)
  }
}

export const multiplexers = new Map<string, RemoteRuntimeTerminalMultiplexer>()

export function releaseRemoteRuntimeTerminalMultiplexer(
  environmentId: string,
  multiplexer: RemoteRuntimeTerminalMultiplexer
): void {
  if (multiplexers.get(environmentId) === multiplexer) {
    multiplexers.delete(environmentId)
  }
}

export function getRemoteRuntimeTerminalMultiplexer(
  environmentId: string
): RemoteRuntimeTerminalMultiplexer {
  exposeE2eRemoteTerminalMultiplexAckGate()
  let multiplexer = multiplexers.get(environmentId)
  if (multiplexer && !multiplexer.matchesCurrentEnvironmentRevision()) {
    multiplexer.closeForEnvironmentReplacement()
    multiplexer = undefined
  }
  if (!multiplexer) {
    multiplexer = new RemoteRuntimeTerminalMultiplexer(
      environmentId,
      getRuntimeEnvironmentRevision(environmentId),
      releaseRemoteRuntimeTerminalMultiplexer
    )
    multiplexers.set(environmentId, multiplexer)
  }
  return multiplexer
}

export function _getRemoteRuntimeTerminalMultiplexerCountForTest(): number {
  return multiplexers.size
}

export function resetRemoteRuntimeTerminalMultiplexersForTests(): void {
  multiplexers.clear()
  resetE2eRemoteTerminalMultiplexersState()
}

import {
  clearAckFlushTimer,
  clearPendingSnapshotRequest,
  clearResyncTimer,
  clearSnapshot,
  concatBytes,
  decodeSnapshotInfo,
  discardOutputAcknowledgements,
  isTerminalDriverState,
  rejectPendingSnapshotRequest
} from './remote-runtime-terminal-stream-state'
export {
  e2eHeldRemoteAckTerminals,
  e2eDroppedOutputStreams,
  e2eDroppedOutputBytes,
  e2eDroppedOutputFrames,
  e2eReleasedRemoteAckChars,
  shouldHoldE2eRemoteTerminalAck,
  getE2eRemoteAckSnapshot,
  releaseE2eRemoteTerminalAcks,
  resetE2eDroppedRemoteOutput,
  shouldDropE2eRemoteTerminalOutput,
  exposeE2eRemoteTerminalMultiplexAckGate,
  type E2eRemoteTerminalMultiplexAckGateSnapshot,
  type E2eRemoteTerminalMultiplexAckGateApi,
  type E2eRemoteTerminalMultiplexAckGateWindow
} from './remote-runtime-terminal-e2e-gate'
