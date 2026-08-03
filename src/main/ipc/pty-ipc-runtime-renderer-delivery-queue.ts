import {
  INITIAL_MODE_2031_REPLY_SCAN_STATE,
  scanMode2031ReplyDecision,
  type Mode2031ReplyScanState
} from '../../shared/terminal-color-scheme-protocol'
import { extractHiddenStartupRendererQueryData } from '../../shared/terminal-reply-query-extraction'
import {
  appendPendingProjectionAdmission,
  compactPendingProjectionAdmissions,
  propagatePendingProjectionRemainder
} from './pty-pending-projection-admissions'
import { recordCrashBreadcrumb } from '../crash-reporting/crash-breadcrumb-store'
import {
  recordHiddenRendererPtyDataDrop,
  shouldDropHiddenRendererPtyData,
  isHiddenPtyDeliveryGateEnabled
} from './pty-hidden-delivery-gate'
import { terminalOutputBacklogCapChars } from '../../shared/terminal-scrollback-policy'
import type { PtyModelRestoreReason } from '../../shared/pty-model-restore-marker'
import { ptyRuntimeState } from './pty-ipc-runtime-state'
import { getPtyRegistrationSharedState } from './pty-ipc-runtime-registration-shared-state'
import type { PendingPtyData } from './pty-pending-data-drain-queue'
import type { PendingProjectionAdmissions } from './pty-pending-projection-admissions'
import type {
  PtyRendererDeliveryContext,
  PtyDataPayload
} from './pty-ipc-runtime-renderer-delivery-context'
import { redactPtyIdForDiagnostics } from '../../shared/pty-delivery-diagnostics'
import {
  PTY_BATCH_DRAIN_CONTINUE_MS,
  PTY_BATCH_FLUSH_CHUNK_CHARS,
  PTY_BATCH_FLUSH_MAX_WRITES,
  PTY_DISPATCHER_READY_WATCHDOG_MS
} from './pty-ipc-runtime-renderer-delivery-constants'

const DROPPED_QUERY_SALVAGE_MAX_CHARS = 4096

export function canCoalescePtyData(
  existing: Pick<PendingPtyData, 'incarnationId'>,
  incarnationId?: string
): boolean {
  return existing.incarnationId === incarnationId
}

export function preservePtyIncarnationId<T extends object>(
  value: T,
  incarnationId: string | undefined
): T & Pick<PendingPtyData, 'incarnationId'> {
  return incarnationId === undefined ? value : { ...value, incarnationId }
}

