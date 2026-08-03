import type { WebContents } from 'electron'
import type { GlobalSettings, TuiAgent } from '../../shared/types'
import type { PtyDeliveryWriteOff, PtyRendererDeliveryHealthReply, PtyRendererDeliveryStateReport } from '../../shared/pty-renderer-delivery-health'
import type { PtyMainDeliveryDiagnostics } from '../../shared/pty-delivery-diagnostics'
import type { PtyModelRestoreReason } from '../../shared/pty-model-restore-marker'
import { PtyPendingDataDrainQueue, type PendingPtyData } from './pty-pending-data-drain-queue'
import { PtyProducerFlowController } from './pty-producer-flow-control'
import { SshPtyOutputIntake } from './ssh-pty-output-intake'
import type { PendingProjectionAdmissions } from './pty-pending-projection-admissions'
import type { IPtyProvider, PtySpawnResult } from '../providers/types'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { PtyRegistrationFoundation } from './pty-ipc-runtime-registration-foundation'
import type { PtyRegistrationSharedState } from './pty-ipc-runtime-registration-shared-state'
import type { AgentProviderSessionMetadata } from '../../shared/agent-session-resume'
import type { CodexAccountSelectionTarget } from '../codex-accounts/runtime-selection'
import type { CodexSessionResumePreparation } from '../codex/codex-session-resume-home'
import type { PtyShutdownObservation, PtyShutdownTarget } from './pty-ipc-runtime-shutdown-state'

export type { PtyShutdownObservation, PtyShutdownTarget } from './pty-ipc-runtime-shutdown-state'

export type PtyDataPayload = {
  id: string
  data: string
  seq?: number
  rawLength?: number
  transformed?: boolean
  background?: boolean
  droppedOutput?: boolean
}

export type RendererPtyDeliveryAccounting = {
  sentChars: number
  ackedChars: number
  lastSendAtMs: number
  lastAckAtMs: number | null
}

export type SerializeResult = {
  data: string
  cols: number
  rows: number
  seq?: number
  lastTitle?: string
} | null

export type PtyCodexResumePreparation = {
  providerSession: AgentProviderSessionMetadata
  preparation: Promise<CodexSessionResumePreparation | null>
}

