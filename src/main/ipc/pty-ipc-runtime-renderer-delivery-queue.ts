import {
  recordHiddenRendererPtyDataDrop,
  shouldDropHiddenRendererPtyData
} from './pty-hidden-delivery-gate'
import { terminalOutputBacklogCapChars } from '../../shared/terminal-scrollback-policy'
import type { PtyModelRestoreReason } from '../../shared/pty-model-restore-marker'
import { ptyRuntimeState } from './pty-ipc-runtime-state'
import { getPtyRegistrationSharedState } from './pty-ipc-runtime-registration-shared-state'
import { propagatePendingProjectionRemainder } from './pty-pending-projection-admissions'
import type {
  PtyRendererDeliveryContext,
  PtyDataPayload
} from './pty-ipc-runtime-renderer-delivery-context'
import { redactPtyIdForDiagnostics } from '../../shared/pty-delivery-diagnostics'
import { createPtyRendererPendingQueue } from './pty-ipc-runtime-renderer-delivery-pending-queue'
import { splitPtyPendingDataChunk } from './pty-ipc-runtime-renderer-delivery-chunking'
export {
  canCoalescePtyData,
  preservePtyIncarnationId
} from './pty-ipc-runtime-renderer-delivery-coalescing'
import {
  PTY_BATCH_DRAIN_CONTINUE_MS,
  PTY_BATCH_FLUSH_CHUNK_CHARS,
  PTY_BATCH_FLUSH_MAX_WRITES,
  PTY_DISPATCHER_READY_WATCHDOG_MS
} from './pty-ipc-runtime-renderer-delivery-constants'

