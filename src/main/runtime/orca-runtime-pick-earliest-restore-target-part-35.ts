import { type ApplyLayoutResult, type PtyLayoutState, type PtyLayoutTarget } from './orca-runtime-symbols'
import { OrcaRuntimeMobileTookFloorPart34 } from './orca-runtime-mobile-took-floor-part-34'

export class OrcaRuntimePickEarliestRestoreTargetPart35 extends OrcaRuntimeMobileTookFloorPart34 {
  protected pickEarliestRestoreTarget(
    inner: Map<
      string,
      { subscribedAt: number; previousCols: number | null; previousRows: number | null }
    >
  ): { previousCols: number; previousRows: number } | null {
    let best: { subscribedAt: number; previousCols: number; previousRows: number } | null = null
    for (const sub of inner.values()) {
      if (sub.previousCols == null || sub.previousRows == null) {
        continue
      }
      if (best === null || sub.subscribedAt < best.subscribedAt) {
        best = {
          subscribedAt: sub.subscribedAt,
          previousCols: sub.previousCols,
          previousRows: sub.previousRows
        }
      }
    }
    return best ? { previousCols: best.previousCols, previousRows: best.previousRows } : null
  }

  // ─── Layout state machine ─────────────────────────────────────────
  //
  // See docs/mobile-terminal-layout-state-machine.md.
  //
  // applyLayout is the SOLE writer of:
  //   - this.layouts
  //   - this.terminalFitOverrides (except the sanctioned dead-pty cleanups in
  //     onPtyExit and reclaimTerminalForDesktop's orphan branch, which delete)
  //   - this.ptyController.resize (i.e. the actual PTY dims)
  //
  // Every trigger that wants to change PTY dims or flip mode goes through
  // enqueueLayout, which serializes calls behind a per-PTY async queue
  // (the await on ptyController.resize would otherwise let seq bumps reach
  // the wire out of order).
  getLayout(ptyId: string): PtyLayoutState | null {
    return this.layouts.get(ptyId) ?? null
  }
  protected beginFreshSubscribe(ptyId: string): number {
    const generation = this.getPtyLifecycleGeneration(ptyId)
    this.freshSubscribeGuard.add(ptyId, generation)
    return generation
  }
  protected endFreshSubscribe(ptyId: string, generation: number): void {
    this.freshSubscribeGuard.delete(ptyId, generation)
  }

  // Why: `enqueueLayout`'s "no layouts entry" short-circuit must not fire
  // on the very first transition for a PTY (where the entry doesn't exist
  // yet *because* we're about to create it). handleMobileSubscribe adds
  // the ptyId to `freshSubscribeGuard` before calling enqueueLayout and
  // removes it in a finally block.
  protected isFreshSubscribe(
    ptyId: string,
    generation = this.getPtyLifecycleGeneration(ptyId)
  ): boolean {
    return this.freshSubscribeGuard.has(ptyId, generation)
  }

