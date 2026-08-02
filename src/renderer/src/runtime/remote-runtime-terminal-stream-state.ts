import { decodeTerminalStreamJson } from '../../../shared/terminal-stream-protocol'
import type {
  RemoteRuntimeMultiplexedTerminalState,
  RemoteRuntimeSnapshotInfo
} from './remote-runtime-terminal-stream'

export function concatBytes(chunks: Uint8Array<ArrayBufferLike>[]): Uint8Array<ArrayBufferLike> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}
export function clearSnapshot(stream: RemoteRuntimeMultiplexedTerminalState): void {
  stream.snapshotChunks = []
  stream.snapshotBytes = 0
  stream.snapshotOverflowed = false
  stream.snapshotTarget = 'initial'
  stream.snapshotInfo = null
}

export function clearAckFlushTimer(stream: RemoteRuntimeMultiplexedTerminalState): void {
  if (stream.ackFlushTimer !== null) {
    clearTimeout(stream.ackFlushTimer)
    stream.ackFlushTimer = null
  }
}

export function discardOutputAcknowledgements(stream: RemoteRuntimeMultiplexedTerminalState): void {
  clearAckFlushTimer(stream)
  stream.pendingAckBytes = 0
  stream.heldAckBytes = 0
}

export function clearPendingSnapshotRequest(stream: RemoteRuntimeMultiplexedTerminalState): void {
  const request = stream.pendingSnapshotRequest
  stream.pendingSnapshotRequest = null
  if (request) {
    clearTimeout(request.timer)
  }
}

export function clearResyncTimer(stream: RemoteRuntimeMultiplexedTerminalState): void {
  const timer = stream.resyncTimer
  stream.resyncTimer = null
  if (timer) {
    clearTimeout(timer)
  }
}

export function rejectPendingSnapshotRequest(
  stream: RemoteRuntimeMultiplexedTerminalState,
  message: string
): void {
  const request = stream.pendingSnapshotRequest
  if (!request) {
    return
  }
  clearPendingSnapshotRequest(stream)
  request.reject(new Error(message))
}

export function decodeSnapshotInfo(
  payload: Uint8Array<ArrayBufferLike>
): RemoteRuntimeSnapshotInfo | null {
  const raw = decodeTerminalStreamJson<{
    cols?: unknown
    rows?: unknown
    seq?: unknown
    source?: unknown
    requestId?: unknown
    truncated?: unknown
    pendingEscapeTailAnsi?: unknown
  }>(payload)
  if (!raw) {
    return null
  }
  return {
    cols: typeof raw.cols === 'number' ? raw.cols : undefined,
    rows: typeof raw.rows === 'number' ? raw.rows : undefined,
    seq: typeof raw.seq === 'number' ? raw.seq : undefined,
    source: raw.source === 'headless' || raw.source === 'renderer' ? raw.source : undefined,
    requestId: typeof raw.requestId === 'number' ? raw.requestId : undefined,
    truncated: raw.truncated === true,
    pendingEscapeTailAnsi:
      typeof raw.pendingEscapeTailAnsi === 'string' ? raw.pendingEscapeTailAnsi : undefined
  }
}

export function isTerminalDriverState(
  value: unknown
): value is { kind: 'idle' } | { kind: 'desktop' } | { kind: 'mobile'; clientId: string } {
  if (!value || typeof value !== 'object' || !('kind' in value)) {
    return false
  }
  const driver = value as { kind?: unknown; clientId?: unknown }
  return (
    driver.kind === 'idle' ||
    driver.kind === 'desktop' ||
    (driver.kind === 'mobile' && typeof driver.clientId === 'string')
  )
}
