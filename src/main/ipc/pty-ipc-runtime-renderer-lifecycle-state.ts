import { powerMonitor, type WebContents } from 'electron'
import {
  EMPTY_PTY_MAIN_DELIVERY_DIAGNOSTICS,
  type PtyMainDeliveryDiagnostics
} from '../../shared/pty-delivery-diagnostics'
import { ptyRuntimeState } from './pty-ipc-runtime-state'

const EMPTY_PTY_RENDERER_DELIVERY_DEBUG_SNAPSHOT: PtyRendererDeliveryDebugSnapshot = {
  pendingPtyCount: 0,
  pendingChars: 0,
  maxPendingCharsByPty: 0,
  rendererInFlightPtyCount: 0,
  rendererInFlightChars: 0,
  maxRendererInFlightCharsByPty: 0,
  activeRendererPtyCount: 0,
  flushScheduled: false,
  peakPendingChars: 0,
  peakMaxPendingCharsByPty: 0,
  peakRendererInFlightChars: 0,
  peakMaxRendererInFlightCharsByPty: 0,
  ackGatedFlushSkipCount: 0,
  hiddenDeliveryGatedPtyCount: 0,
  hiddenDeliveryGatedVisiblePtyCount: 0,
  hiddenDeliveryGatedActivePtyCount: 0,
  deliveryInterestPtyCount: 0,
  hiddenDeliveryDroppedChars: 0,
  hiddenDeliveryDroppedChunks: 0,
  pendingDroppedChars: 0,
  diagnostics: EMPTY_PTY_MAIN_DELIVERY_DIAGNOSTICS,
  rendererLifecycleResetCount: 0,
  lastLifecycleResetClearedChars: 0,
  rendererPtyDispatcherReady: false,
  rendererDispatcherReadyForcedCount: 0,
  rendererDispatcherReadyTimeoutCount: 0
}

export type PtyRendererDeliveryDebugSnapshot = {
  pendingPtyCount: number
  pendingChars: number
  maxPendingCharsByPty: number
  rendererInFlightPtyCount: number
  rendererInFlightChars: number
  maxRendererInFlightCharsByPty: number
  activeRendererPtyCount: number
  flushScheduled: boolean
  peakPendingChars: number
  peakMaxPendingCharsByPty: number
  peakRendererInFlightChars: number
  peakMaxRendererInFlightCharsByPty: number
  ackGatedFlushSkipCount: number
  hiddenDeliveryGatedPtyCount: number
  /** Hidden-gated ptys the renderer ALSO reports visible/active — a contradiction that should be zero (v1.4.124-rc.2.perf field lead). */
  hiddenDeliveryGatedVisiblePtyCount: number
  hiddenDeliveryGatedActivePtyCount: number
  deliveryInterestPtyCount: number
  hiddenDeliveryDroppedChars: number
  hiddenDeliveryDroppedChunks: number
  pendingDroppedChars: number
  /** One-paste freeze diagnostics: per-pty delivery table + event history. */
  diagnostics: PtyMainDeliveryDiagnostics
  // Why: a nonzero lastLifecycleResetClearedChars is the exact signature of the leaked-accounting freeze this reset fixes.
  rendererLifecycleResetCount: number
  lastLifecycleResetClearedChars: number
  // Why: the boot-window hold early-returns before ackGatedFlushSkipCount++, so these expose an otherwise-invisible held gate; timeoutCount records a missing proof without opening it.
  rendererPtyDispatcherReady: boolean
  rendererDispatcherReadyForcedCount: number
  rendererDispatcherReadyTimeoutCount: number
}

// Why module scope: breadcrumb writers live both inside registerPtyHandlers and outside it (renderer lifecycle resets).

const mainDeliveryBreadcrumbs = ptyRuntimeState.mainDeliveryBreadcrumbs
let readPtyRendererDeliveryDebugSnapshot = (): PtyRendererDeliveryDebugSnapshot => ({
  ...EMPTY_PTY_RENDERER_DELIVERY_DEBUG_SNAPSHOT
})
let resetPtyRendererDeliveryDebugSnapshot = (): void => {}
let resetRendererDeliveryAccountingForLifecycleReset = (): void => {}

export function setPtyRendererDeliveryDebugBridges(bridges: {
  read: () => PtyRendererDeliveryDebugSnapshot
  reset: () => void
  resetAccounting: () => void
}): void {
  readPtyRendererDeliveryDebugSnapshot = bridges.read
  resetPtyRendererDeliveryDebugSnapshot = bridges.reset
  resetRendererDeliveryAccountingForLifecycleReset = bridges.resetAccounting
}

export function installPowerSignalBreadcrumbs(): void {
  if (ptyRuntimeState.powerSignalBreadcrumbsInstalled) {
    return
  }
  ptyRuntimeState.powerSignalBreadcrumbsInstalled = true
  powerMonitor.on("suspend", () => {
    ptyRuntimeState.lastPowerSuspendAtMs = Date.now()
    mainDeliveryBreadcrumbs.record("power-suspend")
  })
  powerMonitor.on("resume", () => {
    ptyRuntimeState.lastPowerResumeAtMs = Date.now()
    mainDeliveryBreadcrumbs.record("power-resume")
  })
}

