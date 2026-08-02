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
import { CONTROL_STREAM_ID, MAX_REMOTE_TERMINAL_SNAPSHOT_BYTES, REMOTE_TERMINAL_SNAPSHOT_REQUEST_TIMEOUT_MS, REMOTE_TERMINAL_RESYNC_TIMEOUT_MS, REMOTE_TERMINAL_RESYNC_RETRY_BASE_MS, REMOTE_TERMINAL_RESYNC_RETRY_MAX_MS, REMOTE_TERMINAL_SNAPSHOT_TOO_LARGE, e2eHeldRemoteAckTerminals, e2eDroppedOutputStreams, e2eDroppedOutputBytes, e2eDroppedOutputFrames, e2eReleasedRemoteAckChars, shouldHoldE2eRemoteTerminalAck, getE2eRemoteAckSnapshot, releaseE2eRemoteTerminalAcks, resetE2eDroppedRemoteOutput, shouldDropE2eRemoteTerminalOutput, exposeE2eRemoteTerminalMultiplexAckGate, RemoteRuntimeTerminalMultiplexer, multiplexers, releaseRemoteRuntimeTerminalMultiplexer, getRemoteRuntimeTerminalMultiplexer, _getRemoteRuntimeTerminalMultiplexerCountForTest, resetRemoteRuntimeTerminalMultiplexersForTests, type RuntimeEnvironmentSubscriptionHandle, type TerminalMultiplexEvent, type RemoteRuntimeMultiplexedTerminalCallbacks, type RemoteRuntimeMultiplexedTerminal, type RemoteRuntimeMultiplexedTerminalState, type RemoteRuntimeSnapshotInfo, type RemoteRuntimeSnapshotRequest, type E2eRemoteTerminalMultiplexAckGateSnapshot, type E2eRemoteTerminalMultiplexAckGateApi, type E2eRemoteTerminalMultiplexAckGateWindow } from './remote-runtime-terminal-stream'

export function handleRemoteTerminalResponse(multiplexer: RemoteRuntimeTerminalMultiplexer, response: RuntimeRpcResponse<unknown>): void {
    if (!multiplexer.matchesCurrentEnvironmentRevision()) {
      multiplexer.closeForEnvironmentReplacement()
      return
    }
    let event: TerminalMultiplexEvent
    try {
      event = unwrapRuntimeRpcResult(response) as TerminalMultiplexEvent
    } catch (error) {
      multiplexer.failConnection(error instanceof Error ? error : new Error(String(error)))
      return
    }

    if (event.type === 'ready') {
      multiplexer.ready = true
      multiplexer.resolveReadyIfConnected()
      return
    }

    if (!('streamId' in event) || typeof event.streamId !== 'number') {
      return
    }
    const stream = multiplexer.streams.get(event.streamId)
    if (!stream) {
      return
    }
    stream.watchdog.recordInbound()
    if (event.type === 'subscribed') {
      const capabilities =
        typeof event.capabilities === 'object' && event.capabilities !== null
          ? (event.capabilities as { ackOutputSourceRanges?: unknown; outputPause?: unknown })
          : null
      if (
        capabilities?.ackOutputSourceRanges === 1 &&
        typeof event.streamGeneration === 'string' &&
        event.streamGeneration.length > 0
      ) {
        stream.acknowledgeOutputSourceRanges = true
        stream.streamGeneration = event.streamGeneration
      }
      stream.supportsOutputPause = capabilities?.outputPause === 1
      if (stream.supportsOutputPause) {
        stream.callbacks.onOutputPauseCapability?.()
      }
    } else if (event.type === 'end') {
      discardOutputAcknowledgements(stream)
      stream.watchdog.dispose()
      clearSnapshot(stream)
      clearResyncTimer(stream)
      rejectPendingSnapshotRequest(stream, 'Remote terminal stream ended.')
      multiplexer.streams.delete(event.streamId)
      if (stream.capacityRejected) {
        if (stream.callbacks.onTransportClose) {
          stream.callbacks.onTransportClose({ recoverable: true, retryWithBackoff: true })
        } else {
          stream.callbacks.onError?.(TERMINAL_MULTIPLEX_STREAM_LIMIT_ERROR)
        }
      } else {
        stream.callbacks.onEnd?.()
      }
      multiplexer.closeIfIdle()
    } else if (event.type === 'error') {
      const message =
        typeof event.message === 'string' ? event.message : 'Remote terminal stream failed.'
      if (message === TERMINAL_MULTIPLEX_STREAM_LIMIT_ERROR) {
        stream.capacityRejected = true
        return
      }
      clearSnapshot(stream)
      rejectPendingSnapshotRequest(stream, message)
      // Why: the paired binary Error frame can be dropped under backpressure;
      // this reliable event must also dispatch or release the resync gate, and
      // must never disarm the watchdog while leaving the gate shut.
      if (stream.resyncPendingSend) {
        multiplexer.sendDeferredResyncSnapshot(stream)
      } else {
        clearResyncTimer(stream)
        stream.resyncInFlight = false
      }
      stream.callbacks.onError?.(message)
    } else if (event.type === 'fit-override-changed') {
      if (
        (event.mode !== 'mobile-fit' &&
          event.mode !== 'remote-desktop-fit' &&
          event.mode !== 'desktop-fit') ||
        typeof event.cols !== 'number' ||
        typeof event.rows !== 'number'
      ) {
        return
      }
      stream.callbacks.onFitOverrideChanged?.({
        mode: event.mode,
        cols: event.cols,
        rows: event.rows
      })
    } else if (event.type === 'driver-changed') {
      if (!isTerminalDriverState(event.driver)) {
        return
      }
      stream.callbacks.onDriverChanged?.(event.driver)
    }
  }


