import { type PtyLayoutTarget, clampTerminalViewport } from './orca-runtime-symbols'
import { OrcaRuntimeOnPtyExitPart32 } from './orca-runtime-on-pty-exit-part-32'

export class OrcaRuntimeActiveRemoteDesktopViewportPart33 extends OrcaRuntimeOnPtyExitPart32 {
  protected activeRemoteDesktopViewport(ptyId: string): { cols: number; rows: number } | null {
    const owner = this.remoteDesktopOwners.get(ptyId)
    return owner ? (this.remoteDesktopViewers.get(ptyId)?.get(owner) ?? null) : null
  }
  protected resolveRemoteDesktopHostReclaimTarget(ptyId: string): { cols: number; rows: number } {
    const target = this.remoteDesktopHostReclaimTargets.get(ptyId)
    if (target) {
      return target
    }
    // Why: a viewer can join while a phone owns the actual PTY size. The
    // mobile restore chain retains the pre-phone desktop geometry; current
    // PTY size alone would incorrectly capture the phone grid as host truth.
    return this.resolveDesktopRestoreTarget(ptyId)
  }
  protected ensureRemoteDesktopHostReclaimTarget(ptyId: string): void {
    if (!this.remoteDesktopHostReclaimTargets.has(ptyId)) {
      this.remoteDesktopHostReclaimTargets.set(
        ptyId,
        this.resolveRemoteDesktopHostReclaimTarget(ptyId)
      )
    }
  }
  recordRemoteDesktopHostReclaimTarget(ptyId: string, cols: number, rows: number): void {
    // Why: phone presence also suppresses host resize, but must not seed the
    // separate remote-viewer cache when no desktop stream owns a width floor.
    if (!this.remoteDesktopOwners.has(ptyId) || cols <= 0 || rows <= 0) {
      return
    }
    this.remoteDesktopHostReclaimTargets.set(ptyId, { cols, rows })
  }
  protected hasRemoteDesktopLayoutState(ptyId: string): boolean {
    return this.remoteDesktopOwners.has(ptyId) || this.remoteDesktopHostReclaimTargets.has(ptyId)
  }
  protected bumpRemoteDesktopViewerRevision(ptyId: string): number {
    const revision = (this.remoteDesktopViewerRevisions.get(ptyId) ?? 0) + 1
    this.remoteDesktopViewerRevisions.set(ptyId, revision)
    return revision
  }
  async applyRemoteDesktopLayout(ptyId: string): Promise<boolean> {
    if (this.getDriver(ptyId).kind === 'mobile') {
      return true
    }
    const target = this.activeRemoteDesktopViewport(ptyId)
    const reclaimingHost = !target
    const viewerRevision = this.remoteDesktopViewerRevisions.get(ptyId) ?? 0
    const layoutTarget: PtyLayoutTarget = target
      ? {
          kind: 'remote-desktop',
          cols: target.cols,
          rows: target.rows,
          ownerSubscriptionKey: this.remoteDesktopOwners.get(ptyId)!
        }
      : { kind: 'desktop', ...this.resolveRemoteDesktopHostReclaimTarget(ptyId) }
    const freshSubscribeGeneration = this.beginFreshSubscribe(ptyId)
    try {
      const result = await this.enqueueLayout(ptyId, layoutTarget)
      // Why: only drop the recorded host size once the reclaim resize actually
      // landed. If it failed, the PTY is still at the remote-viewer width, so
      // keep the target for the next reclaim (otherwise it resolves via the
      // stale remote width and never restores true host geometry).
      if (
        reclaimingHost &&
        result.ok &&
        !this.remoteDesktopOwners.has(ptyId) &&
        this.remoteDesktopViewerRevisions.get(ptyId) === viewerRevision
      ) {
        this.remoteDesktopHostReclaimTargets.delete(ptyId)
      }
      return result.ok
    } finally {
      this.endFreshSubscribe(ptyId, freshSubscribeGeneration)
    }
  }

