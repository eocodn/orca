import {
  INITIAL_MODE_2031_REPLY_SCAN_STATE,
  scanMode2031ReplyDecision,
  type Mode2031ReplyScanState
} from '../../shared/terminal-color-scheme-protocol'
import { extractHiddenStartupRendererQueryData } from '../../shared/terminal-reply-query-extraction'
import {
  appendPendingProjectionAdmission,
  compactPendingProjectionAdmissions,
  type PendingProjectionAdmissions
} from './pty-pending-projection-admissions'
import { recordCrashBreadcrumb } from '../crash-reporting/crash-breadcrumb-store'
import { isHiddenPtyDeliveryGateEnabled } from './pty-hidden-delivery-gate'
import type { GlobalSettings } from '../../shared/types'
import type { PendingPtyData } from './pty-pending-data-drain-queue'
import { preservePtyIncarnationId } from './pty-ipc-runtime-renderer-delivery-coalescing'
import type { SshPtyOutputIntake } from './ssh-pty-output-intake'

const DROPPED_QUERY_SALVAGE_MAX_CHARS = 4096

export type PtyRendererPendingQueueState = {
  pendingDataDropWarnedPtys: Set<string>
  pendingOverflowMarkedPtys: Set<string>
  pendingDroppedChars: number
  sshOutputIntake: SshPtyOutputIntake | null
  getSettings?: () => GlobalSettings
}

export type PtyRendererPendingQueue = ReturnType<typeof createPtyRendererPendingQueue>

export function createPtyRendererPendingQueue(
  state: PtyRendererPendingQueueState,
  pendingDataCapChars: () => number
) {
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
    const scanState = pending.droppedMode2031ScanState
    if (!scanState) {
      return pending.droppedMode2031Data ?? ''
    }
    const pendingSubscribe = scanState.pendingSubscribe ? '\x1b[?2031h' : ''
    return (pending.droppedMode2031Data ?? '') + pendingSubscribe + scanState.tail
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
      isHiddenPtyDeliveryGateEnabled(state.getSettings?.()) &&
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
    projectionState: PendingProjectionAdmissions
  ): void {
    delete pending.projectionAdmissionIds
    delete pending.projectionAdmissionsTransferred
    if (projectionState.projectionAdmissionIds) {
      pending.projectionAdmissionIds = projectionState.projectionAdmissionIds
    }
    if (projectionState.projectionAdmissionsTransferred) {
      pending.projectionAdmissionsTransferred = true
    }
  }

  function pendingProjectionAdmissionOptions() {
    return {
      isPending: (id: string) => state.sshOutputIntake?.hasUnpublishedProjection(id) ?? false,
      transfer: (ids: readonly string[], reason: string) =>
        state.sshOutputIntake?.transferProjections(ids, reason)
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

  return {
    getDroppedMode2031RendererData,
    updatePendingProjectionAdmissions,
    compactPendingProjectionState,
    pendingProjectionAdmissionOptions,
    appendPendingPtyData
  }
}
