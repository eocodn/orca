import { getClientRuntime } from '../../runtime/client-runtime'
import type { PaneManager, ManagedPane } from '@/lib/pane-manager/pane-manager'
import { installTerminalImeCompositionRoute } from './terminal-ime-composition-route'
import { detectAgentStatusFromTitle, agentTypeToIconAgent, isClaudeAgent } from '@/lib/agent-status'
import { resolvePaneTitleDecision } from './terminal-title-evidence'
import { resolveLiveAgentStatusConnectionRouting } from '@/lib/agent-status-connection-ownership'
import { scheduleRuntimeGraphSync } from '@/runtime/sync-runtime-graph'
import { useAppStore } from '@/store'
import { getWorktreeMapFromState } from '@/store/selectors'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { isEphemeralSetupTerminalWorktreeId } from '../../../../shared/ephemeral-setup-terminal-worktree-id'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import { containsStatefulRendererQuery } from '../../../../shared/terminal-reply-query-extraction'
import {
  deliverTerminalDataWithDeferredCredit,
  takeCurrentTerminalDeliveryCredit
} from '@/lib/pane-manager/terminal-delivery-credit'
import { isTerminalQueryReply } from '../../../../shared/terminal-query-reply'
import type { PtyBufferSnapshot, PtyConnectResult } from './pty-transport'
import type { IpcPtyTransportOptions, PtyTransportRecoveryState } from './pty-transport-types'
import { createIpcPtyTransport } from './pty-transport'
import { createRemoteRuntimePtyTransport } from './remote-runtime-pty-transport'
import { toAgentLaunchPreferences } from '@/runtime/agent-session-create-operation'
import { createUnresolvedOwnerPtyTransport } from './unresolved-owner-pty-transport'
import { resolveTerminalWorktreeRoute } from '@/lib/terminal-worktree-route'
import { getConnectionId } from '@/lib/connection-context'
import { recordTerminalTabParkedOnUnresolvedHost } from '@/lib/parked-terminal-host-hydration'
import { getLocalProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import {
  getCachedWindowsTerminalCapabilities,
  hasCachedWindowsTerminalCapabilities
} from '@/lib/windows-terminal-capabilities'
import { createInitialCacheTimerSeedController } from './cache-timer-seeding'
import type { PtyConnectionDeps } from './pty-connection-types'
import {
  cancelPendingSafeFitContinuations,
  safeFit,
  safeFitAndThen
} from '@/lib/pane-manager/pane-tree-ops'
import { bindPanePtyId, getFitOverrideForPty } from '@/lib/pane-manager/mobile-fit-overrides'
import { isPtyLocked } from '@/lib/pane-manager/mobile-driver-state'
import {
  isPaneReplaying,
  replayIntoTerminal,
  replayIntoTerminalAsync,
  waitForTerminalReplayWritesParsed
} from './replay-guard'
import {
  isTerminalWritePipelineCertifiedDead,
  registerUndeliverableWriteHandler,
  requestTerminalWritePipelineProbe
} from '@/lib/pane-manager/terminal-write-pipeline-health'
import {
  captureTerminalPaneRecoveryGeneration,
  registerTerminalPaneRecoveryInstance,
  requestTerminalPaneRecovery
} from './terminal-pane-recovery'
import { shouldDropQuarantinedTerminalInput } from './terminal-input-quarantine'
import { registerStaleDocumentVisibilityRecovery } from './stale-document-visibility'
import { recordTerminalFreezeBreadcrumb } from './terminal-freeze-breadcrumbs'
import { redactPtyIdForDiagnostics } from '../../../../shared/pty-delivery-diagnostics'
import {
  nativeWindowsRewriteNeedsFollowupRenderRefresh,
  terminalOutputPrefersRenderRefresh,
  terminalRewriteOutputRenderRefreshDecision,
  terminalRewriteOutputPrefersRenderRefresh,
  windowsEastAsianOutputPrefersRenderRefresh
} from '@/lib/pane-manager/terminal-complex-script'
import {
  buildPostReplayLiveAgentReattachReset,
  POST_REPLAY_MODE_RESET,
  POST_REPLAY_REATTACH_RESET
} from './layout-serialization'
import { scanForShellReadyMarker } from './shell-ready-marker-scan'
import { getSystemPrefersDark } from '@/lib/terminal-theme'
import {
  mode2031SequenceFor,
  resolveTerminalColorSchemeMode
} from '../../../../shared/terminal-color-scheme-protocol'
import { warnTerminalLifecycleAnomaly } from './terminal-lifecycle-diagnostics'
import { subscribeToTerminalUserInput } from './terminal-user-input-signal'
import { hasPtySerializer } from './pty-buffer-serializer'
import { inspectRuntimeTerminalProcess } from '@/runtime/runtime-terminal-inspection'
// Why: a restored pane's stale-account prompt can only be raised once a PTY is
// actually attached — nothing is inspectable while the session hydrates.
import { notifyCodexPaneBoundForStaleSweep } from '@/lib/codex-stale-pane-sweep'
import { getRemoteRuntimePtyEnvironmentId } from '@/runtime/runtime-terminal-stream'
import {
  discardTerminalOutput,
  flushTerminalOutput,
  registerTerminalBacklogRecovery,
  waitForTerminalOutputParsed,
  writeTerminalOutput
} from '@/lib/pane-manager/pane-terminal-output-scheduler'
import { recordAgentHibernationPaneOutput } from '@/lib/agent-hibernation-output-activity'
import {
  isLocalNativeWindowsConpty,
  resolveWindowsShellOverride
} from '@/lib/pane-manager/windows-pty-compatibility'
import { recordTerminalOutput } from '@/lib/pane-manager/pane-scroll'
import { ensureArabicShapingJoinerForText } from '@/lib/pane-manager/terminal-arabic-shaping-joiner'
import {
  enforceTerminalCurrentScrollIntent,
  getTerminalScrollIntentKind,
  markTerminalFollowOutput
} from '@/lib/pane-manager/terminal-scroll-intent'
import {
  cancelTerminalScrollIntentBufferRebuildCompletions,
  deferTerminalGeometryMutationDuringRebuild
} from '@/lib/pane-manager/terminal-scroll-intent-rebuild'
import { createTerminalStructuralReplayCoordinator } from '@/lib/pane-manager/terminal-structural-replay-coordinator'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import {
  getProviderSessionClaimKey,
  isPassiveCompletedHibernationEvidence
} from '@/lib/sleeping-agent-pane-ownership'
import { createTerminalCommandLifecycle } from './terminal-command-lifecycle'
import { createPtyConnectionAlternateScreenRepaintController } from './pty-connection-alternate-screen-repaint-controller'
import { createPtyConnectionAgentIdleTerminalModeController } from './pty-connection-agent-idle-terminal-mode-controller'
import { createPtyConnectionBufferSwitchController } from './pty-connection-buffer-switch-controller'
import { createPtyConnectionCommandFinishedStatusDropController } from './pty-connection-command-finished-status-drop-controller'
import { createPtyConnectionCertifiedDeadRestoreRecoveryController } from './pty-connection-certified-dead-restore-recovery-controller'
import { createPtyConnectionDroidReconfirmationController } from './pty-connection-droid-reconfirmation-controller'
import { createPtyConnectionE2eDataInjectionController } from './pty-connection-e2e-data-injection-controller'
import { createPtyConnectionFreshSpawnFollowController } from './pty-connection-fresh-spawn-follow-controller'
import { createPtyConnectionForegroundLatencyController } from './pty-connection-foreground-latency-controller'
import { createPtyConnectionForegroundRenderController } from './pty-connection-foreground-render-controller'
import { createPtyConnectionHiddenDeliveryController } from './pty-connection-hidden-delivery-controller'
import { createPtyConnectionHiddenRestoreDeferredRetryController } from './pty-connection-hidden-restore-deferred-retry-controller'
import { createPtyConnectionHiddenRestoreFloodBackpressureController } from './pty-connection-hidden-restore-flood-backpressure-controller'
import { createPtyConnectionHiddenRestoreFreshnessController } from './pty-connection-hidden-restore-freshness-controller'
import { createPtyConnectionHiddenRestoreForegroundDeadlineController } from './pty-connection-hidden-restore-foreground-deadline-controller'
import { createPtyConnectionHiddenRestoreIdentityController } from './pty-connection-hidden-restore-identity-controller'
import {
  createPtyConnectionHiddenRestorePendingLiveController,
  getHiddenRestorePendingLiveChunkDataAfterSnapshot,
  type HiddenRestorePendingLiveChunk
} from './pty-connection-hidden-restore-pending-live-controller'
import { createPtyConnectionHiddenRestoreReplayBaselineController } from './pty-connection-hidden-restore-replay-baseline-controller'
import { createPtyConnectionHiddenRestoreRequestController } from './pty-connection-hidden-restore-request-controller'
import { createPtyConnectionHiddenRestoreScheduleController } from './pty-connection-hidden-restore-schedule-controller'
import { createPtyConnectionHiddenRestoreScrollTicketController } from './pty-connection-hidden-restore-scroll-ticket-controller'
import { createPtyConnectionHiddenRestoreSnapshotLoopController } from './pty-connection-hidden-restore-snapshot-loop-controller'
import { createPtyConnectionHiddenRestoreSnapshotReplayController } from './pty-connection-hidden-restore-snapshot-replay-controller'
import { createPtyConnectionHiddenRestoreTaskController } from './pty-connection-hidden-restore-task-controller'
import { createPtyConnectionHiddenRendererQueryController } from './pty-connection-hidden-renderer-query-controller'
import { createPtyConnectionHiddenRestoreAbandonController } from './pty-connection-hidden-restore-abandon-controller'
import { createPtyConnectionHiddenRestoreCleanupController } from './pty-connection-hidden-restore-cleanup-controller'
import { createPtyConnectionHibernatedWakeController } from './pty-connection-hibernated-wake-controller'
import { createPtyConnectionMode2031ReplyScanController } from './pty-connection-mode2031-reply-scan-controller'
import { createPtyConnectionParkMountEvidenceController } from './pty-connection-park-mount-evidence-controller'
import { createPtyConnectionPanePtyBindingController } from './pty-connection-pane-pty-binding-controller'
import { createPtyConnectionPendingFitController } from './pty-connection-pending-fit-controller'
import { createPtyConnectionRemoteOutputPauseController } from './pty-connection-remote-output-pause-controller'
import { createPtyConnectionRecoverySubscriptionsController } from './pty-connection-recovery-subscriptions-controller'
import { createPtyConnectionSideEffectFactConsumerController } from './pty-connection-side-effect-fact-consumer-controller'
import {
  REATTACH_LIVE_DATA_MAX_CHARS,
  createPtyConnectionReattachLiveDataController
} from './pty-connection-reattach-live-data-controller'
import { createPtyConnectionReattachBindingController } from './pty-connection-reattach-binding-controller'
import { createPtyConnectionReattachFitController } from './pty-connection-reattach-fit-controller'
import { createPtyConnectionReattachParkSnapshotController } from './pty-connection-reattach-park-snapshot-controller'
import { createPtyConnectionReattachPayloadController } from './pty-connection-reattach-payload-controller'
import { createPtyConnectionReattachReplayController } from './pty-connection-reattach-replay-controller'
import { createPtyConnectionReattachResultAdmissionController } from './pty-connection-reattach-result-admission-controller'
import { createPtyConnectionRendererSequenceController } from './pty-connection-renderer-sequence-controller'
import { createPtyConnectionRendererSequenceExitResetController } from './pty-connection-renderer-sequence-exit-reset-controller'
import { createPtyConnectionRestoredSnapshotReconciliationController } from './pty-connection-restored-snapshot-reconciliation-controller'
import { createPtyConnectionRenderRiskController } from './pty-connection-render-risk-controller'
import { createPtyConnectionSynchronizedForegroundController } from './pty-connection-synchronized-foreground-controller'
import { createPtyConnectionTitleCompletionDeferralController } from './pty-connection-title-completion-deferral-controller'
import { createPtyConnectionStreamGenerationController } from './pty-connection-stream-generation-controller'
import { createPtyConnectionTerminalActivityController } from './pty-connection-terminal-activity-controller'
import { createPtyConnectionTransportSettleController } from './pty-connection-transport-settle-controller'
import { createPtyConnectionVisibleForegroundSampleController } from './pty-connection-visible-foreground-sample-controller'
import { createPtyConnectionWindowsDoneStatusController } from './pty-connection-windows-done-status-controller'
import { createPaneForegroundAgentTracker } from './pane-foreground-agent-tracker'
import { parseAppSshPtyId } from '../../../../shared/ssh-pty-id'
import { dispatchTerminalCommandFinishedEvent } from '@/hooks/terminal-command-finished-event'
import {
  isFreshNonDoneAgentStatus,
  type AgentStatusEntry,
  type AgentType
} from '../../../../shared/agent-status-types'
import { isWebTerminalSurfaceTabId } from '@/runtime/web-terminal-surface-id'
import {
  createAgentInterruptInference,
  isCtrlCKeyEvent,
  isPlainEscapeKeyEvent
} from './agent-interrupt-inference'
import { createAgentQuestionAnsweredInference } from './agent-question-answered-inference'
import { createPtyConnectionTitleOnlyInterruptController } from './pty-connection-title-only-interrupt-controller'
import { createAgentCompletionCoordinator } from './agent-completion-coordinator'
import {
  dispatchAgentHookTerminalLifecycle,
  registerAgentHookTerminalLifecycleHandler
} from './agent-hook-terminal-lifecycle'
import {
  createCodexAutoApprovalHookCompletionSuppressor,
  shouldSuppressCodexAutoApprovalSyntheticTitle,
  shouldSuppressCodexAutoApprovalStatus
} from './codex-auto-approval-notification-suppression'
import {
  markTerminalBracketedPasteInterrupted,
  observeTerminalBracketedPasteModeOutput
} from './terminal-bracketed-paste'
import { createCommandCodeOutputStatusDetector } from '../../../../shared/command-code-output-status'
import type { PtyDataMeta } from './pty-dispatcher'
import { getEagerPtyBufferHandle } from './pty-dispatcher'
import {
  parsedViewportShowsParkedCursorAgentScreen,
  terminalHasFocusReportingEnabled
} from './pty-connection-screen-signals'
import { createTerminalGitHubPRLinkDetector } from '../../../../shared/terminal-github-pr-link-detector'
import { scheduleTerminalWebglAtlasRecovery } from './terminal-webgl-atlas-recovery'
import {
  CONPTY_DA1_RESPONSE,
  createTerminalPixelSizeQueryResponder,
  installTerminalCapabilityReplyHandlers,
  sendTerminalOscColorQueryReplies
} from './terminal-capability-replies'
import { registerPtyModelRestoreNeededHandler } from './pty-model-restore-channel'
import {
  acquireHiddenRendererPtyDeliveryClaim,
  declareRendererPtyDeliveryVisible,
  releaseRendererPtyVisibilityClaim,
  setRendererPtyVisibilityClaim
} from './pty-renderer-delivery-claims'
import { resolveHiddenRestoreScrollbackRows } from './terminal-hidden-restore-scrollback'
import { readInFlightCommandCodeTurn } from './parked-terminal-command-status'
import {
  cancelCommandCodeDoneSettle,
  openCommandCodeDoneSettle,
  setCommandCodeDoneSettleExecutor
} from './command-code-done-settle'
import { isTerminalTabParked } from './terminal-parked-watcher-registry'
import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import { CLIENT_PLATFORM } from '@/lib/new-workspace'
import { resolveAgentStatusTerminalTitle } from '@/lib/agent-status-terminal-title'
import {
  normalizeCompatibleAgentTitleForOwner,
  resolveCompatibleAgentTypeForOwner
} from '../../../../shared/agent-title-owner'
import { resolvePaneAgentOwner } from '../../../../shared/pane-agent-owner'
import { resolveCommittedTitleAgentType } from '@/lib/pane-agent-evidence'
import type { TuiAgent } from '../../../../shared/types'
import { isWslUncPath } from '../../../../shared/wsl-paths'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import {
  isMainTerminalSideEffectAuthorityForPty,
  registerTerminalSideEffectFactConsumer
} from './terminal-side-effect-facts-handler'
import { isRendererHiddenPtyDeliveryGateEnabled } from './terminal-hidden-delivery-gate'
import {
  CURSOR_SHOW_SEQUENCE,
  FOCUS_REPORTING_DISABLE_SEQUENCE,
  HIDDEN_OUTPUT_RESTORE_MAX_LOOP_ITERATIONS,
  HIDDEN_OUTPUT_RESTORE_UNAVAILABLE_WARNING,
  STARTUP_CWD_FALLBACK_NOTICE,
  TERMINAL_FOCUS_IN_SEQUENCE,
  TERMINAL_FOCUS_OUT_SEQUENCE
} from './pty-connection-runtime-state'
export { STARTUP_CWD_FALLBACK_NOTICE } from './pty-connection-runtime-state'
import {
  containsHiddenStartupRendererQuery,
  exposeE2eTerminalPtyOutputDebug,
  readE2eHiddenSnapshotOverride,
  recordHiddenMode2031Reply,
  recordHiddenRendererSkip,
  registerE2eTerminalPtyDataInjection,
  shouldKeepHiddenStartupRendererQueriesLive
} from './pty-connection-e2e-support'
import type {
  ColdRestoreAgentResumeStartup,
  FreshSpawnOptions,
  PendingStartupCommand
} from './pty-connection-e2e-support'
import {
  isAgentTaskCompleteTrackingEnabled,
  recordPtyConnectDiagnostic
} from './pty-connection-agent-tracking'
import type { PanePtyBinding } from './pty-connection-agent-tracking'
import {
  canRestorePairedParkedTerminal,
  consumeInactiveForegroundImmediateBudget,
  containsCursorPositionSequence,
  isCodexPaneStale,
  isRemoteRuntimePtyId,
  isSessionOwnedByWorktree,
  isSshSessionExpiredError,
  shouldWritePtyOutputForeground,
  sshPromptConnectOutcomeForStatus,
  waitForSshConnection
} from './pty-connection-routing-policy'
import { createPtyConnectionStartupState } from './pty-connection-startup-state'
import { createPtyConnectionCommandInference } from './pty-connection-command-inference'
import { createPtyConnectionReattachAgentSignals } from './pty-connection-reattach-agent-signals'
import { createPtyConnectionInputIntent } from './pty-connection-input-intent'
import { createPtyConnectionSerializerController } from './pty-connection-serializer-controller'
import { createPtyConnectionStartupDraftController } from './pty-connection-startup-draft-controller'
import { createPtyConnectionStartupDeliveryCleanupController } from './pty-connection-startup-delivery-cleanup-controller'
import { createPtyConnectionColdRestoreStartup } from './pty-connection-cold-restore-startup'
import { createPtyConnectionStartupCommandDelivery } from './pty-connection-startup-command-delivery'
import { createPtyConnectionDirectSshRetryController } from './pty-connection-direct-ssh-retry-controller'
import { createPtyConnectionAgentNotificationController } from './pty-connection-agent-notification-controller'
import { createPtyConnectionExitController } from './pty-connection-exit-controller'
import { createPtyConnectionRemoteViewportClaimController } from './pty-connection-remote-viewport-claim-controller'
import { createPtyConnectionResizeForwardingController } from './pty-connection-resize-forwarding-controller'
import { createPtyConnectionResizeSuppressionController } from './pty-connection-resize-suppression-controller'
import { createPtyConnectionPaneGeometryController } from './pty-connection-pane-geometry-controller'
import { createPtyConnectionSpawnSizeReconcileController } from './pty-connection-spawn-size-reconcile-controller'
import { createPtyConnectionSizeReassertionController } from './pty-connection-size-reassertion-controller'
import { createPtyConnectionSessionLivenessReconcileController } from './pty-connection-session-liveness-reconcile-controller'
import { createPtyConnectionStartupGridController } from './pty-connection-startup-grid-controller'
import { createPtyConnectionReattachAttemptController } from './pty-connection-reattach-attempt-controller'
import { createPtyConnectionAttachController } from './pty-connection-attach-controller'
import { preparePtyConnectionConnectPreflight } from './pty-connection-connect-preflight'
import { runPtyConnectionObservedNormalRoute } from './pty-connection-observed-normal-route'
import { trackPtyConnectionSpawn } from './pty-connection-spawn-tracker'
import { createPtyConnectionFreshSpawnController } from './pty-connection-fresh-spawn-controller'
import { runPtyConnectionFreshSpawnPreflight } from './pty-connection-fresh-spawn-preflight'
import { preparePtyConnectionFreshShellViewport } from './pty-connection-fresh-shell-viewport'
import { runPtyConnectionObservedSshRoute } from './pty-connection-observed-ssh-route'

// Why: when multiple panes/tabs need the same deferred SSH connection,
// the first one calls ssh.connect() and subsequent ones must wait for it
// rather than returning early (which would leave them disconnected). This
// helper either connects or waits for an in-flight connect to finish.

/**
 * Establishes a binding between a terminal pane and its corresponding PTY stream,
 * managing input, output, title synchronization, and agent status tracking.
 */
export function connectPanePty(
  pane: ManagedPane,
  manager: PaneManager,
  deps: PtyConnectionDeps
): PanePtyBinding {
  const shouldRefreshForegroundSynchronously = (): boolean => !manager.hasWebglRenderer(pane.id)
  // Why: recovery ownership belongs to this xterm instance. A request that
  // settles after remount must not remount its already-replaced successor.
  const terminalRecoveryGeneration = captureTerminalPaneRecoveryGeneration(deps.tabId)
  const terminalRecoveryInstance = registerTerminalPaneRecoveryInstance(deps.tabId)
  // Why sampled here: the host disposes this tab's park watcher in the effect
  // that follows this mount, so connect time is the only moment a pane can tell
  // a reveal remount from an in-place reattach.
  const parkMountEvidenceController = createPtyConnectionParkMountEvidenceController(
    isTerminalTabParked(deps.tabId)
  )
  exposeE2eTerminalPtyOutputDebug()
  let disposed = false
  const terminalActivityController = createPtyConnectionTerminalActivityController()
  const structuralReplayCoordinator = createTerminalStructuralReplayCoordinator(pane.terminal)
  const recoverySubscriptionsController = createPtyConnectionRecoverySubscriptionsController()
  const hiddenRestoreCleanupController = createPtyConnectionHiddenRestoreCleanupController()
  const pendingFitController = createPtyConnectionPendingFitController()
  const rendererSequenceExitResetController =
    createPtyConnectionRendererSequenceExitResetController()
  const startupDeliveryCleanupController = createPtyConnectionStartupDeliveryCleanupController()
  const remoteOutputPauseController = createPtyConnectionRemoteOutputPauseController()
  const agentIdleTerminalModeController = createPtyConnectionAgentIdleTerminalModeController({
    isDisposed: () => disposed,
    writeReset: (sequence) => {
      writeTerminalOutput(pane.terminal, sequence, {
        foreground: shouldWritePtyOutputForeground(deps.isVisibleRef.current)
      })
    },
    resolveCommittedTitleAgentType
  })
  const freshSpawnFollowController = createPtyConnectionFreshSpawnFollowController({
    isDisposed: () => disposed,
    markFollowOutput: () => markTerminalFollowOutput(pane.terminal),
    getScrollIntentKind: () => getTerminalScrollIntentKind(pane.terminal),
    deferGeometryMutation: (retry) =>
      deferTerminalGeometryMutationDuringRebuild(pane.terminal, 'fresh-spawn-follow-reset', retry),
    scrollToBottom: () => pane.terminal.scrollToBottom(),
    subscribeRender: (listener) => pane.terminal.onRender(listener),
    subscribeResize: (listener) => pane.terminal.onResize(listener)
  })
  // Why: passphrase-gate waits register a teardown here so dispose() can
  // actively unsubscribe + resolve them. Without this, a pane disposed
  // mid-wait leaks its zustand subscriber and the surrounding async IIFE
  // forever, since the subscriber's `disposed` check only fires when the
  // store next emits — which may never happen after disconnect.
  const waitTeardowns: (() => void)[] = []
  // Why: startup commands must only run once — in the pane they were
  // targeted at. Capture `deps.startup` into a local and clear the field on
  // the (already spread-copied) `deps` so nothing else inside this function
  // can accidentally re-read it. The caller is responsible for clearing its
  // own outer reference, since `deps` here is a shallow copy and our
  // mutation does not propagate back.
  const paneStartup = deps.startup ?? null
  deps.startup = undefined

  // Why: paneKey crosses PTY env, hook IPC, retained rows, and reload/replay.
  // Use the stable layout leaf UUID, not the renderer-local numeric pane id.
  const cacheKey = makePaneKey(deps.tabId, pane.leafId)
  const e2eDataInjectionController = createPtyConnectionE2eDataInjectionController({
    paneKey: cacheKey,
    register: registerE2eTerminalPtyDataInjection
  })
  // Why: mirrors the kitty keyboard flags the pane's application negotiates.
  // Fed only from application output (live PTY bytes + daemon replay
  // payloads), never from renderer-generated resets, so it reflects what the
  // application expects even after defensive renderer-side kitty wipes.
  const {
    kittyKeyboardModes,
    getSleepingRecordForPane,
    isLegacyWorkerAutomaticResumeBlocked,
    clearSleepingRecordProviderDuplicates,
    launchToken,
    startupDraftAgentConfig,
    startupDraftPrompt,
    startupDraftDelivery,
    claimStartupDraftPasteDelivery,
    releaseUnattemptedStartupDraftPasteDelivery,
    registerEffectiveLaunchConfig,
    clearRegisteredStartupLaunchConfig,
    neutralTerminalTitle
  } = createPtyConnectionStartupState({ pane, deps, paneStartup, cacheKey })
  // Why: infer pane ownership from a manually typed agent command (e.g. `omp`) by
  // shadowing the shell's current command line, for generic terminals where no
  // launch metadata exists. Consumed by getAuthoritativePaneAgent below.
  const {
    getCommandInferredPaneAgent,
    clearCommandInferredPaneAgent,
    clearCommandInferredPaneAgentAfterPtySideEffects,
    cancelSuspendedShellCommandInference,
    observeAcceptedShellCommandInput,
    requestKnownDroidReconfirmation,
    setStartAcceptedInferredCommand,
    setRequestKnownDroidReconfirmation,
    setHasFreshPaneAgentSurface
  } = createPtyConnectionCommandInference({ cacheKey })
  const getLivePaneAgentTitle = (): string | null => {
    const state = useAppStore.getState()
    const runtimeTitle = state.runtimePaneTitlesByTabId?.[deps.tabId]?.[pane.id]
    const tabTitle = (state.tabsByWorktree[deps.worktreeId] ?? []).find(
      (entry) => entry.id === deps.tabId
    )?.title
    return runtimeTitle ?? tabTitle ?? null
  }
  // Why: a pane-scoped explicit row only counts as current ownership evidence
  // when it is fresh and not already `done` — a stale or completed row is a
  // leftover from a prior agent that may no longer own the shell.
  const isFreshActivePaneAgentEntry = (
    entry: AgentStatusEntry | undefined
  ): entry is AgentStatusEntry => {
    return isFreshNonDoneAgentStatus(entry)
  }
  const shouldSuppressTitleCompletionForFreshHook = (
    title: string,
    activeHookStatus: AgentStatusEntry | undefined
  ): boolean => {
    if (
      detectAgentStatusFromTitle(title) === 'working' ||
      !isFreshNonDoneAgentStatus(activeHookStatus)
    ) {
      return false
    }
    const explicitTitleAgentType = resolveCommittedTitleAgentType(title)
    const activeHookAgentForTitle = resolveCompatibleAgentTypeForOwner(
      activeHookStatus?.agentType,
      explicitTitleAgentType
    )
    const titleNamesDifferentKnownAgent =
      explicitTitleAgentType &&
      activeHookStatus?.agentType &&
      activeHookStatus.agentType !== 'unknown' &&
      activeHookAgentForTitle !== explicitTitleAgentType
    return !titleNamesDifferentKnownAgent
  }
  const applyAgentCompletionSideEffects = (
    title: string,
    agentType: AgentType | undefined
  ): void => {
    const settings = useAppStore.getState().settings
    if (
      (agentType === 'claude' || isClaudeAgent(title)) &&
      (settings === null || settings.promptCacheTimerEnabled)
    ) {
      deps.setCacheTimerStartedAt(cacheKey, Date.now())
    }
    agentIdleTerminalModeController.applyCompletionFocusSuppression(title, agentType)
    agentIdleTerminalModeController.queueReset()
  }
  const titleCompletionDeferralController = createPtyConnectionTitleCompletionDeferralController({
    resolveCompatibleAgentType: resolveCompatibleAgentTypeForOwner,
    applyCompletion: applyAgentCompletionSideEffects,
    relaxPendingCompletion: () => {
      agentIdleTerminalModeController.clearFocusSuppression()
      agentIdleTerminalModeController.queueReset()
    }
  })
  const unregisterAgentHookTerminalLifecycle = registerAgentHookTerminalLifecycleHandler(
    cacheKey,
    titleCompletionDeferralController.handleLifecycle
  )
  const hasFreshPaneAgentSurface = (): boolean => {
    const entry = useAppStore.getState().agentStatusByPaneKey[cacheKey]
    if (isFreshActivePaneAgentEntry(entry)) {
      return true
    }
    const liveTitle = getLivePaneAgentTitle()
    return detectAgentStatusFromTitle(liveTitle ?? '') !== null
  }
  setHasFreshPaneAgentSurface(hasFreshPaneAgentSurface)
  /**
   * Resolves the authoritative owner agent type for this pane, checking tab launch,
   * pane startup, typed command ownership, and store state configuration.
   *
   * Why: launch ownership wins so Pi-compatible live titles/hooks can't repaint an
   * OMP-owned pane back to Pi; command ownership covers manually typed `omp`
   * in generic terminals where launch metadata does not exist.
   */
  const getAuthoritativePaneAgent = (): AgentType | undefined => {
    const state = useAppStore.getState()
    const tab = (state.tabsByWorktree[deps.worktreeId] ?? []).find(
      (entry) => entry.id === deps.tabId
    )
    return (
      resolvePaneAgentOwner({
        launchAgent: tab?.launchAgent,
        startupLaunchAgent: paneStartup?.launchAgent,
        initialStatusAgent: paneStartup?.initialAgentStatus?.agent,
        commandInferredAgent: getCommandInferredPaneAgent(),
        hookAgent: state.agentStatusByPaneKey[cacheKey]?.agentType
      }) ?? undefined
    )
  }
  // Why: the renderer veto (owner evidence beating a Gemini-looking title) must
  // use only pane-scoped, CURRENT ownership. getAuthoritativePaneAgent leads
  // with the tab-shared `tab.launchAgent` and a never-cleared
  // `paneStartup.launchAgent`, which would let a sibling split pane or a reused
  // pane keep WebGL for a genuine Gemini terminal (#7428 regression class).
  // Launch identity is excluded, and the never-clearing startup seed
  // (`paneStartup.initialAgentStatus`) too; a stale or `done` explicit row is
  // ignored via the freshness predicate so a reused pane cannot inherit a prior
  // agent's veto. Only live foreground command inference and a fresh, active
  // hook row count. A genuine OMP/Pi pane stays protected owner-independently by
  // the isPiAgentTitle guard inside isGeminiTerminalTitle.
  const getPaneScopedRendererOwner = (): AgentType | undefined => {
    const entry = useAppStore.getState().agentStatusByPaneKey[cacheKey]
    return (
      getCommandInferredPaneAgent() ??
      (isFreshActivePaneAgentEntry(entry) ? entry.agentType : undefined)
    )
  }
  const clearInferredInterruptWorkingTitle = (): void => {
    const state = useAppStore.getState()
    const currentTitle = state.runtimePaneTitlesByTabId?.[deps.tabId]?.[pane.id]
    const statusTitle = state.agentStatusByPaneKey[cacheKey]?.terminalTitle
    const title = currentTitle ?? statusTitle
    if (!title) {
      return
    }
    const neutralTitle = neutralTerminalTitle()
    // Why: inferred interrupts update the explicit hook row, but many CLIs leave
    // their OSC title stuck on a working spinner. Replace only this fallback
    // title signal with a neutral terminal label so the existing process tracker
    // can still decide whether an agent TUI is truly alive.
    deps.setRuntimePaneTitle(deps.tabId, pane.id, neutralTitle)
    if (manager.getActivePane()?.id === pane.id) {
      deps.updateTabTitle(deps.tabId, neutralTitle)
    }
  }
  const titleOnlyInterruptController = createPtyConnectionTitleOnlyInterruptController({
    hasAgentStatus: () => Boolean(useAppStore.getState().agentStatusByPaneKey[cacheKey]),
    readTitle: () => {
      const state = useAppStore.getState()
      const runtimeTitle = state.runtimePaneTitlesByTabId?.[deps.tabId]?.[pane.id]
      const tabTitle = (state.tabsByWorktree[deps.worktreeId] ?? []).find(
        (entry) => entry.id === deps.tabId
      )?.title
      return runtimeTitle ?? tabTitle
    },
    isWorkingTitle: (title) => detectAgentStatusFromTitle(title) === 'working',
    clearWorkingTitle: clearInferredInterruptWorkingTitle
  })
  const {
    clearIdleCursorResetTimer: clearReattachIdleAgentCursorResetTimer,
    getReplayPayloadSignalGeneration,
    hasReplayPayloadCursorAgentSignal,
    resetReplayPayloadCursorAgentSignal,
    rememberReplayPayloadAgentSignal: rememberReattachPayloadAgentSignal,
    hasLiveStatusOrTitleSignal: hasLiveAgentReattachStatusOrTitleSignal,
    shouldPreserveModes: shouldPreserveAgentReattachModes,
    shouldSendFocusedFocusIn: shouldSendFocusedAgentReattachFocusIn,
    scheduleIdleCursorReset: scheduleReattachIdleAgentCursorReset
  } = createPtyConnectionReattachAgentSignals({
    pane,
    deps,
    cacheKey,
    isDisposed: () => disposed,
    queueAgentIdleTerminalModeReset: agentIdleTerminalModeController.queueReset
  })
  const interruptInference = createAgentInterruptInference({
    paneKey: cacheKey,
    getStatusEntry: () => useAppStore.getState().agentStatusByPaneKey[cacheKey],
    inferInterrupt: (request) => {
      // Why: the explicit hook row is the authority for an in-flight agent turn.
      // Codex can reset its terminal title while handling Ctrl+C/Escape, so title
      // state must not veto clearing the row's working state.
      return window.api.agentStatus
        .inferInterrupt(request)
        .then((applied) => {
          if (applied) {
            clearInferredInterruptWorkingTitle()
          }
          return applied
        })
        .catch((err) => {
          console.warn('[agent-interrupt] inferInterrupt failed:', err)
          return false
        })
    }
  })
  const questionAnsweredInference = createAgentQuestionAnsweredInference({
    paneKey: cacheKey,
    getStatusEntry: () => useAppStore.getState().agentStatusByPaneKey[cacheKey],
    inferQuestionAnswered: (request) =>
      window.api.agentStatus.inferQuestionAnswered(request).catch((err) => {
        console.warn('[agent-question] inferQuestionAnswered failed:', err)
        return false
      })
  })
  const dropCommandFinishedStatusIfSameTurn = (
    entry: AgentStatusEntry | undefined,
    options?: { allowInferredInterrupt?: boolean }
  ): void => {
    const state = useAppStore.getState()
    if (!entry) {
      // Why: an Orca-started agent can exit before its first hook status. The
      // launch registry was still created up front, so clear it on command exit.
      state.clearAgentLaunchConfig(cacheKey)
      return
    }
    const current = state.agentStatusByPaneKey[cacheKey]
    if (!current) {
      state.clearAgentLaunchConfig(cacheKey)
      return
    }
    const unchanged =
      current.state === entry.state &&
      current.prompt === entry.prompt &&
      current.updatedAt === entry.updatedAt &&
      current.stateStartedAt === entry.stateStartedAt &&
      current.agentType === entry.agentType
    const inferredFromEntry =
      options?.allowInferredInterrupt === true &&
      current.state === 'done' &&
      current.interrupted === true &&
      current.prompt === entry.prompt &&
      current.agentType === entry.agentType &&
      current.stateHistory?.some(
        (history) =>
          history.state === entry.state &&
          history.prompt === entry.prompt &&
          history.startedAt === entry.stateStartedAt
      ) === true
    if (!unchanged && !inferredFromEntry) {
      return
    }
    state.dropAgentStatus(cacheKey)
  }
  const {
    clearPendingIntent: clearPendingTerminalInputIntent,
    setPendingIntent: setPendingTerminalInputIntent,
    getPendingIntent: getPendingTerminalInputIntent,
    inferExactIntent: inferIntentFromExactTerminalInput,
    observeSentIntent: observeSentTerminalInputIntent,
    observeAcceptedInput: observeAcceptedTerminalInput,
    setPendingWrite: setPendingTerminalInputWrite,
    clearPendingWrite: clearPendingTerminalInputWrite,
    flushPending: flushPendingInterruptInference
  } = createPtyConnectionInputIntent({
    observeInterruptIntent: (intent) => interruptInference.observeInputIntent(intent),
    observeTitleOnlyInterrupt: titleOnlyInterruptController.observe,
    markBracketedPasteInterrupted: () => markTerminalBracketedPasteInterrupted(pane.terminal),
    observeQuestionAnsweredInput: (data) =>
      questionAnsweredInference.observeSentTerminalInput(data),
    flushInterruptPending: () => interruptInference.flushPending()
  })
  // Why: the 133;D confirmation guard and the visible-pane resampler both key off
  // "does this pane expect an agent"; derive each signal once so the two callers
  // can't drift and silently reintroduce the icon bug this fix closes.
  const paneHasLiveHookAgentIcon = (state: ReturnType<typeof useAppStore.getState>): boolean => {
    const entry = state.agentStatusByPaneKey[cacheKey]
    return entry?.state !== 'done' && Boolean(agentTypeToIconAgent(entry?.agentType))
  }
  const paneExpectsLaunchAgent = (state: ReturnType<typeof useAppStore.getState>): boolean => {
    const tab = (state.tabsByWorktree[deps.worktreeId] ?? []).find(
      (candidate) => candidate.id === deps.tabId
    )
    const registeredLaunchAgent = state.agentLaunchConfigByPaneKey[cacheKey]?.identity.agentType
    return Boolean(
      tab?.launchAgent ??
      paneStartup?.launchAgent ??
      paneStartup?.initialAgentStatus?.agent ??
      (isTuiAgent(registeredLaunchAgent) ? registeredLaunchAgent : undefined)
    )
  }
  // Why: the concrete TUI agent a fresh spawn is expected to launch, used to seed
  // a command-start confirmation on no-OSC shells (Git Bash/cmd) that never emit
  // one. Returns null when the expectation isn't a recognized TUI agent.
  const resolveExpectedLaunchTuiAgent = (): TuiAgent | null => {
    const state = useAppStore.getState()
    const tab = (state.tabsByWorktree[deps.worktreeId] ?? []).find(
      (candidate) => candidate.id === deps.tabId
    )
    const candidate =
      tab?.launchAgent ??
      paneStartup?.launchAgent ??
      paneStartup?.initialAgentStatus?.agent ??
      state.agentLaunchConfigByPaneKey[cacheKey]?.identity.agentType
    return isTuiAgent(candidate) ? candidate : null
  }
  // Why: a launched/hook-known agent pane must confirm — not trust — a 133;D so a
  // full-screen agent's leaked nested-shell 133;D can't clear its tab identity,
  // even on a restore where no command-start read has recorded evidence yet.
  const paneHasKnownAgentIdentity = (): boolean => {
    const state = useAppStore.getState()
    const registeredLaunchAgent = state.agentLaunchConfigByPaneKey[cacheKey]?.identity.agentType
    return (
      Boolean(state.paneForegroundAgentByPaneKey[cacheKey]?.agent) ||
      paneHasLiveHookAgentIcon(state) ||
      isTuiAgent(registeredLaunchAgent)
    )
  }
  // Why: a plain `codex`/`grok` sets its OSC title and the shell never repaints
  // it on exit, so a confirmed return-to-shell must clear a title that still
  // names an agent — otherwise the tab reads "grok" over a bare prompt. Only
  // reset an agent-named title; user/shell-set titles are left untouched.
  const clearStaleAgentTabTitleOnConfirmedShell = (): void => {
    const state = useAppStore.getState()
    const currentTitle = state.runtimePaneTitlesByTabId?.[deps.tabId]?.[pane.id]
    const tab = (state.tabsByWorktree[deps.worktreeId] ?? []).find(
      (entry) => entry.id === deps.tabId
    )
    const title = currentTitle ?? tab?.title
    if (!title || resolveCommittedTitleAgentType(title) === null) {
      return
    }
    const neutralTitle = neutralTerminalTitle()
    deps.setRuntimePaneTitle(deps.tabId, pane.id, neutralTitle)
    if (manager.getActivePane()?.id === pane.id) {
      deps.updateTabTitle(deps.tabId, neutralTitle)
    }
  }
  const commandFinishedStatusDropController =
    createPtyConnectionCommandFinishedStatusDropController()
  const isForegroundTrackingAllowed = (id: string): boolean => {
    if (isRemoteRuntimePtyId(id) || parseAppSshPtyId(id) !== null) {
      return false
    }
    if (!navigator.userAgent.includes('Windows')) {
      return true
    }
    const state = useAppStore.getState()
    const tab = (state.tabsByWorktree[deps.worktreeId] ?? []).find(
      (candidate) => candidate.id === deps.tabId
    )
    // Why: WSL and remote-runtime panes can never authorize native ConPTY
    // bytes, so do not pay for Windows process scans that cannot affect routing.
    return isLocalNativeWindowsConpty({
      userAgent: navigator.userAgent,
      connectionId: getConnectionId(deps.worktreeId) ?? null,
      cwd: deps.cwd,
      shellOverride: tab?.shellOverride,
      executionHostId: getExecutionHostIdForWorktree(state, deps.worktreeId)
    })
  }
  function startVisibleForegroundSample(expectsAgent: boolean): boolean {
    return paneForegroundAgentTracker.onVisiblePtyBound(expectsAgent)
  }
  const visibleForegroundSampleController = createPtyConnectionVisibleForegroundSampleController({
    resolveSample: (forceRoutingConfirmation) => {
      if (!deps.isVisibleRef.current) {
        return null
      }
      const state = useAppStore.getState()
      const foreground = state.paneForegroundAgentByPaneKey[cacheKey]
      // Why: a daemon reattach may restore display identity without current routing authority.
      if (foreground?.agent && foreground.routingTrusted === true) {
        return null
      }
      if (!forceRoutingConfirmation && paneHasLiveHookAgentIcon(state)) {
        return null
      }
      // Why: a completed local process ladder is stronger than stale launch metadata.
      if (foreground?.shellForeground) {
        return null
      }
      return { expectsAgent: paneExpectsLaunchAgent(state) }
    },
    sample: startVisibleForegroundSample
  })
  const paneForegroundAgentTracker = createPaneForegroundAgentTracker({
    getPtyId: () => transport.getPtyId(),
    isTrackablePtyId: isForegroundTrackingAllowed,
    readForegroundProcess: (id) => getClientRuntime().terminal.getForegroundProcess(id),
    confirmForegroundProcess: (id) => getClientRuntime().terminal.confirmForegroundProcess(id),
    publish: (entry) => useAppStore.getState().setPaneForegroundAgent(cacheKey, entry),
    hasKnownAgentIdentity: paneHasKnownAgentIdentity,
    onConfirmedShellForeground: (reason) => {
      clearStaleAgentTabTitleOnConfirmedShell()
      // Why: a hard-killed agent leaves mouse/focus/kitty modes armed, and the
      // surviving shell then receives pointer moves as typed SGR reports; the
      // replay guard keeps xterm's auto-replies from leaking to the shell.
      replayIntoTerminal(pane, deps.replayingPanesRef, POST_REPLAY_REATTACH_RESET, {
        breadcrumbIdentity: {
          tabId: deps.tabId,
          worktreeId: deps.worktreeId,
          ptyId: transport.getPtyId()
        },
        shouldRefreshViewportSynchronously: shouldRefreshForegroundSynchronously
      })
      if (reason === 'visible-pty') {
        useAppStore.getState().clearAgentLaunchConfig(cacheKey)
        return
      }
      commandFinishedStatusDropController.settle()
    },
    onCommandFinishedUnavailable: commandFinishedStatusDropController.settle,
    onVisibleForegroundSettled: visibleForegroundSampleController.settle
  })
  // Why: one command-finished policy whether the signal arrives as bytes
  // (remote PTYs, kill switch off) or as a main-derived pty:sideEffect fact —
  // routing both through this handler keeps the drop/interrupt semantics
  // identical across authority modes.
  const handleCommandFinished = (bestEffortExitCode: number | null): void => {
    clearCommandInferredPaneAgentAfterPtySideEffects()
    visibleForegroundSampleController.clearPending()
    const shouldDeferStatusDrop = paneForegroundAgentTracker.onCommandFinished()
    // Why: the finished command may have moved HEAD or the index (e.g.
    // `git checkout`); nudge git UI now instead of waiting for a poll.
    dispatchTerminalCommandFinishedEvent(deps.worktreeId, bestEffortExitCode)
    const state = useAppStore.getState()
    const entry = state.agentStatusByPaneKey[cacheKey]
    const inferenceResult = flushPendingInterruptInference()
    const dropStatus = (): void => {
      if (inferenceResult === true) {
        dropCommandFinishedStatusIfSameTurn(entry, { allowInferredInterrupt: true })
        return
      }
      if (inferenceResult instanceof Promise) {
        void inferenceResult.then((applied) => {
          dropCommandFinishedStatusIfSameTurn(entry, {
            allowInferredInterrupt: applied === true
          })
        })
        return
      }
      dropCommandFinishedStatusIfSameTurn(entry)
    }
    // Why: keep the concrete pane identity routable while local process evidence settles.
    commandFinishedStatusDropController.handle(dropStatus, shouldDeferStatusDrop)
  }
  const sampleVisiblePaneForegroundAgent = visibleForegroundSampleController.request
  setStartAcceptedInferredCommand((agent) => {
    paneForegroundAgentTracker.onCommandStarted(agent)
  })
  setRequestKnownDroidReconfirmation(() => {
    const foreground = useAppStore.getState().paneForegroundAgentByPaneKey[cacheKey]
    // Why: daemon reattach/launch metadata is display-only until a live
    // provider read confirms it. Submit/interrupt/title-exit evidence must
    // revoke that launch-only hint too, otherwise Shift+Enter can route bytes
    // to a Droid that already exited before confirmation ever ran.
    if (foreground?.agent !== 'droid') {
      return
    }
    // Why: cmd.exe and Git Bash have no OSC command boundaries. Keep the icon
    // as a hint, but revoke bytes until one current provider confirmation lands.
    useAppStore.getState().setPaneForegroundAgent(cacheKey, {
      agent: 'droid',
      shellForeground: false
    })
    visibleForegroundSampleController.reset()
    // Why: hook rows can suppress display-only sampling, but cannot restore
    // byte authority after this function explicitly revoked routing trust.
    sampleVisiblePaneForegroundAgent(true)
  })
  const droidReconfirmationController = createPtyConnectionDroidReconfirmationController({
    reconfirm: () => {
      requestKnownDroidReconfirmation()
      sampleVisiblePaneForegroundAgent()
    }
  })
  const commandLifecycle = createTerminalCommandLifecycle({
    onCommandStarted: () => {
      // Why: a new command invalidates cleanup waiting on the previous D; only
      // a later confirmed shell boundary may retire this pane's live identity.
      commandFinishedStatusDropController.clear()
      visibleForegroundSampleController.reset()
      // Why: typed commands can be aliases, so they only widen the bounded
      // process-confirmation window; they never become routing evidence.
      paneForegroundAgentTracker.onCommandStarted(getCommandInferredPaneAgent())
    },
    onCommandFinished: handleCommandFinished
  })
  // Why: the xterm OSC 133 swallow is rendering hygiene, not a side effect —
  // it stays attached in every authority mode.
  commandLifecycle.attachXtermConsumer(pane.terminal)
  const onTerminalKeyDown = (event: KeyboardEvent): void => {
    if (isPlainEscapeKeyEvent(event)) {
      setPendingTerminalInputIntent('plain-escape')
      // Why: plain Escape produces real terminal input (\x1b), so it is a
      // genuine "user is here" signal and must still dismiss attention before
      // the early return for interrupt-intent inference.
      deps.clearTerminalTabUnread(deps.tabId)
      deps.clearTerminalPaneUnread(cacheKey)
      deps.clearWorktreeUnread(deps.worktreeId)
      return
    }
    if (isCtrlCKeyEvent(event)) {
      if (!navigator.userAgent.includes('Mac') && pane.terminal.hasSelection()) {
        return
      }
      setPendingTerminalInputIntent('ctrl-c')
    }
    // Why: only treat keydowns that will produce real terminal input as the
    // "user is here" signal. Modifier-only presses, autorepeat, and Cmd/Ctrl+C
    // copy chords with an active selection must not dismiss attention on a
    // sibling pane before the user has seen it.
    if (
      event.repeat ||
      event.key === 'Alt' ||
      event.key === 'AltGraph' ||
      event.key === 'Control' ||
      event.key === 'Meta' ||
      event.key === 'Shift'
    ) {
      return
    }
    if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === 'c' &&
      pane.terminal.hasSelection()
    ) {
      return
    }
    // Why: user shell frameworks (bash-preexec/iTerm2) can replace Orca's
    // OSC 133;C hook, so a manually launched agent produces no command-start
    // signal at all. Enter at a shell-foreground prompt is the user-side
    // equivalent; the sample is gated to panes with no live agent identity
    // and publishes nothing for an idle shell.
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      sampleVisiblePaneForegroundAgent()
    }
    deps.clearTerminalTabUnread(deps.tabId)
    deps.clearTerminalPaneUnread(cacheKey)
    deps.clearWorktreeUnread(deps.worktreeId)
  }
  // Why: infer only from focused xterm key events. Raw PTY bytes cannot
  // distinguish plain Escape from Alt/meta sequences, and programmatic writes
  // should not clear agent status.
  const terminalKeyTarget = pane.terminal.element ?? pane.container
  const terminalKeyTargetSupportsEvents =
    typeof terminalKeyTarget?.addEventListener === 'function' &&
    typeof terminalKeyTarget?.removeEventListener === 'function'
  if (terminalKeyTargetSupportsEvents) {
    terminalKeyTarget.addEventListener('keydown', onTerminalKeyDown, { capture: true })
  }

  const remoteViewportClaimController = createPtyConnectionRemoteViewportClaimController({
    pane,
    deps,
    getTransport: () => transport
  })
  const reportPanePtyVisibility = (ptyId: string | null | undefined, visible: boolean): void => {
    if (!ptyId || isRemoteRuntimePtyId(ptyId)) {
      // Why: remote-runtime PTYs use a relay path outside main's local renderer-visibility registry.
      return
    }
    setRendererPtyVisibilityClaim(transport, ptyId, visible)
  }
  const setPanePtyFitBinding = (ptyId: string): void => {
    bindPanePtyId(pane.id, ptyId, deps.tabId)
    pane.container.dataset.ptyId = ptyId
    remoteViewportClaimController.armForPaneBinding(ptyId)
    // Why: override hydration can arrive before this pane knows its PTY. Once
    // data-pty-id is bound, safeFit can park xterm at the authoritative grid.
    if (getFitOverrideForPty(ptyId)) {
      safeFit(pane)
    }
    remoteViewportClaimController.claimPending()
  }

  // Why: with main side-effect authority on, the pane's title/bell/agent
  // policy callbacks consume pty:sideEffect facts instead of transport byte
  // parsers (which stay unregistered) — same policy code, single consumer.
  // restoreTitleOnRegister replaces the eager-replay title restore: main's
  // title-only snapshot carries the no-attention-replay rule.
  const sideEffectFactConsumerController = createPtyConnectionSideEffectFactConsumerController()
  const registerSideEffectFactConsumerForPty = (
    ptyId: string,
    remoteOutputPaused = false
  ): void => {
    if ((!mainSideEffectAuthority && !remoteOutputPaused) || disposed) {
      return
    }
    sideEffectFactConsumerController.replace(() =>
      registerTerminalSideEffectFactConsumer({
        ptyId,
        callbacks: {
          onTitleChange,
          onBell,
          onAgentBecameIdle,
          onAgentBecameWorking,
          onAgentExited,
          onCommandFinished: handleCommandFinished,
          onPrLink: (link) =>
            useAppStore.getState().observeTerminalGitHubPullRequestLink(deps.worktreeId, link),
          // Why: the Command Code settle policy stays here — the done settle
          // timer must consult the live store row (which hook events and
          // renderer seeds also write), so main only emits scrape facts.
          onCommandCodeWorking: seedCommandCodeOutputWorkingStatus,
          onCommandCodeDone: scheduleCommandCodeOutputDoneStatus,
          ...(shouldOwnAgentStatusInRenderer
            ? { onAgentStatus: (payload) => handleRendererOwnedAgentStatus(payload) }
            : {}),
          // Why: gated hidden panes never see the subscribe bytes; the fact
          // replaces the byte scan (and the old post-latch subscribe drop).
          ...(hiddenDeliveryGateActive || remoteOutputPaused
            ? {
                onMode2031Subscribe: handleHiddenMode2031SubscribeFact,
                onMode2031Unsubscribe: handleHiddenMode2031UnsubscribeFact
              }
            : {})
        },
        restoreTitleOnRegister: true
      })
    )
  }
  const dropSideEffectFactConsumer = sideEffectFactConsumerController.clear
  const clearPanePtyFitBinding = (): void => {
    // Why: fit bindings live in a module-level map, so pane teardown must
    // clear them explicitly instead of relying on DOM removal.
    bindPanePtyId(pane.id, null, deps.tabId)
    remoteViewportClaimController.clear()
    delete pane.container.dataset.ptyId
    delete pane.container.dataset.ptyRecoveryState
  }
  const panePtyBindingController = createPtyConnectionPanePtyBindingController({
    now: () => performance.now(),
    isVisible: () => deps.isVisibleRef.current,
    setFitBinding: setPanePtyFitBinding,
    clearFitBinding: clearPanePtyFitBinding,
    reportVisibility: reportPanePtyVisibility
  })

  const agentCompletionCoordinator = createAgentCompletionCoordinator({
    paneKey: cacheKey,
    getPtyId: () => transport.getPtyId(),
    getSettings: () => useAppStore.getState().settings,
    inspectProcess: inspectRuntimeTerminalProcess,
    dispatchHookLifecycle: (payload) => dispatchAgentHookTerminalLifecycle(cacheKey, payload),
    shouldSuppressProcessReplacementCompletion: (_exited, replacement) => {
      const currentStatus = useAppStore.getState().agentStatusByPaneKey[cacheKey]
      const currentAgentForReplacement = resolveCompatibleAgentTypeForOwner(
        currentStatus?.agentType,
        replacement.agent
      )
      return (
        isFreshNonDoneAgentStatus(currentStatus) && currentAgentForReplacement === replacement.agent
      )
    },
    shouldSuppressConfirmedProcessExitCompletion: (exited) => {
      const currentStatus = useAppStore.getState().agentStatusByPaneKey[cacheKey]
      const currentAgentForExited = resolveCompatibleAgentTypeForOwner(
        currentStatus?.agentType,
        exited.agent
      )
      // Why: a replacement hook can lead process visibility by one cadence;
      // only a different known active owner can veto confirmed old-process exit.
      return Boolean(
        isFreshNonDoneAgentStatus(currentStatus) &&
        currentStatus.agentType &&
        currentStatus.agentType !== 'unknown' &&
        currentAgentForExited !== exited.agent
      )
    },
    dispatchCompletion: (title, meta) => {
      if (meta?.source === 'process-exit') {
        titleCompletionDeferralController.clear()
      }
      if (meta?.terminalIdleConfirmed === true) {
        // Why: an agent can crash before its done hook; confirmed process death
        // must still restore cursor and native Windows Kitty keyboard modes.
        const currentAgentStatus = useAppStore.getState().agentStatusByPaneKey[cacheKey]
        if (!isFreshNonDoneAgentStatus(currentAgentStatus)) {
          agentIdleTerminalModeController.applyCompletionFocusSuppression(
            title,
            meta.agentStatus?.agentType
          )
        }
        agentIdleTerminalModeController.queueReset()
      }
      scheduleAgentTaskCompleteNotification(title, {
        allowDoneDetailAfterGrace: meta?.quietedHookDone,
        ...(meta?.source === 'process-exit' ? { agentCompletionSource: meta.source } : {}),
        ...(meta?.agentStatus ? { agentStatusSnapshot: meta.agentStatus } : {})
      })
    },
    dispatchAttention: (title, meta) =>
      scheduleAgentTaskCompleteNotification(title, {
        agentStatusSnapshot: meta.agentStatus
      }),
    shouldPollProcessCadence: () =>
      isAgentTaskCompleteTrackingEnabled() && deps.isVisibleRef.current,
    isProcessInspectionCostly: () => {
      // Why: local Windows inspection forks a powershell.exe whole-process-table
      // CIM scan per poll (~10-40x heavier than POSIX `ps`); SSH/remote PTYs run
      // their scans on the remote host, so only local Windows panes relax the
      // no-evidence cadence.
      if (!navigator.userAgent.includes('Windows')) {
        return false
      }
      const ptyId = transport.getPtyId()
      return ptyId !== null && !isRemoteRuntimePtyId(ptyId) && parseAppSshPtyId(ptyId) === null
    },
    isLive: () => {
      if (disposed) {
        return false
      }
      if (transport.getPtyId()) {
        return true
      }
      return (useAppStore.getState().ptyIdsByTabId[deps.tabId] ?? []).length > 0
    },
    shouldSuppressHookCompletion: createCodexAutoApprovalHookCompletionSuppressor(cacheKey, () => ({
      tabId: deps.tabId,
      ...(launchToken ? { launchToken } : {})
    }))
  })

  const hibernatedWakeController = createPtyConnectionHibernatedWakeController({
    isDisposed: () => disposed,
    isCurrentOwner: () => deps.paneTransportsRef.current.get(pane.id) === transport,
    getCurrentRecord: () => getSleepingRecordForPane(useAppStore.getState())?.record ?? null,
    getCurrentPtyId: () => transport.getPtyId(),
    getClaimKey: getProviderSessionClaimKey
  })
  const exitController = createPtyConnectionExitController({
    pane,
    manager,
    deps,
    cacheKey,
    getRuntimeEnvironmentId: () => runtimeEnvironmentId,
    getTransport: () => transport,
    resetRendererOrderedSeqForExit: rendererSequenceExitResetController.resetForExit,
    releaseCurrentPaneRuntime: () => {
      agentCompletionCoordinator.dispose()
      dropSideEffectFactConsumer()
      releaseHiddenRendererPtyDelivery()
      panePtyBindingController.clear()
      kittyKeyboardModes.reset()
    },
    onSuppressedExit: (ptyId) => {
      const sleepingRecordEntry = getSleepingRecordForPane(useAppStore.getState())
      if (
        sleepingRecordEntry &&
        isPassiveCompletedHibernationEvidence(sleepingRecordEntry.record)
      ) {
        // Why: hibernation killed this pane's PTY while hidden. The frozen TUI
        // frame still has mouse-tracking/bracketed-paste armed, which silently
        // eats every click and keystroke against a dead transport — disarm the
        // modes now and arm the reveal-time wake.
        replayIntoTerminal(pane, deps.replayingPanesRef, POST_REPLAY_MODE_RESET, {
          breadcrumbIdentity: {
            tabId: deps.tabId,
            worktreeId: deps.worktreeId,
            ptyId
          },
          shouldRefreshViewportSynchronously: shouldRefreshForegroundSynchronously
        })
        const { pendingMatches } = hibernatedWakeController.arm({
          ptyId,
          record: sleepingRecordEntry.record
        })
        if (deps.isVisibleRef.current || pendingMatches) {
          // Why: a reveal (or a mobile wake) that raced this kill already ran
          // before the exit landed, so it saw nothing armed. Consume the wake
          // now (deferred off the exit handler) so the pane still resumes
          // without needing a second hide/reveal or wake event.
          queueMicrotask(() => {
            hibernatedWakeController.consume()
          })
        }
      } else {
        hibernatedWakeController.clearPendingForPty(ptyId)
      }
    },
    getHadExistingPaneTransportAtConnect: () => hadExistingPaneTransportAtConnect,
    getRestoredPtyIdForTransport: () => restoredPtyIdForTransport,
    getLastTerminalInputAt: terminalActivityController.getLastInputAt,
    getHasReceivedPtyOutput: terminalActivityController.hasReceivedOutput
  })
  const { onExit } = exitController

  // Why: on app restart, restored Claude tabs may already be idle when we first
  // see their title. The agent status tracker only fires onBecameIdle for
  // working→idle transitions, so the cache timer would never start for these
  // sessions. We only allow this one-time seed for reattached PTYs; fresh
  // Claude launches also start idle, but they have no prompt cache yet.
  const initialCacheTimerSeedController = createInitialCacheTimerSeedController({
    getExistingTimerStartedAt: () => useAppStore.getState().cacheTimerByKey[cacheKey],
    getPromptCacheTimerEnabled: () =>
      useAppStore.getState().settings?.promptCacheTimerEnabled ?? null,
    seed: () => deps.setCacheTimerStartedAt(cacheKey, Date.now())
  })

  const resolveCurrentAgentStatusRouting = () => {
    const ptyId = panePtyBindingController.getPtyId() ?? transport.getPtyId()
    const state = useAppStore.getState()
    if (disposed || !ptyId) {
      return undefined
    }
    return resolveLiveAgentStatusConnectionRouting({
      state,
      paneKey: cacheKey,
      ptyId,
      expectedConnectionId: worktreeConnectionId,
      runtimeEnvironmentId: transport.getRuntimeEnvironmentId?.() ?? runtimeEnvironmentId
    })
  }

  const onTitleChange = (
    title: string,
    rawTitle: string,
    meta?: { staleWorkingTitleClear?: boolean }
  ): void => {
    // Why: one owner-aware decision drives the display label, the runtime/tab
    // title, task-completion tracking, and the renderer gate, so raw title text
    // can no longer disable GPU behind stronger owner evidence (#7428/#7447).
    const decision = resolvePaneTitleDecision({
      normalizedTitle: title,
      rawTitle,
      displayOwnerAgentType: getAuthoritativePaneAgent(),
      rendererOwnerAgentType: getPaneScopedRendererOwner(),
      userGpuMode: useAppStore.getState().settings?.terminalGpuAcceleration ?? 'auto'
    })
    const paneTitle = decision.displayTitle
    if (
      shouldSuppressCodexAutoApprovalSyntheticTitle(paneTitle, {
        paneKey: cacheKey,
        tabId: deps.tabId,
        ...(launchToken ? { launchToken } : {})
      })
    ) {
      return
    }
    manager.setPaneGpuRendering(pane.id, decision.rendererPolicy.gpuEnabled)
    deps.setRuntimePaneTitle(deps.tabId, pane.id, paneTitle)
    // Why: a stale-derived cleared title comes from main's unthrottled 3s
    // timer, not agent output. It must update the visible title but never
    // feed completion tracking — observeTitle would classify the cleared
    // title as idle and mint a task-complete for a merely-paused agent.
    if (!meta?.staleWorkingTitleClear && syncAgentTaskCompleteTrackingEnabled()) {
      const activeHookStatus = useAppStore.getState().agentStatusByPaneKey[cacheKey]
      if (!shouldSuppressTitleCompletionForFreshHook(decision.rawTitle, activeHookStatus)) {
        // Why: display titles still update while hooks are active, but a stale
        // idle frame must not complete the coordinator turn before hook `done`.
        agentCompletionCoordinator.observeTitle(decision.rawTitle)
      }
    }
    // Why: only the focused pane should drive the tab title — otherwise two
    // agents in split panes cause rapid title flickering as each emits OSC
    // sequences. Only the active split's title propagates to the tab. When
    // focus changes, onActivePaneChange syncs the newly active pane's stored
    // title to the tab.
    if (manager.getActivePane()?.id === pane.id) {
      deps.updateTabTitle(deps.tabId, paneTitle)
    }

    initialCacheTimerSeedController.observeTitle(rawTitle)
  }

  const applyInitialAgentStatus = (terminalTitle?: string): void => {
    const initialStatus = paneStartup?.initialAgentStatus
    const routing = resolveCurrentAgentStatusRouting()
    if (!initialStatus || !routing) {
      return
    }
    const statusPayload = {
      state: 'working' as const,
      prompt: initialStatus.prompt,
      agentType: resolveCompatibleAgentTypeForOwner(
        initialStatus.agent,
        getAuthoritativePaneAgent()
      )
    }
    if (paneStartup.launchConfig) {
      useAppStore
        .getState()
        .setAgentStatus(cacheKey, statusPayload, terminalTitle, undefined, routing, {
          launchConfig: paneStartup.launchConfig,
          ...(launchToken ? { launchToken } : {})
        })
      return
    }
    useAppStore
      .getState()
      .setAgentStatus(cacheKey, statusPayload, terminalTitle, undefined, routing)
  }

  const seedCommandCodeOutputWorkingStatus = (prompt: string): void => {
    clearCommandCodeOutputDoneTimer()
    const routing = resolveCurrentAgentStatusRouting()
    if (!routing) {
      return
    }
    const currentState = useAppStore.getState()
    const currentEntry = currentState.agentStatusByPaneKey[cacheKey]
    const currentTitle = currentState.runtimePaneTitlesByTabId?.[deps.tabId]?.[pane.id]
    const normalizedPrompt = prompt.trim()
    if (
      currentEntry?.agentType === 'command-code' &&
      currentEntry.state === 'done' &&
      (!normalizedPrompt || normalizedPrompt === currentEntry.prompt.trim())
    ) {
      return
    }
    currentState.setAgentStatus(
      cacheKey,
      {
        state: 'working',
        prompt: normalizedPrompt || (currentEntry?.state === 'working' ? currentEntry.prompt : ''),
        agentType: 'command-code'
      },
      currentTitle,
      undefined,
      routing
    )
  }

  // Why the settle window lives outside this binding: park unmounts the pane
  // mid-settle, so a pane-owned timer would be cancelled with nothing left to
  // complete the turn — the row would stick at 'working'. Only the row write
  // (routing + title slot) is pane-local; the deadline transfers to whichever
  // owner (parked watcher or remounted pane) holds the pane next.
  const releaseCommandCodeDoneSettleExecutor = setCommandCodeDoneSettleExecutor(
    cacheKey,
    (normalizedPrompt) => {
      const routing = resolveCurrentAgentStatusRouting()
      if (!routing) {
        return
      }
      const currentState = useAppStore.getState()
      const currentEntry = currentState.agentStatusByPaneKey[cacheKey]
      if (currentEntry?.agentType !== 'command-code' || currentEntry.state !== 'working') {
        return
      }
      const currentPrompt = currentEntry.prompt.trim()
      if (currentPrompt && currentPrompt !== normalizedPrompt) {
        return
      }
      const currentTitle = currentState.runtimePaneTitlesByTabId?.[deps.tabId]?.[pane.id]
      currentState.setAgentStatus(
        cacheKey,
        {
          state: 'done',
          prompt: currentPrompt || normalizedPrompt,
          agentType: 'command-code'
        },
        currentTitle,
        undefined,
        routing
      )
    }
  )
  const clearCommandCodeOutputDoneTimer = (): void => cancelCommandCodeDoneSettle(cacheKey)
  const scheduleCommandCodeOutputDoneStatus = (prompt: string): void => {
    const normalizedPrompt = prompt.trim()
    if (!normalizedPrompt) {
      cancelCommandCodeDoneSettle(cacheKey)
      return
    }
    // Why: Command Code keeps rendering the composer while tools run. Only
    // complete the row if no active status repaint arrives during this window.
    openCommandCodeDoneSettle(cacheKey, normalizedPrompt)
  }

  const observeTerminalGitHubPRLink = createTerminalGitHubPRLinkDetector()
  const bindActivePanePty = (
    ptyId: string,
    options: {
      seedInitialAgentStatus?: boolean
      updateTabPtyId?: 'always' | 'if-missing'
      replacePtyId?: string
      sampleVisibleForegroundAgent?: boolean
    } = {}
  ): void => {
    panePtyBindingController.bind(ptyId)
    registerSideEffectFactConsumerForPty(ptyId)
    syncHiddenRendererPtyDelivery()
    deps.syncPanePtyLayoutBinding(pane.id, ptyId)
    notifyCodexPaneBoundForStaleSweep(ptyId)
    const tabPtyIds = useAppStore.getState().ptyIdsByTabId?.[deps.tabId] ?? []
    const directSshRetryAttemptId =
      hasCapturedDirectSshRetryPtyAccepted() && directSshRetryAttempt
        ? directSshRetryAttempt.attemptId
        : undefined
    if (
      directSshRetryAttemptId ||
      options.updateTabPtyId !== 'if-missing' ||
      !tabPtyIds.includes(ptyId)
    ) {
      if (directSshRetryAttemptId) {
        deps.updateTabPtyId(deps.tabId, ptyId, options.replacePtyId, directSshRetryAttemptId)
      } else if (options.replacePtyId) {
        deps.updateTabPtyId(deps.tabId, ptyId, options.replacePtyId)
      } else {
        deps.updateTabPtyId(deps.tabId, ptyId)
      }
    }
    if (options.seedInitialAgentStatus) {
      applyInitialAgentStatus()
    }
    // Spawn/attach completion is when a pane gains a concrete PTY ID. The initial
    // frame-level sync often runs before that async result arrives.
    scheduleRuntimeGraphSync()
    agentCompletionCoordinator.startProcessTracking()
    // Why: fresh spawns normally rely on a future OSC 133 command-start read to
    // identify the launched agent; only adopted or restored PTYs may already be
    // inside Codex with no new foreground signal. But no-OSC shells (Git Bash,
    // cmd.exe) never emit a command-start, so an expected-agent pane spawned into
    // one would never gain the fresh process evidence that authorizes Droid's
    // Windows Shift+Enter CSI-u routing — leaving Shift+Enter to submit (#7620).
    // Seed the SAME command-start confirmation the manually-typed launch path
    // uses (onCommandStarted): its bounded retry ladder spans agent boot, and a
    // miss publishes shellForeground:false — recoverable by later focus/reveal
    // samples. A visible-pty sample would instead let a slow boot latch a
    // known-agent shell-confirm that clears launch identity and blocks recovery.
    // A real OSC 133;C, if it arrives, simply supersedes this.
    if (options.sampleVisibleForegroundAgent === true) {
      sampleVisiblePaneForegroundAgent()
    } else if (options.seedInitialAgentStatus === true) {
      const freshSpawnLaunchAgent = resolveExpectedLaunchTuiAgent()
      if (freshSpawnLaunchAgent) {
        paneForegroundAgentTracker.onCommandStarted(freshSpawnLaunchAgent)
      }
    }
  }

  const onPtySpawn = (ptyId: string): void => {
    if (!claimCapturedDirectSshRetryPty(ptyId)) {
      // Why: this callback proves a fresh process was created, so rejecting its obsolete lease must also retire it.
      queueMicrotask(() => {
        if (transport.getPtyId() === ptyId) {
          transport.disconnect()
        }
      })
      return
    }
    // Why: record that this exact PTY was freshly spawned (not reattached), so a
    // newborn shell that dies before any interaction (e.g. failing direnv on a
    // just-created worktree) can be kept visible rather than tearing down the
    // worktree. Reattach/coldRestore skip onPtySpawn (pty-transport.ts).
    exitController.noteFreshSpawn(ptyId)
    // Why: Command Code has no prompt-start hook. Seed the visible working row
    // once the PTY exists, then let real hook events refine or complete it.
    bindActivePanePty(ptyId, { seedInitialAgentStatus: true })
  }
  const onPtyRebind = (ptyId: string, replacedPtyId: string): void => {
    if (!canAdoptCapturedDirectSshRetryPty(ptyId)) {
      return
    }
    // Why: provider handle rotation keeps the existing pane/session generation;
    // replace its stale store identity without fresh-spawn exit semantics.
    bindActivePanePty(ptyId, { replacePtyId: replacedPtyId })
  }
  // ─── Attention signal: BEL ────────────────────────────────────────────
  //
  const {
    onBell,
    scheduleAgentTaskCompleteNotification,
    syncAgentTaskCompleteTrackingEnabled,
    markFreshWorking,
    clearPendingAgentTaskCompleteNotification,
    schedulePendingTerminalBellNotification,
    dispose: disposeAgentNotificationController
  } = createPtyConnectionAgentNotificationController({
    deps,
    paneKey: cacheKey,
    agentCompletionCoordinator,
    isDisposed: () => disposed
  })

  // ─── Agent task-complete: notification-backed attention ───────────────
  //
  // The working→idle title transition drives two independent concerns:
  //   1. The Claude prompt-cache countdown in the sidebar.
  //   2. The "Agent Task Complete" OS notification users toggle in Settings.
  //
  // This path raises the same terminal attention marker as BEL through the
  // shared notification dispatcher. Not every agent CLI reliably emits BEL on
  // completion (Gemini, some Codex flows), and the highlight needs to remain
  // findable after the OS banner is gone. Double-firing with a concurrent BEL
  // is handled by delaying the BEL OS notification below; main still keeps a
  // 5 s per-worktree dedupe as the final guard.
  const onAgentBecameIdle = (title: string, meta?: { staleWorkingTitleClear?: boolean }): void => {
    // Why: a stale-derived idle comes from main's UNTHROTTLED 3s timer, not
    // observed bytes — a merely-paused agent (>3s silent mid-task, window
    // minimized) would otherwise mint a false task-complete OS notification
    // that renderer timer throttling previously damped. Clear session-tied
    // state only; never schedule completion attention from it.
    if (meta?.staleWorkingTitleClear) {
      deps.setCacheTimerStartedAt(cacheKey, null)
      return
    }
    const currentState = useAppStore.getState()
    const activeHookStatus = currentState.agentStatusByPaneKey[cacheKey]
    if (shouldSuppressTitleCompletionForFreshHook(title, activeHookStatus)) {
      // Why: agent CLIs can briefly publish an idle title while hook status
      // still says the same agent turn is active (e.g. during tool output).
      if (activeHookStatus) {
        titleCompletionDeferralController.preserve(title, activeHookStatus)
      }
      return
    }
    // Why: only start the prompt-cache countdown for Claude agents — other
    // agents have different (or no) prompt-caching semantics and showing a
    // timer for them would be misleading.
    //
    // Why we check `settings !== null` separately: during startup, settings
    // hydrate asynchronously after terminals reconnect. If we treat null
    // as disabled, the first working→idle transition on a restored Claude
    // tab silently drops the timer. Writing a timestamp is cheap and the
    // CacheTimer component gates rendering on the enabled flag, so a
    // spurious write when the feature turns out to be disabled is harmless.
    const settings = currentState.settings
    if (isClaudeAgent(title) && (settings === null || settings.promptCacheTimerEnabled)) {
      deps.setCacheTimerStartedAt(cacheKey, Date.now())
    }
    if (detectAgentStatusFromTitle(title) === 'idle') {
      agentIdleTerminalModeController.applyCompletionFocusSuppression(
        title,
        activeHookStatus?.agentType
      )
    }
    if (syncAgentTaskCompleteTrackingEnabled()) {
      agentCompletionCoordinator.observeClassifiedTitleCompletion(title)
    }
    // Why: some agent TUIs leave xterm renderer modes active after a turn.
    // Reset cursor everywhere, and Kitty keyboard state on native Windows.
    agentIdleTerminalModeController.queueReset()
  }
  const onAgentBecameWorking = (): void => {
    agentIdleTerminalModeController.clearFocusSuppression()
    titleCompletionDeferralController.clear()
    if (markFreshWorking()) {
      agentCompletionCoordinator.observeTitleWorking()
    }
    // Why: a new API call refreshes the prompt-cache TTL, so clear any running
    // countdown. The timer will restart when the agent becomes idle again.
    deps.setCacheTimerStartedAt(cacheKey, null)
    clearPendingAgentTaskCompleteNotification()
    schedulePendingTerminalBellNotification()
  }
  const onAgentExited = (): void => {
    // Why: eligibility can disappear transiently during reconnect, but a
    // confirmed shell-title transition is authoritative for native-chat exit.
    deps.onAgentExitedRef.current(pane.leafId)
    titleCompletionDeferralController.clear()
    clearCommandInferredPaneAgent()
    requestKnownDroidReconfirmation()
    // Why: when the terminal title reverts to a plain shell (e.g., "bash", "zsh"),
    // the agent has exited. Clear any running cache timer so the sidebar doesn't
    // show a stale countdown for a tab that no longer has an active Claude session.
    deps.setCacheTimerStartedAt(cacheKey, null)
    titleOnlyInterruptController.clear()
    // Why: title reversion alone is not process death. The process/PTY tracker
    // owns removing agent rows when the TUI actually exits.
  }
  // Why: inject ORCA_PANE_KEY so global Claude/Codex hooks can attribute their
  // callbacks to the correct Orca pane without resolving worktrees from cwd.
  // The key matches the `${tabId}:${leafId}` composite used for cacheTimerByKey
  // and agentStatusByPaneKey. Treat it as opaque outside Orca.
  const state = useAppStore.getState()
  const parsedWorkspaceKey = parseWorkspaceKey(deps.worktreeId)
  const folderWorkspace =
    parsedWorkspaceKey?.type === 'folder'
      ? state.folderWorkspaces.find(
          (workspace) => workspace.id === parsedWorkspaceKey.folderWorkspaceId
        )
      : null
  const workspaceEnv: Record<string, string> = { ORCA_WORKSPACE_ID: deps.worktreeId }
  if (folderWorkspace) {
    workspaceEnv.ORCA_PROJECT_GROUP_ID = folderWorkspace.projectGroupId
    workspaceEnv.ORCA_WORKSPACE_ROOT = folderWorkspace.folderPath
  }
  const paneIdentityEnv = {
    ...workspaceEnv,
    ORCA_PANE_KEY: cacheKey,
    ORCA_TAB_ID: deps.tabId,
    ORCA_WORKTREE_ID: deps.worktreeId,
    ...(launchToken ? { ORCA_AGENT_LAUNCH_TOKEN: launchToken } : {})
  }
  const paneEnv = {
    ...paneStartup?.env,
    ...paneIdentityEnv
  }

  // Why: folder workspaces can inherit their SSH target from child repos, so
  // use the shared resolver instead of only looking up repo-backed worktrees.
  const worktree = getWorktreeMapFromState(state).get(deps.worktreeId)
  const worktreeConnectionId = getConnectionId(deps.worktreeId)
  const tab = (state.tabsByWorktree[deps.worktreeId] ?? []).find((t) => t.id === deps.tabId)
  const restoredPtyIdForTransport =
    deps.restoredLeafId && deps.restoredPtyIdByLeafId
      ? (deps.restoredPtyIdByLeafId[deps.restoredLeafId] ?? null)
      : null
  // Why: the floating terminal and inline setup/onboarding terminals are host-agnostic synthetic
  // ids with no worktree/repo row, so the strict owner resolver reports them as unresolved. The
  // shared terminal router scopes them to their floating owner (local for the floating terminal,
  // the active runtime for setup terminals so remote skill installs land there) and returns null
  // only for a genuinely unknown/stale worktree that must fail closed (#9994).
  const terminalWorktreeRoute = resolveTerminalWorktreeRoute(state, deps.worktreeId)
  const explicitRuntimeEnvironmentId = terminalWorktreeRoute?.runtimeEnvironmentId ?? null
  // Why: paired-web worktrees retain HUB execution identity; their runtime-scoped mirrored pane is the session-level transport owner.
  const mirroredRuntimeOwners = new Set(
    isWebTerminalSurfaceTabId(deps.tabId)
      ? [restoredPtyIdForTransport, tab?.ptyId]
          .map((ptyId) => (ptyId ? getRemoteRuntimePtyEnvironmentId(ptyId) : null))
          .filter((environmentId): environmentId is string => Boolean(environmentId))
      : []
  )
  const mirroredRuntimeEnvironmentId = mirroredRuntimeOwners.values().next().value ?? null
  const terminalOwnerUnresolved =
    mirroredRuntimeOwners.size > 1 ||
    (terminalWorktreeRoute === null && !mirroredRuntimeEnvironmentId)
  const runtimeEnvironmentId = explicitRuntimeEnvironmentId
    ? explicitRuntimeEnvironmentId
    : mirroredRuntimeEnvironmentId
      ? mirroredRuntimeEnvironmentId
      : null
  // Why: host-agnostic synthetic ids (floating terminal, inline setup panels) have no repo
  // row by design, and a worktree row stamped 'local' proves its host on its own — both are
  // resolved-local, not pending hydration (#10151). Only when nothing names the host does
  // `undefined` mean the repo hasn't merged yet; coalescing that to null would fail-open a
  // remote cwd onto the local daemon (ENOENT on Docker SSH paths).
  const hostAgnosticTerminalWorktree =
    deps.worktreeId === FLOATING_TERMINAL_WORKTREE_ID ||
    isEphemeralSetupTerminalWorktreeId(deps.worktreeId)
  const worktreeProvesLocalHost = parseExecutionHostId(worktree?.hostId)?.kind === 'local'
  const connectionOwnerHydrating =
    !terminalOwnerUnresolved &&
    !hostAgnosticTerminalWorktree &&
    !worktreeProvesLocalHost &&
    runtimeEnvironmentId === null &&
    worktreeConnectionId === undefined
  // Why: an SSH host nested under a HUB is execution identity, not permission for the paired client to dial that host.
  const connectionId =
    !terminalOwnerUnresolved && !connectionOwnerHydrating && runtimeEnvironmentId === null
      ? (worktreeConnectionId ?? null)
      : null
  const {
    directSshRetryAttempt,
    pendingSpawnKey,
    hasCapturedDirectSshRetryPtyAccepted,
    capturedDirectSshRetryLeaseMatches,
    capturedDirectSshRetryStateMatches,
    claimCapturedDirectSshRetryPty,
    canAdoptCapturedDirectSshRetryPty,
    settleDirectSshPaneRetryAttempt,
    armDirectSshPaneRetryTimeout,
    dispose: disposeDirectSshRetryController
  } = createPtyConnectionDirectSshRetryController({
    cacheKey,
    connectionId,
    worktreeId: deps.worktreeId,
    tabId: deps.tabId,
    tabGeneration: tab?.generation ?? 0,
    isDisposed: () => disposed
  })
  const shellOverride = tab?.shellOverride
  // Why: a serve/remote-runtime pane has no SSH connectionId and a Linux cwd, so
  // the native-Windows ConPTY heuristic misfires on a Windows client and wrongly
  // enables ConPTY synchronized-output protection, which strips an agent's
  // transient cursor-show (?25h) and leaves the cursor invisible. The execution
  // host is the authoritative signal: only a 'local' host is a local native PTY.
  const executionHostId = terminalOwnerUnresolved
    ? ('runtime:unresolved-owner' as const)
    : getExecutionHostIdForWorktree(state, deps.worktreeId)
  const isNativeWindowsConpty = isLocalNativeWindowsConpty({
    userAgent: navigator.userAgent,
    connectionId,
    cwd: deps.cwd,
    // Why: main folds the global Windows shell into its spawn classification
    // (pty.ts effectiveShellOverride); fold it here too so both sides treat
    // a global-WSL default identically (terminal-query-authority.md ConPTY).
    shellOverride: resolveWindowsShellOverride(shellOverride, state.settings?.terminalWindowsShell),
    executionHostId
  })
  if (isNativeWindowsConpty) {
    // Why: Windows ConPTY agent turns can leave renderer keyboard modes armed
    // after completion, corrupting plain input with encoded bytes.
    agentIdleTerminalModeController.enableNativeWindowsReset()
  }
  const shouldApplyNativeWindowsRewriteRefresh = isNativeWindowsConpty
  const shouldApplyWindowsRendererUnicodeRefresh = CLIENT_PLATFORM === 'win32'
  const shouldProtectNativeWindowsSynchronizedOutput = isNativeWindowsConpty
  const windowsDoneStatusController = createPtyConnectionWindowsDoneStatusController({
    enabled: isNativeWindowsConpty,
    initialStatus: state.agentStatusByPaneKey[cacheKey],
    historyResumeIdleCodex:
      paneStartup?.telemetry?.launch_source === 'sidebar' &&
      paneStartup.telemetry.request_kind === 'resume' &&
      (paneStartup.launchAgent === 'codex' || paneStartup.telemetry.agent_kind === 'codex'),
    subscribe: (listener) =>
      useAppStore.subscribe((nextState) => listener(nextState.agentStatusByPaneKey[cacheKey])),
    applyCompletionSuppression: (agentType) =>
      agentIdleTerminalModeController.applyCompletionFocusSuppression(undefined, agentType),
    setCodexSuppression: agentIdleTerminalModeController.setCodexFocusSuppressed,
    clearSuppression: agentIdleTerminalModeController.clearFocusSuppression,
    queueIdleReset: agentIdleTerminalModeController.queueReset
  })

  const localWindowsTerminalCapabilities = hasCachedWindowsTerminalCapabilities()
    ? getCachedWindowsTerminalCapabilities()
    : null
  const projectRuntime =
    !connectionId && runtimeEnvironmentId === null
      ? getLocalProjectExecutionRuntimeContext(state, deps.worktreeId, undefined, {
          wslAvailable: localWindowsTerminalCapabilities?.wslAvailable,
          availableWslDistros: localWindowsTerminalCapabilities?.wslDistros ?? null
        })
      : undefined
  const shouldOwnAgentStatusInRenderer = runtimeEnvironmentId !== null
  const handleRendererOwnedAgentStatus: NonNullable<IpcPtyTransportOptions['onAgentStatus']> = (
    payload
  ): void => {
    if (
      shouldSuppressCodexAutoApprovalStatus(payload, {
        paneKey: cacheKey,
        tabId: deps.tabId,
        ...(launchToken ? { launchToken } : {})
      })
    ) {
      return
    }
    const currentState = useAppStore.getState()
    const routing = resolveCurrentAgentStatusRouting()
    if (!routing) {
      return
    }
    const title = currentState.runtimePaneTitlesByTabId?.[deps.tabId]?.[pane.id]
    const authoritativePaneAgent = getAuthoritativePaneAgent()
    const agentType = resolveCompatibleAgentTypeForOwner(payload.agentType, authoritativePaneAgent)
    const statusPayload = agentType === payload.agentType ? payload : { ...payload, agentType }
    const resolvedStatusTitle = resolveAgentStatusTerminalTitle(statusPayload, title)
    const statusTitle = resolvedStatusTitle
      ? normalizeCompatibleAgentTitleForOwner(
          resolvedStatusTitle,
          agentType ?? authoritativePaneAgent
        )
      : resolvedStatusTitle
    if (launchToken) {
      currentState.setAgentStatus(cacheKey, statusPayload, statusTitle, undefined, routing, {
        launchToken
      })
    } else {
      currentState.setAgentStatus(cacheKey, statusPayload, statusTitle, undefined, routing)
    }
    if (payload.state === 'working') {
      markFreshWorking()
    }
    const storedStatus = useAppStore.getState().agentStatusByPaneKey[cacheKey]
    const notificationPayload =
      typeof storedStatus?.stateStartedAt === 'number'
        ? { ...statusPayload, stateStartedAt: storedStatus.stateStartedAt }
        : statusPayload
    // Why: hook lifecycle owns deferred side effects even when alerts are disabled.
    agentCompletionCoordinator.observeHookStatus(notificationPayload)
    if (payload.state === 'working') {
      schedulePendingTerminalBellNotification()
    }
  }
  // Why: when main holds side-effect authority for this PTY's bytes, the
  // transport must NOT register title/bell/agent byte parsers — the
  // pty:sideEffect fact consumer below is the single policy consumer.
  // Decided once at transport creation so a fact never has two consumers.
  const mainSideEffectAuthority = isMainTerminalSideEffectAuthorityForPty({
    settings: state.settings,
    runtimeEnvironmentId
  })
  // Why: Phase-4 hidden-delivery gate — only meaningful under main authority
  // (renderer byte parsers need bytes otherwise). Decided once at pane
  // creation: it picks the mode-2031 answer path (fact reply vs byte scan),
  // which must have exactly one owner.
  const hiddenDeliveryGateActive =
    mainSideEffectAuthority && isRendererHiddenPtyDeliveryGateEnabled(state.settings)
  // Why: structural per-PTY gate predicate (authority on + gate on + bytes
  // transit local main, which implies snapshot-backed). Shared by the hidden
  // mark sync and mode-2031 reply ownership so reply ownership can never
  // disagree with what main may drop — and never depends on the racy hidden
  // mark (a fact can outrun the pty:data task that sets it).
  const isHiddenDeliveryGateManagedPty = (ptyId: string | null): ptyId is string =>
    hiddenDeliveryGateActive && Boolean(ptyId) && !isRemoteRuntimePtyId(ptyId)
  const hiddenDeliveryController = createPtyConnectionHiddenDeliveryController({
    getPtyId: () => transport.getPtyId(),
    setOutputPaused: (paused) => {
      transport.setOutputPaused?.(paused)
    },
    isDisposed: () => disposed,
    isForeground: () => shouldWritePtyOutputForeground(deps.isVisibleRef.current),
    isRemotePty: (ptyId) => Boolean(ptyId && isRemoteRuntimePtyId(ptyId)),
    isGateManagedPty: isHiddenDeliveryGateManagedPty,
    acquireHiddenClaim: acquireHiddenRendererPtyDeliveryClaim,
    declareVisible: declareRendererPtyDeliveryVisible,
    registerModelRestore: registerPtyModelRestoreNeededHandler,
    remotePause: remoteOutputPauseController,
    mainSideEffectAuthority,
    registerSideEffectFacts: registerSideEffectFactConsumerForPty,
    dropSideEffectFacts: dropSideEffectFactConsumer
  })
  const syncHiddenRendererPtyDelivery = hiddenDeliveryController.sync
  const releaseHiddenRendererPtyDelivery = hiddenDeliveryController.release
  const handleRemoteOutputPauseChanged = hiddenDeliveryController.handleRemoteOutputPauseChanged
  // Why (byte-parser mode only): with main authority the Command Code scrape
  // runs in main's per-PTY tracker and arrives as command-code facts; running
  // the byte detector too would double-drive the seed/settle policy above.
  const commandCodeOutputStatusDetector = mainSideEffectAuthority
    ? null
    : createCommandCodeOutputStatusDetector({
        startupCommand: paneStartup?.command,
        // Why the seed: a reveal remount recreates this detector long past the banner
        // (and with no startup command); a turn parked mid-flight must still arm the
        // scrape so its return to the idle composer completes the row.
        inFlightTurn: readInFlightCommandCodeTurn(cacheKey),
        onWorking: seedCommandCodeOutputWorkingStatus,
        onDone: scheduleCommandCodeOutputDoneStatus
      })
  const shouldDeliverStartupViaTerminalPaste = paneStartup?.delivery === 'terminal-paste'
  const hadExistingPaneTransportAtConnect = deps.paneTransportsRef.current.size > 0
  const streamGenerationController = createPtyConnectionStreamGenerationController()
  const markTerminalInputSent = (): void => {
    terminalActivityController.markInput(performance.now())
    // Why: input must probe a wedged xterm even when the PTY produces no renderer output.
    requestTerminalWritePipelineProbe(pane.terminal)
  }
  const recordTerminalInputForHibernation = (): void => {
    useAppStore.getState().recordTerminalInput(cacheKey)
  }
  // Why: onData mixes real user input with xterm's parser auto-replies (focus
  // reports, DA/DSR/CPR responses). Recording those replies as activity makes
  // the hibernation planner treat a pane hidden after its agent finished as
  // "input after done" forever. The core user-input signal fires only for real
  // input, so hibernation activity records from it; onData recording remains
  // solely as the fallback when the internal API is unavailable.
  const userInputActivityDisposable = subscribeToTerminalUserInput(
    pane.terminal,
    recordTerminalInputForHibernation
  )
  const recordTerminalInputForHibernationFallback = (): void => {
    if (userInputActivityDisposable === null) {
      recordTerminalInputForHibernation()
    }
  }
  const markAcceptedTerminalInputSent = (): void => {
    markTerminalInputSent()
    recordTerminalInputForHibernationFallback()
  }
  const terminalTheme = pane.terminal.options.theme
  const terminalColorQueryReplies = terminalTheme
    ? { foreground: terminalTheme.foreground, background: terminalTheme.background }
    : undefined
  const agentLaunchPreferences = toAgentLaunchPreferences(paneStartup?.sessionOptions)
  const transportOptions = {
    cwd: deps.cwd,
    // Why: only fresh local IPC spawns may recover from a saved startup cwd
    // whose directory was deleted (#7239); remote-runtime and SSH spawns
    // resolve cwd on another host and must keep exact cwd semantics.
    ...(runtimeEnvironmentId === null && !connectionId ? { cwdFallback: 'worktree' as const } : {}),
    env: paneEnv,
    ...(paneStartup?.envToDelete ? { envToDelete: paneStartup.envToDelete } : {}),
    command: shouldDeliverStartupViaTerminalPaste ? undefined : paneStartup?.command,
    startupCommandDelivery: shouldDeliverStartupViaTerminalPaste
      ? undefined
      : paneStartup?.startupCommandDelivery,
    connectionId,
    executionHostId,
    worktreeId: deps.worktreeId,
    // Why: closes the SIGKILL race documented in INVESTIGATION.md by letting
    // main sync-flush the (worktreeId, tabId, leafId → ptyId) binding before
    // pty:spawn returns. Daemon-host-only: SSH path leaves these undefined
    // and the main-side guard short-circuits.
    tabId: deps.tabId,
    leafId: pane.leafId,
    activate: deps.isActiveRef.current && deps.isVisibleRef.current,
    ...(shellOverride ? { shellOverride } : {}),
    ...(projectRuntime ? { projectRuntime } : {}),
    ...(terminalColorQueryReplies ? { terminalColorQueryReplies } : {}),
    ...(paneStartup?.launchConfig ? { launchConfig: paneStartup.launchConfig } : {}),
    ...(paneStartup?.resumeProviderSession
      ? { resumeProviderSession: paneStartup.resumeProviderSession }
      : {}),
    ...((paneStartup?.initialAgentStatus?.prompt ?? paneStartup?.draftPrompt)
      ? { agentPrompt: paneStartup?.initialAgentStatus?.prompt ?? paneStartup?.draftPrompt }
      : {}),
    ...(paneStartup?.initialAgentStatus?.prompt
      ? { agentPromptDelivery: 'auto-submit' as const }
      : paneStartup?.draftPrompt
        ? { agentPromptDelivery: 'draft' as const }
        : {}),
    ...(paneStartup?.agentArgsOverride !== undefined
      ? { agentArgsOverride: paneStartup.agentArgsOverride }
      : {}),
    ...(agentLaunchPreferences ? { agentLaunchPreferences } : {}),
    ...(launchToken ? { launchToken } : {}),
    ...(paneStartup?.launchAgent ? { launchAgent: paneStartup.launchAgent } : {}),
    ...(paneStartup?.telemetry ? { telemetry: paneStartup.telemetry } : {}),
    onPtyExit: onExit,
    onPtySpawn,
    onPtyRebind,
    ...(mainSideEffectAuthority
      ? {}
      : {
          onTitleChange,
          onBell,
          onAgentBecameIdle,
          onAgentBecameWorking,
          onAgentExited
        }),
    // Why: local IPC terminals are now model-owned in main: OrcaRuntimeService
    // parses OSC 9999 before renderer delivery and forwards through the hook
    // server with local/SSH identity. Remote-runtime streams do not pass through
    // local main, so the renderer remains their status owner for now.
    ...(shouldOwnAgentStatusInRenderer ? { onAgentStatus: handleRendererOwnedAgentStatus } : {})
  }
  if (connectionOwnerHydrating) {
    // Why: this pane holds an inert transport until its host resolves; register it so
    // the repos:changed handler remounts it instead of leaving the terminal blank.
    recordTerminalTabParkedOnUnresolvedHost(deps.worktreeId, deps.tabId)
  }
  const transport =
    terminalOwnerUnresolved || connectionOwnerHydrating
      ? createUnresolvedOwnerPtyTransport(
          terminalOwnerUnresolved
            ? 'Workspace identity is ambiguous across hosts. Refresh projects and try again.'
            : 'Workspace host is still loading. Retry when the project finishes hydrating.'
        )
      : runtimeEnvironmentId
        ? createRemoteRuntimePtyTransport(runtimeEnvironmentId, transportOptions)
        : createIpcPtyTransport(transportOptions)
  const reattachLiveDataController = createPtyConnectionReattachLiveDataController({
    getPtyId: () => transport.getPtyId(),
    getStreamGeneration: streamGenerationController.getCurrent,
    isDisposed: () => disposed,
    takeDeliveryCredit: takeCurrentTerminalDeliveryCredit,
    deliverWithDeferredCredit: deliverTerminalDataWithDeferredCredit
  })
  const canSendDesktopQueryReply = (): boolean => {
    const ptyId = transport.getPtyId()
    return !ptyId || !isPtyLocked(ptyId)
  }
  // Why: parser/capability handlers bypass the ordinary onData guard. Keep
  // desktop silent while the elected mobile xterm owns query replies.
  const sendDesktopQueryReplyImmediate = (data: string): boolean =>
    canSendDesktopQueryReply() && transport.sendInputImmediate(data)
  // Why (gate mode only): for gate-managed PTYs this fact is the SOLE 2031
  // responder — visible, hidden, marked or not. Conditioning the reply on the
  // hidden mark double-fired (mark set + bytes delivered live via interest →
  // fact AND xterm both replied) or dropped the reply entirely (fact outran
  // the pty:data task that set the mark). The xterm-side CSI reply and the
  // skipped-byte scan are disabled for these panes (same structural
  // predicate), so exactly one reply goes out.
  const handleHiddenMode2031SubscribeFact = (): void => {
    const ptyId = transport.getPtyId()
    if (
      disposed ||
      (!isHiddenDeliveryGateManagedPty(ptyId) && !remoteOutputPauseController.isPaused(ptyId))
    ) {
      return
    }
    const mode = resolveTerminalColorSchemeMode(
      useAppStore.getState().settings,
      getSystemPrefersDark()
    )
    // Why immediate: a mode-2031 query reply must beat the remote input debounce
    // or it can miss the querying program's read window (#7329).
    sendDesktopQueryReplyImmediate(mode2031SequenceFor(mode))
    // Why: register the subscription exactly like the xterm CSI handler
    // would — without the registry entry, later theme flips never push the
    // CSI 997 update and the TUI keeps a stale theme after reveal.
    deps.recordPaneMode2031Subscription?.(pane.id, mode)
    recordHiddenMode2031Reply()
  }
  // Why (gate mode only): the counterpart to the subscribe fact. These panes never
  // receive the withdrawal bytes — main drops them before delivery — and both the
  // chunk scanner and the xterm CSI handler are disabled for them, so this fact is
  // the ONLY observer that can retire the subscription. Without it a TUI that exits
  // while hidden leaves paneMode2031 set, and the next theme flip pushes CSI 997
  // into the shell that replaced it (#9993 via maybePushMode2031Flip). No reply is
  // sent: a withdrawal is not a query.
  const handleHiddenMode2031UnsubscribeFact = (): void => {
    const ptyId = transport.getPtyId()
    if (
      disposed ||
      (!isHiddenDeliveryGateManagedPty(ptyId) && !remoteOutputPauseController.isPaused(ptyId))
    ) {
      return
    }
    deps.paneMode2031Ref.current.delete(pane.id)
    deps.paneLastThemeModeRef.current.delete(pane.id)
  }
  deps.paneTransportsRef.current.set(pane.id, transport)
  const terminalCapabilityRepliesDisposable = installTerminalCapabilityReplyHandlers({
    terminal: pane.terminal,
    parser: pane.terminal.parser,
    // Why: OSC 10/11 + DA1 replies must beat the querying program's raw-mode
    // read window; the remote transport's input debounce would corrupt them
    // (#7329), so send immediately.
    sendInput: sendDesktopQueryReplyImmediate,
    isReplaying: () => isPaneReplaying(deps.replayingPanesRef, pane.id),
    ...(isNativeWindowsConpty ? { da1Response: CONPTY_DA1_RESPONSE } : {})
  })
  const respondToTerminalPixelSizeQueries = createTerminalPixelSizeQueryResponder(
    pane.terminal,
    sendDesktopQueryReplyImmediate
  )

  // Why: an unbound transport (detached during a remount/move and never
  // rebound) silently rejects every keystroke while the PTY stays alive and
  // the last frame stays painted — the pane looks healthy and eats input
  // (issue #8104 class). None of the dead-session reconciles cover it because
  // the PTY is live; recover by remounting the tab over the live PTY.
  const transportSettleController = createPtyConnectionTransportSettleController({ now: Date.now })
  // Why a grace window instead of a plain flag: a connect that never settles
  // (SSH RPC timeout class, wedged daemon call) would otherwise suppress
  // input-triggered recovery FOREVER — and such a pane has no output flowing,
  // so no other detector can fire. Past the grace, undeliverable input may
  // recover again; the transport's destroyed-check no longer kills a
  // pre-existing session when a late reattach resolves, so a remount racing
  // a slow-but-alive connect costs a wasted view rebuild, not a shell.
  const requestRecoveryForUndeliverableInput = (providerRejected = false): void => {
    if (!providerRejected && transport.isConnected?.() && transport.getPtyId() !== null) {
      return
    }
    // Why: input rejected while a connect/reattach is still settling is "not
    // deliverable YET", not a dead binding. Remounting here destroys the
    // unbound transport, and pty-transport's destroyed check then kills the
    // PTY the in-flight reattach resolves to — the live shell recovery exists
    // to preserve. The fossil case this detector targets has no pending
    // connect, so it still recovers. Same for a late async reject landing
    // after dispose: the successor pane owns the tab now.
    const connectStillSettling = transportSettleController.isSettling()
    if (connectStillSettling || disposed) {
      return
    }
    const storePtyId = useAppStore.getState().ptyIdsByTabId?.[deps.tabId]?.[0] ?? null
    const undeliverablePtyId = transport.getPtyId() ?? storePtyId
    void requestTerminalPaneRecovery({
      tabId: deps.tabId,
      ptyId: undeliverablePtyId,
      reason: 'input-undeliverable',
      terminalRecoveryGeneration,
      terminalRecoveryInstanceId: terminalRecoveryInstance.id,
      // Why: pty:hasPty answers null for ids the local registry doesn't own,
      // and a disconnected remote pane would otherwise remount-churn on every
      // cooldown window while typing. Local panes keep the lenient gate.
      requireAuthoritativeLiveness:
        Boolean(transport.getConnectionId?.()) || isRemoteRuntimePtyId(undeliverablePtyId),
      // Why only the rejected path: it is the only one whose remount can land on
      // a fresh shell. A stalled-pipeline remount always reattaches to the same
      // shell, so its half-typed line is still on screen and intact.
      endpointReplaced: providerRejected
    })
  }
  // Why: the write-pipeline health watch (scheduler stall probe, replay-guard
  // wedge certification) detects a dead xterm pipeline; route its verdict to
  // the same tab remount. Registered per xterm instance — recovery replaces
  // the instance, which resets certification naturally.
  const unregisterUndeliverableWriteHandler = registerUndeliverableWriteHandler(
    pane.terminal,
    (reason) => {
      // Certification can arrive while this terminal still owns queued or
      // detached scheduler work; release its delivery credits immediately.
      discardTerminalOutput(pane.terminal)
      const storePtyId = useAppStore.getState().ptyIdsByTabId?.[deps.tabId]?.[0] ?? null
      void requestTerminalPaneRecovery({
        tabId: deps.tabId,
        ptyId: transport.getPtyId() ?? storePtyId,
        reason,
        terminalRecoveryGeneration,
        terminalRecoveryInstanceId: terminalRecoveryInstance.id
      })
    }
  )

  const onDataDisposable = pane.terminal.onData((data) => {
    // Why: xterm auto-replies to embedded query sequences (DA1, DECRQM,
    // OSC 10/11, focus, CPR) via onData. When we replay recorded PTY bytes
    // into xterm for scrollback/cold-restore/snapshot, those queries would
    // otherwise pipe replies into the freshly spawned shell as stray input
    // ("?1;2c", "2026;2$y", OSC color fragments, ...). The replay sites
    // engage the guard via replayIntoTerminal; here we drop everything
    // xterm emits while the guard is active. See replay-guard.ts.
    if (isPaneReplaying(deps.replayingPanesRef, pane.id)) {
      return
    }
    const currentPtyId = transport.getPtyId()
    // Why: after a Codex account switch, the runtime auth has already moved to
    // the newly selected account. Stale panes must not keep sending input until
    // they restart, or work can execute under the wrong account while the UI
    // still says the pane is stale. Fall back to the tab's persisted PTY ID so
    // the block still holds during reconnect races before the live transport has
    // updated its local PTY binding.
    if (
      isCodexPaneStale({
        tabId: deps.tabId,
        worktreeId: deps.worktreeId,
        panePtyId: currentPtyId
      })
    ) {
      clearPendingTerminalInputIntent()
      return
    }
    // Why: presence-lock input drop. While mobile is the driver for this
    // PTY, desktop keystrokes must not reach the shell; the visible overlay's
    // explicit Take back action owns restoring desktop input and dimensions.
    if (currentPtyId && isPtyLocked(currentPtyId)) {
      clearPendingTerminalInputIntent()
      return
    }
    if (
      isNativeWindowsConpty &&
      agentIdleTerminalModeController.shouldSuppressCodexFocusReport() &&
      (data === TERMINAL_FOCUS_IN_SEQUENCE || data === TERMINAL_FOCUS_OUT_SEQUENCE)
    ) {
      // Why: Codex can leave focus reporting armed after a Windows turn, but
      // disabling the mode would permanently silence focus events on resume.
      return
    }
    // Why: xterm answers CPR/DSR/DA queries natively through this same onData
    // stream (mixed with keystrokes). Those replies are latency-critical — a
    // querying program reads them in raw mode with a short timeout — so send
    // them immediately, skipping the remote input debounce that would corrupt
    // them (#7329). They are not user input, so they bypass intent inference and
    // activity recording below. No pending-intent guard: the only intents are
    // plain-escape (`\x1b`) and ctrl-c (`\x03`), neither of which can satisfy
    // isTerminalQueryReply (it requires length >= 3 and a full reply grammar),
    // so a real keystroke never reaches this branch.
    if (isTerminalQueryReply(data)) {
      sendDesktopQueryReplyImmediate(data)
      return
    }
    // Why after the query-reply branch: device replies are not user input and
    // must always reach the shell, or a program querying during reattach hangs.
    // Why at all: a replaced endpoint reattaches to a fresh shell, so the tail
    // of the interrupted line would be submitted by the user's own Enter and a
    // compound command could run its surviving half (#10065 follow-up).
    if (shouldDropQuarantinedTerminalInput(deps.tabId, data)) {
      clearPendingTerminalInputIntent()
      return
    }
    const intent = getPendingTerminalInputIntent()
    // Why: real xterm can deliver the terminal byte even when our DOM keydown
    // listener missed the press. Exact Ctrl+C/Escape bytes are still safe to
    // infer for local/remote acknowledged writes; SSH fire-and-forget remains
    // excluded because those transports do not expose sendInputAccepted.
    const acknowledgedIntent = intent ?? inferIntentFromExactTerminalInput(data)
    if (acknowledgedIntent && transport.sendInputAccepted) {
      remoteViewportClaimController.claimForUserActivity()
      if (acknowledgedIntent === 'ctrl-c') {
        // Why: the accepted-write callback is async; let the next command be
        // inferred if the user cancelled an oversized line and immediately typed.
        cancelSuspendedShellCommandInference()
      }
      clearPendingTerminalInputIntent()
      const writePromise = transport
        .sendInputAccepted(data)
        .then((accepted) => {
          if (accepted) {
            // Why: rejected writes use transport recovery and must not arm a parser probe.
            markAcceptedTerminalInputSent()
            observeAcceptedShellCommandInput(data)
            observeAcceptedTerminalInput(data, acknowledgedIntent)
            interruptInference.observeInputIntent(acknowledgedIntent)
            titleOnlyInterruptController.observe()
          } else {
            // Why: Esc/Ctrl+C are the first keys users press on a frozen pane;
            // an unbound-transport reject here must arm recovery too.
            requestRecoveryForUndeliverableInput()
          }
        })
        .catch((err) => {
          console.warn('[agent-interrupt] acknowledged terminal input failed:', err)
        })
      setPendingTerminalInputWrite(writePromise)
      return
    }
    if (intent) {
      remoteViewportClaimController.claimForUserActivity()
      if (transport.sendInput(data)) {
        markAcceptedTerminalInputSent()
        observeAcceptedShellCommandInput(data)
        observeAcceptedTerminalInput(data, intent)
      } else {
        requestRecoveryForUndeliverableInput()
      }
      clearPendingTerminalInputIntent()
      return
    }
    remoteViewportClaimController.claimForUserActivity()
    if (transport.sendInput(data)) {
      markAcceptedTerminalInputSent()
      observeAcceptedShellCommandInput(data)
      observeAcceptedTerminalInput(data)
      observeSentTerminalInputIntent(data)
    } else {
      clearPendingTerminalInputIntent()
      requestRecoveryForUndeliverableInput()
    }
  })
  const imeCompositionRouteDisposable = installTerminalImeCompositionRoute({
    terminalElement: pane.terminal.element,
    terminal: pane.terminal,
    capturedTransport: transport,
    getCurrentTransport: () => deps.paneTransportsRef.current.get(pane.id)
  })

  const resizeSuppressionController = createPtyConnectionResizeSuppressionController()
  const resizeForwardingController = createPtyConnectionResizeForwardingController({
    pane,
    deps,
    transport,
    shouldSkipTerminalResize: resizeSuppressionController.shouldSkip
  })
  const {
    forward: forwardPtyResize,
    shouldSuppressDesktopResize: shouldSuppressDesktopPtyResize,
    isAuthoritative: isRendererPtyResizeAuthoritative
  } = resizeForwardingController
  const pulseVisibleLocalPtySizeForTuiRepaint = (ptyId: string): void => {
    if (
      !isRendererPtyResizeAuthoritative() ||
      shouldSuppressDesktopPtyResize() ||
      isRemoteRuntimePtyId(ptyId)
    ) {
      return
    }
    const cols = pane.terminal.cols
    const rows = pane.terminal.rows
    if (cols <= 2 || rows <= 0) {
      return
    }
    // Why: a hidden alt-screen TUI can miss the same-size restore SIGWINCH; a one-column pulse makes the repaint observable to the child.
    transport.resize(cols - 1, rows)
    transport.resize(cols, rows)
  }
  const alternateScreenRepaintController = createPtyConnectionAlternateScreenRepaintController({
    repaint: pulseVisibleLocalPtySizeForTuiRepaint
  })

  // Why: a rewrite chunk can enter AND exit the alternate screen in one parse
  // (fast-quitting TUI), netting buffer.active.type back to 'normal'; counting
  // switches keeps those redraws visible to the atlas-recovery check.
  const bufferSwitchController = createPtyConnectionBufferSwitchController({
    subscribe: (listener) => pane.terminal.buffer.onBufferChange?.(listener)
  })

  const paneGeometryController = createPtyConnectionPaneGeometryController({
    pane,
    deps,
    transport,
    isDisposed: () => disposed,
    shouldSuppressDesktopResize: shouldSuppressDesktopPtyResize,
    requestPtySizeReassertion: () => sizeReassertionController.request(),
    resizeTerminalForViewportClaim: (cols, rows) =>
      resizeSuppressionController.runViewportClaim(() => {
        pane.terminal.resize(cols, rows)
      })
  })
  const sizeReassertionController = createPtyConnectionSizeReassertionController({
    pane,
    deps,
    transport,
    isDisposed: () => disposed,
    shouldSuppressDesktopResize: shouldSuppressDesktopPtyResize,
    forwardResize: forwardPtyResize,
    readProposedGrid: paneGeometryController.readProposedGrid
  })
  const scheduleForegroundPtyGridCheck = sizeReassertionController.scheduleForegroundGridDriftCheck

  const spawnSizeReconcileController = createPtyConnectionSpawnSizeReconcileController({
    pane,
    transport,
    isDisposed: () => disposed,
    isRendererResizeAuthoritative: isRendererPtyResizeAuthoritative,
    shouldSuppressDesktopResize: shouldSuppressDesktopPtyResize
  })
  const reconcileSpawnedPtySize = spawnSizeReconcileController.reconcileAfterSpawn

  const performDeferredConnect = (): void => {
    const preflight = preparePtyConnectionConnectPreflight({
      isDisposed: () => disposed,
      fitPane: () => {
        safeFit(pane)
      },
      readGrid: () => ({ cols: pane.terminal.cols, rows: pane.terminal.rows }),
      isVisible: () => deps.isVisibleRef.current,
      reportPtyError: (message) => deps.onPtyErrorRef?.current?.(pane.id, message)
    })
    if (!preflight) {
      return
    }
    const { cols, rows, reportError } = preflight

    const rendererSequenceController = createPtyConnectionRendererSequenceController({
      getPtyId: () => transport.getPtyId(),
      sliceDataAfterSequence: (data, meta, sequence) =>
        getHiddenRestorePendingLiveChunkDataAfterSnapshot(
          { data, seq: meta?.seq, rawLength: meta?.rawLength },
          sequence
        )
    })
    const reattachReplayController = createPtyConnectionReattachReplayController({
      getPtyId: () => transport.getPtyId(),
      getStreamGeneration: streamGenerationController.getCurrent,
      isDisposed: () => disposed,
      writeReplayDataAsync: (data) => writeReplayDataAsync(data),
      rememberPayloadAgentSignal: rememberReattachPayloadAgentSignal,
      scanReplayKeyboardModes: (data) => kittyKeyboardModes.scanReplay(data),
      buildReplayResetSequence: (data) => reattachReplayResetSequence(data),
      sendFocusedReattachFocusInAfterReplay: (ptyId, streamGeneration) =>
        sendFocusedReattachFocusInAfterReplay(ptyId, streamGeneration),
      rebuildPaneWebgl: () => manager.rebuildPaneWebgl(pane.id),
      beginLiveDataDeferral: (streamGeneration) => beginReattachLiveDataDeferral(streamGeneration),
      finishLiveDataDeferral: (deliver, streamGeneration) =>
        finishReattachLiveDataDeferral(deliver, streamGeneration),
      runStructuralReplay: (operation, shouldRestore) =>
        structuralReplayCoordinator.run(operation, { shouldRestore })
    })

    const {
      registerPaneSerializerFor,
      settlePaneSerializerAfterReplay,
      reportRemoteRendererSerializerReady
    } = createPtyConnectionSerializerController({
      pane,
      cacheKey,
      transport,
      onDataDisposable,
      isDisposed: () => disposed,
      clearHiddenOutputRestoreState: () => clearHiddenOutputRestoreState(),
      getRendererOrderedFrame: rendererSequenceController.getOrderedFrame,
      whenReplayIdle: reattachReplayController.whenIdle
    })

    const {
      armStartupDraftReadinessObservation,
      observeStartupDraftPasteReadiness,
      dispose: disposeStartupDraftController
    } = createPtyConnectionStartupDraftController({
      pane,
      deps,
      transport,
      connectionId,
      shouldDeliverStartupViaTerminalPaste,
      startupDraftAgentConfig,
      startupDraftPrompt,
      startupDraftDelivery,
      claimStartupDraftPasteDelivery,
      isDisposed: () => disposed,
      recordTerminalInputForHibernation
    })

    const getColdRestoreAgentResumePlatform = (): NodeJS.Platform => {
      if (projectRuntime?.status === 'repair-required') {
        return projectRuntime.repair.preferredRuntime.kind === 'wsl' ? 'linux' : CLIENT_PLATFORM
      }
      if (projectRuntime?.status === 'resolved' && projectRuntime.runtime.kind === 'wsl') {
        return 'linux'
      }
      if (connectionId || (worktree?.path && isWslUncPath(worktree.path))) {
        return 'linux'
      }
      return CLIENT_PLATFORM
    }

    const {
      sshShellReadyMarkerScan,
      markSshStartupShellReady,
      schedulePendingStartupCommandDelivery,
      hasPendingStartupCommand,
      setPendingStartupCommand,
      dispose: disposeStartupCommandDelivery
    } = createPtyConnectionStartupCommandDelivery({
      pane,
      deps,
      paneStartup,
      connectionId,
      transport,
      shouldDeliverStartupViaTerminalPaste,
      isNativeWindowsConpty,
      isDisposed: () => disposed,
      armStartupDraftReadinessObservation,
      releaseUnattemptedStartupDraftPasteDelivery
    })

    const {
      showSessionRestoredBanner,
      buildColdRestoreAgentResumeStartup,
      applyColdRestoreAgentResumeStartup,
      clearSleepingRecordAfterColdRestoreSpawn,
      mergeStartupEnvWithPaneIdentity,
      startFreshColdRestoreAgentResume
    } = createPtyConnectionColdRestoreStartup({
      pane,
      deps,
      cacheKey,
      paneIdentityEnv,
      getColdRestoreAgentResumePlatform,
      hasPendingStartupCommand,
      getSleepingRecordForPane,
      isLegacyWorkerAutomaticResumeBlocked,
      clearSleepingRecordProviderDuplicates,
      startFreshSpawn: (startupOverride, options) => startFreshSpawn(startupOverride, options)
    })
    startupDeliveryCleanupController.bind({
      disposeDraft: disposeStartupDraftController,
      disposeCommandDelivery: disposeStartupCommandDelivery
    })
    hibernatedWakeController.setWake(() => startFreshColdRestoreAgentResume())

    const createFreshSpawnController = () =>
      createPtyConnectionFreshSpawnController({
        transport,
        cacheKey,
        runtimeEnvironmentId,
        cols,
        rows,
        captureTransportOutputCallbacks,
        getTransportStreamGeneration: streamGenerationController.getCurrent,
        setConnectInFlightSince: transportSettleController.setInFlightSince,
        mergeStartupEnvWithPaneIdentity,
        shouldDeclareHiddenAtSpawn,
        claimCapturedDirectSshRetryPty,
        declarePendingPaneSerializer: (paneKey) =>
          getClientRuntime().terminal.declarePendingPaneSerializer(paneKey),
        clearPendingPaneSerializer: (paneKey, generation) =>
          getClientRuntime().terminal.clearPendingPaneSerializer(paneKey, generation),
        settlePaneSerializer: (paneKey, generation) =>
          getClientRuntime().terminal.settlePaneSerializer(paneKey, generation),
        registerEffectiveLaunchConfig,
        hasPaneStartupLaunchConfig: () => Boolean(paneStartup?.launchConfig),
        clearRegisteredStartupLaunchConfig,
        writeStartupCwdFallbackNotice: () => {
          writeTerminalOutput(pane.terminal, STARTUP_CWD_FALLBACK_NOTICE, {
            foreground: shouldWritePtyOutputForeground(deps.isVisibleRef.current)
          })
        },
        showSessionRestoredBanner,
        clearSleepingRecordAfterColdRestoreSpawn,
        getActivePanePtyBinding: panePtyBindingController.getPtyId,
        bindActivePanePty: (ptyId) => {
          // Why: daemon createOrAttach can make a fresh request adopt an existing PTY without emitting onPtySpawn.
          bindActivePanePty(ptyId, {
            updateTabPtyId: 'if-missing',
            sampleVisibleForegroundAgent: true
          })
        },
        reconcileSpawnedPtySize,
        isRemoteRuntimePtyId,
        hasPtySerializer,
        registerPaneSerializerFor,
        hasConnection: () => Boolean(connectionId),
        schedulePendingStartupCommandDelivery,
        reportError
      })

    const startFreshSpawn = (
      startupOverride?: PendingStartupCommand | null,
      options: FreshSpawnOptions = {}
    ): Promise<string | null> => {
      const preflightAccepted = runPtyConnectionFreshSpawnPreflight({
        legacyWorkerAutomaticResumeBlocked: isLegacyWorkerAutomaticResumeBlocked(),
        worktreeDeleting: Boolean(
          useAppStore.getState().deleteStateByWorktreeId?.[deps.worktreeId]?.isDeleting
        ),
        hasSshConnection: Boolean(connectionId),
        startupCommand: startupOverride?.command ?? null,
        clearPaneMode2031State,
        clearHiddenOutputRestoreState,
        resetFreshSpawnFollowOutput: freshSpawnFollowController.reset,
        resetKittyKeyboardModes: () => kittyKeyboardModes.reset(),
        prepareFreshShellViewportForSpawn: () => prepareFreshShellViewportForSpawn(options),
        setPendingStartupCommand
      })
      if (!preflightAccepted) {
        return Promise.resolve(null)
      }
      const processedSpawnPromise = createFreshSpawnController().spawn(startupOverride)
      return trackPtyConnectionSpawn({
        pendingSpawnKey,
        spawnPromise: processedSpawnPromise,
        directSshRetryAttempt,
        armDirectSshPaneRetryTimeout,
        isDisposed: () => disposed,
        getPtyId: () => transport.getPtyId(),
        settleDirectSshPaneRetryAttempt
      })
    }

    const renderRiskController = createPtyConnectionRenderRiskController({
      getPtyId: () => transport.getPtyId(),
      prefersRenderRefresh: terminalOutputPrefersRenderRefresh,
      rewriteDecision: terminalRewriteOutputRenderRefreshDecision,
      containsCursorPositionSequence
    })
    const foregroundRenderController = createPtyConnectionForegroundRenderController({
      now: () => performance.now(),
      getLastTerminalInputAt: terminalActivityController.getLastInputAt,
      foregroundRiskPrefersRefresh: renderRiskController.foregroundOutputPrefersRenderRefresh,
      rewriteDecision: terminalRewriteOutputRenderRefreshDecision,
      rewriteOutputPrefersRefresh: terminalRewriteOutputPrefersRenderRefresh,
      windowsEastAsianPrefersRefresh: windowsEastAsianOutputPrefersRenderRefresh,
      isWindowsClient: shouldApplyWindowsRendererUnicodeRefresh,
      isNativeWindowsConpty: shouldApplyNativeWindowsRewriteRefresh,
      getBufferType: () => pane.terminal.buffer.active.type,
      getBufferSwitches: bufferSwitchController.getCount,
      scheduleAtlasRecovery: scheduleTerminalWebglAtlasRecovery
    })
    const foregroundLatencyController = createPtyConnectionForegroundLatencyController({
      paneId: pane.id,
      now: () => performance.now(),
      getLastTerminalInputAt: terminalActivityController.getLastInputAt,
      isPaneMarkedActive: () => deps.isActiveRef.current,
      getActivePaneId: () => manager.getActivePane?.()?.id ?? null,
      consumeInactiveBudget: consumeInactiveForegroundImmediateBudget
    })
    const synchronizedForegroundController = createPtyConnectionSynchronizedForegroundController({
      protectedOutput: shouldProtectNativeWindowsSynchronizedOutput,
      now: () => performance.now(),
      getLastTerminalInputAt: terminalActivityController.getLastInputAt
    })

    // The replay path uses the guard so xterm auto-replies to embedded query
    // sequences don't leak into the shell. xterm.write() buffers internally
    // regardless of DOM visibility and the guard stays engaged via the
    // write-completion callback until xterm finishes parsing.
    const writeReplayData = (data: string): void => {
      // Why: drain any queued background bytes BEFORE the replay paint, so the
      // scheduler's deferred drain cannot land older bytes on top of the replay.
      flushTerminalOutput(pane.terminal)
      replayIntoTerminal(pane, deps.replayingPanesRef, data, {
        breadcrumbIdentity: {
          tabId: deps.tabId,
          worktreeId: deps.worktreeId,
          ptyId: transport.getPtyId()
        },
        shouldRefreshViewportSynchronously: shouldRefreshForegroundSynchronously,
        shouldReleaseRenderPause: () => deps.isVisibleRef.current
      })
    }

    const writeReplayDataAsync = (data: string): Promise<void> => {
      // Why: WebGL must be rebuilt after xterm has parsed replay bytes, not
      // merely after the write was queued.
      flushTerminalOutput(pane.terminal)
      return replayIntoTerminalAsync(pane, deps.replayingPanesRef, data, {
        breadcrumbIdentity: {
          tabId: deps.tabId,
          worktreeId: deps.worktreeId,
          ptyId: transport.getPtyId()
        },
        shouldRefreshViewportSynchronously: shouldRefreshForegroundSynchronously,
        shouldReleaseRenderPause: () => deps.isVisibleRef.current
      })
    }

    const reattachReplayResetSequence = (payload: string): string => {
      return shouldPreserveAgentReattachModes()
        ? buildPostReplayLiveAgentReattachReset(payload)
        : POST_REPLAY_REATTACH_RESET
    }

    const prepareFreshShellViewportForSpawn = (options: FreshSpawnOptions): void => {
      preparePtyConnectionFreshShellViewport({
        paneId: pane.id,
        rows: pane.terminal.rows,
        forceBlankRestoredViewport: Boolean(options.forceBlankRestoredViewport),
        restoredViewportBlankingPanes: deps.restoredViewportBlankingPanesRef?.current,
        writeReplayData
      })
    }

    const sendFocusedReattachFocusInAfterReplay = (
      expectedPtyId: string | null = transport.getPtyId(),
      expectedStreamGeneration = streamGenerationController.getCurrent()
    ): void => {
      const scheduledGeneration = getReplayPayloadSignalGeneration()
      void waitForTerminalOutputParsed(pane.terminal).then(() => {
        const currentPtyId = transport.getPtyId()
        if (
          disposed ||
          !streamGenerationController.isCurrent(expectedStreamGeneration) ||
          currentPtyId !== expectedPtyId
        ) {
          return
        }
        // Why: a newer replay frame owns the judgment; its own post-parse
        // callback will re-evaluate against its own viewport.
        if (scheduledGeneration !== getReplayPayloadSignalGeneration()) {
          return
        }
        // Why: the replay-byte signal also matches a dead run's screen — in
        // scrollback or still painted above a fresh shell prompt. The parsed
        // viewport is the ground truth; unless it shows a parked-cursor
        // cursor-agent screen and no status/title corroborates, downgrade to
        // the plain-shell behavior (drop focus reporting, skip focus-in).
        if (!hasLiveAgentReattachStatusOrTitleSignal() && hasReplayPayloadCursorAgentSignal()) {
          if (parsedViewportShowsParkedCursorAgentScreen(pane.terminal) === false) {
            resetReplayPayloadCursorAgentSignal()
            // Why: the live-agent reset preserved the payload's ?25l; a plain
            // shell never re-shows the cursor itself.
            writeReplayData(`${CURSOR_SHOW_SEQUENCE}${FOCUS_REPORTING_DISABLE_SEQUENCE}`)
            return
          }
        }
        // Why: a live TUI such as cursor-agent parks the real terminal cursor off
        // its own input caret and moves it back only on a focus-in. Reattach
        // reuses the same live PTY and the xterm textarea already holds DOM
        // focus, so xterm never emits the focus-in the agent needs and the parked
        // cursor anchors the IME/caret to the wrong cell. Gated on ?1004h so a
        // bare shell never receives a stray \x1b[I.
        const sendFocusMode = terminalHasFocusReportingEnabled(pane.terminal)
        if (!shouldSendFocusedAgentReattachFocusIn() || !sendFocusMode) {
          return
        }
        transport.sendInput(TERMINAL_FOCUS_IN_SEQUENCE)
      })
    }

    const replayDataCallback = reattachReplayController.enqueue

    const captureTransportOutputCallbacks = (onError: (message: string) => void) => {
      // Why: a new stream generation cannot inherit an old replay's pending
      // destination-grid fit or keep its live-data waiter open.
      pendingFitController.cancelAll()
      const generation = streamGenerationController.advance()
      const isCurrent = (): boolean => !disposed && streamGenerationController.isCurrent(generation)
      return {
        generation,
        callbacks: {
          onConnect: (): void => {
            if (isCurrent()) {
              reportRemoteRendererSerializerReady()
            }
          },
          onData: (data: string, meta?: PtyDataMeta): void => {
            if (isCurrent()) {
              dataCallback(data, meta, generation)
            }
          },
          onReplayData: (
            data: string,
            meta?: { clearBeforeReplay?: boolean; pendingEscapeTailAnsi?: string }
          ): void => {
            if (isCurrent()) {
              replayDataCallback(data, meta, generation)
            }
          },
          onError: (message: string): void => {
            if (isCurrent()) {
              onError(message)
            }
          },
          onWriteUnavailable: (): void => {
            if (isCurrent()) {
              requestRecoveryForUndeliverableInput(true)
            }
          },
          onRecoveryStateChange: (state: PtyTransportRecoveryState): void => {
            if (isCurrent()) {
              // Why: cached pixels remain visible while detached; expose transport truth for diagnostics and recovery UI.
              pane.container.dataset.ptyRecoveryState = state.phase
              deps.onPtyRecoveryStateRef?.current?.(pane.id, state)
            }
          },
          onOutputPauseChanged: (paused: boolean, supported: boolean): void => {
            if (isCurrent()) {
              handleRemoteOutputPauseChanged(paused, supported)
            }
          }
        }
      }
    }

    const restoredSnapshotReconciliationController =
      createPtyConnectionRestoredSnapshotReconciliationController()
    const mode2031ReplyScanController = createPtyConnectionMode2031ReplyScanController()
    const certifiedDeadRestoreRecoveryController =
      createPtyConnectionCertifiedDeadRestoreRecoveryController()
    const hiddenRestoreFreshnessController = createPtyConnectionHiddenRestoreFreshnessController()
    const hiddenRestoreReplayBaselineController =
      createPtyConnectionHiddenRestoreReplayBaselineController()
    const hiddenRestorePendingLiveController =
      createPtyConnectionHiddenRestorePendingLiveController()
    const hiddenRestoreIdentityController = createPtyConnectionHiddenRestoreIdentityController()
    const hiddenRestoreTaskController = createPtyConnectionHiddenRestoreTaskController()
    const hiddenRestoreScrollTicketController =
      createPtyConnectionHiddenRestoreScrollTicketController()
    const hiddenRestoreFloodBackpressureController =
      createPtyConnectionHiddenRestoreFloodBackpressureController({
        getCurrentPtyId: () => transport.getPtyId(),
        isDisposed: () => disposed,
        requestRepaint: markHiddenOutputRestoreNeeded
      })
    const hiddenRestoreForegroundDeadlineController =
      createPtyConnectionHiddenRestoreForegroundDeadlineController({
        isDisposed: () => disposed,
        isForeground: () => shouldWritePtyOutputForeground(deps.isVisibleRef.current),
        hasPending: hiddenRestorePendingLiveController.hasPending,
        getRestorePtyId: hiddenRestoreIdentityController.getPtyId,
        getCurrentPtyId: () => transport.getPtyId(),
        getRestoreGeneration: hiddenRestoreIdentityController.getGeneration,
        onDeadline: abandonHiddenOutputRestoreAndDrainPendingForeground
      })
    const hiddenRestoreDeferredRetryController =
      createPtyConnectionHiddenRestoreDeferredRetryController({
        isDisposed: () => disposed,
        isForeground: () => shouldWritePtyOutputForeground(deps.isVisibleRef.current),
        isRestoreNeeded: hiddenRestoreIdentityController.isNeeded,
        onRetry: () => {
          requestHiddenOutputRestoreIfNeeded()
        },
        onExhausted: () => {
          const ptyId = hiddenRestoreIdentityController.getPtyId()
          if (ptyId !== null) {
            abandonHiddenOutputRestoreAndDrainPendingForeground(ptyId)
            return
          }
          clearHiddenOutputRestoreState()
          writeRestoreUnavailableWarning()
        }
      })
    const hiddenRestoreScheduleController = createPtyConnectionHiddenRestoreScheduleController(
      pane.terminal
    )
    const shouldSnapshotHiddenCodexOutput = shouldKeepHiddenStartupRendererQueriesLive(paneStartup)
    const hiddenRendererQueryController = createPtyConnectionHiddenRendererQueryController({
      sendImmediateReply: sendDesktopQueryReplyImmediate,
      replyOscColorQueries: (data) => {
        sendTerminalOscColorQueryReplies(data, pane.terminal, sendDesktopQueryReplyImmediate)
      },
      writeRendererQuery: (data, foreground) => {
        writePtyOutputToXterm(data, foreground, { hiddenStartupRendererQuery: true })
      },
      getCursor: () => ({
        cursorX: pane.terminal.buffer.active.cursorX,
        cursorY: pane.terminal.buffer.active.cursorY,
        cols: pane.terminal.cols,
        rows: pane.terminal.rows
      })
    })

    function canUseMainBufferSnapshot(ptyId: string | null): ptyId is string {
      return Boolean(ptyId) && !isRemoteRuntimePtyId(ptyId)
    }

    function canUseHiddenOutputSnapshot(ptyId: string | null): ptyId is string {
      if (!ptyId) {
        return false
      }
      if (canUseMainBufferSnapshot(ptyId)) {
        return true
      }
      return transport.getPtyId() === ptyId && typeof transport.serializeBuffer === 'function'
    }

    async function serializeHiddenOutputSnapshot(
      ptyId: string,
      opts: { scrollbackRows?: number }
    ): Promise<PtyBufferSnapshot | null> {
      const e2eSnapshot = readE2eHiddenSnapshotOverride(ptyId)
      if (e2eSnapshot) {
        return e2eSnapshot
      }
      if (canUseMainBufferSnapshot(ptyId)) {
        return getClientRuntime().terminal.getMainBufferSnapshot(ptyId, opts)
      }
      if (transport.getPtyId() !== ptyId || typeof transport.serializeBuffer !== 'function') {
        return null
      }
      return transport.serializeBuffer(opts)
    }

    // Why: hidden/parked panes used to mark hidden only at the first
    // dataCallback sync, leaving a spawn-time window where neither side
    // answered queries (the spawn-time DA1 loss). Declaring hidden on the
    // spawn IPC lets main mark the PTY before its first byte — including
    // codex spawns: the model responder answers their startup probes from
    // byte zero now that the 10s renderer query window is gone.
    // Remote-runtime PTYs are never gate-markable (no local main transit).
    function shouldDeclareHiddenAtSpawn(): boolean {
      return (
        hiddenDeliveryGateActive &&
        !runtimeEnvironmentId &&
        !disposed &&
        !shouldWritePtyOutputForeground(deps.isVisibleRef.current)
      )
    }

    // True when a drop/gap signal on a visible pane is attributable to this
    // pane's OWN restore backpressure (a restore is replaying right now, or
    // one was just cut off for outrunning the stream). Such signals must not
    // re-arm restores — that is the rc.7.perf feedback loop.
    function isForegroundRestoreBackpressureContext(): boolean {
      return (
        shouldWritePtyOutputForeground(deps.isVisibleRef.current) &&
        (hiddenRestoreTaskController.isInFlight() ||
          hiddenRestoreFloodBackpressureController.isSuppressed())
      )
    }

    // Why: main reports dropped renderer-bound bytes out-of-band, routed per PTY by pty-model-restore-channel.ts.
    function handleModelRestoreNeededMarker(): void {
      if (disposed) {
        return
      }
      recordTerminalFreezeBreadcrumb('restore-marker', {
        id: redactPtyIdForDiagnostics(transport.getPtyId() ?? '')
      })
      // Why: dropped bytes invalidate cross-chunk carry — a partial OSC-9999 prefix spanning the gap would corrupt the next live chunk.
      transport.resetCrossChunkParserState?.()
      // Why gated (rc.7.perf loop): on a visible pane these markers come from our own restore starving ACKs; re-arming per marker kept the fetch loop alive all flood, so defer to one post-flood repaint.
      if (isForegroundRestoreBackpressureContext()) {
        hiddenRestoreFloodBackpressureController.noteBackpressure(transport.getPtyId())
        return
      }
      // Why: a marker during an in-flight restore means that snapshot may predate the drop, so a fresh one must follow; capture BEFORE the mark, which starts a restore synchronously on a visible pane.
      const restoreWasInFlight = hiddenRestoreTaskController.isInFlight()
      markHiddenOutputRestoreNeeded()
      if (restoreWasInFlight) {
        hiddenRestoreFreshnessController.markNeeded()
      }
    }

    function beforeTerminalOutputWrite(data: string): void {
      // Why: shaping must register before xterm parses the RTL bytes that need it.
      ensureArabicShapingJoinerForText(pane.terminal, data)
      recordTerminalOutput(pane.terminal)
    }

    // Why here and not in xterm's CSI handler: xterm batches several PTY chunks into one
    // synchronous parse, so a handler cannot tell where a chunk ended. fish enables and
    // disables 2031 around every prompt, so answering a subscribe the same chunk withdraws
    // pushes `?997;1n` into the prompt or a child's stdin as literal text (#9993). One raw
    // chunk in, one order-aware decision out.
    function observeLiveMode2031Chunk(data: string): void {
      // Main's '2031-subscribe' fact is the sole responder for gate-managed PTYs; a second
      // reply from here would answer one subscribe twice.
      if (isHiddenDeliveryGateManagedPty(transport.getPtyId())) {
        return
      }
      const decision = mode2031ReplyScanController.scan(data)
      if (decision === 'unsubscribed') {
        deps.paneMode2031Ref.current.delete(pane.id)
        deps.paneLastThemeModeRef.current.delete(pane.id)
      }
      if (decision !== 'subscribed') {
        return
      }
      const settings = useAppStore.getState().settings
      const mode = resolveTerminalColorSchemeMode(settings, getSystemPrefersDark())
      // Why immediate: the reply must land inside the program's read window, and hidden
      // snapshot-backed panes skip xterm.write for PTY bytes entirely.
      deps.paneMode2031Ref.current.set(pane.id, true)
      sendDesktopQueryReplyImmediate(mode2031SequenceFor(mode))
      deps.paneLastThemeModeRef.current.set(pane.id, mode)
      recordHiddenMode2031Reply()
    }

    function writePtyOutputToXterm(
      data: string,
      foreground: boolean,
      opts?: { hiddenStartupRendererQuery?: boolean }
    ): void {
      // Why: every application byte funnels through here, so it's the one place the kitty keyboard mirror observes the pane's protocol negotiation.
      kittyKeyboardModes.scan(data)
      if (foreground) {
        resetHiddenOutputRestoreIfPtyChanged()
        renderRiskController.resetHidden()
      }
      const parseHiddenStartupOutput =
        !foreground &&
        canUseHiddenOutputSnapshot(transport.getPtyId()) &&
        shouldSnapshotHiddenCodexOutput &&
        (opts?.hiddenStartupRendererQuery === true || containsHiddenStartupRendererQuery(data))
      const synchronizedForegroundDecision = synchronizedForegroundController.observe(
        data,
        foreground
      )
      const {
        synchronizedOutput: synchronizedForegroundOutput,
        latencySensitive: synchronizedFrameLatencySensitive,
        nativeWindowsCursorRestore
      } = synchronizedForegroundDecision
      const foregroundOutput = foreground || parseHiddenStartupOutput
      if (foreground) {
        scheduleForegroundPtyGridCheck()
      }
      const renderRefreshDecision = foregroundOutput
        ? foregroundRenderController.decideRenderRefresh(data)
        : { refresh: false, inPlaceRewrite: false, recoverWebglAtlasAfterParse: false }
      const recoverHiddenWebglAtlasAfterParse =
        !foregroundOutput && renderRiskController.hiddenOutputNeedsAtlasRecoveryAfterParse(data)
      const recoverWebglAtlasAfterParse =
        renderRefreshDecision.recoverWebglAtlasAfterParse || recoverHiddenWebglAtlasAfterParse
      // Why: atlas recovery must repaint from the parsed xterm buffer, not a pre-write snapshot a late TUI redraw can stale.
      const onParsedAtlasRecovery = recoverWebglAtlasAfterParse
        ? scheduleTerminalWebglAtlasRecovery
        : renderRefreshDecision.inPlaceRewrite
          ? foregroundRenderController.alternateScreenAtlasRecoveryOnParsed()
          : undefined
      const foregroundRenderRefreshNeeded = renderRefreshDecision.refresh
      // Why: Claude Code's in-place prompt redraws on Windows ConPTY can paint one frame late; a follow-up repaint fixes the column desync without a resize.
      const nativeWindowsInPlaceRewriteFollowup = nativeWindowsRewriteNeedsFollowupRenderRefresh({
        isNativeWindowsConpty: shouldApplyNativeWindowsRewriteRefresh,
        isForeground: foreground,
        isInPlaceRewrite: renderRefreshDecision.inPlaceRewrite
      })
      writeTerminalOutput(pane.terminal, data, {
        foreground: foregroundOutput,
        beforeWrite: beforeTerminalOutputWrite,
        // Why: every scheduler write claims one child so a split delivery is credited only after all children parse or discard.
        ackCredit: takeCurrentTerminalDeliveryCredit() ?? undefined,
        onBackgroundBacklogDropped: markHiddenOutputRestoreNeeded,
        latencySensitive:
          !foreground || parseHiddenStartupOutput
            ? true
            : synchronizedFrameLatencySensitive ||
              foregroundLatencyController.isLatencySensitive(data),
        forceForegroundRefresh:
          foregroundOutput &&
          (synchronizedForegroundOutput ||
            nativeWindowsCursorRestore ||
            foregroundRenderRefreshNeeded),
        followupForegroundRefresh:
          nativeWindowsCursorRestore || nativeWindowsInPlaceRewriteFollowup,
        // Why: xterm already queued a WebGL frame parsing this chunk; merge the repair into it instead of rendering the grid twice.
        shouldRefreshForegroundSynchronously,
        onParsed: onParsedAtlasRecovery,
        stripTransientCursorShows: synchronizedForegroundDecision.stripTransientCursorShows,
        coalesceForeground: synchronizedForegroundDecision.coalesceForeground,
        holdForeground: synchronizedForegroundDecision.holdForeground
      })
    }

    agentIdleTerminalModeController.setWriter((sequence) => {
      writePtyOutputToXterm(sequence, shouldWritePtyOutputForeground(deps.isVisibleRef.current))
    })

    function markHiddenOutputRestoreNeeded(): void {
      renderRiskController.resetSkippedHidden()
      const ptyId = transport.getPtyId()
      if (!canUseHiddenOutputSnapshot(ptyId)) {
        return
      }
      if (hiddenRestoreIdentityController.hasDifferentPty(ptyId)) {
        clearHiddenOutputRestoreState()
      }
      hiddenRestoreIdentityController.markNeededFor(ptyId)
      if (shouldWritePtyOutputForeground(deps.isVisibleRef.current)) {
        requestHiddenOutputRestoreIfNeeded()
      }
    }

    function shouldSkipHiddenRendererOutput(foreground: boolean, data: string): boolean {
      const ptyId = transport.getPtyId()
      if (
        foreground ||
        (!shouldSnapshotHiddenCodexOutput && !remoteOutputPauseController.isPaused(ptyId)) ||
        !canUseHiddenOutputSnapshot(ptyId)
      ) {
        return false
      }
      // Why: CPR/DECRQM replies depend on ordered state; keep a clean stateful-query chunk live, but after skipped bytes avoid stale replies.
      return hiddenRendererQueryController.shouldSkip(data)
    }

    function skipHiddenRendererOutput(data: string): void {
      hiddenRendererQueryController.observeHidden(data)
      markHiddenOutputRestoreNeeded()
      if (hiddenRestoreTaskController.isInFlight()) {
        hiddenRestoreFreshnessController.markNeeded()
      }
      recordHiddenRendererSkip(data.length)
    }

    function queueLiveChunkDuringRestore(data: string, meta?: PtyDataMeta): void {
      if (!data) {
        return
      }
      const ptyId = transport.getPtyId()
      if (!canUseHiddenOutputSnapshot(ptyId)) {
        return
      }
      if (hiddenRestoreIdentityController.hasDifferentPty(ptyId)) {
        clearHiddenOutputRestoreState()
      }
      hiddenRestoreIdentityController.markNeededFor(ptyId)
      const pending: HiddenRestorePendingLiveChunk = { data }
      if (typeof meta?.seq === 'number') {
        pending.seq = meta.seq
      }
      if (typeof meta?.rawLength === 'number') {
        pending.rawLength = meta.rawLength
      }
      const queueResult = hiddenRestorePendingLiveController.enqueue(pending)
      if (queueResult.kind === 'discarded') {
        // Why: overflow drops content, but renderer-owned query replies still need salvage.
        for (const chunk of queueResult.chunks) {
          hiddenRendererQueryController.salvageDiscarded(chunk.data)
        }
      }
      hiddenRestoreForegroundDeadlineController.arm()
    }

    const recordRendererOrderedSeq = rendererSequenceController.recordOrdered

    rendererSequenceExitResetController.bindRuntime({
      getRestoredSnapshotBaselinePtyId: restoredSnapshotReconciliationController.getBaselinePtyId,
      clearRestoredSnapshotBaseline: restoredSnapshotReconciliationController.clear,
      resetRendererSequenceForPtyExit: rendererSequenceController.resetForPtyExit
    })

    const observeRendererOrderedSeqRegression = rendererSequenceController.observeChannel
    const getHiddenRendererDataAfterOrderedSeq =
      rendererSequenceController.getHiddenDataAfterOrdered

    const hiddenRestorePendingLiveDrainCallbacks = {
      onDiscarded: (chunk: HiddenRestorePendingLiveChunk): void => {
        hiddenRendererQueryController.salvageDiscarded(chunk.data)
      },
      onChunk: (chunk: HiddenRestorePendingLiveChunk, data: string): void => {
        // Why: advance continuity even when the snapshot fully covers this chunk.
        if (typeof chunk.seq === 'number') {
          restoredSnapshotReconciliationController.advanceExpectedSeq(chunk.seq)
        }
        if (data) {
          writePtyOutputToXterm(data, true)
          recordRendererOrderedSeq(chunk)
        }
      }
    }

    function clearPendingLiveChunksDuringRestore(): void {
      hiddenRestorePendingLiveController.clear()
      hiddenRestoreFreshnessController.reset()
      hiddenRestoreScheduleController.cancel()
      hiddenRestoreDeferredRetryController.reset()
      hiddenRestoreForegroundDeadlineController.clear()
    }

    const hiddenRestoreAbandonController = createPtyConnectionHiddenRestoreAbandonController({
      getCurrentPtyId: () => transport.getPtyId(),
      getRestorePtyId: hiddenRestoreIdentityController.getPtyId,
      resetIfPtyChanged: resetHiddenOutputRestoreIfPtyChanged,
      takeReplayBaseline: hiddenRestoreReplayBaselineController.take,
      takePendingForAbandonReplay: hiddenRestorePendingLiveController.takeForAbandonReplay,
      invalidateRestore: hiddenRestoreIdentityController.invalidate,
      handoffScrollGeneration: hiddenRestoreScrollTicketController.handoffGeneration,
      abandonTask: hiddenRestoreTaskController.abandon,
      resetFreshness: hiddenRestoreFreshnessController.reset,
      resetRendererQueries: hiddenRendererQueryController.reset,
      resetRenderRisk: renderRiskController.resetHidden,
      cancelScheduled: hiddenRestoreScheduleController.cancel,
      resetDeferredRetry: hiddenRestoreDeferredRetryController.reset,
      clearForegroundDeadline: hiddenRestoreForegroundDeadlineController.clear,
      writeUnavailableWarning: writeRestoreUnavailableWarning,
      setReconciliationBaseline: restoredSnapshotReconciliationController.setBaseline,
      advanceExpectedSeq: restoredSnapshotReconciliationController.advanceExpectedSeq,
      writePendingData: (data) => {
        writePtyOutputToXterm(data, true)
      }
    })

    function abandonHiddenOutputRestoreAndDrainPendingForeground(
      expectedPtyId: string,
      opts: { quiet?: boolean } = {}
    ): void {
      hiddenRestoreAbandonController.abandon(expectedPtyId, opts)
    }

    function clearHiddenOutputRestoreState(): void {
      cancelSnapshotScrollRestore()
      clearPendingLiveChunksDuringRestore()
      hiddenRendererQueryController.reset()
      renderRiskController.resetHidden()
      hiddenRestoreIdentityController.invalidate()
      hiddenRestoreReplayBaselineController.clear()
    }

    function cancelSnapshotScrollRestore(): void {
      pendingFitController.cancelHidden()
      const invalidated = hiddenRestoreScrollTicketController.invalidateCurrent()
      if (!invalidated) {
        return
      }
      if (invalidated.started) {
        cancelTerminalScrollIntentBufferRebuildCompletions(pane.terminal)
      }
      // Why: invalidation suppresses restoration, but queued bytes still own the bracket until their FIFO sentinels prove parsing finished.
    }
    hiddenRestoreCleanupController.bind({
      cancelSnapshotScrollRestore,
      clearDeferredRetry: hiddenRestoreDeferredRetryController.dispose,
      clearForegroundDeadline: hiddenRestoreForegroundDeadlineController.dispose,
      clearFloodRepaint: hiddenRestoreFloodBackpressureController.dispose
    })

    function clearPaneMode2031State(): void {
      deps.paneMode2031Ref.current.delete(pane.id)
      deps.paneLastThemeModeRef.current.delete(pane.id)
      // A partial CSI prefix belongs to the stream that produced it; carrying it into a
      // replacement PTY would splice two unrelated byte ranges into one sequence.
      mode2031ReplyScanController.reset()
    }

    function skipBackgroundAlternateScreenOutput(data: string): void {
      hiddenRendererQueryController.observeHidden(data)
      renderRiskController.resetSkippedHidden()
      recordHiddenRendererSkip(data.length)
      const ptyId = transport.getPtyId()
      if (!ptyId) {
        return
      }
      alternateScreenRepaintController.request(ptyId)
    }

    function resetHiddenOutputRestoreIfPtyChanged(): void {
      if (hiddenRestoreIdentityController.getPtyId() === null) {
        return
      }
      if (transport.getPtyId() !== hiddenRestoreIdentityController.getPtyId()) {
        // Why: renderer backlog is tied to the old PTY stream; after reattach it must not delay or replay before the new PTY.
        clearHiddenOutputRestoreState()
        restoredSnapshotReconciliationController.clear()
        clearPaneMode2031State()
        // Why: flood-backpressure evidence is per PTY stream too.
        hiddenRestoreFloodBackpressureController.reset()
        discardTerminalOutput(pane.terminal)
      }
    }

    function writeRestoreUnavailableWarning(): void {
      if (!shouldWritePtyOutputForeground(deps.isVisibleRef.current)) {
        return
      }
      writeTerminalOutput(pane.terminal, HIDDEN_OUTPUT_RESTORE_UNAVAILABLE_WARNING, {
        foreground: true,
        beforeWrite: beforeTerminalOutputWrite
      })
    }

    const hiddenRestoreSnapshotReplayController =
      createPtyConnectionHiddenRestoreSnapshotReplayController({
        terminal: pane.terminal,
        isDisposed: () => disposed,
        getPtyId: () => transport.getPtyId(),
        getRestoreGeneration: hiddenRestoreIdentityController.getGeneration,
        scrollTickets: hiddenRestoreScrollTicketController,
        cancelCurrentScrollRestore: cancelSnapshotScrollRestore,
        runStructuralReplay: structuralReplayCoordinator.run,
        beginReplayBaseline: hiddenRestoreReplayBaselineController.begin,
        discardOutput: () => discardTerminalOutput(pane.terminal),
        runStructuralResize: (operation) => {
          resizeSuppressionController.runStructural(operation)
        },
        writeReplayData,
        shouldUseLiveAgentReset: hasLiveAgentReattachStatusOrTitleSignal,
        markRendererQueriesClean: hiddenRendererQueryController.markClean,
        recordRendererOrderedSeq,
        resetRenderRisk: renderRiskController.resetHidden,
        recordOutput: () => recordTerminalOutput(pane.terminal),
        waitForReplayWritesParsed: () => waitForTerminalReplayWritesParsed(pane.terminal),
        hasFitOverride: (ptyId) => Boolean(getFitOverrideForPty(ptyId)),
        startFit: (_ptyId, shouldContinue, onFitted) =>
          safeFitAndThen(pane, 'hidden-snapshot-pty-resize', onFitted, {
            shouldContinue,
            retryIfUnmeasurable: true
          }),
        setPendingFit: pendingFitController.setHidden,
        clearPendingFitIf: pendingFitController.clearHiddenIf,
        isRendererPtyResizeAuthoritative,
        resizePty: (cols, rows) => {
          transport.resize(cols, rows)
        },
        shouldSignalSigwinch: (ptyId) => !isRemoteRuntimePtyId(ptyId),
        signalSigwinch: (ptyId) => {
          getClientRuntime().terminal.signal(ptyId, 'SIGWINCH')
        },
        scheduleIdleCursorReset: scheduleReattachIdleAgentCursorReset
      })

    const hiddenRestoreSnapshotLoopController =
      createPtyConnectionHiddenRestoreSnapshotLoopController({
        maxIterations: HIDDEN_OUTPUT_RESTORE_MAX_LOOP_ITERATIONS,
        isDisposed: () => disposed,
        getRestorePtyId: hiddenRestoreIdentityController.getPtyId,
        getCurrentPtyId: () => transport.getPtyId(),
        getRestoreGeneration: hiddenRestoreIdentityController.getGeneration,
        canUseSnapshot: canUseHiddenOutputSnapshot,
        clearRestoreState: clearHiddenOutputRestoreState,
        writeUnavailableWarning: writeRestoreUnavailableWarning,
        clearNeeded: hiddenRestoreIdentityController.clearNeeded,
        markNeeded: hiddenRestoreIdentityController.markNeeded,
        serializeSnapshot: (ptyId) =>
          serializeHiddenOutputSnapshot(ptyId, {
            scrollbackRows: resolveHiddenRestoreScrollbackRows(pane.terminal.options.scrollback)
          }),
        resetFreshness: hiddenRestoreFreshnessController.reset,
        scheduleDeferredRetry: hiddenRestoreDeferredRetryController.schedule,
        resetDeferredRetryAttempts: hiddenRestoreDeferredRetryController.resetAttempts,
        applySnapshot: hiddenRestoreSnapshotReplayController.apply,
        setReconciliationBaseline: restoredSnapshotReconciliationController.setBaseline,
        clearReplayBaseline: hiddenRestoreReplayBaselineController.clear,
        takeFreshSnapshotNeeded: hiddenRestoreFreshnessController.takeNeeded,
        drainPendingLive: (snapshotSeq) =>
          hiddenRestorePendingLiveController.drainAfterSnapshot(
            snapshotSeq,
            hiddenRestorePendingLiveDrainCallbacks
          ),
        isForeground: () => shouldWritePtyOutputForeground(deps.isVisibleRef.current),
        completeRestore: hiddenRestoreIdentityController.complete,
        clearForegroundDeadline: hiddenRestoreForegroundDeadlineController.clear,
        noteBackpressure: hiddenRestoreFloodBackpressureController.noteBackpressure,
        abandonAndDrain: (ptyId) => {
          abandonHiddenOutputRestoreAndDrainPendingForeground(ptyId, { quiet: true })
        },
        warnIterationCap: (ptyId, reason) => {
          warnTerminalLifecycleAnomaly('hidden output restore hit its iteration cap', {
            tabId: deps.tabId,
            worktreeId: deps.worktreeId,
            leafId: pane.leafId,
            paneId: pane.id,
            ptyId,
            reason
          })
        }
      })

    const hiddenRestoreRequestController = createPtyConnectionHiddenRestoreRequestController({
      isDisposed: () => disposed,
      isWritePipelineCertifiedDead: () => isTerminalWritePipelineCertifiedDead(pane.terminal),
      claimCertifiedDeadRecovery: certifiedDeadRestoreRecoveryController.claim,
      requestCertifiedDeadRecovery: () => {
        const storePtyId = useAppStore.getState().ptyIdsByTabId?.[deps.tabId]?.[0] ?? null
        void requestTerminalPaneRecovery({
          tabId: deps.tabId,
          ptyId: transport.getPtyId() ?? storePtyId,
          reason: 'restore-blocked',
          terminalRecoveryGeneration,
          terminalRecoveryInstanceId: terminalRecoveryInstance.id
        })
      },
      resetIfPtyChanged: resetHiddenOutputRestoreIfPtyChanged,
      getRestorePtyId: hiddenRestoreIdentityController.getPtyId,
      getCurrentPtyId: () => transport.getPtyId(),
      isRestoreNeeded: hiddenRestoreIdentityController.isNeeded,
      hasQueuedChunks: hiddenRestorePendingLiveController.hasQueuedChunks,
      canUseSnapshot: canUseHiddenOutputSnapshot,
      bindRestorePty: hiddenRestoreIdentityController.bindPty,
      isTaskInFlight: hiddenRestoreTaskController.isInFlight,
      armForegroundDeadline: hiddenRestoreForegroundDeadlineController.arm,
      isActiveSplitPane: foregroundLatencyController.isActiveSplitPane,
      getRestoreGeneration: hiddenRestoreIdentityController.getGeneration,
      scheduleInactive: hiddenRestoreScheduleController.scheduleInactive,
      cancelScheduled: hiddenRestoreScheduleController.cancel,
      isForeground: () => shouldWritePtyOutputForeground(deps.isVisibleRef.current),
      clearDeferredRetry: hiddenRestoreDeferredRetryController.clear,
      runRestoreTask: hiddenRestoreSnapshotLoopController.run,
      trackTask: hiddenRestoreTaskController.track,
      hasPendingLive: hiddenRestorePendingLiveController.hasPending,
      markRestoreNeeded: hiddenRestoreIdentityController.markNeeded,
      isDeferredRetry: hiddenRestoreDeferredRetryController.isDeferred
    })

    function requestHiddenOutputRestoreIfNeeded(opts?: { bypassScheduler?: boolean }): boolean {
      return hiddenRestoreRequestController.request(opts)
    }

    hiddenDeliveryController.bindRuntime({
      canUseSnapshot: canUseHiddenOutputSnapshot,
      onModelRestoreNeeded: handleModelRestoreNeededMarker,
      markRestoreNeeded: markHiddenOutputRestoreNeeded,
      requestRestore: () => {
        requestHiddenOutputRestoreIfNeeded()
      },
      getRestorePtyId: () => hiddenRestoreIdentityController.getPtyId()
    })

    recoverySubscriptionsController.replaceBacklog(
      registerTerminalBacklogRecovery(pane.terminal, () => {
        // Why: clear the hidden-delivery bit BEFORE the restore snapshot request; bytes arriving in between are reconciled by the seq guard.
        syncHiddenRendererPtyDelivery()
        return requestHiddenOutputRestoreIfNeeded()
      })
    )
    if (
      typeof document !== 'undefined' &&
      typeof document.addEventListener === 'function' &&
      typeof document.removeEventListener === 'function'
    ) {
      const onDocumentVisibilityChange = (): void => {
        // Why: document hide/show flips the foreground predicate with no pane lifecycle event; re-sync the hidden-delivery gate both ways.
        syncHiddenRendererPtyDelivery()
        if (shouldWritePtyOutputForeground(deps.isVisibleRef.current)) {
          requestHiddenOutputRestoreIfNeeded()
        }
      }
      document.addEventListener('visibilitychange', onDocumentVisibilityChange)
      // Why: on stale macOS occlusion (visibilityState wedged 'hidden'), user input forces a resync — no visibilitychange fires, else the gate drops bytes forever.
      const unregisterStaleVisibilityRecovery = registerStaleDocumentVisibilityRecovery(
        onDocumentVisibilityChange
      )
      recoverySubscriptionsController.replaceDocumentVisibility(() => {
        document.removeEventListener('visibilitychange', onDocumentVisibilityChange)
        unregisterStaleVisibilityRecovery()
      })
    }

    const dataCallback = (
      data: string,
      meta?: PtyDataMeta,
      streamGeneration = streamGenerationController.getCurrent()
    ): void => {
      if (!streamGenerationController.isCurrent(streamGeneration)) {
        return
      }
      if (reattachLiveDataController.defer(data, meta, streamGeneration)) {
        return
      }
      if (data.length > 0) {
        terminalActivityController.markOutput()
        recordAgentHibernationPaneOutput(cacheKey)
        // Why: output is the agent-start signal that ends the relaxed no-evidence process-scan cadence (a starting agent always prints).
        agentCompletionCoordinator.observeOutputActivity()
      }
      if (sshShellReadyMarkerScan) {
        const scanned = scanForShellReadyMarker(sshShellReadyMarkerScan, data)
        if (scanned.matched) {
          markSshStartupShellReady()
        }
        data = scanned.output
      }
      observeStartupDraftPasteReadiness(data)
      resetHiddenOutputRestoreIfPtyChanged()
      observeLiveMode2031Chunk(data)
      if (meta?.droppedOutput === true) {
        // Why gated (rc.7.perf loop): a visible pane's cap-drop during its own restore is self-caused backpressure; defer to one post-flood repaint instead of re-arming per sentinel.
        if (meta?.background !== true && isForegroundRestoreBackpressureContext()) {
          hiddenRestoreFloodBackpressureController.noteBackpressure(transport.getPtyId())
        } else {
          // Why: main dropped buffered output at the pending cap, so the stream has a gap; repaint from the main-owned snapshot instead of writing on.
          markHiddenOutputRestoreNeeded()
          if (data) {
            // The sentinel can carry query bytes carved from the bulk drop (extractDroppedPtyQueryBytes in main); replies must still flow.
            hiddenRendererQueryController.salvageDiscarded(data)
          }
          return
        }
      }
      respondToTerminalPixelSizeQueries(data)
      observeTerminalBracketedPasteModeOutput(pane.terminal, data)
      // Why: under main side-effect authority these facts arrive via pty:sideEffect; byte-scanning here would double-fire. Remote PTYs / kill-switch-off keep this path.
      if (!mainSideEffectAuthority) {
        for (const link of observeTerminalGitHubPRLink(data)) {
          useAppStore.getState().observeTerminalGitHubPullRequestLink(deps.worktreeId, link)
        }
        commandLifecycle.handlePtyData(data)
      }
      commandCodeOutputStatusDetector?.observe(data)
      // Why: split panes have visible-but-inactive panes the user watches; throttle only when the pane or whole document is hidden.
      const foreground =
        shouldWritePtyOutputForeground(deps.isVisibleRef.current) && meta?.background !== true
      // Why: latch the hidden-delivery gate from the byte path too, covering a PTY id that arrives after the initial sync (no-op when current).
      if (!foreground) {
        syncHiddenRendererPtyDelivery()
      }
      // Post-restore reconciliation: drop chunks the snapshot covers, force a fresh restore for unmappable seq gaps; runs after byte observers, before any xterm write.
      const reconciliation = restoredSnapshotReconciliationController.reconcile(
        transport.getPtyId(),
        data,
        meta
      )
      if (reconciliation.action === 'drop-duplicate') {
        return
      }
      if (reconciliation.action === 'force-fresh-restore') {
        // Why gated (rc.7.perf loop): foreground-flood seq gaps are our own backpressure drops; snapshot-per-gap IS the loop, so retire the baseline and heal post-flood.
        if (foreground && isForegroundRestoreBackpressureContext()) {
          hiddenRestoreFloodBackpressureController.noteBackpressure(transport.getPtyId())
          restoredSnapshotReconciliationController.clear()
          // fall through with the ORIGINAL data/meta — post-gap bytes are new
        } else {
          // Why: capture in-flight BEFORE the mark — on a visible pane the mark starts the restore synchronously and must not flag itself.
          const restoreWasInFlight = hiddenRestoreTaskController.isInFlight()
          markHiddenOutputRestoreNeeded()
          if (restoreWasInFlight) {
            hiddenRestoreFreshnessController.markNeeded()
          }
          return
        }
      } else {
        data = reconciliation.data
        meta = reconciliation.meta
      }
      // Why: a hidden Codex query can split just before visibility flips; hand xterm the completed query while other bytes still follow restore.
      const pendingForegroundQuery = foreground
        ? hiddenRendererQueryController.takePendingForForeground(data, meta)
        : null
      const rendererData = pendingForegroundQuery?.remainingData ?? data
      const rendererMeta = pendingForegroundQuery?.meta ?? meta
      observeRendererOrderedSeqRegression(meta)
      const orderedRendererData = foreground
        ? rendererData
        : getHiddenRendererDataAfterOrderedSeq(rendererData, rendererMeta)
      if (orderedRendererData === null) {
        // Why: renderer filtering can't map cleaned text back to raw seq offsets; rebuild from main instead of risking stale bytes.
        markHiddenOutputRestoreNeeded()
        schedulePendingStartupCommandDelivery()
        return
      }
      if (!foreground && orderedRendererData.length === 0) {
        recordRendererOrderedSeq(rendererMeta)
        schedulePendingStartupCommandDelivery()
        return
      }
      const restoreAppliesToCurrentPty =
        hiddenRestoreIdentityController.getPtyId() !== null &&
        transport.getPtyId() === hiddenRestoreIdentityController.getPtyId()
      const skipBackgroundAlternateScreenFrame =
        meta?.background === true &&
        shouldWritePtyOutputForeground(deps.isVisibleRef.current) &&
        pane.terminal.buffer.active.type === 'alternate' &&
        !containsStatefulRendererQuery(orderedRendererData)
      if (skipBackgroundAlternateScreenFrame) {
        skipBackgroundAlternateScreenOutput(orderedRendererData)
      } else if (shouldSkipHiddenRendererOutput(foreground, orderedRendererData)) {
        skipHiddenRendererOutput(orderedRendererData)
      } else if (
        (hiddenRestoreIdentityController.isNeeded() || hiddenRestoreTaskController.isInFlight()) &&
        restoreAppliesToCurrentPty
      ) {
        if (foreground) {
          if (pendingForegroundQuery?.statefulQueryData) {
            queueLiveChunkDuringRestore(pendingForegroundQuery.statefulQueryData)
          }
          queueLiveChunkDuringRestore(orderedRendererData, rendererMeta)
          requestHiddenOutputRestoreIfNeeded()
        } else if (hiddenRestoreTaskController.isInFlight()) {
          renderRiskController.resetSkippedHidden()
          hiddenRestoreIdentityController.markNeeded()
          hiddenRestoreFreshnessController.markNeeded()
        }
        // Why: hidden chunks with a restore already latched are dropped; the reveal snapshot covers their bytes.
      } else {
        // Why: hidden panes normally get no bytes (main drops post-ingestion); stragglers ride the bounded background queue, overflow latches restore.
        if (pendingForegroundQuery?.statefulQueryData) {
          writePtyOutputToXterm(pendingForegroundQuery.statefulQueryData, true, {
            hiddenStartupRendererQuery: true
          })
        }
        writePtyOutputToXterm(orderedRendererData, foreground)
        if (foreground) {
          recordRendererOrderedSeq(rendererMeta)
        }
      }

      schedulePendingStartupCommandDelivery()
    }
    reattachLiveDataController.bindDeliverData((data, meta, streamGeneration) =>
      dataCallback(data, meta, streamGeneration)
    )
    e2eDataInjectionController.register((data, meta) => {
      if (!disposed) {
        dataCallback(data, meta)
      }
    })

    const beginReattachLiveDataDeferral = reattachLiveDataController.begin

    const finishReattachLiveDataDeferral = (
      deliver: boolean,
      acceptedGeneration = streamGenerationController.getCurrent()
    ): void => {
      const settlement = reattachLiveDataController.finish(deliver, acceptedGeneration)
      if (settlement && settlement.deliveredChunks > 0) {
        // Why: replay restores the viewport before these newer bytes parse; settle the deferred slice, then apply the latest user intent.
        flushTerminalOutput(pane.terminal, { maxChars: REATTACH_LIVE_DATA_MAX_CHARS })
        void waitForTerminalReplayWritesParsed(pane.terminal).then(() => {
          if (
            disposed ||
            !deps.isVisibleRef.current ||
            transport.getPtyId() !== settlement.ptyId ||
            !streamGenerationController.isCurrent(settlement.streamGeneration)
          ) {
            return
          }
          enforceTerminalCurrentScrollIntent(pane.terminal)
        })
      }
    }

    const isCapturedDirectSshReattachCurrent = (ptyId: string): boolean =>
      !directSshRetryAttempt || capturedDirectSshRetryStateMatches(ptyId)
    const rejectObsoleteDirectSshReattach = (ptyId: string | null | undefined): boolean => {
      if (!directSshRetryAttempt || (ptyId && claimCapturedDirectSshRetryPty(ptyId))) {
        return false
      }
      transport.detach?.({ preserveExitObserver: false })
      return true
    }

    const reattachBindingController = createPtyConnectionReattachBindingController({
      isVisible: () => deps.isVisibleRef.current,
      setPanePtyFitBinding,
      reportPanePtyVisibility,
      registerSideEffectFactConsumerForPty,
      syncHiddenRendererPtyDelivery,
      syncPanePtyLayoutBinding: (ptyId) => deps.syncPanePtyLayoutBinding(pane.id, ptyId),
      notifyCodexPaneBoundForStaleSweep,
      updateTabPtyId: (ptyId, directSshRetryAttemptId) => {
        if (directSshRetryAttemptId) {
          deps.updateTabPtyId(deps.tabId, ptyId, undefined, directSshRetryAttemptId)
        } else {
          deps.updateTabPtyId(deps.tabId, ptyId)
        }
      },
      startProcessTracking: () => agentCompletionCoordinator.startProcessTracking(),
      sampleVisiblePaneForegroundAgent,
      registerPaneSerializerFor,
      scheduleReattachIdleAgentCursorReset,
      scheduleRuntimeGraphSync
    })

    const handleReattachResult = async (
      result: PtyConnectResult | string | void,
      staleSessionId?: string | null,
      coldRestoreStartup?: ColdRestoreAgentResumeStartup | null,
      attemptGeneration = streamGenerationController.getCurrent()
    ): Promise<boolean> => {
      const resultAdmissionController = createPtyConnectionReattachResultAdmissionController({
        isDisposed: () => disposed,
        isGenerationCurrent: streamGenerationController.isCurrent,
        getTransportPtyId: () => transport.getPtyId(),
        rejectObsoleteDirectSshReattach,
        warnMissingPty: (missingStaleSessionId) => {
          warnTerminalLifecycleAnomaly('restored PTY reattach returned no PTY id', {
            tabId: deps.tabId,
            worktreeId: deps.worktreeId,
            leafId: deps.restoredLeafId ?? pane.leafId,
            paneId: pane.id,
            ptyId: missingStaleSessionId
          })
        },
        clearPaneBinding: (bindingSessionId) => {
          if (bindingSessionId) {
            deps.clearExitedPanePtyLayoutBinding(pane.id, bindingSessionId)
          } else {
            deps.syncPanePtyLayoutBinding(pane.id, null)
          }
        },
        clearTabBinding: (bindingSessionId) => {
          deps.clearTabPtyId(deps.tabId, bindingSessionId)
        },
        startFreshColdRestore: (startup) => {
          startFreshColdRestoreAgentResume(startup, { forceBlankRestoredViewport: true })
        },
        registerEffectiveLaunchConfig,
        disconnect: () => transport.disconnect(),
        isPassiveResumeAuthority: (startup) =>
          Boolean(
            startup &&
            !startup.useLiveEntry &&
            startup.sleepingRecordEntry &&
            isPassiveCompletedHibernationEvidence(startup.sleepingRecordEntry.record)
          )
      })
      const admission = resultAdmissionController.admit({
        result,
        staleSessionId,
        coldRestoreStartup,
        attemptGeneration
      })
      if (admission.status === 'handled') {
        return admission.accepted
      }
      const { ptyId, connectResult, hasStructuralReplay } = admission
      const isCurrentReattachPayload = (): boolean => {
        const currentPtyId = transport.getPtyId()
        return (
          !disposed &&
          streamGenerationController.isCurrent(attemptGeneration) &&
          currentPtyId === ptyId
        )
      }
      if (!isCurrentReattachPayload()) {
        return false
      }
      reattachBindingController.bind(ptyId, {
        directSshRetryAttemptId:
          hasCapturedDirectSshRetryPtyAccepted() && directSshRetryAttempt
            ? directSshRetryAttempt.attemptId
            : undefined
      })

      const reattachParkSnapshotController = createPtyConnectionReattachParkSnapshotController({
        consumeParkMountEvidence: parkMountEvidenceController.consume,
        isCurrent: isCurrentReattachPayload,
        isRemoteRuntimePtyId,
        isSshParkingEnabled: () =>
          useAppStore.getState().settings?.terminalSshViewParking !== false,
        getMainBufferSnapshot: (id) =>
          getClientRuntime().terminal.getMainBufferSnapshot(id, {
            scrollbackRows: resolveHiddenRestoreScrollbackRows(pane.terminal.options.scrollback)
          }),
        serializeRendererSnapshot: (id) =>
          serializeHiddenOutputSnapshot(id, {
            scrollbackRows: resolveHiddenRestoreScrollbackRows(pane.terminal.options.scrollback)
          })
      })
      const parkSnapshotSelectionResult = reattachParkSnapshotController.select({
        ptyId,
        isReattach: connectResult?.isReattach === true,
        hasStructuralReplay,
        hasRelayReplay: Boolean(connectResult?.replay)
      })
      const parkSnapshotSelection =
        parkSnapshotSelectionResult instanceof Promise
          ? await parkSnapshotSelectionResult
          : parkSnapshotSelectionResult
      if (parkSnapshotSelection.status === 'stale') {
        return false
      }
      const parkModelSnapshot = parkSnapshotSelection.modelSnapshot
      const reattachPayloadController = createPtyConnectionReattachPayloadController({
        terminal: pane.terminal,
        isCurrent: isCurrentReattachPayload,
        runStructuralResize: (operation) => resizeSuppressionController.runStructural(operation),
        proposeDestinationRows: () => pane.fitAddon.proposeDimensions()?.rows ?? null,
        writeReplayData,
        waitForReplayWritesParsed: () => waitForTerminalReplayWritesParsed(pane.terminal),
        rememberPayloadAgentSignal: rememberReattachPayloadAgentSignal,
        scanReplayKeyboardModes: (data) => kittyKeyboardModes.scanReplay(data),
        resetKeyboardModes: () => kittyKeyboardModes.reset(),
        buildReplayResetSequence: reattachReplayResetSequence,
        sendFocusedReattachFocusIn: sendFocusedReattachFocusInAfterReplay,
        isRemoteRuntimePtyId,
        ackColdRestore: (id) => {
          getClientRuntime().terminal.ackColdRestore(id)
        },
        setReconciliationBaseline: restoredSnapshotReconciliationController.setBaseline,
        recordRendererOrderedSeq,
        buildColdRestoreStartup: buildColdRestoreAgentResumeStartup,
        applyColdRestoreStartup: applyColdRestoreAgentResumeStartup,
        showSessionRestoredBanner,
        clearSleepingRecordAfterColdRestoreSpawn,
        prepareFreshShellViewport: (destinationRows) => {
          preparePtyConnectionFreshShellViewport({
            paneId: pane.id,
            rows: destinationRows,
            forceBlankRestoredViewport: true,
            restoredViewportBlankingPanes: deps.restoredViewportBlankingPanesRef?.current,
            writeReplayData
          })
        },
        schedulePendingStartupCommandDelivery
      })
      const applyReattachPayload = (): Promise<void> =>
        reattachPayloadController.apply({
          ptyId,
          attemptGeneration,
          connectResult,
          modelSnapshot: parkModelSnapshot,
          coldRestoreStartup
        })

      const reattachFitController = createPtyConnectionReattachFitController({
        terminal: pane.terminal,
        isCurrent: isCurrentReattachPayload,
        getPtyId: () => transport.getPtyId(),
        hasFitOverride: getFitOverrideForPty,
        isRemoteRuntimePtyId,
        startFit: (reason, continuation) =>
          safeFitAndThen(pane, reason, continuation, {
            shouldContinue: isCurrentReattachPayload,
            retryIfUnmeasurable: true
          }),
        setPendingFit: pendingFitController.setReattach,
        clearPendingFitIf: pendingFitController.clearReattachIf,
        resizePty: (_ptyId, cols, rows) => transport.resize(cols, rows),
        signalPty: (id, signal) => {
          getClientRuntime().terminal.signal(id, signal)
        },
        isVisible: () => deps.isVisibleRef.current,
        requestSizeReassertion: sizeReassertionController.request
      })
      const fitAfterReattachRestore = (): Promise<void> => reattachFitController.fit()
      if (reattachPayloadController.requiresStructuralReplay(connectResult, parkModelSnapshot)) {
        await structuralReplayCoordinator.run(applyReattachPayload, {
          shouldRestore: isCurrentReattachPayload,
          afterRestore: fitAfterReattachRestore
        })
      } else {
        await applyReattachPayload()
        await fitAfterReattachRestore()
      }
      if (!isCurrentReattachPayload()) {
        return false
      }
      reattachBindingController.complete()
      return true
    }

    const reattachAttemptController = createPtyConnectionReattachAttemptController({
      transport,
      cacheKey,
      runtimeEnvironmentId,
      cols,
      rows,
      captureTransportOutputCallbacks,
      getTransportStreamGeneration: streamGenerationController.getCurrent,
      beginLiveDataDeferral: beginReattachLiveDataDeferral,
      finishLiveDataDeferral: finishReattachLiveDataDeferral,
      handleReattachResult,
      settlePaneSerializerAfterReplay,
      mergeStartupEnvWithPaneIdentity,
      shouldDeclareHiddenAtSpawn,
      directSshRetryAttempt,
      claimCapturedDirectSshRetryPty,
      armDirectSshPaneRetryTimeout,
      setConnectInFlightSince: transportSettleController.setInFlightSince
    })

    const attachController = createPtyConnectionAttachController({
      transport,
      cols,
      rows,
      clearPaneMode2031State,
      clearHiddenOutputRestoreState,
      captureTransportOutputCallbacks,
      reportError,
      bindActivePanePty,
      registerPaneSerializerFor
    })

    // Why: trigger the deferred SSH connect per-tab (not per-target) so multiple tabs for one target reattach independently.
    // Must run before session-id resolution: the SSH provider isn't registered until connect succeeds.
    if (connectionId) {
      const storeState = useAppStore.getState()
      const shouldStopNormalRouting = runPtyConnectionObservedSshRoute({
        route: {
          connectionId,
          tabId: deps.tabId,
          sshStatus: storeState.sshConnectionStates.get(connectionId)?.status,
          sshTargetLabels: storeState.sshTargetLabels,
          isDeferredTarget: storeState.deferredSshReconnectTargets.includes(connectionId),
          restoredLeafSessionId:
            deps.restoredLeafId && deps.restoredPtyIdByLeafId
              ? (deps.restoredPtyIdByLeafId[deps.restoredLeafId] ?? null)
              : null,
          deferredTabSessionId: storeState.deferredSshSessionIdsByTabId[deps.tabId],
          tabPtyId: storeState.tabsByWorktree[deps.worktreeId]?.find((t) => t.id === deps.tabId)
            ?.ptyId,
          hasLeafSessionMap: Boolean(
            deps.restoredPtyIdByLeafId && Object.keys(deps.restoredPtyIdByLeafId).length > 0
          ),
          legacyWorkerAutomaticResumeBlocked: isLegacyWorkerAutomaticResumeBlocked(),
          recordRouteDiagnostic: (message) => console.warn(message)
        },
        session: {
          tabId: deps.tabId,
          needsPassphrasePrompt: () =>
            getClientRuntime().ssh.needsPassphrasePrompt({ targetId: connectionId }),
          getSshStatus: () => useAppStore.getState().sshConnectionStates.get(connectionId)?.status,
          subscribeSshStatus: (listener) => useAppStore.subscribe(() => listener()),
          outcomeForStatus: sshPromptConnectOutcomeForStatus,
          isCurrentAuthority: () => !disposed && capturedDirectSshRetryLeaseMatches(),
          isDisposed: () => disposed,
          waitTeardowns,
          waitForConnection: () => waitForSshConnection(connectionId),
          removeDeferredReconnectTarget: () =>
            useAppStore.getState().removeDeferredSshReconnectTarget(connectionId),
          reportError,
          legacyWorkerAutomaticResumeBlocked: isLegacyWorkerAutomaticResumeBlocked,
          attachRetainedLegacyPty: attachController.attachRetainedLegacyPty,
          removeDeferredSession: () =>
            useAppStore.getState().removeDeferredSshSessionId(deps.tabId),
          scheduleRuntimeGraphSync,
          startFreshColdRestore: startFreshColdRestoreAgentResume,
          buildColdRestoreStartup: buildColdRestoreAgentResumeStartup,
          clearPaneMode2031State,
          clearHiddenOutputRestoreState,
          getTransportStreamGeneration: streamGenerationController.getCurrent,
          isCurrentReattachAuthority: isCapturedDirectSshReattachCurrent,
          rejectObsoleteReattachAuthority: rejectObsoleteDirectSshReattach,
          isSessionExpiredError: isSshSessionExpiredError,
          clearBindings: (sessionId) => {
            deps.clearExitedPanePtyLayoutBinding(pane.id, sessionId)
            deps.clearTabPtyId(deps.tabId, sessionId)
          },
          attemptReattach: reattachAttemptController.attempt,
          logWarning: (...args) => console.warn(...args)
        }
      })
      if (shouldStopNormalRouting) {
        return
      }
    }

    // Why: re-read session IDs inside the rAF — cleanup during the one-frame gap could otherwise reattach a dead session.
    const restoredPtyId =
      deps.restoredLeafId && deps.restoredPtyIdByLeafId
        ? (deps.restoredPtyIdByLeafId[deps.restoredLeafId] ?? null)
        : null
    const storeSnapshot = useAppStore.getState()
    const existingPtyId = storeSnapshot.tabsByWorktree[deps.worktreeId]?.find(
      (t) => t.id === deps.tabId
    )?.ptyId
    const hasSleepingAgentSession = Boolean(getSleepingRecordForPane(storeSnapshot))

    runPtyConnectionObservedNormalRoute({
      observation: {
        paneId: pane.id,
        tabId: deps.tabId,
        restoredPtyId,
        existingPtyId,
        pendingSpawnKey,
        hadExistingPaneTransportAtConnect,
        hasSleepingAgentSession,
        currentTabLivePtyIds: storeSnapshot.ptyIdsByTabId[deps.tabId] ?? [],
        runtimeEnvironmentId,
        mountFollowsTerminalPark: parkMountEvidenceController.peek(),
        worktreeId: deps.worktreeId,
        legacyWorkerAutomaticResumeBlocked: isLegacyWorkerAutomaticResumeBlocked(),
        isRemoteRuntimePtyId,
        hasEagerBuffer: (ptyId) => Boolean(getEagerPtyBufferHandle(ptyId)),
        canRestorePairedParkedTerminal,
        isSessionOwnedByWorktree,
        // Why: the tab fallback must not steal a PTY a setup sibling published while the main pane waited for split geometry.
        isPtyClaimedBySibling: (ptyId) =>
          Array.from(deps.paneTransportsRef.current.entries()).some(
            ([candidatePaneId, candidateTransport]) =>
              candidatePaneId !== pane.id && candidateTransport.getPtyId() === ptyId
          ),
        clearPanePtyLayoutBinding: (ptyId) => deps.syncPanePtyLayoutBinding(pane.id, ptyId),
        clearTabPtyId: deps.clearTabPtyId,
        recordDiagnostic: recordPtyConnectDiagnostic
      },
      normalRoute: {
        buildColdRestoreStartup: buildColdRestoreAgentResumeStartup,
        startFreshColdRestore: startFreshColdRestoreAgentResume,
        restoredReattach: {
          paneId: pane.id,
          tabId: deps.tabId,
          worktreeId: deps.worktreeId,
          leafId: deps.restoredLeafId ?? pane.leafId,
          setAllowInitialIdleCacheSeed: initialCacheTimerSeedController.setAllowed,
          recordDiagnostic: recordPtyConnectDiagnostic,
          buildColdRestoreStartup: buildColdRestoreAgentResumeStartup,
          isDisposed: () => disposed,
          getTransportStreamGeneration: streamGenerationController.getCurrent,
          isCurrentAuthority: isCapturedDirectSshReattachCurrent,
          rejectObsoleteAuthority: rejectObsoleteDirectSshReattach,
          isRejectedSessionExpired: (error) =>
            Boolean(connectionId && isSshSessionExpiredError(error)),
          clearPaneBinding: (sessionId) => deps.clearExitedPanePtyLayoutBinding(pane.id, sessionId),
          clearTabBinding: (sessionId) => deps.clearTabPtyId(deps.tabId, sessionId),
          reportError,
          warnLifecycleAnomaly: warnTerminalLifecycleAnomaly,
          attemptReattach: reattachAttemptController.attempt
        },
        attachSpawn: {
          paneId: pane.id,
          tabId: deps.tabId,
          hasSshConnection: Boolean(connectionId),
          pendingSpawnKey,
          transport,
          directSshRetryAttempt,
          setAllowInitialIdleCacheSeed: initialCacheTimerSeedController.setAllowed,
          recordDiagnostic: recordPtyConnectDiagnostic,
          attachRetainedLegacyPty: attachController.attachRetainedLegacyPty,
          removeDeferredSshSessionId: () =>
            useAppStore.getState().removeDeferredSshSessionId(deps.tabId),
          attachDetachedPty: attachController.attachDetachedPty,
          clearTabPtyId: deps.clearTabPtyId,
          startFreshSpawn,
          armDirectSshPaneRetryTimeout,
          isDisposed: () => disposed,
          canAdoptCapturedDirectSshRetryPty,
          adoptPendingSpawn: attachController.adoptPendingSpawn,
          reportError
        },
        scheduleRuntimeGraphSync
      }
    })
  }

  const startupGridController = createPtyConnectionStartupGridController({
    pane,
    manager,
    startupCommand: paneStartup?.command,
    waitForSetupSplitDirection: paneStartup?.waitForSetupSplitDirection,
    connectionId,
    runtimeEnvironmentId,
    isVisible: () => deps.isVisibleRef.current,
    isDisposed: () => disposed,
    connect: performDeferredConnect
  })
  startupGridController.schedule()

  const sessionLivenessReconcileController = createPtyConnectionSessionLivenessReconcileController({
    transport,
    isDisposed: () => disposed,
    hasHandledExit: exitController.hasHandledExit,
    getPtyBoundAt: panePtyBindingController.getBoundAt,
    onExit
  })

  return {
    syncProcessTracking() {
      agentCompletionCoordinator.startProcessTracking()
      // Why: the hidden-delivery gate must follow every pane visibility flip.
      syncHiddenRendererPtyDelivery()
      if (!deps.isVisibleRef.current) {
        remoteViewportClaimController.clearPending()
      }
    },
    // Why: visible-resume size readback repairs dropped hidden resizes without refitting against xterm's transient hidden DOM fallback.
    noteVisibilityResume() {
      remoteViewportClaimController.armCurrent()
      remoteViewportClaimController.claimPending()
      sizeReassertionController.request()
      hibernatedWakeController.consume()
      requestKnownDroidReconfirmation()
      sampleVisiblePaneForegroundAgent()
    },
    reassertPtySizeAfterWindowWake() {
      remoteViewportClaimController.armCurrent()
      remoteViewportClaimController.claimPending()
      sizeReassertionController.request()
    },
    // Why: mobile wake reaches this pane while it's hidden on the desktop, so consume only the armed hibernation wake — no size/foreground reads.
    wakeHibernatedAgentIfArmed(claimedProviderSessions) {
      const inFlightClaimKey = hibernatedWakeController.claimInFlight(claimedProviderSessions)
      if (inFlightClaimKey) {
        return inFlightClaimKey
      }
      const consumedClaimKey = hibernatedWakeController.consume(claimedProviderSessions)
      if (consumedClaimKey) {
        return consumedClaimKey
      }
      // Why: wake arrived mid-hibernation-kill before onExit armed the wake target (transport still bound to the dying PTY).
      // Only the exact PTY marked for suppressed shutdown may latch — never a stale/manual record beside an ordinary live PTY.
      const state = useAppStore.getState()
      const recordEntry = getSleepingRecordForPane(state)
      const currentPtyId = transport.getPtyId()
      if (
        recordEntry &&
        isPassiveCompletedHibernationEvidence(recordEntry.record) &&
        currentPtyId !== null &&
        state.suppressedPtyExitIds[currentPtyId] === true &&
        !disposed &&
        !hibernatedWakeController.hasArmedTarget() &&
        deps.paneTransportsRef.current.get(pane.id) === transport &&
        transport.getPtyId() === currentPtyId
      ) {
        return hibernatedWakeController.latchPending(
          { ptyId: currentPtyId, record: recordEntry.record },
          claimedProviderSessions
        )
      }
      return null
    },
    sampleForegroundAgentOnFocus() {
      requestKnownDroidReconfirmation()
      sampleVisiblePaneForegroundAgent()
    },
    requestDroidReconfirmation() {
      droidReconfirmationController.request()
    },
    reconcileIfSessionDead: sessionLivenessReconcileController.reconcileIfSessionDead,
    reconcileIfSessionMissing: sessionLivenessReconcileController.reconcileIfSessionMissing,
    dispose() {
      disposed = true
      disposeDirectSshRetryController()
      // Why: a stalled xterm replay may never reach its finally; release live-frame credit when this renderer no longer owns the stream.
      reattachLiveDataController.dispose()
      cancelPendingSafeFitContinuations(pane)
      pendingFitController.clearAll()
      // Why: park/reconnect/remount doesn't advance the recovery epoch, so invalidate this xterm or its delayed retry could hit the next instance.
      terminalRecoveryInstance.unregister()
      unregisterUndeliverableWriteHandler()
      remoteViewportClaimController.dispose()
      hiddenRestoreCleanupController.dispose()
      structuralReplayCoordinator.dispose()
      freshSpawnFollowController.cancel()
      spawnSizeReconcileController.dispose()
      startupGridController.dispose()
      sizeReassertionController.dispose()
      // Why: a pane unmount must never leave its PTY delivery gated — the parked watcher or remounted pane re-decides.
      releaseHiddenRendererPtyDelivery()
      if (terminalKeyTargetSupportsEvents) {
        terminalKeyTarget.removeEventListener('keydown', onTerminalKeyDown, { capture: true })
      }
      clearPendingTerminalInputIntent()
      clearPendingTerminalInputWrite()
      interruptInference.dispose()
      titleOnlyInterruptController.dispose()
      droidReconfirmationController.dispose()
      // Why release, not cancel: the pending settle belongs to the turn, not to
      // this pane — a park mid-settle hands it to the parked watcher instead.
      releaseCommandCodeDoneSettleExecutor()
      // Why: resolve in-flight passphrase-gate waits so their zustand subscribers + async IIFEs don't hang when the pane is torn down before SSH state changes.
      while (waitTeardowns.length > 0) {
        const teardown = waitTeardowns.pop()
        teardown?.()
      }
      startupDeliveryCleanupController.dispose()
      releaseUnattemptedStartupDraftPasteDelivery()
      unregisterAgentHookTerminalLifecycle()
      titleCompletionDeferralController.dispose()
      disposeAgentNotificationController()
      clearReattachIdleAgentCursorResetTimer()
      alternateScreenRepaintController.dispose()
      recoverySubscriptionsController.dispose()
      releaseRendererPtyVisibilityClaim(transport)
      // Why: the pane's fact consumer must be gone before a parked-tab watcher takes over this PTY's facts in the same effect flush.
      dropSideEffectFactConsumer()
      panePtyBindingController.clear()
      discardTerminalOutput(pane.terminal)
      e2eDataInjectionController.dispose()
      windowsDoneStatusController.dispose()
      imeCompositionRouteDisposable.dispose()
      onDataDisposable.dispose()
      userInputActivityDisposable?.dispose()
      terminalCapabilityRepliesDisposable.dispose()
      resizeForwardingController.dispose()
      bufferSwitchController.dispose()
      paneGeometryController.dispose()
      commandLifecycle.dispose()
      commandFinishedStatusDropController.dispose()
      visibleForegroundSampleController.dispose()
      paneForegroundAgentTracker.dispose()
      agentCompletionCoordinator.dispose()
    }
  }
}