  // Why: attachment only records geometry. Passive hydration/reconnect must not
  // steal the shared PTY from the desktop where the user is actively working.
  async updateRemoteDesktopViewer(
    ptyId: string,
    subscriptionKey: string,
    clientId: string,
    cols: number,
    rows: number,
    claim = true
  ): Promise<boolean> {
    const viewport = clampTerminalViewport(cols, rows)
    if (claim) {
      this.ensureRemoteDesktopHostReclaimTarget(ptyId)
    }
    let viewers = this.remoteDesktopViewers.get(ptyId)
    if (!viewers) {
      viewers = new Map<
        string,
        { clientId: string; cols: number; rows: number; activity: number }
      >()
      this.remoteDesktopViewers.set(ptyId, viewers)
    }
    const prior = viewers.get(subscriptionKey)
    if (
      prior &&
      prior.cols === viewport.cols &&
      prior.rows === viewport.rows &&
      (!claim || this.remoteDesktopOwners.get(ptyId) === subscriptionKey)
    ) {
      if (claim && this.remoteDesktopOwners.get(ptyId) === subscriptionKey) {
        const size = this.getTerminalSize(ptyId)
        if (size === null || size.cols !== viewport.cols || size.rows !== viewport.rows) {
          return this.applyRemoteDesktopLayout(ptyId)
        }
      }
      return true
    }
    const activity = claim ? ++this.remoteDesktopActivity : (prior?.activity ?? 0)
    viewers.set(subscriptionKey, { clientId, cols: viewport.cols, rows: viewport.rows, activity })
    this.bumpRemoteDesktopViewerRevision(ptyId)
    if (claim) {
      this.remoteDesktopOwners.set(ptyId, subscriptionKey)
      return this.applyRemoteDesktopLayout(ptyId)
    }
    return true
  }
  claimRemoteDesktopViewer(ptyId: string, subscriptionKey: string): Promise<boolean> {
    const viewer = this.remoteDesktopViewers.get(ptyId)?.get(subscriptionKey)
    if (!viewer) {
      return Promise.resolve(false)
    }
    if (this.remoteDesktopOwners.get(ptyId) === subscriptionKey) {
      const size = this.getTerminalSize(ptyId)
      return size?.cols === viewer.cols && size.rows === viewer.rows
        ? Promise.resolve(true)
        : this.applyRemoteDesktopLayout(ptyId)
    }
    this.ensureRemoteDesktopHostReclaimTarget(ptyId)
    viewer.activity = ++this.remoteDesktopActivity
    this.remoteDesktopOwners.set(ptyId, subscriptionKey)
    this.bumpRemoteDesktopViewerRevision(ptyId)
    return this.applyRemoteDesktopLayout(ptyId)
  }
  claimRemoteDesktopHost(ptyId: string, cols: number, rows: number): Promise<boolean> {
    if (!this.remoteDesktopOwners.has(ptyId)) {
      // Why: disconnect can remove the owner before its queued host resize
      // lands. A host input in that window must join the reclaim, not pass it.
      return this.remoteDesktopHostReclaimTargets.has(ptyId)
        ? this.applyRemoteDesktopLayout(ptyId)
        : Promise.resolve(true)
    }
    const viewport = clampTerminalViewport(cols, rows)
    this.remoteDesktopHostReclaimTargets.set(ptyId, viewport)
    this.remoteDesktopOwners.delete(ptyId)
    this.bumpRemoteDesktopViewerRevision(ptyId)
    return this.applyRemoteDesktopLayout(ptyId)
  }
  unregisterRemoteDesktopViewer(ptyId: string, subscriptionKey: string): Promise<boolean> {
    return this.unregisterRemoteDesktopViewers(ptyId, [subscriptionKey])
  }
  unregisterRemoteDesktopViewers(
    ptyId: string,
    subscriptionKeys: Iterable<string>
  ): Promise<boolean> {
    const viewers = this.remoteDesktopViewers.get(ptyId)
    if (!viewers) {
      return Promise.resolve(false)
    }
    let changed = false
    let removedOwner = false
    for (const subscriptionKey of subscriptionKeys) {
      removedOwner = this.remoteDesktopOwners.get(ptyId) === subscriptionKey || removedOwner
      changed = viewers.delete(subscriptionKey) || changed
    }
    if (!changed) {
      return Promise.resolve(false)
    }
    if (viewers.size === 0) {
      this.remoteDesktopViewers.delete(ptyId)
    }
    if (removedOwner) {
      let fallback: { key: string; activity: number } | null = null
      for (const [key, viewer] of viewers) {
        if (viewer.activity > 0 && (!fallback || viewer.activity > fallback.activity)) {
          fallback = { key, activity: viewer.activity }
        }
      }
      if (fallback) {
        this.remoteDesktopOwners.set(ptyId, fallback.key)
      } else {
        this.remoteDesktopOwners.delete(ptyId)
      }
    }
    this.bumpRemoteDesktopViewerRevision(ptyId)
    return removedOwner ? this.applyRemoteDesktopLayout(ptyId) : Promise.resolve(true)
  }

