import { parsePaneKey, type PtyIncarnationId, advertisedUrlWatcher, type RetiredTerminalSurface, notifyRuntimeListeners, type DriverState, makePtyDurableRetirementKey } from './orca-runtime-symbols'
import { OrcaRuntimeOnClientDisconnectedPart31 } from './orca-runtime-on-client-disconnected-part-31'

export class OrcaRuntimeOnPtyExitPart32 extends OrcaRuntimeOnClientDisconnectedPart31 {
  onPtyExit(
    ptyId: string,
    exitCode: number,
    exitIncarnationId?: PtyIncarnationId,
    options: {
      authoritativeIdentityLess?: boolean
      expectedIncarnationId?: PtyIncarnationId
    } = {}
  ): void {
    const pty = this.ptysById.get(ptyId)
    const headlessIncarnation = this.headlessPtyIncarnationById.get(ptyId)
    const pendingIncarnation = this.pendingPtyRegistrationIncarnations.get(ptyId)
    const exitMatchesUnadmittedReplacement =
      this.pendingPtyRegistrationIncarnations.has(ptyId) &&
      pendingIncarnation !== undefined &&
      pendingIncarnation !== null &&
      pendingIncarnation !== pty?.incarnationId &&
      (exitIncarnationId === pendingIncarnation ||
        (exitIncarnationId === undefined &&
          pty?.connected === false &&
          (options.expectedIncarnationId === undefined ||
            options.expectedIncarnationId === pendingIncarnation)))
    if (exitMatchesUnadmittedReplacement) {
      this.earlyExitedPtyIncarnations.set(ptyId, pendingIncarnation)
      if (exitIncarnationId) {
        this.rememberObservedPtyExit(ptyId, exitIncarnationId)
      }
      return
    }
    if (exitIncarnationId) {
      const retirementKey = makePtyDurableRetirementKey(ptyId, exitIncarnationId)
      if (this.pendingPtyDurableRetirements.has(retirementKey)) {
        this.retryPendingPtyDurableRetirement(retirementKey)
        return
      }
    }
    if (exitIncarnationId === undefined && options.authoritativeIdentityLess !== true) {
      return
    }
    if (
      exitIncarnationId === undefined &&
      options.authoritativeIdentityLess === true &&
      options.expectedIncarnationId === undefined &&
      (headlessIncarnation !== undefined || pty?.incarnationId != null)
    ) {
      return
    }
    if (
      exitIncarnationId === undefined &&
      options.expectedIncarnationId !== undefined &&
      ((headlessIncarnation !== undefined &&
        headlessIncarnation !== options.expectedIncarnationId) ||
        (headlessIncarnation === undefined &&
          pty?.incarnationId != null &&
          pty.incarnationId !== options.expectedIncarnationId))
    ) {
      return
    }
    if (exitIncarnationId && headlessIncarnation && exitIncarnationId !== headlessIncarnation) {
      return
    }
    if (
      exitIncarnationId &&
      headlessIncarnation === undefined &&
      pty?.incarnationId &&
      exitIncarnationId !== pty.incarnationId
    ) {
      return
    }
    if (
      exitIncarnationId !== undefined &&
      pty?.incarnationId === exitIncarnationId &&
      pty.connected === false &&
      pty.lastExitCode !== null
    ) {
      return
    }
    if (exitIncarnationId) {
      this.rememberObservedPtyExit(ptyId, exitIncarnationId)
    }
    this.headlessPtyIncarnationById.delete(ptyId)
    this.rendererGraphLivenessBlockedPtys.add(ptyId)
    const preservesAbnormalSshSurface = this.isRecoverableSshTransportLoss(
      ptyId,
      pty?.connectionId ?? null,
      exitCode
    )
    if (preservesAbnormalSshSurface) {
      this.restoredOrchestrationAuthorityByPtyId.delete(ptyId)
    } else {
      this.retirePtyAgentLaunchAuthority(ptyId)
    }
    const incarnationId =
      exitIncarnationId ??
      options.expectedIncarnationId ??
      pty?.incarnationId ??
      `runtime:${this.runtimeId}:${this.getPtyLifecycleGeneration(ptyId)}`
    const exitingLifecycleGeneration = this.getPtyLifecycleGeneration(ptyId)
    this.cancelLayoutQueue(ptyId, exitingLifecycleGeneration)
    this.freshSubscribeGuard.clear(ptyId, exitingLifecycleGeneration)
    this.advancePtyLifecycleGeneration(ptyId)
    const exactSurfaceByKey = new Map<
      string,
      Pick<RetiredTerminalSurface, 'worktreeId' | 'parentTabId' | 'leafId'>
    >()
    for (const leaf of this.getLeavesForPty(ptyId)) {
      exactSurfaceByKey.set(`${leaf.worktreeId}\0${leaf.tabId}\0${leaf.leafId}`, {
        worktreeId: leaf.worktreeId,
        parentTabId: leaf.tabId,
        leafId: leaf.leafId
      })
    }
    // Why: the mounted PTY record can disappear before the mobile snapshot is retired; the snapshot is then the remaining surface authority.
    for (const [worktreeId, snapshot] of this.mobileSessionTabsByWorktree) {
      for (const tab of snapshot.tabs) {
        if (
          tab.type !== 'terminal' ||
          (tab.ptyId !== ptyId && tab.parentLayout?.ptyIdsByLeafId?.[tab.leafId] !== ptyId)
        ) {
          continue
        }
        exactSurfaceByKey.set(`${worktreeId}\0${tab.parentTabId}\0${tab.leafId}`, {
          worktreeId,
          parentTabId: tab.parentTabId,
          leafId: tab.leafId
        })
      }
    }
    const parsedPaneKey = parsePaneKey(pty?.paneKey ?? '')
    if (pty?.tabId && parsedPaneKey) {
      exactSurfaceByKey.set(`${pty.worktreeId}\0${pty.tabId}\0${parsedPaneKey.leafId}`, {
        worktreeId: pty.worktreeId,
        parentTabId: pty.tabId,
        leafId: parsedPaneKey.leafId
      })
    }
    const exactSurfaces = [...exactSurfaceByKey.values()]
    const exitMatchesPendingRegistration =
      this.pendingPtyRegistrationIncarnations.has(ptyId) &&
      (pendingIncarnation === null ||
        exitIncarnationId === null ||
        (exitIncarnationId === undefined && options.expectedIncarnationId === undefined) ||
        pendingIncarnation === exitIncarnationId)
    if (exitMatchesPendingRegistration) {
      // Why: reused surfaces can look registered while their replacement incarnation still awaits admission.
      this.earlyExitedPtyIncarnations.set(
        ptyId,
        exitIncarnationId ?? pendingIncarnation ?? pty?.incarnationId ?? null
      )
    }
    const intentionalStopIncarnation = this.intentionalHandlelessPtyStops.get(ptyId)
    const preservesIntentionalHandlelessSurface =
      this.intentionalHandlelessPtyStops.has(ptyId) &&
      (intentionalStopIncarnation === null || intentionalStopIncarnation === incarnationId)
    advertisedUrlWatcher.unbindPty(ptyId)
    // Clean up new mobile state for this PTY
    this.mobileSubscribers.delete(ptyId)
    this.remoteTerminalViewSubscriberCounts.delete(ptyId)
    this.rawTerminalViewSubscriberCounts.delete(ptyId)
    this.mobileDisplayModes.delete(ptyId)
    this.resizeListeners.delete(ptyId)
    this.lastRendererSizes.delete(ptyId)
    this.terminalOutputState.delete(ptyId)
    this.setupCompletionTokenByPtyId.delete(ptyId)
    this.clearWaitBlockedCheckState(ptyId)
    this.recentPtyPathCandidatesById.delete(ptyId)
    this.providerSequenceInitializedPtys.delete(ptyId)
    this.providerSequenceOffsetByPtyId.delete(ptyId)
    this.providerSnapshotPreferredPtys.delete(ptyId)
    this.providerModeTrackersByPtyId.delete(ptyId)
    this.providerModeSnapshotScansByPtyId.delete(ptyId)
    this.providerBufferAcquisitionsByPtyId.delete(ptyId)
    this.providerVisibleStateByPtyId.delete(ptyId)
    this.providerVisibleRetryAtByPtyId.delete(ptyId)
    this.agentStatusOscProcessorsByPtyId.delete(ptyId)
    this.terminalSpawnCommandsByPtyId.delete(ptyId)
    this.disposePtyTitleTracker(ptyId)
    this.oscTitleScanTailByPtyId.delete(ptyId)
    this.osc7ScanTailByPtyId.delete(ptyId)
    this.terminalCwdByPtyId.delete(ptyId)
    this.terminalFileUriHostnameByPtyId.delete(ptyId)
    this.wslDistroByPtyId.delete(ptyId)
    this.clearAgentRowSnapshotsForPty(ptyId)
    // Why: a Claude agent-team leader whose PTY exits naturally (agent finished,
    // process died, renderer reload) must release its team + nested panes map.
    // Previously only explicit closeTerminal evicted it, so natural exits leaked
    // one team per never-reused teamId for the runtime's lifetime.
    const exitedTeamLeaderHandle = this.handleByPtyId.get(ptyId)
    if (exitedTeamLeaderHandle) {
      this.claudeAgentTeams.removeTeamForLeaderHandle(exitedTeamLeaderHandle)
    }
    // Layout state belongs to the exited lifecycle generation.
    this.layouts.delete(ptyId)
    const pendingRestore = this.pendingRestoreTimers.get(ptyId)
    if (pendingRestore) {
      clearTimeout(pendingRestore.timer)
      this.pendingRestoreTimers.delete(ptyId)
    }
    const pendingSoft = this.pendingSoftLeavers.get(ptyId)
    if (pendingSoft) {
      clearTimeout(pendingSoft.timer)
      this.pendingSoftLeavers.delete(ptyId)
    }

    if (this.terminalFitOverrides.has(ptyId)) {
      this.terminalFitOverrides.delete(ptyId)
      this.notifier?.terminalFitOverrideChanged(ptyId, 'desktop-fit', 0, 0)
      this.notifyFitOverrideListeners(ptyId, 'desktop-fit', 0, 0)
    }
    // Why: clear driver state and notify the renderer so any lock banner on
    // this dead pane unmounts. Without this, the pane shows a stuck banner
    // until tab teardown, and `getDriver(deadPtyId)` would keep returning a
    // stale `mobile{X}` to any caller that hasn't yet seen the exit IPC.
    if (this.currentDriver.has(ptyId)) {
      this.currentDriver.delete(ptyId)
      this.notifier?.terminalDriverChanged(ptyId, { kind: 'idle' })
    }
    this.remoteDesktopViewers.delete(ptyId)
    this.remoteDesktopOwners.delete(ptyId)
    this.remoteDesktopHostReclaimTargets.delete(ptyId)
    this.remoteDesktopViewerRevisions.delete(ptyId)
    this.disposeHeadlessTerminal(ptyId)
    this.agentDetector?.onExit(ptyId)
    if (pty) {
      pty.connected = false
      pty.runtimeSessionOwned = false
      pty.disconnectedAt = Date.now()
      pty.lastExitCode = exitCode
      this.resolvePtyExitWaiters(pty, ptyId)
      this.pruneDisconnectedPtyTranscript(pty)
    }
    let durableRetirementComplete = false
    if (preservesIntentionalHandlelessSurface || preservesAbnormalSshSurface) {
      // Why: relay loss is recoverable; keep the HUB-owned pane addressable through the bounded reconnect grace.
      this.touchMobileSessionSnapshotsForPty(ptyId, { immediate: true })
    } else {
      // Why: permanent process exit is absence, not a starting/sleeping tab.
      // Retire before publishing so paired clients never persist a ghost.
      durableRetirementComplete = this.retireMobileSessionSurfacesForPty(
        ptyId,
        incarnationId,
        exactSurfaces
      )
      const retirementKey = makePtyDurableRetirementKey(ptyId, incarnationId)
      if (durableRetirementComplete) {
        this.pendingPtyDurableRetirements.delete(retirementKey)
        this.pendingPtyDurableRetirementRetryAttempts.delete(retirementKey)
      } else {
        this.pendingPtyDurableRetirements.set(retirementKey, {
          ptyId,
          incarnationId,
          exactSurfaces
        })
        this.schedulePendingPtyDurableRetirementRetry(retirementKey)
      }
    }

    this.settleOlderPendingPtyDurableRetirements(
      ptyId,
      incarnationId,
      exactSurfaces,
      durableRetirementComplete
    )

    for (const leaf of this.getLeavesForPty(ptyId)) {
      this.detachedPreAllocatedLeaves.delete(ptyId)
      leaf.connected = false
      leaf.writable = false
      leaf.lastExitCode = exitCode
      this.resolveExitWaiters(leaf)
      if (!preservesAbnormalSshSurface) {
      }
    }
    this.pruneDisconnectedPtyRecords()
  }

