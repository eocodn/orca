import { getClientRuntime } from '../../runtime/client-runtime'
import type { PaneManager, ManagedPane } from '@/lib/pane-manager/pane-manager'
import type { IDisposable } from '@xterm/xterm'
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
import { isRuntimeOwnedSshTargetId, parseExecutionHostId } from '../../../../shared/execution-host'
import { createTerminalZeroDimensionsMessage } from '../../../../shared/terminal-zero-dimensions-diagnostic'
import { isWorktreeRemovalFenceError } from '../../../../shared/worktree-removal-fence-error'
import { parseTerminalOscColorQuery } from '../../../../shared/terminal-osc-color-reply'
import {
  HIDDEN_STARTUP_RENDERER_QUERY_PENDING_CHARS,
  containsStatefulRendererQuery,
  extractHiddenStartupRendererQueryData,
  findCsiFinalByteIndex,
  isStatefulRendererReplyCsiQuery,
  isStatelessRendererReplyCsiQuery
} from '../../../../shared/terminal-reply-query-extraction'
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
import { shouldSeedCacheTimerOnInitialTitle } from './cache-timer-seeding'
import type { PtyConnectionDeps } from './pty-connection-types'
import {
  cancelPendingSafeFitContinuations,
  safeFit,
  safeFitAndThen,
  type SafeFitContinuationHandle
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
  POST_REPLAY_LIVE_AGENT_SNAPSHOT_RESET,
  POST_REPLAY_LIVE_SNAPSHOT_RESET,
  POST_REPLAY_MODE_RESET,
  POST_REPLAY_REATTACH_RESET,
  RESET_KITTY_KEYBOARD_PROTOCOL,
  RESET_TERMINAL_CURSOR_STYLE
} from './layout-serialization'
import { buildFreshShellViewportBlankingSequence } from './terminal-restored-viewport'
import { scanForShellReadyMarker } from './shell-ready-marker-scan'
import { getSystemPrefersDark } from '@/lib/terminal-theme'
import {
  INITIAL_MODE_2031_REPLY_SCAN_STATE,
  mode2031SequenceFor,
  resolveTerminalColorSchemeMode,
  scanMode2031ReplyDecision
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
import { createPaneForegroundAgentTracker } from './pane-foreground-agent-tracker'
import { parseAppSshPtyId } from '../../../../shared/ssh-pty-id'
import { resolveSshPaneConnectGate } from './ssh-pane-connect-gate'
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
import { AGENT_INTERRUPT_SETTLE_MS } from '../../../../shared/agent-interrupt-intent'
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
import type { AgentCompletionStatusSnapshot } from './agent-completion-coordinator-types'
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
  DEFAULT_DA1_RESPONSE,
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
import {
  cancelScheduledHiddenOutputRestore,
  scheduleHiddenOutputRestore
} from './hidden-output-restore-scheduler'
import { resolveHiddenRestoreScrollbackRows } from './terminal-hidden-restore-scrollback'
import {
  buildMainModelSnapshotReplayWrites,
  hasPositiveTerminalDimensions,
  resolvePositiveTerminalDimensions
} from './terminal-snapshot-replay-paint'
import {
  decideSshReattachPaintSource,
  memoizeSshReattachModelSnapshotProbe,
  resolveSshReattachModelSnapshotWithTimeout,
  shouldFetchSshReattachModelSnapshot
} from './ssh-reattach-model-restore'
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
import type { SleepingAgentSessionRecord } from '../../../../shared/agent-session-resume'
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
  FOREGROUND_BUDGET_WINDOW_MS,
  FOREGROUND_IMMEDIATE_BUDGET_CHARS,
  FOREGROUND_INTERACTIVE_REDRAW_CHARS,
  FOREGROUND_INTERACTIVE_REDRAW_WINDOW_MS,
  FOREGROUND_SYNCHRONIZED_FRAME_INTERACTIVE_WINDOW_MS,
  FOREGROUND_THROUGHPUT_IMMEDIATE_CHARS,
  HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MAX,
  HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MS,
  HIDDEN_OUTPUT_RESTORE_FLOOD_SUPPRESS_MS,
  HIDDEN_OUTPUT_RESTORE_FOREGROUND_TIMEOUT_MS,
  HIDDEN_OUTPUT_RESTORE_MAX_LOOP_ITERATIONS,
  HIDDEN_OUTPUT_RESTORE_PENDING_CHARS,
  HIDDEN_OUTPUT_RESTORE_UNAVAILABLE_WARNING,
  SHIFT_ENTER_RECONFIRM_IDLE_MS,
  STARTUP_CWD_FALLBACK_NOTICE,
  SYNCHRONIZED_OUTPUT_END_SEQUENCE,
  SYNCHRONIZED_OUTPUT_MARKER_TAIL_CHARS,
  SYNCHRONIZED_OUTPUT_START_SEQUENCE,
  TERMINAL_FOCUS_IN_SEQUENCE,
  TERMINAL_FOCUS_OUT_SEQUENCE,
  TERMINAL_RENDERER_RISK_SCAN_TAIL_CHARS,
  pendingSpawnByPaneKey
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
  containsCursorRestore,
  containsSynchronizedOutputEnd,
  containsSynchronizedOutputStart,
  isCodexPaneStale,
  isRemoteRuntimePtyId,
  isSessionOwnedByWorktree,
  isSshSessionExpiredError,
  shouldSynchronizedOutputRemainActive,
  shouldWritePtyOutputForeground,
  sshPromptConnectOutcomeForStatus,
  waitForSshConnection
} from './pty-connection-routing-policy'
import type { UserInitiatedSshConnectOutcome } from './pty-connection-routing-policy'
import { createPtyConnectionStartupState } from './pty-connection-startup-state'
import { createPtyConnectionCommandInference } from './pty-connection-command-inference'
import { createPtyConnectionReattachAgentSignals } from './pty-connection-reattach-agent-signals'
import { createPtyConnectionInputIntent } from './pty-connection-input-intent'
import { createPtyConnectionSerializerController } from './pty-connection-serializer-controller'
import { createPtyConnectionStartupDraftController } from './pty-connection-startup-draft-controller'
import { createPtyConnectionColdRestoreStartup } from './pty-connection-cold-restore-startup'
import { createPtyConnectionStartupCommandDelivery } from './pty-connection-startup-command-delivery'
import { createPtyConnectionDirectSshRetryController } from './pty-connection-direct-ssh-retry-controller'
import { createPtyConnectionAgentNotificationController } from './pty-connection-agent-notification-controller'
import { createPtyConnectionExitController } from './pty-connection-exit-controller'
import { createPtyConnectionRemoteViewportClaimController } from './pty-connection-remote-viewport-claim-controller'
import { createPtyConnectionResizeForwardingController } from './pty-connection-resize-forwarding-controller'
import { createPtyConnectionPaneGeometryController } from './pty-connection-pane-geometry-controller'
import { createPtyConnectionSpawnSizeReconcileController } from './pty-connection-spawn-size-reconcile-controller'
import { createPtyConnectionSizeReassertionController } from './pty-connection-size-reassertion-controller'
import { createPtyConnectionSessionLivenessReconcileController } from './pty-connection-session-liveness-reconcile-controller'
import { createPtyConnectionStartupGridController } from './pty-connection-startup-grid-controller'
import { createPtyConnectionReattachAttemptController } from './pty-connection-reattach-attempt-controller'
import { createPtyConnectionAttachController } from './pty-connection-attach-controller'
import { resolvePtyConnectionAttachCandidate } from './pty-connection-attach-candidate'

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
  let mountFollowsTerminalPark = isTerminalTabParked(deps.tabId)
  exposeE2eTerminalPtyOutputDebug()
  let disposed = false
  const structuralReplayCoordinator = createTerminalStructuralReplayCoordinator(pane.terminal)
  let unregisterBacklogRecovery: (() => void) | null = null
  let unregisterDocumentVisibilityRecovery: (() => void) | null = null
  let cancelHiddenOutputSnapshotScrollRestore = (): void => {}
  let pendingHiddenSnapshotFit: SafeFitContinuationHandle | null = null
  let pendingReattachFit: SafeFitContinuationHandle | null = null
  let cancelFreshSpawnFollowReset = (): void => {}
  let cleanupHiddenOutputRestoreDeferredRetry = (): void => {}
  let cleanupHiddenOutputRestoreForegroundDeadline = (): void => {}
  let cleanupHiddenOutputRestoreFloodRepaint = (): void => {}
  let resetRendererOrderedSeqForPtyExit: (exitedPtyId: string) => void = () => {}
  let cleanupStartupDelivery = (): void => {}
  let unregisterE2ePtyDataInjection = (): void => {}
  let alternateScreenBackgroundRepaintTimer: ReturnType<typeof setTimeout> | null = null
  let shiftEnterReconfirmTimer: ReturnType<typeof setTimeout> | null = null
  let synchronizedForegroundOutputActive = false
  // Why: tracks the keystroke proximity captured when the current synchronized
  // foreground frame opened, so a split end marker that lands after the redraw
  // window still drains on the fast path instead of the 1s coalesce fallback.
  let synchronizedForegroundFrameInteractive = false
  let suppressStructuralReplayPtyResize = false
  // Why: hidden-delivery gate sync is wired up alongside the deferred PTY
  // output plumbing inside the connect frame; lifecycle hooks (visibility
  // flips, exit, dispose) run before/after it exists, so start with no-ops.
  let syncHiddenRendererPtyDelivery: () => void = () => {}
  let releaseHiddenRendererPtyDelivery: () => void = () => {}
  let handleRemoteOutputPauseChanged: (paused: boolean, supported: boolean) => void = () => {}
  let handleRendererOwnedAgentStatus: NonNullable<
    IpcPtyTransportOptions['onAgentStatus']
  > = () => {}
  let remoteOutputPausedPtyId: string | null = null
  let suppressViewportClaimTerminalResize = false
  // Why: idle callbacks are registered before the deferred PTY output plumbing
  // exists. Start with the shared scheduler, then switch to the PTY writer
  // below so hidden-tab resets keep backlog-recovery callbacks and byte order.
  let idleAgentTerminalModeReset = RESET_TERMINAL_CURSOR_STYLE
  let suppressNativeWindowsIdleCodexFocusReports = false
  const setFocusReportSuppressionForAgentCompletion = (
    title: string | undefined,
    agentType: AgentType | undefined
  ): void => {
    const titleAgentType = resolveCommittedTitleAgentType(title ?? '')
    suppressNativeWindowsIdleCodexFocusReports =
      agentType && agentType !== 'unknown' ? agentType === 'codex' : titleAgentType === 'codex'
  }
  let queueAgentIdleTerminalModeReset = (): void => {
    if (disposed) {
      return
    }
    writeTerminalOutput(pane.terminal, idleAgentTerminalModeReset, {
      foreground: shouldWritePtyOutputForeground(deps.isVisibleRef.current)
    })
  }
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
  let pendingSuppressedTitleSideEffects: {
    title: string
    agentType: AgentType | undefined
  } | null = null
  const clearSuppressedTitleSideEffects = (): void => {
    pendingSuppressedTitleSideEffects = null
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
    setFocusReportSuppressionForAgentCompletion(title, agentType)
    queueAgentIdleTerminalModeReset()
  }
  const preserveSuppressedTitleSideEffects = (
    title: string,
    activeHookStatus: AgentStatusEntry
  ): void => {
    pendingSuppressedTitleSideEffects = {
      title,
      agentType: activeHookStatus.agentType
    }
    if (activeHookStatus.state === 'waiting' || activeHookStatus.state === 'blocked') {
      suppressNativeWindowsIdleCodexFocusReports = false
      queueAgentIdleTerminalModeReset()
    }
  }
  const handleAgentHookTerminalLifecycle = (payload: AgentCompletionStatusSnapshot): void => {
    const pending = pendingSuppressedTitleSideEffects
    if (!pending) {
      return
    }
    const payloadAgentForPending = resolveCompatibleAgentTypeForOwner(
      payload.agentType,
      pending.agentType
    )
    const belongsToPendingAgent =
      !pending.agentType ||
      pending.agentType === 'unknown' ||
      !payload.agentType ||
      payload.agentType === 'unknown' ||
      payloadAgentForPending === pending.agentType
    if (!belongsToPendingAgent || payload.state === 'working') {
      clearSuppressedTitleSideEffects()
      return
    }
    if (payload.state === 'done') {
      applyAgentCompletionSideEffects(pending.title, payload.agentType ?? pending.agentType)
      clearSuppressedTitleSideEffects()
      return
    }
    if (payload.state === 'waiting' || payload.state === 'blocked') {
      suppressNativeWindowsIdleCodexFocusReports = false
      queueAgentIdleTerminalModeReset()
    }
  }
  const unregisterAgentHookTerminalLifecycle = registerAgentHookTerminalLifecycleHandler(
    cacheKey,
    handleAgentHookTerminalLifecycle
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
  let titleOnlyInterruptTimer: ReturnType<typeof setTimeout> | null = null
  const clearTitleOnlyInterruptTimer = (): void => {
    if (titleOnlyInterruptTimer !== null) {
      clearTimeout(titleOnlyInterruptTimer)
      titleOnlyInterruptTimer = null
    }
  }
  const observeTitleOnlyInterrupt = (): void => {
    const state = useAppStore.getState()
    if (state.agentStatusByPaneKey[cacheKey]) {
      return
    }
    const runtimeTitle = state.runtimePaneTitlesByTabId?.[deps.tabId]?.[pane.id]
    const tabTitle = (state.tabsByWorktree[deps.worktreeId] ?? []).find(
      (entry) => entry.id === deps.tabId
    )?.title
    const baselineTitle = runtimeTitle ?? tabTitle
    if (detectAgentStatusFromTitle(baselineTitle ?? '') !== 'working') {
      return
    }
    clearTitleOnlyInterruptTimer()
    titleOnlyInterruptTimer = setTimeout(() => {
      titleOnlyInterruptTimer = null
      if (useAppStore.getState().agentStatusByPaneKey[cacheKey]) {
        return
      }
      const currentState = useAppStore.getState()
      const currentRuntimeTitle = currentState.runtimePaneTitlesByTabId?.[deps.tabId]?.[pane.id]
      const currentTabTitle = (currentState.tabsByWorktree[deps.worktreeId] ?? []).find(
        (entry) => entry.id === deps.tabId
      )?.title
      const currentTitle = currentRuntimeTitle ?? currentTabTitle
      if (
        currentTitle === baselineTitle &&
        detectAgentStatusFromTitle(currentTitle ?? '') === 'working'
      ) {
        // Why: title-only agents such as Pi can miss their own idle title after
        // Ctrl+C. Clear only an unchanged, acknowledged working title.
        clearInferredInterruptWorkingTitle()
      }
    }, AGENT_INTERRUPT_SETTLE_MS)
  }
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
    queueAgentIdleTerminalModeReset: () => queueAgentIdleTerminalModeReset()
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
    observeTitleOnlyInterrupt,
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
  let deferredCommandFinishedStatusDrop: (() => void) | null = null
  let visibleForegroundSamplePending = false
  let visibleForegroundSampleSettled = false
  const settleDeferredCommandFinishedStatusDrop = (): void => {
    const dropStatus = deferredCommandFinishedStatusDrop
    deferredCommandFinishedStatusDrop = null
    dropStatus?.()
  }
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
      settleDeferredCommandFinishedStatusDrop()
    },
    onCommandFinishedUnavailable: settleDeferredCommandFinishedStatusDrop,
    onVisibleForegroundSettled: (outcome) => {
      visibleForegroundSamplePending = false
      visibleForegroundSampleSettled = outcome !== 'inconclusive'
    }
  })
  // Why: one command-finished policy whether the signal arrives as bytes
  // (remote PTYs, kill switch off) or as a main-derived pty:sideEffect fact —
  // routing both through this handler keeps the drop/interrupt semantics
  // identical across authority modes.
  const handleCommandFinished = (bestEffortExitCode: number | null): void => {
    clearCommandInferredPaneAgentAfterPtySideEffects()
    visibleForegroundSamplePending = false
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
    if (shouldDeferStatusDrop) {
      // Why: keep the concrete pane identity routable while the local process
      // check distinguishes a leaked nested-shell D from a genuine agent exit.
      deferredCommandFinishedStatusDrop = dropStatus
      return
    }
    deferredCommandFinishedStatusDrop = null
    dropStatus()
  }
  const sampleVisiblePaneForegroundAgent = (forceRoutingConfirmation = false): void => {
    if (
      !deps.isVisibleRef.current ||
      visibleForegroundSamplePending ||
      visibleForegroundSampleSettled
    ) {
      return
    }
    const state = useAppStore.getState()
    const foreground = state.paneForegroundAgentByPaneKey[cacheKey]
    // Why: a daemon reattach may restore display identity without current
    // routing authority. Only fresh evidence can suppress its confirmation.
    if (foreground?.agent && foreground.routingTrusted === true) {
      return
    }
    if (!forceRoutingConfirmation && paneHasLiveHookAgentIcon(state)) {
      return
    }
    const expectsAgent = paneExpectsLaunchAgent(state)
    // Why: a completed local process ladder is stronger than stale tab/startup
    // launch metadata. Command-start clears this mark if the pane becomes busy.
    if (foreground?.shellForeground) {
      return
    }
    // Why: tab launch metadata can leak across split panes; rebuild pane-scoped
    // identity from local process state, with remote/SSH excluded by the tracker.
    visibleForegroundSamplePending = paneForegroundAgentTracker.onVisiblePtyBound(expectsAgent)
  }
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
    visibleForegroundSamplePending = false
    visibleForegroundSampleSettled = false
    // Why: hook rows can suppress display-only sampling, but cannot restore
    // byte authority after this function explicitly revoked routing trust.
    sampleVisiblePaneForegroundAgent(true)
  })
  const commandLifecycle = createTerminalCommandLifecycle({
    onCommandStarted: () => {
      // Why: a new command invalidates cleanup waiting on the previous D; only
      // a later confirmed shell boundary may retire this pane's live identity.
      deferredCommandFinishedStatusDrop = null
      visibleForegroundSamplePending = false
      visibleForegroundSampleSettled = false
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
  let activePanePtyBinding: string | null = null
  // Why: bind time lets async liveness reconcile ignore a request started
  // before this PTY bound (newborn race). Null disables the guard (fail-safe).
  let activePanePtyBindingBoundAt: number | null = null

  // Why: with main side-effect authority on, the pane's title/bell/agent
  // policy callbacks consume pty:sideEffect facts instead of transport byte
  // parsers (which stay unregistered) — same policy code, single consumer.
  // restoreTitleOnRegister replaces the eager-replay title restore: main's
  // title-only snapshot carries the no-attention-replay rule.
  let unregisterSideEffectFactConsumer: (() => void) | null = null
  const registerSideEffectFactConsumerForPty = (
    ptyId: string,
    remoteOutputPaused = false
  ): void => {
    if ((!mainSideEffectAuthority && !remoteOutputPaused) || disposed) {
      return
    }
    unregisterSideEffectFactConsumer?.()
    unregisterSideEffectFactConsumer = registerTerminalSideEffectFactConsumer({
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
  }
  const dropSideEffectFactConsumer = (): void => {
    unregisterSideEffectFactConsumer?.()
    unregisterSideEffectFactConsumer = null
  }
  const clearPanePtyFitBinding = (): void => {
    // Why: fit bindings live in a module-level map, so pane teardown must
    // clear them explicitly instead of relying on DOM removal.
    bindPanePtyId(pane.id, null, deps.tabId)
    remoteViewportClaimController.clear()
    activePanePtyBinding = null
    activePanePtyBindingBoundAt = null
    delete pane.container.dataset.ptyId
    delete pane.container.dataset.ptyRecoveryState
  }

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
        clearSuppressedTitleSideEffects()
      }
      if (meta?.terminalIdleConfirmed === true) {
        // Why: an agent can crash before its done hook; confirmed process death
        // must still restore cursor and native Windows Kitty keyboard modes.
        const currentAgentStatus = useAppStore.getState().agentStatusByPaneKey[cacheKey]
        if (!isFreshNonDoneAgentStatus(currentAgentStatus)) {
          setFocusReportSuppressionForAgentCompletion(title, meta.agentStatus?.agentType)
        }
        queueAgentIdleTerminalModeReset()
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

  // Why: hibernation suppresses its kill's exit while the pane is hidden, so
  // onExit must not tear the pane down — but the pane still owes the user a
  // wake. Remember the hibernated PTY and exact record; the visibility-resume
  // hook consumes both and cannot accidentally adopt a later stale record.
  type HibernatedWakeTarget = { ptyId: string; record: SleepingAgentSessionRecord }
  let hibernatedWakeTarget: HibernatedWakeTarget | null = null
  let wakeHibernatedAgentPane: (() => Promise<string | null>) | null = null
  // Why: a mobile wake can land after the sleeping record is written but
  // before the suppressed kill exit arms the wake target. The phone never
  // reveals the desktop pane, so without a latch the edge-triggered wake would
  // be dropped and the phone left on a frozen terminal.
  let pendingHibernatedWakeTarget: HibernatedWakeTarget | null = null
  // Why: transport.connect settles asynchronously. Repeated mobile activation
  // must keep claiming this provider session until the replacement PTY either
  // exists (and clears the sleep record) or the spawn fails and can be retried.
  let hibernatedWakeInFlightClaimKey: string | null = null
  // Why: reveal is the normal wake trigger, but a reveal that lands *during* the
  // in-flight hibernation kill runs noteVisibilityResume before onExit arms the
  // wake. Sharing the guarded consume lets both the reveal hook and the
  // arm-time foreground check resume the pane exactly once.
  const consumeHibernatedAgentWake = (claimedProviderSessions?: Set<string>): string | null => {
    const target = hibernatedWakeTarget
    if (!target || disposed) {
      return null
    }
    if (deps.paneTransportsRef.current.get(pane.id) !== transport) {
      return null
    }
    const currentRecord = getSleepingRecordForPane(useAppStore.getState())?.record
    if (currentRecord !== target.record) {
      hibernatedWakeTarget = null
      pendingHibernatedWakeTarget = null
      return null
    }
    const currentPtyId = transport.getPtyId()
    // Why: a real pty:exit clears the transport's ptyId before onExit while a
    // reconcile-driven exit leaves it bound; both mean "nothing respawned since
    // hibernation". A different non-null id means another flow (e.g. an
    // intentional restart) already rebound the pane — its spawn wins.
    if (currentPtyId !== null && currentPtyId !== target.ptyId) {
      hibernatedWakeTarget = null
      pendingHibernatedWakeTarget = null
      return null
    }
    if (!wakeHibernatedAgentPane) {
      return null
    }
    const claimKey = getProviderSessionClaimKey(target.record)
    if (claimedProviderSessions?.has(claimKey)) {
      return null
    }
    // Why: one wake event can visit multiple mounted legacy/stable panes for
    // the same provider session. Claim synchronously before any spawn starts.
    claimedProviderSessions?.add(claimKey)
    hibernatedWakeTarget = null
    pendingHibernatedWakeTarget = null
    hibernatedWakeInFlightClaimKey = claimKey
    // Why: reveal is the wake signal for a hibernated pane. Resume the recorded
    // agent session (or fall back to a fresh shell) instead of leaving the
    // frozen frame with no PTY behind it.
    void wakeHibernatedAgentPane()
      .then((spawnedPtyId) => {
        if (!spawnedPtyId) {
          // Why: a transient replacement-spawn failure leaves the passive
          // record owned by this pane. Re-arm the exact target so a later
          // mobile open can retry instead of stranding the frozen session;
          // consume revalidates disposal, binding, PTY, and record identity.
          hibernatedWakeTarget = target
        }
      })
      .finally(() => {
        if (hibernatedWakeInFlightClaimKey === claimKey) {
          hibernatedWakeInFlightClaimKey = null
        }
      })
    return claimKey
  }
  const exitController = createPtyConnectionExitController({
    pane,
    manager,
    deps,
    cacheKey,
    getRuntimeEnvironmentId: () => runtimeEnvironmentId,
    getTransport: () => transport,
    resetRendererOrderedSeqForExit: (ptyId) => resetRendererOrderedSeqForPtyExit(ptyId),
    releaseCurrentPaneRuntime: () => {
      agentCompletionCoordinator.dispose()
      dropSideEffectFactConsumer()
      releaseHiddenRendererPtyDelivery()
      clearPanePtyFitBinding()
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
        hibernatedWakeTarget = { ptyId, record: sleepingRecordEntry.record }
        const pendingWakeMatches =
          pendingHibernatedWakeTarget?.ptyId === ptyId &&
          pendingHibernatedWakeTarget.record === sleepingRecordEntry.record
        if (pendingHibernatedWakeTarget && !pendingWakeMatches) {
          pendingHibernatedWakeTarget = null
        }
        if (deps.isVisibleRef.current || pendingWakeMatches) {
          // Why: a reveal (or a mobile wake) that raced this kill already ran
          // before the exit landed, so it saw nothing armed. Consume the wake
          // now (deferred off the exit handler) so the pane still resumes
          // without needing a second hide/reveal or wake event.
          queueMicrotask(() => {
            consumeHibernatedAgentWake()
          })
        }
      } else if (pendingHibernatedWakeTarget?.ptyId === ptyId) {
        pendingHibernatedWakeTarget = null
      }
    },
    getHadExistingPaneTransportAtConnect: () => hadExistingPaneTransportAtConnect,
    getRestoredPtyIdForTransport: () => restoredPtyIdForTransport,
    getLastTerminalInputAt: () => lastTerminalInputAt,
    getHasReceivedPtyOutput: () => hasReceivedPtyOutput
  })
  const { onExit } = exitController

  // Why: on app restart, restored Claude tabs may already be idle when we first
  // see their title. The agent status tracker only fires onBecameIdle for
  // working→idle transitions, so the cache timer would never start for these
  // sessions. We only allow this one-time seed for reattached PTYs; fresh
  // Claude launches also start idle, but they have no prompt cache yet.
  let hasConsideredInitialCacheTimerSeed = false
  let allowInitialIdleCacheSeed = false

  const resolveCurrentAgentStatusRouting = () => {
    const ptyId = activePanePtyBinding ?? transport.getPtyId()
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

    if (!hasConsideredInitialCacheTimerSeed) {
      hasConsideredInitialCacheTimerSeed = true
      const state = useAppStore.getState()
      if (
        shouldSeedCacheTimerOnInitialTitle({
          rawTitle,
          allowInitialIdleSeed: allowInitialIdleCacheSeed,
          existingTimerStartedAt: state.cacheTimerByKey[cacheKey],
          promptCacheTimerEnabled: state.settings?.promptCacheTimerEnabled ?? null
        })
      ) {
        deps.setCacheTimerStartedAt(cacheKey, Date.now())
      }
    }
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
  const reportPanePtyVisibility = (ptyId: string | null | undefined, visible: boolean): void => {
    if (!ptyId || isRemoteRuntimePtyId(ptyId)) {
      // Why: remote-runtime PTYs use a relay path outside main's local
      // renderer-visibility registry, so reporting them here is misleading.
      return
    }
    setRendererPtyVisibilityClaim(transport, ptyId, visible)
  }
  const bindActivePanePty = (
    ptyId: string,
    options: {
      seedInitialAgentStatus?: boolean
      updateTabPtyId?: 'always' | 'if-missing'
      replacePtyId?: string
      sampleVisibleForegroundAgent?: boolean
    } = {}
  ): void => {
    if (activePanePtyBinding && activePanePtyBinding !== ptyId) {
      reportPanePtyVisibility(activePanePtyBinding, false)
    }
    setPanePtyFitBinding(ptyId)
    activePanePtyBinding = ptyId
    reportPanePtyVisibility(ptyId, deps.isVisibleRef.current)
    // Why: record bind time on the spawn/attach chokepoint so the reconcile
    // guard knows this binding is newer than any pre-bind snapshot.
    activePanePtyBindingBoundAt = performance.now()
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
        preserveSuppressedTitleSideEffects(title, activeHookStatus)
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
      setFocusReportSuppressionForAgentCompletion(title, activeHookStatus?.agentType)
    }
    if (syncAgentTaskCompleteTrackingEnabled()) {
      agentCompletionCoordinator.observeClassifiedTitleCompletion(title)
    }
    // Why: some agent TUIs leave xterm renderer modes active after a turn.
    // Reset cursor everywhere, and Kitty keyboard state on native Windows.
    queueAgentIdleTerminalModeReset()
  }
  const onAgentBecameWorking = (): void => {
    suppressNativeWindowsIdleCodexFocusReports = false
    clearSuppressedTitleSideEffects()
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
    clearSuppressedTitleSideEffects()
    clearCommandInferredPaneAgent()
    requestKnownDroidReconfirmation()
    // Why: when the terminal title reverts to a plain shell (e.g., "bash", "zsh"),
    // the agent has exited. Clear any running cache timer so the sidebar doesn't
    // show a stale countdown for a tab that no longer has an active Claude session.
    deps.setCacheTimerStartedAt(cacheKey, null)
    clearTitleOnlyInterruptTimer()
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
    idleAgentTerminalModeReset = `${RESET_TERMINAL_CURSOR_STYLE}${RESET_KITTY_KEYBOARD_PROTOCOL}`
  }
  const shouldApplyNativeWindowsRewriteRefresh = isNativeWindowsConpty
  const shouldApplyWindowsRendererUnicodeRefresh = CLIENT_PLATFORM === 'win32'
  const shouldProtectNativeWindowsSynchronizedOutput = isNativeWindowsConpty
  let lastAgentStatusState = state.agentStatusByPaneKey[cacheKey]?.state
  let unsubscribeWindowsDoneTerminalModeReset: (() => void) | null = null
  if (isNativeWindowsConpty) {
    const initialAgentStatus = state.agentStatusByPaneKey[cacheKey]
    if (
      !initialAgentStatus &&
      paneStartup?.telemetry?.launch_source === 'sidebar' &&
      paneStartup.telemetry.request_kind === 'resume' &&
      (paneStartup.launchAgent === 'codex' || paneStartup.telemetry.agent_kind === 'codex')
    ) {
      // Why: history resumes open on a completed Codex composer without a done
      // row, so arm the same Windows stale-focus guard until work starts again.
      suppressNativeWindowsIdleCodexFocusReports = true
    }
    if (initialAgentStatus?.state === 'done') {
      setFocusReportSuppressionForAgentCompletion(undefined, initialAgentStatus.agentType)
    }
    unsubscribeWindowsDoneTerminalModeReset = useAppStore.subscribe((nextState) => {
      const nextAgentStatus = nextState.agentStatusByPaneKey[cacheKey]
      const nextAgentStatusState = nextAgentStatus?.state
      if (nextAgentStatusState === 'done') {
        setFocusReportSuppressionForAgentCompletion(undefined, nextAgentStatus.agentType)
        if (lastAgentStatusState !== 'done') {
          queueAgentIdleTerminalModeReset()
        }
      } else if (nextAgentStatusState) {
        suppressNativeWindowsIdleCodexFocusReports = false
      }
      lastAgentStatusState = nextAgentStatusState
    })
  }

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
  handleRendererOwnedAgentStatus = (payload): void => {
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
  let lastTerminalInputAt = Number.NEGATIVE_INFINITY
  let hasReceivedPtyOutput = false
  let deferredReattachLiveData:
    | {
        data: string
        ptyId: string | null
        streamGeneration: number
        meta?: PtyDataMeta
        ackCredit?: () => void
      }[]
    | null = null
  let deferredReattachLiveDataChars = 0
  let reattachLiveDataDeferralDepth = 0
  let deferredReattachLiveDataOwners = new Map<number, { failed: boolean }>()
  let transportStreamGeneration = 0
  const MAX_DEFERRED_REATTACH_LIVE_CHARS = 512 * 1024
  const MAX_DEFERRED_REATTACH_LIVE_CHUNKS = 1_024
  const markTerminalInputSent = (): void => {
    lastTerminalInputAt = performance.now()
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
    if (disposed || (!isHiddenDeliveryGateManagedPty(ptyId) && remoteOutputPausedPtyId !== ptyId)) {
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
    if (disposed || (!isHiddenDeliveryGateManagedPty(ptyId) && remoteOutputPausedPtyId !== ptyId)) {
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
  let transportConnectInFlightSince: number | null = null
  // Why a grace window instead of a plain flag: a connect that never settles
  // (SSH RPC timeout class, wedged daemon call) would otherwise suppress
  // input-triggered recovery FOREVER — and such a pane has no output flowing,
  // so no other detector can fire. Past the grace, undeliverable input may
  // recover again; the transport's destroyed-check no longer kills a
  // pre-existing session when a late reattach resolves, so a remount racing
  // a slow-but-alive connect costs a wasted view rebuild, not a shell.
  const TRANSPORT_CONNECT_SETTLE_GRACE_MS = 60_000
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
    const connectStillSettling =
      transportConnectInFlightSince !== null &&
      Date.now() - transportConnectInFlightSince < TRANSPORT_CONNECT_SETTLE_GRACE_MS
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
      suppressNativeWindowsIdleCodexFocusReports &&
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
            observeTitleOnlyInterrupt()
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

  const resizeForwardingController = createPtyConnectionResizeForwardingController({
    pane,
    deps,
    transport,
    shouldSkipTerminalResize: () =>
      suppressStructuralReplayPtyResize || suppressViewportClaimTerminalResize
  })
  const {
    forward: forwardPtyResize,
    shouldSuppressDesktopResize: shouldSuppressDesktopPtyResize,
    isAuthoritative: isRendererPtyResizeAuthoritative
  } = resizeForwardingController

  // Why: a rewrite chunk can enter AND exit the alternate screen in one parse
  // (fast-quitting TUI), netting buffer.active.type back to 'normal'; counting
  // switches keeps those redraws visible to the atlas-recovery check.
  let alternateScreenBufferSwitches = 0
  const onBufferChangeDisposable = pane.terminal.buffer.onBufferChange?.(() => {
    alternateScreenBufferSwitches += 1
  })

  let readProposedTerminalGrid: () => { cols: number; rows: number } | null = () => null
  const sizeReassertionController = createPtyConnectionSizeReassertionController({
    pane,
    deps,
    transport,
    isDisposed: () => disposed,
    shouldSuppressDesktopResize: shouldSuppressDesktopPtyResize,
    forwardResize: forwardPtyResize,
    readProposedGrid: () => readProposedTerminalGrid()
  })
  const paneGeometryController = createPtyConnectionPaneGeometryController({
    pane,
    deps,
    transport,
    isDisposed: () => disposed,
    shouldSuppressDesktopResize: shouldSuppressDesktopPtyResize,
    requestPtySizeReassertion: sizeReassertionController.request,
    resizeTerminalForViewportClaim: (cols, rows) => {
      suppressViewportClaimTerminalResize = true
      try {
        pane.terminal.resize(cols, rows)
      } finally {
        suppressViewportClaimTerminalResize = false
      }
    }
  })
  readProposedTerminalGrid = paneGeometryController.readProposedGrid
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
    if (disposed) {
      return
    }
    safeFit(pane)
    const cols = pane.terminal.cols
    const rows = pane.terminal.rows

    // Why: if fitAddon resolved to 0×0, the container likely has no layout
    // dimensions (display:none, unmounted, or zero-size parent). Surface a
    // diagnostic so the user sees something instead of a blank pane.
    // Gate on visibility: background/hidden tabs (orchestration workers, CLI
    // `terminal create` without --focus) legitimately connect at 0×0 because
    // safeFit skips fitting unmeasurable panes; they refit via the pane resize
    // observer once shown, so the diagnostic must not fire while hidden.
    if ((cols === 0 || rows === 0) && deps.isVisibleRef.current) {
      deps.onPtyErrorRef?.current?.(pane.id, createTerminalZeroDimensionsMessage(cols, rows))
    }

    const reportError = (message: string): void => {
      // Why: the transport connect can reject asynchronously after the pane has been
      // disposed (e.g. its workspace was deleted) — dropping a late error avoids a toast
      // racing the unmount. Mirrors the connect scheduler's disposed guard above.
      if (disposed) {
        return
      }
      if (isWorktreeRemovalFenceError(message)) {
        // Why: main fences a spawn/reattach whose worktree (or an overlapping
        // parent/child root) is being deleted. That is expected teardown, not a
        // user-facing failure — the pane unmounts once removal completes, so never
        // surface the raw fence error. Covers the parent-removal-fences-child case
        // that startFreshSpawn's own-worktree isDeleting skip cannot see.
        return
      }
      deps.onPtyErrorRef?.current?.(pane.id, message)
    }

    const {
      state: serializerControllerState,
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
      getRendererOrderedFrame: () => ({
        ptyId: rendererOrderedPtyId,
        seq: rendererOrderedSeq
      })
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
    cleanupStartupDelivery = () => {
      disposeStartupDraftController()
      disposeStartupCommandDelivery()
    }
    wakeHibernatedAgentPane = () => startFreshColdRestoreAgentResume()

    let freshSpawnFollowResetDisposables: IDisposable[] = []
    cancelFreshSpawnFollowReset = (): void => {
      for (const disposable of freshSpawnFollowResetDisposables) {
        disposable.dispose()
      }
      freshSpawnFollowResetDisposables = []
    }
    const resetFreshSpawnFollowOutput = (): void => {
      cancelFreshSpawnFollowReset()
      markTerminalFollowOutput(pane.terminal)
      let nativeFollowResetComplete = false
      const tryResetNativeFollow = (): void => {
        if (
          disposed ||
          getTerminalScrollIntentKind(pane.terminal) !== 'followOutput' ||
          deferTerminalGeometryMutationDuringRebuild(
            pane.terminal,
            'fresh-spawn-follow-reset',
            tryResetNativeFollow
          )
        ) {
          return
        }
        try {
          pane.terminal.scrollToBottom()
          nativeFollowResetComplete = true
          cancelFreshSpawnFollowReset()
        } catch (err) {
          if (!(err instanceof TypeError && /dimensions/.test(err.message))) {
            cancelFreshSpawnFollowReset()
            throw err
          }
        }
      }
      tryResetNativeFollow()
      if (!nativeFollowResetComplete) {
        // Why: xterm's browser viewport can reject scrolling while its renderer
        // is detached; the first render/resize is the earliest safe native retry.
        freshSpawnFollowResetDisposables = [
          pane.terminal.onRender(tryResetNativeFollow),
          pane.terminal.onResize(tryResetNativeFollow)
        ]
      }
    }

    const startFreshSpawn = (
      startupOverride?: PendingStartupCommand | null,
      options: FreshSpawnOptions = {}
    ): Promise<string | null> => {
      if (isLegacyWorkerAutomaticResumeBlocked()) {
        return Promise.resolve(null)
      }
      if (useAppStore.getState().deleteStateByWorktreeId?.[deps.worktreeId]?.isDeleting) {
        // Why: the worktree is being deleted; its PTYs were just killed for the
        // filesystem teardown. A fresh shell must not spawn into a directory the
        // removal is about to delete (main fences it anyway), and the pane is
        // about to unmount — so skip the doomed respawn instead of racing it.
        return Promise.resolve(null)
      }
      clearPaneMode2031State()
      clearHiddenOutputRestoreState()
      // Why: a canceled old replay clear can preserve xterm's native
      // isUserScrolling flag. A replacement shell must start in follow mode.
      resetFreshSpawnFollowOutput()
      // Why: a fresh spawn is a new process with kitty keyboard flags at
      // zero. The exit-handler reset alone is not enough: a late exit from a
      // replaced PTY takes the stale-transport early return and skips it, so
      // a restart-in-place would leak the old TUI's flags into a fresh shell.
      kittyKeyboardModes.reset()
      prepareFreshShellViewportForSpawn(options)
      if (connectionId && startupOverride?.command) {
        // Why: SSH providers use `command` only as spawn metadata; the renderer
        // must still submit the resume command to the fresh remote shell.
        setPendingStartupCommand({ command: startupOverride.command })
      }
      const coldRestoreOverride =
        startupOverride && 'launchConfig' in startupOverride
          ? (startupOverride as ColdRestoreAgentResumeStartup)
          : null
      // Why: pre-signal the main process so its cooperation gate suppresses
      // the daemon-snapshot seed for this paneKey. We issue declare and the
      // spawn back-to-back without awaiting, because Electron's
      // ipcRenderer→ipcMain channel preserves order across consecutive invoke
      // calls from the same renderer. The cooperation gate at pty:spawn time
      // sees pendingByPaneKey populated. Settle/clear later echoes the gen
      // token captured here. See docs/mobile-prefer-renderer-scrollback.md.
      const preSignalPromise = runtimeEnvironmentId
        ? Promise.resolve(null)
        : getClientRuntime()
            .terminal.declarePendingPaneSerializer(cacheKey)
            .catch(() => null)

      transportConnectInFlightSince = Date.now()
      const outputCallbacks = captureTransportOutputCallbacks(reportError)
      const spawnedRaw = transport.connect({
        url: '',
        cols,
        rows,
        ...(startupOverride?.command ? { command: startupOverride.command } : {}),
        ...(startupOverride?.env
          ? { env: mergeStartupEnvWithPaneIdentity(startupOverride.env) }
          : {}),
        ...(coldRestoreOverride ? { launchConfig: coldRestoreOverride.launchConfig } : {}),
        ...(coldRestoreOverride
          ? { resumeProviderSession: coldRestoreOverride.resumeProviderSession }
          : {}),
        ...(coldRestoreOverride ? { launchToken: coldRestoreOverride.launchToken } : {}),
        ...(coldRestoreOverride ? { launchAgent: coldRestoreOverride.agent } : {}),
        ...(shouldDeclareHiddenAtSpawn() ? { initiallyHidden: true } : {}),
        callbacks: outputCallbacks.callbacks
      })

      void Promise.resolve(spawnedRaw)
        .catch(() => null)
        .finally(() => {
          transportConnectInFlightSince = null
        })
      const trackedPromise: Promise<string | null> = Promise.resolve(spawnedRaw)
        .then(async (spawnedPtyId) => {
          if (outputCallbacks.generation !== transportStreamGeneration) {
            const gen = await preSignalPromise
            if (typeof gen === 'number') {
              void getClientRuntime()
                .terminal.clearPendingPaneSerializer(cacheKey, gen)
                .catch(() => {})
            }
            return null
          }
          const resolvedPtyId =
            spawnedPtyId && typeof spawnedPtyId === 'object' && 'id' in spawnedPtyId
              ? spawnedPtyId.id
              : typeof spawnedPtyId === 'string'
                ? spawnedPtyId
                : transport.getPtyId()
          if (resolvedPtyId && !claimCapturedDirectSshRetryPty(resolvedPtyId)) {
            return null
          }
          if (spawnedPtyId && typeof spawnedPtyId === 'object' && 'id' in spawnedPtyId) {
            registerEffectiveLaunchConfig(spawnedPtyId.launchConfig, {
              ...(coldRestoreOverride ? { launchToken: coldRestoreOverride.launchToken } : {}),
              ...(coldRestoreOverride ? { launchAgent: coldRestoreOverride.agent } : {})
            })
          }
          if (resolvedPtyId) {
            if (
              spawnedPtyId &&
              typeof spawnedPtyId === 'object' &&
              spawnedPtyId.startupCwdFallback?.kind === 'worktree'
            ) {
              writeTerminalOutput(pane.terminal, STARTUP_CWD_FALLBACK_NOTICE, {
                foreground: shouldWritePtyOutputForeground(deps.isVisibleRef.current)
              })
            }
            if (
              spawnedPtyId &&
              typeof spawnedPtyId === 'object' &&
              spawnedPtyId.agentResumeUnavailable
            ) {
              // Why: main dropped the resume argv, so this pane is a NEW session —
              // the plain restored banner would claim the old one came back.
              showSessionRestoredBanner('resume-unavailable')
            } else if (coldRestoreOverride?.hasSleepingRecord) {
              showSessionRestoredBanner()
            }
            clearSleepingRecordAfterColdRestoreSpawn(coldRestoreOverride)
          } else if (
            paneStartup?.launchConfig ||
            (startupOverride && 'launchConfig' in startupOverride)
          ) {
            // Why: delayed draft/follow-up delivery keys off this launch
            // registry. If spawn produced no PTY, the launch is no longer a
            // viable delivery target and must not wait for a future pane.
            clearRegisteredStartupLaunchConfig()
          }
          if (
            resolvedPtyId &&
            spawnedPtyId &&
            typeof spawnedPtyId === 'object' &&
            'id' in spawnedPtyId &&
            activePanePtyBinding !== resolvedPtyId &&
            transport.getPtyId() === resolvedPtyId
          ) {
            // Why: daemon createOrAttach can turn an apparent fresh spawn into
            // a reattach; the transport skips onPtySpawn there to preserve recency.
            bindActivePanePty(resolvedPtyId, {
              updateTabPtyId: 'if-missing',
              sampleVisibleForegroundAgent: true
            })
          }
          if (resolvedPtyId) {
            reconcileSpawnedPtySize(resolvedPtyId, cols, rows)
          }
          const gen = await preSignalPromise
          if (resolvedPtyId && (typeof gen === 'number' || isRemoteRuntimePtyId(resolvedPtyId))) {
            if (!isRemoteRuntimePtyId(resolvedPtyId) || !hasPtySerializer(resolvedPtyId)) {
              registerPaneSerializerFor(resolvedPtyId)
            }
            if (typeof gen === 'number') {
              void getClientRuntime()
                .terminal.settlePaneSerializer(cacheKey, gen)
                .catch(() => {})
            }
          } else if (typeof gen === 'number') {
            void getClientRuntime()
              .terminal.clearPendingPaneSerializer(cacheKey, gen)
              .catch(() => {})
          }
          if (resolvedPtyId && connectionId) {
            schedulePendingStartupCommandDelivery()
          }
          return resolvedPtyId
        })
        .catch(async () => {
          if (paneStartup?.launchConfig || (startupOverride && 'launchConfig' in startupOverride)) {
            clearRegisteredStartupLaunchConfig()
          }
          const gen = await preSignalPromise
          if (typeof gen === 'number') {
            void getClientRuntime()
              .terminal.clearPendingPaneSerializer(cacheKey, gen)
              .catch(() => {})
          }
          return null
        })
        .finally(() => {
          if (pendingSpawnByPaneKey.get(pendingSpawnKey) === trackedPromise) {
            pendingSpawnByPaneKey.delete(pendingSpawnKey)
          }
        })
      armDirectSshPaneRetryTimeout(trackedPromise, directSshRetryAttempt)
      void trackedPromise.then((spawnedPtyId) => {
        if (spawnedPtyId) {
          return
        }
        queueMicrotask(() => {
          if (disposed || transport.getPtyId() || pendingSpawnByPaneKey.has(pendingSpawnKey)) {
            return
          }
          settleDirectSshPaneRetryAttempt(directSshRetryAttempt, 'failed')
        })
      })
      // Why: split panes in the same tab can spawn concurrently. Key by pane
      // as well as tab so a remount cannot attach to a sibling setup pane's PTY.
      pendingSpawnByPaneKey.set(pendingSpawnKey, trackedPromise)
      return trackedPromise
    }

    let foregroundRefreshRiskScanTail = ''

    function trailingIncompleteCsiSequence(data: string): string {
      const escapeIndex = data.lastIndexOf('\x1b')
      if (escapeIndex === -1) {
        return ''
      }
      const tail = data.slice(escapeIndex)
      if (tail === '\x1b') {
        return tail
      }
      if (!tail.startsWith('\x1b[')) {
        return ''
      }
      for (let index = 2; index < tail.length; index++) {
        const code = tail.charCodeAt(index)
        if (code >= 0x40 && code <= 0x7e) {
          return ''
        }
      }
      return tail.slice(-TERMINAL_RENDERER_RISK_SCAN_TAIL_CHARS)
    }

    function foregroundRendererRiskOutputPrefersRenderRefresh(data: string): boolean {
      if (!data) {
        return false
      }
      const scanData = foregroundRefreshRiskScanTail
        ? `${foregroundRefreshRiskScanTail}${data}`
        : data
      const prefersRefresh =
        (scanData.includes('\x1b[') || containsNonAsciiOutput(scanData)) &&
        terminalOutputPrefersRenderRefresh(scanData)
      foregroundRefreshRiskScanTail = trailingIncompleteCsiSequence(scanData)
      return prefersRefresh
    }

    function resetHiddenRendererRiskState(ptyId: string | null = null): void {
      hiddenRiskPtyId = ptyId
      hiddenSynchronizedOutputActive = false
      hiddenSynchronizedOutputMarkerTail = ''
      hiddenRewriteChunkEndedWithCarriageReturn = false
      hiddenRewriteCsiScanTail = ''
    }

    function ensureHiddenRendererRiskStateForCurrentPty(): void {
      const ptyId = transport.getPtyId()
      if (hiddenRiskPtyId === ptyId) {
        return
      }
      resetHiddenRendererRiskState(ptyId)
    }

    function resetSkippedHiddenRendererRiskState(): void {
      // Why: skipped/backlog bytes were not parsed by xterm; reset any live hidden
      // frame instead of letting dropped DEC starts make later plain bytes risky.
      resetHiddenRendererRiskState(transport.getPtyId())
    }

    function hiddenSynchronizedOutputTouchesParsedFrame(data: string): boolean {
      const scanData = hiddenSynchronizedOutputMarkerTail
        ? `${hiddenSynchronizedOutputMarkerTail}${data}`
        : data
      const currentChunkStartIndex = scanData.length - data.length
      let active = hiddenSynchronizedOutputActive
      let touchesParsedFrame = active && data.length > 0
      let offset = 0

      while (offset < scanData.length) {
        const startIndex = scanData.indexOf(SYNCHRONIZED_OUTPUT_START_SEQUENCE, offset)
        const endIndex = scanData.indexOf(SYNCHRONIZED_OUTPUT_END_SEQUENCE, offset)
        if (startIndex === -1 && endIndex === -1) {
          break
        }
        if (endIndex !== -1 && (startIndex === -1 || endIndex < startIndex)) {
          if (
            active &&
            endIndex + SYNCHRONIZED_OUTPUT_END_SEQUENCE.length > currentChunkStartIndex
          ) {
            touchesParsedFrame = true
          }
          active = false
          offset = endIndex + SYNCHRONIZED_OUTPUT_END_SEQUENCE.length
          continue
        }
        if (startIndex !== -1) {
          active = true
          if (startIndex + SYNCHRONIZED_OUTPUT_START_SEQUENCE.length > currentChunkStartIndex) {
            touchesParsedFrame = true
          }
          offset = startIndex + SYNCHRONIZED_OUTPUT_START_SEQUENCE.length
          continue
        }
      }

      if (active && data.length > 0) {
        touchesParsedFrame = true
      }
      hiddenSynchronizedOutputActive = active
      hiddenSynchronizedOutputMarkerTail = scanData.slice(-SYNCHRONIZED_OUTPUT_MARKER_TAIL_CHARS)
      return touchesParsedFrame
    }

    function hiddenTuiRedrawOutputPrefersAtlasRecovery(data: string): boolean {
      if (!data) {
        return false
      }
      const scanData = hiddenRewriteCsiScanTail ? `${hiddenRewriteCsiScanTail}${data}` : data
      const decision = terminalRewriteOutputRenderRefreshDecision(data, {
        previousChunkEndsWithCarriageReturn: hiddenRewriteChunkEndedWithCarriageReturn,
        previousRewriteCsiScanTail: hiddenRewriteCsiScanTail
      })
      hiddenRewriteChunkEndedWithCarriageReturn = decision.nextChunkEndsWithCarriageReturn
      hiddenRewriteCsiScanTail = decision.nextRewriteCsiScanTail
      return decision.prefersRenderRefresh || containsCursorPositionSequence(scanData)
    }

    function hiddenOutputNeedsAtlasRecoveryAfterParse(data: string): boolean {
      if (!data) {
        return false
      }
      ensureHiddenRendererRiskStateForCurrentPty()
      const synchronizedOutputTouchesParsedFrame = hiddenSynchronizedOutputTouchesParsedFrame(data)
      const tuiRedrawOutputPrefersAtlasRecovery = hiddenTuiRedrawOutputPrefersAtlasRecovery(data)
      return synchronizedOutputTouchesParsedFrame || tuiRedrawOutputPrefersAtlasRecovery
    }

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

    const consumeRestoredViewportBlankingMarker = (): boolean => {
      return deps.restoredViewportBlankingPanesRef?.current.delete(pane.id) ?? false
    }

    const writeFreshShellViewportBlanking = (rows = pane.terminal.rows): void => {
      writeReplayData(buildFreshShellViewportBlankingSequence(rows))
    }

    const prepareFreshShellViewportForSpawn = (options: FreshSpawnOptions): void => {
      const hadRestoredViewport = consumeRestoredViewportBlankingMarker()
      if (!options.forceBlankRestoredViewport && !hadRestoredViewport) {
        return
      }
      // Why: fresh Windows ConPTY output paints at screen coordinates, so
      // restored rows must leave the viewport before the first prompt redraw.
      writeFreshShellViewportBlanking()
    }

    const sendFocusedReattachFocusInAfterReplay = (
      expectedPtyId: string | null = transport.getPtyId(),
      expectedStreamGeneration = transportStreamGeneration
    ): void => {
      const scheduledGeneration = getReplayPayloadSignalGeneration()
      void waitForTerminalOutputParsed(pane.terminal).then(() => {
        const currentPtyId = transport.getPtyId()
        if (
          disposed ||
          expectedStreamGeneration !== transportStreamGeneration ||
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

    type PendingReplayData = {
      data: string
      clearBeforeReplay: boolean
      ptyId: string | null
      generation: number
      streamGeneration: number
      pendingEscapeTailAnsi?: string
    }

    let pendingReplayData: PendingReplayData | null = null
    let replayPayloadGeneration = 0
    let replayDrainQueued = false
    const drainReplayDataQueue = async (
      expectedPtyId: string | null,
      expectedStreamGeneration: number
    ): Promise<boolean> => {
      let appliedCurrentPayload = false
      while (pendingReplayData !== null) {
        if (
          pendingReplayData.ptyId !== expectedPtyId ||
          pendingReplayData.streamGeneration !== expectedStreamGeneration
        ) {
          return false
        }
        if (
          transport.getPtyId() !== expectedPtyId ||
          transportStreamGeneration !== expectedStreamGeneration
        ) {
          pendingReplayData = null
          return false
        }
        const payload = pendingReplayData
        const { data, clearBeforeReplay, pendingEscapeTailAnsi } = payload
        pendingReplayData = null
        const isCurrentPayload = (): boolean =>
          !disposed &&
          payload.generation === replayPayloadGeneration &&
          payload.streamGeneration === transportStreamGeneration &&
          transport.getPtyId() === payload.ptyId
        if (!isCurrentPayload()) {
          continue
        }
        // Relay replay buffers may overlap with content already rendered in
        // xterm. Local eager replay decides this earlier so metadata-only frames
        // can keep restored scrollback while still using the replay guard.
        if (clearBeforeReplay) {
          await writeReplayDataAsync('\x1b[2J\x1b[3J\x1b[H')
          if (!isCurrentPayload()) {
            continue
          }
        }
        if (clearBeforeReplay || data.length > 0) {
          // Why: an empty clearing frame is still an authoritative repaint and
          // must clear a stale agent signal from an earlier payload.
          rememberReattachPayloadAgentSignal(data, { fullScreenReplay: clearBeforeReplay })
        }
        // Why: replayed application bytes carry the live TUI's kitty keyboard
        // negotiation; the mirror must re-arm from them after a reload. Replay
        // semantics: relay reconnects redeliver the same window, so pushes
        // apply as sets to keep the mirrored stack from accumulating frames.
        kittyKeyboardModes.scanReplay(data)
        await writeReplayDataAsync(data)
        if (!isCurrentPayload()) {
          continue
        }
        if (clearBeforeReplay || data.length > 0) {
          await writeReplayDataAsync(reattachReplayResetSequence(data))
          if (!isCurrentPayload()) {
            continue
          }
          sendFocusedReattachFocusInAfterReplay(payload.ptyId, payload.streamGeneration)
        }
        // Why: the daemon could not serialize a PTY read that ended mid-escape,
        // so the emulator shipped the dangling partial separately. Write it LAST
        // — after the reset, whose ESC would otherwise abort it — so the next
        // live chunk completes the sequence instead of rendering literally
        // (#7329). Guarded so a later ESC cannot leave the parser wedged.
        if (pendingEscapeTailAnsi) {
          await writeReplayDataAsync(pendingEscapeTailAnsi)
        }
        if (!isCurrentPayload()) {
          continue
        }
        // Why: remote-runtime snapshots can arrive after WebGL attached to an
        // empty buffer; rebuilding after replay parses seeds the glyph atlas
        // from the now-populated xterm state.
        manager.rebuildPaneWebgl(pane.id)
        appliedCurrentPayload = true
      }
      return appliedCurrentPayload
    }
    const scheduleReplayDataDrain = (): void => {
      if (replayDrainQueued) {
        return
      }
      const scheduledPtyId = pendingReplayData?.ptyId ?? null
      replayDrainQueued = true
      // Why: live bytes are newer than the authoritative replay frame. Hold
      // them until clear + replay + reset have all parsed, or replay can erase them.
      const scheduledStreamGeneration =
        pendingReplayData?.streamGeneration ?? transportStreamGeneration
      beginReattachLiveDataDeferral(scheduledStreamGeneration)
      let replayCompleted = false
      serializerControllerState.replayWriteQueue = serializerControllerState.replayWriteQueue
        .catch(() => undefined)
        .then(() =>
          structuralReplayCoordinator.run(
            async () => {
              replayCompleted = await drainReplayDataQueue(
                scheduledPtyId,
                scheduledStreamGeneration
              )
            },
            {
              shouldRestore: () =>
                !disposed &&
                transport.getPtyId() === scheduledPtyId &&
                transportStreamGeneration === scheduledStreamGeneration
            }
          )
        )
        .then(() => {
          replayCompleted &&= !disposed && transport.getPtyId() === scheduledPtyId
        })
        .finally(() => {
          replayDrainQueued = false
          if (pendingReplayData !== null) {
            // Why: preserve the PTY identity captured when the callback fired;
            // re-reading it here could retag stale bytes for a replacement PTY.
            scheduleReplayDataDrain()
          }
          finishReattachLiveDataDeferral(replayCompleted, scheduledStreamGeneration)
        })
    }
    const replayDataCallback = (
      data: string,
      meta: { clearBeforeReplay?: boolean; pendingEscapeTailAnsi?: string } = {},
      streamGeneration = transportStreamGeneration
    ): void => {
      pendingReplayData = {
        data,
        clearBeforeReplay: meta.clearBeforeReplay !== false,
        ptyId: transport.getPtyId(),
        generation: (replayPayloadGeneration += 1),
        streamGeneration,
        ...(meta.pendingEscapeTailAnsi ? { pendingEscapeTailAnsi: meta.pendingEscapeTailAnsi } : {})
      }
      scheduleReplayDataDrain()
    }

    const captureTransportOutputCallbacks = (onError: (message: string) => void) => {
      // Why: a new stream generation cannot inherit an old replay's pending
      // destination-grid fit or keep its live-data waiter open.
      pendingHiddenSnapshotFit?.cancel()
      pendingHiddenSnapshotFit = null
      pendingReattachFit?.cancel()
      pendingReattachFit = null
      const generation = (transportStreamGeneration += 1)
      const isCurrent = (): boolean => !disposed && generation === transportStreamGeneration
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

    type PendingHiddenOutputRestoreChunk = {
      data: string
      seq?: number
      rawLength?: number
    }

    let hiddenOutputRestoreNeeded = false
    let hiddenOutputRestoreInFlight: Promise<void> | null = null
    let hiddenOutputRestorePendingChunks: PendingHiddenOutputRestoreChunk[] = []
    let hiddenOutputRestorePendingChars = 0
    let hiddenOutputRestorePendingOverflow = false
    let hiddenOutputRestoreFreshSnapshotNeeded = false
    let hiddenOutputRestoreRetryDeferred = false
    let hiddenOutputRestoreScheduled = false
    let hiddenOutputRestoreDeferredRetryTimer: ReturnType<typeof setTimeout> | null = null
    let hiddenOutputRestoreForegroundDeadlineTimer: ReturnType<typeof setTimeout> | null = null
    let hiddenOutputRestoreDeferredRetryAttempts = 0
    let hiddenOutputSnapshotScrollRestore: {
      ptyId: string | null
      generation: number
      valid: boolean
      started: boolean
    } | null = null
    // Why: hidden recovery state belongs to one PTY stream. Reattach/restart
    // can reuse the pane object for a different session before visibility.
    let hiddenOutputRestorePtyId: string | null = null
    // One recovery re-kick per xterm instance. Generation-aware cooldown and
    // window-cap retries keep a fresh-but-wedged replacement from fossilizing.
    let certifiedDeadRestoreRecoveryRequested = false
    let hiddenOutputRestoreGeneration = 0
    // Flood-backpressure suppression (HIDDEN_OUTPUT_RESTORE_FLOOD_SUPPRESS_MS).
    let hiddenOutputRestoreFloodSuppressedUntil = 0
    // Why: queued replay writes still paint after deadline abandonment; the
    // fallback drain must not write snapshot-covered live bytes a second time.
    let hiddenOutputRestoreReplayingSnapshot: {
      seq?: number
      pendingDeliveryStartSeq?: number
    } | null = null
    let hiddenOutputRestoreFloodRepaintTimer: ReturnType<typeof setTimeout> | null = null
    // Why: after a snapshot restore, main can still drain ACK-backlog chunks
    // whose bytes the snapshot already covers — writing them unguarded
    // duplicates visible output. Track the restored baseline seq (per PTY)
    // and the expected next chunk start so dataCallback can drop/slice
    // overlaps and detect seq gaps from main-side pending-cap trims whose
    // one-shot marker was already consumed.
    let restoredSnapshotBaselineSeq: number | null = null
    let restoredSnapshotBaselinePtyId: string | null = null
    let restoredSnapshotExpectedStartSeq: number | null = null
    // Why: main samples its pending renderer-delivery queue with the snapshot.
    // Chunks at or below this seq can never be backlog duplicates (delivery is
    // once-and-in-order), so the dedupe window is (windowStart, baseline].
    let restoredSnapshotDeliveryWindowStartSeq: number | null = null

    function setRestoredSnapshotBaseline(
      ptyId: string,
      snapshot: { seq?: number; pendingDeliveryStartSeq?: number }
    ): void {
      if (typeof snapshot.seq !== 'number') {
        clearRestoredSnapshotBaseline()
        return
      }
      const windowStartSeq =
        typeof snapshot.pendingDeliveryStartSeq === 'number'
          ? Math.min(snapshot.pendingDeliveryStartSeq, snapshot.seq)
          : null
      if (windowStartSeq !== null && windowStartSeq >= snapshot.seq) {
        // Why: main reported an empty undelivered backlog — no chunk at or
        // below the snapshot seq can ever arrive again (delivery is once and
        // in order) and a future pending-cap trim re-arms the out-of-band
        // marker. Arming a baseline anyway would misread live chunks from a
        // foreign seq domain (restarted counter / synthetic injection) as
        // duplicates or trim gaps and silently drop genuinely-new output.
        clearRestoredSnapshotBaseline()
        return
      }
      restoredSnapshotBaselineSeq = snapshot.seq
      restoredSnapshotBaselinePtyId = ptyId
      restoredSnapshotExpectedStartSeq = snapshot.seq
      restoredSnapshotDeliveryWindowStartSeq = windowStartSeq
    }

    function clearRestoredSnapshotBaseline(): void {
      restoredSnapshotBaselineSeq = null
      restoredSnapshotBaselinePtyId = null
      restoredSnapshotExpectedStartSeq = null
      restoredSnapshotDeliveryWindowStartSeq = null
    }
    let foregroundImmediateBudgetChars = 0
    let foregroundImmediateBudgetWindowStart = 0
    let foregroundRewriteChunkEndedWithCarriageReturn = false
    let foregroundRewriteCsiScanTail = ''
    let mode2031ReplyScanState = INITIAL_MODE_2031_REPLY_SCAN_STATE
    const shouldSnapshotHiddenCodexOutput = shouldKeepHiddenStartupRendererQueriesLive(paneStartup)
    let hiddenStartupRendererQueryPending = ''
    let hiddenRendererStateDirty = false
    let hiddenRiskPtyId: string | null = null
    let hiddenSynchronizedOutputActive = false
    let hiddenSynchronizedOutputMarkerTail = ''
    let hiddenRewriteChunkEndedWithCarriageReturn = false
    let hiddenRewriteCsiScanTail = ''
    let rendererOrderedPtyId: string | null = null
    let rendererOrderedSeq: number | null = null
    let rendererChannelSeqPtyId: string | null = null
    let rendererChannelSeq: number | null = null

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

    // ── Hidden-delivery gate sync (Phase 4) ─────────────────────────────
    // Why: marks this pane's PTY hidden in main while no visible view needs
    // its bytes; main then drops delivery after model ingestion and reveal
    // restores from the snapshot. The marked id is tracked locally so PTY
    // changes (reattach/restart) can never leave a stale id gated.
    let hiddenDeliverySyncedPtyId: string | null = null
    let releaseHiddenDeliveryClaim: (() => void) | null = null
    let modelRestoreSubscribedPtyId: string | null = null
    let unregisterModelRestoreNeeded: (() => void) | null = null

    function isHiddenOutputRestoreFloodSuppressed(): boolean {
      return Date.now() < hiddenOutputRestoreFloodSuppressedUntil
    }

    // True when a drop/gap signal on a visible pane is attributable to this
    // pane's OWN restore backpressure (a restore is replaying right now, or
    // one was just cut off for outrunning the stream). Such signals must not
    // re-arm restores — that is the rc.7.perf feedback loop.
    function isForegroundRestoreBackpressureContext(): boolean {
      return (
        shouldWritePtyOutputForeground(deps.isVisibleRef.current) &&
        (hiddenOutputRestoreInFlight !== null || isHiddenOutputRestoreFloodSuppressed())
      )
    }

    function clearHiddenOutputRestoreFloodRepaintTimer(): void {
      if (hiddenOutputRestoreFloodRepaintTimer === null) {
        return
      }
      clearTimeout(hiddenOutputRestoreFloodRepaintTimer)
      hiddenOutputRestoreFloodRepaintTimer = null
    }
    cleanupHiddenOutputRestoreFloodRepaint = clearHiddenOutputRestoreFloodRepaintTimer

    function resetHiddenOutputRestoreFloodSuppression(): void {
      hiddenOutputRestoreFloodSuppressedUntil = 0
      clearHiddenOutputRestoreFloodRepaintTimer()
    }

    // Extends the suppression window; every backpressure signal resets the timer so the deferred repaint fires once, SUPPRESS_MS after the last signal.
    function noteHiddenOutputRestoreFloodBackpressure(): void {
      hiddenOutputRestoreFloodSuppressedUntil = Date.now() + HIDDEN_OUTPUT_RESTORE_FLOOD_SUPPRESS_MS
      const ptyId = transport.getPtyId()
      if (ptyId === null) {
        return
      }
      clearHiddenOutputRestoreFloodRepaintTimer()
      hiddenOutputRestoreFloodRepaintTimer = setTimeout(() => {
        hiddenOutputRestoreFloodRepaintTimer = null
        if (disposed || transport.getPtyId() !== ptyId) {
          return
        }
        // Why one repaint: flood-dropped bytes leave a gap the live stream can't heal; once quiet, one snapshot restore repaints from main's authoritative buffer.
        markHiddenOutputRestoreNeeded()
      }, HIDDEN_OUTPUT_RESTORE_FLOOD_SUPPRESS_MS)
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
        noteHiddenOutputRestoreFloodBackpressure()
        return
      }
      // Why: a marker during an in-flight restore means that snapshot may predate the drop, so a fresh one must follow; capture BEFORE the mark, which starts a restore synchronously on a visible pane.
      const restoreWasInFlight = hiddenOutputRestoreInFlight !== null
      markHiddenOutputRestoreNeeded()
      if (restoreWasInFlight) {
        hiddenOutputRestoreFreshSnapshotNeeded = true
      }
    }

    function syncModelRestoreNeededSubscription(ptyId: string | null): void {
      if (modelRestoreSubscribedPtyId === ptyId) {
        return
      }
      unregisterModelRestoreNeeded?.()
      unregisterModelRestoreNeeded = null
      modelRestoreSubscribedPtyId = ptyId
      // Why: markers exist only for PTYs whose bytes transit local main;
      // remote-runtime transports are structurally unaffected.
      if (!ptyId || isRemoteRuntimePtyId(ptyId)) {
        return
      }
      unregisterModelRestoreNeeded = registerPtyModelRestoreNeededHandler(
        ptyId,
        handleModelRestoreNeededMarker
      )
    }

    handleRemoteOutputPauseChanged = (paused, supported): void => {
      const ptyId = transport.getPtyId()
      if (!ptyId || !isRemoteRuntimePtyId(ptyId)) {
        return
      }
      if (!supported || !paused) {
        if (remoteOutputPausedPtyId === ptyId) {
          remoteOutputPausedPtyId = null
          if (!mainSideEffectAuthority) {
            dropSideEffectFactConsumer()
          }
        }
        if (supported && !paused && hiddenOutputRestorePtyId === ptyId) {
          requestHiddenOutputRestoreIfNeeded()
        }
        return
      }
      if (remoteOutputPausedPtyId !== ptyId) {
        remoteOutputPausedPtyId = ptyId
        registerSideEffectFactConsumerForPty(ptyId, true)
      }
      markHiddenOutputRestoreNeeded()
    }

    syncHiddenRendererPtyDelivery = (): void => {
      const ptyId = transport.getPtyId()
      syncModelRestoreNeededSubscription(ptyId)
      if (remoteOutputPausedPtyId !== null && remoteOutputPausedPtyId !== ptyId) {
        remoteOutputPausedPtyId = null
        if (!mainSideEffectAuthority) {
          dropSideEffectFactConsumer()
        }
      }
      if (isRemoteRuntimePtyId(ptyId) && canUseHiddenOutputSnapshot(ptyId)) {
        transport.setOutputPaused?.(
          !disposed && !shouldWritePtyOutputForeground(deps.isVisibleRef.current)
        )
        return
      }
      if (hiddenDeliverySyncedPtyId !== null && hiddenDeliverySyncedPtyId !== ptyId) {
        releaseHiddenDeliveryClaim?.()
        releaseHiddenDeliveryClaim = null
        hiddenDeliverySyncedPtyId = null
      }
      if (!isHiddenDeliveryGateManagedPty(ptyId) || !canUseHiddenOutputSnapshot(ptyId)) {
        return
      }
      const shouldHide = !disposed && !shouldWritePtyOutputForeground(deps.isVisibleRef.current)
      const isFirstSyncForPty = hiddenDeliverySyncedPtyId !== ptyId
      hiddenDeliverySyncedPtyId = ptyId
      if (shouldHide) {
        if (!releaseHiddenDeliveryClaim) {
          releaseHiddenDeliveryClaim = acquireHiddenRendererPtyDeliveryClaim(ptyId)
        }
      } else if (releaseHiddenDeliveryClaim) {
        releaseHiddenDeliveryClaim()
        releaseHiddenDeliveryClaim = null
      } else if (isFirstSyncForPty) {
        // Why: clear unconditionally on first sync — a stale main-side hidden bit can survive a renderer reload for daemon-backed PTYs that keep their session id.
        declareRendererPtyDeliveryVisible(ptyId)
      }
    }
    releaseHiddenRendererPtyDelivery = (): void => {
      transport.setOutputPaused?.(false)
      if (remoteOutputPausedPtyId !== null) {
        remoteOutputPausedPtyId = null
        if (!mainSideEffectAuthority) {
          dropSideEffectFactConsumer()
        }
      }
      releaseHiddenDeliveryClaim?.()
      releaseHiddenDeliveryClaim = null
      hiddenDeliverySyncedPtyId = null
      unregisterModelRestoreNeeded?.()
      unregisterModelRestoreNeeded = null
      modelRestoreSubscribedPtyId = null
    }

    function beforeTerminalOutputWrite(data: string): void {
      // Why: shaping must register before xterm parses the RTL bytes that need it.
      ensureArabicShapingJoinerForText(pane.terminal, data)
      recordTerminalOutput(pane.terminal)
    }

    function consumeForegroundImmediateBudget(dataLength: number): boolean {
      const now = performance.now()
      if (now - foregroundImmediateBudgetWindowStart > FOREGROUND_BUDGET_WINDOW_MS) {
        foregroundImmediateBudgetChars = 0
        foregroundImmediateBudgetWindowStart = now
      }
      if (foregroundImmediateBudgetChars + dataLength > FOREGROUND_IMMEDIATE_BUDGET_CHARS) {
        return false
      }
      foregroundImmediateBudgetChars += dataLength
      return true
    }

    function isActiveSplitPane(): boolean {
      if (!deps.isActiveRef.current) {
        return false
      }
      const activePane = manager.getActivePane?.() ?? null
      return activePane ? activePane.id === pane.id : true
    }

    function isLatencySensitiveForegroundOutput(data: string): boolean {
      if (!isActiveSplitPane()) {
        // Why: many visible split panes each emit tiny TUI frames; a shared budget keeps them live without letting aggregate xterm work starve typing in the active pane.
        if (data.includes('\x1b[')) {
          return false
        }
        return consumeInactiveForegroundImmediateBudget(data.length)
      }
      if (data.length <= FOREGROUND_THROUGHPUT_IMMEDIATE_CHARS) {
        return consumeForegroundImmediateBudget(data.length)
      }
      const recentInput =
        performance.now() - lastTerminalInputAt <= FOREGROUND_INTERACTIVE_REDRAW_WINDOW_MS
      if (
        recentInput &&
        data.length <= FOREGROUND_INTERACTIVE_REDRAW_CHARS &&
        data.includes('\x1b[')
      ) {
        return consumeForegroundImmediateBudget(data.length)
      }
      return false
    }

    function containsNonAsciiOutput(data: string): boolean {
      for (let index = 0; index < data.length; index++) {
        if (data.charCodeAt(index) > 0x7f) {
          return true
        }
      }
      return false
    }

    function containsWindowsRewriteControl(data: string): boolean {
      return data.includes('\r') || terminalRewriteOutputPrefersRenderRefresh(data)
    }

    function foregroundRewriteOutputPrefersRenderRefresh(data: string): boolean {
      const decision = terminalRewriteOutputRenderRefreshDecision(data, {
        previousChunkEndsWithCarriageReturn: foregroundRewriteChunkEndedWithCarriageReturn,
        previousRewriteCsiScanTail: foregroundRewriteCsiScanTail
      })
      foregroundRewriteChunkEndedWithCarriageReturn = decision.nextChunkEndsWithCarriageReturn
      foregroundRewriteCsiScanTail = decision.nextRewriteCsiScanTail
      return decision.prefersRenderRefresh
    }

    // Why: Vim-style rewrites leave stale WebGL glyphs until the atlas rebuilds; alt-screen membership is only authoritative post-parse (enter/exit can split chunks), so capture pre-parse and decide at parse completion.
    function alternateScreenRewriteAtlasRecoveryOnParsed(): () => void {
      const wasAlternateScreenBuffer = pane.terminal.buffer.active.type === 'alternate'
      const switchesBeforeParse = alternateScreenBufferSwitches
      return () => {
        if (
          wasAlternateScreenBuffer ||
          alternateScreenBufferSwitches !== switchesBeforeParse ||
          pane.terminal.buffer.active.type === 'alternate'
        ) {
          scheduleTerminalWebglAtlasRecovery()
        }
      }
    }

    function shouldForceForegroundRenderRefresh(data: string): {
      refresh: boolean
      inPlaceRewrite: boolean
      recoverWebglAtlasAfterParse: boolean
    } {
      const rewriteOutputPrefersRenderRefresh = foregroundRewriteOutputPrefersRenderRefresh(data)
      const recentInput =
        performance.now() - lastTerminalInputAt <= FOREGROUND_INTERACTIVE_REDRAW_WINDOW_MS
      if (foregroundRendererRiskOutputPrefersRenderRefresh(data)) {
        return {
          refresh: true,
          inPlaceRewrite: rewriteOutputPrefersRenderRefresh,
          recoverWebglAtlasAfterParse: true
        }
      }
      if (rewriteOutputPrefersRenderRefresh) {
        // Why: xterm's buffer is right but in-place redraw cells stay stale in the renderer until a repaint (resize fixes it).
        return { refresh: true, inPlaceRewrite: true, recoverWebglAtlasAfterParse: false }
      }
      if (
        windowsEastAsianOutputPrefersRenderRefresh(data, {
          isWindowsClient: shouldApplyWindowsRendererUnicodeRefresh,
          isNativeWindowsConpty: shouldApplyNativeWindowsRewriteRefresh,
          hadRecentInput: recentInput,
          maxInteractiveRedrawChars: FOREGROUND_INTERACTIVE_REDRAW_CHARS
        })
      ) {
        // Why: CJK/Korean from Microsoft Pinyin commits and native ConPTY output can leave stale wide-glyph cells in the Windows DOM renderer.
        return { refresh: true, inPlaceRewrite: false, recoverWebglAtlasAfterParse: false }
      }
      return {
        refresh:
          shouldApplyNativeWindowsRewriteRefresh &&
          containsNonAsciiOutput(data) &&
          containsWindowsRewriteControl(data),
        inPlaceRewrite: false,
        recoverWebglAtlasAfterParse: false
      }
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
      const result = scanMode2031ReplyDecision(mode2031ReplyScanState, data)
      mode2031ReplyScanState = result.state
      if (result.decision === 'unsubscribed') {
        deps.paneMode2031Ref.current.delete(pane.id)
        deps.paneLastThemeModeRef.current.delete(pane.id)
      }
      if (result.decision !== 'subscribed') {
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
        resetHiddenRendererRiskState()
      }
      const parseHiddenStartupOutput =
        !foreground &&
        canUseHiddenOutputSnapshot(transport.getPtyId()) &&
        shouldSnapshotHiddenCodexOutput &&
        (opts?.hiddenStartupRendererQuery === true || containsHiddenStartupRendererQuery(data))
      const synchronizedOutputStarted =
        shouldProtectNativeWindowsSynchronizedOutput &&
        foreground &&
        containsSynchronizedOutputStart(data)
      const synchronizedOutputEnded =
        shouldProtectNativeWindowsSynchronizedOutput &&
        foreground &&
        containsSynchronizedOutputEnd(data)
      const synchronizedForegroundOutput =
        shouldProtectNativeWindowsSynchronizedOutput &&
        foreground &&
        (synchronizedForegroundOutputActive || synchronizedOutputStarted || synchronizedOutputEnded)
      const nextSynchronizedForegroundOutputActive =
        shouldProtectNativeWindowsSynchronizedOutput &&
        foreground &&
        shouldSynchronizedOutputRemainActive(data, synchronizedForegroundOutputActive)
      // Why: xterm's DOM renderer draws the cursor as row content, so Windows cursor-only restores need row invalidation even outside DEC 2026.
      const nativeWindowsCursorRestore =
        shouldProtectNativeWindowsSynchronizedOutput && foreground && containsCursorRestore(data)
      const foregroundOutput = foreground || parseHiddenStartupOutput
      if (foreground) {
        scheduleForegroundPtyGridCheck()
      }
      const renderRefreshDecision = foregroundOutput
        ? shouldForceForegroundRenderRefresh(data)
        : { refresh: false, inPlaceRewrite: false, recoverWebglAtlasAfterParse: false }
      const recoverHiddenWebglAtlasAfterParse =
        !foregroundOutput && hiddenOutputNeedsAtlasRecoveryAfterParse(data)
      const recoverWebglAtlasAfterParse =
        renderRefreshDecision.recoverWebglAtlasAfterParse || recoverHiddenWebglAtlasAfterParse
      // Why: atlas recovery must repaint from the parsed xterm buffer, not a pre-write snapshot a late TUI redraw can stale.
      const onParsedAtlasRecovery = recoverWebglAtlasAfterParse
        ? scheduleTerminalWebglAtlasRecovery
        : renderRefreshDecision.inPlaceRewrite
          ? alternateScreenRewriteAtlasRecoveryOnParsed()
          : undefined
      const foregroundRenderRefreshNeeded = renderRefreshDecision.refresh
      // Why: Claude Code's in-place prompt redraws on Windows ConPTY can paint one frame late; a follow-up repaint fixes the column desync without a resize.
      const nativeWindowsInPlaceRewriteFollowup = nativeWindowsRewriteNeedsFollowupRenderRefresh({
        isNativeWindowsConpty: shouldApplyNativeWindowsRewriteRefresh,
        isForeground: foreground,
        isInPlaceRewrite: renderRefreshDecision.inPlaceRewrite
      })
      // Why: recompute the latch on every synchronized START so each frame's interactivity is judged by its own open time and can't leak across a same-chunk close+open; clear only on leaving synchronized output.
      if (synchronizedForegroundOutput && synchronizedOutputStarted) {
        synchronizedForegroundFrameInteractive =
          performance.now() - lastTerminalInputAt <=
          FOREGROUND_SYNCHRONIZED_FRAME_INTERACTIVE_WINDOW_MS
      } else if (!nextSynchronizedForegroundOutputActive && !synchronizedOutputEnded) {
        synchronizedForegroundFrameInteractive = false
      }
      // Why: ConPTY can split a submit repaint's closing chunk past the 150ms window, so treat a keystroke-opened frame as latency-sensitive to drain it fast (~16-32ms) not the 1s coalesce fallback.
      const synchronizedFrameLatencySensitive =
        synchronizedForegroundOutput && synchronizedForegroundFrameInteractive
      synchronizedForegroundOutputActive = nextSynchronizedForegroundOutputActive
      writeTerminalOutput(pane.terminal, data, {
        foreground: foregroundOutput,
        beforeWrite: beforeTerminalOutputWrite,
        // Why: every scheduler write claims one child so a split delivery is credited only after all children parse or discard.
        ackCredit: takeCurrentTerminalDeliveryCredit() ?? undefined,
        onBackgroundBacklogDropped: markHiddenOutputRestoreNeeded,
        latencySensitive:
          !foreground || parseHiddenStartupOutput
            ? true
            : synchronizedFrameLatencySensitive || isLatencySensitiveForegroundOutput(data),
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
        stripTransientCursorShows: shouldProtectNativeWindowsSynchronizedOutput && foreground,
        coalesceForeground: synchronizedForegroundOutput && synchronizedOutputEnded,
        holdForeground: synchronizedForegroundOutput && nextSynchronizedForegroundOutputActive
      })
    }

    queueAgentIdleTerminalModeReset = (): void => {
      if (disposed) {
        return
      }
      writePtyOutputToXterm(
        idleAgentTerminalModeReset,
        shouldWritePtyOutputForeground(deps.isVisibleRef.current)
      )
    }

    function markHiddenOutputRestoreNeeded(): void {
      resetSkippedHiddenRendererRiskState()
      const ptyId = transport.getPtyId()
      if (!canUseHiddenOutputSnapshot(ptyId)) {
        return
      }
      if (hiddenOutputRestorePtyId !== null && hiddenOutputRestorePtyId !== ptyId) {
        clearHiddenOutputRestoreState()
      }
      hiddenOutputRestorePtyId = ptyId
      hiddenOutputRestoreNeeded = true
      if (shouldWritePtyOutputForeground(deps.isVisibleRef.current)) {
        requestHiddenOutputRestoreIfNeeded()
      }
    }

    function shouldSkipHiddenRendererOutput(foreground: boolean, data: string): boolean {
      const ptyId = transport.getPtyId()
      if (
        foreground ||
        (!shouldSnapshotHiddenCodexOutput && remoteOutputPausedPtyId !== ptyId) ||
        !canUseHiddenOutputSnapshot(ptyId)
      ) {
        return false
      }
      // Why: CPR/DECRQM replies depend on ordered state; keep a clean stateful-query chunk live, but after skipped bytes avoid stale replies.
      return hiddenRendererStateDirty || !containsStatefulRendererQuery(data)
    }

    function writeHiddenStartupRendererQueries(data: string): void {
      const extracted = extractHiddenStartupRendererQueryData(
        data,
        hiddenStartupRendererQueryPending
      )
      hiddenStartupRendererQueryPending = extracted.pending
      if (extracted.oscColorQueryData) {
        // Why: Codex's startup palette probe has a 100ms budget; answer hidden color queries immediately so scheduling/remote-input debounce (#7329) can't miss it.
        sendTerminalOscColorQueryReplies(
          extracted.oscColorQueryData,
          pane.terminal,
          sendDesktopQueryReplyImmediate
        )
      }
      if (extracted.statelessQueryData) {
        writePtyOutputToXterm(extracted.statelessQueryData, false, {
          hiddenStartupRendererQuery: true
        })
      }
      // Stateful hidden queries need ordered terminal state; if the hidden xterm is dirty, skip rather than send stale CPR/DECRQM.
    }

    function takeHiddenStartupRendererQueryPendingForForeground(data: string): {
      statelessQueryData: string
      statefulQueryData: string
      oscColorQueryData: string
      remainingData: string
      consumedCurrentChars: number
    } {
      const pending = hiddenStartupRendererQueryPending
      hiddenStartupRendererQueryPending = ''
      if (!pending) {
        return {
          statelessQueryData: '',
          statefulQueryData: '',
          oscColorQueryData: '',
          remainingData: data,
          consumedCurrentChars: 0
        }
      }

      const input = pending + data
      let statelessQueryData = ''
      let statefulQueryData = ''
      let oscColorQueryData = ''
      let consumedInputChars = pending.length
      let nextPending = ''
      if (input.startsWith('\x1b[')) {
        const finalByteIndex = findCsiFinalByteIndex(input, 2)
        if (finalByteIndex === -1) {
          nextPending = input.slice(0, HIDDEN_STARTUP_RENDERER_QUERY_PENDING_CHARS)
          consumedInputChars = input.length
        } else {
          const sequence = input.slice(0, finalByteIndex + 1)
          if (isStatelessRendererReplyCsiQuery(sequence)) {
            statelessQueryData = sequence
          } else if (isStatefulRendererReplyCsiQuery(sequence)) {
            statefulQueryData = sequence
          }
          consumedInputChars = finalByteIndex + 1
        }
      } else if (input.startsWith('\x1b]')) {
        const query = parseTerminalOscColorQuery(input, 0)
        if (query.kind === 'partial') {
          nextPending = input.slice(0, HIDDEN_STARTUP_RENDERER_QUERY_PENDING_CHARS)
          consumedInputChars = input.length
        } else if (query.kind === 'match') {
          oscColorQueryData = input.slice(0, query.endIndex)
          consumedInputChars = query.endIndex
        } else {
          consumedInputChars = pending.length
        }
      } else if (input.length === 1) {
        nextPending = input
        consumedInputChars = input.length
      } else {
        consumedInputChars = pending.length
      }

      hiddenStartupRendererQueryPending = nextPending
      const consumedCurrentChars = Math.max(0, consumedInputChars - pending.length)
      return {
        statelessQueryData,
        statefulQueryData,
        oscColorQueryData,
        remainingData: data.slice(consumedCurrentChars),
        consumedCurrentChars
      }
    }

    function metaAfterConsumingCurrentChars(
      meta: PtyDataMeta | undefined,
      consumedCurrentChars: number
    ): PtyDataMeta | undefined {
      if (consumedCurrentChars === 0 || typeof meta?.rawLength !== 'number') {
        return meta
      }
      return {
        ...meta,
        rawLength: Math.max(0, meta.rawLength - consumedCurrentChars)
      }
    }

    function skipHiddenRendererOutput(data: string): void {
      writeHiddenStartupRendererQueries(data)
      markHiddenOutputRestoreNeeded()
      hiddenRendererStateDirty = true
      if (hiddenOutputRestoreInFlight) {
        hiddenOutputRestoreFreshSnapshotNeeded = true
      }
      recordHiddenRendererSkip(data.length)
    }

    // Why: discarding flood bytes must not swallow terminal queries (a lost DSR/CPR hangs the program); the snapshot repaint owns the content, so synthesize replies via the immediate input path, not xterm replay.
    function salvageRendererQueriesFromDiscardedRestoreData(data: string): void {
      if (!data || !data.includes('\x1b')) {
        return
      }
      const extracted = extractHiddenStartupRendererQueryData(data, '')
      if (extracted.oscColorQueryData) {
        sendTerminalOscColorQueryReplies(
          extracted.oscColorQueryData,
          pane.terminal,
          sendDesktopQueryReplyImmediate
        )
      }
      let unansweredQueryData = ''
      for (const sequence of splitCsiSequences(
        extracted.statefulQueryData + extracted.statelessQueryData
      )) {
        if (sequence === '\x1b[6n') {
          // CPR from the live buffer; may be mid-repaint stale, but in a drop scenario liveness (unblock the reader) is the contract, not accuracy.
          const buffer = pane.terminal.buffer.active
          const row = Math.min(buffer.cursorY + 1, pane.terminal.rows)
          const col = Math.min(buffer.cursorX + 1, pane.terminal.cols)
          sendDesktopQueryReplyImmediate(`\x1b[${row};${col}R`)
        } else if (sequence === '\x1b[c' || sequence === '\x1b[0c') {
          sendDesktopQueryReplyImmediate(DEFAULT_DA1_RESPONSE)
        } else {
          unansweredQueryData += sequence
        }
      }
      if (unansweredQueryData) {
        // Best-effort for rarer queries (DECRQM, DA2, XTVERSION): replay into xterm so its handlers answer when no replay is active.
        writePtyOutputToXterm(unansweredQueryData, true, { hiddenStartupRendererQuery: true })
      }
    }

    function splitCsiSequences(queryData: string): string[] {
      const sequences: string[] = []
      let offset = queryData.indexOf('\x1b[')
      while (offset !== -1) {
        const finalByteIndex = findCsiFinalByteIndex(queryData, offset + 2)
        if (finalByteIndex === -1) {
          break
        }
        sequences.push(queryData.slice(offset, finalByteIndex + 1))
        offset = queryData.indexOf('\x1b[', finalByteIndex + 1)
      }
      return sequences
    }

    function queueLiveChunkDuringRestore(data: string, meta?: PtyDataMeta): void {
      if (!data) {
        return
      }
      const ptyId = transport.getPtyId()
      if (!canUseHiddenOutputSnapshot(ptyId)) {
        return
      }
      if (hiddenOutputRestorePtyId !== null && hiddenOutputRestorePtyId !== ptyId) {
        clearHiddenOutputRestoreState()
      }
      hiddenOutputRestorePtyId = ptyId
      hiddenOutputRestoreNeeded = true
      if (hiddenOutputRestorePendingOverflow) {
        // Why: the overflow latch discards everything queued at the next drain, so queueing more only grows the discard; salvage queries, drop content.
        salvageRendererQueriesFromDiscardedRestoreData(data)
        armHiddenOutputRestoreForegroundDeadline()
        return
      }
      if (hiddenOutputRestorePendingChars + data.length > HIDDEN_OUTPUT_RESTORE_PENDING_CHARS) {
        const discardedChunks = hiddenOutputRestorePendingChunks
        hiddenOutputRestorePendingChunks = []
        hiddenOutputRestorePendingChars = 0
        hiddenOutputRestorePendingOverflow = true
        for (const chunk of discardedChunks) {
          salvageRendererQueriesFromDiscardedRestoreData(chunk.data)
        }
        salvageRendererQueriesFromDiscardedRestoreData(data)
        armHiddenOutputRestoreForegroundDeadline()
        return
      }
      const pending: PendingHiddenOutputRestoreChunk = { data }
      if (typeof meta?.seq === 'number') {
        pending.seq = meta.seq
      }
      if (typeof meta?.rawLength === 'number') {
        pending.rawLength = meta.rawLength
      }
      hiddenOutputRestorePendingChunks.push(pending)
      hiddenOutputRestorePendingChars += data.length
      armHiddenOutputRestoreForegroundDeadline()
    }

    function getChunkDataAfterSnapshot(
      chunk: PendingHiddenOutputRestoreChunk,
      snapshotSeq: number | undefined
    ): string | null {
      if (typeof snapshotSeq !== 'number' || typeof chunk.seq !== 'number') {
        return chunk.data
      }
      const rawLength = chunk.rawLength ?? chunk.data.length
      const startSeq = chunk.seq - rawLength
      if (snapshotSeq >= chunk.seq) {
        return ''
      }
      if (snapshotSeq <= startSeq) {
        return chunk.data
      }
      const offset = snapshotSeq - startSeq
      if (rawLength !== chunk.data.length) {
        return null
      }
      return chunk.data.slice(offset)
    }

    type RestoredSnapshotReconciliation =
      | { action: 'write'; data: string; meta: PtyDataMeta | undefined }
      | { action: 'drop-duplicate' }
      | { action: 'force-fresh-restore' }

    // Why: same slicing as getChunkDataAfterSnapshot but for post-restore live chunks, which main's ACK backlog can still deliver at/before the snapshot seq (and can trim seq ranges silently).
    function reconcileChunkAgainstRestoredSnapshot(
      data: string,
      meta: PtyDataMeta | undefined
    ): RestoredSnapshotReconciliation {
      if (restoredSnapshotBaselineSeq === null) {
        return { action: 'write', data, meta }
      }
      if (transport.getPtyId() !== restoredSnapshotBaselinePtyId) {
        clearRestoredSnapshotBaseline()
        return { action: 'write', data, meta }
      }
      if (typeof meta?.seq !== 'number') {
        // Why: seq-less chunks (no runtime metering) can't be reconciled; pass them through like getChunkDataAfterSnapshot.
        return { action: 'write', data, meta }
      }
      if (
        restoredSnapshotDeliveryWindowStartSeq !== null &&
        meta.seq <= restoredSnapshotDeliveryWindowStartSeq
      ) {
        // Why: all still-deliverable bytes started after this seq and delivery is in-order, so this can't be a backlog dup — it's a new seq domain; retire the baseline and write.
        clearRestoredSnapshotBaseline()
        return { action: 'write', data, meta }
      }
      const rawLength = meta.rawLength ?? data.length
      const startSeq = meta.seq - rawLength
      const expectedStartSeq = restoredSnapshotExpectedStartSeq
      restoredSnapshotExpectedStartSeq = Math.max(expectedStartSeq ?? meta.seq, meta.seq)
      if (expectedStartSeq !== null && startSeq > expectedStartSeq) {
        // Why: the chunk starts past the continuity point — bytes between were dropped (pending-cap trim); only a fresh snapshot heals the gap.
        return { action: 'force-fresh-restore' }
      }
      if (meta.seq <= restoredSnapshotBaselineSeq) {
        return { action: 'drop-duplicate' }
      }
      if (startSeq >= restoredSnapshotBaselineSeq) {
        return { action: 'write', data, meta }
      }
      if (rawLength !== data.length) {
        // Why: renderer-only OSC stripping makes raw seq offsets unmappable onto cleaned text; refetch instead of risking duplicate output.
        return { action: 'force-fresh-restore' }
      }
      const sliced = data.slice(restoredSnapshotBaselineSeq - startSeq)
      return {
        action: 'write',
        data: sliced,
        // Why: keep seq metadata consistent with the sliced payload so a later queue drain slices against accurate offsets.
        meta: { ...meta, rawLength: sliced.length }
      }
    }

    function recordRendererOrderedSeq(meta?: Pick<PtyDataMeta, 'seq'>): void {
      if (typeof meta?.seq !== 'number') {
        return
      }
      const ptyId = transport.getPtyId()
      if (!ptyId) {
        return
      }
      if (rendererOrderedPtyId !== ptyId) {
        rendererOrderedPtyId = ptyId
        rendererOrderedSeq = meta.seq
        return
      }
      rendererOrderedSeq = Math.max(rendererOrderedSeq ?? 0, meta.seq)
    }

    resetRendererOrderedSeqForPtyExit = (exitedPtyId: string): void => {
      // Why: an exit ends this ptyId's seq domain; a revived id restarts main's counter, so both seq high-water marks (ordered + restored baseline) must reset here or they drop revived bytes as duplicates.
      if (restoredSnapshotBaselinePtyId === exitedPtyId) {
        clearRestoredSnapshotBaseline()
      }
      if (rendererOrderedPtyId === exitedPtyId) {
        rendererOrderedPtyId = null
        rendererOrderedSeq = null
      }
      if (rendererChannelSeqPtyId === exitedPtyId) {
        rendererChannelSeqPtyId = null
        rendererChannelSeq = null
      }
    }

    function observeRendererOrderedSeqRegression(meta: PtyDataMeta | undefined): void {
      if (typeof meta?.seq !== 'number') {
        return
      }
      const ptyId = transport.getPtyId()
      if (!ptyId) {
        return
      }
      if (rendererChannelSeqPtyId !== ptyId) {
        rendererChannelSeqPtyId = ptyId
        rendererChannelSeq = meta.seq
        return
      }
      if (rendererChannelSeq !== null && meta.seq < rendererChannelSeq) {
        // Why: pty:data is FIFO, so seq regresses only when a session revived without an observed exit and restarted its counter; drop the stale baseline.
        if (rendererOrderedPtyId === ptyId) {
          rendererOrderedPtyId = null
          rendererOrderedSeq = null
        }
      }
      rendererChannelSeq = meta.seq
    }

    function getHiddenRendererDataAfterOrderedSeq(
      data: string,
      meta: PtyDataMeta | undefined
    ): string | null {
      if (
        rendererOrderedPtyId === null ||
        rendererOrderedSeq === null ||
        transport.getPtyId() !== rendererOrderedPtyId
      ) {
        return data
      }
      return getChunkDataAfterSnapshot(
        { data, seq: meta?.seq, rawLength: meta?.rawLength },
        rendererOrderedSeq
      )
    }

    // 'drained' = painted all queued bytes; 'overflow' = queue blew its cap (stream outran fetch+replay); 'refetch' = offsets unmappable, need a fresher snapshot.
    function drainPendingLiveChunksAfterSnapshot(
      snapshotSeq: number | undefined
    ): 'drained' | 'overflow' | 'refetch' {
      if (hiddenOutputRestorePendingOverflow) {
        hiddenOutputRestorePendingOverflow = false
        discardPendingLiveChunksSalvagingQueries()
        return 'overflow'
      }
      while (hiddenOutputRestorePendingChunks.length > 0) {
        const chunks = hiddenOutputRestorePendingChunks
        hiddenOutputRestorePendingChunks = []
        hiddenOutputRestorePendingChars = 0
        for (const [index, chunk] of chunks.entries()) {
          const data = getChunkDataAfterSnapshot(chunk, snapshotSeq)
          if (data === null) {
            // Why: renderer-only OSC stripping makes raw seq offsets unmappable onto cleaned text; refetch instead of risking duplicate output.
            for (const discarded of chunks.slice(index)) {
              salvageRendererQueriesFromDiscardedRestoreData(discarded.data)
            }
            discardPendingLiveChunksSalvagingQueries()
            return 'refetch'
          }
          // Why: advance the continuity point so reconciliation neither re-drops drained chunks as duplicates nor misreads the next live chunk as a gap.
          if (typeof chunk.seq === 'number' && restoredSnapshotExpectedStartSeq !== null) {
            restoredSnapshotExpectedStartSeq = Math.max(restoredSnapshotExpectedStartSeq, chunk.seq)
          }
          if (data) {
            writePtyOutputToXterm(data, true)
            recordRendererOrderedSeq(chunk)
          }
        }
        if (hiddenOutputRestorePendingOverflow) {
          hiddenOutputRestorePendingOverflow = false
          discardPendingLiveChunksSalvagingQueries()
          return 'overflow'
        }
      }
      return 'drained'
    }

    function discardPendingLiveChunksSalvagingQueries(): void {
      const discarded = hiddenOutputRestorePendingChunks
      hiddenOutputRestorePendingChunks = []
      hiddenOutputRestorePendingChars = 0
      for (const chunk of discarded) {
        salvageRendererQueriesFromDiscardedRestoreData(chunk.data)
      }
    }

    function clearPendingLiveChunksDuringRestore(): void {
      hiddenOutputRestorePendingChunks = []
      hiddenOutputRestorePendingChars = 0
      hiddenOutputRestorePendingOverflow = false
      hiddenOutputRestoreFreshSnapshotNeeded = false
      hiddenOutputRestoreRetryDeferred = false
      hiddenOutputRestoreScheduled = false
      cancelScheduledHiddenOutputRestore(pane.terminal)
      clearHiddenOutputRestoreDeferredRetryTimer()
      clearHiddenOutputRestoreForegroundDeadlineTimer()
      hiddenOutputRestoreDeferredRetryAttempts = 0
    }

    function clearHiddenOutputRestoreDeferredRetryTimer(): void {
      if (hiddenOutputRestoreDeferredRetryTimer === null) {
        return
      }
      clearTimeout(hiddenOutputRestoreDeferredRetryTimer)
      hiddenOutputRestoreDeferredRetryTimer = null
    }
    cleanupHiddenOutputRestoreDeferredRetry = clearHiddenOutputRestoreDeferredRetryTimer

    function clearHiddenOutputRestoreForegroundDeadlineTimer(): void {
      if (hiddenOutputRestoreForegroundDeadlineTimer === null) {
        return
      }
      clearTimeout(hiddenOutputRestoreForegroundDeadlineTimer)
      hiddenOutputRestoreForegroundDeadlineTimer = null
    }
    cleanupHiddenOutputRestoreForegroundDeadline = clearHiddenOutputRestoreForegroundDeadlineTimer

    function armHiddenOutputRestoreForegroundDeadline(): void {
      if (
        disposed ||
        hiddenOutputRestoreForegroundDeadlineTimer !== null ||
        !shouldWritePtyOutputForeground(deps.isVisibleRef.current) ||
        (hiddenOutputRestorePendingChunks.length === 0 && !hiddenOutputRestorePendingOverflow)
      ) {
        return
      }
      const ptyId = hiddenOutputRestorePtyId
      if (ptyId === null || transport.getPtyId() !== ptyId) {
        return
      }
      const deadlineGeneration = hiddenOutputRestoreGeneration
      // Why: only foreground output blocked behind recovery gets a deadline; hidden-time restore work has no user impact.
      hiddenOutputRestoreForegroundDeadlineTimer = setTimeout(() => {
        hiddenOutputRestoreForegroundDeadlineTimer = null
        if (
          disposed ||
          hiddenOutputRestoreGeneration !== deadlineGeneration ||
          hiddenOutputRestorePtyId !== ptyId ||
          !shouldWritePtyOutputForeground(deps.isVisibleRef.current)
        ) {
          return
        }
        abandonHiddenOutputRestoreAndDrainPendingForeground(ptyId)
      }, HIDDEN_OUTPUT_RESTORE_FOREGROUND_TIMEOUT_MS)
    }

    function abandonHiddenOutputRestoreAndDrainPendingForeground(
      expectedPtyId: string,
      opts: { quiet?: boolean } = {}
    ): void {
      if (transport.getPtyId() !== expectedPtyId || hiddenOutputRestorePtyId !== expectedPtyId) {
        resetHiddenOutputRestoreIfPtyChanged()
        return
      }
      const pendingChunks = hiddenOutputRestorePendingOverflow
        ? []
        : hiddenOutputRestorePendingChunks.slice()
      const hadPendingOverflow = hiddenOutputRestorePendingOverflow
      const replayingSnapshot = hiddenOutputRestoreReplayingSnapshot
      hiddenOutputRestoreReplayingSnapshot = null
      hiddenOutputRestoreGeneration += 1
      if (
        hiddenOutputSnapshotScrollRestore?.valid &&
        hiddenOutputSnapshotScrollRestore.ptyId === expectedPtyId
      ) {
        // Why: flood abandonment stops recovery bookkeeping, but its already-queued replay must keep the rebuild bracket and final pin.
        hiddenOutputSnapshotScrollRestore.generation = hiddenOutputRestoreGeneration
      }
      hiddenOutputRestoreInFlight = null
      hiddenOutputRestoreNeeded = false
      hiddenOutputRestorePtyId = null
      hiddenOutputRestorePendingChunks = []
      hiddenOutputRestorePendingChars = 0
      hiddenOutputRestorePendingOverflow = false
      hiddenOutputRestoreFreshSnapshotNeeded = false
      hiddenOutputRestoreRetryDeferred = false
      hiddenOutputRestoreScheduled = false
      hiddenStartupRendererQueryPending = ''
      hiddenRendererStateDirty = false
      resetHiddenRendererRiskState()
      cancelScheduledHiddenOutputRestore(pane.terminal)
      clearHiddenOutputRestoreDeferredRetryTimer()
      clearHiddenOutputRestoreForegroundDeadlineTimer()
      hiddenOutputRestoreDeferredRetryAttempts = 0

      // Why quiet: flood cuts abandon deliberately and repaint post-flood, so the "restore unavailable" warning would be noise the repaint wipes.
      if (!opts.quiet) {
        writeRestoreUnavailableWarning()
      }
      if (hadPendingOverflow) {
        return
      }
      const replayedSeq = typeof replayingSnapshot?.seq === 'number' ? replayingSnapshot.seq : null
      let pendingData = ''
      for (const chunk of pendingChunks) {
        const sliced =
          replayedSeq === null ? chunk.data : getChunkDataAfterSnapshot(chunk, replayedSeq)
        pendingData += sliced ?? chunk.data
      }
      if (replayingSnapshot && replayedSeq !== null) {
        setRestoredSnapshotBaseline(expectedPtyId, replayingSnapshot)
        for (const chunk of pendingChunks) {
          if (typeof chunk.seq === 'number' && restoredSnapshotExpectedStartSeq !== null) {
            restoredSnapshotExpectedStartSeq = Math.max(restoredSnapshotExpectedStartSeq, chunk.seq)
          }
        }
      }
      if (pendingData) {
        writePtyOutputToXterm(pendingData, true)
      }
    }

    function scheduleHiddenOutputRestoreDeferredRetry(): void {
      if (
        disposed ||
        hiddenOutputRestoreDeferredRetryTimer !== null ||
        !shouldWritePtyOutputForeground(deps.isVisibleRef.current)
      ) {
        return
      }
      if (hiddenOutputRestoreDeferredRetryAttempts >= HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MAX) {
        const ptyId = hiddenOutputRestorePtyId
        if (ptyId !== null) {
          abandonHiddenOutputRestoreAndDrainPendingForeground(ptyId)
        } else {
          clearHiddenOutputRestoreState()
          writeRestoreUnavailableWarning()
        }
        return
      }
      hiddenOutputRestoreDeferredRetryAttempts += 1
      // Why: a null snapshot usually means remote output was still mutating; retry after one quiet tick instead of spinning.
      hiddenOutputRestoreDeferredRetryTimer = setTimeout(() => {
        hiddenOutputRestoreDeferredRetryTimer = null
        if (disposed || !hiddenOutputRestoreNeeded) {
          return
        }
        hiddenOutputRestoreRetryDeferred = false
        requestHiddenOutputRestoreIfNeeded()
      }, HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MS)
    }

    function clearHiddenOutputRestoreState(): void {
      cancelSnapshotScrollRestore()
      clearPendingLiveChunksDuringRestore()
      hiddenStartupRendererQueryPending = ''
      hiddenRendererStateDirty = false
      resetHiddenRendererRiskState()
      hiddenOutputRestoreNeeded = false
      hiddenOutputRestorePtyId = null
      hiddenOutputRestoreReplayingSnapshot = null
      hiddenOutputRestoreGeneration += 1
    }

    function cancelSnapshotScrollRestore(): void {
      pendingHiddenSnapshotFit?.cancel()
      pendingHiddenSnapshotFit = null
      const scrollRestore = hiddenOutputSnapshotScrollRestore
      if (!scrollRestore) {
        return
      }
      scrollRestore.valid = false
      hiddenOutputSnapshotScrollRestore = null
      if (scrollRestore.started) {
        cancelTerminalScrollIntentBufferRebuildCompletions(pane.terminal)
      }
      // Why: invalidation suppresses restoration, but queued bytes still own the bracket until their FIFO sentinels prove parsing finished.
    }
    cancelHiddenOutputSnapshotScrollRestore = cancelSnapshotScrollRestore

    function clearPaneMode2031State(): void {
      deps.paneMode2031Ref.current.delete(pane.id)
      deps.paneLastThemeModeRef.current.delete(pane.id)
      // A partial CSI prefix belongs to the stream that produced it; carrying it into a
      // replacement PTY would splice two unrelated byte ranges into one sequence.
      mode2031ReplyScanState = INITIAL_MODE_2031_REPLY_SCAN_STATE
    }

    function pulseVisibleLocalPtySizeForTuiRepaint(ptyId: string): void {
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

    function skipBackgroundAlternateScreenOutput(data: string): void {
      writeHiddenStartupRendererQueries(data)
      resetSkippedHiddenRendererRiskState()
      hiddenRendererStateDirty = true
      recordHiddenRendererSkip(data.length)
      const ptyId = transport.getPtyId()
      if (!ptyId || alternateScreenBackgroundRepaintTimer !== null) {
        return
      }
      pulseVisibleLocalPtySizeForTuiRepaint(ptyId)
      alternateScreenBackgroundRepaintTimer = setTimeout(() => {
        alternateScreenBackgroundRepaintTimer = null
      }, 100)
    }

    function resetHiddenOutputRestoreIfPtyChanged(): void {
      if (hiddenOutputRestorePtyId === null) {
        return
      }
      if (transport.getPtyId() !== hiddenOutputRestorePtyId) {
        // Why: renderer backlog is tied to the old PTY stream; after reattach it must not delay or replay before the new PTY.
        clearHiddenOutputRestoreState()
        clearRestoredSnapshotBaseline()
        clearPaneMode2031State()
        // Why: flood-backpressure evidence is per PTY stream too.
        resetHiddenOutputRestoreFloodSuppression()
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

    async function applyMainBufferSnapshot(snapshot: {
      data: string
      cols: number
      rows: number
      seq?: number
      pendingDeliveryStartSeq?: number
      alternateScreen?: boolean
      scrollbackAnsi?: string
      pendingEscapeTailAnsi?: string
    }): Promise<void> {
      const restorePtyId = transport.getPtyId()
      const restoreGeneration = hiddenOutputRestoreGeneration
      if (hiddenOutputSnapshotScrollRestore) {
        cancelSnapshotScrollRestore()
      }
      const scrollRestore = {
        ptyId: restorePtyId,
        generation: restoreGeneration,
        valid: true,
        started: false
      }
      hiddenOutputSnapshotScrollRestore = scrollRestore
      const colsBeforeReplay = pane.terminal.cols
      const rowsBeforeReplay = pane.terminal.rows
      const hasSnapshotDimensions = hasPositiveTerminalDimensions(snapshot.cols, snapshot.rows)
      try {
        await structuralReplayCoordinator.run(
          async () => {
            if (
              !scrollRestore.valid ||
              disposed ||
              transport.getPtyId() !== scrollRestore.ptyId ||
              hiddenOutputRestoreGeneration !== scrollRestore.generation
            ) {
              return
            }
            scrollRestore.started = true
            if (typeof snapshot.seq === 'number') {
              hiddenOutputRestoreReplayingSnapshot = {
                seq: snapshot.seq,
                ...(typeof snapshot.pendingDeliveryStartSeq === 'number'
                  ? { pendingDeliveryStartSeq: snapshot.pendingDeliveryStartSeq }
                  : {})
              }
            }
            discardTerminalOutput(pane.terminal)
            if (
              hasSnapshotDimensions &&
              (pane.terminal.cols !== snapshot.cols || pane.terminal.rows !== snapshot.rows)
            ) {
              // Why: xterm parses writes later; hold snapshot dimensions until the FIFO sentinel completes so serialized wraps stay exact.
              suppressStructuralReplayPtyResize = true
              try {
                pane.terminal.resize(snapshot.cols, snapshot.rows)
              } finally {
                suppressStructuralReplayPtyResize = false
              }
            }
            // Why shared: the SSH reattach model paint inlines the same
            // choreography (coordinator nesting would deadlock there); one
            // builder keeps the alt-screen branches from drifting.
            for (const replayChunk of buildMainModelSnapshotReplayWrites(snapshot)) {
              writeReplayData(replayChunk)
            }
            // Why: live agents own ?25l/?1004h; a forced ?1004l here would silence focus events until restart (agents enable focus reporting only at startup).
            writeReplayData(
              hasLiveAgentReattachStatusOrTitleSignal()
                ? POST_REPLAY_LIVE_AGENT_SNAPSHOT_RESET
                : POST_REPLAY_LIVE_SNAPSHOT_RESET
            )
            if (snapshot.pendingEscapeTailAnsi) {
              // Why last: snapshot taken mid-escape; re-arm as the FINAL replay write (any later ESC aborts it) so the live tail completes it, not render literally (Bug E / #7329).
              writeReplayData(snapshot.pendingEscapeTailAnsi)
            }
            hiddenRendererStateDirty = false
            recordRendererOrderedSeq(snapshot)
            resetHiddenRendererRiskState()
            recordTerminalOutput(pane.terminal)
            await waitForTerminalReplayWritesParsed(pane.terminal)
          },
          {
            shouldRestore: () =>
              scrollRestore.valid &&
              !disposed &&
              transport.getPtyId() === scrollRestore.ptyId &&
              hiddenOutputRestoreGeneration === scrollRestore.generation,
            afterRestore: async () => {
              const isCurrentRestore = (): boolean =>
                scrollRestore.valid &&
                !disposed &&
                transport.getPtyId() === scrollRestore.ptyId &&
                hiddenOutputRestoreGeneration === scrollRestore.generation
              if (!isCurrentRestore()) {
                return
              }
              const currentPtyId = transport.getPtyId()
              if (!currentPtyId || getFitOverrideForPty(currentPtyId)) {
                return
              }
              const fit = safeFitAndThen(
                pane,
                'hidden-snapshot-pty-resize',
                () => {
                  if (!isCurrentRestore() || transport.getPtyId() !== currentPtyId) {
                    return
                  }
                  const replayChangedDimensions = hasSnapshotDimensions
                    ? pane.terminal.cols !== snapshot.cols || pane.terminal.rows !== snapshot.rows
                    : pane.terminal.cols !== colsBeforeReplay ||
                      pane.terminal.rows !== rowsBeforeReplay
                  if (replayChangedDimensions && isRendererPtyResizeAuthoritative()) {
                    transport.resize(pane.terminal.cols, pane.terminal.rows)
                    if (!isRemoteRuntimePtyId(currentPtyId)) {
                      // Why: redundant SIGWINCH makes alt-screen TUIs rebuild their scroll viewport to the top on tab return.
                      getClientRuntime().terminal.signal(currentPtyId, 'SIGWINCH')
                    }
                  }
                },
                { shouldContinue: isCurrentRestore, retryIfUnmeasurable: true }
              )
              pendingHiddenSnapshotFit = fit
              try {
                await fit.completion
              } finally {
                if (pendingHiddenSnapshotFit === fit) {
                  pendingHiddenSnapshotFit = null
                }
              }
              if (isCurrentRestore()) {
                scheduleReattachIdleAgentCursorReset()
              }
            }
          }
        )
      } finally {
        if (hiddenOutputSnapshotScrollRestore === scrollRestore) {
          hiddenOutputSnapshotScrollRestore = null
        }
      }
    }

    function requestHiddenOutputRestoreIfNeeded(opts?: { bypassScheduler?: boolean }): boolean {
      // Why: once the write pipeline is probe-certified dead a restore can never parse; recovery owns the pane and the remount gets a fresh xterm + restore.
      if (isTerminalWritePipelineCertifiedDead(pane.terminal)) {
        // Why the re-kick: certification's recovery request can be budget-declined or cancelled by a sibling remount; without this, a revealed dead pane keeps the stale frame forever.
        if (!certifiedDeadRestoreRecoveryRequested && !disposed) {
          certifiedDeadRestoreRecoveryRequested = true
          const storePtyId = useAppStore.getState().ptyIdsByTabId?.[deps.tabId]?.[0] ?? null
          void requestTerminalPaneRecovery({
            tabId: deps.tabId,
            ptyId: transport.getPtyId() ?? storePtyId,
            reason: 'restore-blocked',
            terminalRecoveryGeneration,
            terminalRecoveryInstanceId: terminalRecoveryInstance.id
          })
        }
        return false
      }
      resetHiddenOutputRestoreIfPtyChanged()
      const ptyId = hiddenOutputRestorePtyId ?? transport.getPtyId()
      if (!hiddenOutputRestoreNeeded && hiddenOutputRestorePendingChunks.length === 0) {
        return false
      }
      if (!canUseHiddenOutputSnapshot(ptyId)) {
        return false
      }
      hiddenOutputRestorePtyId = ptyId
      if (hiddenOutputRestoreInFlight) {
        armHiddenOutputRestoreForegroundDeadline()
        return true
      }
      if (!opts?.bypassScheduler) {
        const priority = isActiveSplitPane() ? 'active' : 'inactive'
        if (priority === 'inactive') {
          if (!hiddenOutputRestoreScheduled) {
            hiddenOutputRestoreScheduled = true
            const scheduledPtyId = ptyId
            const scheduledGeneration = hiddenOutputRestoreGeneration
            // Why: resume can reveal many split panes at once; spread inactive replays across frames so xterm scrollback replay doesn't block return.
            scheduleHiddenOutputRestore(
              pane.terminal,
              () => {
                hiddenOutputRestoreScheduled = false
                if (
                  disposed ||
                  hiddenOutputRestoreGeneration !== scheduledGeneration ||
                  hiddenOutputRestorePtyId !== scheduledPtyId ||
                  transport.getPtyId() !== scheduledPtyId ||
                  !canUseHiddenOutputSnapshot(scheduledPtyId) ||
                  (!hiddenOutputRestoreNeeded && hiddenOutputRestorePendingChunks.length === 0) ||
                  !shouldWritePtyOutputForeground(deps.isVisibleRef.current)
                ) {
                  return
                }
                requestHiddenOutputRestoreIfNeeded({ bypassScheduler: true })
              },
              priority
            )
          }
          return true
        }
        cancelScheduledHiddenOutputRestore(pane.terminal)
        hiddenOutputRestoreScheduled = false
      }
      clearHiddenOutputRestoreDeferredRetryTimer()
      hiddenOutputRestoreRetryDeferred = false

      hiddenOutputRestoreInFlight = (async () => {
        // Backstop (rc.7.perf loop): bound how many snapshot fetch+replay rounds one task burns before yielding to the live stream.
        let restoreIterations = 0
        while (!disposed) {
          const currentPtyId = hiddenOutputRestorePtyId
          if (currentPtyId === null) {
            clearHiddenOutputRestoreState()
            return
          }
          if (!canUseHiddenOutputSnapshot(currentPtyId)) {
            if (hiddenOutputRestorePtyId === currentPtyId) {
              clearHiddenOutputRestoreState()
            }
            writeRestoreUnavailableWarning()
            return
          }
          if (transport.getPtyId() !== currentPtyId) {
            if (hiddenOutputRestorePtyId === currentPtyId) {
              clearHiddenOutputRestoreState()
            }
            return
          }
          const restoreGeneration = hiddenOutputRestoreGeneration
          hiddenOutputRestoreNeeded = false
          let snapshot: PtyBufferSnapshot | null = null
          try {
            snapshot = await serializeHiddenOutputSnapshot(currentPtyId, {
              scrollbackRows: resolveHiddenRestoreScrollbackRows(pane.terminal.options.scrollback)
            })
          } catch {
            snapshot = null
          }
          if (disposed) {
            return
          }
          const restoreGenerationChanged = hiddenOutputRestoreGeneration !== restoreGeneration
          const restorePtyChanged =
            transport.getPtyId() !== currentPtyId || hiddenOutputRestorePtyId !== currentPtyId
          if (restoreGenerationChanged || restorePtyChanged) {
            // Why: the snapshot belongs to the requested PTY; after reattach it's stale, and a stale generation may be an abandoned timeout superseded by a newer restore.
            if (restorePtyChanged && hiddenOutputRestorePtyId === currentPtyId) {
              clearHiddenOutputRestoreState()
            }
            return
          }
          if (!snapshot) {
            hiddenOutputRestoreNeeded = true
            hiddenOutputRestoreFreshSnapshotNeeded = false
            hiddenOutputRestoreRetryDeferred = true
            scheduleHiddenOutputRestoreDeferredRetry()
            return
          }
          hiddenOutputRestoreDeferredRetryAttempts = 0
          restoreIterations += 1
          await applyMainBufferSnapshot(snapshot)
          if (
            disposed ||
            hiddenOutputRestoreGeneration !== restoreGeneration ||
            hiddenOutputRestorePtyId !== currentPtyId ||
            transport.getPtyId() !== currentPtyId
          ) {
            return
          }
          // Why: everything at/before snapshot.seq is now painted; chunks still draining from main's ACK backlog below it are duplicates to suppress.
          setRestoredSnapshotBaseline(currentPtyId, snapshot)
          hiddenOutputRestoreReplayingSnapshot = null
          const needsFreshSnapshot = hiddenOutputRestoreFreshSnapshotNeeded
          hiddenOutputRestoreFreshSnapshotNeeded = false
          const drainOutcome = drainPendingLiveChunksAfterSnapshot(snapshot.seq)
          if (drainOutcome === 'drained' && !needsFreshSnapshot) {
            hiddenOutputRestoreNeeded = false
            hiddenOutputRestorePtyId = null
            clearHiddenOutputRestoreForegroundDeadlineTimer()
            return
          }
          if (!shouldWritePtyOutputForeground(deps.isVisibleRef.current)) {
            // Why: hidden bytes arriving during the snapshot aren't in renderer memory; leave recovery pending for reveal, don't loop snapshots in a throttled tab.
            hiddenOutputRestoreNeeded = true
            return
          }
          if (drainOutcome === 'overflow') {
            // Cut 1 (rc.7.perf loop): a FOREGROUND queue overflow means the stream outruns fetch+replay; re-fetching starves ACKs, so abandon and heal with one post-flood repaint.
            noteHiddenOutputRestoreFloodBackpressure()
            abandonHiddenOutputRestoreAndDrainPendingForeground(currentPtyId, { quiet: true })
            return
          }
          if (restoreIterations >= HIDDEN_OUTPUT_RESTORE_MAX_LOOP_ITERATIONS) {
            // Backstop: re-looping this many times means the stream is winning the race.
            warnTerminalLifecycleAnomaly('hidden output restore hit its iteration cap', {
              tabId: deps.tabId,
              worktreeId: deps.worktreeId,
              leafId: pane.leafId,
              paneId: pane.id,
              ptyId: currentPtyId,
              reason: drainOutcome
            })
            noteHiddenOutputRestoreFloodBackpressure()
            abandonHiddenOutputRestoreAndDrainPendingForeground(currentPtyId, { quiet: true })
            return
          }
          hiddenOutputRestoreNeeded = true
        }
      })()
      const hiddenOutputRestoreTask = hiddenOutputRestoreInFlight
      let trackedHiddenOutputRestore: Promise<void>
      trackedHiddenOutputRestore = hiddenOutputRestoreTask.finally(() => {
        if (hiddenOutputRestoreInFlight === trackedHiddenOutputRestore) {
          hiddenOutputRestoreInFlight = null
        }
        if (hiddenOutputRestorePendingChunks.length > 0 || hiddenOutputRestorePendingOverflow) {
          hiddenOutputRestoreNeeded = true
          armHiddenOutputRestoreForegroundDeadline()
        }
        if (
          !hiddenOutputRestoreRetryDeferred &&
          hiddenOutputRestoreNeeded &&
          shouldWritePtyOutputForeground(deps.isVisibleRef.current)
        ) {
          requestHiddenOutputRestoreIfNeeded()
        }
      })
      hiddenOutputRestoreInFlight = trackedHiddenOutputRestore
      return true
    }

    unregisterBacklogRecovery = registerTerminalBacklogRecovery(pane.terminal, () => {
      // Why: clear the hidden-delivery bit BEFORE the restore snapshot request; bytes arriving in between are reconciled by the seq guard.
      syncHiddenRendererPtyDelivery()
      return requestHiddenOutputRestoreIfNeeded()
    })
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
      unregisterDocumentVisibilityRecovery = () => {
        document.removeEventListener('visibilitychange', onDocumentVisibilityChange)
        unregisterStaleVisibilityRecovery()
      }
    }

    const dataCallback = (
      data: string,
      meta?: PtyDataMeta,
      streamGeneration = transportStreamGeneration
    ): void => {
      if (streamGeneration !== transportStreamGeneration) {
        return
      }
      if (deferredReattachLiveData !== null) {
        // Why: a replacement stream must not inherit bytes or a gap marker from the replay owner it superseded.
        deferredReattachLiveData = deferredReattachLiveData.filter((chunk) => {
          const keep = chunk.streamGeneration === streamGeneration
          if (!keep) {
            chunk.ackCredit?.()
          }
          return keep
        })
        deferredReattachLiveDataChars = deferredReattachLiveData.reduce(
          (total, chunk) => total + chunk.data.length,
          0
        )
        const oversized = data.length > MAX_DEFERRED_REATTACH_LIVE_CHARS
        const deferredData = oversized ? data.slice(-MAX_DEFERRED_REATTACH_LIVE_CHARS) : data
        const ackCredit = takeCurrentTerminalDeliveryCredit()
        deferredReattachLiveData.push({
          data: deferredData,
          ptyId: transport.getPtyId(),
          streamGeneration,
          ...(meta ? { meta } : {}),
          ...(ackCredit ? { ackCredit } : {})
        })
        deferredReattachLiveDataChars += deferredData.length
        // Why: one huge IPC frame would bypass the queue's memory bound; mark a stream gap so snapshot recovery replaces it, not a partial ANSI frame.
        let dropped = oversized
        while (
          deferredReattachLiveData.length > 1 &&
          (deferredReattachLiveData.length > MAX_DEFERRED_REATTACH_LIVE_CHUNKS ||
            deferredReattachLiveDataChars > MAX_DEFERRED_REATTACH_LIVE_CHARS)
        ) {
          const removed = deferredReattachLiveData.shift()
          deferredReattachLiveDataChars -= removed?.data.length ?? 0
          removed?.ackCredit?.()
          dropped = true
        }
        if (dropped && deferredReattachLiveData[0]) {
          deferredReattachLiveData[0].meta = {
            ...deferredReattachLiveData[0].meta,
            droppedOutput: true
          }
        }
        return
      }
      if (data.length > 0) {
        hasReceivedPtyOutput = true
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
          noteHiddenOutputRestoreFloodBackpressure()
        } else {
          // Why: main dropped buffered output at the pending cap, so the stream has a gap; repaint from the main-owned snapshot instead of writing on.
          markHiddenOutputRestoreNeeded()
          if (data) {
            // The sentinel can carry query bytes carved from the bulk drop (extractDroppedPtyQueryBytes in main); replies must still flow.
            salvageRendererQueriesFromDiscardedRestoreData(data)
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
      const reconciliation = reconcileChunkAgainstRestoredSnapshot(data, meta)
      if (reconciliation.action === 'drop-duplicate') {
        return
      }
      if (reconciliation.action === 'force-fresh-restore') {
        // Why gated (rc.7.perf loop): foreground-flood seq gaps are our own backpressure drops; snapshot-per-gap IS the loop, so retire the baseline and heal post-flood.
        if (foreground && isForegroundRestoreBackpressureContext()) {
          noteHiddenOutputRestoreFloodBackpressure()
          clearRestoredSnapshotBaseline()
          // fall through with the ORIGINAL data/meta — post-gap bytes are new
        } else {
          // Why: capture in-flight BEFORE the mark — on a visible pane the mark starts the restore synchronously and must not flag itself.
          const restoreWasInFlight = hiddenOutputRestoreInFlight !== null
          markHiddenOutputRestoreNeeded()
          if (restoreWasInFlight) {
            hiddenOutputRestoreFreshSnapshotNeeded = true
          }
          return
        }
      } else {
        data = reconciliation.data
        meta = reconciliation.meta
      }
      // Why: a hidden Codex query can split just before visibility flips; hand xterm the completed query while other bytes still follow restore.
      const pendingForegroundQuery = foreground
        ? takeHiddenStartupRendererQueryPendingForForeground(data)
        : null
      const rendererData = pendingForegroundQuery?.remainingData ?? data
      const rendererMeta = metaAfterConsumingCurrentChars(
        meta,
        pendingForegroundQuery?.consumedCurrentChars ?? 0
      )
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
      if (pendingForegroundQuery?.statelessQueryData) {
        writePtyOutputToXterm(pendingForegroundQuery.statelessQueryData, true, {
          hiddenStartupRendererQuery: true
        })
      }
      if (pendingForegroundQuery?.oscColorQueryData) {
        sendTerminalOscColorQueryReplies(
          pendingForegroundQuery.oscColorQueryData,
          pane.terminal,
          // Why: OSC color reply sent immediately so the remote debounce can't delay it past the program's read window (#7329).
          sendDesktopQueryReplyImmediate
        )
      }
      const restoreAppliesToCurrentPty =
        hiddenOutputRestorePtyId !== null && transport.getPtyId() === hiddenOutputRestorePtyId
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
        (hiddenOutputRestoreNeeded || hiddenOutputRestoreInFlight) &&
        restoreAppliesToCurrentPty
      ) {
        if (foreground) {
          if (pendingForegroundQuery?.statefulQueryData) {
            queueLiveChunkDuringRestore(pendingForegroundQuery.statefulQueryData)
          }
          queueLiveChunkDuringRestore(orderedRendererData, rendererMeta)
          requestHiddenOutputRestoreIfNeeded()
        } else if (hiddenOutputRestoreInFlight) {
          resetSkippedHiddenRendererRiskState()
          hiddenOutputRestoreNeeded = true
          hiddenOutputRestoreFreshSnapshotNeeded = true
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
    unregisterE2ePtyDataInjection = registerE2eTerminalPtyDataInjection(cacheKey, (data, meta) => {
      if (!disposed) {
        dataCallback(data, meta)
      }
    })

    const beginReattachLiveDataDeferral = (ownerGeneration = transportStreamGeneration): void => {
      reattachLiveDataDeferralDepth += 1
      if (reattachLiveDataDeferralDepth === 1) {
        deferredReattachLiveData = []
        deferredReattachLiveDataChars = 0
        deferredReattachLiveDataOwners = new Map()
      }
      if (!deferredReattachLiveDataOwners.has(ownerGeneration)) {
        deferredReattachLiveDataOwners.set(ownerGeneration, { failed: false })
      }
    }

    const finishReattachLiveDataDeferral = (
      deliver: boolean,
      acceptedGeneration = transportStreamGeneration
    ): void => {
      if (reattachLiveDataDeferralDepth <= 0) {
        return
      }
      if (!deliver) {
        const owner = deferredReattachLiveDataOwners.get(acceptedGeneration)
        if (owner) {
          owner.failed = true
        }
      }
      reattachLiveDataDeferralDepth -= 1
      if (reattachLiveDataDeferralDepth > 0) {
        return
      }
      const chunks = deferredReattachLiveData
      deferredReattachLiveData = null
      deferredReattachLiveDataChars = 0
      const currentPtyId = transport.getPtyId()
      const currentGeneration = transportStreamGeneration
      const currentOwner = deferredReattachLiveDataOwners.get(currentGeneration)
      deferredReattachLiveDataOwners = new Map()
      if (disposed || !chunks) {
        for (const chunk of chunks ?? []) {
          chunk.ackCredit?.()
        }
        return
      }
      // Why: paint the authoritative replay first, then admit deferred live chunks so the replay clear can't erase newer output.
      let deliveredDeferredChunks = 0
      for (const chunk of chunks) {
        if (
          chunk.ptyId !== currentPtyId ||
          chunk.streamGeneration !== currentGeneration ||
          currentOwner?.failed === true
        ) {
          chunk.ackCredit?.()
          continue
        }
        if (chunk.ackCredit) {
          deliverTerminalDataWithDeferredCredit(chunk.ackCredit, () => {
            dataCallback(chunk.data, chunk.meta, chunk.streamGeneration)
          })
        } else {
          dataCallback(chunk.data, chunk.meta, chunk.streamGeneration)
        }
        deliveredDeferredChunks += 1
      }
      if (deliveredDeferredChunks > 0) {
        // Why: replay restores the viewport before these newer bytes parse; settle the deferred slice, then apply the latest user intent.
        flushTerminalOutput(pane.terminal, { maxChars: MAX_DEFERRED_REATTACH_LIVE_CHARS })
        void waitForTerminalReplayWritesParsed(pane.terminal).then(() => {
          if (
            disposed ||
            !deps.isVisibleRef.current ||
            transport.getPtyId() !== currentPtyId ||
            transportStreamGeneration !== currentGeneration
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

    const handleReattachResult = async (
      result: PtyConnectResult | string | void,
      staleSessionId?: string | null,
      coldRestoreStartup?: ColdRestoreAgentResumeStartup | null,
      attemptGeneration = transportStreamGeneration
    ): Promise<boolean> => {
      if (disposed) {
        return false
      }
      if (attemptGeneration !== transportStreamGeneration) {
        return false
      }
      const connectResult =
        result && typeof result === 'object' && 'id' in result ? (result as PtyConnectResult) : null

      if (connectResult?.exitedBeforeAttach) {
        // Why: the transport already delivered the dead session's final frame + exit; treat as terminal state, not a failed reattach.
        return true
      }

      const retryPtyId =
        connectResult?.id ??
        (typeof result === 'string' ? result : (staleSessionId ?? transport.getPtyId()))
      if (rejectObsoleteDirectSshReattach(retryPtyId)) {
        // Why: an obsolete reattach must stop consuming frames without killing the durable PTY a newer lease may adopt.
        return false
      }
      const ptyId =
        connectResult?.id ?? (typeof result === 'string' ? result : transport.getPtyId())
      if (!ptyId) {
        warnTerminalLifecycleAnomaly('restored PTY reattach returned no PTY id', {
          tabId: deps.tabId,
          worktreeId: deps.worktreeId,
          leafId: deps.restoredLeafId ?? pane.leafId,
          paneId: pane.id,
          ptyId: staleSessionId ?? null
        })
        // Why: a stale restored session can fail reattach after mount; don't leave xterm alive without a backing PTY.
        if (staleSessionId) {
          deps.clearExitedPanePtyLayoutBinding(pane.id, staleSessionId)
        } else {
          deps.syncPanePtyLayoutBinding(pane.id, null)
        }
        if (staleSessionId) {
          deps.clearTabPtyId(deps.tabId, staleSessionId)
        }
        startFreshColdRestoreAgentResume(coldRestoreStartup, {
          forceBlankRestoredViewport: true
        })
        return false
      }
      registerEffectiveLaunchConfig(connectResult?.launchConfig, {
        ...(coldRestoreStartup ? { launchToken: coldRestoreStartup.launchToken } : {}),
        ...(connectResult?.launchAgent
          ? { launchAgent: connectResult.launchAgent }
          : coldRestoreStartup
            ? { launchAgent: coldRestoreStartup.agent }
            : {})
      })
      if (connectResult?.sessionExpired) {
        if (staleSessionId) {
          deps.clearExitedPanePtyLayoutBinding(pane.id, staleSessionId)
        } else {
          deps.syncPanePtyLayoutBinding(pane.id, null)
        }
        if (staleSessionId) {
          deps.clearTabPtyId(deps.tabId, staleSessionId)
        }
        // Why: SSH sleep/reconnect can invalidate the relay PTY while the tab stays mounted; replace the dead lease in-place, not a stale overlay.
        startFreshColdRestoreAgentResume(coldRestoreStartup, {
          forceBlankRestoredViewport: true
        })
        return false
      }
      const isCurrentReattachPayload = (): boolean => {
        const currentPtyId = transport.getPtyId()
        return (
          !disposed && attemptGeneration === transportStreamGeneration && currentPtyId === ptyId
        )
      }
      if (!isCurrentReattachPayload()) {
        return false
      }
      // Strict precedence snapshot > replay > coldRestore: paint exactly one, else overlapping tails duplicate TUI output on worktree switch.
      const hasStructuralReplay = Boolean(
        connectResult?.snapshot || connectResult?.replay || connectResult?.coldRestore
      )
      const resumeComesFromPassiveHibernation = Boolean(
        coldRestoreStartup &&
        !coldRestoreStartup.useLiveEntry &&
        coldRestoreStartup.sleepingRecordEntry &&
        isPassiveCompletedHibernationEvidence(coldRestoreStartup.sleepingRecordEntry.record)
      )
      // Why: reattach drops startup commands; only passive hibernation is authority to retire an empty adopted shell and resume its provider session.
      if (!hasStructuralReplay && connectResult?.isReattach && resumeComesFromPassiveHibernation) {
        transport.disconnect()
        if (staleSessionId) {
          deps.clearExitedPanePtyLayoutBinding(pane.id, staleSessionId)
          deps.clearTabPtyId(deps.tabId, staleSessionId)
        } else {
          deps.syncPanePtyLayoutBinding(pane.id, null)
        }
        startFreshColdRestoreAgentResume(coldRestoreStartup, {
          forceBlankRestoredViewport: true
        })
        return false
      }
      setPanePtyFitBinding(ptyId)
      reportPanePtyVisibility(ptyId, deps.isVisibleRef.current)
      registerSideEffectFactConsumerForPty(ptyId)
      syncHiddenRendererPtyDelivery()
      deps.syncPanePtyLayoutBinding(pane.id, ptyId)
      notifyCodexPaneBoundForStaleSweep(ptyId)
      if (hasCapturedDirectSshRetryPtyAccepted() && directSshRetryAttempt) {
        deps.updateTabPtyId(deps.tabId, ptyId, undefined, directSshRetryAttempt.attemptId)
      } else {
        deps.updateTabPtyId(deps.tabId, ptyId)
      }
      agentCompletionCoordinator.startProcessTracking()
      sampleVisiblePaneForegroundAgent()

      // Why: mobile streaming needs xterm's exact screen state; install the serializer + lastTitle source for main-process hydration parity.
      registerPaneSerializerFor(ptyId)

      // Why (C1 SSH parking): main's headless model holds ~5k rows for SSH ptys
      // while the relay replay is a 100KiB raw-byte tail; prefer the model on
      // reveal. Only a non-empty 'headless'-sourced snapshot qualifies — the
      // renderer-serializer fallback has no mounted xterm after a park. The
      // paint happens inline in the snapshot-branch style: applyMainBufferSnapshot
      // would nest structuralReplayCoordinator.run inside the reattach task and
      // deadlock on the coordinator's tail chain.
      // Memoized: the prefetch and the payload task share one probe result, so a
      // null prefetch can never buy a second timeout before the relay paint.
      const fetchSshMainModelReattachSnapshot = memoizeSshReattachModelSnapshotProbe(
        async (): Promise<PtyBufferSnapshot | null> => {
          const sshParkingEnabled =
            useAppStore.getState().settings?.terminalSshViewParking !== false
          if (!shouldFetchSshReattachModelSnapshot({ ptyId, sshParkingEnabled })) {
            return null
          }
          const snapshot = await resolveSshReattachModelSnapshotWithTimeout(
            getClientRuntime().terminal.getMainBufferSnapshot(ptyId, {
              scrollbackRows: resolveHiddenRestoreScrollbackRows(pane.terminal.options.scrollback)
            })
          )
          if (
            !snapshot ||
            decideSshReattachPaintSource({ ptyId, sshParkingEnabled, snapshot }) !==
              'main-model-snapshot'
          ) {
            return null
          }
          return snapshot
        }
      )
      // Why consume-once: only the first reattach of a reveal remount may pay
      // the probe; a later in-place reconnect on this same mount must not buy a
      // second timeout before the relay paint.
      const revealFollowsTerminalPark =
        mountFollowsTerminalPark &&
        (connectResult?.isReattach === true || isRemoteRuntimePtyId(ptyId))
      mountFollowsTerminalPark = false
      // Why: ordinary parking destroys xterm. Rebuild from the authoritative
      // host snapshot before releasing queued live bytes; null falls back to
      // the subscribe screen without keeping the old xterm mounted.
      let prefetchedParkModelSnapshot: PtyBufferSnapshot | null = null
      if (revealFollowsTerminalPark && (!hasStructuralReplay || isRemoteRuntimePtyId(ptyId))) {
        if (parseAppSshPtyId(ptyId)) {
          prefetchedParkModelSnapshot = await fetchSshMainModelReattachSnapshot()
        } else {
          try {
            prefetchedParkModelSnapshot = await serializeHiddenOutputSnapshot(ptyId, {
              scrollbackRows: resolveHiddenRestoreScrollbackRows(pane.terminal.options.scrollback)
            })
          } catch {
            prefetchedParkModelSnapshot = null
          }
        }
        if (!isCurrentReattachPayload()) {
          return false
        }
      }
      let reattachPayloadApplied = !hasStructuralReplay && prefetchedParkModelSnapshot === null
      const applyReattachPayload = async (): Promise<void> => {
        if (!isCurrentReattachPayload()) {
          return
        }
        if (connectResult?.snapshot) {
          rememberReattachPayloadAgentSignal(connectResult.snapshot, { fullScreenReplay: true })
          // Why: replay at the snapshot's own dimensions to avoid rewrapping soft-wrapped rows at a different column count (#7279); suppress the PTY forward so this layout-only resize doesn't SIGWINCH the remote TUI.
          const snapshotDimensions = resolvePositiveTerminalDimensions(
            connectResult.snapshotCols,
            connectResult.snapshotRows
          )
          if (
            snapshotDimensions &&
            (pane.terminal.cols !== snapshotDimensions.cols ||
              pane.terminal.rows !== snapshotDimensions.rows)
          ) {
            suppressStructuralReplayPtyResize = true
            try {
              pane.terminal.resize(snapshotDimensions.cols, snapshotDimensions.rows)
            } finally {
              suppressStructuralReplayPtyResize = false
            }
          }
          writeReplayData('\x1b[2J\x1b[3J\x1b[H')
          // Why: re-arm the kitty keyboard mirror from the snapshot preamble so Option chords keep their encoding after a window reload.
          kittyKeyboardModes.scanReplay(connectResult.snapshot)
          writeReplayData(connectResult.snapshot)
          // Snapshot reattach keeps a live session, so drop only renderer-owned state instead of the broader mode reset.
          writeReplayData(reattachReplayResetSequence(connectResult.snapshot))
          if (connectResult.pendingEscapeTailAnsi) {
            // Why last: re-arm the dangling mid-escape after the reset (whose ESC would abort it) so the live continuation completes it (#7329).
            writeReplayData(connectResult.pendingEscapeTailAnsi)
          }
          sendFocusedReattachFocusInAfterReplay(ptyId, attemptGeneration)
          if (connectResult.coldRestore) {
            // Snapshot superseded the cold-restore payload; ack so the daemon doesn't redeliver it.
            if (!isRemoteRuntimePtyId(ptyId)) {
              getClientRuntime().terminal.ackColdRestore(ptyId)
            }
          }
        } else if (connectResult?.replay || prefetchedParkModelSnapshot) {
          // Why scoped to a park-reveal: the 100KiB relay tail loses scrollback the
          // model still holds, but an in-place reattach (network reconnect, wake,
          // reload) already has that replay in hand, so probing would only delay its
          // paint by the timeout. Memoized, so this is never a second probe.
          const modelSnapshot = revealFollowsTerminalPark
            ? (prefetchedParkModelSnapshot ??
              (isRemoteRuntimePtyId(ptyId) ? null : await fetchSshMainModelReattachSnapshot()))
            : null
          if (!isCurrentReattachPayload()) {
            return
          }
          if (modelSnapshot) {
            // Why composed for scan/reset only: kitty + reset heuristics need
            // the full byte stream; the actual writes go through the shared
            // alt-screen choreography below (scrollbackAnsi is '' for
            // normal-buffer snapshots, so composition matches data there).
            const modelData = `${modelSnapshot.scrollbackAnsi ?? ''}${modelSnapshot.data}`
            rememberReattachPayloadAgentSignal(modelData, { fullScreenReplay: true })
            const modelCols = modelSnapshot.cols
            const modelRows = modelSnapshot.rows
            if (
              hasPositiveTerminalDimensions(modelCols, modelRows) &&
              (pane.terminal.cols !== modelCols || pane.terminal.rows !== modelRows)
            ) {
              // Why: replay at the snapshot's own dimensions (see the daemon-snapshot branch, #7279).
              suppressStructuralReplayPtyResize = true
              try {
                pane.terminal.resize(modelCols, modelRows)
              } finally {
                suppressStructuralReplayPtyResize = false
              }
            }
            kittyKeyboardModes.scanReplay(modelData)
            // Why shared: park+reveal of an alt-screen TUI needs the same
            // ?1049l/?1049h rebuild as applyMainBufferSnapshot (main strips
            // the ?1049h marker when splitting scrollbackAnsi) — inlined here
            // because nesting structuralReplayCoordinator would deadlock.
            for (const replayChunk of buildMainModelSnapshotReplayWrites(modelSnapshot)) {
              writeReplayData(replayChunk)
            }
            writeReplayData(reattachReplayResetSequence(modelData))
            if (modelSnapshot.pendingEscapeTailAnsi) {
              // Why last: re-arm the dangling mid-escape after the reset so the live continuation completes it (#7329).
              writeReplayData(modelSnapshot.pendingEscapeTailAnsi)
            }
            // Why: main sampled its delivery backlog with the snapshot; the baseline drops/slices deferred and live chunks the snapshot already covers.
            setRestoredSnapshotBaseline(ptyId, modelSnapshot)
            recordRendererOrderedSeq(modelSnapshot)
            sendFocusedReattachFocusInAfterReplay(ptyId, attemptGeneration)
            if (connectResult?.coldRestore && !isRemoteRuntimePtyId(ptyId)) {
              getClientRuntime().terminal.ackColdRestore(ptyId)
            }
          } else if (connectResult?.replay) {
            rememberReattachPayloadAgentSignal(connectResult.replay, { fullScreenReplay: true })
            // Relay replay may overlap xterm's pre-disconnect content; clear first to avoid duplication.
            writeReplayData('\x1b[2J\x1b[3J\x1b[H')
            // Why: raw relay replay may contain the app's own kitty pushes; re-arm with set semantics so redelivery can't grow the stack.
            kittyKeyboardModes.scanReplay(connectResult.replay)
            writeReplayData(connectResult.replay)
            writeReplayData(reattachReplayResetSequence(connectResult.replay))
            sendFocusedReattachFocusInAfterReplay(ptyId, attemptGeneration)
            if (connectResult.coldRestore) {
              if (!isRemoteRuntimePtyId(ptyId)) {
                getClientRuntime().terminal.ackColdRestore(ptyId)
              }
            }
          }
        } else if (connectResult?.coldRestore) {
          let destinationRows = pane.terminal.rows
          try {
            const proposedDestination = pane.fitAddon.proposeDimensions()
            if (
              proposedDestination &&
              Number.isFinite(proposedDestination.rows) &&
              proposedDestination.rows > 0
            ) {
              destinationRows = Math.max(destinationRows, proposedDestination.rows)
            }
          } catch {
            // The current xterm grid remains a safe lower bound for blanking.
          }
          // Why: shrinking first would promote clipped stale viewport rows into scrollback, beyond the reach of a later viewport-only clear.
          writeReplayData('\x1b[2J\x1b[H')
          await waitForTerminalReplayWritesParsed(pane.terminal)
          if (!isCurrentReattachPayload()) {
            return
          }
          const coldRestoreDimensions = resolvePositiveTerminalDimensions(
            connectResult.coldRestore.cols,
            connectResult.coldRestore.rows
          )
          if (
            coldRestoreDimensions &&
            (pane.terminal.cols !== coldRestoreDimensions.cols ||
              pane.terminal.rows !== coldRestoreDimensions.rows)
          ) {
            // Why: recovered ANSI cursor positions belong to the checkpoint's grid; keep this layout-only resize from reaching the fresh PTY.
            suppressStructuralReplayPtyResize = true
            try {
              pane.terminal.resize(coldRestoreDimensions.cols, coldRestoreDimensions.rows)
            } finally {
              suppressStructuralReplayPtyResize = false
            }
          }
          // Why: recorded scrollback is raw PTY output that may hold query sequences; xterm.write would auto-reply into the new shell's stdin. See replay-guard.ts.
          writeReplayData(connectResult.coldRestore.scrollback)
          const preparedStartup = coldRestoreStartup ?? buildColdRestoreAgentResumeStartup()
          const didPrepareResume = applyColdRestoreAgentResumeStartup(preparedStartup)
          if (didPrepareResume) {
            if (connectResult.agentResumeUnavailable) {
              // Why: main dropped the resume argv, so this pane is a NEW session —
              // the plain restored banner would claim the old one came back.
              showSessionRestoredBanner('resume-unavailable')
            } else if (preparedStartup?.hasSleepingRecord) {
              showSessionRestoredBanner()
            }
            clearSleepingRecordAfterColdRestoreSpawn(preparedStartup)
          }
          // Why: cold-restore spawned a fresh shell; reset mode bytes a crashed TUI (e.g. Claude's \e[?1004h) left in scrollback that no live TUI now consumes.
          writeReplayData(POST_REPLAY_MODE_RESET)
          // Why: the dead run's kitty flags died with it and its scrollback was never scanned — the fresh shell starts at zero.
          kittyKeyboardModes.reset()
          consumeRestoredViewportBlankingMarker()
          // Why: a taller destination fit must not pull recovered rows back into the fresh shell's viewport after source-grid replay.
          writeFreshShellViewportBlanking(Math.max(destinationRows, pane.terminal.rows))
          if (!isRemoteRuntimePtyId(ptyId)) {
            getClientRuntime().terminal.ackColdRestore(ptyId)
          }
          if (didPrepareResume && !coldRestoreStartup) {
            schedulePendingStartupCommandDelivery()
          }
        }
        if (hasStructuralReplay || prefetchedParkModelSnapshot) {
          await waitForTerminalReplayWritesParsed(pane.terminal)
          if (!isCurrentReattachPayload()) {
            return
          }
          reattachPayloadApplied = true
        }
      }

      const fitAfterReattachRestore = async (): Promise<void> => {
        if (!isCurrentReattachPayload()) {
          return
        }
        const reattachPtyId = transport.getPtyId()
        if (!reattachPtyId) {
          return
        }
        if (!getFitOverrideForPty(reattachPtyId)) {
          const fit = safeFitAndThen(
            pane,
            'reattach-pty-resize',
            () => {
              if (!isCurrentReattachPayload() || transport.getPtyId() !== reattachPtyId) {
                return
              }
              const reattachCols = pane.terminal.cols
              const reattachRows = pane.terminal.rows
              if (reattachCols > 0 && reattachRows > 0) {
                transport.resize(reattachCols, reattachRows)
              }
              // Why: POSIX only sends SIGWINCH on an actual dimension change; signal explicitly so restored TUIs repaint at the correct cursor after replay.
              if (!isRemoteRuntimePtyId(reattachPtyId)) {
                getClientRuntime().terminal.signal(reattachPtyId, 'SIGWINCH')
              }
            },
            { shouldContinue: isCurrentReattachPayload, retryIfUnmeasurable: true }
          )
          pendingReattachFit = fit
          let fitCompleted = false
          try {
            fitCompleted = await fit.completion
          } finally {
            if (pendingReattachFit === fit) {
              pendingReattachFit = null
            }
          }
          if (fitCompleted && isCurrentReattachPayload() && deps.isVisibleRef.current) {
            // Why: reattach resize is fire-and-forget; verify the provider's applied grid while this reveal still owns the visible pane.
            sizeReassertionController.request()
          }
        } else if (isCurrentReattachPayload() && !isRemoteRuntimePtyId(reattachPtyId)) {
          getClientRuntime().terminal.signal(reattachPtyId, 'SIGWINCH')
        }
      }
      if (hasStructuralReplay || prefetchedParkModelSnapshot) {
        await structuralReplayCoordinator.run(applyReattachPayload, {
          shouldRestore: isCurrentReattachPayload,
          afterRestore: fitAfterReattachRestore
        })
      } else {
        await applyReattachPayload()
        await fitAfterReattachRestore()
      }
      if (!isCurrentReattachPayload() || !reattachPayloadApplied) {
        return false
      }
      scheduleReattachIdleAgentCursorReset()

      scheduleRuntimeGraphSync()
      return true
    }

    const reattachAttemptController = createPtyConnectionReattachAttemptController({
      transport,
      cacheKey,
      runtimeEnvironmentId,
      cols,
      rows,
      captureTransportOutputCallbacks,
      getTransportStreamGeneration: () => transportStreamGeneration,
      beginLiveDataDeferral: beginReattachLiveDataDeferral,
      finishLiveDataDeferral: finishReattachLiveDataDeferral,
      handleReattachResult,
      settlePaneSerializerAfterReplay,
      mergeStartupEnvWithPaneIdentity,
      shouldDeclareHiddenAtSpawn,
      directSshRetryAttempt,
      claimCapturedDirectSshRetryPty,
      armDirectSshPaneRetryTimeout,
      setConnectInFlightSince: (value) => {
        transportConnectInFlightSince = value
      }
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
      // Why: a removed SSH target (ghost workspace) would fail reattach with a spurious "file an issue" banner for an expected action, so skip it (runtime-owned targets exempt).
      // A present map missing this id = target removed; an absent map = not yet hydrated (test stubs), so don't treat it as gone.
      if (
        !isRuntimeOwnedSshTargetId(connectionId) &&
        storeState.sshTargetLabels instanceof Map &&
        !storeState.sshTargetLabels.has(connectionId)
      ) {
        return
      }
      const restoredLeafSessionId =
        deps.restoredLeafId && deps.restoredPtyIdByLeafId
          ? (deps.restoredPtyIdByLeafId[deps.restoredLeafId] ?? null)
          : null
      const gate = resolveSshPaneConnectGate({
        connectionId,
        sshStatus: storeState.sshConnectionStates.get(connectionId)?.status,
        isDeferredTarget: storeState.deferredSshReconnectTargets.includes(connectionId),
        restoredLeafSessionId,
        deferredTabSessionId: storeState.deferredSshSessionIdsByTabId[deps.tabId],
        tabPtyId: storeState.tabsByWorktree[deps.worktreeId]?.find((t) => t.id === deps.tabId)
          ?.ptyId,
        hasLeafSessionMap: Boolean(
          deps.restoredPtyIdByLeafId && Object.keys(deps.restoredPtyIdByLeafId).length > 0
        )
      })
      const pendingSessionId = gate.pendingSessionId
      console.warn(
        `[pty-connection] SSH tab=${deps.tabId} connectionId=${connectionId} pendingSessionId=${pendingSessionId} sshConnected=${gate.sshConnected}`
      )
      const legacyWorkerOwnsPane = isLegacyWorkerAutomaticResumeBlocked()
      if (gate.enterDeferredFlow && (!legacyWorkerOwnsPane || !gate.sshConnected)) {
        void (async () => {
          // Why: for a passphrase target with no cached credential, don't auto-fire ssh.connect — a prompt popping just from focusing a tab / Cmd+J would surprise the user.
          // Wait for a user-initiated connect first; no-passphrase targets return false here and auto-connect as before.
          let needsPrompt = false
          try {
            needsPrompt = await getClientRuntime().ssh.needsPassphrasePrompt({
              targetId: connectionId
            })
          } catch (err) {
            console.warn('[pty-connection] needsPassphrasePrompt probe failed:', err)
            // Why: on probe failure fall through to auto-connect rather than stranding the tab — a stuck tab is worse than a surprising prompt.
          }
          if (disposed || !capturedDirectSshRetryLeaseMatches()) {
            return
          }
          if (needsPrompt) {
            const alreadyConnected =
              useAppStore.getState().sshConnectionStates.get(connectionId)?.status === 'connected'
            if (!alreadyConnected) {
              // Wait for the user-driven connect (SshDisconnectedDialog → passphrase → ssh.connect) to complete.
              // Why: resolve on terminal-failure statuses too ('auth-failed'/'error'/'reconnection-failed') so it can't hang forever if the user cancels or the connect fails.
              const outcome = await new Promise<UserInitiatedSshConnectOutcome>((resolve) => {
                // Why: 'disconnected' counts as terminal only after a non-disconnected status was seen (a real connect attempt that returned to 'disconnected').
                // Treating the entry-time 'disconnected' as terminal would skip the gate, defeating the passphrase-prompt deferral.
                let sawNonDisconnected =
                  useAppStore.getState().sshConnectionStates.get(connectionId)?.status !==
                    'disconnected' &&
                  useAppStore.getState().sshConnectionStates.get(connectionId)?.status !== undefined
                let resolvedOutcome: UserInitiatedSshConnectOutcome = 'cancelled'
                let settled = false
                const finish = (nextOutcome: UserInitiatedSshConnectOutcome): void => {
                  if (settled) {
                    return
                  }
                  resolvedOutcome = nextOutcome
                  settled = true
                  unsub()
                  const idx = waitTeardowns.indexOf(teardown)
                  if (idx !== -1) {
                    waitTeardowns.splice(idx, 1)
                  }
                  resolve(resolvedOutcome)
                }
                const teardown = (): void => finish('cancelled')
                // Why: register a teardown so dispose() can unsubscribe+resolve if the pane is torn down mid-wait.
                // Else the zustand subscriber + async IIFE leak: the callback only checks `disposed` when it next fires, which may never happen.
                waitTeardowns.push(teardown)
                const unsub = useAppStore.subscribe((state) => {
                  if (disposed) {
                    finish('cancelled')
                    return
                  }
                  const status = state.sshConnectionStates.get(connectionId)?.status
                  if (status && status !== 'disconnected') {
                    sawNonDisconnected = true
                  }
                  const nextOutcome = sshPromptConnectOutcomeForStatus(status, sawNonDisconnected)
                  if (nextOutcome) {
                    finish(nextOutcome)
                  }
                })
                // Why: re-read state after subscribing to catch a status change that landed between the alreadyConnected check and the subscribe — else we'd wait forever.
                if (disposed) {
                  finish('cancelled')
                  return
                }
                const currentStatus = useAppStore
                  .getState()
                  .sshConnectionStates.get(connectionId)?.status
                const currentOutcome = sshPromptConnectOutcomeForStatus(
                  currentStatus,
                  sawNonDisconnected
                )
                if (currentOutcome) {
                  finish(currentOutcome)
                }
              })
              if (disposed || !capturedDirectSshRetryLeaseMatches()) {
                return
              }
              if (outcome === 'cancelled') {
                return
              }
              if (outcome === 'failed') {
                reportError('SSH connection failed')
                return
              }
            }
          }

          // Why: wait for the shared SSH connection (multiple panes/tabs may need it) before PTY reattach, rather than returning early when it's in-flight.
          const connectResult = await waitForSshConnection(connectionId)
          if (disposed || !capturedDirectSshRetryLeaseMatches()) {
            return
          }
          if (!connectResult.connected) {
            reportError(`SSH connection failed: ${connectResult.error}`)
            return
          }
          useAppStore.getState().removeDeferredSshReconnectTarget(connectionId)
          if (disposed) {
            return
          }
          if (pendingSessionId) {
            if (isLegacyWorkerAutomaticResumeBlocked()) {
              if (attachController.attachRetainedLegacyPty(pendingSessionId)) {
                useAppStore.getState().removeDeferredSshSessionId(deps.tabId)
                scheduleRuntimeGraphSync()
              }
              return
            }
            console.warn(
              `[pty-connection] Attempting reattach for tab=${deps.tabId} sessionId=${pendingSessionId}`
            )
            // Why: the saved remote PTY id is single-use restore metadata; clear it before attach so remounts don't keep retrying an expired session.
            useAppStore.getState().removeDeferredSshSessionId(deps.tabId)
            const coldRestoreStartup = buildColdRestoreAgentResumeStartup()
            clearPaneMode2031State()
            clearHiddenOutputRestoreState()
            void reattachAttemptController.attempt({
              sessionId: pendingSessionId,
              coldRestoreStartup,
              onTransportError: (message) => {
                if (isCapturedDirectSshReattachCurrent(pendingSessionId)) {
                  reportError(message)
                }
              },
              onResult: (result) => {
                console.warn(
                  `[pty-connection] Reattach result for tab=${deps.tabId}:`,
                  result
                    ? {
                        sessionExpired: (result as Record<string, unknown>).sessionExpired,
                        replay: !!(result as Record<string, unknown>).replay
                      }
                    : 'undefined'
                )
              },
              onExpired: () => {
                if (disposed || rejectObsoleteDirectSshReattach(pendingSessionId)) {
                  return
                }
                deps.clearExitedPanePtyLayoutBinding(pane.id, pendingSessionId)
                deps.clearTabPtyId(deps.tabId, pendingSessionId)
                startFreshColdRestoreAgentResume(coldRestoreStartup, {
                  forceBlankRestoredViewport: true
                })
              },
              onRejected: (err, generation) => {
                console.warn(`[pty-connection] Reattach FAILED for tab=${deps.tabId}:`, err)
                if (disposed || generation !== transportStreamGeneration) {
                  return
                }
                if (rejectObsoleteDirectSshReattach(pendingSessionId)) {
                  return
                }
                if (isSshSessionExpiredError(err)) {
                  deps.clearExitedPanePtyLayoutBinding(pane.id, pendingSessionId)
                  deps.clearTabPtyId(deps.tabId, pendingSessionId)
                  startFreshColdRestoreAgentResume(coldRestoreStartup, {
                    forceBlankRestoredViewport: true
                  })
                  return
                }
                startFreshColdRestoreAgentResume(coldRestoreStartup, {
                  forceBlankRestoredViewport: true
                })
              }
            })
          } else {
            startFreshColdRestoreAgentResume()
          }
        })()
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

    // Why: the tab-level fallback must not steal a PTY a setup sibling already published while the main pane waited for split geometry.
    const existingPtyClaimedBySibling = Boolean(
      existingPtyId &&
      Array.from(deps.paneTransportsRef.current.entries()).some(
        ([candidatePaneId, candidateTransport]) =>
          candidatePaneId !== pane.id && candidateTransport.getPtyId() === existingPtyId
      )
    )
    const {
      sleptRemoteRuntimeSessionId,
      detachedLivePtyId,
      detachedRemoteLeafPtyId,
      eagerLivePtyId,
      legacyAttachOnlyPtyId,
      deferredReattachSessionId,
      attachPtyId,
      attachUsesEagerBuffer
    } = resolvePtyConnectionAttachCandidate({
      restoredPtyId,
      existingPtyId,
      existingPtyClaimedBySibling,
      hadExistingPaneTransportAtConnect,
      hasSleepingAgentSession,
      currentTabLivePtyIds: storeSnapshot.ptyIdsByTabId[deps.tabId] ?? [],
      runtimeEnvironmentId,
      mountFollowsTerminalPark,
      worktreeId: deps.worktreeId,
      legacyWorkerAutomaticResumeBlocked: isLegacyWorkerAutomaticResumeBlocked(),
      isRemoteRuntimePtyId,
      hasEagerBuffer: (ptyId) => Boolean(getEagerPtyBufferHandle(ptyId)),
      canRestorePairedParkedTerminal,
      isSessionOwnedByWorktree
    })
    const sleptRemoteColdRestoreStartup = sleptRemoteRuntimeSessionId
      ? buildColdRestoreAgentResumeStartup()
      : null
    if (sleptRemoteRuntimeSessionId) {
      deps.syncPanePtyLayoutBinding(pane.id, null)
      deps.clearTabPtyId(deps.tabId, sleptRemoteRuntimeSessionId)
    }
    recordPtyConnectDiagnostic(
      `pane=${pane.id} tab=${deps.tabId} restored=${restoredPtyId} existing=${existingPtyId} detached=${detachedRemoteLeafPtyId ?? detachedLivePtyId} reattach=${deferredReattachSessionId} hasTransport=${hadExistingPaneTransportAtConnect} pendingKey=${pendingSpawnKey}`
    )

    if (deferredReattachSessionId) {
      allowInitialIdleCacheSeed = true
      recordPtyConnectDiagnostic(`pane=${pane.id} -> REATTACH ${deferredReattachSessionId}`)
      const coldRestoreStartup = buildColdRestoreAgentResumeStartup()
      void reattachAttemptController.attempt({
        sessionId: deferredReattachSessionId,
        coldRestoreStartup,
        onTransportError: (message) => {
          if (isCapturedDirectSshReattachCurrent(deferredReattachSessionId)) {
            reportError(message)
          }
        },
        onExpired: () => {
          if (disposed || rejectObsoleteDirectSshReattach(deferredReattachSessionId)) {
            return
          }
          deps.clearExitedPanePtyLayoutBinding(pane.id, deferredReattachSessionId)
          deps.clearTabPtyId(deps.tabId, deferredReattachSessionId)
          startFreshColdRestoreAgentResume(coldRestoreStartup, {
            forceBlankRestoredViewport: true
          })
        },
        onRejected: (err, generation) => {
          const message = err instanceof Error ? err.message : String(err)
          if (generation !== transportStreamGeneration) {
            return
          }
          if (rejectObsoleteDirectSshReattach(deferredReattachSessionId)) {
            return
          }
          warnTerminalLifecycleAnomaly('restored PTY reattach threw', {
            tabId: deps.tabId,
            worktreeId: deps.worktreeId,
            leafId: deps.restoredLeafId ?? pane.leafId,
            paneId: pane.id,
            ptyId: deferredReattachSessionId,
            reason: message
          })
          deps.clearExitedPanePtyLayoutBinding(pane.id, deferredReattachSessionId)
          deps.clearTabPtyId(deps.tabId, deferredReattachSessionId)
          if (connectionId && isSshSessionExpiredError(err)) {
            startFreshColdRestoreAgentResume(coldRestoreStartup, {
              forceBlankRestoredViewport: true
            })
            return
          }
          reportError(message)
          startFreshColdRestoreAgentResume(coldRestoreStartup, {
            forceBlankRestoredViewport: true
          })
        }
      })
    } else if (attachPtyId) {
      // Why: mirrored web-leaf panes must attach to their exact remote PTY, not spawn a replacement host tab.
      // eagerLivePtyId covers a still-live background PTY (e.g. an automation agent) with a live eager buffer to adopt.
      recordPtyConnectDiagnostic(`pane=${pane.id} -> ATTACH detached=${attachPtyId}`)
      allowInitialIdleCacheSeed = false
      if (legacyAttachOnlyPtyId) {
        if (attachController.attachRetainedLegacyPty(legacyAttachOnlyPtyId) && connectionId) {
          useAppStore.getState().removeDeferredSshSessionId(deps.tabId)
        }
      } else {
        // Why: surface synchronous attach failures via reportError so the pane shows a diagnostic instead of a blank surface.
        // On throw, clear the stale ptyId from the tab and fresh-spawn — else the next remount reads the same dead id and loops here.
        if (!attachController.attachDetachedPty(attachPtyId, attachUsesEagerBuffer)) {
          deps.clearTabPtyId(deps.tabId, attachPtyId)
          startFreshSpawn()
        }
      }
    } else {
      allowInitialIdleCacheSeed = false
      const pendingSpawn = pendingSpawnByPaneKey.get(pendingSpawnKey)
      if (pendingSpawn) {
        recordPtyConnectDiagnostic(`pane=${pane.id} -> PENDING SPAWN`)
        armDirectSshPaneRetryTimeout(pendingSpawn, directSshRetryAttempt)
        void pendingSpawn
          .then((spawnedPtyId) => {
            if (disposed) {
              return
            }
            if (transport.getPtyId()) {
              return
            }
            if (!spawnedPtyId) {
              // Why: React StrictMode can mount+spawn then immediately remount; if the first mount produced no PTY id,
              // the remounted pane must issue its own spawn instead of attaching to a completed-but-empty promise (a dead surface).
              if (!isWebTerminalSurfaceTabId(deps.tabId)) {
                console.warn(
                  `Pending PTY spawn for tab ${deps.tabId} resolved without a PTY id, retrying fresh spawn`
                )
              }
              if (sleptRemoteColdRestoreStartup || hasSleepingAgentSession) {
                startFreshColdRestoreAgentResume(sleptRemoteColdRestoreStartup ?? undefined)
              } else {
                startFreshSpawn()
              }
              return
            }
            if (!canAdoptCapturedDirectSshRetryPty(spawnedPtyId)) {
              return
            }
            // Why: this reuses a PTY spawned by an earlier mount, so no later spawn event will bind this remounted pane's DOM/container.
            attachController.adoptPendingSpawn(spawnedPtyId)
          })
          .catch((err) => {
            reportError(err instanceof Error ? err.message : String(err))
          })
      } else {
        recordPtyConnectDiagnostic(`pane=${pane.id} -> FRESH SPAWN`)
        if (sleptRemoteColdRestoreStartup || hasSleepingAgentSession) {
          startFreshColdRestoreAgentResume(sleptRemoteColdRestoreStartup ?? undefined)
        } else {
          startFreshSpawn()
        }
      }
    }
    scheduleRuntimeGraphSync()
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
    getPtyBoundAt: () => activePanePtyBindingBoundAt,
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
      consumeHibernatedAgentWake()
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
      if (hibernatedWakeInFlightClaimKey) {
        if (claimedProviderSessions?.has(hibernatedWakeInFlightClaimKey)) {
          return null
        }
        claimedProviderSessions?.add(hibernatedWakeInFlightClaimKey)
        return hibernatedWakeInFlightClaimKey
      }
      const consumedClaimKey = consumeHibernatedAgentWake(claimedProviderSessions)
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
        hibernatedWakeTarget === null &&
        deps.paneTransportsRef.current.get(pane.id) === transport &&
        transport.getPtyId() === currentPtyId
      ) {
        const claimKey = getProviderSessionClaimKey(recordEntry.record)
        if (claimedProviderSessions?.has(claimKey)) {
          return null
        }
        claimedProviderSessions?.add(claimKey)
        pendingHibernatedWakeTarget = { ptyId: currentPtyId, record: recordEntry.record }
        return claimKey
      }
      return null
    },
    sampleForegroundAgentOnFocus() {
      requestKnownDroidReconfirmation()
      sampleVisiblePaneForegroundAgent()
    },
    requestDroidReconfirmation() {
      if (shiftEnterReconfirmTimer !== null) {
        clearTimeout(shiftEnterReconfirmTimer)
      }
      // Why: confirm the Droid composer only after the Shift+Enter burst goes idle, to preserve rapid multiline input.
      shiftEnterReconfirmTimer = setTimeout(() => {
        shiftEnterReconfirmTimer = null
        requestKnownDroidReconfirmation()
        sampleVisiblePaneForegroundAgent()
      }, SHIFT_ENTER_RECONFIRM_IDLE_MS)
    },
    reconcileIfSessionDead: sessionLivenessReconcileController.reconcileIfSessionDead,
    reconcileIfSessionMissing: sessionLivenessReconcileController.reconcileIfSessionMissing,
    dispose() {
      disposed = true
      disposeDirectSshRetryController()
      // Why: a stalled xterm replay may never reach its finally; release live-frame credit when this renderer no longer owns the stream.
      for (const chunk of deferredReattachLiveData ?? []) {
        chunk.ackCredit?.()
      }
      deferredReattachLiveData = null
      deferredReattachLiveDataChars = 0
      reattachLiveDataDeferralDepth = 0
      deferredReattachLiveDataOwners = new Map()
      cancelPendingSafeFitContinuations(pane)
      pendingHiddenSnapshotFit = null
      pendingReattachFit = null
      // Why: park/reconnect/remount doesn't advance the recovery epoch, so invalidate this xterm or its delayed retry could hit the next instance.
      terminalRecoveryInstance.unregister()
      unregisterUndeliverableWriteHandler()
      remoteViewportClaimController.dispose()
      cancelHiddenOutputSnapshotScrollRestore()
      structuralReplayCoordinator.dispose()
      cancelFreshSpawnFollowReset()
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
      clearTitleOnlyInterruptTimer()
      // Why release, not cancel: the pending settle belongs to the turn, not to
      // this pane — a park mid-settle hands it to the parked watcher instead.
      releaseCommandCodeDoneSettleExecutor()
      if (shiftEnterReconfirmTimer !== null) {
        clearTimeout(shiftEnterReconfirmTimer)
        shiftEnterReconfirmTimer = null
      }
      // Why: resolve in-flight passphrase-gate waits so their zustand subscribers + async IIFEs don't hang when the pane is torn down before SSH state changes.
      while (waitTeardowns.length > 0) {
        const teardown = waitTeardowns.pop()
        teardown?.()
      }
      cleanupStartupDelivery()
      releaseUnattemptedStartupDraftPasteDelivery()
      unregisterAgentHookTerminalLifecycle()
      clearSuppressedTitleSideEffects()
      disposeAgentNotificationController()
      clearReattachIdleAgentCursorResetTimer()
      if (alternateScreenBackgroundRepaintTimer !== null) {
        clearTimeout(alternateScreenBackgroundRepaintTimer)
        alternateScreenBackgroundRepaintTimer = null
      }
      cleanupHiddenOutputRestoreDeferredRetry()
      cleanupHiddenOutputRestoreForegroundDeadline()
      cleanupHiddenOutputRestoreFloodRepaint()
      unregisterBacklogRecovery?.()
      unregisterBacklogRecovery = null
      unregisterDocumentVisibilityRecovery?.()
      unregisterDocumentVisibilityRecovery = null
      releaseRendererPtyVisibilityClaim(transport)
      // Why: the pane's fact consumer must be gone before a parked-tab watcher takes over this PTY's facts in the same effect flush.
      dropSideEffectFactConsumer()
      clearPanePtyFitBinding()
      discardTerminalOutput(pane.terminal)
      unregisterE2ePtyDataInjection()
      if (unsubscribeWindowsDoneTerminalModeReset !== null) {
        unsubscribeWindowsDoneTerminalModeReset()
        unsubscribeWindowsDoneTerminalModeReset = null
      }
      imeCompositionRouteDisposable.dispose()
      onDataDisposable.dispose()
      userInputActivityDisposable?.dispose()
      terminalCapabilityRepliesDisposable.dispose()
      resizeForwardingController.dispose()
      onBufferChangeDisposable?.dispose()
      paneGeometryController.dispose()
      commandLifecycle.dispose()
      deferredCommandFinishedStatusDrop = null
      visibleForegroundSamplePending = false
      visibleForegroundSampleSettled = false
      paneForegroundAgentTracker.dispose()
      agentCompletionCoordinator.dispose()
    }
  }
}
