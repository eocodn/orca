import { detectAgentStatusFromTitle, isClaudeManagementTitle, isCursorNativeAgentTitle, isShellProcess, normalizeTerminalTitle, extractOscTitleScanTail, normalizeFolderWorkspaceOperationId, isServerDriveListRequest, listWindowsDrives, extractLastOsc7Uri, extractOscScanTail, parseFileUriPathParts, type AgentStatus, type TerminalOscLinkRange, type TerminalOscColorQueryReplyColors, type TerminalOutputSourceRange, type RemoteTerminalSourceRangeConsumerHooks, type RemoteTerminalSourceRangeReplacementPublication, type RemoteTerminalSourceRangeReplacementReservation, type RemoteTerminalSourceRangeStreamIdentity, createTerminalTitleTracker, stripBrailleSpinnerGlyphs, type TerminalTitleTracker, createCommandCodeOutputStatusDetector, type TerminalSideEffectBatch, type TerminalSideEffectFact, type TerminalGitHubPRLink, TerminalKittyKeyboardModeTracker, AGENT_STATUS_STALE_AFTER_MS, isFreshNonDoneAgentStatus, type AgentStatusIpcPayload, type ParsedAgentStatusPayload, type AgentStatusOrchestrationContext, type AgentStatusEntry, indexAgentStatusRowsByPaneKey, type AgentHookAuthorityAttestation, type AgentSessionClaimedSpawnResult, type AgentSessionExecutionClaim, type AgentSessionSurfaceBinding, type AgentLaunchPreferences, type RuntimeAgentSessionRpcCaller, type RuntimeCreateAgentSessionRequest, type RuntimeCreateAgentSessionResult, type RuntimeEnsureAgentSessionRequest, type RuntimeEnsureAgentSessionResult, AGENT_SESSION_MAX_NEW_OPERATION_AGE_MS, AGENT_SESSION_OPERATION_FUTURE_SKEW_MS, parseAgentSessionOperationTimestamp, canonicalizeAgentSessionIdentity, createEphemeralAgentSessionClaimSigner, type AgentSessionClaimSigner, hasCompatibleAgentTitleIdentity, normalizeCompatibleAgentStatusEntryForOwner, normalizeCompatibleAgentTitleForOwner, resolveCompatibleAgentTypeForOwner, resolvePaneAgentOwner, createAgentStatusOscProcessor, type ProcessedAgentStatusChunk, buildOrchestrationTaskDisplayMetadata, assertTerminalDimensions, AGENT_PROMPT_SUBMIT, buildAgentPromptPasteBytes, gitExecFileAsync, gitSpawn, nonInteractiveGitEnv, runWithGitReadCacheInvalidation, cleanupClaimedCloneTarget, claimCloneTarget, deriveValidatedClonePath, getClonePathComparisonKey, getGitCloneFailureMessage, GIT_FETCH_SKIP_AUTO_MAINTENANCE_CONFIG_ARGS, createHash, randomUUID, homedir, isAbsolute, join, resolve, mkdir, readdir, rm, stat, resolveWorktreeCreateBase, resolveWorktreeAddBaseRef, OrchestrationDb, OrchestrationError, planLegacyWorkerTerminalRecovery, type LegacyWorkerTerminalRecoveryPlan, buildObservedSetupCommand, createSetupCompletionScanner, type RuntimeOrchestrationEnvelope, type TerminalRevealIdentity, type OrchestrationCompatibilityEvidence, type OrchestrationCompatibilityHostStamp, isOrchestrationMutation, orchestrationMigrationData, type OrchestrationEnvironmentTransport, type OrchestrationWorkerServer, syncFederatedDispatch, formatMessagesForInjection, selectExactWorkerProviderSession, type Automation, type AutomationRun, type AutomationWorkspaceProvenance, type CliWorkspaceProvenance, type BaseRefSearchResult, type CreateWorktreeResult, type DetectedWorktree, type DetectedWorktreeListResult, type ForceDeleteWorktreeBranchResult, type GitHubPrStartPoint, type GitPushTarget, type GitWorktreeInfo, type GitHubOwnerRepo, type GlobalSettings, type PersistedUIState, type Project, type ProjectUpdateArgs, type ProjectHostSetup, type ProjectHostSetupCloneArgs, type ProjectHostSetupCreateArgs, type ProjectHostSetupCreateResult, type ProjectHostSetupDeleteArgs, type ProjectHostSetupDeleteResult, type ProjectHostSetupExistingFolderArgs, type ProjectHostSetupResult, type ProjectHostSetupUpdateArgs, type ProjectHostSetupUpdateResult, type Repo, type RemoveWorktreeResult, type StatsSummary, type Worktree, type WorktreeLineage, type WorkspaceLineage, type WorkspaceKey, type WorktreeLineageWarning, type WorktreeMeta, type WorktreeBaseStatusEvent, type WorktreeRemoteBranchConflictEvent, type WorktreeStartupLaunch, type LinearIssueUpdate, type LinearProjectSummary, type NestedRepoScanResult, type ProjectGroup, type FolderWorkspace, type ProjectGroupImportMode, type ProjectGroupImportResult, type MemorySnapshot, type Tab, type TabGroupLayoutNode, type TerminalQuickCommand, type TerminalLayoutSnapshot, type TerminalPaneLayoutNode, type TerminalTab, type TuiAgent, type WorkspaceCreateTelemetrySource, type WorkspaceSessionState, type WorkspaceLinkedItem, type DirEntry, type FilesystemPathFlavor, type GitLabIssueUpdate, type GitLabMRInlineCommentInput, type GitLabProjectRef, type GitLabWorkItem, type MRListState, type ClaudeRateLimitAccountsState, type CodexRateLimitAccountsState, type TaskSourceContext, assertWorktreeUnlockedForRemoval, LOCAL_EXECUTION_HOST_ID, getRepoExecutionHostId, getWorktreeExecutionHostId, parseExecutionHostId, toSshExecutionHostId, type ExecutionHostId, getRegisteredSshState, type AgentProviderSessionMetadata, type SleepingAgentLaunchConfig, type ExactWorkerProviderSession, type RuntimeClientEvent, toRuntimeActivateWorktreeEvent, navigationTargetsClients, navigationTargetsHost, type RuntimeNavigationTarget, type SshConnectionState, getPublicSshState, closeTerminalTabInWorkspaceSession, type LinearCurrentIssueContextHints, type LinearAttachResult, type LinearCommentAddResult, type LinearCreateResult, type LinearErrorCode, type LinearIssueListFilter, type LinearIssueListResult, type LinearProjectListResult, type LinearIssueSummary, type LinearIssueRequest, type LinearIssueTaskUpdateRequest, type LinearIssueTaskUpdateResult, type LinearMcpIssueListRequest, type LinearMcpIssueListResult, type LinearIssueRelationWriteRequest, type LinearIssueRelationWriteResult, type LinearSaveIssueRequest, type LinearSaveIssueResult, type LinearTeamLabelsResult, type LinearTeamListResult, type LinearTeamMembersResult, type LinearTeamStatesResult, type LinearStatusSetResult, HEADLESS_RUNTIME_WINDOW_ID, type RuntimeDesktopWindowStatus, type RuntimeGraphStatus, type RuntimeRepoSearchRefs, type RuntimeTerminalRead, type RuntimeTerminalRename, type RuntimeTerminalAgentStatus, type RuntimeTerminalSend, type RuntimeTerminalCreate, type RuntimeTerminalPresentation, type RuntimeTerminalSplit, type RuntimeTerminalFocus, type RuntimeTerminalClose, type RuntimeTerminalListResult, type RuntimeTerminalOrphanAdoptionRequest, type RuntimeTerminalOrphanAdoptionResult, type RuntimeWorktreeTerminalSleepResult, type RuntimeTerminalResolvePane, type RuntimeStatus, type RuntimeSyncWindowGraphResult, type RuntimeTerminalWait, type RuntimeTerminalWaitCondition, type RuntimeWorktreePsSummary, type RuntimeWorktreeAgentRow, type RuntimeSpeechModelSummary, type RuntimeSpeechSetupState, type RuntimeTerminalShow, type RuntimeTerminalInspect, type RuntimeTerminalResize, type RuntimeTerminalSummary, type RuntimeTerminalVisualGroupNode, type RuntimeTerminalVisualLayout, type RuntimeTerminalVisualLayoutNode, type RuntimeTerminalVisualPaneNode, type RuntimeTerminalVisualTab, type RuntimeSyncedLeaf, type RuntimeSyncedTab, type RuntimeMarkdownReadTabResult, type RuntimeMarkdownSaveTabResult, type RuntimeMobileSessionCreateTerminalResult, type RuntimeMobileSessionClientTab, type RuntimeMobileSessionTabCloseResult, type RuntimeMobileSessionMarkdownTab, type RuntimeMobileSessionTabMove, type RuntimeMobileSessionTabMoveResult, type RuntimeMobileSessionTabGroup, type RuntimeMobileSessionSnapshotTab, type RuntimeMobileSessionTerminalTab, type RuntimeMobileSessionBrowserTab, type RuntimeMobileSessionTabsRemovedResult, type RuntimeMobileSessionTabsResult, type RuntimeMobileSessionTabsSnapshot, type RuntimeSessionFlushResult, type RuntimeSessionSnapshot, type RuntimeNativeChatLaunchDraftResolution, type RuntimeSessionTabCloseReason, type RuntimeBrowserDriverState, type RuntimeTerminalDriverState, type RuntimeSyncWindowGraph, type RuntimeWorktreeListResult, type BrowserTabInfo, type BrowserScreencastResult, LINEAR_SEARCH_MAX_LIMIT, LINEAR_WRITE_BODY_CAP, clampLinearSearchLimit, isLinearUuid, type FeatureInteractionId, type TerminalPaneSplitSource, WORKTREE_ID_SEPARATOR, getRepoIdFromWorktreeId, splitWorktreeId, splitWorktreeIdForFilesystem, getProjectIdForProviderIdentity, getProjectHostSetupForRepo, getProjectHostSetupWorktreeMeta, clampLinearIssueListLimit, isFolderRepo, DEFAULT_WORKSPACE_STATUS_ID, buildSetupRunnerCommand, getSetupRunnerCommandPlatformForPath, createSequencedSetupAgentCommands, SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV, FIRST_PANE_ID, isTerminalLeafId, makePaneKey, parsePaneKey, parseAppSshPtyId, isValidHostTerminalTabId, isValidTerminalTabId, type TerminalQuickCommandMutation, isPtyIncarnationId, type PtyIncarnationId, buildAgentDraftLaunchPlan, buildAgentResumeStartupPlan, buildAgentStartupPlan, repoIsRemote, isAgentForegroundWrapperProcess, isExpectedAgentProcess, recognizeAgentProcess, isTuiAgentEnabled, pickTuiAgent, resolveTuiAgentLaunchArgs, resolveTuiAgentLaunchEnv, resolveLocalWindowsAgentStartupShell, isTuiAgent, TUI_AGENT_CONFIG, createDraftPasteReadyScanner, detectInstalledAgentsWithShellPathHydration, detectRemoteAgents, markCodexProjectTrusted, markCopilotFolderTrusted, markCursorWorkspaceTrusted, markRemoteAgentWorkspaceTrusted, applyAgentStatusHooksEnabled, recordManagedHookInstallFailure, isWindowsAbsolutePathLike, isPathInsideOrEqual, normalizeRuntimePathForComparison, resolveTerminalStartupCwd, isWslUncPath, parseWslUncPath, folderWorkspaceKey, isWorkspaceKey, parseWorkspaceKey, worktreeWorkspaceKey, projectResolvedWorktreeLineage, sharesResolvedWorktreeLineageBoundary, folderWorkspaceToWorktree, type FolderWorkspacePathStatus, type FolderWorkspacePathStatusRequest, applyMetadataFallbackVisibility, buildKnownOrcaWorkspaceLayouts, isLegacyRepoForExternalWorktreeVisibility, toDetectedWorktree, createAgentScratchWorktreePathMatcher, type AgentScratchWorktreePathMatcher, BROWSER_HEADLESS_RUNTIME_CAPABILITY, BROWSER_CERTIFICATE_TRUST_RUNTIME_CAPABILITY, MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION, ORCHESTRATION_CONTRACT_RUNTIME_CAPABILITY, ORCHESTRATION_CONTRACT_VERSION, REMOTE_RUNTIME_SHARED_CONTROL_CAPABILITY, RUNTIME_CAPABILITIES, RUNTIME_PROTOCOL_VERSION, TERMINAL_PAIRED_PARKING_RUNTIME_CAPABILITY, type RuntimeCapability, configureAiVaultSessionSources, listAiVaultSessions, type AiVaultListArgs, type AiVaultListResult, type AiVaultPrepareSessionResumeArgs, type AiVaultPrepareSessionResumeResult, type WorkspacePortKillRequest, type WorkspacePortKillResult, type WorkspacePortProbe, type WorkspacePortScanResult, filterWorkspacePortProbes, killWorkspacePort, scanWorkspacePortProbes, advertisedUrlWatcher, type AutomationService, RuntimeBrowserCommands, RemoteRuntimeTerminalCreateIdempotency, deriveRemoteRuntimeTerminalCreateHandle, buildHeadlessTerminalSplitLayout, countTerminalLayoutLeaves, RECENT_PTY_OUTPUT_LIMIT, TerminalOutputState, type RuntimeTerminalDataMeta, RuntimeGithubProjectCommands, RuntimeJiraCommands, WorktreeResolutionState, RuntimeTerminalInputCommands, RuntimeLinearQueryCommands, RuntimeLinearConnectionCommands, RuntimeReviewQueryCommands, RuntimeReviewMutationCommands, RuntimeRepoWorkItemCommands, RuntimeMessageWaiters, type MessageWaitResult, buildHeadlessTabGroupMove, buildHeadlessTabGroupSplit, hasExactTerminalOrphanGroupLayout, mergeTerminalOrphanGroupLayout, terminalOrphanExecutionOwnersEqual, retireTerminalSurfacesFromSnapshot, type RetiredTerminalSurface, retireTerminalSurfaceFromPersistence, advanceTerminalTopologyRevision, hasHostAuthoritativeTerminalMembership, RuntimeEmulatorCommands, setEmulatorBridge, type EmulatorBridge, RuntimeFileCommands, RuntimeGitCommands, appendRecentPtyPathCandidates, recentTerminalOutputIncludesPath, recentTerminalPathCandidatesIncludePath, detectTerminalWaitBlockedReason, isKnownReadyPromptPreview, buildPreview, buildTerminalWaitText, computeTerminalTailWaitState, MAX_TAIL_CHARS, tailGainedNewerBlockedReason, type TerminalTailWaitState, appendNormalizedToTailBuffer, type RetainedTailRedrawCursor, appendCompletedTerminalTranscript, tailStateMatches, normalizeTerminalChunk, DEFAULT_TERMINAL_READ_LIMIT, readTerminalTail, terminalReadLimit, shouldFallbackToVisibleTerminalSnapshot, visibleNonBlankTerminalLines, buildVisibleSnapshotReadFallback, MOBILE_AUTO_RESTORE_FIT_MAX_MS, MOBILE_AUTO_RESTORE_FIT_MIN_MS, TUI_IDLE_DEFAULT_TIMEOUT_MS, TUI_IDLE_POLL_INTERVAL_MS, TUI_IDLE_QUIESCENCE_MS, assertTerminalInputWithinLimitWithYield, buildSendPayload, buildPtyTerminalWaitResult, buildPtyTerminalWaitBlockedResult, buildTerminalWaitResult, buildTerminalWaitBlockedResult, detectExplicitIdleStatusFromTitle, getTerminalState, activateClientSessionTabSelection, ClientSessionTabSelectionStore, deriveClientSessionTabSelection, projectClientSessionTabSelection, type PtyProviderBufferSnapshot, type IPtyProvider, type PtyProcessInfo, type PtyTransientFact, ClaudeAgentTeamsService, type AgentTeamsTmuxCompatRequest, type AgentTeamsTmuxCompatResponse, buildClaudeAgentTeamsLaunchPlan, ensureClaudeAgentTeamsShimDir, resolveClaudeAgentTeamsShimBin, addClaudeTeammateModeAuto, addClaudeTeammateModeInProcess, collectMemorySnapshot, app, BrowserWindow, ipcMain, Notification, type AgentBrowserBridge, type BrowserBackend, BrowserError, getRepoSlug, getRepoUpstream, type getPRForBranch, resolveGitHubPrStartPoint, fetchGitHubPullRequestHeadRef, fetchPrHeadTrackingRef, gitlabMergeRequestHeadLocalRef, reviewHeadRemoteRefComponent, fetchGitLabMergeRequestHeadRef, isTransientReviewHeadFetchError, resolveGitHubReviewHeadRemote, fetchCompareBaseRefWithLocalFallback, pickPreferredGitRemote, closeGitLabMR, createGitLabIssue, diagnoseGitLabAuthClient, getGitLabJobTrace, getGitLabProjectRefForRemote, getGitLabRateLimit, getGitLabWorkItemByProjectRef, addGitLabIssueComment, addGitLabMRInlineComment, addGitLabMRComment, listGitLabTodos, listGitLabIssues, listGitLabLabels, listGitLabMergeRequests, listGitLabWorkItems, mergeGitLabMR, reopenGitLabMR, resolveGitLabMRDiscussion, retryGitLabJob, updateGitLabMR, updateGitLabMRReviewers, updateGitLabIssue, getGlabKnownHosts, getGitLabWorkItemDetails, normalizeGitLabIssueListArgs, normalizeGitLabMRListState, normalizeGitLabPositiveInteger, type GitLabIssueListState, recordGitLabProjectRecent, type CreateHostedReviewInput, type CreateHostedReviewResult, type HostedReviewCreationEligibility, type HostedReviewCreationEligibilityArgs, type HostedReviewInfo, getHostedReviewForBranchFromRepo, createHostedReviewFromRepo, getHostedReviewCreationEligibilityFromRepo, getLocalProjectGitExecOptions, getLocalProjectWorktreeGitOptions, getLocalProjectWorktreeGitOptionsForRuntime, resolveLocalProjectRuntimeForRepo, resolveLocalProjectRuntimesForRepos, resolveLocalProjectRuntimeForWorktreeId, type ProjectExecutionRuntimeResolution, resolveTerminalOrchestrationCliCommand, getLocalWorktreePathAccess, removeLocalWorktreePath, toLocalWorktreeRuntimePath, removeStaleLocalWorktreeRegistrationAfterFilesystemRemoval, recoverLocalWindowsWorktreeRemoval, getLinearStatus, isLinearAuthError, addLinearIssueCommentForAgent, createLinearIssueAttachment, createLinearIssueForAgent, getLinearAttachmentByUuidForAgent, getLinearCommentByUuidForAgent, getLinearIssueByUuidForAgent, getLinearIssueCommentThreadRoot, listLinearIssues, updateLinearIssueForAgent, LinearWriteFailure, LinearAgentAccessError, getLinearCurrentIssueFromWorktree, readLinearIssueContext, resolveLegacyLinearLinkWorkspace, classifyLinearError, linearError, linearMessage, sanitizeLinearErrorMessage, listMcpIssues, writeIssueRelation, getLinearProject, listLinearProjectsByExactName, listLinearProjectTeams, listLinearProjects, getLinearTeamLabelsOrThrow, getLinearTeamMembersOrThrow, getLinearTeamStatesOrThrow, getLinearViewerForWorkspaceOrThrow, listLinearTeamsForAgent, listLinearTeamsOrThrow, getBaseRefDefault, getDefaultRemote, getBranchConflictKind, isGitRepo, getRepoName, searchBaseRefDetails, getRemoteCount, normalizeRefSearchQuery, parseAndFilterSearchRefDetails, parseRemoteCount, resolveDefaultBaseRefViaExec, resolveDefaultBaseRefWithLocalGit, buildSearchBaseRefsArgv, isForEachRefExcludeUnsupportedError, mergeBaseRefSearchResultGroups, getRemoteDrift, getRecentDriftSubjects, hasCommitObjectViaGitExec, hasWorktreeBaseCommitRef, resolveLocalGitUsername, getSshGitCapabilityCache, listWorktrees, listWorktreesStrict, addWorktree, addSparseWorktree, assertWorktreeCleanForRemoval, forceDeleteLocalBranch, removeWorktree, type AddWorktreeOptions, type AddWorktreeResult, isENOENT, invalidateAuthorizedRootsCache, createSetupRunnerScript, getDefaultTabsLaunch, getEffectiveHooks, loadHooks, runHook, shouldRunSetupForCreate, DEFAULT_REPO_BADGE_COLOR, FLOATING_TERMINAL_WORKTREE_ID, getDefaultVoiceSettings, listRepoWorktrees, createWorktreeCopiedPaths, createWorktreeLinkedPaths, createWorktreeSharedPaths, findExistingWorktreeSymlinkPaths, removeWorktreeLinkedPaths, formatWorktreeIncludeCopyWarning, resolveWorktreeIncludePaths, getWorktreeSharedLinkPaths, resolveWorktreeSharedDirectories, deleteWorktreeHistoryDir, cleanupUnusedWorktreePushTargetRemote, cleanupUnusedWorktreePushTargetRemoteSsh, createRemoteWorktree, configureCreatedWorktreePushTarget, prepareWorktreePushTarget, getBranchNameOverrideCandidate, getWorktreeCreateCandidate, WORKTREE_CREATE_MAX_SUFFIX_ATTEMPTS, normalizeSparseDirectories, type Store, type StatsCollector, AgentDetector, computeWorktreePath, computeWorkspaceRoot, ensurePathWithinWorkspace, formatWorktreeRemovalError, getWorktreeCreationLayout, getWorktreePathSettings, isOrphanCompatiblePreflightError, isOrphanedWorktreeError, mergeWorktree, sanitizeWorktreeName, shouldSetDisplayName, areWorktreePathsEqual, findCreatedWorktree, assertWorktreeDoesNotContainRegisteredWorktree, canCleanupUnregisteredOrcaLeftoverDirectory, canCleanupUnregisteredOrcaWorktreeDirectory, canSafelyRemoveOrphanedWorktreeDirectory, findRegisteredDeletableWorktree, isDangerousWorktreeRemovalPath, ORPHANED_WORKTREE_DIRECTORY_MESSAGE, stripOrcaProvenanceMetaUpdates, UNREGISTERED_MISSING_WORKTREE_MESSAGE, prefetchWorktreeCreateBase, prepareLocalWorktreeRootForRepo, closeLocalWatcherForWorktreePath, closeRemoteWatcherForWorktreePath, forgetLocalWatcherRemovalSnapshot, forgetRemoteWatcherRemovalSnapshot, restoreLocalWatcherAfterFailedRemoval, restoreRemoteWatcherAfterFailedRemoval, acquireWatcherRemovalGate, createWatcherRemovalDeadline, drainBeforeWatcherRemoval, type WatcherRemovalDeadline, withWorktreeSpan, HeadlessEmulator, isNativeWindowsConptyPty, registerConptyDa1OverrideInstaller, shouldModelAnswerHiddenPtyQueries, getTerminalViewAttributes, getTerminalViewColorQueryReplyColors, registerTerminalViewAttributesApplier, killAllProcessesForWorktree, teardownRpcDeadline, stopMissingWorktreeTerminals, type ReplayableMobileNotification, RuntimeNotificationRegistry, MOBILE_SUBSCRIBE_SCROLLBACK_ROWS, createMobileSessionTabsNotifyCoalescer, type MobileSessionTabsNotifyCoalescer, getSshFilesystemProvider, assertFolderWorkspacePathUsable, getFolderWorkspacePathStatus, getFolderWorkspacePathStatusForPath, inferFolderWorkspacePathConnection, getSshGitProvider, getSshGitProviderGeneration, requireSshGitProvider, detectRepoIconAndUpstream, enrichMissingRepoGitRemoteIdentities, githubAvatarIcon, type ClaudeAccountService, type CodexAccountService, type CodexResetCreditRejectedBeforeProviderReason, type CodexAccountSelectionTarget, type RateLimitService, type CodexRateLimitResetOutcome, type RateLimitState, type CodexResetCreditExpectedScope, type VoiceSettings, getSpeechModelManager, getSpeechSttService, getCatalogModel, isLocalSpeechModel, SPEECH_MODEL_CATALOG, deleteLocalSpeechModel, getSpeechModelDeletionErrorCode, type CommitMessageAgentEnvironmentResolvers, scanNestedRepos, createNestedProjectGroupResolver, resolveNestedRepoSelection, createNestedRepoImportTargetResolver, RuntimeClientSettingsCommands, type RuntimeClientSettings, RuntimeAutomationCommands, type RuntimeAutomationCreateInput, type RuntimeAutomationUpdateInput, PtyLayoutQueue, type ApplyLayoutResult, type PtyLayoutState, type PtyLayoutTarget, PtyGenerationReferenceCount, RuntimeRepoHookCommands, branchSelectorMatches, buildRuntimeWorktreeSummaryPathIndex, canonicalizeTerminalSessionWorktreeId, classifyAgentTitle, classifyLatestAgentTitle, compareWorktreePs, findResolvedWorktreeIdForPath, findRuntimeWorktreeSummaryByPath, getExplicitWorktreeIdSelector, getLatestAgentCandidateTitle, getLatestAgentCandidateTitleInfo, getLatestLeafTitle, getLatestPtyTitle, getLeafWorktreeStatus, getSavedTabWorktreeStatus, includeTargetResolvedWorktree, indexPersistedPtySurfaceBindings, indexPersistedPtyWorktreeBindings, inferWorktreeIdFromPtyId, mapExplicitAgentStateToRuntimeTerminalStatus, maxTimestamp, mergeWorktreeStatus, notifyRuntimeListeners, parseRuntimeWorktreeId, resolveTerminalSessionWorktreeId, resolveWorktreeScanCacheTtlMs, runtimePathsEqual, runtimeWorktreeIdentityKey, runtimeWorktreeIdsEqual, type RuntimeWorktreeSummaryPathIndex, setBoundedMapEntry, setsEqual, terminalTitleBlocksExplicitAgentStatus, waitForWorktreeTerminalMutation, withTimeout, withTimeoutResult, getRuntimeWorktreeRemovalKey, getRuntimeWorktreeRemovalOptionsKey, isLocalRuntimeGitRepository, isRuntimeWorktreePathMissing, omitUndefinedProperties, parseExactWorktreeIdSelector, type PreservedBranchCleanupTarget, type RuntimeWorktreeRemovalInFlight, type RuntimeWorktreeRemovalTarget, addListenerToMap, canCheckoutExistingLocalBranch, clampTerminalViewport, getLocalGitHubPrForBranch, getSelectedHostedReviewForBranch, getSelectedReviewBranch, hasLocalGitOptions, isAllowedPushTargetRemoteConflict, isMatchingSelectedGitHubPr, resolveCreateBranchName, getRuntimeFolderWorkspaceInstanceId, getRuntimeFolderWorkspaceRootId, listRuntimeFolderWorkspaces, mergeRuntimeFolderWorkspace, copySleepingAgentLaunchConfig, deterministicAgentSessionUuid, inferCapturedClaudeAgentTeamsMode, isAgentSessionOperationOutcomeUnknown, isCursorAgentOrchestrationTarget, mergeTerminalEnvDeletionKeys, normalizeSparsePresetDirectoriesForSave, normalizeSparsePresetName, resolveBareAgentLaunchCommand, FETCH_FRESHNESS_MS, REMOTE_FETCH_TIMEOUT_MS, REMOTE_FETCH_CACHE_MAX, DRIFT_PROBE_SUBJECT_LIMIT, PTY_CONTROLLER_LIST_TIMEOUT_MS, WORKTREE_TERMINAL_SLEEP_TIMEOUT_MS, sanitizeNestedRepoRuntimeImportError, runtimeRepoMatchesExecutionHost, assertProjectHostSetupHostIsSupported, pathExists, resolveServerBrowsePath, type RuntimeAccountServices, type RemoteFetchResult, type RemoteTrackingBase, type AccountsSnapshot, type CodexRateLimitResetRpcResult, type RuntimeStore, type RuntimeLeafRecord, type RuntimePtyWorktreeRecord, type TerminalCreateOptions, AGENT_SESSION_OPERATION_PER_CLIENT_LIMIT, AGENT_SESSION_OPERATION_GLOBAL_LIMIT, SESSION_SNAPSHOT_STABILITY_ATTEMPTS, type PtyForegroundAgentRefresh, type RuntimeTerminalAgentStatusEvent, type RuntimePtyTitleTrackerEntry, type RuntimeAgentRowSnapshot, type AgentSessionCreateOperation, type RuntimeHeadlessTerminal, type RuntimePtyDataAdmission, type RuntimeVisibleTerminalState, type ProviderBufferAcquisition, type RuntimeTerminalBufferSnapshot, type HeadlessSeedMetadata, type RuntimePtyController, type PtyControllerTerminalIdentity, type PtyControllerInventory, type WorktreeStartupDraftPaste, type WorktreeStartupFollowup, getAgentLaunchPlatformForRepo, MOBILE_TERMINAL_CREATE_RESULT_TTL_MS, WORKTREE_CREATE_RESULT_TTL_MS, FOREGROUND_AGENT_WRAPPER_RETRY_INTERVAL_MS, FOREGROUND_AGENT_WRAPPER_RETRY_TIMEOUT_MS, BRACKETED_PASTE_BEGIN, BRACKETED_PASTE_END, BRACKETED_PASTE_QUIET_MS, DRAFT_PASTE_READY_TIMEOUT_MS, MOBILE_TERMINAL_SURFACE_TIMEOUT_MS, MOBILE_TERMINAL_READY_FALLBACK_MS, SSH_PANE_RECOVERY_GRACE_MS, isClientDisconnectedError, createTerminalRevealWarning, ownerSurfacing, resolveTerminalPresentation, type RuntimeNotifier, type TerminalHandleRecord, type OrchestrationCompatibilityTerminalAuthority, type LegacyWorkerTerminalRecoveryResult, type OrchestrationCompatibilityCallerAuthority, type RestoredOrchestrationAuthorityReceipt, type OrchestrationCompatibilitySshAttachmentAuthority, type TerminalWaiter, type ResolvedWorktree, type LinearAgentWriteTarget, type LinearCreateFieldIntent, AGENT_HOOK_RUNTIME_ENV_KEYS, sameStringSet, labelsForIds, type TerminalWorkspaceLaunchScope, type WorktreeLineageInput, type ResolvedWorkspaceParent, type WorktreeLineageResolution, type RuntimeWorktreeScanResult, type WorktreeLineageCandidate, extractOrchestrationTaskId, RuntimeLineageError, WorktreeIdRequiresFullPathError, type ResolvedWorktreeSnapshot, type MobileNotificationDispatchEvent, type RuntimeWorktreeLifecycleEvent, type MobileNotificationDismissEvent, type MobileNotificationEvent, type DriverState, type NativeChatLaunchDraftResolutionTombstone, MAX_NATIVE_CHAT_LAUNCH_DRAFT_RESOLUTION_TOMBSTONES, MAX_DELETED_FOLDER_TERMINAL_RETIREMENT_FENCES, MAX_TERMINAL_SURFACE_RETIREMENT_FENCES, hasLocalWorktreeBaseRef, makePtyDurableRetirementKey } from './orca-runtime-symbols'
import { OrcaRuntimeListTerminalsPart38 } from './orca-runtime-list-terminals-part-38'