  // ─── Driver state (mobile-presence lock) ──────────────────────────
  //
  // See docs/mobile-presence-lock.md.
  getDriver(ptyId: string): DriverState {
    return this.currentDriver.get(ptyId) ?? { kind: 'idle' }
  }
  protected setDriver(ptyId: string, next: DriverState): void {
    const prev = this.getDriver(ptyId)
    if (prev.kind === next.kind) {
      if (prev.kind === 'mobile' && next.kind === 'mobile' && prev.clientId === next.clientId) {
        return
      }
      if (prev.kind !== 'mobile' && next.kind !== 'mobile') {
        return
      }
    }
    if (next.kind === 'idle') {
      this.currentDriver.delete(ptyId)
    } else {
      this.currentDriver.set(ptyId, next)
    }
    this.notifier?.terminalDriverChanged(ptyId, next)
    const listeners = this.driverListeners.get(ptyId)
    if (listeners) {
      notifyRuntimeListeners(listeners, (listener) => listener(next), 'pty-driver')
    }
  }

  // Why: the host's own fit cascade (window resize, split drag, tab reveal,
  // "+"-new-tab re-render) must not resize a PTY whose width a remote client
  // owns — that is the remote "porridge" bug. True while a phone (mobile driver)
  // OR an active remote desktop viewer owns the PTY. Input is deliberately NOT gated
  // here (see the `writePtyInput` mobile-only checks): shared-control desktop
  // viewers may still type alongside the host.
  // Note: this is intentionally NOT a driver kind. An active remote viewer needs
  // only resize suppression, not the mobile driver machinery (input lock,
  // phone-fit, driver-change banners), so it lives in its own registry and does
  // not perturb the presence-lock state machine. It also coexists with mobile:
  // while a phone drives, the registry still suppresses host resize, and when
  // the phone leaves the surviving viewer keeps the PTY suppressed.
  isPtyResizeDrivenRemotely(ptyId: string): boolean {
    if (this.getDriver(ptyId).kind === 'mobile') {
      return true
    }
    return this.isRemoteDesktopResizeDriven(ptyId)
  }
  isRemoteDesktopResizeDriven(ptyId: string): boolean {
    return this.remoteDesktopOwners.has(ptyId)
  }
  isRemoteDesktopViewerOwner(ptyId: string, subscriptionKey: string): boolean {
    return this.remoteDesktopOwners.get(ptyId) === subscriptionKey
  }
  getRemoteDesktopFitHold(
    ptyId: string,
    subscriptionKey: string
  ): { mode: 'remote-desktop-fit' | 'desktop-fit'; cols: number; rows: number } {
    const size = this.getTerminalSize(ptyId) ?? { cols: 0, rows: 0 }
    return {
      mode: this.isRemoteDesktopViewerOwner(ptyId, subscriptionKey)
        ? 'desktop-fit'
        : 'remote-desktop-fit',
      ...size
    }
  }
  protected hasRemoteDesktopViewers(ptyId: string): boolean {
    const viewers = this.remoteDesktopViewers.get(ptyId)
    return viewers !== undefined && viewers.size > 0
  }
}
