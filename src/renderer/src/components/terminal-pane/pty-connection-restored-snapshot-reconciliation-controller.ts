import type { PtyDataMeta } from './pty-dispatcher'

type RestoredSnapshotBaseline = {
  seq?: number
  pendingDeliveryStartSeq?: number
}

export type RestoredSnapshotReconciliation =
  | { action: 'write'; data: string; meta: PtyDataMeta | undefined }
  | { action: 'drop-duplicate' }
  | { action: 'force-fresh-restore' }

export function createPtyConnectionRestoredSnapshotReconciliationController() {
  let baselineSeq: number | null = null
  let baselinePtyId: string | null = null
  let expectedStartSeq: number | null = null
  let deliveryWindowStartSeq: number | null = null

  const clear = (): void => {
    baselineSeq = null
    baselinePtyId = null
    expectedStartSeq = null
    deliveryWindowStartSeq = null
  }

  return {
    setBaseline(ptyId: string, snapshot: RestoredSnapshotBaseline): void {
      if (typeof snapshot.seq !== 'number') {
        clear()
        return
      }
      const windowStartSeq =
        typeof snapshot.pendingDeliveryStartSeq === 'number'
          ? Math.min(snapshot.pendingDeliveryStartSeq, snapshot.seq)
          : null
      if (windowStartSeq !== null && windowStartSeq >= snapshot.seq) {
        clear()
        return
      }
      baselineSeq = snapshot.seq
      baselinePtyId = ptyId
      expectedStartSeq = snapshot.seq
      deliveryWindowStartSeq = windowStartSeq
    },
    clear,
    getBaselinePtyId(): string | null {
      return baselinePtyId
    },
    advanceExpectedSeq(seq: number): void {
      if (expectedStartSeq !== null) {
        expectedStartSeq = Math.max(expectedStartSeq, seq)
      }
    },
    reconcile(
      currentPtyId: string | null,
      data: string,
      meta: PtyDataMeta | undefined
    ): RestoredSnapshotReconciliation {
      if (baselineSeq === null) {
        return { action: 'write', data, meta }
      }
      if (currentPtyId !== baselinePtyId) {
        clear()
        return { action: 'write', data, meta }
      }
      if (typeof meta?.seq !== 'number') {
        return { action: 'write', data, meta }
      }
      if (deliveryWindowStartSeq !== null && meta.seq <= deliveryWindowStartSeq) {
        clear()
        return { action: 'write', data, meta }
      }
      const rawLength = meta.rawLength ?? data.length
      const startSeq = meta.seq - rawLength
      const expectedSeq = expectedStartSeq
      expectedStartSeq = Math.max(expectedSeq ?? meta.seq, meta.seq)
      if (expectedSeq !== null && startSeq > expectedSeq) {
        return { action: 'force-fresh-restore' }
      }
      if (meta.seq <= baselineSeq) {
        return { action: 'drop-duplicate' }
      }
      if (startSeq >= baselineSeq) {
        return { action: 'write', data, meta }
      }
      if (rawLength !== data.length) {
        return { action: 'force-fresh-restore' }
      }
      const sliced = data.slice(baselineSeq - startSeq)
      return {
        action: 'write',
        data: sliced,
        meta: { ...meta, rawLength: sliced.length }
      }
    }
  }
}
