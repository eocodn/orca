import { toSshExecutionHostId } from '../../shared/execution-host'
import { isTuiAgent } from '../../shared/tui-agent-config'
import { isValidTerminalTabId } from '../../shared/terminal-tab-id'
import {
  isTerminalLeafId,
  makePaneKey,
  parseLegacyNumericPaneKey
} from '../../shared/stable-pane-id'
import { getStartupTerminalColorQueryReplyColors } from './terminal-startup-color-query-replies'
import { getPtyRegistrationSharedState } from './pty-ipc-runtime-registration-shared-state'
import { ptyRuntimeState } from './pty-ipc-runtime-state'
import { buildPtyHostEnv } from './pty-ipc-runtime-host-env-assembly'
import {
  closeStartupQueryAuthorityForPty,
  getAppPtyId,
  getProvider,
  getProviderForPty,
  getRelayPtyId,
  hasPtyProviderForInspection,
  isCurrentPtyExit,
  rememberSshPtyExitFinalization,
  consumeSshPtyExitFinalization,
  tryGetProviderForAgentSessionOwner,
  tryGetProviderForPty
} from './pty-ipc-runtime-provider-routing'
import {
  assertPtyProviderIdentityCurrent,
  capturePtyProviderIdentity,
  commitPtyIncarnation,
  deletePtyOwnership,
  getLocalPtyProvider,
  getOrCreatePtyStateToken,
  getPtyIdsForConnection,
  getPtyIncarnation,
  getPtyStateToken,
  getSshPtyProvider,
  registerSshPtyProvider,
  restorePtyIncarnation,
  rollbackPtyIncarnation,
  setLocalPtyProvider,
  setPtyOwnership,
  stagePtyIncarnation,
  clearPtyOwnershipForConnection,
  clearProviderPtyState,
  clearProviderPtyStateIfCurrent,
  unregisterSshPtyProvider
} from './pty-ipc-runtime-provider-lifecycle-state'
import {
  consumePendingPtyCleanupIfExact,
  deletePendingPtyCleanupExact,
  finalizePendingPtyCleanupIfExact,
  getPendingPtyCleanupIncarnation,
  hasPendingPtyCleanupExact,
  hasPendingPtyCleanupWithoutIncarnation,
  rememberProviderClearedPtyExit,
  snapshotPtyCleanupAuthority,
  snapshotPtyPublication,
  restorePtyPublication,
  restorePtyPublicationIfCurrent,
  setPendingPtyCleanupForResult
} from './pty-ipc-runtime-cleanup-reconciliation'
import {
  assertSpawnReplyWasLive,
  declarePendingPaneSerializer,
  getPtyIdForPaneKey,
  hasPendingRendererSerializerForPaneKey,
  isValidPaneKey,
  parseValidPaneKey,
  reconcileAgentSessionOwnerListings,
  registerPaneKeyTeardownListener,
  registerPendingPaneSerializerCleanup,
  rememberPaneKeyForPty,
  rejectPaneSpawnReservation,
  reservePaneSpawn,
  resolvePaneSpawnReservation,
  settlePendingPaneSerializer,
  shouldRefreshNativeClaudeAgentTeamsEnv,
  clearPaneSpawnReservation,
  cleanupPendingPaneSerializersForSender
} from './pty-ipc-runtime-pane-state'
import {
  capturePtyShutdownTarget,
  finishPtyShutdown,
  isPtyAlreadyGoneError,
  isPtyShutdownTargetCurrent,
  isProviderAgentSessionOwnerLive,
  normalizeNodePtySpawnError,
  verifyPtyStopped
} from './pty-ipc-runtime-shutdown-state'
import {
  CODEX_HOME_ENV_KEYS,
  deleteRequestedEnvKeys,
  getCodexSelectionTargetForPty,
  getCompatibleSelectedCodexHomePath,
  getInheritedClaudeSessionStampEnvKeysToDelete,
  mergePtyEnvDeletions,
  promoteAgentTeamsShimPath,
  removeCodexHomeDeletionRequests,
  shouldSkipCodexHomeEnvForWindowsShell,
  shouldStripInheritedOrcaCodexHome
} from './pty-ipc-runtime-host-env-foundation'
import { beginPtySpawnForWorktree, isClaudeLaunchCommand } from './pty-ipc-runtime-spawn-routing'
import {
  isNativeWindowsLocalPtySpawn,
  markNativeWindowsConptyPty
} from '../runtime/terminal-model-query-authority'
import { createTerminalSessionStateSaveFailureMessage } from '../../shared/terminal-session-state-save-failure'
import { isSshPtyIdentityMismatchError } from '../providers/ssh-pty-errors'
import { resolveLocalProjectRuntimeForWorktreeId } from '../local-project-runtime-resolution'
import { classifyError } from '../diagnostics/error-classifier'
import {
  agentKindSchema,
  launchSourceSchema,
  requestKindSchema
} from '../../shared/telemetry-events'
import { registerPty } from '../memory/pty-registry'
import { markPtySpawned } from '../pty/pty-lifecycle-state'
import { resolveWslSessionContext } from '../daemon/wsl-session-context'
import { clearMigrationUnsupportedPtysForPaneKey } from '../agent-hooks/migration-unsupported-pty-state'
import { stampWslOrchestrationCompatibilityHost } from '../pty/wsl-orca-env'