export function installPtyRendererDeliveryQueue(): PtyRendererDeliveryContext {
  const state = getPtyRegistrationSharedState() as PtyRendererDeliveryContext
  const { mainWindow, runtime, getSettings } = state
  const mainDeliveryBreadcrumbs = ptyRuntimeState.mainDeliveryBreadcrumbs
  const pendingDataCapChars = (): number =>
    terminalOutputBacklogCapChars(getSettings?.().terminalScrollbackRows)

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

  // Why carve out queries: a bulk drop must not swallow reply-eliciting probes (DSR/CPR, DA1/DA2, DECRQM, OSC 10/11) the program blocks on; snapshot heals content so replies can't double-fire.
  function extractDroppedPtyQueryBytes(data: string): string {
    if (!data.includes('\x1b')) {
      return ''
    }
    const extracted = extractHiddenStartupRendererQueryData(data, '')
    return extracted.statelessQueryData + extracted.statefulQueryData + extracted.oscColorQueryData
  }

  function scanDroppedMode2031Data(
    data: string,
    previous: Mode2031ReplyScanState
  ): { data: string; state: Mode2031ReplyScanState } {
    const result = scanMode2031ReplyDecision(previous, data)
    const decisionData =
      result.decision === 'subscribed'
        ? '\x1b[?2031h'
        : result.decision === 'unsubscribed'
          ? '\x1b[?2031l'
          : ''
    return { data: decisionData, state: result.state }
  }

  function getDroppedMode2031RendererData(pending: PendingPtyData): string {
    const state = pending.droppedMode2031ScanState
    if (!state) {
      return pending.droppedMode2031Data ?? ''
    }
    const pendingSubscribe = state.pendingSubscribe ? '\x1b[?2031h' : ''
    return (pending.droppedMode2031Data ?? '') + pendingSubscribe + state.tail
  }

  function dropOversizedPendingPtyData(id: string, pending: PendingPtyData): PendingPtyData {
    const capChars = pendingDataCapChars()
    if (pending.droppedOutput === true || pending.data.length <= capChars) {
      return pending
    }
    if (!state.pendingDataDropWarnedPtys.has(id)) {
      state.pendingDataDropWarnedPtys.add(id)
      console.error(
        `[pty] dropped ${pending.data.length} buffered chars for ${id}: renderer not receiving and per-PTY pending cap exceeded; pane will restore from the main-owned snapshot`
      )
      // Why: field visibility for cap tuning (issue #2836 / #7017); no pty id since session ids can embed workspace paths.
      recordCrashBreadcrumb('terminal_pending_output_dropped', {
        droppedChars: pending.data.length,
        capChars
      })
    }
    if (
      isHiddenPtyDeliveryGateEnabled(getSettings?.()) &&
      !state.pendingOverflowMarkedPtys.has(id)
    ) {
      state.pendingOverflowMarkedPtys.add(id)
    }
    state.pendingDroppedChars += pending.data.length
    if (pending.projectionAdmissionIds) {
      state.sshOutputIntake?.transferProjections(pending.projectionAdmissionIds, 'pending-cap')
    }
    const mode2031 = scanDroppedMode2031Data(pending.data, INITIAL_MODE_2031_REPLY_SCAN_STATE)
    // Why no trimmed content tail: a mid-stream gap would corrupt the pane; the droppedOutput sentinel repaints from the snapshot and realigns by sequence (only query bytes ride along).
    return preservePtyIncarnationId(
      {
        data: extractDroppedPtyQueryBytes(pending.data).slice(0, DROPPED_QUERY_SALVAGE_MAX_CHARS),
        droppedOutput: true,
        droppedMode2031Data: mode2031.data,
        droppedMode2031ScanState: mode2031.state
      },
      pending.incarnationId
    )
  }

  function updatePendingProjectionAdmissions(
    pending: PendingPtyData,
    state: PendingProjectionAdmissions
  ): void {
    delete pending.projectionAdmissionIds
    delete pending.projectionAdmissionsTransferred
    if (state.projectionAdmissionIds) {
      pending.projectionAdmissionIds = state.projectionAdmissionIds
    }
    if (state.projectionAdmissionsTransferred) {
      pending.projectionAdmissionsTransferred = true
    }
  }

  function compactPendingProjectionState(
    pending: PendingProjectionAdmissions,
    projectionSemanticsId?: string
  ): PendingProjectionAdmissions {
    const options = pendingProjectionAdmissionOptions()
    const compacted = compactPendingProjectionAdmissions(pending, options)
    return projectionSemanticsId
      ? appendPendingProjectionAdmission(compacted, projectionSemanticsId, options)
      : compacted
  }

  function pendingProjectionAdmissionOptions() {
    return {
      isPending: (id: string) => state.sshOutputIntake?.hasUnpublishedProjection(id) ?? false,
      transfer: (ids: readonly string[], reason: string) =>
        state.sshOutputIntake?.transferProjections(ids, reason)
    }
  }

  function appendPendingPtyData(
    id: string,
    existing: PendingPtyData | undefined,
    data: string,
    startSeq: number | undefined,
    preservesSeq: boolean,
    containsBackgroundOutput: boolean,
    rawLength = data.length,
    transformed = false,
    projectionSemanticsId?: string,
    incarnationId?: string
  ): PendingPtyData {
    // Why stay dropped at O(1): once over the cap the restore sentinel supersedes interim bytes; queries still get carved out (bounded) so replies survive the whole episode.
    if (existing?.droppedOutput === true) {
      if (projectionSemanticsId) {
        state.sshOutputIntake?.transferProjections([projectionSemanticsId], 'pending-cap')
      }
      const mode2031 = scanDroppedMode2031Data(
        data,
        existing.droppedMode2031ScanState ?? INITIAL_MODE_2031_REPLY_SCAN_STATE
      )
      const remainingQueryCapacity = Math.max(
        0,
        DROPPED_QUERY_SALVAGE_MAX_CHARS - existing.data.length
      )
      const salvaged = extractDroppedPtyQueryBytes(data).slice(0, remainingQueryCapacity)
      return {
        ...existing,
        data: existing.data + salvaged,
        droppedMode2031Data: mode2031.data || existing.droppedMode2031Data,
        droppedMode2031ScanState: mode2031.state
      }
    }
    const projectionState = compactPendingProjectionState(existing ?? {}, projectionSemanticsId)
    const nextContainsBackgroundOutput =
      existing?.containsBackgroundOutput === true || containsBackgroundOutput
    if (!existing) {
      const pending = preservePtyIncarnationId(
        {
          data,
          ...(typeof startSeq === 'number' ? { startSeq } : {}),
          ...(rawLength !== data.length ? { rawLength } : {}),
          ...(transformed ? { transformed: true } : {}),
          ...(nextContainsBackgroundOutput ? { containsBackgroundOutput: true } : {})
        },
        incarnationId
      )
      updatePendingProjectionAdmissions(pending, projectionState)
      return dropOversizedPendingPtyData(id, pending)
    }
    const existingRawLength = existing.rawLength ?? existing.data.length
    const next = preservePtyIncarnationId(
      {
        data: existing.data + data,
        ...(!preservesSeq || existing.transformed || transformed
          ? { rawLength: existingRawLength + rawLength, transformed: true as const }
          : {}),
        ...(nextContainsBackgroundOutput ? { containsBackgroundOutput: true } : {})
      },
      existing.incarnationId
    )
    updatePendingProjectionAdmissions(next, projectionState)
    if (typeof existing.startSeq === 'number') {
      next.startSeq = existing.startSeq
    }
    return dropOversizedPendingPtyData(id, next)
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
        const { data } = pending
        const indivisible = pending.transformed === true
        const chunk = indivisible ? data : data.slice(0, PTY_BATCH_FLUSH_CHUNK_CHARS)
        const remaining = indivisible ? '' : data.slice(PTY_BATCH_FLUSH_CHUNK_CHARS)
        let nextPending: PendingPtyData | undefined
        if (remaining) {
          nextPending = preservePtyIncarnationId({ data: remaining }, pending.incarnationId)
          if (typeof pending.startSeq === 'number') {
            nextPending.startSeq = pending.startSeq + chunk.length
          }
          if (pending.containsBackgroundOutput === true) {
            nextPending.containsBackgroundOutput = true
          }
          if (pending.projectionAdmissionIds) {
            nextPending.projectionAdmissionIds = pending.projectionAdmissionIds
          }
          if (pending.projectionAdmissionsTransferred) {
            nextPending.projectionAdmissionsTransferred = true
          }
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
