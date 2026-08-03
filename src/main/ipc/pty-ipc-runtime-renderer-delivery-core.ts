import {
  isHiddenPtyDeliveryGateEnabled,
  shouldDropHiddenRendererPtyData
} from './pty-hidden-delivery-gate'
import { tryGetProviderForPty } from './pty-ipc-runtime-provider-routing'
import { ptyRuntimeState } from './pty-ipc-runtime-state'
import { getPtyRegistrationSharedState } from './pty-ipc-runtime-registration-shared-state'
import { setPtyRendererDeliveryDebugBridges } from './pty-ipc-runtime-renderer-lifecycle-state'
import type { PendingPtyData } from './pty-pending-data-drain-queue'
import { PtyPendingDataDrainQueue } from './pty-pending-data-drain-queue'
import { PtyProducerFlowController } from './pty-producer-flow-control'
import type { PtyRendererDeliveryContext } from './pty-ipc-runtime-renderer-delivery-context'
import { recordDaemonStreamBacklogEvent } from '../daemon/daemon-stream-backlog-probe'
import { createPtyRendererHiddenDeliveryTransitions } from './pty-ipc-runtime-renderer-hidden-delivery-state'
import { clearPendingPtyDataForPty } from './pty-ipc-runtime-clear-buffer-fence'
import { createPtyRendererDeliveryDiagnostics } from './pty-ipc-runtime-renderer-delivery-diagnostics'
import { createPtyRendererDeliveryRecovery } from './pty-ipc-runtime-renderer-delivery-recovery'
import { createPtyRendererDeliveryInteractive } from './pty-ipc-runtime-renderer-delivery-interactive'
import {
  getPtyPayloadCharCount,
  makePtyDataPayload
} from './pty-ipc-runtime-renderer-delivery-payload'
import {
  PTY_BATCH_FLUSH_CHUNK_CHARS,
  PTY_RENDERER_ACTIVE_PTY_IN_FLIGHT_RESERVE_CHARS,
  PTY_RENDERER_IN_FLIGHT_HIGH_WATER_CHARS,
  PTY_RENDERER_INTERACTIVE_RESERVE_CHARS,
  PTY_RENDERER_TOTAL_IN_FLIGHT_HIGH_WATER_CHARS
} from './pty-ipc-runtime-renderer-delivery-constants'

const PRODUCER_FLOW_CONTROL_ENABLED = true
const rendererDeliveryInteractive = createPtyRendererDeliveryInteractive({
  redrawMaxChars: PTY_BATCH_FLUSH_CHUNK_CHARS
})

