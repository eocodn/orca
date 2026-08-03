import { app } from 'electron'
import {
  type PtyMainDeliveryDiagnostics,
  type PtyPerPtyDeliveryDiagnostics,
  redactPtyIdForDiagnostics
} from '../../shared/pty-delivery-diagnostics'
import type { PtyRendererDeliveryDebugSnapshot } from './pty-ipc-runtime-renderer-lifecycle-state'
import {
  getHiddenRendererPtyDeliveryDebug,
  getHiddenRendererPtyIds,
  isHiddenRendererPty,
  resetHiddenRendererPtyDeliveryDebugCounters
} from './pty-hidden-delivery-gate'
import { ptyRuntimeState } from './pty-ipc-runtime-state'
import type { PtyRendererDeliveryContext } from './pty-ipc-runtime-renderer-delivery-context'

const DELIVERY_DIAGNOSTICS_MAX_PTYS = 30

type RendererDeliveryDiagnosticsOptions = {
  state: PtyRendererDeliveryContext
  mainWindow: PtyRendererDeliveryContext['mainWindow']
  mainDeliveryBreadcrumbs: typeof ptyRuntimeState.mainDeliveryBreadcrumbs
  getRendererInFlightCharsForPty: (id: string) => number
}

export function createPtyRendererDeliveryDiagnostics({
  state,
  mainWindow,
  mainDeliveryBreadcrumbs,
  getRendererInFlightCharsForPty
}: RendererDeliveryDiagnosticsOptions) {
  function recordPtyRendererDeliveryPressure(id: string): void {
    state.peakPendingChars = Math.max(state.peakPendingChars, state.pendingData.totalPendingChars)
    state.peakMaxPendingCharsByPty = Math.max(
      state.peakMaxPendingCharsByPty,
      state.pendingData.get(id)?.data.length ?? 0
    )
    state.peakRendererInFlightChars = Math.max(
      state.peakRendererInFlightChars,
      state.rendererInFlightTotalChars
    )
    state.peakMaxRendererInFlightCharsByPty = Math.max(
      state.peakMaxRendererInFlightCharsByPty,
      getRendererInFlightCharsForPty(id)
    )
  }

  function buildMainDeliveryDiagnostics(): PtyMainDeliveryDiagnostics {
    const now = Date.now()
    // Include hidden/visible/active members even without accounting: pre-byte gating is a wedge case.
    const ids = new Set([
      ...state.rendererDeliveryAccountingByPty.keys(),
      ...state.pendingData.keys(),
      ...getHiddenRendererPtyIds(),
      ...ptyRuntimeState.visibleRendererPtys,
      ...ptyRuntimeState.activeRendererPtys
    ])
    const perPty: PtyPerPtyDeliveryDiagnostics[] = []
    for (const id of ids) {
      const accounting = state.rendererDeliveryAccountingByPty.get(id)
      perPty.push({
        id: redactPtyIdForDiagnostics(id),
        ...(accounting?.incarnationId ? { incarnationId: accounting.incarnationId } : {}),
        sentChars: accounting?.sentChars ?? 0,
        ackedChars: accounting?.ackedChars ?? 0,
        inFlightChars: accounting ? accounting.sentChars - accounting.ackedChars : 0,
        pendingChars: state.pendingData.get(id)?.data.length ?? 0,
        hidden: isHiddenRendererPty(id),
        visible: ptyRuntimeState.visibleRendererPtys.has(id),
        active: ptyRuntimeState.activeRendererPtys.has(id),
        msSinceLastSend: accounting ? now - accounting.lastSendAtMs : null,
        msSinceLastAck: accounting?.lastAckAtMs == null ? null : now - accounting.lastAckAtMs
      })
    }
    perPty.sort((a, b) => b.inFlightChars + b.pendingChars - (a.inFlightChars + a.pendingChars))
    const windowAlive = !mainWindow.isDestroyed()
    return {
      appVersion: app.getVersion(),
      mainUptimeMs: Math.round(process.uptime() * 1000),
      windowFocused: windowAlive ? mainWindow.isFocused() : null,
      windowVisible: windowAlive ? mainWindow.isVisible() : null,
      windowMinimized: windowAlive ? mainWindow.isMinimized() : null,
      msSinceLastPowerSuspend:
        ptyRuntimeState.lastPowerSuspendAtMs === null
          ? null
          : now - ptyRuntimeState.lastPowerSuspendAtMs,
      msSinceLastPowerResume:
        ptyRuntimeState.lastPowerResumeAtMs === null
          ? null
          : now - ptyRuntimeState.lastPowerResumeAtMs,
      perPty: perPty.slice(0, DELIVERY_DIAGNOSTICS_MAX_PTYS),
      breadcrumbs: mainDeliveryBreadcrumbs.snapshot()
    }
  }

  function readCurrentPtyRendererDeliveryDebugSnapshot(): PtyRendererDeliveryDebugSnapshot {
    let pendingChars = 0
    let maxPendingCharsByPty = 0
    for (const pending of state.pendingData.values()) {
      const chars = pending.data.length
      pendingChars += chars
      maxPendingCharsByPty = Math.max(maxPendingCharsByPty, chars)
    }
    const hiddenDeliveryDebug = getHiddenRendererPtyDeliveryDebug()
    let rendererInFlightPtyCount = 0
    let maxRendererInFlightCharsByPty = 0
    for (const accounting of state.rendererDeliveryAccountingByPty.values()) {
      const inFlight = accounting.sentChars - accounting.ackedChars
      if (inFlight > 0) {
        rendererInFlightPtyCount++
      }
      maxRendererInFlightCharsByPty = Math.max(maxRendererInFlightCharsByPty, inFlight)
    }
    let hiddenDeliveryGatedVisiblePtyCount = 0
    for (const id of ptyRuntimeState.visibleRendererPtys) {
      if (isHiddenRendererPty(id)) {
        hiddenDeliveryGatedVisiblePtyCount++
      }
    }
    let hiddenDeliveryGatedActivePtyCount = 0
    for (const id of ptyRuntimeState.activeRendererPtys) {
      if (isHiddenRendererPty(id)) {
        hiddenDeliveryGatedActivePtyCount++
      }
    }
    return {
      pendingPtyCount: state.pendingData.size,
      pendingChars,
      maxPendingCharsByPty,
      rendererInFlightPtyCount,
      rendererInFlightChars: state.rendererInFlightTotalChars,
      maxRendererInFlightCharsByPty,
      activeRendererPtyCount: ptyRuntimeState.activeRendererPtys.size,
      flushScheduled: state.flushTimer !== null,
      peakPendingChars: state.peakPendingChars,
      peakMaxPendingCharsByPty: state.peakMaxPendingCharsByPty,
      peakRendererInFlightChars: state.peakRendererInFlightChars,
      peakMaxRendererInFlightCharsByPty: state.peakMaxRendererInFlightCharsByPty,
      ackGatedFlushSkipCount: state.ackGatedFlushSkipCount,
      ...hiddenDeliveryDebug,
      hiddenDeliveryGatedVisiblePtyCount,
      hiddenDeliveryGatedActivePtyCount,
      pendingDroppedChars: state.pendingDroppedChars,
      diagnostics: buildMainDeliveryDiagnostics(),
      rendererLifecycleResetCount: state.rendererLifecycleResetCount,
      lastLifecycleResetClearedChars: state.lastLifecycleResetClearedChars,
      rendererPtyDispatcherReady: state.rendererPtyDispatcherReady,
      rendererDispatcherReadyForcedCount: state.rendererDispatcherReadyForcedCount,
      rendererDispatcherReadyTimeoutCount: state.rendererDispatcherReadyTimeoutCount
    }
  }

  function warnIfDroppingHiddenBytesForVisiblePty(id: string, droppedChars: number): void {
    if (
      !ptyRuntimeState.visibleRendererPtys.has(id) &&
      !ptyRuntimeState.activeRendererPtys.has(id)
    ) {
      return
    }
    // Record before rate limiting so the freeze report retains every contradiction.
    mainDeliveryBreadcrumbs.record('hidden-drop-visible', {
      id: redactPtyIdForDiagnostics(id),
      droppedChars
    })
    const now = Date.now()
    if (now - state.lastHiddenDropContradictionWarnAtMs < 60_000) {
      return
    }
    state.lastHiddenDropContradictionWarnAtMs = now
    console.warn('[pty] hidden-delivery gate is dropping bytes for a visible/active pty', {
      id,
      droppedChars,
      visible: ptyRuntimeState.visibleRendererPtys.has(id),
      active: ptyRuntimeState.activeRendererPtys.has(id),
      ...readCurrentPtyRendererDeliveryDebugSnapshot()
    })
  }

  function seedPtyRendererDeliveryPeaksFromCurrentState(): void {
    let pendingChars = 0
    let maxPendingCharsByPty = 0
    for (const pending of state.pendingData.values()) {
      const chars = pending.data.length
      pendingChars += chars
      maxPendingCharsByPty = Math.max(maxPendingCharsByPty, chars)
    }
    state.peakPendingChars = pendingChars
    state.peakMaxPendingCharsByPty = maxPendingCharsByPty
    state.peakRendererInFlightChars = state.rendererInFlightTotalChars
    let maxRendererInFlightCharsByPty = 0
    for (const accounting of state.rendererDeliveryAccountingByPty.values()) {
      maxRendererInFlightCharsByPty = Math.max(
        maxRendererInFlightCharsByPty,
        accounting.sentChars - accounting.ackedChars
      )
    }
    state.peakMaxRendererInFlightCharsByPty = maxRendererInFlightCharsByPty
  }

  function resetPtyRendererDeliveryDebugSnapshot(): void {
    state.peakPendingChars = 0
    state.peakMaxPendingCharsByPty = 0
    state.peakRendererInFlightChars = 0
    state.peakMaxRendererInFlightCharsByPty = 0
    state.ackGatedFlushSkipCount = 0
    state.pendingDroppedChars = 0
    resetHiddenRendererPtyDeliveryDebugCounters()
    seedPtyRendererDeliveryPeaksFromCurrentState()
  }

  return {
    buildMainDeliveryDiagnostics,
    readCurrentPtyRendererDeliveryDebugSnapshot,
    recordPtyRendererDeliveryPressure,
    resetPtyRendererDeliveryDebugSnapshot,
    warnIfDroppingHiddenBytesForVisiblePty
  }
}
