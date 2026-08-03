import type { LegacySshProjectionSemantics } from './ssh-pty-legacy-projection'
import {
  recordHiddenRendererPtyDataDrop,
  shouldDropHiddenRendererPtyData
} from './pty-hidden-delivery-gate'
import { ptyRuntimeState } from './pty-ipc-runtime-state'
import { getPtyRegistrationSharedState } from './pty-ipc-runtime-registration-shared-state'
import type { PtyRendererDeliveryContext, PtyShutdownTarget } from './pty-ipc-runtime-renderer-delivery-context'
import {
  PTY_BATCH_INTERVAL_MS
} from './pty-ipc-runtime-renderer-delivery-constants'

const SYNTHETIC_KILL_EXIT_DUPLICATE_WINDOW_MS = 30_000

export function installPtyRendererExitHandling(): PtyRendererDeliveryContext {
  const state = getPtyRegistrationSharedState() as PtyRendererDeliveryContext
  const { mainWindow, runtime, getSettings } = state
  const mainDeliveryBreadcrumbs = ptyRuntimeState.mainDeliveryBreadcrumbs
  state.syntheticKillExitPtyIds = new Map()
  state.finalizedCleanupExitPtyIds = new Map()
  state.reversibleStopOwnersByPtyId = new Map()


  function rememberSyntheticKillExit(id: string, target: PtyShutdownTarget): void {
    const existing = state.syntheticKillExitPtyIds.get(id)
    if (existing) {
      clearTimeout(existing.cleanupTimer)
    }
    // Why a timed window: providers may report the real exit after kill completes; skip only that late duplicate, not a future reused id forever.
    const cleanupTimer = setTimeout(() => {
      if (state.syntheticKillExitPtyIds.get(id)?.cleanupTimer === cleanupTimer) {
        state.syntheticKillExitPtyIds.delete(id)
      }
    }, SYNTHETIC_KILL_EXIT_DUPLICATE_WINDOW_MS)
    cleanupTimer.unref?.()
    state.syntheticKillExitPtyIds.set(id, {
      stateToken: target.stateToken,
      ...(target.incarnationId ? { incarnationId: target.incarnationId } : {}),
      cleanupTimer
    })
  }

  function consumeSyntheticKillExit(payload: {
    id: string
    incarnationId?: string
    ptyIncarnation?: string
  }): boolean {
    const marker = state.syntheticKillExitPtyIds.get(payload.id)
    if (!marker) {
      return false
    }
    const incarnationId = payload.incarnationId ?? payload.ptyIncarnation
    const matches =
      marker.incarnationId !== undefined
        ? incarnationId === marker.incarnationId
        : incarnationId === undefined && ptyRuntimeState.ptyStateTokenById.get(payload.id) === marker.stateToken
    if (!matches) {
      return false
    }
    clearTimeout(marker.cleanupTimer)
    state.syntheticKillExitPtyIds.delete(payload.id)
    return true
  }

  function rememberFinalizedCleanupExit(id: string, incarnationId: string): void {
    const existing = state.finalizedCleanupExitPtyIds.get(id)
    if (existing) {
      clearTimeout(existing.cleanupTimer)
    }
    // Why a bounded marker: publication cleanup can finish before the provider reports the same physical exit.
    const cleanupTimer = setTimeout(() => {
      const current = state.finalizedCleanupExitPtyIds.get(id)
      if (current?.cleanupTimer === cleanupTimer) {
        state.finalizedCleanupExitPtyIds.delete(id)
      }
    }, SYNTHETIC_KILL_EXIT_DUPLICATE_WINDOW_MS)
    cleanupTimer.unref?.()
    state.finalizedCleanupExitPtyIds.set(id, { incarnationId, cleanupTimer })
  }

  function consumeFinalizedCleanupExit(payload: { id: string; incarnationId?: string }): boolean {
    const finalized = state.finalizedCleanupExitPtyIds.get(payload.id)
    if (!finalized || finalized.incarnationId !== payload.incarnationId) {
      return false
    }
    clearTimeout(finalized.cleanupTimer)
    state.finalizedCleanupExitPtyIds.delete(payload.id)
    return true
  }

  function preparePtyExitForRenderer(payload: { id: string; code: number }): (() => void) | null {
    if (mainWindow.isDestroyed()) {
      state.sshOutputIntake?.transferPtyProjections(payload.id, 'renderer-destroyed')
      return () => {}
    }
    if (state.rendererExitingPtyIds.has(payload.id)) {
      return null
    }
    state.rendererExitingPtyIds.add(payload.id)
    let released = false
    const release = (): void => {
      if (released) {
        return
      }
      released = true
      state.rendererExitingPtyIds.delete(payload.id)
    }
    try {
      if (!state.rendererCreditBeforeExitByPty.has(payload.id)) {
        state.rendererCreditBeforeExitByPty.set(
          payload.id,
          state.getRendererInFlightCharsForPty(payload.id) > 0
        )
      }
      // Why flush before exit: the renderer tears down the terminal on pty:exit, so any batched output not yet flushed would be silently lost.
      const remaining = state.pendingData.delete(payload.id)
      state.clearFlushTimerIfIdle()
      if (remaining) {
        if (remaining.droppedOutput === true) {
          // Sentinel entry: only salvaged query bytes remain; keep the flag so the renderer knows the span was dropped.
          state.sendPtyDataToRenderer(
            payload.id,
            {
              id: payload.id,
              data: remaining.data,
              droppedOutput: true
            },
            remaining.projectionAdmissionIds
          )
        } else {
          state.sendPtyDataToRenderer(
            payload.id,
            state.makePtyDataPayload(
              payload.id,
              remaining.data,
              remaining.startSeq,
              remaining.containsBackgroundOutput,
              remaining.rawLength,
              remaining.transformed
            ),
            remaining.projectionAdmissionIds
          )
        }
      }
      return release
    } catch (error) {
      release()
      throw error
    }
  }

  function finalizePtyExitForRenderer(payload: { id: string; code: number }): void {
    if (mainWindow.isDestroyed()) {
      state.rendererCreditBeforeExitByPty.delete(payload.id)
      return
    }
    const hadReleasableRendererCredit =
      state.rendererCreditBeforeExitByPty.get(payload.id) ??
      state.getRendererInFlightCharsForPty(payload.id) > 0
    state.rendererCreditBeforeExitByPty.delete(payload.id)
    // Why resume a dead PTY (no-op): avoid leaving a stale paused mark behind for a reused id.
    state.producerFlowControl.release(payload.id)
    state.sourceCreditPendingPtys.delete(payload.id)
    state.pendingOverflowMarkedPtys.delete(payload.id)
    state.rendererDeliveryRestoreNeededPtys.delete(payload.id)
    ptyRuntimeState.lastInputAtByPty.delete(payload.id)
    ptyRuntimeState.interactiveOutputCharsByPty.delete(payload.id)
    const releasedRendererCredit = state.getRendererInFlightCharsForPty(payload.id)
    state.rendererInFlightTotalChars = Math.max(0, state.rendererInFlightTotalChars - releasedRendererCredit)
    // Why: the renderer also drops its cumulative total on pty:exit, so a reused id restarts aligned at zero on both sides.
    state.rendererDeliveryAccountingByPty.delete(payload.id)
    if (hadReleasableRendererCredit) {
      if (state.pendingDataFlushActive) {
        // Why: let the open round coalesce this wake into its one post-round continuation.
        const reactivatedBlocked = state.pendingData.reactivateBlocked()
        state.pendingDataCreditReleasedDuringFlush ||= reactivatedBlocked
      } else {
        state.schedulePendingDataAfterCreditReport(true)
      }
    }
    mainWindow.webContents.send('pty:exit', {
      ...payload,
      ...(state.reversibleStopOwnersByPtyId.has(payload.id) ? { preserveRendererBinding: true } : {})
    })
  }

  function sendPtyExitToRenderer(payload: { id: string; code: number }): void {
    const release = preparePtyExitForRenderer(payload)
    if (!release) {
      return
    }
    try {
      state.sshOutputIntake?.transferPtyProjections(payload.id, 'legacy-pty-exit')
      finalizePtyExitForRenderer(payload)
    } finally {
      release()
    }
  }

  function sendPtySpawnedToRenderer(id: string): void {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pty:spawned', { id })
    }
  }

  function acceptPtyDataForRenderer(
    payload: {
      id: string
      data: string
      sequenceChars?: number
      transformed?: boolean
    },
    outputSeq: number | undefined,
    projection?: LegacySshProjectionSemantics
  ): void {
    const rawLength = payload.sequenceChars ?? payload.data.length
    const preservesSeq = !payload.transformed && rawLength === payload.data.length
    const startSeq = typeof outputSeq === 'number' ? Math.max(0, outputSeq - rawLength) : undefined
    const projectionId = projection?.identity.projectionSemanticsId
    if (mainWindow.isDestroyed()) {
      if (projectionId) {
        state.sshOutputIntake?.transferProjections([projectionId], 'renderer-destroyed')
      }
      if (state.flushTimer) {
        clearTimeout(state.flushTimer)
        state.flushTimer = null
      }
      state.producerFlowControl.releaseAll()
      state.clearDeliveryResyncProbe()
      state.clearPendingPtyData()
      state.pendingOverflowMarkedPtys.clear()
      state.rendererDeliveryAccountingByPty.clear()
      state.rendererInFlightTotalChars = 0
      state.clearRendererDispatcherReadyWatchdog()
      return
    }
    if (state.rendererExitingPtyIds.has(payload.id)) {
      if (projectionId) {
        state.sshOutputIntake?.transferProjections([projectionId], 'pty-exiting')
      }
      return
    }
    if (shouldDropHiddenRendererPtyData(payload.id, getSettings?.())) {
      if (projectionId) {
        state.sshOutputIntake?.transferProjections([projectionId], 'hidden-drop')
      }
      const droppedChars = projection ? rawLength : payload.data.length
      const drop = recordHiddenRendererPtyDataDrop(payload.id, droppedChars)
      state.warnIfDroppingHiddenBytesForVisiblePty(payload.id, droppedChars)
      if (drop.shouldEmitRestoreMarker) {
        state.sendModelRestoreNeededMarker(payload.id, 'hidden-drop', outputSeq)
      }
      return
    }
    if (payload.data.length === 0 && !payload.transformed) {
      if (projectionId) {
        state.sshOutputIntake?.transferProjections([projectionId], 'empty-projection')
      }
      return
    }
    const containsBackgroundOutput =
      state.rendererPtyIsKnownHidden(payload.id) || state.ptyHasHiddenRendererResizeOutput(payload.id)
    if (containsBackgroundOutput) {
      state.markHiddenRendererResizeOutputDelivered(payload.id)
    }
    const overflowMarkedBeforeAppend = state.pendingOverflowMarkedPtys.has(payload.id)
    if (projection?.desktopSpan) {
      state.sourceCreditPendingPtys.add(payload.id)
    }
    const pending = state.appendPendingPtyData(
      payload.id,
      state.pendingData.get(payload.id),
      payload.data,
      startSeq,
      preservesSeq,
      containsBackgroundOutput,
      rawLength,
      payload.transformed === true,
      projectionId
    )
    const shouldEmitPendingCapRestoreMarker =
      pending.droppedOutput === true &&
      !overflowMarkedBeforeAppend &&
      state.pendingOverflowMarkedPtys.has(payload.id)
    const nextData = pending.data + state.getDroppedMode2031RendererData(pending)
    const isInteractiveOutput = state.shouldSendInteractiveOutputNow(
      payload.id,
      nextData,
      performance.now()
    )
    if (isInteractiveOutput && state.rendererPtyDispatcherReady) {
      if (!state.canSendPtyDataToRenderer(payload.id, { interactive: true })) {
        state.setPendingPtyData(payload.id, pending)
        if (shouldEmitPendingCapRestoreMarker) {
          state.sendModelRestoreNeededMarker(payload.id, 'pending-cap', outputSeq)
        }
        state.updateProducerFlowControl(payload.id)
        state.requestDeliveryResyncForGatedPty()
        return
      }
      state.deletePendingPtyData(payload.id)
      state.clearFlushTimerIfIdle()
      if (shouldEmitPendingCapRestoreMarker) {
        state.sendModelRestoreNeededMarker(payload.id, 'pending-cap', outputSeq)
      }
      state.pendingOverflowMarkedPtys.delete(payload.id)
      try {
        state.sendPtyDataToRenderer(
          payload.id,
          {
            id: payload.id,
            data: nextData,
            ...(typeof pending.startSeq === 'number'
              ? {
                  seq: pending.startSeq + (pending.rawLength ?? nextData.length),
                  rawLength: pending.rawLength ?? nextData.length
                }
              : {}),
            ...(pending.transformed ? { transformed: true } : {}),
            ...(pending.containsBackgroundOutput === true ? { background: true } : {}),
            ...(pending.droppedOutput === true ? { droppedOutput: true } : {})
          },
          pending.projectionAdmissionIds
        )
      } finally {
        state.updateProducerFlowControl(payload.id)
      }
      return
    }
    state.setPendingPtyData(payload.id, pending)
    if (shouldEmitPendingCapRestoreMarker) {
      state.sendModelRestoreNeededMarker(payload.id, 'pending-cap', outputSeq)
    }
    state.updateProducerFlowControl(payload.id)
    if (
      !state.canSendPtyDataToRenderer(payload.id, { interactive: ptyRuntimeState.activeRendererPtys.has(payload.id) })
    ) {
      state.requestDeliveryResyncForGatedPty()
    }
    if (!state.flushTimer) {
      state.schedulePendingDataFlush(PTY_BATCH_INTERVAL_MS)
    }
  }

  Object.assign(state, {
    rememberSyntheticKillExit,
    consumeSyntheticKillExit,
    rememberFinalizedCleanupExit,
    consumeFinalizedCleanupExit,
    preparePtyExitForRenderer,
    finalizePtyExitForRenderer,
    sendPtyExitToRenderer,
    sendPtySpawnedToRenderer,
    acceptPtyDataForRenderer
  })
  return state
}