export function initializePtyRendererDelivery(): PtyRendererDeliveryContext {
  const state = getPtyRegistrationSharedState() as PtyRendererDeliveryContext
  const getSettings = state.getSettings
  const runtime = state.runtime
  const mainWindow = state.mainWindow
  const mainDeliveryBreadcrumbs = ptyRuntimeState.mainDeliveryBreadcrumbs
  state.sshOutputIntake = null
  state.rendererExitingPtyIds = new Set()
  state.rendererCreditBeforeExitByPty = new Map()
  state.rendererDeliveryRestoreNeededPtys = new Set()
  state.pendingOverflowMarkedPtys = new Set()
  state.rendererDeliveryAccountingByPty = new Map()
  state.flushTimer = null
  state.pendingDataFlushActive = false
  state.pendingDataCreditReleasedDuringFlush = false
  state.rendererInFlightTotalChars = 0
  state.pendingDroppedChars = 0
  state.deliveryResyncRequestSerial = 0
  state.deliveryResyncOutstandingRequestId = null
  state.deliveryResyncTimer = null
  state.deliveryResyncUnansweredWarnLogged = false
  state.peakPendingChars = 0
  state.peakMaxPendingCharsByPty = 0
  state.peakRendererInFlightChars = 0
  state.peakMaxRendererInFlightCharsByPty = 0
  state.ackGatedFlushSkipCount = 0
  state.rendererLifecycleResetCount = 0
  state.lastLifecycleResetClearedChars = 0
  state.rendererDispatcherReadyForcedCount = 0
  state.rendererDispatcherReadyTimeoutCount = 0
  state.rendererPtyDispatcherReady = false
  state.dispatcherReadyWatchdogTimer = null
  state.sourceCreditPendingPtys = new Set()
  state.backgroundedDeliverySyncByPty = new Map()
  state.pendingDataDropWarnedPtys = new Set()
  state.lastHiddenDropContradictionWarnAtMs = 0
  const rendererDeliveryInterestPtys = new Set<string>()
  state.producerFlowControl = new PtyProducerFlowController({
    pauseProducer: (id) => tryGetProviderForPty(id)?.pauseProducer?.(id),
    resumeProducer: (id) => tryGetProviderForPty(id)?.resumeProducer?.(id)
  })
  state.pendingData = new PtyPendingDataDrainQueue(
    (id) => {
      const runnableLane = ptyRuntimeState.activeRendererPtys.has(id) ? 'active' : 'background'
      if (shouldDropHiddenRendererPtyData(id, getSettings?.())) {
        return runnableLane
      }
      if (
        !state.rendererPtyDispatcherReady ||
        !state.canSendPtyDataToRenderer(id, {
          interactive: ptyRuntimeState.activeRendererPtys.has(id)
        })
      ) {
        return 'blocked'
      }
      return runnableLane
    },
    () => isHiddenPtyDeliveryGateEnabled(getSettings?.())
  )

  const {
    transitionHiddenRendererPtyDeliveryState,
    transitionSpawnHiddenRendererPtyDeliveryState
  } = createPtyRendererHiddenDeliveryTransitions(getSettings, (id) =>
    state.invalidatePendingPtyDrainPolicy(id)
  )
  const rendererDeliveryDiagnostics = createPtyRendererDeliveryDiagnostics({
    state,
    mainWindow,
    mainDeliveryBreadcrumbs,
    getRendererInFlightCharsForPty
  })
  const {
    readCurrentPtyRendererDeliveryDebugSnapshot,
    buildMainDeliveryDiagnostics,
    recordPtyRendererDeliveryPressure,
    resetPtyRendererDeliveryDebugSnapshot,
    warnIfDroppingHiddenBytesForVisiblePty
  } = rendererDeliveryDiagnostics

  function updateProducerFlowControl(id: string): void {
    if (!PRODUCER_FLOW_CONTROL_ENABLED) {
      return
    }
    if (state.sourceCreditPendingPtys.has(id)) {
      if (state.pendingData.get(id)) {
        return
      }
      state.sourceCreditPendingPtys.delete(id)
    }
    state.producerFlowControl.update(id, state.pendingData.get(id)?.data.length ?? 0)
  }

  // Why: background hints follow renderer visibility, while interest sidecars and remote views veto thinning.
  function syncPtyBackgroundedDelivery(id: string, caller: string): void {
    if (caller.startsWith('delivery-interest:')) {
      if (caller.endsWith(':on')) {
        rendererDeliveryInterestPtys.add(id)
      } else {
        rendererDeliveryInterestPtys.delete(id)
      }
    }
    const background =
      state.rendererPtyIsKnownHidden(id) &&
      !rendererDeliveryInterestPtys.has(id) &&
      !(runtime?.hasRawTerminalViewSubscriber?.(id) ?? false)
    if ((state.backgroundedDeliverySyncByPty.get(id) ?? false) === background) {
      return
    }
    const provider = tryGetProviderForPty(id)
    if (!provider?.setPtyBackgrounded) {
      return
    }
    recordDaemonStreamBacklogEvent('mainBackgroundSync', {
      sessionIdSuffix: id.slice(-10),
      background,
      caller,
      known: ptyRuntimeState.rendererVisibilityKnownPtys.has(id),
      visible: ptyRuntimeState.visibleRendererPtys.has(id)
    })
    state.backgroundedDeliverySyncByPty.set(id, background)
    provider.setPtyBackgrounded(id, background)
  }
  ptyRuntimeState.clearBackgroundedDeliverySyncForPty = (id: string) => {
    state.backgroundedDeliverySyncByPty.delete(id)
    rendererDeliveryInterestPtys.delete(id)
  }
  if (runtime) {
    runtime.onRemoteTerminalViewPresenceChanged = (id) =>
      syncPtyBackgroundedDelivery(id, 'remote-view')
  }
  function resyncBackgroundedDeliveriesAfterGateReset(): void {
    rendererDeliveryInterestPtys.clear()
    state.backgroundedDeliverySyncByPty.forEach((_background, id) =>
      syncPtyBackgroundedDelivery(id, 'gate-reset')
    )
  }

  function getRendererInFlightCharsForPty(id: string): number {
    const accounting = state.rendererDeliveryAccountingByPty.get(id)
    return accounting ? accounting.sentChars - accounting.ackedChars : 0
  }

  function setPendingPtyData(id: string, pending: PendingPtyData): void {
    state.pendingData.set(id, pending)
    rendererDeliveryDiagnostics.recordPtyRendererDeliveryPressure(id)
  }

  function deletePendingPtyData(id: string): void {
    state.pendingData.delete(id)
  }

  function clearPendingPtyData(): void {
    for (const pending of state.pendingData.values()) {
      if (pending.projectionAdmissionIds) {
        state.sshOutputIntake?.transferProjections(
          pending.projectionAdmissionIds,
          'renderer-lifecycle-reset'
        )
      }
    }
    state.pendingData.clear()
    state.sourceCreditPendingPtys.clear()
  }

  const rendererDeliveryRecovery = createPtyRendererDeliveryRecovery({
    state,
    runtime,
    mainWindow,
    mainDeliveryBreadcrumbs,
    readCurrentPtyRendererDeliveryDebugSnapshot,
    deletePendingPtyData,
    updateProducerFlowControl
  })
  const {
    applyCumulativeAck,
    clearDeliveryResyncProbe,
    requestDeliveryResyncForGatedPty,
    writeOffLostRendererDelivery
  } = rendererDeliveryRecovery

  const resetRendererDeliveryAccountingForLifecycleReset = (): void => {
    // Why lossless: state.pendingData bytes were bound for the dead page; the replacement repaints from main's authoritative sources, which superset it.
    state.lastLifecycleResetClearedChars = state.rendererInFlightTotalChars
    state.rendererLifecycleResetCount += 1
    // Why release before clearing: pending bytes and credits belonged to the dead page; releasing producer pauses first keeps no shell wedged.
    state.producerFlowControl.releaseAll()
    clearDeliveryResyncProbe()
    state.deliveryResyncUnansweredWarnLogged = false
    for (const id of state.rendererDeliveryAccountingByPty.keys()) {
      state.sshOutputIntake?.transferPtyProjections(id, 'renderer-lifecycle-reset')
    }
    state.rendererDeliveryAccountingByPty.clear()
    state.rendererInFlightTotalChars = 0
    clearPendingPtyData()
    state.pendingOverflowMarkedPtys.clear()
    state.rendererDeliveryRestoreNeededPtys.clear()
    // Why hold sends: the reloading page's pty:data listener is gone until it re-registers/handshakes, so bytes would drop into a listener-less page and re-pin the gate.
    state.rendererPtyDispatcherReady = false
    // Why: arm the diagnostic watchdog so a never-arriving handshake is observable; only the real handshake cancels it and opens the gate.
    state.armDispatcherReadyWatchdog()
  }
  state.readPtyRendererDeliveryDebugSnapshot = readCurrentPtyRendererDeliveryDebugSnapshot
  state.resetPtyRendererDeliveryDebugSnapshot = resetPtyRendererDeliveryDebugSnapshot
  ptyRuntimeState.resetRendererDeliveryAccountingForLifecycleReset =
    resetRendererDeliveryAccountingForLifecycleReset
  setPtyRendererDeliveryDebugBridges({
    read: readCurrentPtyRendererDeliveryDebugSnapshot,
    reset: resetPtyRendererDeliveryDebugSnapshot,
    resetAccounting: resetRendererDeliveryAccountingForLifecycleReset
  })
  function canSendPtyDataToRenderer(id: string, options: { interactive?: boolean } = {}): boolean {
    const totalLimit =
      PTY_RENDERER_TOTAL_IN_FLIGHT_HIGH_WATER_CHARS +
      (options.interactive === true ? PTY_RENDERER_INTERACTIVE_RESERVE_CHARS : 0)
    // Why per-PTY (not global) reserve: keep one active pane responsive without letting every background pane burst past the cap.
    const ptyLimit =
      PTY_RENDERER_IN_FLIGHT_HIGH_WATER_CHARS +
      (options.interactive === true ? PTY_RENDERER_ACTIVE_PTY_IN_FLIGHT_RESERVE_CHARS : 0)
    return (
      getRendererInFlightCharsForPty(id) < ptyLimit && state.rendererInFlightTotalChars < totalLimit
    )
  }

  function schedulePendingDataAfterCreditReport(creditedAny: boolean): void {
    if (creditedAny) {
      state.pendingData.reactivateBlocked()
    }
    if (state.pendingData.size > 0 && !state.flushTimer) {
      state.schedulePendingDataFlush(0)
    }
  }

  Object.assign(state, {
    transitionHiddenRendererPtyDeliveryState,
    transitionSpawnHiddenRendererPtyDeliveryState,
    updateProducerFlowControl,
    syncPtyBackgroundedDelivery,
    resyncBackgroundedDeliveriesAfterGateReset,
    readCurrentPtyRendererDeliveryDebugSnapshot,
    buildMainDeliveryDiagnostics,
    canSendPtyDataToRenderer,
    applyCumulativeAck,
    requestDeliveryResyncForGatedPty,
    writeOffLostRendererDelivery,
    recordPtyRendererDeliveryPressure,
    makePtyDataPayload,
    getPtyPayloadCharCount,
    getRendererInFlightCharsForPty,
    setPendingPtyData,
    deletePendingPtyData,
    clearPendingPtyDataForPty: (id: string) => clearPendingPtyDataForPty(state, id),
    schedulePendingDataAfterCreditReport,
    clearDeliveryResyncProbe,
    warnIfDroppingHiddenBytesForVisiblePty,
    shouldSendInteractiveOutputNow: rendererDeliveryInteractive.shouldSendInteractiveOutputNow
  })
  return state
}