export function installPtyRuntimeRegistrationApis(): Record<string, any> {
  const state = getPtyRegistrationSharedState()
  Object.assign(state, {
    resetRendererDeliveryAccountingForLifecycleReset:
      ptyRuntimeState.resetRendererDeliveryAccountingForLifecycleReset,
    invalidatePendingPtyDrainPriority: ptyRuntimeState.invalidatePendingPtyDrainPriority,
    invalidatePendingPtyDrainPolicy: ptyRuntimeState.invalidatePendingPtyDrainPolicy,
    localProvider: ptyRuntimeState.localProvider,
    sshProviders: ptyRuntimeState.sshProviders,
    sshProvidersByGeneration: ptyRuntimeState.sshProvidersByGeneration,
    ptyOwnership: ptyRuntimeState.ptyOwnership,
    ptyIncarnationById: ptyRuntimeState.ptyIncarnationById,
    pendingPtyIncarnationById: ptyRuntimeState.pendingPtyIncarnationById,
    ptySizes: ptyRuntimeState.ptySizes,
    pendingPtySizes: ptyRuntimeState.pendingPtySizes,
    ptyPaneKey: ptyRuntimeState.ptyPaneKey,
    paneKeyPtyId: ptyRuntimeState.paneKeyPtyId,
    pendingByPaneKey: ptyRuntimeState.pendingByPaneKey,
    pendingPtyIdBySerializerGeneration: ptyRuntimeState.pendingPtyIdBySerializerGeneration,
    paneSpawnReservationsByPaneKey: ptyRuntimeState.paneSpawnReservationsByPaneKey,
    agentSessionOwners: ptyRuntimeState.agentSessionOwners,
    rendererSerializerReadiness: ptyRuntimeState.rendererSerializerReadiness,
    trustedTerminalHandleEnv: ptyRuntimeState.trustedTerminalHandleEnv,
    lastInputAtByPty: ptyRuntimeState.lastInputAtByPty,
    interactiveOutputCharsByPty: ptyRuntimeState.interactiveOutputCharsByPty,
    activeRendererPtys: ptyRuntimeState.activeRendererPtys,
    visibleRendererPtys: ptyRuntimeState.visibleRendererPtys,
    rendererVisibilityKnownPtys: ptyRuntimeState.rendererVisibilityKnownPtys,
    pendingHiddenRendererResizeOutputPtys: ptyRuntimeState.pendingHiddenRendererResizeOutputPtys,
    deliveredHiddenRendererResizeOutputPtys:
      ptyRuntimeState.deliveredHiddenRendererResizeOutputPtys,
    providerSnapshotRequiredPtys: ptyRuntimeState.providerSnapshotRequiredPtys,
    getProvider,
    capturePtyProviderIdentity,
    assertPtyProviderIdentityCurrent,
    getProviderForPty,
    tryGetProviderForPty,
    tryGetProviderForAgentSessionOwner,
    hasPtyProviderForInspection,
    getAppPtyId,
    getRelayPtyId,
    closeStartupQueryAuthorityForPty,
    rememberSshPtyExitFinalization,
    consumeSshPtyExitFinalization,
    isCurrentPtyExit,
    registerSshPtyProvider,
    unregisterSshPtyProvider,
    getSshPtyProvider,
    getLocalPtyProvider,
    setLocalPtyProvider,
    getPtyIdsForConnection,
    clearPtyOwnershipForConnection,
    clearProviderPtyState,
    clearProviderPtyStateIfCurrent,
    deletePtyOwnership,
    setPtyOwnership,
    stagePtyIncarnation,
    commitPtyIncarnation,
    rollbackPtyIncarnation,
    restorePtyIncarnation,
    getPtyIncarnation,
    getPtyStateToken,
    getOrCreatePtyStateToken,
    snapshotPtyCleanupAuthority,
    snapshotPtyPublication,
    restorePtyPublication,
    restorePtyPublicationIfCurrent,
    setPendingPtyCleanupForResult,
    deletePendingPtyCleanupExact,
    consumePendingPtyCleanupIfExact,
    finalizePendingPtyCleanupIfExact,
    getPendingPtyCleanupIncarnation,
    hasPendingPtyCleanupExact,
    hasPendingPtyCleanupWithoutIncarnation,
    rememberProviderClearedPtyExit,
    getPtyIdForPaneKey,
    registerPaneKeyTeardownListener,
    getPendingPtyCleanupAuthority: snapshotPtyCleanupAuthority,
    assertSpawnReplyWasLive,
    reconcileAgentSessionOwnerListings,
    parseValidPaneKey,
    isValidPaneKey,
    shouldRefreshNativeClaudeAgentTeamsEnv,
    rememberPaneKeyForPty,
    cleanupPendingPaneSerializersForSender,
    registerPendingPaneSerializerCleanup,
    declarePendingPaneSerializer,
    reservePaneSpawn,
    clearPaneSpawnReservation,
    rejectPaneSpawnReservation,
    resolvePaneSpawnReservation,
    settlePendingPaneSerializer,
    hasPendingRendererSerializerForPaneKey,
    capturePtyShutdownTarget,
    finishPtyShutdown,
    isPtyAlreadyGoneError,
    isPtyShutdownTargetCurrent,
    isProviderAgentSessionOwnerLive,
    normalizeNodePtySpawnError,
    verifyPtyStopped,
    buildPtyHostEnv,
    stampWslOrchestrationCompatibilityHost,
    CODEX_HOME_ENV_KEYS,
    getCodexSelectionTargetForPty,
    getCompatibleSelectedCodexHomePath,
    shouldSkipCodexHomeEnvForWindowsShell,
    shouldStripInheritedOrcaCodexHome,
    promoteAgentTeamsShimPath,
    deleteRequestedEnvKeys,
    mergePtyEnvDeletions,
    removeCodexHomeDeletionRequests,
    getInheritedClaudeSessionStampEnvKeysToDelete,
    isClaudeLaunchCommand,
    beginPtySpawnForWorktree,
    isNativeWindowsLocalPtySpawn,
    markNativeWindowsConptyPty,
    resolveLocalProjectRuntimeForWorktreeId,
    isTuiAgent,
    isValidTerminalTabId,
    isTerminalLeafId,
    makePaneKey,
    parseLegacyNumericPaneKey,
    getStartupTerminalColorQueryReplyColors,
    resolveWslSessionContext,
    clearMigrationUnsupportedPtysForPaneKey,
    toSshExecutionHostId,
    registerPty,
    registerPtyInMemory: registerPty,
    markPtySpawned,
    createTerminalSessionStateSaveFailureMessage,
    isSshPtyIdentityMismatchError,
    classifyError,
    agentKindSchema,
    launchSourceSchema,
    requestKindSchema,
    getPtyOutputSequence: (id: string) => state.runtime?.getPtyOutputSequence?.(id)
  })
  return state
}