  // Why: four-step fallback chain for desktop-restore targets. Always
  // returns a value; the terminal {80,24} branch is reached only under
  // bug. Wrapping the chain as a single helper prevents callsite drift.
  protected resolveDesktopRestoreTarget(ptyId: string): { cols: number; rows: number } {
    // 1. Earliest-by-subscribedAt subscriber with non-null baseline.
    const inner = this.mobileSubscribers.get(ptyId)
    if (inner) {
      const earliest = this.pickEarliestRestoreTarget(inner)
      if (earliest) {
        return { cols: earliest.previousCols, rows: earliest.previousRows }
      }
    }
    // 2. Most-recent desktop renderer geometry report.
    const renderer = this.lastRendererSizes.get(ptyId)
    if (renderer) {
      return { cols: renderer.cols, rows: renderer.rows }
    }
    // 3. Current PTY size.
    const size = this.getTerminalSize(ptyId)
    if (size) {
      return { cols: size.cols, rows: size.rows }
    }
    // 4. Hard default.
    return { cols: 80, rows: 24 }
  }
  protected enqueueLayout(ptyId: string, target: PtyLayoutTarget): Promise<ApplyLayoutResult> {
    return this.layoutQueue.enqueue(ptyId, target)
  }
  protected enqueueExactLayout(
    ptyId: string,
    target: PtyLayoutTarget,
    hooks: {
      beforeApply: () => void | Promise<void>
      resizeMutation: (cols: number, rows: number) => boolean | Promise<boolean>
      afterApply: (result: ApplyLayoutResult) => void | Promise<void>
    }
  ): Promise<ApplyLayoutResult> {
    return this.layoutQueue.enqueueExact(ptyId, target, hooks)
  }
  protected cancelLayoutQueue(ptyId: string, generation: number): void {
    this.layoutQueue.cancel(ptyId, generation)
  }
  protected async applyLayout(
    ptyId: string,
    target: PtyLayoutTarget,
    generation: number,
    resizeMutation?: (cols: number, rows: number) => boolean | Promise<boolean>
  ): Promise<ApplyLayoutResult> {
    // Why: re-check pty-exit at the head of the slot — the queue may have
    // accepted this target before onPtyExit ran.
    if (
      this.getPtyLifecycleGeneration(ptyId) !== generation ||
      (!this.layouts.has(ptyId) && !this.isFreshSubscribe(ptyId, generation))
    ) {
      return { ok: false, reason: 'pty-exited' }
    }

    const prev = this.layouts.get(ptyId) ?? null
    const seq = (prev?.seq ?? 0) + 1
    const next: PtyLayoutState = { ...target, seq, appliedAt: Date.now() }

    const currentSize = this.getTerminalSize(ptyId)
    const dimsChanged = currentSize?.cols !== target.cols || currentSize?.rows !== target.rows
    const modeChanged = (prev?.kind ?? 'desktop') !== target.kind

    // Snapshot for rollback.
    const prevFitOverride = this.terminalFitOverrides.get(ptyId) ?? null

    const stillOwnsTentativeState = (): boolean =>
      this.getPtyLifecycleGeneration(ptyId) === generation && this.layouts.get(ptyId) === next

    // Tentative writes — the resize is the point of no return.
    this.layouts.set(ptyId, next)
    if (target.kind === 'phone') {
      // Why: pull baseline cols+rows atomically from the same subscriber so
      // they can't desync.
      const baseline = (() => {
        const inner = this.mobileSubscribers.get(ptyId)
        if (!inner) {
          return null
        }
        return this.pickEarliestRestoreTarget(inner)
      })()
      this.terminalFitOverrides.set(ptyId, {
        mode: 'mobile-fit',
        cols: target.cols,
        rows: target.rows,
        previousCols: baseline?.previousCols ?? null,
        previousRows: baseline?.previousRows ?? null,
        updatedAt: next.appliedAt,
        clientId: target.ownerClientId
      })
    } else {
      this.terminalFitOverrides.delete(ptyId)
    }

    if (dimsChanged) {
      let ok = false
      try {
        const r = resizeMutation
          ? await resizeMutation(target.cols, target.rows)
          : this.ptyController?.resize?.(ptyId, target.cols, target.rows)
        ok = r ?? true
      } catch (err) {
        console.error('[layout] ptyController.resize threw', { ptyId, err })
        ok = false
      }
      if (!stillOwnsTentativeState()) {
        return { ok: false, reason: 'pty-exited' }
      }
      if (!ok) {
        // Roll back to pre-call snapshot. seq is NOT bumped on the wire
        // because we never emit below.
        if (stillOwnsTentativeState()) {
          if (prev) {
            this.layouts.set(ptyId, prev)
          } else {
            this.layouts.delete(ptyId)
          }
          if (prevFitOverride) {
            this.terminalFitOverrides.set(ptyId, prevFitOverride)
          } else {
            this.terminalFitOverrides.delete(ptyId)
          }
        }
        return { ok: false, reason: 'resize-failed' }
      }
      this.resizeHeadlessTerminal(ptyId, target.cols, target.rows)
    }

    if (!stillOwnsTentativeState()) {
      return { ok: false, reason: 'pty-exited' }
    }

    // Why: remote desktop ownership is a fit hold for the host and passive
    // peer viewers. Emit every remote layout so owner changes at equal geometry
    // still park/release the correct clients without relying on resize deltas.
    // Defense-in-depth (#7588): also emit when the override's presence
    // changed even without a kind flip. applyLayout is the sole writer and
    // keeps override presence in lockstep with layout kind, so overrideChanged
    // ≡ modeChanged in every reachable state today; the extra clause fires
    // only if that invariant is ever violated, repairing the renderer instead
    // of stranding the held modal.
    const overrideChanged = (prevFitOverride != null) !== (target.kind === 'phone')
    if (target.kind === 'remote-desktop' || modeChanged || overrideChanged) {
      // Why: phone→desktop arms the renderer-cascade suppress window
      // before the collateral safeFit IPCs arrive. See "Renderer cascade
      // suppression".
      if (target.kind === 'desktop') {
        this.lastRendererSizes.delete(ptyId)
        this.suppressResizesForMs(500)
      }
      this.notifier?.terminalFitOverrideChanged(
        ptyId,
        target.kind === 'phone'
          ? 'mobile-fit'
          : target.kind === 'remote-desktop'
            ? 'remote-desktop-fit'
            : 'desktop-fit',
        target.cols,
        target.rows
      )
      this.notifyFitOverrideListeners(
        ptyId,
        target.kind === 'phone'
          ? 'mobile-fit'
          : target.kind === 'remote-desktop'
            ? 'remote-desktop-fit'
            : 'desktop-fit',
        target.cols,
        target.rows
      )
    }

    // Mobile-facing event always fires (phone clients need to re-fit on
    // every dim change, not just mode flips).
    this.notifyTerminalResize(ptyId, {
      cols: target.cols,
      rows: target.rows,
      displayMode: target.kind === 'phone' ? 'phone' : 'desktop',
      reason: 'apply-layout',
      seq
    })

    return { ok: true, state: next }
  }