export class OrcaRuntimeAdoptTerminalOrphansFromInventoryPart39 extends OrcaRuntimeListTerminalsPart38 {
  protected async adoptTerminalOrphansFromInventory(
    request: RuntimeTerminalOrphanAdoptionRequest,
    workspace: TerminalWorkspaceLaunchScope,
    inventory: PtyControllerInventory
  ): Promise<RuntimeTerminalOrphanAdoptionResult> {
    const { livePtyIds, terminalIdentityByPtyId } = inventory
    const store = this.store
    const session = this.getWorkspaceSessionForWorktree(workspace.id)
    if (!store?.setWorkspaceSession || !store.flushOrThrow || !session) {
      throw new Error('workspace_session_unavailable')
    }
    const sessionWorktreeId = resolveTerminalSessionWorktreeId(session, workspace.id)
    if (!sessionWorktreeId) {
      throw new Error('terminal_orphan_competing_owner')
    }
    const repoId = getRepoIdFromWorktreeId(workspace.id)
    const worktreeConnectionId = workspace.connectionId
    let worktreeWslDistro: string | null = null
    if (!worktreeConnectionId && workspace.repo) {
      try {
        worktreeWslDistro =
          getLocalProjectWorktreeGitOptions(this.requireStore(), workspace.repo).wslDistro ?? null
      } catch {
        throw new Error('terminal_orphan_owner_mismatch')
      }
    }
    const currentRevision = this.getTerminalTopologyRevision(workspace.id)
    const seenPtyIds = new Set<string>()
    const seenPaneKeys = new Set<string>()
    const validated = request.claims.map((claim) => {
      const paneKey = makePaneKey(claim.tabId, claim.leafId)
      if (seenPtyIds.has(claim.ptyId) || seenPaneKeys.has(paneKey)) {
        throw new Error('terminal_orphan_claim_duplicate')
      }
      seenPtyIds.add(claim.ptyId)
      seenPaneKeys.add(paneKey)
      const live = this.getLivePtyForHandle(claim.terminal)
      const pty = live?.pty
      const controllerIdentity = terminalIdentityByPtyId.get(claim.ptyId)
      if (
        !pty ||
        pty.ptyId !== claim.ptyId ||
        controllerIdentity?.handle !== claim.terminal ||
        controllerIdentity?.incarnationId !== claim.incarnationId ||
        !livePtyIds.has(claim.ptyId) ||
        !pty.connected ||
        !pty.incarnationId ||
        pty.incarnationId !== claim.incarnationId
      ) {
        throw new Error('terminal_orphan_stale')
      }
      if (
        !runtimeWorktreeIdsEqual(pty.worktreeId, workspace.id) ||
        !terminalOrphanExecutionOwnersEqual(
          { connectionId: worktreeConnectionId, wslDistro: worktreeWslDistro },
          {
            connectionId: pty.connectionId ?? null,
            ...(controllerIdentity?.wslDistro !== undefined
              ? { wslDistro: controllerIdentity.wslDistro }
              : process.platform === 'win32' && !worktreeConnectionId
                ? {}
                : { wslDistro: null })
          }
        )
      ) {
        throw new Error('terminal_orphan_owner_mismatch')
      }
      const visualOwners = this.getLeavesForPty(claim.ptyId)
      if (
        visualOwners.some(
          (owner) =>
            !runtimeWorktreeIdsEqual(owner.worktreeId, workspace.id) ||
            owner.tabId !== claim.tabId ||
            owner.leafId !== claim.leafId
        )
      ) {
        throw new Error('terminal_orphan_already_visual')
      }
      if ((pty.tabId && pty.tabId !== claim.tabId) || (pty.paneKey && pty.paneKey !== paneKey)) {
        throw new Error('terminal_orphan_competing_owner')
      }
      return { claim, pty, paneKey }
    })

    const persistedBindingsByPtyId = new Map<string, { worktreeId: string; paneKey: string }[]>()
    const addPersistedBinding = (
      ptyId: string,
      binding: { worktreeId: string; paneKey: string }
    ): void => {
      const bindings = persistedBindingsByPtyId.get(ptyId) ?? []
      bindings.push(binding)
      persistedBindingsByPtyId.set(ptyId, bindings)
    }
    for (const [worktreeId, tabs] of Object.entries(session.tabsByWorktree)) {
      for (const tab of tabs) {
        const layout = session.terminalLayoutsByTabId[tab.id]
        for (const [leafId, boundPtyId] of Object.entries(layout?.ptyIdsByLeafId ?? {})) {
          if (boundPtyId) {
            addPersistedBinding(boundPtyId, {
              worktreeId,
              paneKey: makePaneKey(tab.id, leafId)
            })
          }
        }
        if (tab.ptyId && !layout) {
          addPersistedBinding(tab.ptyId, { worktreeId, paneKey: tab.id })
        }
      }
    }
    const persistedBinding = (ptyId: string): { worktreeId: string; paneKey: string } | null => {
      const bindings = persistedBindingsByPtyId.get(ptyId) ?? []
      if (bindings.length > 1) {
        throw new Error('terminal_orphan_competing_owner')
      }
      return bindings[0] ?? null
    }
    const isExactPersisted = validated.every(({ claim, paneKey }) => {
      const binding = persistedBinding(claim.ptyId)
      return (
        binding !== null &&
        runtimeWorktreeIdsEqual(binding.worktreeId, workspace.id) &&
        binding.paneKey === paneKey &&
        session.terminalPtyIncarnationsByPaneKey?.[paneKey] === claim.incarnationId
      )
    })
    if (isExactPersisted && sessionWorktreeId === workspace.id) {
      for (const { claim, pty, paneKey } of validated) {
        pty.tabId = claim.tabId
        pty.paneKey = paneKey
      }
      return {
        adopted: false,
        topologyRevision: currentRevision,
        snapshot: this.getTerminalOrphanAdoptionSnapshot(workspace.id)
      }
    }
    if (currentRevision !== request.expectedTopologyRevision) {
      throw new Error('terminal_topology_conflict')
    }

    const topologyTabsById = new Map(request.topology?.tabs.map((tab) => [tab.tabId, tab]) ?? [])
    const topologyGroups = request.topology?.groups ?? []
    if (request.topology) {
      const claimedLeafIdsByTabId = new Map<string, Set<string>>()
      for (const { claim } of validated) {
        const leafIds = claimedLeafIdsByTabId.get(claim.tabId) ?? new Set<string>()
        leafIds.add(claim.leafId)
        claimedLeafIdsByTabId.set(claim.tabId, leafIds)
      }
      if (
        topologyTabsById.size !== request.topology.tabs.length ||
        topologyTabsById.size !== claimedLeafIdsByTabId.size
      ) {
        throw new Error('terminal_orphan_topology_invalid')
      }
      for (const [tabId, claimedLeafIds] of claimedLeafIdsByTabId) {
        const topologyTab = topologyTabsById.get(tabId)
        if (!topologyTab) {
          throw new Error('terminal_orphan_topology_invalid')
        }
        const topologyLeafIds = new Set<string>()
        const nodes = [topologyTab.root]
        let leafCount = 0
        while (nodes.length > 0) {
          const node = nodes.pop()!
          if (node.type === 'leaf') {
            leafCount += 1
            topologyLeafIds.add(node.leafId)
          } else {
            nodes.push(node.first, node.second)
          }
        }
        if (
          leafCount !== topologyLeafIds.size ||
          topologyLeafIds.size !== claimedLeafIds.size ||
          [...topologyLeafIds].some((leafId) => !claimedLeafIds.has(leafId)) ||
          !topologyLeafIds.has(topologyTab.activeLeafId) ||
          (topologyTab.expandedLeafId !== null && !topologyLeafIds.has(topologyTab.expandedLeafId))
        ) {
          throw new Error('terminal_orphan_topology_invalid')
        }
      }
      const seenGroupIds = new Set<string>()
      const groupedTabIds = new Set<string>()
      for (const group of topologyGroups) {
        if (seenGroupIds.has(group.id) || !group.tabOrder.includes(group.activeTabId)) {
          throw new Error('terminal_orphan_topology_invalid')
        }
        seenGroupIds.add(group.id)
        for (const tabId of group.tabOrder) {
          if (!topologyTabsById.has(tabId) || groupedTabIds.has(tabId)) {
            throw new Error('terminal_orphan_topology_invalid')
          }
          groupedTabIds.add(tabId)
        }
        if (group.recentTabIds?.some((tabId) => !group.tabOrder.includes(tabId))) {
          throw new Error('terminal_orphan_topology_invalid')
        }
      }
      if (groupedTabIds.size !== topologyTabsById.size) {
        throw new Error('terminal_orphan_topology_invalid')
      }
      if (request.topology.groupLayout) {
        if (!hasExactTerminalOrphanGroupLayout(request.topology.groupLayout, seenGroupIds)) {
          throw new Error('terminal_orphan_topology_invalid')
        }
      }
    }

    for (const { claim, paneKey } of validated) {
      const existingBinding = persistedBinding(claim.ptyId)
      if (
        existingBinding &&
        (!runtimeWorktreeIdsEqual(existingBinding.worktreeId, workspace.id) ||
          existingBinding.paneKey !== paneKey)
      ) {
        throw new Error('terminal_orphan_competing_owner')
      }
      const proposedPtyId =
        session.terminalLayoutsByTabId[claim.tabId]?.ptyIdsByLeafId?.[claim.leafId]
      if (proposedPtyId && proposedPtyId !== claim.ptyId) {
        throw new Error('terminal_orphan_surface_occupied')
      }
      const graphOwner = this.leaves.get(this.getLeafKey(claim.tabId, claim.leafId))
      if (
        graphOwner &&
        (graphOwner.ptyId !== claim.ptyId ||
          !runtimeWorktreeIdsEqual(graphOwner.worktreeId, workspace.id))
      ) {
        throw new Error('terminal_orphan_surface_occupied')
      }
      if (
        Object.entries(session.tabsByWorktree).some(
          ([ownerWorktreeId, tabs]) =>
            !runtimeWorktreeIdsEqual(ownerWorktreeId, workspace.id) &&
            tabs.some((tab) => tab.id === claim.tabId)
        )
      ) {
        throw new Error('terminal_orphan_surface_occupied')
      }
      if (session.terminalSurfaceTombstonesByPaneKey?.[paneKey]) {
        throw new Error('terminal_orphan_surface_retired')
      }
      for (const snapshot of this.mobileSessionTabsByWorktree.values()) {
        const surfaceOwner = snapshot.tabs.find(
          (tab): tab is RuntimeMobileSessionTerminalTab =>
            tab.type === 'terminal' &&
            tab.parentTabId === claim.tabId &&
            tab.leafId === claim.leafId
        )
        if (
          surfaceOwner &&
          (snapshot.worktree !== workspace.id || surfaceOwner.ptyId !== claim.ptyId)
        ) {
          throw new Error('terminal_orphan_surface_occupied')
        }
        const owner = snapshot.tabs.find(
          (tab): tab is RuntimeMobileSessionTerminalTab =>
            tab.type === 'terminal' && tab.ptyId === claim.ptyId
        )
        if (
          owner &&
          (snapshot.worktree !== workspace.id ||
            owner.parentTabId !== claim.tabId ||
            owner.leafId !== claim.leafId)
        ) {
          throw new Error('terminal_orphan_competing_owner')
        }
      }
    }

    const next = structuredClone(session)
    canonicalizeTerminalSessionWorktreeId(next, sessionWorktreeId, workspace.id)
    const existingTabs = next.tabsByWorktree[workspace.id] ?? []
    const tabsById = new Map(existingTabs.map((tab) => [tab.id, tab]))
    for (const { claim, pty, paneKey } of validated) {
      let tab = tabsById.get(claim.tabId)
      if (!tab) {
        const title =
          getLatestPtyTitle(pty) ?? pty.controllerTitle ?? `Terminal ${tabsById.size + 1}`
        tab = {
          id: claim.tabId,
          ptyId: claim.ptyId,
          worktreeId: workspace.id,
          title,
          defaultTitle: title,
          customTitle: null,
          color: null,
          sortOrder: tabsById.size,
          createdAt: Date.now(),
          pendingActivationSpawn: true
        }
        tabsById.set(claim.tabId, tab)
      }
      const existingLayout = next.terminalLayoutsByTabId[claim.tabId]
      const topologyTab = topologyTabsById.get(claim.tabId)
      next.terminalLayoutsByTabId[claim.tabId] = topologyTab
        ? {
            ...existingLayout,
            root: topologyTab.root,
            activeLeafId: topologyTab.activeLeafId,
            expandedLeafId: topologyTab.expandedLeafId,
            ptyIdsByLeafId: {
              ...existingLayout?.ptyIdsByLeafId,
              [claim.leafId]: claim.ptyId
            }
          }
        : existingLayout
          ? {
              ...existingLayout,
              root: this.collectPersistedTerminalLeafIds(existingLayout).includes(claim.leafId)
                ? existingLayout.root
                : existingLayout.root === null
                  ? { type: 'leaf', leafId: claim.leafId }
                  : {
                      type: 'split',
                      direction: 'vertical',
                      first: existingLayout.root,
                      second: { type: 'leaf', leafId: claim.leafId }
                    },
              ptyIdsByLeafId: {
                ...existingLayout.ptyIdsByLeafId,
                [claim.leafId]: claim.ptyId
              }
            }
          : {
              root: { type: 'leaf', leafId: claim.leafId },
              activeLeafId: claim.leafId,
              expandedLeafId: null,
              ptyIdsByLeafId: { [claim.leafId]: claim.ptyId }
            }
      next.terminalPtyIncarnationsByPaneKey = {
        ...next.terminalPtyIncarnationsByPaneKey,
        [paneKey]: claim.incarnationId
      }
    }
    const adoptedTabIds = [...new Set(validated.map(({ claim }) => claim.tabId))]
    next.tabsByWorktree[workspace.id] = [...tabsById.values()]
    const activeTabId =
      request.activeTabId && tabsById.has(request.activeTabId)
        ? request.activeTabId
        : (adoptedTabIds[0] ?? null)
    const existingGroups = next.tabGroups?.[workspace.id] ?? []
    const targetGroupId =
      (request.activeGroupId && existingGroups.some((group) => group.id === request.activeGroupId)
        ? request.activeGroupId
        : existingGroups[0]?.id) ??
      request.activeGroupId ??
      randomUUID()
    const proposedGroups = topologyGroups.map((group) => ({
      ...group,
      worktreeId: workspace.id
    }))
    const groups =
      existingGroups.length === 0 && proposedGroups.length > 0
        ? proposedGroups
        : existingGroups.length > 0
          ? existingGroups
              .map((group) => {
                const proposed = proposedGroups.find((candidate) => candidate.id === group.id)
                const tabOrder = proposed
                  ? [
                      ...group.tabOrder.filter((tabId) => !adoptedTabIds.includes(tabId)),
                      ...proposed.tabOrder
                    ]
                  : group.id === targetGroupId && proposedGroups.length === 0
                    ? [...new Set([...group.tabOrder, ...adoptedTabIds])]
                    : group.tabOrder.filter((tabId) => !adoptedTabIds.includes(tabId))
                return {
                  ...group,
                  tabOrder,
                  activeTabId: proposed
                    ? proposed.activeTabId
                    : group.id === targetGroupId && activeTabId
                      ? activeTabId
                      : group.activeTabId && tabOrder.includes(group.activeTabId)
                        ? group.activeTabId
                        : (tabOrder[0] ?? null),
                  ...(proposed?.recentTabIds ? { recentTabIds: proposed.recentTabIds } : {})
                }
              })
              .concat(
                proposedGroups.filter(
                  (proposed) => !existingGroups.some((group) => group.id === proposed.id)
                )
              )
          : [{ id: targetGroupId, worktreeId: workspace.id, activeTabId, tabOrder: adoptedTabIds }]
    const retainedGroups = groups.filter((group) => group.tabOrder.length > 0)
    next.tabGroups = {
      ...next.tabGroups,
      [workspace.id]: retainedGroups
    }
    const mergedGroupLayout = mergeTerminalOrphanGroupLayout({
      existingLayout: next.tabGroupLayouts?.[workspace.id],
      existingGroupIds: existingGroups.map((group) => group.id),
      proposedLayout: request.topology?.groupLayout,
      proposedGroupIds: proposedGroups.map((group) => group.id),
      mergedGroupIds: retainedGroups.map((group) => group.id)
    })
    if (mergedGroupLayout) {
      next.tabGroupLayouts = {
        ...next.tabGroupLayouts,
        [workspace.id]: mergedGroupLayout
      }
    }
    const activeGroup =
      (request.activeGroupId
        ? retainedGroups.find(
            (group) =>
              group.id === request.activeGroupId &&
              (!activeTabId || group.tabOrder.includes(activeTabId))
          )
        : undefined) ??
      retainedGroups.find((group) => activeTabId && group.tabOrder.includes(activeTabId)) ??
      retainedGroups[0]!
    const convergedActiveTabId =
      activeTabId && activeGroup.tabOrder.includes(activeTabId)
        ? activeTabId
        : activeGroup.activeTabId
    next.activeTabIdByWorktree = {
      ...next.activeTabIdByWorktree,
      ...(convergedActiveTabId ? { [workspace.id]: convergedActiveTabId } : {})
    }
    next.activeGroupIdByWorktree = {
      ...next.activeGroupIdByWorktree,
      [workspace.id]: activeGroup.id
    }
    const persisted = advanceTerminalTopologyRevision(next, workspace.id)
    try {
      this.setWorkspaceSessionForWorktree(workspace.id, persisted)
      store.flushOrThrow()
    } catch (error) {
      this.setWorkspaceSessionForWorktree(workspace.id, session)
      throw error
    }
    for (const { claim, pty, paneKey } of validated) {
      pty.tabId = claim.tabId
      pty.paneKey = paneKey
    }
    this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(workspace.id, {
      force: true,
      allowAttachedWindow: true,
      onlyRuntimeOwnedTerminals: true
    })
    this.notifyMobileSessionTabsChanged(workspace.id)
    return {
      adopted: true,
      topologyRevision: persisted.terminalTopologyRevisionByRepoId?.[repoId] ?? currentRevision + 1,
      snapshot: this.getTerminalOrphanAdoptionSnapshot(workspace.id)
    }
  }
}
import {
  WAIT_BLOCKED_CHECK_MIN_INTERVAL_MS,
  WAIT_BLOCKED_KEYWORD_PATTERN,
  WAIT_BLOCKED_KEYWORD_CARRY_CHARS,
  AUTHORITATIVE_TERMINAL_SNAPSHOT_TIMEOUT_MS,
  VISIBLE_TERMINAL_SNAPSHOT_TIMEOUT_MS,
  VISIBLE_TERMINAL_SNAPSHOT_RETRY_MS,
  DEFAULT_REPO_SEARCH_REFS_LIMIT,
  DEFAULT_TERMINAL_LIST_LIMIT,
  DEFAULT_WORKTREE_LIST_LIMIT,
  DEFAULT_WORKTREE_PS_LIMIT,
  DISCONNECTED_PTY_RECORD_MAX,
  RESOLVED_WORKTREE_CACHE_TTL_MS,
  RESOLVED_WORKTREE_REPO_TIMEOUT_MS
} from './orca-runtime-tail-constants'
