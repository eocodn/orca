import type { BrowserScreencastFrame } from './browser-screencast-protocol'
import { decodeBrowserScreencastFrame } from './browser-screencast-protocol'
import { handleTerminalBinaryFrame, type TerminalSnapshotState } from './rpc-client-terminal-binary-frame'
import { markRpcDeliveryUnknown } from './rpc-delivery-ambiguity'
import type {
  PendingRequest,
  StreamRequest,
  SubscriptionDisposeOptions
} from './rpc-client-connection-contracts'

type StreamState = {
  activeBrowserScreencastRequestId: string | null
  pendingBrowserScreencastRequestId: string | null
}
type Dependencies = {
  pending: Map<string, PendingRequest>
  streamListeners: Map<string, StreamRequest>
  terminalStreamListeners: Map<number, (result: unknown) => void>
  terminalStreamIdsByRequest: Map<string, Set<number>>
  terminalSnapshots: Map<number, TerminalSnapshotState>
  streamState: StreamState
  recordInboundTraffic: () => void
  sendServerSubscriptionUnsubscribe: (stream: StreamRequest) => void
}
export function createRpcStreamRouting(deps: Dependencies) {
  const {
    pending,
    streamListeners,
    terminalStreamListeners,
    terminalStreamIdsByRequest,
    terminalSnapshots,
    streamState,
    sendServerSubscriptionUnsubscribe,
    recordInboundTraffic
  } = deps
  function rejectAllPending(reason: string, options?: { deliveryUnknown?: boolean }) {
    // Why: pending entries only exist after a successful socket write, so a close
    // here means the host may have processed them — mark the ambiguity for callers.
    const error = options?.deliveryUnknown
      ? markRpcDeliveryUnknown(new Error(reason))
      : new Error(reason)
    for (const [id, req] of pending) {
      pending.delete(id)
      queueMicrotask(() => req.reject(error))
    }
  }

  function removeStreamListener(id: string): void {
    const stream = streamListeners.get(id)
    streamListeners.delete(id)
    if (streamState.activeBrowserScreencastRequestId === id) {
      streamState.activeBrowserScreencastRequestId = null
    }
    if (streamState.pendingBrowserScreencastRequestId === id) {
      streamState.pendingBrowserScreencastRequestId = null
    }
    const terminalStreamIds = terminalStreamIdsByRequest.get(id)
    if (terminalStreamIds) {
      for (const streamId of terminalStreamIds) {
        terminalStreamListeners.delete(streamId)
        terminalSnapshots.delete(streamId)
      }
      terminalStreamIdsByRequest.delete(id)
    }
    if (stream?.method === 'browser.screencast') {
      stream.cancelled = true
    }
  }

  function markStreamsForReplay(): void {
    for (const [id, stream] of streamListeners) {
      stream.sent = false
      stream.subscriptionId = undefined
      resetTerminalStreamRoutingForRequest(id)
    }
  }

  function resetTerminalStreamRoutingForRequest(id: string): void {
    const terminalStreamIds = terminalStreamIdsByRequest.get(id)
    if (!terminalStreamIds) {
      return
    }
    for (const streamId of terminalStreamIds) {
      terminalStreamListeners.delete(streamId)
      terminalSnapshots.delete(streamId)
    }
    terminalStreamIdsByRequest.delete(id)
  }

  function emitStreamError(stream: StreamRequest, message: string, error?: unknown): void {
    if (stream.cancelled) {
      return
    }
    stream.listener({ type: 'error', message, error })
  }

  function disposeBrowserScreencastStream(
    id: string,
    options?: SubscriptionDisposeOptions
  ): void {
    const stream = streamListeners.get(id)
    if (!stream || stream.method !== 'browser.screencast') {
      return
    }
    stream.cancelled = true
    if (streamState.activeBrowserScreencastRequestId === id) {
      streamState.activeBrowserScreencastRequestId = null
    }
    if (streamState.pendingBrowserScreencastRequestId === id) {
      streamState.pendingBrowserScreencastRequestId = null
    }
    disposeServerSubscriptionStream(id, stream, options)
  }

  function disposeRuntimeClientEventsStream(
    id: string,
    options?: SubscriptionDisposeOptions
  ): void {
    const stream = streamListeners.get(id)
    if (!stream || stream.method !== 'runtime.clientEvents.subscribe') {
      return
    }
    disposeServerSubscriptionStream(id, stream, options)
  }

  function disposeServerSubscriptionStream(
    id: string,
    stream: StreamRequest,
    options?: SubscriptionDisposeOptions
  ): void {
    stream.cancelled = true
    if (options?.suppressServerUnsubscribe) {
      removeStreamListener(id)
      return
    }
    if (stream.subscriptionId) {
      sendServerSubscriptionUnsubscribe(stream)
      removeStreamListener(id)
      return
    }
    // Why: a sent stream may still reply `ready`; keep the tombstone to unsubscribe it (queued streams never reached the desktop).
    if (!stream.sent) {
      removeStreamListener(id)
    }
  }

  function recordValidatedInboundTraffic(): void {
    recordInboundTraffic()
  }

  function handleBinaryFrame(bytes: Uint8Array): void {
    const browserFrame = decodeBrowserScreencastFrame(bytes)
    if (browserFrame) {
      recordValidatedInboundTraffic()
      handleBrowserBinaryFrame(browserFrame)
      return
    }
    handleTerminalBinaryFrame(bytes, {
      terminalSnapshots,
      getListener: (streamId) => terminalStreamListeners.get(streamId),
      recordValidatedInboundTraffic
    })
  }

  function handleBrowserBinaryFrame(frame: BrowserScreencastFrame) {
    if (!streamState.activeBrowserScreencastRequestId) {
      return
    }
    const stream = streamListeners.get(streamState.activeBrowserScreencastRequestId)
    if (!stream || stream.cancelled || stream.method !== 'browser.screencast') {
      return
    }
    stream.onBinaryFrame?.(frame)
  }


  return {
    rejectAllPending,
    removeStreamListener,
    markStreamsForReplay,
    resetTerminalStreamRoutingForRequest,
    emitStreamError,
    disposeBrowserScreencastStream,
    disposeRuntimeClientEventsStream,
    disposeServerSubscriptionStream,
    recordValidatedInboundTraffic,
    handleBinaryFrame,
    handleBrowserBinaryFrame
  }
}
