import { type ExecutionHostId, type RuntimeMobileSessionTabsSnapshot, retireTerminalSurfacesFromSnapshot, type RetiredTerminalSurface } from './orca-runtime-symbols'
import { OrcaRuntimeGetMobileSessionSnapshotTabIdentityKeysPart9 } from './orca-runtime-get-mobile-session-snapshot-tab-identity-keys-part-9'

export class OrcaRuntimeApplyMobileSessionRetirementFencesPart10 extends OrcaRuntimeGetMobileSessionSnapshotTabIdentityKeysPart9 {
  protected applyMobileSessionRetirementFences(
    snapshot: RuntimeMobileSessionTabsSnapshot
  ): RuntimeMobileSessionTabsSnapshot {
    let next = snapshot
    for (const tab of snapshot.tabs) {
      if (tab.type !== 'terminal') {
        continue
      }
      const authoritativePtyId = tab.ptyId ?? tab.parentLayout?.ptyIdsByLeafId?.[tab.leafId]
      if (
        this.isMobileSessionSurfaceMembershipAllowed(
          snapshot.worktree,
          tab.parentTabId,
          tab.leafId,
          authoritativePtyId
        )
      ) {
        continue
      }
      const retired = retireTerminalSurfacesFromSnapshot({
        snapshot: next,
        ptyId: authoritativePtyId ?? '',
        exactSurfaces: [{ parentTabId: tab.parentTabId, leafId: tab.leafId }],
        exactOnly: true
      })
      if (retired) {
        next = retired.snapshot
      }
    }
    return next
  }
  protected schedulePendingPtyDurableRetirementRetry(retirementKey: string): void {
    if (
      !this.pendingPtyDurableRetirements.has(retirementKey) ||
      this.pendingPtyDurableRetirementRetryScheduled.has(retirementKey)
    ) {
      return
    }
    this.pendingPtyDurableRetirementRetryScheduled.add(retirementKey)
    const attempts = this.pendingPtyDurableRetirementRetryAttempts.get(retirementKey) ?? 0
    const retryDelayMs = attempts === 0 ? 0 : Math.min(100 * 2 ** Math.min(attempts - 1, 6), 5_000)
    const retryTimer = setTimeout(() => {
      this.pendingPtyDurableRetirementRetryScheduled.delete(retirementKey)
      if (this.pendingPtyDurableRetirements.has(retirementKey)) {
        this.retryPendingPtyDurableRetirement(retirementKey)
      }
    }, retryDelayMs)
    retryTimer.unref?.()
  }
  flushPendingPtyDurableRetirements(): boolean {
    for (const retirementKey of [...this.pendingPtyDurableRetirements.keys()]) {
      try {
        this.retryPendingPtyDurableRetirement(retirementKey)
      } catch (error) {
        console.error('[runtime] durable PTY retirement flush failed:', error)
      }
    }
    return this.pendingPtyDurableRetirements.size === 0
  }
  async waitForPendingPtyDurableRetirements(
    options: { timeoutMs?: number } = {}
  ): Promise<boolean> {
    const deadline =
      options.timeoutMs === undefined ? Number.POSITIVE_INFINITY : Date.now() + options.timeoutMs
    while (this.pendingPtyDurableRetirements.size > 0) {
      for (const [retirementKey] of this.pendingPtyDurableRetirements) {
        if (!this.pendingPtyDurableRetirementRetryScheduled.has(retirementKey)) {
          try {
            this.retryPendingPtyDurableRetirement(retirementKey)
          } catch (error) {
            console.error('[runtime] durable PTY retirement retry threw:', error)
          }
        }
      }
      if (this.pendingPtyDurableRetirements.size === 0) {
        return true
      }
      if (Date.now() >= deadline) {
        console.error('[runtime] durable PTY retirement drain timed out', {
          pendingRetirements: [...this.pendingPtyDurableRetirements.keys()]
        })
        return false
      }
      // Why: shutdown must wait for authoritative persistence; this timer is intentionally referenced so a failed flush cannot be mistaken for completion.
      const remainingMs = deadline - Date.now()
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(100, remainingMs)))
    }
    return true
  }
  protected retryPendingPtyDurableRetirementsForPty(
    ptyId: string,
    excludedIncarnationId?: string
  ): void {
    for (const [retirementKey, pending] of this.pendingPtyDurableRetirements) {
      if (pending.ptyId === ptyId && pending.incarnationId !== excludedIncarnationId) {
        this.retryPendingPtyDurableRetirement(retirementKey)
      }
    }
  }
  protected settleOlderPendingPtyDurableRetirements(
    ptyId: string,
    currentIncarnationId: string,
    currentSurfaces: readonly Pick<
      RetiredTerminalSurface,
      'worktreeId' | 'parentTabId' | 'leafId'
    >[],
    currentRetirementComplete: boolean
  ): void {
    const currentSurfaceKeys = new Set(
      currentSurfaces.map(
        (surface) => `${surface.worktreeId}\0${surface.parentTabId}\0${surface.leafId}`
      )
    )
    for (const [retirementKey, pending] of this.pendingPtyDurableRetirements) {
      if (pending.ptyId !== ptyId || pending.incarnationId === currentIncarnationId) {
        continue
      }
      const sameSurfaces =
        pending.exactSurfaces.length > 0 &&
        pending.exactSurfaces.every((surface) =>
          currentSurfaceKeys.has(`${surface.worktreeId}\0${surface.parentTabId}\0${surface.leafId}`)
        )
      if (currentRetirementComplete && sameSurfaces) {
        this.pendingPtyDurableRetirements.delete(retirementKey)
        this.pendingPtyDurableRetirementRetryAttempts.delete(retirementKey)
        this.pendingPtyDurableRetirementRetryScheduled.delete(retirementKey)
      } else {
        this.schedulePendingPtyDurableRetirementRetry(retirementKey)
      }
    }
  }
  protected retryPendingPtyDurableRetirement(retirementKey: string): void {
    const pending = this.pendingPtyDurableRetirements.get(retirementKey)
    if (!pending) {
      this.pendingPtyDurableRetirementRetryAttempts.delete(retirementKey)
      return
    }
    const pendingRegistration = this.pendingPtyRegistrationIncarnations.get(pending.ptyId)
    const currentPty = this.ptysById.get(pending.ptyId)
    const headlessIncarnation = this.headlessPtyIncarnationById.get(pending.ptyId)
    if (headlessIncarnation !== undefined && headlessIncarnation !== pending.incarnationId) {
      // Why: a headless replacement is already authoritative; its surface must not be retired by an old retry.
      this.pendingPtyDurableRetirements.delete(retirementKey)
      this.pendingPtyDurableRetirementRetryAttempts.delete(retirementKey)
      return
    }
    if (
      currentPty !== undefined &&
      currentPty.incarnationId !== pending.incarnationId &&
      !currentPty.connected &&
      currentPty.lastExitCode === null
    ) {
      // Why: an identity-only reconnect proof is not an admitted replacement; retain the old retry until admission.
      return
    }
    if (
      this.pendingPtyRegistrationIncarnations.has(pending.ptyId) &&
      pendingRegistration !== pending.incarnationId
    ) {
      // Why: a replacement that has not been admitted yet may still be canceled; retain the old retirement until that outcome is known.
      return
    }
    let exactSurfaces = pending.exactSurfaces
    if (currentPty?.connected === true && currentPty.incarnationId !== pending.incarnationId) {
      exactSurfaces = pending.exactSurfaces.filter((surface) => {
        let hostId: ExecutionHostId
        try {
          hostId = this.getWorkspaceSessionHostIdForWorktree(surface.worktreeId)
        } catch {
          return false
        }
        const session = this.store?.getWorkspaceSession?.(hostId)
        return (
          session?.terminalPtyIncarnationsByPaneKey?.[
            `${surface.parentTabId}:${surface.leafId}`
          ] === pending.incarnationId
        )
      })
      if (exactSurfaces.length === 0) {
        // Why: a legacy session without an exact old binding has no durable state that is safe to remove.
        this.pendingPtyDurableRetirements.delete(retirementKey)
        this.pendingPtyDurableRetirementRetryAttempts.delete(retirementKey)
        return
      }
    }
    // Why: persistence retirement checks the exact old incarnation; retry even after newer admission so the old durable binding is not stranded.
    const attempts = (this.pendingPtyDurableRetirementRetryAttempts.get(retirementKey) ?? 0) + 1
    this.pendingPtyDurableRetirementRetryAttempts.set(retirementKey, attempts)
    if (
      this.retireMobileSessionSurfacesForPty(pending.ptyId, pending.incarnationId, exactSurfaces, {
        ensureDurableFlush: true
      })
    ) {
      this.pendingPtyDurableRetirements.delete(retirementKey)
      this.pendingPtyDurableRetirementRetryAttempts.delete(retirementKey)
      return
    }
    this.schedulePendingPtyDurableRetirementRetry(retirementKey)
  }
}