export function installPtyRendererDeliveryQueue(): PtyRendererDeliveryContext {
  const state = getPtyRegistrationSharedState() as PtyRendererDeliveryContext
  const { mainWindow, runtime, getSettings } = state
  const mainDeliveryBreadcrumbs = ptyRuntimeState.mainDeliveryBreadcrumbs
  const pendingDataCapChars = (): number =>
    terminalOutputBacklogCapChars(getSettings?.().terminalScrollbackRows)
  const {
    getDroppedMode2031RendererData,
    updatePendingProjectionAdmissions,
    compactPendingProjectionState,
    pendingProjectionAdmissionOptions,
    appendPendingPtyData
  } = createPtyRendererPendingQueue(state, pendingDataCapChars)

  function sendPtyDataToRenderer(
    id: string,
    payload: PtyDataPayload,
    projectionAdmissionIds?: readonly string[]
  ): { sent: boolean; projectionsTransferred: boolean } {
    const charCount = state.getPtyPayloadCharCount(payload)
    const incarnationId = payload.incarnationId
    if (
      incarnationId === undefined &&
      (ptyRuntimeState.ptyIncarnationById.has(id) ||
        ptyRuntimeState.pendingPtyIncarnationById.has(id))
    ) {
      if (projectionAdmissionIds) {
        state.sshOutputIntake?.transferProjections(projectionAdmissionIds, 'identity-less-stale')
      }
      return { sent: false, projectionsTransferred: projectionAdmissionIds !== undefined }
    }
    const accounting = state.rendererDeliveryAccountingByPty.get(id)
    if (accounting && accounting.incarnationId !== incarnationId) {
      // A delayed frame from an older incarnation must not enter the replacement's accounting.
      if (projectionAdmissionIds) {
        state.sshOutputIntake?.transferProjections(projectionAdmissionIds, 'stale-incarnation')
      }
      return { sent: false, projectionsTransferred: projectionAdmissionIds !== undefined }
    }
    const hadAccounting = accounting !== undefined
    if (accounting) {
      accounting.incarnationId ??= incarnationId
      accounting.sentChars += charCount
      accounting.lastSendAtMs = Date.now()
    } else {
      state.rendererDeliveryAccountingByPty.set(id, {
        ...(incarnationId ? { incarnationId } : {}),
        sentChars: charCount,
        ackedChars: 0,
        lastSendAtMs: Date.now(),
        lastAckAtMs: null
      })
    }
    state.rendererInFlightTotalChars += charCount
    state.recordPtyRendererDeliveryPressure(id)
    try {
      mainWindow.webContents.send(
        'pty:data',
        incarnationId === undefined ? payload : { ...payload, incarnationId }
      )
    } catch (error) {
      const current = state.rendererDeliveryAccountingByPty.get(id)
      if (current) {
        const inFlightBeforeRollback = current.sentChars - current.ackedChars
        current.sentChars = Math.max(0, current.sentChars - charCount)
        current.ackedChars = Math.min(current.ackedChars, current.sentChars)
        const inFlightAfterRollback = current.sentChars - current.ackedChars
        state.rendererInFlightTotalChars = Math.max(
          0,
          state.rendererInFlightTotalChars - (inFlightBeforeRollback - inFlightAfterRollback)
        )
        if (!hadAccounting && current.sentChars === 0) {
          state.rendererDeliveryAccountingByPty.delete(id)
        }
      }
      state.rendererDeliveryRestoreNeededPtys.add(id)
      if (projectionAdmissionIds) {
        state.sshOutputIntake?.transferProjections(projectionAdmissionIds, 'renderer-send-failed')
      }
      mainDeliveryBreadcrumbs.record('pty-data-send-failed', {
        id: redactPtyIdForDiagnostics(id),
        chars: charCount
      })
      console.error('[pty] renderer data send failed; payload will not be retried', error)
      return { sent: false, projectionsTransferred: projectionAdmissionIds !== undefined }
    }
    let projectionsTransferred = false
    if (projectionAdmissionIds) {
      try {
        state.sshOutputIntake?.publishProjectionPrefix(
          projectionAdmissionIds,
          payload.data.length,
          charCount
        )
      } catch {
        state.sshOutputIntake?.transferProjections(
          projectionAdmissionIds,
          'projection-publish-failed'
        )
        projectionsTransferred = true
      }
    }
    if (state.rendererDeliveryRestoreNeededPtys.has(id)) {
      try {
        sendModelRestoreNeededMarker(id, 'delivery-heal', runtime?.getPtyOutputSequence(id))
        state.rendererDeliveryRestoreNeededPtys.delete(id)
      } catch (error) {
        console.error(
          '[pty] renderer delivery-heal marker send failed; restore remains pending',
          error
        )
      }
    }
    return { sent: true, projectionsTransferred }
  }

  function rendererPtyIsKnownHidden(id: string): boolean {
    return (
      ptyRuntimeState.rendererVisibilityKnownPtys.has(id) &&
      !ptyRuntimeState.visibleRendererPtys.has(id)
    )
  }

  function ptyHasHiddenRendererResizeOutput(id: string): boolean {
    return (
      ptyRuntimeState.pendingHiddenRendererResizeOutputPtys.has(id) ||
      ptyRuntimeState.deliveredHiddenRendererResizeOutputPtys.has(id)
    )
  }

  function markHiddenRendererResizeOutputDelivered(id: string): void {
    if (!ptyRuntimeState.pendingHiddenRendererResizeOutputPtys.delete(id)) {
      return
    }
    ptyRuntimeState.deliveredHiddenRendererResizeOutputPtys.add(id)
  }

  function clearDeliveredHiddenRendererResizeOutput(id: string): void {
    ptyRuntimeState.deliveredHiddenRendererResizeOutputPtys.delete(id)
  }

  function clearHiddenRendererResizeOutput(id: string): void {
    ptyRuntimeState.pendingHiddenRendererResizeOutputPtys.delete(id)
    ptyRuntimeState.deliveredHiddenRendererResizeOutputPtys.delete(id)
  }

  // Why out-of-band (not pty:data): an in-band empty chunk is indistinguishable from one fully consumed by renderer-side OSC-9999 stripping, which spuriously restored visible panes.
  function sendModelRestoreNeededMarker(
    id: string,
    reason: PtyModelRestoreReason,
    markerSeq: number | undefined
  ): void {
    if (mainWindow.isDestroyed()) {
      return
    }
    mainWindow.webContents.send('pty:modelRestoreNeeded', {
      id,
      reason,
      ...(typeof markerSeq === 'number' ? { markerSeq } : {})
    })
  }

  function schedulePendingDataFlush(delayMs: number): void {
    if (state.flushTimer) {
      return
    }
    state.flushTimer = setTimeout(flushPendingData, delayMs)
  }

  function invalidatePendingPtyDrainClassification(id?: string, schedule = true): void {
    const invalidated =
      typeof id === 'string' ? state.pendingData.invalidate(id) : state.pendingData.invalidateAll()
    if (invalidated && schedule && !state.flushTimer) {
      schedulePendingDataFlush(0)
    }
  }
  ptyRuntimeState.invalidatePendingPtyDrainPriority = invalidatePendingPtyDrainClassification
  ptyRuntimeState.invalidatePendingPtyDrainPolicy = invalidatePendingPtyDrainClassification

  function clearDispatcherReadyWatchdog(): void {
    if (state.dispatcherReadyWatchdogTimer) {
      clearTimeout(state.dispatcherReadyWatchdogTimer)
      state.dispatcherReadyWatchdogTimer = null
    }
  }

  function armDispatcherReadyWatchdog(): void {
    clearDispatcherReadyWatchdog()
    if (mainWindow.isDestroyed()) {
      return
    }
    // Why: timeout is diagnostic only; without renderer proof, opening the gate would drop pending bytes into a listener-less page. Unref'd so it can't keep the process alive.
    state.dispatcherReadyWatchdogTimer = setTimeout(() => {
      state.dispatcherReadyWatchdogTimer = null
      if (state.rendererPtyDispatcherReady || mainWindow.isDestroyed()) {
        return
      }
      state.rendererDispatcherReadyTimeoutCount += 1
      mainDeliveryBreadcrumbs.record('renderer-dispatcher-ready-timeout', {
        pendingPtyCount: state.pendingData.size,
        pendingChars: state.pendingData.totalPendingChars
      })
    }, PTY_DISPATCHER_READY_WATCHDOG_MS)
    state.dispatcherReadyWatchdogTimer.unref?.()
  }

  function flushPendingData(): void {
    state.flushTimer = null
    if (mainWindow.isDestroyed()) {
      // Why release now: bookkeeping is being wiped, so no future drain can resume these producers — local shells would wedge.
      state.producerFlowControl.releaseAll()
      state.clearDeliveryResyncProbe()
      state.clearPendingPtyData()
      state.pendingOverflowMarkedPtys.clear()
      state.rendererDeliveryAccountingByPty.clear()
      state.rendererInFlightTotalChars = 0
      clearDispatcherReadyWatchdog()
      return
    }
    // Ordinary boot-window data is blocked in the queue; hidden-droppable entries still retire before renderer readiness.
    const settings = getSettings?.()
    let writes = 0
    let sendFailed = false
    const round = state.pendingData.beginRound()
    let creditReleasedDuringFlush = false
    state.pendingDataFlushActive = true
    state.pendingDataCreditReleasedDuringFlush = false
    try {
      while (writes < PTY_BATCH_FLUSH_MAX_WRITES) {
        const selection = state.pendingData.takeNext(round)
        if (!selection) {
          break
        }
        const { id, pending } = selection
        // Why drop, never re-queue: the model already ingested hidden-gated bytes; reveal restores from the snapshot+seq machinery.
        if (shouldDropHiddenRendererPtyData(id, settings)) {
          state.pendingData.remove(selection)
          state.pendingOverflowMarkedPtys.delete(id)
          state.updateProducerFlowControl(id)
          const drop = recordHiddenRendererPtyDataDrop(id, pending.data.length)
          if (pending.projectionAdmissionIds) {
            state.sshOutputIntake?.transferProjections(
              pending.projectionAdmissionIds,
              'hidden-drop'
            )
          }
          state.warnIfDroppingHiddenBytesForVisiblePty(id, pending.data.length)
          if (drop.shouldEmitRestoreMarker) {
            sendModelRestoreNeededMarker(id, 'hidden-drop', runtime?.getPtyOutputSequence(id))
          }
          continue
        }
        if (
          !state.canSendPtyDataToRenderer(id, {
            interactive: ptyRuntimeState.activeRendererPtys.has(id)
          })
        ) {
          state.pendingData.block(selection)
          continue
        }
        if (pending.droppedOutput === true) {
          state.pendingData.remove(selection)
          state.updateProducerFlowControl(id)
          // Why droppedOutput sentinel: pending-cap drop means the pane must repaint from the snapshot, not continue a gapped stream (data = carved query bytes only).
          if (
            !sendPtyDataToRenderer(
              id,
              {
                id,
                data: pending.data + getDroppedMode2031RendererData(pending),
                ...(pending.incarnationId ? { incarnationId: pending.incarnationId } : {}),
                droppedOutput: true
              },
              pending.projectionAdmissionIds
            ).sent
          ) {
            sendFailed = true
            break
          }
          writes++
          continue
        }
        const { chunk, remainder: nextPending } = splitPtyPendingDataChunk(
          pending,
          PTY_BATCH_FLUSH_CHUNK_CHARS
        )
        if (nextPending) {
          state.pendingData.replaceWithRemainder(selection, nextPending)
        } else {
          state.pendingData.remove(selection)
          state.pendingOverflowMarkedPtys.delete(id)
        }
        state.updateProducerFlowControl(id)
        const delivery = sendPtyDataToRenderer(
          id,
          state.makePtyDataPayload(
            id,
            chunk,
            pending.startSeq,
            pending.containsBackgroundOutput,
            pending.rawLength,
            pending.transformed,
            pending.incarnationId
          ),
          pending.projectionAdmissionIds
        )
        if (nextPending) {
          updatePendingProjectionAdmissions(
            nextPending,
            propagatePendingProjectionRemainder(
              nextPending,
              delivery,
              pendingProjectionAdmissionOptions()
            )
          )
        }
        if (!delivery.sent) {
          sendFailed = true
          break
        }
        writes++
      }
    } finally {
      state.pendingDataFlushActive = false
      creditReleasedDuringFlush = state.pendingDataCreditReleasedDuringFlush
      state.pendingDataCreditReleasedDuringFlush = false
      state.pendingData.endRound(round)
    }
    if (
      state.rendererPtyDispatcherReady &&
      state.pendingData.size > 0 &&
      writes === 0 &&
      !sendFailed
    ) {
      state.ackGatedFlushSkipCount++
    }
    if (sendFailed && state.pendingData.size > 0) {
      if (state.flushTimer) {
        clearTimeout(state.flushTimer)
        state.flushTimer = null
      }
      schedulePendingDataFlush(PTY_BATCH_DRAIN_CONTINUE_MS)
      return
    }
    if (state.pendingData.size > 0 && (writes > 0 || creditReleasedDuringFlush)) {
      // Why yield between slices: a background terminal can dump megabytes at once, and keystroke writes must not stall behind one flush.
      schedulePendingDataFlush(writes > 0 ? PTY_BATCH_DRAIN_CONTINUE_MS : 0)
    }
  }

  const clearFlushTimerIfIdle = (): void => {
    if (state.pendingData.size > 0 || state.flushTimer === null) {
      return
    }
    clearTimeout(state.flushTimer)
    state.flushTimer = null
  }

  Object.assign(state, {
    sendPtyDataToRenderer,
    rendererPtyIsKnownHidden,
    ptyHasHiddenRendererResizeOutput,
    markHiddenRendererResizeOutputDelivered,
    clearDeliveredHiddenRendererResizeOutput,
    clearHiddenRendererResizeOutput,
    sendModelRestoreNeededMarker,
    getDroppedMode2031RendererData,
    updatePendingProjectionAdmissions,
    compactPendingProjectionState,
    pendingProjectionAdmissionOptions,
    appendPendingPtyData,
    schedulePendingDataFlush,
    flushPendingData,
    clearFlushTimerIfIdle,
    clearDispatcherReadyWatchdog,
    armDispatcherReadyWatchdog
  })
  ptyRuntimeState.invalidatePendingPtyDrainPriority = invalidatePendingPtyDrainClassification
  ptyRuntimeState.invalidatePendingPtyDrainPolicy = invalidatePendingPtyDrainClassification
  ptyRuntimeState.clearRendererDispatcherReadyWatchdog = clearDispatcherReadyWatchdog
  return state
}
