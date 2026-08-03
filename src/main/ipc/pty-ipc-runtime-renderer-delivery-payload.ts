import type { PtyDataPayload } from './pty-ipc-runtime-renderer-delivery-context'
import { ptyRuntimeState } from './pty-ipc-runtime-state'

export function makePtyDataPayload(
  id: string,
  data: string,
  startSeq: number | undefined,
  containsBackgroundOutput: boolean | undefined,
  rawLength = data.length,
  transformed = false,
  incarnationId?: string
): PtyDataPayload {
  const resolvedIncarnationId = incarnationId ?? ptyRuntimeState.ptyIncarnationById.get(id)
  const payload: PtyDataPayload = {
    id,
    ...(resolvedIncarnationId ? { incarnationId: resolvedIncarnationId } : {}),
    data
  }
  if (typeof startSeq === 'number') {
    payload.seq = startSeq + rawLength
  }
  if (typeof startSeq === 'number' || rawLength !== data.length || transformed) {
    payload.rawLength = rawLength
  }
  if (transformed) {
    payload.transformed = true
  }
  if (containsBackgroundOutput === true) {
    payload.background = true
  }
  return payload
}

export function getPtyPayloadCharCount(payload: { data: string; rawLength?: number }): number {
  return Math.max(0, payload.rawLength ?? payload.data.length)
}
