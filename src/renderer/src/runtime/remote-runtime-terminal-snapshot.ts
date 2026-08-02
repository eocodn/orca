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

export function requestRemoteTerminalResyncSnapshot(multiplexer: RemoteRuntimeTerminalMultiplexer, stream: RemoteRuntimeMultiplexedTerminalState): void {
    if (stream.resyncInFlight) {
      return
    }
    stream.resyncInFlight = true
    if (stream.pendingSnapshotRequest) {
      // Why: snapshot frame groups are not multiplexed; wait for the manual
      // snapshot to finish so its response cannot be mistaken for recovery.
      // Arm the watchdog now so a dispatch path that consumes the pending
      // request without re-dispatching cannot hold the gate shut forever.
      stream.resyncPendingSend = true
      multiplexer.startResyncTimer(stream)
      return
    }
    multiplexer.sendResyncSnapshot(stream)
  }

export function sendDeferredRemoteTerminalResyncSnapshot(multiplexer: RemoteRuntimeTerminalMultiplexer, stream: RemoteRuntimeMultiplexedTerminalState): void {
    if (!stream.resyncInFlight || !stream.resyncPendingSend || stream.pendingSnapshotRequest) {
      return
    }
    multiplexer.sendResyncSnapshot(stream)
  }


export function sendRemoteTerminalResyncSnapshot(multiplexer: RemoteRuntimeTerminalMultiplexer, stream: RemoteRuntimeMultiplexedTerminalState): void {
    stream.resyncPendingSend = false
    multiplexer.startResyncTimer(stream)
    const sent = multiplexer.sendFrame(
      stream.streamId,
      TerminalStreamOpcode.SnapshotRequest,
      encodeTerminalStreamJson({ scrollbackRows: undefined })
    )
    if (!sent) {
      // Transport is down; the reconnect path re-subscribes from scratch.
      clearResyncTimer(stream)
      stream.resyncInFlight = false
    }
  }

  // Why: keep the gate shut across the backoff — the post-gap tail is corrupt
  // either way — and heal even if the flood ends with no further output.

export function scheduleRemoteTerminalResyncRetry(multiplexer: RemoteRuntimeTerminalMultiplexer, stream: RemoteRuntimeMultiplexedTerminalState): void {
    stream.resyncAttempts += 1
    const delay = Math.min(
      REMOTE_TERMINAL_RESYNC_RETRY_MAX_MS,
      REMOTE_TERMINAL_RESYNC_RETRY_BASE_MS * 2 ** Math.min(stream.resyncAttempts - 1, 4)
    )
    clearResyncTimer(stream)
    const timer = setTimeout(() => {
      if (
        stream.resyncTimer !== timer ||
        multiplexer.streams.get(stream.streamId) !== stream ||
        !stream.resyncInFlight
      ) {
        return
      }
      stream.resyncTimer = null
      if (stream.pendingSnapshotRequest) {
        stream.resyncPendingSend = true
        multiplexer.startResyncTimer(stream)
        return
      }
      multiplexer.sendResyncSnapshot(stream)
    }, delay)
    if (typeof timer.unref === 'function') {
      timer.unref()
    }
    stream.resyncTimer = timer
  }


export function startRemoteTerminalResyncTimer(multiplexer: RemoteRuntimeTerminalMultiplexer, stream: RemoteRuntimeMultiplexedTerminalState): void {
    clearResyncTimer(stream)
    const timer = setTimeout(() => {
      if (
        stream.resyncTimer !== timer ||
        multiplexer.streams.get(stream.streamId) !== stream ||
        !stream.resyncInFlight
      ) {
        return
      }
      stream.resyncTimer = null
      stream.resyncInFlight = false
      stream.resyncPendingSend = false
    }, REMOTE_TERMINAL_RESYNC_TIMEOUT_MS)
    if (typeof timer.unref === 'function') {
      timer.unref()
    }
    stream.resyncTimer = timer
  }


export function requestRemoteTerminalSnapshot(multiplexer: RemoteRuntimeTerminalMultiplexer,
    stream: RemoteRuntimeMultiplexedTerminalState,
    opts?: { scrollbackRows?: number }
  ): Promise<{
    data: string
    cols: number
    rows: number
    seq?: number
    source?: 'headless' | 'renderer'
  } | null> {
    if (multiplexer.streams.get(stream.streamId) !== stream || !multiplexer.ready || !multiplexer.subscription) {
      return Promise.resolve(null)
    }
    // Recovery uses an untagged snapshot frame group; callers can retry after
    // it completes instead of racing another request onto the same frame lane.
    if (stream.resyncInFlight) {
      return Promise.resolve(null)
    }
    if (stream.pendingSnapshotRequest) {
      return Promise.reject(new Error('Remote terminal snapshot already in flight.'))
    }
    const requestId = multiplexer.allocateSnapshotRequestId()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (stream.pendingSnapshotRequest?.timer === timer) {
          clearPendingSnapshotRequest(stream)
          reject(new Error('Remote terminal snapshot timed out.'))
          multiplexer.recoverStalledStream(stream)
        }
      }, REMOTE_TERMINAL_SNAPSHOT_REQUEST_TIMEOUT_MS)
      if (typeof timer.unref === 'function') {
        timer.unref()
      }
      stream.pendingSnapshotRequest = { requestId, resolve, reject, timer }
      if (
        !multiplexer.sendFrame(
          stream.streamId,
          TerminalStreamOpcode.SnapshotRequest,
          encodeTerminalStreamJson({ requestId, scrollbackRows: opts?.scrollbackRows })
        )
      ) {
        clearPendingSnapshotRequest(stream)
        resolve(null)
      }
    })
  }


export function allocateRemoteTerminalSnapshotRequestId(multiplexer: RemoteRuntimeTerminalMultiplexer, ): number {
    const id = multiplexer.nextSnapshotRequestId
    multiplexer.nextSnapshotRequestId =
      multiplexer.nextSnapshotRequestId >= 0x7fffffff ? 1 : multiplexer.nextSnapshotRequestId + 1
    return id
  }
