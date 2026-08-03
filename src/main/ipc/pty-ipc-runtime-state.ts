import type { WebContents } from 'electron'
import type { IPtyProvider, PtySpawnResult } from '../providers/types'
import { LocalPtyProvider } from '../providers/local-pty-provider'
import { PtyExitEvidence } from './superseded-pty-exit-evidence'
import { RendererTerminalSerializerReadiness } from './renderer-terminal-serializer-readiness'
import type { SleepingAgentLaunchConfig } from '../../shared/agent-session-resume'
import { createPtyDeliveryBreadcrumbRing, type PtyDeliveryBreadcrumbRing } from '../../shared/pty-delivery-diagnostics'
import {
  ClaimedAgentPtyOwnerRegistry
} from '../../shared/claimed-agent-pty-owner'

export type PtyPublicationSnapshot = Readonly<{
  id: string
  ownershipPresent: boolean
  ownership: string | null | undefined
  incarnation: string | undefined
  stateToken: symbol | undefined
  size: { cols: number; rows: number } | undefined
  paneKey: string | undefined
  paneKeyReverseOwner: string | undefined
}>

export type CleanupPendingPty = Readonly<{
  provider: IPtyProvider
  providerConnectionId: string | null | undefined
  providerGeneration: number | undefined
  incarnationId: string | undefined
  publicationSnapshot: PtyPublicationSnapshot | null
}>

export type PaneSpawnReservationResult = {
  id: string
  launchConfig?: SleepingAgentLaunchConfig
} & Partial<PtySpawnResult>

export type PaneSpawnReservation = {
  promise: Promise<PaneSpawnReservationResult>
  resolve: (result: PaneSpawnReservationResult) => void
  reject: (error: unknown) => void
}

export type PtyRuntimeState = {
  localProvider: IPtyProvider
  sshProviders: Map<string, IPtyProvider>
  sshProvidersByGeneration: Map<number, IPtyProvider>
  ptyOwnership: Map<string, string | null>
  ptyIncarnationById: Map<string, string>
  ptyStateTokenById: Map<string, symbol>
  pendingPtyIncarnationById: Map<string, string>
  ptySizes: Map<string, { cols: number; rows: number }>
  pendingPtySizes: Map<string, { cols: number; rows: number }>
  clearedPtyLifecycleIds: Set<string>
  cleanupPendingPtyById: Map<string, Map<string | undefined, CleanupPendingPty>>
  supersededPtyExitEvidence: PtyExitEvidence
  providerClearedPtyExitEvidence: PtyExitEvidence
  pendingPtyCleanupRetryAttemptsById: Map<string, number>
  pendingPtyCleanupRetryTimersById: Map<
    string,
    { provider: IPtyProvider; timer: ReturnType<typeof setTimeout> }
  >
  pendingPtyCleanupFinalizer:
    | ((result: PtySpawnResult, snapshot: PtyPublicationSnapshot | null) => boolean)
    | null
  lastInputAtByPty: Map<string, number>
  interactiveOutputCharsByPty: Map<string, number>
  activeRendererPtys: Set<string>
  visibleRendererPtys: Set<string>
  rendererVisibilityKnownPtys: Set<string>
  invalidatePendingPtyDrainPriority: (id?: string, schedule?: boolean) => void
  invalidatePendingPtyDrainPolicy: (id?: string, schedule?: boolean) => void
  pendingHiddenRendererResizeOutputPtys: Set<string>
  deliveredHiddenRendererResizeOutputPtys: Set<string>
  ptyPaneKey: Map<string, string>
  paneKeyPtyId: Map<string, string>
  paneKeyTeardownListeners: Set<(paneKey: string) => void>
  pendingSerializerGenSeq: number
  pendingByPaneKey: Map<string, { gen: number; ownerWebContentsId: number | null }>
  pendingPaneSerializerCleanupRegistered: Set<number>
  paneSpawnReservationsByPaneKey: Map<string, PaneSpawnReservation>
  agentSessionOwners: ClaimedAgentPtyOwnerRegistry
  agentSessionOwnerReconciliation: Promise<void> | null
  pendingPtyIdBySerializerGeneration: Map<number, string>
  finalizedSshPtyExitById: Map<string, Map<string, ReturnType<typeof setTimeout>>>
  rendererSerializerReadiness: RendererTerminalSerializerReadiness
  localDataUnsub: (() => void) | null
  localExitUnsub: (() => void) | null
  localBackgroundStreamUnsub: (() => void) | null
  localWriteUnavailableUnsub: (() => void) | null
  didFinishLoadHandler: (() => void) | null
  didFinishLoadWebContents: WebContents | null
  rendererLifecycleResetWebContents: WebContents | null
  rendererLifecycleResetHandler: (() => void) | null
  rendererGateResetLoadHandler: (() => void) | null
  rendererGateResetGoneHandler: (() => void) | null
  rendererGateResetWebContents: WebContents | null
  clearBackgroundedDeliverySyncForPty: (id: string) => void
  providerSnapshotRequiredPtys: Set<string>
  rendererDidStartLoadingHandler: (() => void) | null
  rebindProviderListeners: (() => void) | null
  sshOutputIntakeCleanup: (() => void) | null
  readPtyRendererDeliveryDebugSnapshot: () => unknown
  resetPtyRendererDeliveryDebugSnapshot: () => void
  resetRendererDeliveryAccountingForLifecycleReset: () => void
  clearRendererDispatcherReadyWatchdog: () => void
  mainWindow: { isDestroyed: () => boolean; webContents: WebContents } | null
  trustedTerminalHandleEnv: Set<string>
  mainDeliveryBreadcrumbs: PtyDeliveryBreadcrumbRing
  lastPowerSuspendAtMs: number | null
  lastPowerResumeAtMs: number | null
  powerSignalBreadcrumbsInstalled: boolean
}

