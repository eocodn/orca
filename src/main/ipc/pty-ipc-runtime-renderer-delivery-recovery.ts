import type {
  PtyDeliveryWriteOff,
  PtyRendererDeliveryStateReport,
  PtyRendererReceivedChars
} from '../../shared/pty-renderer-delivery-health'
import type { PtyRendererDeliveryContext } from './pty-ipc-runtime-renderer-delivery-context'
import {
  PTY_DELIVERY_HEAL_MIN_ACK_SILENCE_MS,
  PTY_DELIVERY_RESYNC_TIMEOUT_MS
} from './pty-ipc-runtime-renderer-delivery-constants'
import { tryGetProviderForPty } from './pty-ipc-runtime-provider-routing'
import type { PtyRuntimeState } from './pty-ipc-runtime-state'

type RendererDeliveryRecoveryOptions = {
  state: PtyRendererDeliveryContext
  runtime: PtyRendererDeliveryContext['runtime']
  mainWindow: PtyRendererDeliveryContext['mainWindow']
  mainDeliveryBreadcrumbs: PtyRuntimeState['mainDeliveryBreadcrumbs']
  readCurrentPtyRendererDeliveryDebugSnapshot: () => unknown
  deletePendingPtyData: (id: string) => void
  updateProducerFlowControl: (id: string) => void
}

export function createPtyRendererDeliveryRecovery({
  state,
  runtime,
  mainWindow,
  mainDeliveryBreadcrumbs,
  readCurrentPtyRendererDeliveryDebugSnapshot,
  deletePendingPtyData,
  updateProducerFlowControl
}: RendererDeliveryRecoveryOptions) {
  function getRendererInFlightCharsForPty(id: string): number {
    const accounting = state.rendererDeliveryAccountingByPty.get(id)
    return accounting ? accounting.sentChars - accounting.ackedChars : 0
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

  // Cumulative ACKs are max-merged so replayed and out-of-order reports remain idempotent.
  function applyCumulativeAck(id: string, processedChars: number, incarnationId?: string): number {
    const accounting = state.rendererDeliveryAccountingByPty.get(id)
    if (!accounting || accounting.incarnationId !== incarnationId) {
      return 0
    }
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

  function clearDeliveryResyncProbe(): void {
    state.deliveryResyncOutstandingRequestId = null
    if (state.deliveryResyncTimer) {
      clearTimeout(state.deliveryResyncTimer)
      state.deliveryResyncTimer = null
    }
  }

  // A gated PTY asks the renderer for authoritative totals instead of guessing from elapsed time.
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
      // An unanswered probe is not success; only a renderer lifecycle reset can recover it.
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

  // Write off bytes confirmed lost in the push channel, then hand the PTY back to snapshot restore.
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
      if (receivedChars > accounting.ackedChars) {
        continue
      }
      const acknowledged = applyCumulativeAck(id, accounting.sentChars, accounting.incarnationId)
      if (acknowledged <= 0) {
        continue
      }
      tryGetProviderForPty(id)?.acknowledgeDataEvent(id, acknowledged)
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

  return {
    applyCumulativeAck,
    clearDeliveryResyncProbe,
    getRendererInFlightCharsForPty,
    requestDeliveryResyncForGatedPty,
    writeOffLostRendererDelivery
  }
}
