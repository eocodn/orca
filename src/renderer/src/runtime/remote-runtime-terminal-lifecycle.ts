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

export function sendRemoteTerminalFrame(multiplexer: RemoteRuntimeTerminalMultiplexer,
    streamId: number,
    opcode: TerminalStreamOpcode,
    payload: Uint8Array<ArrayBufferLike> = new Uint8Array()
  ): boolean {
    if (!multiplexer.matchesCurrentEnvironmentRevision() || !multiplexer.ready || !multiplexer.subscription) {
      return false
    }
    try {
      multiplexer.subscription.sendBinary(encodeTerminalStreamFrame({ opcode, streamId, seq: 0, payload }))
      return true
    } catch (error) {
      multiplexer.handleClose(
        error instanceof Error ? error.message : 'Remote terminal transport write failed.'
      )
      return false
    }
  }


export function resolveRemoteTerminalReadyIfConnected(multiplexer: RemoteRuntimeTerminalMultiplexer, ): void {
    if (!multiplexer.ready || !multiplexer.subscription) {
      return
    }
    multiplexer.readyResolver?.()
    multiplexer.readyResolver = null
    multiplexer.readyRejecter = null
  }


export function failRemoteTerminalConnection(multiplexer: RemoteRuntimeTerminalMultiplexer, error: Error): void {
    multiplexer.readyRejecter?.(error)
    multiplexer.readyResolver = null
    multiplexer.readyRejecter = null
    for (const stream of multiplexer.streams.values()) {
      // Why: a stream still awaiting ensureConnected receives this failure through its rejected promise.
      if (stream.subscriptionRequested) {
        stream.callbacks.onError?.(error.message)
      }
    }
    multiplexer.handleClose(undefined, false)
  }


export function handleRemoteTerminalClose(multiplexer: RemoteRuntimeTerminalMultiplexer, message?: string, recoverable = true): void {
    const streams = Array.from(multiplexer.streams.values())
    const closingSubscription = multiplexer.subscription
    multiplexer.ready = false
    multiplexer.connectPromise = null
    multiplexer.readyRejecter?.(new Error(message ?? 'Remote runtime connection closed.'))
    multiplexer.readyResolver = null
    multiplexer.readyRejecter = null
    multiplexer.subscription = null
    closingSubscription?.unsubscribe()
    multiplexer.streams.clear()
    // Why: close callbacks may resubscribe synchronously; release first so every replacement shares the new environment multiplexer.
    multiplexer.releaseIfCurrent(multiplexer.environmentId, this)
    for (const stream of streams) {
      discardOutputAcknowledgements(stream)
      stream.watchdog.dispose()
      clearSnapshot(stream)
      clearResyncTimer(stream)
      rejectPendingSnapshotRequest(stream, message ?? 'Remote runtime connection closed.')
      const canHandleClose = Boolean(stream.callbacks.onTransportClose)
      stream.callbacks.onTransportClose?.({ recoverable })
      if (message && !canHandleClose) {
        stream.callbacks.onError?.(message)
      }
    }
  }


export function closeRemoteTerminalIfIdle(multiplexer: RemoteRuntimeTerminalMultiplexer, ): void {
    if (multiplexer.streams.size > 0) {
      return
    }
    multiplexer.subscription?.unsubscribe()
    multiplexer.subscription = null
    multiplexer.connectPromise = null
    multiplexer.ready = false
    multiplexer.releaseIfCurrent(multiplexer.environmentId, this)
  }

