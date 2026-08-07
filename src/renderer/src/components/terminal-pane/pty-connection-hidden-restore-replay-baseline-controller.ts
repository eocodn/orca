type ReplayBaseline = {
  seq?: number
  pendingDeliveryStartSeq?: number
}

export function createPtyConnectionHiddenRestoreReplayBaselineController() {
  let baseline: ReplayBaseline | null = null

  return {
    begin(snapshot: ReplayBaseline): void {
      baseline =
        typeof snapshot.seq === 'number'
          ? {
              seq: snapshot.seq,
              ...(typeof snapshot.pendingDeliveryStartSeq === 'number'
                ? { pendingDeliveryStartSeq: snapshot.pendingDeliveryStartSeq }
                : {})
            }
          : null
    },
    take(): ReplayBaseline | null {
      const current = baseline
      baseline = null
      return current
    },
    clear(): void {
      baseline = null
    }
  }
}