export const ptyRuntimeState: PtyRuntimeState = {
  localProvider: new LocalPtyProvider(),
  sshProviders: new Map(),
  sshProvidersByGeneration: new Map(),
  ptyOwnership: new Map(),
  ptyIncarnationById: new Map(),
  ptyStateTokenById: new Map(),
  pendingPtyIncarnationById: new Map(),
  ptySizes: new Map(),
  pendingPtySizes: new Map(),
  clearedPtyLifecycleIds: new Set(),
  cleanupPendingPtyById: new Map(),
  supersededPtyExitEvidence: new PtyExitEvidence(),
  providerClearedPtyExitEvidence: new PtyExitEvidence(),
  pendingPtyCleanupRetryAttemptsById: new Map(),
  pendingPtyCleanupRetryTimersById: new Map(),
  pendingPtyCleanupFinalizer: null,
  lastInputAtByPty: new Map(),
  interactiveOutputCharsByPty: new Map(),
  activeRendererPtys: new Set(),
  visibleRendererPtys: new Set(),
  rendererVisibilityKnownPtys: new Set(),
  invalidatePendingPtyDrainPriority: () => {},
  invalidatePendingPtyDrainPolicy: () => {},
  pendingHiddenRendererResizeOutputPtys: new Set(),
  deliveredHiddenRendererResizeOutputPtys: new Set(),
  ptyPaneKey: new Map(),
  paneKeyPtyId: new Map(),
  paneKeyTeardownListeners: new Set(),
  pendingSerializerGenSeq: 0,
  pendingByPaneKey: new Map(),
  pendingPaneSerializerCleanupRegistered: new Set(),
  paneSpawnReservationsByPaneKey: new Map(),
  agentSessionOwners: new ClaimedAgentPtyOwnerRegistry(),
  agentSessionOwnerReconciliation: null,
  pendingPtyIdBySerializerGeneration: new Map(),
  finalizedSshPtyExitById: new Map(),
  rendererSerializerReadiness: new RendererTerminalSerializerReadiness(),
  localDataUnsub: null,
  localExitUnsub: null,
  localBackgroundStreamUnsub: null,
  localWriteUnavailableUnsub: null,
  didFinishLoadHandler: null,
  didFinishLoadWebContents: null,
  rendererLifecycleResetWebContents: null,
  rendererLifecycleResetHandler: null,
  rendererGateResetLoadHandler: null,
  rendererGateResetGoneHandler: null,
  rendererGateResetWebContents: null,
  clearBackgroundedDeliverySyncForPty: () => {},
  providerSnapshotRequiredPtys: new Set(),
  rendererDidStartLoadingHandler: null,
  rebindProviderListeners: null,
  sshOutputIntakeCleanup: null,
  readPtyRendererDeliveryDebugSnapshot: () => ({}),
  resetPtyRendererDeliveryDebugSnapshot: () => {},
  resetRendererDeliveryAccountingForLifecycleReset: () => {},
  clearRendererDispatcherReadyWatchdog: () => {},
  mainWindow: null,
  trustedTerminalHandleEnv: new Set(),
  mainDeliveryBreadcrumbs: createPtyDeliveryBreadcrumbRing(),
  lastPowerSuspendAtMs: null,
  lastPowerResumeAtMs: null,
  powerSignalBreadcrumbsInstalled: false
}
