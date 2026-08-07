import { HIDDEN_OUTPUT_RESTORE_PENDING_CHARS } from './pty-connection-runtime-state'

export type HiddenRestorePendingLiveChunk = {
  data: string
  seq?: number
  rawLength?: number
}

type HiddenRestorePendingLiveControllerOptions = {
  maxChars?: number
}

type HiddenRestorePendingLiveDrainOptions = {
  onChunk: (chunk: HiddenRestorePendingLiveChunk, data: string) => void
  onDiscarded: (chunk: HiddenRestorePendingLiveChunk) => void
}

export function getHiddenRestorePendingLiveChunkDataAfterSnapshot(
  chunk: HiddenRestorePendingLiveChunk,
  snapshotSeq: number | undefined
): string | null {
  if (typeof snapshotSeq !== 'number' || typeof chunk.seq !== 'number') {
    return chunk.data
  }
  const rawLength = chunk.rawLength ?? chunk.data.length
  const startSeq = chunk.seq - rawLength
  if (snapshotSeq >= chunk.seq) {
    return ''
  }
  if (snapshotSeq <= startSeq) {
    return chunk.data
  }
  const offset = snapshotSeq - startSeq
  if (rawLength !== chunk.data.length) {
    return null
  }
  return chunk.data.slice(offset)
}

export function createPtyConnectionHiddenRestorePendingLiveController(
  options: HiddenRestorePendingLiveControllerOptions = {}
) {
  const maxChars = options.maxChars ?? HIDDEN_OUTPUT_RESTORE_PENDING_CHARS
  let chunks: HiddenRestorePendingLiveChunk[] = []
  let chars = 0
  let overflow = false

  return {
    enqueue(
      chunk: HiddenRestorePendingLiveChunk
    ): { kind: 'queued' } | { kind: 'discarded'; chunks: HiddenRestorePendingLiveChunk[] } {
      if (overflow) {
        return { kind: 'discarded', chunks: [chunk] }
      }
      if (chars + chunk.data.length > maxChars) {
        const discarded = [...chunks, chunk]
        chunks = []
        chars = 0
        overflow = true
        return { kind: 'discarded', chunks: discarded }
      }
      chunks.push(chunk)
      chars += chunk.data.length
      return { kind: 'queued' }
    },
    hasPending(): boolean {
      return overflow || chunks.length > 0
    },
    hasQueuedChunks(): boolean {
      return chunks.length > 0
    },
    drainAfterSnapshot(
      snapshotSeq: number | undefined,
      drainOptions: HiddenRestorePendingLiveDrainOptions
    ): 'drained' | 'overflow' | 'refetch' {
      if (overflow) {
        overflow = false
        for (const discarded of chunks) {
          drainOptions.onDiscarded(discarded)
        }
        chunks = []
        chars = 0
        return 'overflow'
      }
      while (chunks.length > 0) {
        const batch = chunks
        chunks = []
        chars = 0
        for (const [index, chunk] of batch.entries()) {
          const data = getHiddenRestorePendingLiveChunkDataAfterSnapshot(chunk, snapshotSeq)
          if (data === null) {
            for (const discarded of batch.slice(index)) {
              drainOptions.onDiscarded(discarded)
            }
            for (const discarded of chunks) {
              drainOptions.onDiscarded(discarded)
            }
            chunks = []
            chars = 0
            return 'refetch'
          }
          drainOptions.onChunk(chunk, data)
        }
        if (overflow) {
          overflow = false
          for (const discarded of chunks) {
            drainOptions.onDiscarded(discarded)
          }
          chunks = []
          chars = 0
          return 'overflow'
        }
      }
      return 'drained'
    },
    takeForAbandonReplay(snapshotSeq: number | null): {
      chunks: HiddenRestorePendingLiveChunk[]
      data: string
      overflow: boolean
    } {
      const currentOverflow = overflow
      const currentChunks = currentOverflow ? [] : chunks.slice()
      chunks = []
      chars = 0
      overflow = false
      const data = currentOverflow
        ? ''
        : currentChunks
            .map((chunk) =>
              snapshotSeq === null
                ? chunk.data
                : (getHiddenRestorePendingLiveChunkDataAfterSnapshot(chunk, snapshotSeq) ??
                  chunk.data)
            )
            .join('')
      return { chunks: currentChunks, data, overflow: currentOverflow }
    },
    clear(): void {
      chunks = []
      chars = 0
      overflow = false
    }
  }
}
