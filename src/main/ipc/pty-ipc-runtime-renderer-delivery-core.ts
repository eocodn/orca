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
import type {
  PtyRendererDeliveryContext,
  PtyDataPayload
} from './pty-ipc-runtime-renderer-delivery-context'
import type {
  PtyDeliveryWriteOff,
  PtyRendererDeliveryStateReport,
  PtyRendererReceivedChars
} from '../../shared/pty-renderer-delivery-health'
import { recordDaemonStreamBacklogEvent } from '../daemon/daemon-stream-backlog-probe'
import { createPtyRendererHiddenDeliveryTransitions } from './pty-ipc-runtime-renderer-hidden-delivery-state'
import { clearPendingPtyDataForPty } from './pty-ipc-runtime-clear-buffer-fence'
import { createPtyRendererDeliveryDiagnostics } from './pty-ipc-runtime-renderer-delivery-diagnostics'
import {
  PTY_DELIVERY_RESYNC_TIMEOUT_MS,
  PTY_BATCH_FLUSH_CHUNK_CHARS,
  PTY_RENDERER_ACTIVE_PTY_IN_FLIGHT_RESERVE_CHARS,
  PTY_RENDERER_IN_FLIGHT_HIGH_WATER_CHARS,
  INTERACTIVE_OUTPUT_BUDGET_CHARS,
  INTERACTIVE_OUTPUT_MAX_CHARS,
  INTERACTIVE_OUTPUT_WINDOW_MS,
  PTY_RENDERER_INTERACTIVE_RESERVE_CHARS,
  PTY_RENDERER_TOTAL_IN_FLIGHT_HIGH_WATER_CHARS,
  PTY_DELIVERY_HEAL_MIN_ACK_SILENCE_MS
} from './pty-ipc-runtime-renderer-delivery-constants'

