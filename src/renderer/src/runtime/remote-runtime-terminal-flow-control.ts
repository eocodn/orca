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

export function acknowledgeRemoteTerminalOutput(multiplexer: RemoteRuntimeTerminalMultiplexer, stream: RemoteRuntimeMultiplexedTerminalState, bytes: number): boolean {
    if (stream.acknowledgeOutputSourceRanges && stream.streamGeneration) {
      const ackedEndByte = stream.sourceAckedEndByte + bytes
      const sent = multiplexer.sendFrame(
        stream.streamId,
        TerminalStreamOpcode.Ack,
        encodeTerminalStreamJson({
          streamGeneration: stream.streamGeneration,
          ackedEndByte
        })
      )
      if (sent) {
        stream.sourceAckedEndByte = ackedEndByte
      }
      return sent
    }
    return multiplexer.sendFrame(
      stream.streamId,
      TerminalStreamOpcode.Ack,
      encodeTerminalStreamJson({ bytes })
    )
  }


export function sendRemoteTerminalInput(multiplexer: RemoteRuntimeTerminalMultiplexer, stream: RemoteRuntimeMultiplexedTerminalState, text: string): boolean {
    const sent = multiplexer.sendFrame(
      stream.streamId,
      TerminalStreamOpcode.Input,
      encodeTerminalStreamText(text)
    )
    if (sent && !stream.outputPaused) {
      stream.watchdog.recordCommandInput(text)
    }
    return sent
  }


export function setRemoteTerminalOutputPaused(multiplexer: RemoteRuntimeTerminalMultiplexer, stream: RemoteRuntimeMultiplexedTerminalState, paused: boolean): boolean {
    if (!stream.supportsOutputPause || multiplexer.streams.get(stream.streamId) !== stream) {
      return false
    }
    if (stream.outputPaused === paused) {
      return true
    }
    const sent = multiplexer.sendFrame(
      stream.streamId,
      TerminalStreamOpcode.SetOutputPaused,
      encodeTerminalStreamJson({ paused })
    )
    if (sent) {
      stream.outputPaused = paused
    }
    return sent
  }


export function probeRemoteTerminalCommandResponse(multiplexer: RemoteRuntimeTerminalMultiplexer, stream: RemoteRuntimeMultiplexedTerminalState): void {
    void multiplexer.requestSnapshot(stream).then(
      (snapshot) => {
        if (multiplexer.streams.get(stream.streamId) !== stream) {
          return
        }
        if (typeof snapshot?.seq === 'number' && typeof stream.expectedSeq !== 'number') {
          if (
            typeof stream.commandProbeBaselineSeq === 'number' &&
            snapshot.seq > stream.commandProbeBaselineSeq
          ) {
            recordRendererCrashBreadcrumb('remote_terminal_stream_stall_probe_baseline_advanced', {
              baselineSeq: stream.commandProbeBaselineSeq,
              environmentId: multiplexer.environmentId,
              snapshotSeq: snapshot.seq,
              streamId: stream.streamId,
              terminal: stream.terminal
            })
            multiplexer.recoverStalledStream(stream)
            return
          }
          stream.commandProbeBaselineSeq ??= snapshot.seq
        } else if (
          typeof snapshot?.seq === 'number' &&
          typeof stream.expectedSeq === 'number' &&
          snapshot.seq > stream.expectedSeq
        ) {
          recordRendererCrashBreadcrumb('remote_terminal_stream_stall_probe_detected_gap', {
            deliveredSeq: stream.expectedSeq,
            environmentId: multiplexer.environmentId,
            snapshotSeq: snapshot.seq,
            streamId: stream.streamId,
            terminal: stream.terminal
          })
          multiplexer.recoverStalledStream(stream)
          return
        }
        stream.watchdog.completeCommandResponseProbe()
        recordRendererCrashBreadcrumb('remote_terminal_stream_stall_probe_succeeded', {
          deliveredSeq: stream.expectedSeq ?? null,
          environmentId: multiplexer.environmentId,
          probeBaselineSeq: stream.commandProbeBaselineSeq ?? null,
          snapshotSeq: snapshot?.seq ?? null,
          streamId: stream.streamId,
          terminal: stream.terminal
        })
      },
      () => {
        // Snapshot timeout owns recovery; an explicit host error already proves liveness.
        if (multiplexer.streams.get(stream.streamId) === stream) {
          stream.watchdog.completeCommandResponseProbe()
        }
      }
    )
  }


export function recoverRemoteTerminalStalledStream(multiplexer: RemoteRuntimeTerminalMultiplexer, stream: RemoteRuntimeMultiplexedTerminalState): void {
    if (multiplexer.streams.get(stream.streamId) !== stream) {
      return
    }
    stream.watchdog.dispose()
    discardOutputAcknowledgements(stream)
    clearSnapshot(stream)
    clearResyncTimer(stream)
    rejectPendingSnapshotRequest(stream, 'Remote terminal stream stopped responding.')
    multiplexer.streams.delete(stream.streamId)
    multiplexer.sendFrame(stream.streamId, TerminalStreamOpcode.Unsubscribe)
    if (stream.callbacks.onTransportClose) {
      stream.callbacks.onTransportClose({ recoverable: true })
    } else {
      stream.callbacks.onError?.('Remote terminal stream stopped responding.')
    }
    multiplexer.closeIfIdle()
  }


export function queueRemoteTerminalOutputAcknowledgement(multiplexer: RemoteRuntimeTerminalMultiplexer,
    stream: RemoteRuntimeMultiplexedTerminalState,
    bytes: number
  ): boolean {
    if (multiplexer.streams.get(stream.streamId) !== stream) {
      return true
    }
    stream.pendingAckBytes += bytes
    if (stream.pendingAckBytes >= TERMINAL_MULTIPLEX_ACK_BATCH_BYTES) {
      return multiplexer.flushOutputAcknowledgement(stream)
    }
    if (stream.ackFlushTimer === null) {
      stream.ackFlushTimer = setTimeout(() => {
        stream.ackFlushTimer = null
        multiplexer.flushOutputAcknowledgement(stream)
      }, TERMINAL_MULTIPLEX_ACK_FLUSH_MS)
    }
    return true
  }


export function flushRemoteTerminalOutputAcknowledgement(multiplexer: RemoteRuntimeTerminalMultiplexer, stream: RemoteRuntimeMultiplexedTerminalState): boolean {
    clearAckFlushTimer(stream)
    const bytes = stream.pendingAckBytes
    stream.pendingAckBytes = 0
    return bytes <= 0 || multiplexer.acknowledgeOutput(stream, bytes)
  }


  getStreamsForE2e(): Iterable<RemoteRuntimeMultiplexedTerminalState> {
    return multiplexer.streams.values()
  }


  releaseHeldAcksForE2e(): number {
    let released = 0
    for (const stream of multiplexer.streams.values()) {
      if (stream.heldAckBytes <= 0) {
        continue
      }
      const bytes = stream.heldAckBytes
      stream.heldAckBytes = 0
      if (multiplexer.queueOutputAcknowledgement(stream, bytes)) {
        released += bytes
      }
    }
    return released
  }


  sendInputForE2e(terminal: string, text: string): number {
    let sent = 0
    for (const stream of multiplexer.streams.values()) {
      if (stream.terminal === terminal && multiplexer.sendInput(stream, text)) {
        sent += 1
      }
    }
    return sent
  }

