import type { PendingPtyData } from './pty-pending-data-drain-queue'
import { preservePtyIncarnationId } from './pty-ipc-runtime-renderer-delivery-coalescing'

export type PtyPendingDataChunk = {
  chunk: string
  remainder?: PendingPtyData
}

export function splitPtyPendingDataChunk(
  pending: PendingPtyData,
  chunkChars: number
): PtyPendingDataChunk {
  if (chunkChars <= 0) {
    throw new RangeError('PTY delivery chunk size must be positive')
  }
  if (pending.transformed === true || pending.data.length <= chunkChars) {
    return { chunk: pending.data }
  }

  const chunk = pending.data.slice(0, chunkChars)
  const remainder = preservePtyIncarnationId(
    { data: pending.data.slice(chunkChars) },
    pending.incarnationId
  )
  if (typeof pending.startSeq === 'number') {
    remainder.startSeq = pending.startSeq + chunk.length
  }
  if (pending.containsBackgroundOutput === true) {
    remainder.containsBackgroundOutput = true
  }
  if (pending.projectionAdmissionIds) {
    remainder.projectionAdmissionIds = pending.projectionAdmissionIds
  }
  if (pending.projectionAdmissionsTransferred) {
    remainder.projectionAdmissionsTransferred = true
  }
  return { chunk, remainder }
}
