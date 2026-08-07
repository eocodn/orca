import type { PtyDataMeta } from './pty-dispatcher'

export const REATTACH_LIVE_DATA_MAX_CHARS = 512 * 1024
const MAX_DEFERRED_REATTACH_LIVE_CHUNKS = 1_024

type DeferredLiveChunk = {
  data: string
  ptyId: string | null
  streamGeneration: number
  meta?: PtyDataMeta
  ackCredit?: () => void
}

type PtyConnectionReattachLiveDataControllerArgs = {
  getPtyId: () => string | null
  getStreamGeneration: () => number
  isDisposed: () => boolean
  takeDeliveryCredit: () => (() => void) | undefined
  deliverWithDeferredCredit: (credit: () => void, deliver: () => void) => void
  deliverData: (data: string, meta: PtyDataMeta | undefined, streamGeneration: number) => void
}

type ReattachLiveDataSettlement = {
  deliveredChunks: number
  ptyId: string | null
  streamGeneration: number
}

export function createPtyConnectionReattachLiveDataController({
  getPtyId,
  getStreamGeneration,
  isDisposed,
  takeDeliveryCredit,
  deliverWithDeferredCredit,
  deliverData
}: PtyConnectionReattachLiveDataControllerArgs) {
  let chunks: DeferredLiveChunk[] | null = null
  let bufferedChars = 0
  let deferralDepth = 0
  let owners = new Map<number, { failed: boolean }>()

  const releaseChunk = (chunk: DeferredLiveChunk): void => {
    chunk.ackCredit?.()
  }

  const releaseChunks = (pending: DeferredLiveChunk[] | null): void => {
    for (const chunk of pending ?? []) {
      releaseChunk(chunk)
    }
  }

  return {
    begin(ownerGeneration = getStreamGeneration()): void {
      deferralDepth += 1
      if (deferralDepth === 1) {
        chunks = []
        bufferedChars = 0
        owners = new Map()
      }
      if (!owners.has(ownerGeneration)) {
        owners.set(ownerGeneration, { failed: false })
      }
    },

    defer(data: string, meta?: PtyDataMeta, streamGeneration = getStreamGeneration()): boolean {
      if (chunks === null) {
        return false
      }

      // Why: a replacement stream must not inherit bytes or a gap marker from the replay owner it superseded.
      chunks = chunks.filter((chunk) => {
        const keep = chunk.streamGeneration === streamGeneration
        if (!keep) {
          releaseChunk(chunk)
        }
        return keep
      })
      bufferedChars = chunks.reduce((total, chunk) => total + chunk.data.length, 0)

      const oversized = data.length > REATTACH_LIVE_DATA_MAX_CHARS
      const deferredData = oversized ? data.slice(-REATTACH_LIVE_DATA_MAX_CHARS) : data
      const ackCredit = takeDeliveryCredit()
      chunks.push({
        data: deferredData,
        ptyId: getPtyId(),
        streamGeneration,
        ...(meta ? { meta } : {}),
        ...(ackCredit ? { ackCredit } : {})
      })
      bufferedChars += deferredData.length

      // Why: any cap drop creates an unmappable stream gap; snapshot recovery must replace the surviving tail.
      let dropped = oversized
      while (
        chunks.length > 1 &&
        (chunks.length > MAX_DEFERRED_REATTACH_LIVE_CHUNKS ||
          bufferedChars > REATTACH_LIVE_DATA_MAX_CHARS)
      ) {
        const removed = chunks.shift()
        bufferedChars -= removed?.data.length ?? 0
        if (removed) {
          releaseChunk(removed)
        }
        dropped = true
      }
      if (dropped && chunks[0]) {
        chunks[0].meta = { ...chunks[0].meta, droppedOutput: true }
      }
      return true
    },

    finish(
      deliver: boolean,
      acceptedGeneration = getStreamGeneration()
    ): ReattachLiveDataSettlement | null {
      if (deferralDepth <= 0) {
        return null
      }
      if (!deliver) {
        const owner = owners.get(acceptedGeneration)
        if (owner) {
          owner.failed = true
        }
      }
      deferralDepth -= 1
      if (deferralDepth > 0) {
        return null
      }

      const pending = chunks
      chunks = null
      bufferedChars = 0
      const ptyId = getPtyId()
      const streamGeneration = getStreamGeneration()
      const currentOwner = owners.get(streamGeneration)
      owners = new Map()
      if (isDisposed() || !pending) {
        releaseChunks(pending)
        return null
      }

      let deliveredChunks = 0
      for (const chunk of pending) {
        if (
          chunk.ptyId !== ptyId ||
          chunk.streamGeneration !== streamGeneration ||
          currentOwner?.failed === true
        ) {
          releaseChunk(chunk)
          continue
        }
        if (chunk.ackCredit) {
          deliverWithDeferredCredit(chunk.ackCredit, () =>
            deliverData(chunk.data, chunk.meta, chunk.streamGeneration)
          )
        } else {
          deliverData(chunk.data, chunk.meta, chunk.streamGeneration)
        }
        deliveredChunks += 1
      }
      return { deliveredChunks, ptyId, streamGeneration }
    },

    dispose(): void {
      releaseChunks(chunks)
      chunks = null
      bufferedChars = 0
      deferralDepth = 0
      owners = new Map()
    }
  }
}