  // ─── Server-Authoritative Mobile Display Mode ─────────────────────
  setMobileDisplayMode(ptyId: string, mode: 'auto' | 'desktop'): void {
    if (mode === 'auto') {
      this.mobileDisplayModes.delete(ptyId)
    } else {
      this.mobileDisplayModes.set(ptyId, mode)
    }
  }
  getMobileDisplayMode(ptyId: string): 'auto' | 'desktop' {
    return this.mobileDisplayModes.get(ptyId) ?? 'auto'
  }
  isMobileSubscriberActive(ptyId: string): boolean {
    const inner = this.mobileSubscribers.get(ptyId)
    return inner !== undefined && inner.size > 0
  }

  // Why: late-bind viewport on an existing subscriber record. Subscribers
  // that registered before the mobile side measured (e.g. terminal first
  // mounted while the WebView was still loading) have null viewport, and
  // applyMobileDisplayMode's auto branch needs a viewport to phone-fit.
  // The setDisplayMode RPC carries the latest viewport so we can patch it
  // here just before applyMobileDisplayMode runs.
  updateMobileSubscriberViewport(
    ptyId: string,
    clientId: string,
    viewport: { cols: number; rows: number }
  ): void {
    const inner = this.mobileSubscribers.get(ptyId)
    const record = inner?.get(clientId)
    if (!record) {
      return
    }
    record.viewport = viewport
  }

  // Why: server-side auto-fit on mobile subscribe. The runtime is the single
  // source of truth — the mobile client just passes its viewport and the runtime
  // decides whether to resize. This eliminates the measure→RPC→resubscribe
  // pipeline that caused race conditions.
  //
  // Multi-mobile keying: each subscriber lives in `mobileSubscribers[ptyId]`'s
  // inner map under its own clientId. Phone B subscribing does not overwrite
  // phone A's record — both stay until each unsubscribes.
  //
  // Subscribe-in-desktop-mode rule: a subscribe with displayMode='desktop' is
  // a passive watch; it does NOT take the floor. The driver remains
  // `idle`/`desktop`. The lock banner is reserved for actual mobile
  // interaction (input/resize/setDisplayMode/auto-or-phone subscribe).
  async handleMobileSubscribe(
    ptyId: string,
    clientId: string,
    viewport?: { cols: number; rows: number }
  ): Promise<boolean> {
    try {
      return await this.handleMobileSubscribeInternal(ptyId, clientId, viewport)
    } finally {
      // Every subscribe path mutates mobileSubscribers — resync the daemon
      // background mark once, whatever branch returned.
      this.notifyRemoteTerminalViewPresenceChanged(ptyId)
    }
  }
}