const PRODUCER_FLOW_CONTROL_ENABLED = true
const INTERACTIVE_REDRAW_MAX_CHARS = PTY_BATCH_FLUSH_CHUNK_CHARS

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
      if (caller.endsWith(':on')) rendererDeliveryInterestPtys.add(id)
      else rendererDeliveryInterestPtys.delete(id)
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
  function isLikelyInteractiveRedraw(data: string): boolean {
    if (data.length <= INTERACTIVE_OUTPUT_MAX_CHARS) {
      return true
    }
    // Why the ANSI check: Codex-style TUIs repaint >1 KB per keypress (latency-sensitive), while plain command output should stay on the throughput batch path.
    return data.length <= INTERACTIVE_REDRAW_MAX_CHARS && data.includes('\x1b[')
  }

  function shouldSendInteractiveOutputNow(id: string, data: string, now: number): boolean {
    const lastInputAt = ptyRuntimeState.lastInputAtByPty.get(id)
    if (lastInputAt === undefined || now - lastInputAt > INTERACTIVE_OUTPUT_WINDOW_MS) {
      ptyRuntimeState.interactiveOutputCharsByPty.delete(id)
      return false
    }
    if (!isLikelyInteractiveRedraw(data)) {
      ptyRuntimeState.interactiveOutputCharsByPty.set(id, INTERACTIVE_OUTPUT_BUDGET_CHARS)
      return false
    }
    const usedChars = ptyRuntimeState.interactiveOutputCharsByPty.get(id) ?? 0
    if (usedChars + data.length > INTERACTIVE_OUTPUT_BUDGET_CHARS) {
      ptyRuntimeState.interactiveOutputCharsByPty.set(id, INTERACTIVE_OUTPUT_BUDGET_CHARS)
      return false
    }
    ptyRuntimeState.interactiveOutputCharsByPty.set(id, usedChars + data.length)
    return true
  }

  function makePtyDataPayload(
    id: string,
    data: string,
    startSeq: number | undefined,
    containsBackgroundOutput: boolean | undefined,
    rawLength = data.length,
    transformed = false,
    incarnationId?: string
  ): PtyDataPayload {
    const resolvedIncarnationId = incarnationId ?? ptyRuntimeState.ptyIncarnationById.get(id)
    const payload: PtyDataPayload = {
      id,
      ...(resolvedIncarnationId ? { incarnationId: resolvedIncarnationId } : {}),
      data
    }
    if (typeof startSeq === 'number') {
      payload.seq = startSeq + rawLength
    }
    if (typeof startSeq === 'number' || rawLength !== data.length || transformed) {
      payload.rawLength = rawLength
    }
    if (transformed) {
      payload.transformed = true
    }
    if (containsBackgroundOutput === true) {
      payload.background = true
    }
    return payload
  }

  function getPtyPayloadCharCount(payload: { data: string; rawLength?: number }): number {
    return Math.max(0, payload.rawLength ?? payload.data.length)
  }

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

  function getOldestInFlightAckSilenceMs(): number | null {
    const now = Date.now()
    let oldest: number | null = null
    for (const accounting of state.rendererDeliveryAccountingByPty.values()) {
      if (accounting.sentChars <= accounting.ackedChars) {
        continue
      }
      const silence = accounting.lastAckAtMs === null ? null : now - accounting.lastAckAtMs
      if (silence === null) {
        return null
      }
      oldest = Math.max(oldest ?? 0, silence)
    }
    return oldest
  }

  // Why max-merge cumulative totals: idempotent and reorder-tolerant — replayed/out-of-order ACKs can't double-credit and a lost ACK self-heals. Returns the newly acknowledged delta.
  function applyCumulativeAck(id: string, processedChars: number, incarnationId?: string): number {
    const accounting = state.rendererDeliveryAccountingByPty.get(id)
    if (!accounting || accounting.incarnationId !== incarnationId) {
      return 0
    }
    // Clamped to sentChars so a corrupt payload cannot drive in-flight negative.
    const nextAckedChars = Math.min(
      accounting.sentChars,
      Math.max(accounting.ackedChars, processedChars)
    )
    const acknowledged = nextAckedChars - accounting.ackedChars
    accounting.ackedChars = nextAckedChars
    if (acknowledged > 0) {
      accounting.lastAckAtMs = Date.now()
    }
    state.rendererInFlightTotalChars = Math.max(0, state.rendererInFlightTotalChars - acknowledged)
    if (acknowledged > 0) {
      state.sshOutputIntake?.settleProjectionPrefix(id, acknowledged)
    }
    return acknowledged
  }

  function schedulePendingDataAfterCreditReport(creditedAny: boolean): void {
    if (creditedAny) {
      state.pendingData.reactivateBlocked()
    }
    if (state.pendingData.size > 0 && !state.flushTimer) {
      state.schedulePendingDataFlush(0)
    }
  }

  function clearDeliveryResyncProbe(): void {
    state.deliveryResyncOutstandingRequestId = null
    if (state.deliveryResyncTimer) {
      clearTimeout(state.deliveryResyncTimer)
      state.deliveryResyncTimer = null
    }
  }

  // Why: data for a fully gated PTY signals delivery may be stuck on lost ACKs (e.g. dropped across suspend); ask the renderer for authoritative totals instead of a wall-clock guess.
  function requestDeliveryResyncForGatedPty(): void {
    if (state.deliveryResyncOutstandingRequestId !== null || mainWindow.isDestroyed()) {
      return
    }
    state.deliveryResyncRequestSerial += 1
    const requestId = state.deliveryResyncRequestSerial
    state.deliveryResyncOutstandingRequestId = requestId
    state.deliveryResyncTimer = setTimeout(() => {
      if (state.deliveryResyncOutstandingRequestId !== requestId) {
        return
      }
      clearDeliveryResyncProbe()
      // Why no mutation on timeout: unanswered means dead IPC that only a reload cures; log once per silent streak to avoid spamming every probe.
      if (state.deliveryResyncUnansweredWarnLogged) {
        return
      }
      state.deliveryResyncUnansweredWarnLogged = true
      console.warn('[pty] delivery resync probe unanswered — renderer IPC unresponsive', {
        msSinceLastAck: getOldestInFlightAckSilenceMs(),
        ...readCurrentPtyRendererDeliveryDebugSnapshot()
      })
    }, PTY_DELIVERY_RESYNC_TIMEOUT_MS)
    state.deliveryResyncTimer.unref?.()
    mainWindow.webContents.send('pty:requestDeliveryResync', { requestId })
  }

  function isReceivedCharsForIncarnation(
    received: number | PtyRendererReceivedChars | undefined,
    incarnationId: string | undefined
  ): received is PtyRendererReceivedChars {
    return (
      typeof received !== 'number' &&
      received !== undefined &&
      received.incarnationId === incarnationId
    )
  }

  // Why write off: bytes sent but never received after a confirmed wedge are gone (no ACK can repay them); hand back restore markers so panes repaint from the snapshot.
  function writeOffLostRendererDelivery(
    report: PtyRendererDeliveryStateReport
  ): PtyDeliveryWriteOff[] {
    const writtenOff: PtyDeliveryWriteOff[] = []
    for (const [id, accounting] of state.rendererDeliveryAccountingByPty) {
      if (accounting.sentChars - accounting.ackedChars <= 0) {
        continue
      }
      if (
        accounting.lastAckAtMs !== null &&
        Date.now() - accounting.lastAckAtMs < PTY_DELIVERY_HEAL_MIN_ACK_SILENCE_MS
      ) {
        continue
      }
      const received = report.receivedCharsByPty?.[id]
      let receivedChars = 0
      if (typeof received === 'number' && Number.isFinite(received)) {
        receivedChars = Math.max(0, received)
      } else if (isReceivedCharsForIncarnation(received, accounting.incarnationId)) {
        receivedChars = Math.max(0, received.receivedChars)
      }
      // Why skip: received-but-unparsed bytes are alive in the renderer write queue; their deferred ACK still repays this debt.
      if (receivedChars > accounting.ackedChars) {
        continue
      }
      const acknowledged = applyCumulativeAck(id, accounting.sentChars, accounting.incarnationId)
      if (acknowledged <= 0) {
        continue
      }
      tryGetProviderForPty(id)?.acknowledgeDataEvent(id, acknowledged)
      // Why drop pending: everything at/before markerSeq comes from the snapshot, so flushing pre-marker bytes would double-paint the restore.
      const pending = state.pendingData.get(id)
      if (pending) {
        if (pending.projectionAdmissionIds) {
          state.sshOutputIntake?.transferProjections(
            pending.projectionAdmissionIds,
            'renderer-delivery-writeoff'
          )
        }
        state.pendingDroppedChars += pending.data.length
        deletePendingPtyData(id)
        state.pendingOverflowMarkedPtys.delete(id)
        updateProducerFlowControl(id)
      }
      const markerSeq = runtime?.getPtyOutputSequence(id)
      writtenOff.push({
        id,
        ...(typeof markerSeq === 'number' ? { markerSeq } : {}),
        writtenOffChars: acknowledged
      })
    }
    if (writtenOff.length > 0) {
      clearDeliveryResyncProbe()
      state.deliveryResyncUnansweredWarnLogged = false
      mainDeliveryBreadcrumbs.record('delivery-heal-writeoff', {
        writtenOffPtyCount: writtenOff.length,
        writtenOffChars: writtenOff.reduce((sum, { writtenOffChars }) => sum + writtenOffChars, 0)
      })
      console.warn('[pty] delivery heal: wrote off renderer-bound bytes lost in push channel', {
        rendererPtyDataListenerCount: report.rendererPtyDataListenerCount ?? null,
        msSinceLastAck: getOldestInFlightAckSilenceMs(),
        writtenOffByPty: writtenOff.map(({ id, writtenOffChars }) => ({ id, writtenOffChars })),
        ...readCurrentPtyRendererDeliveryDebugSnapshot()
      })
    }
    return writtenOff
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
    shouldSendInteractiveOutputNow
  })
  return state
}