export function handleRemoteTerminalBinary(multiplexer: RemoteRuntimeTerminalMultiplexer, bytes: Uint8Array<ArrayBufferLike>): void {
    if (!multiplexer.matchesCurrentEnvironmentRevision()) {
      multiplexer.closeForEnvironmentReplacement()
      return
    }
    const frame = decodeTerminalStreamFrame(bytes)
    if (!frame) {
      // Why: malformed framing cannot be credited safely; closing makes the server release every stream window.
      multiplexer.failConnection(new Error('Remote terminal stream received a malformed frame.'))
      return
    }
    const stream = multiplexer.streams.get(frame.streamId)
    if (!stream) {
      if (
        frame.opcode === TerminalStreamOpcode.Output ||
        frame.opcode === TerminalStreamOpcode.OutputSpan
      ) {
        // Why: the renderer already disposed this stream; unsubscribe releases server credit that cannot reach a parser.
        multiplexer.sendFrame(frame.streamId, TerminalStreamOpcode.Unsubscribe)
      }
      return
    }
    if (
      (frame.opcode === TerminalStreamOpcode.Output ||
        frame.opcode === TerminalStreamOpcode.OutputSpan) &&
      shouldDropE2eRemoteTerminalOutput(stream, frame.payload.byteLength)
    ) {
      multiplexer.queueOutputAcknowledgement(stream, frame.payload.byteLength)
      return
    }
    stream.watchdog.recordInbound()
    if (
      frame.opcode === TerminalStreamOpcode.Output ||
      frame.opcode === TerminalStreamOpcode.OutputSpan
    ) {
      const span =
        frame.opcode === TerminalStreamOpcode.OutputSpan
          ? decodeTerminalStreamJson<{
              data?: unknown
              rawLength?: unknown
              transformed?: unknown
            }>(frame.payload)
          : null
      const validSpan =
        frame.opcode !== TerminalStreamOpcode.OutputSpan ||
        (typeof span?.data === 'string' &&
          typeof span.rawLength === 'number' &&
          Number.isSafeInteger(span.rawLength) &&
          span.rawLength >= 0 &&
          span.transformed === true)
      const data =
        frame.opcode === TerminalStreamOpcode.OutputSpan
          ? validSpan
            ? (span!.data as string)
            : ''
          : decodeTerminalStreamText(frame.payload)
      const deliverOutput = (): void => {
        if (!validSpan) {
          // Why: rendering malformed span JSON would expose protocol framing
          // as terminal text and lose its raw sequence accounting.
          multiplexer.requestResyncSnapshot(stream)
          return
        }
        const rawLength =
          frame.opcode === TerminalStreamOpcode.OutputSpan && typeof span?.rawLength === 'number'
            ? span.rawLength
            : data.length
        // Why: a resync snapshot is authoritative; discard live output while
        // it is in flight, but still return transport credit in finally.
        if (stream.resyncInFlight) {
          return
        }
        const seq = typeof frame.seq === 'number' && frame.seq > 0 ? frame.seq : undefined
        // Why: older servers replay snapshot-covered buffered chunks after a
        // requested recovery; rendering them would duplicate the recovered tail.
        if (
          typeof seq === 'number' &&
          typeof stream.recoverySnapshotSeq === 'number' &&
          seq <= stream.recoverySnapshotSeq
        ) {
          return
        }
        if (multiplexer.detectOutputGap(stream, seq, rawLength)) {
          multiplexer.requestResyncSnapshot(stream)
          return
        }
        if (typeof seq === 'number') {
          stream.expectedSeq = seq
          stream.commandProbeBaselineSeq = undefined
        }
        stream.callbacks.onData(data, {
          seq,
          rawLength,
          ...(frame.opcode === TerminalStreamOpcode.OutputSpan ? { transformed: true } : {})
        })
      }
      if (!stream.acknowledgeOutput) {
        deliverOutput()
        return
      }
      try {
        const settleWatchdog = stream.watchdog.beginOutputDelivery(frame.payload.byteLength)
        deliverTerminalDataWithDeferredCredit(() => {
          settleWatchdog()
          if (shouldHoldE2eRemoteTerminalAck(stream.terminal)) {
            stream.heldAckBytes += frame.payload.byteLength
          } else {
            multiplexer.queueOutputAcknowledgement(stream, frame.payload.byteLength)
          }
        }, deliverOutput)
      } catch (error) {
        multiplexer.failConnection(
          error instanceof Error ? error : new Error('Remote terminal output delivery failed.')
        )
      }
      return
    }
    if (frame.opcode === TerminalStreamOpcode.SnapshotStart) {
      clearSnapshot(stream)
      stream.snapshotInfo = decodeSnapshotInfo(frame.payload)
      const requestId = stream.snapshotInfo?.requestId
      stream.snapshotTarget =
        typeof requestId === 'number' ||
        (stream.initialSnapshotReceived && stream.pendingSnapshotRequest)
          ? 'request'
          : stream.initialSnapshotReceived
            ? 'recovery'
            : 'initial'
      return
    }
    if (frame.opcode === TerminalStreamOpcode.SnapshotChunk) {
      if (stream.snapshotOverflowed) {
        return
      }
      stream.snapshotBytes += frame.payload.byteLength
      if (stream.snapshotBytes > MAX_REMOTE_TERMINAL_SNAPSHOT_BYTES) {
        stream.snapshotOverflowed = true
        if (stream.snapshotTarget === 'initial') {
          stream.callbacks.onError?.(REMOTE_TERMINAL_SNAPSHOT_TOO_LARGE)
        }
        return
      }
      stream.snapshotChunks.push(frame.payload)
      return
    }
    if (frame.opcode === TerminalStreamOpcode.SnapshotEnd) {
      const data = stream.snapshotOverflowed
        ? null
        : decodeTerminalStreamText(concatBytes(stream.snapshotChunks))
      const target = stream.snapshotTarget
      const info = stream.snapshotInfo
      const pendingRequest = stream.pendingSnapshotRequest
      const snapshotApplied = !stream.snapshotOverflowed && info?.truncated !== true
      const matchesPendingRequest =
        target === 'request' &&
        pendingRequest &&
        (typeof info?.requestId === 'number'
          ? info.requestId === pendingRequest.requestId
          : stream.initialSnapshotReceived)
      if (snapshotApplied) {
        if (matchesPendingRequest) {
          pendingRequest.resolve({
            data: data ?? '',
            cols: info?.cols ?? 80,
            rows: info?.rows ?? 24,
            seq: info?.seq,
            source: info?.source,
            pendingEscapeTailAnsi: info?.pendingEscapeTailAnsi
          })
          clearPendingSnapshotRequest(stream)
        } else if (target === 'initial') {
          stream.callbacks.onSnapshot(data ?? '', {
            pendingEscapeTailAnsi: info?.pendingEscapeTailAnsi
          })
        } else if (target === 'recovery') {
          // Why: a server-pushed recovery snapshot replaces terminal state
          // mid-session; clear the screen and scrollback before applying it.
          // An empty snapshot is still applied so stale dropped output does
          // not linger on a terminal the model says is blank.
          stream.callbacks.onSnapshot(`\x1b[2J\x1b[3J\x1b[H${data ?? ''}`, {
            pendingEscapeTailAnsi: info?.pendingEscapeTailAnsi
          })
        }
      } else if (matchesPendingRequest) {
        pendingRequest.resolve(null)
        clearPendingSnapshotRequest(stream)
      }
      clearSnapshot(stream)
      if (target === 'initial') {
        clearResyncTimer(stream)
        stream.expectedSeq = typeof info?.seq === 'number' ? info.seq : undefined
        stream.commandProbeBaselineSeq = undefined
        stream.resyncInFlight = false
        stream.resyncPendingSend = false
        stream.initialSnapshotReceived = true
        stream.callbacks.onSubscribed?.()
      } else if (target === 'recovery') {
        // Why: only an applied recovery is authoritative; retaining the prior
        // high-water after a discarded snapshot keeps the gap detectable.
        if (snapshotApplied) {
          clearResyncTimer(stream)
          stream.expectedSeq = typeof info?.seq === 'number' ? info.seq : undefined
          stream.commandProbeBaselineSeq = undefined
          stream.recoverySnapshotSeq = typeof info?.seq === 'number' ? info.seq : undefined
          stream.resyncAttempts = 0
          stream.resyncInFlight = false
          stream.resyncPendingSend = false
        } else if (stream.resyncInFlight) {
          multiplexer.scheduleResyncRetry(stream)
        } else {
          // Why: a discarded server-pushed recovery leaves dropped output
          // unrepresented; pull a fresh snapshot now instead of waiting for
          // the next chunk to expose the gap.
          multiplexer.requestResyncSnapshot(stream)
        }
      } else {
        multiplexer.sendDeferredResyncSnapshot(stream)
      }
      return
    }
    if (frame.opcode === TerminalStreamOpcode.Error) {
      const message = decodeTerminalStreamText(frame.payload)
      if (message === TERMINAL_MULTIPLEX_STREAM_LIMIT_ERROR) {
        stream.capacityRejected = true
        return
      }
      clearSnapshot(stream)
      const pendingSnapshotRequest = stream.pendingSnapshotRequest
      if (pendingSnapshotRequest) {
        clearPendingSnapshotRequest(stream)
        pendingSnapshotRequest.reject(new Error(message))
        multiplexer.sendDeferredResyncSnapshot(stream)
        return
      }
      // Why: a failed resync must re-open the live path or output stalls forever.
      clearResyncTimer(stream)
      stream.resyncInFlight = false
      stream.resyncPendingSend = false
      stream.callbacks.onError?.(message)
    }
  }

  // Why: Output `seq` is the UTF-16 high-water at the end of a chunk, so a chunk
  // that begins after the last high-water (startSeq > expectedSeq) means the
  // server dropped intervening frames under backpressure. Only flag a gap when
  // both offsets are known, and never on the first seq (nothing to compare to).

export function detectRemoteTerminalOutputGap(multiplexer: RemoteRuntimeTerminalMultiplexer,
    stream: RemoteRuntimeMultiplexedTerminalState,
    seq: number | undefined,
    rawLength: number
  ): boolean {
    if (typeof seq !== 'number' || typeof stream.expectedSeq !== 'number') {
      return false
    }
    const startSeq = seq - rawLength
    return startSeq > stream.expectedSeq
  }

  // Why: on a detected gap, discard the corrupt tail and pull a fresh
  // authoritative snapshot. The request carries no requestId so the server
  // reply renders through the initial-snapshot path (full reset), self-healing
  // without surfacing an error to the user.

