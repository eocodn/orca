import { HIDDEN_OUTPUT_RESTORE_PENDING_CHARS } from './pty-connection-runtime-state'

export type HiddenRestorePendingLiveChunk = {
  data: string
  seq?: number
  rawLength?: number
}

type HiddenRestorePendingLiveControllerOptions = {
  maxChars?: number
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
    takeBatch(): HiddenRestorePendingLiveChunk[] {
      const batch = chunks
      chunks = []
      chars = 0
      return batch
    },
    takeOverflow(): boolean {
      const current = overflow
      overflow = false
      return current
    },
    discardAll(): HiddenRestorePendingLiveChunk[] {
      const discarded = chunks
      chunks = []
      chars = 0
      return discarded
    },
    takeForAbandon(): { chunks: HiddenRestorePendingLiveChunk[]; overflow: boolean } {
      const currentOverflow = overflow
      const currentChunks = currentOverflow ? [] : chunks.slice()
      chunks = []
      chars = 0
      overflow = false
      return { chunks: currentChunks, overflow: currentOverflow }
    },
    clear(): void {
      chunks = []
      chars = 0
      overflow = false
    }
  }
}
