import { MOBILE_AUTO_RESTORE_FIT_MAX_MS, MOBILE_AUTO_RESTORE_FIT_MIN_MS, type ApplyLayoutResult, clampTerminalViewport, type DriverState } from './orca-runtime-symbols'
import { OrcaRuntimeActiveRemoteDesktopViewportPart33 } from './orca-runtime-active-remote-desktop-viewport-part-33'

export class OrcaRuntimeMobileTookFloorPart34 extends OrcaRuntimeActiveRemoteDesktopViewportPart33 {
  async mobileTookFloor(
    ptyId: string,
    clientId: string,
    previousFloor?: DriverState,
    isCurrent: () => boolean = () => true
  ): Promise<void> {
    const inner = this.mobileSubscribers.get(ptyId)
    const sub = inner?.get(clientId)
    const softLeaver = this.pendingSoftLeavers.get(ptyId)
    // Why: native chat pauses terminal output, so its later sends have no
    // subscriber lifecycle that could release a newly-created desktop lock.
    if (!sub && softLeaver?.clientId !== clientId) {
      return
    }
    if (sub) {
      sub.lastActedAt = Date.now()
    }
    const prev = previousFloor ?? this.getDriver(ptyId)
    const currentMode = this.mobileDisplayModes.get(ptyId)
    // Why: a deliberate mobile action implies mobile is resuming control.
    // If the display mode is currently 'desktop' (set by an earlier
    // take-back), flip it back to 'auto' (= map absence) and re-apply so
    // phone-fit takes hold again. See docs/mobile-presence-lock.md.
    if (prev.kind === 'desktop' || currentMode === 'desktop') {
      if (currentMode === 'desktop') {
        this.mobileDisplayModes.delete(ptyId)
      }
      await this.applyMobileDisplayMode(ptyId)
    }
    // Why: display changes are async; a later PTY write must keep the floor
    // when an older phone-fit operation eventually completes.
    if (!isCurrent()) {
      return
    }
    this.setDriver(ptyId, { kind: 'mobile', clientId })
  }

  // Why: in-place viewport update on the existing mobile subscription —
  // used when the mobile keyboard opens/closes and shrinks/grows the
  // visible terminal area. We refresh the subscriber's viewport, re-fit
  // the PTY to the new dims, and emit a 'resized' event so the mobile
  // xterm reinits inline at the new dims without re-subscribing. This
  // avoids the unsubscribe → resubscribe cycle which would (a) flash the
  // desktop lock banner during the brief idle gap and (b) cause the new
  // subscribe to capture the already-phone-fitted PTY size as its
  // restore baseline (stuck-dim bug on later disconnect).
  // No-op when the client isn't actually subscribed to this PTY.
  async updateMobileViewport(
    ptyId: string,
    clientId: string,
    viewport: { cols: number; rows: number }
  ): Promise<{ updated: boolean; applied: boolean }> {
    const inner = this.mobileSubscribers.get(ptyId)
    const sub = inner?.get(clientId)
    if (!sub) {
      return { updated: false, applied: false }
    }
    sub.viewport = viewport
    sub.lastActedAt = Date.now()

    const mode = this.getMobileDisplayMode(ptyId)
    if (mode === 'desktop') {
      // Watching at desktop dims — viewport is informational only.
      return { updated: true, applied: false }
    }
    // Drive PTY dims by the most-recent-actor (just updated to this client).
    const winner = this.pickMostRecentActor(inner!)
    if (!winner) {
      return { updated: false, applied: false }
    }
    const winnerSub = inner!.get(winner.clientId)
    const driveViewport = winnerSub?.viewport ?? viewport
    const { cols: clampedCols, rows: clampedRows } = clampTerminalViewport(
      driveViewport.cols,
      driveViewport.rows
    )

    sub.wasResizedToPhone = true
    // The driver is already mobile{this client} when we got here; refresh
    // to update lastActedAt-based ordering on later actor selection.
    this.setDriver(ptyId, { kind: 'mobile', clientId })

    const needsFreshSubscribeGuard = !this.layouts.has(ptyId)
    const freshSubscribeGeneration = needsFreshSubscribeGuard
      ? this.beginFreshSubscribe(ptyId)
      : null
    let result: ApplyLayoutResult
    try {
      result = await this.enqueueLayout(ptyId, {
        kind: 'phone',
        cols: clampedCols,
        rows: clampedRows,
        ownerClientId: winner.clientId
      })
    } finally {
      if (freshSubscribeGeneration !== null) {
        this.endFreshSubscribe(ptyId, freshSubscribeGeneration)
      }
    }
    return { updated: true, applied: result.ok }
  }