export type PtyRendererDeliveryContext = PtyRegistrationSharedState & {
  [key: string]: any
  foundation: PtyRegistrationFoundation
  getSettings?: () => GlobalSettings
  mainWindow: { isDestroyed: () => boolean; webContents: WebContents }
  runtime?: OrcaRuntimeService
  pendingData: PtyPendingDataDrainQueue
  sshOutputIntake: SshPtyOutputIntake | null
  rendererExitingPtyIds: Set<string>
  rendererCreditBeforeExitByPty: Map<string, boolean>
  rendererDeliveryRestoreNeededPtys: Set<string>
  pendingOverflowMarkedPtys: Set<string>
  rendererDeliveryAccountingByPty: Map<string, RendererPtyDeliveryAccounting>
  flushTimer: ReturnType<typeof setTimeout> | null
  pendingDataFlushActive: boolean
  pendingDataCreditReleasedDuringFlush: boolean
  rendererInFlightTotalChars: number
  pendingDroppedChars: number
  deliveryResyncRequestSerial: number
  deliveryResyncOutstandingRequestId: number | null
  deliveryResyncTimer: ReturnType<typeof setTimeout> | null
  deliveryResyncUnansweredWarnLogged: boolean
  lastAckReceivedAtMs: number | null
  peakPendingChars: number
  peakMaxPendingCharsByPty: number
  peakRendererInFlightChars: number
  peakMaxRendererInFlightCharsByPty: number
  ackGatedFlushSkipCount: number
  rendererLifecycleResetCount: number
  lastLifecycleResetClearedChars: number
  rendererDispatcherReadyForcedCount: number
  rendererPtyDispatcherReady: boolean
  dispatcherReadyWatchdogTimer: ReturnType<typeof setTimeout> | null
  producerFlowControl: PtyProducerFlowController
  sourceCreditPendingPtys: Set<string>
  backgroundedDeliverySyncByPty: Map<string, boolean>
  pendingDataDropWarnedPtys: Set<string>
  lastHiddenDropContradictionWarnAtMs: number
  syntheticKillExitPtyIds: Map<string, PtyShutdownTarget & { cleanupTimer: NodeJS.Timeout }>
  finalizedCleanupExitPtyIds: Map<string, { incarnationId: string; cleanupTimer: NodeJS.Timeout }>
  reversibleStopOwnersByPtyId: Map<string, number>
  ptyShutdownTargetsInFlightById: Map<string, Set<PtyShutdownTarget>>
  pendingSerializeRequests: Map<string, { resolve: (result: SerializeResult) => void; timeout: NodeJS.Timeout }>
  pendingProjectionAdmissionsByPty: Map<string, PendingProjectionAdmissions>
  sendPtyDataToRenderer: (id: string, payload: PtyDataPayload, projectionAdmissionIds?: readonly string[]) => { sent: boolean; projectionsTransferred: boolean }
  sendPtyExitToRenderer: (payload: { id: string; code: number; incarnationId?: string }) => void
  sendPtySpawnedToRenderer: (id: string) => void
  sendModelRestoreNeededMarker: (id: string, reason: PtyModelRestoreReason, markerSeq?: number) => void
  flushPendingData: () => void
  schedulePendingDataFlush: (delayMs: number) => void
  appendPendingPtyData: (id: string, existing: PendingPtyData | undefined, data: string, startSeq: number | undefined, preservesSeq: boolean, containsBackgroundOutput: boolean, rawLength?: number, transformed?: boolean, projectionSemanticsId?: string) => PendingPtyData
  clearPendingPtyData: () => void
  updateProducerFlowControl: (id: string) => void
  syncPtyBackgroundedDelivery: (id: string, caller: string) => void
  resyncBackgroundedDeliveriesAfterGateReset: () => void
  canSendPtyDataToRenderer: (id: string, options?: { interactive?: boolean }) => boolean
  applyCumulativeAck: (id: string, processedChars: number) => number
  requestDeliveryResyncForGatedPty: () => void
  writeOffLostRendererDelivery: (report: PtyRendererDeliveryStateReport) => PtyDeliveryWriteOff[]
  recordPtyRendererDeliveryPressure: (id: string) => void
  makePtyDataPayload: (id: string, data: string, startSeq: number | undefined, containsBackgroundOutput: boolean | undefined, rawLength?: number, transformed?: boolean) => PtyDataPayload
  getPtyPayloadCharCount: (payload: { data: string; rawLength?: number }) => number
  getRendererInFlightCharsForPty: (id: string) => number
  setPendingPtyData: (id: string, pending: PendingPtyData) => void
  deletePendingPtyData: (id: string) => void
  schedulePendingDataAfterCreditReport: (creditedAny: boolean) => void
  clearDeliveryResyncProbe: () => void
  warnIfDroppingHiddenBytesForVisiblePty: (id: string, droppedChars: number) => void
  shouldSendInteractiveOutputNow: (id: string, data: string, now: number) => boolean
  transitionHiddenRendererPtyDeliveryState: (id: string, hidden: boolean) => { droppable: boolean; droppedWhileHidden: boolean; policyChanged: boolean }
  transitionSpawnHiddenRendererPtyDeliveryState: (id: string, hidden: boolean) => void
  rendererPtyIsKnownHidden: (id: string) => boolean
  readCurrentPtyRendererDeliveryDebugSnapshot: () => unknown
  buildMainDeliveryDiagnostics: () => PtyMainDeliveryDiagnostics
  settleSerializeRequest: (requestId: string, result: SerializeResult) => void
  requestSerializedBuffer: (ptyId: string, opts?: { scrollbackRows?: number; altScreenForcesZeroRows?: boolean }) => Promise<SerializeResult>
  shutdownProviderAndDetectExit: (provider: IPtyProvider, id: string, opts: { immediate: boolean; keepHistory?: boolean; deadlineMs?: number }) => Promise<PtyShutdownObservation>
  clearFlushTimerIfIdle: () => void
  resetRendererPtyDeliveryGateState: () => void
  localStartupCwdDirectoryExists: (path: string) => boolean
  prepareCodexResumeHome: (args: {
    connectionId?: string | null
    launchAgent?: TuiAgent
    providerSession?: AgentProviderSessionMetadata
    target: CodexAccountSelectionTarget
    launchEnv?: NodeJS.ProcessEnv
    workspacePath?: string
  }) => PtyCodexResumePreparation | null
  _unusedHealthReply?: PtyRendererDeliveryHealthReply
  _unusedStateReport?: PtyRendererDeliveryStateReport
  _unusedSpawnResult?: PtySpawnResult
}
