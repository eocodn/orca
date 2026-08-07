type RendererSequenceMeta = {
  seq?: number
  rawLength?: number
}

type PtyConnectionRendererSequenceControllerArgs = {
  getPtyId: () => string | null
  sliceDataAfterSequence: (
    data: string,
    meta: RendererSequenceMeta | undefined,
    sequence: number
  ) => string | null
}

export function createPtyConnectionRendererSequenceController({
  getPtyId,
  sliceDataAfterSequence
}: PtyConnectionRendererSequenceControllerArgs) {
  let orderedPtyId: string | null = null
  let orderedSeq: number | null = null
  let channelPtyId: string | null = null
  let channelSeq: number | null = null

  const clearOrdered = (): void => {
    orderedPtyId = null
    orderedSeq = null
  }

  return {
    recordOrdered(meta?: Pick<RendererSequenceMeta, 'seq'>): void {
      if (typeof meta?.seq !== 'number') {
        return
      }
      const ptyId = getPtyId()
      if (!ptyId) {
        return
      }
      if (orderedPtyId !== ptyId) {
        orderedPtyId = ptyId
        orderedSeq = meta.seq
        return
      }
      orderedSeq = Math.max(orderedSeq ?? 0, meta.seq)
    },
    observeChannel(meta: RendererSequenceMeta | undefined): void {
      if (typeof meta?.seq !== 'number') {
        return
      }
      const ptyId = getPtyId()
      if (!ptyId) {
        return
      }
      if (channelPtyId !== ptyId) {
        channelPtyId = ptyId
        channelSeq = meta.seq
        return
      }
      if (channelSeq !== null && meta.seq < channelSeq && orderedPtyId === ptyId) {
        // Why: FIFO regression means this PTY id revived with a restarted sequence domain.
        clearOrdered()
      }
      channelSeq = meta.seq
    },
    resetForPtyExit(exitedPtyId: string): void {
      if (orderedPtyId === exitedPtyId) {
        clearOrdered()
      }
      if (channelPtyId === exitedPtyId) {
        channelPtyId = null
        channelSeq = null
      }
    },
    getOrderedFrame(): { ptyId: string | null; seq: number | null } {
      return { ptyId: orderedPtyId, seq: orderedSeq }
    },
    getHiddenDataAfterOrdered(data: string, meta: RendererSequenceMeta | undefined): string | null {
      if (orderedPtyId === null || orderedSeq === null || getPtyId() !== orderedPtyId) {
        return data
      }
      return sliceDataAfterSequence(data, meta, orderedSeq)
    }
  }
}
