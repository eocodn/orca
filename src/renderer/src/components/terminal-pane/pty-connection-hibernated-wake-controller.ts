type HibernatedWakeTarget<TRecord extends object> = {
  ptyId: string
  record: TRecord
}

type PtyConnectionHibernatedWakeControllerArgs<TRecord extends object> = {
  isDisposed: () => boolean
  isCurrentOwner: () => boolean
  getCurrentRecord: () => TRecord | null
  getCurrentPtyId: () => string | null
  getClaimKey: (record: TRecord) => string
}

export function createPtyConnectionHibernatedWakeController<TRecord extends object>({
  isDisposed,
  isCurrentOwner,
  getCurrentRecord,
  getCurrentPtyId,
  getClaimKey
}: PtyConnectionHibernatedWakeControllerArgs<TRecord>) {
  let armedTarget: HibernatedWakeTarget<TRecord> | null = null
  let pendingTarget: HibernatedWakeTarget<TRecord> | null = null
  let inFlightClaimKey: string | null = null
  let wake: (() => Promise<string | null>) | null = null

  const clearTargets = (): void => {
    armedTarget = null
    pendingTarget = null
  }

  return {
    setWake(nextWake: () => Promise<string | null>): void {
      wake = nextWake
    },
    hasArmedTarget(): boolean {
      return armedTarget !== null
    },
    arm(target: HibernatedWakeTarget<TRecord>): { pendingMatches: boolean } {
      armedTarget = target
      // A mobile wake can race the suppressed exit; preserve only the exact record/PTY edge.
      const pendingMatches =
        pendingTarget?.ptyId === target.ptyId && pendingTarget.record === target.record
      if (pendingTarget && !pendingMatches) {
        pendingTarget = null
      }
      return { pendingMatches }
    },
    clearPendingForPty(ptyId: string): void {
      if (pendingTarget?.ptyId === ptyId) {
        pendingTarget = null
      }
    },
    claimInFlight(claimedProviderSessions?: Set<string>): string | null {
      if (!inFlightClaimKey || claimedProviderSessions?.has(inFlightClaimKey)) {
        return null
      }
      claimedProviderSessions?.add(inFlightClaimKey)
      return inFlightClaimKey
    },
    latchPending(
      target: HibernatedWakeTarget<TRecord>,
      claimedProviderSessions?: Set<string>
    ): string | null {
      const claimKey = getClaimKey(target.record)
      if (claimedProviderSessions?.has(claimKey)) {
        return null
      }
      claimedProviderSessions?.add(claimKey)
      pendingTarget = target
      return claimKey
    },
    consume(claimedProviderSessions?: Set<string>): string | null {
      const target = armedTarget
      if (!target || isDisposed() || !isCurrentOwner()) {
        return null
      }
      if (getCurrentRecord() !== target.record) {
        clearTargets()
        return null
      }
      const currentPtyId = getCurrentPtyId()
      if (currentPtyId !== null && currentPtyId !== target.ptyId) {
        clearTargets()
        return null
      }
      if (!wake) {
        return null
      }
      const claimKey = getClaimKey(target.record)
      if (claimedProviderSessions?.has(claimKey)) {
        return null
      }
      // Claim before async wake so sibling panes cannot resume the same provider session.
      claimedProviderSessions?.add(claimKey)
      clearTargets()
      inFlightClaimKey = claimKey
      void wake()
        .then((spawnedPtyId) => {
          if (!spawnedPtyId) {
            // A transient spawn failure leaves the exact passive session retryable.
            armedTarget = target
          }
        })
        .finally(() => {
          if (inFlightClaimKey === claimKey) {
            inFlightClaimKey = null
          }
        })
      return claimKey
    }
  }
}