  // Why: the one-shot `terminal.updateViewport` RPC has no disconnect hook, so
  // it must never *create* a width floor (that floor would leak — nothing
  // releases it, pinning the host at a stale width after the viewer is gone).
  // It only refreshes the floor(s) this client already owns via its stream
  // subscription, keyed by clientId. Mirrors the mobile `updateMobileViewport`
  // no-op-without-subscription invariant. Returns false when the client owns no
  // floor (passive/stream-less viewer) — a stream-less viewer must not lock host
  // resize.
  refreshRemoteDesktopViewer(
    ptyId: string,
    clientId: string,
    cols: number,
    rows: number,
    claim = false
  ): Promise<boolean> {
    const viewers = this.remoteDesktopViewers.get(ptyId)
    if (!viewers) {
      return Promise.resolve(false)
    }

    const viewport = clampTerminalViewport(cols, rows)
    if (claim) {
      // Why: terminal.send may be the first activity while the stream is only
      // passively registered. Snapshot host truth before this refresh owns it.
      this.ensureRemoteDesktopHostReclaimTarget(ptyId)
    }
    let changed = false
    for (const [subscriptionKey, viewer] of viewers) {
      if (viewer.clientId === clientId) {
        const activity = claim ? ++this.remoteDesktopActivity : viewer.activity
        viewers.set(subscriptionKey, {
          ...viewer,
          cols: viewport.cols,
          rows: viewport.rows,
          activity
        })
        if (claim) {
          this.remoteDesktopOwners.set(ptyId, subscriptionKey)
        }
        changed = true
      }
    }
    if (!changed) {
      return Promise.resolve(false)
    }
    this.bumpRemoteDesktopViewerRevision(ptyId)
    return this.remoteDesktopOwners.has(ptyId)
      ? this.applyRemoteDesktopLayout(ptyId)
      : Promise.resolve(true)
  }
  async updateDesktopViewport(
    ptyId: string,
    viewport: { cols: number; rows: number }
  ): Promise<boolean> {
    const { cols, rows } = clampTerminalViewport(viewport.cols, viewport.rows)
    if (this.terminalFitOverrides.has(ptyId) || this.getDriver(ptyId).kind === 'mobile') {
      this.recordRendererGeometry(ptyId, cols, rows)
      return true
    }
    if (this.isResizeSuppressed()) {
      return false
    }
    const freshSubscribeGeneration = this.beginFreshSubscribe(ptyId)
    try {
      const result = await this.enqueueLayout(ptyId, { kind: 'desktop', cols, rows })
      if (result.ok) {
        this.refreshRendererGeometry(ptyId, cols, rows)
      }
      return result.ok
    } finally {
      this.endFreshSubscribe(ptyId, freshSubscribeGeneration)
    }
  }
  markMobileActor(ptyId: string, clientId: string): void {
    const inner = this.mobileSubscribers.get(ptyId)
    const sub = inner?.get(clientId)
    if (sub) {
      sub.lastActedAt = Date.now()
    }
    this.setDriver(ptyId, { kind: 'mobile', clientId })
  }
  beginMobileInputFloor(
    ptyId: string,
    clientId: string
  ): { commit: () => Promise<void>; rollback: () => void } | null {
    // Why: admit a client still inside its soft-leave grace (mirrors
    // mobileTookFloor) so a write landing in that window reserves the floor
    // instead of being dropped; post-grace/orphaned writers stay rejected.
    const softLeaver = this.pendingSoftLeavers.get(ptyId)
    if (!this.mobileSubscribers.get(ptyId)?.has(clientId) && softLeaver?.clientId !== clientId) {
      return null
    }
    const state = this.mobileInputFloorClaims.get(ptyId) ?? {
      base: this.getDriver(ptyId),
      generation: 0,
      committedGeneration: 0,
      pending: new Map<symbol, { clientId: string; generation: number }>()
    }
    this.mobileInputFloorClaims.set(ptyId, state)
    const token = Symbol('mobile-input-floor')
    const generation = ++state.generation
    state.pending.set(token, { clientId, generation })
    this.setDriver(ptyId, { kind: 'mobile', clientId })
    let settled = false
    return {
      commit: async () => {
        if (settled) {
          return
        }
        settled = true
        state.pending.delete(token)
        // Why: a newer accepted write owns the floor; an older claim that was
        // delayed before commit must not replace its rollback baseline or driver.
        if (generation < state.committedGeneration) {
          if (state.pending.size === 0 && this.mobileInputFloorClaims.get(ptyId) === state) {
            this.mobileInputFloorClaims.delete(ptyId)
          }
          return
        }
        const previousFloor = state.base
        // Why: a successful write becomes the rollback baseline for any
        // overlapping reservations that have not reached the PTY yet.
        state.committedGeneration = generation
        state.base = { kind: 'mobile', clientId }
        await this.mobileTookFloor(
          ptyId,
          clientId,
          previousFloor,
          () =>
            this.mobileInputFloorClaims.get(ptyId) === state &&
            state.committedGeneration === generation
        )
        if (state.pending.size === 0 && this.mobileInputFloorClaims.get(ptyId) === state) {
          this.mobileInputFloorClaims.delete(ptyId)
        }
      },
      rollback: () => {
        if (settled) {
          return
        }
        settled = true
        state.pending.delete(token)
        if (this.mobileInputFloorClaims.get(ptyId) !== state) {
          return
        }
        const current = this.getDriver(ptyId)
        if (current.kind === 'mobile' && current.clientId === clientId) {
          const pendingClientId = Array.from(state.pending.values()).at(-1)?.clientId
          this.setDriver(
            ptyId,
            pendingClientId ? { kind: 'mobile', clientId: pendingClientId } : state.base
          )
        }
        if (state.pending.size === 0) {
          this.mobileInputFloorClaims.delete(ptyId)
        }
      }
    }
  }

  // Why: invoked from mobile RPC method handlers (terminal.send / setDisplayMode /
  // resizeForClient / fresh subscribe with auto). Records the actor as the
  // most recent mobile driver and re-applies phone-fit if we were previously
  // in `desktop` mode (mobile reclaims a take-back). Mobile-to-mobile hand-offs
  // are no-ops for resize.
}