export function getPtyRendererDeliveryDebugSnapshot(): PtyRendererDeliveryDebugSnapshot {
  return readPtyRendererDeliveryDebugSnapshot()
}

export function resetPtyRendererDeliveryDebug(): void {
  resetPtyRendererDeliveryDebugSnapshot()
}

export function clearDidFinishLoadHandler(): void {
  if (ptyRuntimeState.didFinishLoadHandler && ptyRuntimeState.didFinishLoadWebContents) {
    ptyRuntimeState.didFinishLoadWebContents.removeListener('did-finish-load', ptyRuntimeState.didFinishLoadHandler)
  }
  ptyRuntimeState.didFinishLoadHandler = null
  ptyRuntimeState.didFinishLoadWebContents = null
}

function markRendererPtysHiddenForRendererLifecycleReset(): void {
  // A reload/crash in the breadcrumb history is load-bearing context for any freeze report.
  mainDeliveryBreadcrumbs.record('renderer-lifecycle-reset')
  // Why: renderer-owned hints die with the page; clear visibility so surviving daemon/SSH PTYs fail closed until the new renderer reports.
  const activePriorityChanged = ptyRuntimeState.activeRendererPtys.size > 0
  ptyRuntimeState.activeRendererPtys.clear()
  ptyRuntimeState.visibleRendererPtys.clear()
  // Why: the dead page never ACKs its in-flight bytes, so leaked accounting would delivery-gate surviving PTYs forever after a reload/crash.
  resetRendererDeliveryAccountingForLifecycleReset()
  if (activePriorityChanged) {
    ptyRuntimeState.invalidatePendingPtyDrainPriority()
  }
}

function clearRendererLifecycleResetHandlers(): void {
  if (!ptyRuntimeState.rendererLifecycleResetWebContents) {
    return
  }
  if (ptyRuntimeState.rendererDidStartLoadingHandler) {
    ptyRuntimeState.rendererLifecycleResetWebContents.removeListener(
      'did-start-loading',
      ptyRuntimeState.rendererDidStartLoadingHandler
    )
  }
  if (ptyRuntimeState.rendererLifecycleResetHandler) {
    ptyRuntimeState.rendererLifecycleResetWebContents.removeListener(
      'render-process-gone',
      ptyRuntimeState.rendererLifecycleResetHandler
    )
    ptyRuntimeState.rendererLifecycleResetWebContents.removeListener('destroyed', ptyRuntimeState.rendererLifecycleResetHandler)
  }
  ptyRuntimeState.rendererLifecycleResetWebContents = null
  ptyRuntimeState.rendererLifecycleResetHandler = null
  ptyRuntimeState.rendererDidStartLoadingHandler = null
}

export function registerRendererLifecycleResetHandlers(webContents: WebContents): void {
  clearRendererLifecycleResetHandlers()
  markRendererPtysHiddenForRendererLifecycleReset()
  ptyRuntimeState.rendererLifecycleResetWebContents = webContents
  ptyRuntimeState.rendererLifecycleResetHandler = markRendererPtysHiddenForRendererLifecycleReset
  // Why: did-start-loading also fires for in-page subframe loads (notebook srcDoc iframes); filter via isLoadingMainFrame so a subframe load can't clear pendingData and freeze the alive page.
  ptyRuntimeState.rendererDidStartLoadingHandler = () => {
    if (!webContents.isLoadingMainFrame()) {
      return
    }
    markRendererPtysHiddenForRendererLifecycleReset()
  }
  webContents.on('did-start-loading', ptyRuntimeState.rendererDidStartLoadingHandler)
  webContents.on('render-process-gone', ptyRuntimeState.rendererLifecycleResetHandler)
  webContents.on('destroyed', ptyRuntimeState.rendererLifecycleResetHandler)
}

export function clearRendererGateResetHandlers(): void {
  if (ptyRuntimeState.rendererGateResetWebContents) {
    if (ptyRuntimeState.rendererGateResetLoadHandler) {
      ptyRuntimeState.rendererGateResetWebContents.removeListener('did-finish-load', ptyRuntimeState.rendererGateResetLoadHandler)
    }
    if (ptyRuntimeState.rendererGateResetGoneHandler) {
      ptyRuntimeState.rendererGateResetWebContents.removeListener(
        'render-process-gone',
        ptyRuntimeState.rendererGateResetGoneHandler
      )
    }
  }
  ptyRuntimeState.rendererGateResetLoadHandler = null
  ptyRuntimeState.rendererGateResetGoneHandler = null
  ptyRuntimeState.rendererGateResetWebContents = null
}

// Why: Restart daemon must detach listeners AFTER synthetic pty:exit events fan out but BEFORE replaceDaemonProvider swaps the adapter; this export narrows that window to the caller.
export function unbindLocalProviderListeners(): void {
  ptyRuntimeState.localDataUnsub?.()
  ptyRuntimeState.localExitUnsub?.()
  ptyRuntimeState.localBackgroundStreamUnsub?.()
  ptyRuntimeState.localWriteUnavailableUnsub?.()
  ptyRuntimeState.localDataUnsub = null
  ptyRuntimeState.localExitUnsub = null
  ptyRuntimeState.localBackgroundStreamUnsub = null
  ptyRuntimeState.localWriteUnavailableUnsub = null
}