  // Why: invoked from `runtime:restoreTerminalFit` IPC (the desktop "Take
  // back" / "Restore" button). Forces the PTY back to desktop dims and flips
  // the driver to `desktop`, suppressing further mobile-driven dim changes
  // until a mobile actor takes the floor again. Three cases, each ending in
  // releaseDesktopTakeBack:
  //   1. Active mobile subscriber: route through applyMobileDisplayMode so the
  //      existing 'resized' event reaches the phone.
  //   2. Held override, no subscriber (post-indefinite-hold): resolve the
  //      restore target and enqueueLayout directly.
  //   3. Stale mobile driver, no subscriber and no override: nothing to resize,
  //      just drop the lock. See docs/mobile-fit-hold.md.
  //
  // Why: explicit desktop take-back is a user command to reclaim input control
  // NOW. Unlike the auto-restore timer and phone-initiated setDisplayMode paths
  // (which keep the lock when a resize can't converge, #7588), this gesture
  // ALWAYS drops the presence lock and banner. "Take back all terminals"
  // reclaims several PTYs at once; a background pane whose desktop resize can't
  // converge must not strand its banner on the other terminals. The resize is
  // best-effort — the desktop renderer refits the PTY on its next settled
  // frame. Returns `true` whenever there was a lock to reclaim, `false` only
  // when there was nothing to reclaim.
  async reclaimTerminalForDesktop(ptyId: string): Promise<boolean> {
    if (this.isMobileSubscriberActive(ptyId)) {
      this.setMobileDisplayMode(ptyId, 'desktop')
      await this.applyMobileDisplayMode(ptyId)
      this.releaseDesktopTakeBack(ptyId)
      // Why: a desktop-initiated reclaim is "I'm taking over right now", not a
      // sticky preference. The next mobile subscribe (e.g. user switches back to
      // the terminal tab on the phone) must default to phone-fit again, not stay
      // in passive desktop-watch mode.
      this.setMobileDisplayMode(ptyId, 'auto')
      if (this.hasRemoteDesktopLayoutState(ptyId)) {
        return this.applyRemoteDesktopLayout(ptyId)
      }
      return true
    }
    const heldOverride = this.terminalFitOverrides.get(ptyId)
    if (heldOverride && this.hasRemoteDesktopLayoutState(ptyId)) {
      const pending = this.pendingRestoreTimers.get(ptyId)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingRestoreTimers.delete(ptyId)
      }
      const softLeaver = this.pendingSoftLeavers.get(ptyId)
      if (softLeaver) {
        clearTimeout(softLeaver.timer)
        this.pendingSoftLeavers.delete(ptyId)
      }
      const priorDriver = this.getDriver(ptyId)
      this.setDriver(ptyId, { kind: 'idle' })
      const converged = await this.applyRemoteDesktopLayout(ptyId)
      if (!converged) {
        this.setDriver(ptyId, priorDriver)
        return false
      }
      this.setDriver(ptyId, { kind: 'desktop' })
      this.setMobileDisplayMode(ptyId, 'auto')
      return true
    }
    if (heldOverride) {
      const pending = this.pendingRestoreTimers.get(ptyId)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingRestoreTimers.delete(ptyId)
      }
      // Why: with no subscribers, resolveDesktopRestoreTarget can fall through
      // to current PTY size — which is at phone dims (wrong). Prefer a fresh
      // desktop renderer measurement when one exists; otherwise use the
      // override's pre-fit baseline before falling back to current size.
      const fallback = this.resolveDesktopRestoreTarget(ptyId)
      const renderer = this.lastRendererSizes.get(ptyId)
      const cols = renderer?.cols ?? heldOverride.previousCols ?? fallback.cols
      const rows = renderer?.rows ?? heldOverride.previousRows ?? fallback.rows
      await this.enqueueLayout(ptyId, { kind: 'desktop', cols, rows })
      this.releaseDesktopTakeBack(ptyId)
      this.setMobileDisplayMode(ptyId, 'auto')
      return true
    }
    // Why: a stale lock — driver still reads mobile with no active subscriber
    // and no held override (e.g. reclaimed inside the soft-leave grace, or a
    // subscriber that dropped without a clean unsubscribe). Release it so the
    // banner can't linger; there is nothing to resize.
    if (this.getDriver(ptyId).kind === 'mobile') {
      this.releaseDesktopTakeBack(ptyId)
      return true
    }
    return false
  }

  // Why: the shared "banner must be gone now" step for an explicit desktop
  // take-back. Releases the presence lock (driver → desktop) and, if the
  // best-effort resize left a fit-override held (resize didn't converge),
  // clears it optimistically with a paired desktop-fit 0×0 — the same signal
  // onPtyExit emits — so neither the presence-lock banner nor the held-fit
  // banner can survive the reclaim. The desktop renderer refits the PTY to real
  // dims on its next settled frame.
  protected releaseDesktopTakeBack(ptyId: string): void {
    this.setDriver(ptyId, { kind: 'desktop' })
    if (this.terminalFitOverrides.has(ptyId)) {
      this.terminalFitOverrides.delete(ptyId)
      this.notifier?.terminalFitOverrideChanged(ptyId, 'desktop-fit', 0, 0)
      this.notifyFitOverrideListeners(ptyId, 'desktop-fit', 0, 0)
    }
  }

  // Why: read-side clamp for mobileAutoRestoreFitMs. `null` means
  // indefinite hold (no auto-restore timer). A finite value is clamped
  // to [MIN, MAX] to defend against bad config — the smallest useful
  // value is a few seconds, the largest is one hour. See
  // docs/mobile-fit-hold.md.
  protected getAutoRestoreFitMs(): number | null {
    const raw = this.store?.getSettings().mobileAutoRestoreFitMs ?? null
    if (raw == null) {
      return null
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return null
    }
    return Math.min(Math.max(raw, MOBILE_AUTO_RESTORE_FIT_MIN_MS), MOBILE_AUTO_RESTORE_FIT_MAX_MS)
  }

  // Why: invoked when the user changes mobileAutoRestoreFitMs to `null`
  // (Indefinite). Clears every pending restore timer so the just-expressed
  // preference "do not auto-restore" is honored for ALL currently-pending
  // PTYs, not just one. See docs/mobile-fit-hold.md.
  cancelAllPendingFitRestoreTimers(): void {
    for (const [, entry] of this.pendingRestoreTimers) {
      clearTimeout(entry.timer)
    }
    this.pendingRestoreTimers.clear()
  }

  // Why: read the persisted user preference (clamped) for surfacing to UI
  // callers (mobile RPC, desktop preferences). Returns null when the
  // setting is unset or `null` ("Indefinite").
  getMobileAutoRestoreFitMs(): number | null {
    return this.getAutoRestoreFitMs()
  }

  // Why: persisted-preference setter routed through the same `Store` the
  // desktop preferences UI writes to. Transitions to `null` (Indefinite)
  // clear every pending restore timer to honor the preference change for
  // already-held PTYs. Transitions to a finite value do NOT retroactively
  // schedule timers for PTYs that are currently held — those PTYs were
  // already-not-restored under the old preference, and silently scheduling
  // a restore on a settings change would be surprising. The new value
  // takes effect on the next unsubscribe. See docs/mobile-fit-hold.md.
  setMobileAutoRestoreFitMs(ms: number | null): number | null {
    if (!this.store?.updateSettings) {
      return this.getAutoRestoreFitMs()
    }
    let normalized: number | null
    if (ms == null) {
      normalized = null
    } else if (typeof ms !== 'number' || !Number.isFinite(ms)) {
      normalized = null
    } else {
      normalized = Math.min(
        Math.max(ms, MOBILE_AUTO_RESTORE_FIT_MIN_MS),
        MOBILE_AUTO_RESTORE_FIT_MAX_MS
      )
    }
    this.store.updateSettings({ mobileAutoRestoreFitMs: normalized }, { notifyListeners: true })
    if (normalized == null) {
      this.cancelAllPendingFitRestoreTimers()
    }
    return normalized
  }

  // Why: with multiple subscribers, the active phone-fit dims follow the
  // most recent mobile actor (argmax(lastActedAt)). See
  // docs/mobile-presence-lock.md "Active phone-fit dim selection".
  protected pickMostRecentActor(
    inner: Map<string, { clientId: string; lastActedAt: number }>
  ): { clientId: string; lastActedAt: number } | null {
    let best: { clientId: string; lastActedAt: number } | null = null
    for (const sub of inner.values()) {
      if (best === null || sub.lastActedAt > best.lastActedAt) {
        best = sub
      }
    }
    return best
  }

  // Why: restore-target selection on last-subscriber-leaves picks the
  // earliest-by-subscribe-time subscriber AMONG those with non-null
  // previousCols/Rows. Desktop-mode joins carry null and are skipped — they
  // never captured pre-fit dims by design.
}
