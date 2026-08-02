import { detectAgentStatusFromTitle, isClaudeManagementTitle, isCursorNativeAgentTitle, isShellProcess, normalizeTerminalTitle, extractOscTitleScanTail, normalizeFolderWorkspaceOperationId, isServerDriveListRequest, listWindowsDrives, extractLastOsc7Uri, extractOscScanTail, parseFileUriPathParts, type AgentStatus, type TerminalOscLinkRange, type TerminalOscColorQueryReplyColors, type TerminalOutputSourceRange, type RemoteTerminalSourceRangeConsumerHooks, type RemoteTerminalSourceRangeReplacementPublication, type RemoteTerminalSourceRangeReplacementReservation, type RemoteTerminalSourceRangeStreamIdentity, createTerminalTitleTracker, stripBrailleSpinnerGlyphs, type TerminalTitleTracker, createCommandCodeOutputStatusDetector, type TerminalSideEffectBatch, type TerminalSideEffectFact, type TerminalGitHubPRLink, TerminalKittyKeyboardModeTracker, AGENT_STATUS_STALE_AFTER_MS, isFreshNonDoneAgentStatus, type AgentStatusIpcPayload, type ParsedAgentStatusPayload, type AgentStatusOrchestrationContext, type AgentStatusEntry, indexAgentStatusRowsByPaneKey, type AgentHookAuthorityAttestation, type AgentSessionClaimedSpawnResult, type AgentSessionExecutionClaim, type AgentSessionSurfaceBinding, type AgentLaunchPreferences, type RuntimeAgentSessionRpcCaller, type RuntimeCreateAgentSessionRequest, type RuntimeCreateAgentSessionResult, type RuntimeEnsureAgentSessionRequest, type RuntimeEnsureAgentSessionResult, AGENT_SESSION_MAX_NEW_OPERATION_AGE_MS, AGENT_SESSION_OPERATION_FUTURE_SKEW_MS, parseAgentSessionOperationTimestamp, canonicalizeAgentSessionIdentity, createEphemeralAgentSessionClaimSigner, type AgentSessionClaimSigner, hasCompatibleAgentTitleIdentity, normalizeCompatibleAgentStatusEntryForOwner, normalizeCompatibleAgentTitleForOwner, resolveCompatibleAgentTypeForOwner, resolvePaneAgentOwner, createAgentStatusOscProcessor, type ProcessedAgentStatusChunk, buildOrchestrationTaskDisplayMetadata, assertTerminalDimensions, AGENT_PROMPT_SUBMIT, buildAgentPromptPasteBytes, gitExecFileAsync, gitSpawn, nonInteractiveGitEnv, runWithGitReadCacheInvalidation, cleanupClaimedCloneTarget, claimCloneTarget, deriveValidatedClonePath, getClonePathComparisonKey, getGitCloneFailureMessage, GIT_FETCH_SKIP_AUTO_MAINTENANCE_CONFIG_ARGS, createHash, randomUUID, homedir, isAbsolute, join, resolve, mkdir, readdir, rm, stat, resolveWorktreeCreateBase, resolveWorktreeAddBaseRef, OrchestrationDb, OrchestrationError, planLegacyWorkerTerminalRecovery, type LegacyWorkerTerminalRecoveryPlan, buildObservedSetupCommand, createSetupCompletionScanner, type RuntimeOrchestrationEnvelope, type TerminalRevealIdentity, type OrchestrationCompatibilityEvidence, type OrchestrationCompatibilityHostStamp, isOrchestrationMutation, orchestrationMigrationData, type OrchestrationEnvironmentTransport, type OrchestrationWorkerServer, syncFederatedDispatch, formatMessagesForInjection, selectExactWorkerProviderSession, type Automation, type AutomationRun, type AutomationWorkspaceProvenance, type CliWorkspaceProvenance, type BaseRefSearchResult, type CreateWorktreeResult, type DetectedWorktree, type DetectedWorktreeListResult, type ForceDeleteWorktreeBranchResult, type GitHubPrStartPoint, type GitPushTarget, type GitWorktreeInfo, type GitHubOwnerRepo, type GlobalSettings, type PersistedUIState, type Project, type ProjectUpdateArgs, type ProjectHostSetup, type ProjectHostSetupCloneArgs, type ProjectHostSetupCreateArgs, type ProjectHostSetupCreateResult, type ProjectHostSetupDeleteArgs, type ProjectHostSetupDeleteResult, type ProjectHostSetupExistingFolderArgs, type ProjectHostSetupResult, type ProjectHostSetupUpdateArgs, type ProjectHostSetupUpdateResult, type Repo, type RemoveWorktreeResult, type StatsSummary, type Worktree, type WorktreeLineage, type WorkspaceLineage, type WorkspaceKey, type WorktreeLineageWarning, type WorktreeMeta, type WorktreeBaseStatusEvent, type WorktreeRemoteBranchConflictEvent, type WorktreeStartupLaunch, type LinearIssueUpdate, type LinearProjectSummary, type NestedRepoScanResult, type ProjectGroup, type FolderWorkspace, type ProjectGroupImportMode, type ProjectGroupImportResult, type MemorySnapshot, type Tab, type TabGroupLayoutNode, type TerminalQuickCommand, type TerminalLayoutSnapshot, type TerminalPaneLayoutNode, type TerminalTab, type TuiAgent, type WorkspaceCreateTelemetrySource, type WorkspaceSessionState, type WorkspaceLinkedItem, type DirEntry, type FilesystemPathFlavor, type GitLabIssueUpdate, type GitLabMRInlineCommentInput, type GitLabProjectRef, type GitLabWorkItem, type MRListState, type ClaudeRateLimitAccountsState, type CodexRateLimitAccountsState, type TaskSourceContext, assertWorktreeUnlockedForRemoval, LOCAL_EXECUTION_HOST_ID, getRepoExecutionHostId, getWorktreeExecutionHostId, parseExecutionHostId, toSshExecutionHostId, type ExecutionHostId, getRegisteredSshState, type AgentProviderSessionMetadata, type SleepingAgentLaunchConfig, type ExactWorkerProviderSession, type RuntimeClientEvent, toRuntimeActivateWorktreeEvent, navigationTargetsClients, navigationTargetsHost, type RuntimeNavigationTarget, type SshConnectionState, getPublicSshState, closeTerminalTabInWorkspaceSession, type LinearCurrentIssueContextHints, type LinearAttachResult, type LinearCommentAddResult, type LinearCreateResult, type LinearErrorCode, type LinearIssueListFilter, type LinearIssueListResult, type LinearProjectListResult, type LinearIssueSummary, type LinearIssueRequest, type LinearIssueTaskUpdateRequest, type LinearIssueTaskUpdateResult, type LinearMcpIssueListRequest, type LinearMcpIssueListResult, type LinearIssueRelationWriteRequest, type LinearIssueRelationWriteResult, type LinearSaveIssueRequest, type LinearSaveIssueResult, type LinearTeamLabelsResult, type LinearTeamListResult, type LinearTeamMembersResult, type LinearTeamStatesResult, type LinearStatusSetResult, HEADLESS_RUNTIME_WINDOW_ID, type RuntimeDesktopWindowStatus, type RuntimeGraphStatus, type RuntimeRepoSearchRefs, type RuntimeTerminalRead, type RuntimeTerminalRename, type RuntimeTerminalAgentStatus, type RuntimeTerminalSend, type RuntimeTerminalCreate, type RuntimeTerminalPresentation, type RuntimeTerminalSplit, type RuntimeTerminalFocus, type RuntimeTerminalClose, type RuntimeTerminalListResult, type RuntimeTerminalOrphanAdoptionRequest, type RuntimeTerminalOrphanAdoptionResult, type RuntimeWorktreeTerminalSleepResult, type RuntimeTerminalResolvePane, type RuntimeStatus, type RuntimeSyncWindowGraphResult, type RuntimeTerminalWait, type RuntimeTerminalWaitCondition, type RuntimeWorktreePsSummary, type RuntimeWorktreeAgentRow, type RuntimeSpeechModelSummary, type RuntimeSpeechSetupState, type RuntimeTerminalShow, type RuntimeTerminalInspect, type RuntimeTerminalResize, type RuntimeTerminalSummary, type RuntimeTerminalVisualGroupNode, type RuntimeTerminalVisualLayout, type RuntimeTerminalVisualLayoutNode, type RuntimeTerminalVisualPaneNode, type RuntimeTerminalVisualTab, type RuntimeSyncedLeaf, type RuntimeSyncedTab, type RuntimeMarkdownReadTabResult, type RuntimeMarkdownSaveTabResult, type RuntimeMobileSessionCreateTerminalResult, type RuntimeMobileSessionClientTab, type RuntimeMobileSessionTabCloseResult, type RuntimeMobileSessionMarkdownTab, type RuntimeMobileSessionTabMove, type RuntimeMobileSessionTabMoveResult, type RuntimeMobileSessionTabGroup, type RuntimeMobileSessionSnapshotTab, type RuntimeMobileSessionTerminalTab, type RuntimeMobileSessionBrowserTab, type RuntimeMobileSessionTabsRemovedResult, type RuntimeMobileSessionTabsResult, type RuntimeMobileSessionTabsSnapshot, type RuntimeSessionFlushResult, type RuntimeSessionSnapshot, type RuntimeNativeChatLaunchDraftResolution, type RuntimeSessionTabCloseReason, type RuntimeBrowserDriverState, type RuntimeTerminalDriverState, type RuntimeSyncWindowGraph, type RuntimeWorktreeListResult, type BrowserTabInfo, type BrowserScreencastResult, LINEAR_SEARCH_MAX_LIMIT, LINEAR_WRITE_BODY_CAP, clampLinearSearchLimit, isLinearUuid, type FeatureInteractionId, type TerminalPaneSplitSource, WORKTREE_ID_SEPARATOR, getRepoIdFromWorktreeId, splitWorktreeId, splitWorktreeIdForFilesystem, getProjectIdForProviderIdentity, getProjectHostSetupForRepo, getProjectHostSetupWorktreeMeta, clampLinearIssueListLimit, isFolderRepo, DEFAULT_WORKSPACE_STATUS_ID, buildSetupRunnerCommand, getSetupRunnerCommandPlatformForPath, createSequencedSetupAgentCommands, SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV, FIRST_PANE_ID, isTerminalLeafId, makePaneKey, parsePaneKey, parseAppSshPtyId, isValidHostTerminalTabId, isValidTerminalTabId, type TerminalQuickCommandMutation, isPtyIncarnationId, type PtyIncarnationId, buildAgentDraftLaunchPlan, buildAgentResumeStartupPlan, buildAgentStartupPlan, repoIsRemote, isAgentForegroundWrapperProcess, isExpectedAgentProcess, recognizeAgentProcess, isTuiAgentEnabled, pickTuiAgent, resolveTuiAgentLaunchArgs, resolveTuiAgentLaunchEnv, resolveLocalWindowsAgentStartupShell, isTuiAgent, TUI_AGENT_CONFIG, createDraftPasteReadyScanner, detectInstalledAgentsWithShellPathHydration, detectRemoteAgents, markCodexProjectTrusted, markCopilotFolderTrusted, markCursorWorkspaceTrusted, markRemoteAgentWorkspaceTrusted, applyAgentStatusHooksEnabled, recordManagedHookInstallFailure, isWindowsAbsolutePathLike, isPathInsideOrEqual, normalizeRuntimePathForComparison, resolveTerminalStartupCwd, isWslUncPath, parseWslUncPath, folderWorkspaceKey, isWorkspaceKey, parseWorkspaceKey, worktreeWorkspaceKey, projectResolvedWorktreeLineage, sharesResolvedWorktreeLineageBoundary, folderWorkspaceToWorktree, type FolderWorkspacePathStatus, type FolderWorkspacePathStatusRequest, applyMetadataFallbackVisibility, buildKnownOrcaWorkspaceLayouts, isLegacyRepoForExternalWorktreeVisibility, toDetectedWorktree, createAgentScratchWorktreePathMatcher, type AgentScratchWorktreePathMatcher, BROWSER_HEADLESS_RUNTIME_CAPABILITY, BROWSER_CERTIFICATE_TRUST_RUNTIME_CAPABILITY, MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION, ORCHESTRATION_CONTRACT_RUNTIME_CAPABILITY, ORCHESTRATION_CONTRACT_VERSION, REMOTE_RUNTIME_SHARED_CONTROL_CAPABILITY, RUNTIME_CAPABILITIES, RUNTIME_PROTOCOL_VERSION, TERMINAL_PAIRED_PARKING_RUNTIME_CAPABILITY, type RuntimeCapability, configureAiVaultSessionSources, listAiVaultSessions, type AiVaultListArgs, type AiVaultListResult, type AiVaultPrepareSessionResumeArgs, type AiVaultPrepareSessionResumeResult, type WorkspacePortKillRequest, type WorkspacePortKillResult, type WorkspacePortProbe, type WorkspacePortScanResult, filterWorkspacePortProbes, killWorkspacePort, scanWorkspacePortProbes, advertisedUrlWatcher, type AutomationService, RuntimeBrowserCommands, RemoteRuntimeTerminalCreateIdempotency, deriveRemoteRuntimeTerminalCreateHandle, buildHeadlessTerminalSplitLayout, countTerminalLayoutLeaves, RECENT_PTY_OUTPUT_LIMIT, TerminalOutputState, type RuntimeTerminalDataMeta, RuntimeGithubProjectCommands, RuntimeJiraCommands, WorktreeResolutionState, RuntimeTerminalInputCommands, RuntimeLinearQueryCommands, RuntimeLinearConnectionCommands, RuntimeReviewQueryCommands, RuntimeReviewMutationCommands, RuntimeRepoWorkItemCommands, RuntimeMessageWaiters, type MessageWaitResult, buildHeadlessTabGroupMove, buildHeadlessTabGroupSplit, hasExactTerminalOrphanGroupLayout, mergeTerminalOrphanGroupLayout, terminalOrphanExecutionOwnersEqual, retireTerminalSurfacesFromSnapshot, type RetiredTerminalSurface, retireTerminalSurfaceFromPersistence, advanceTerminalTopologyRevision, hasHostAuthoritativeTerminalMembership, RuntimeEmulatorCommands, setEmulatorBridge, type EmulatorBridge, RuntimeFileCommands, RuntimeGitCommands, appendRecentPtyPathCandidates, recentTerminalOutputIncludesPath, recentTerminalPathCandidatesIncludePath, detectTerminalWaitBlockedReason, isKnownReadyPromptPreview, buildPreview, buildTerminalWaitText, computeTerminalTailWaitState, MAX_TAIL_CHARS, tailGainedNewerBlockedReason, type TerminalTailWaitState, appendNormalizedToTailBuffer, type RetainedTailRedrawCursor, appendCompletedTerminalTranscript, tailStateMatches, normalizeTerminalChunk, DEFAULT_TERMINAL_READ_LIMIT, readTerminalTail, terminalReadLimit, shouldFallbackToVisibleTerminalSnapshot, visibleNonBlankTerminalLines, buildVisibleSnapshotReadFallback, MOBILE_AUTO_RESTORE_FIT_MAX_MS, MOBILE_AUTO_RESTORE_FIT_MIN_MS, TUI_IDLE_DEFAULT_TIMEOUT_MS, TUI_IDLE_POLL_INTERVAL_MS, TUI_IDLE_QUIESCENCE_MS, assertTerminalInputWithinLimitWithYield, buildSendPayload, buildPtyTerminalWaitResult, buildPtyTerminalWaitBlockedResult, buildTerminalWaitResult, buildTerminalWaitBlockedResult, detectExplicitIdleStatusFromTitle, getTerminalState, activateClientSessionTabSelection, ClientSessionTabSelectionStore, deriveClientSessionTabSelection, projectClientSessionTabSelection, type PtyProviderBufferSnapshot, type IPtyProvider, type PtyProcessInfo, type PtyTransientFact, ClaudeAgentTeamsService, type AgentTeamsTmuxCompatRequest, type AgentTeamsTmuxCompatResponse, buildClaudeAgentTeamsLaunchPlan, ensureClaudeAgentTeamsShimDir, resolveClaudeAgentTeamsShimBin, addClaudeTeammateModeAuto, addClaudeTeammateModeInProcess, collectMemorySnapshot, app, BrowserWindow, ipcMain, Notification, type AgentBrowserBridge, type BrowserBackend, BrowserError, getRepoSlug, getRepoUpstream, type getPRForBranch, resolveGitHubPrStartPoint, fetchGitHubPullRequestHeadRef, fetchPrHeadTrackingRef, gitlabMergeRequestHeadLocalRef, reviewHeadRemoteRefComponent, fetchGitLabMergeRequestHeadRef, isTransientReviewHeadFetchError, resolveGitHubReviewHeadRemote, fetchCompareBaseRefWithLocalFallback, pickPreferredGitRemote, closeGitLabMR, createGitLabIssue, diagnoseGitLabAuthClient, getGitLabJobTrace, getGitLabProjectRefForRemote, getGitLabRateLimit, getGitLabWorkItemByProjectRef, addGitLabIssueComment, addGitLabMRInlineComment, addGitLabMRComment, listGitLabTodos, listGitLabIssues, listGitLabLabels, listGitLabMergeRequests, listGitLabWorkItems, mergeGitLabMR, reopenGitLabMR, resolveGitLabMRDiscussion, retryGitLabJob, updateGitLabMR, updateGitLabMRReviewers, updateGitLabIssue, getGlabKnownHosts, getGitLabWorkItemDetails, normalizeGitLabIssueListArgs, normalizeGitLabMRListState, normalizeGitLabPositiveInteger, type GitLabIssueListState, recordGitLabProjectRecent, type CreateHostedReviewInput, type CreateHostedReviewResult, type HostedReviewCreationEligibility, type HostedReviewCreationEligibilityArgs, type HostedReviewInfo, getHostedReviewForBranchFromRepo, createHostedReviewFromRepo, getHostedReviewCreationEligibilityFromRepo, getLocalProjectGitExecOptions, getLocalProjectWorktreeGitOptions, getLocalProjectWorktreeGitOptionsForRuntime, resolveLocalProjectRuntimeForRepo, resolveLocalProjectRuntimesForRepos, resolveLocalProjectRuntimeForWorktreeId, type ProjectExecutionRuntimeResolution, resolveTerminalOrchestrationCliCommand, getLocalWorktreePathAccess, removeLocalWorktreePath, toLocalWorktreeRuntimePath, removeStaleLocalWorktreeRegistrationAfterFilesystemRemoval, recoverLocalWindowsWorktreeRemoval, getLinearStatus, isLinearAuthError, addLinearIssueCommentForAgent, createLinearIssueAttachment, createLinearIssueForAgent, getLinearAttachmentByUuidForAgent, getLinearCommentByUuidForAgent, getLinearIssueByUuidForAgent, getLinearIssueCommentThreadRoot, listLinearIssues, updateLinearIssueForAgent, LinearWriteFailure, LinearAgentAccessError, getLinearCurrentIssueFromWorktree, readLinearIssueContext, resolveLegacyLinearLinkWorkspace, classifyLinearError, linearError, linearMessage, sanitizeLinearErrorMessage, listMcpIssues, writeIssueRelation, getLinearProject, listLinearProjectsByExactName, listLinearProjectTeams, listLinearProjects, getLinearTeamLabelsOrThrow, getLinearTeamMembersOrThrow, getLinearTeamStatesOrThrow, getLinearViewerForWorkspaceOrThrow, listLinearTeamsForAgent, listLinearTeamsOrThrow, getBaseRefDefault, getDefaultRemote, getBranchConflictKind, isGitRepo, getRepoName, searchBaseRefDetails, getRemoteCount, normalizeRefSearchQuery, parseAndFilterSearchRefDetails, parseRemoteCount, resolveDefaultBaseRefViaExec, resolveDefaultBaseRefWithLocalGit, buildSearchBaseRefsArgv, isForEachRefExcludeUnsupportedError, mergeBaseRefSearchResultGroups, getRemoteDrift, getRecentDriftSubjects, hasCommitObjectViaGitExec, hasWorktreeBaseCommitRef, resolveLocalGitUsername, getSshGitCapabilityCache, listWorktrees, listWorktreesStrict, addWorktree, addSparseWorktree, assertWorktreeCleanForRemoval, forceDeleteLocalBranch, removeWorktree, type AddWorktreeOptions, type AddWorktreeResult, isENOENT, invalidateAuthorizedRootsCache, createSetupRunnerScript, getDefaultTabsLaunch, getEffectiveHooks, loadHooks, runHook, shouldRunSetupForCreate, DEFAULT_REPO_BADGE_COLOR, FLOATING_TERMINAL_WORKTREE_ID, getDefaultVoiceSettings, listRepoWorktrees, createWorktreeCopiedPaths, createWorktreeLinkedPaths, createWorktreeSharedPaths, findExistingWorktreeSymlinkPaths, removeWorktreeLinkedPaths, formatWorktreeIncludeCopyWarning, resolveWorktreeIncludePaths, getWorktreeSharedLinkPaths, resolveWorktreeSharedDirectories, deleteWorktreeHistoryDir, cleanupUnusedWorktreePushTargetRemote, cleanupUnusedWorktreePushTargetRemoteSsh, createRemoteWorktree, configureCreatedWorktreePushTarget, prepareWorktreePushTarget, getBranchNameOverrideCandidate, getWorktreeCreateCandidate, WORKTREE_CREATE_MAX_SUFFIX_ATTEMPTS, normalizeSparseDirectories, type Store, type StatsCollector, AgentDetector, computeWorktreePath, computeWorkspaceRoot, ensurePathWithinWorkspace, formatWorktreeRemovalError, getWorktreeCreationLayout, getWorktreePathSettings, isOrphanCompatiblePreflightError, isOrphanedWorktreeError, mergeWorktree, sanitizeWorktreeName, shouldSetDisplayName, areWorktreePathsEqual, findCreatedWorktree, assertWorktreeDoesNotContainRegisteredWorktree, canCleanupUnregisteredOrcaLeftoverDirectory, canCleanupUnregisteredOrcaWorktreeDirectory, canSafelyRemoveOrphanedWorktreeDirectory, findRegisteredDeletableWorktree, isDangerousWorktreeRemovalPath, ORPHANED_WORKTREE_DIRECTORY_MESSAGE, stripOrcaProvenanceMetaUpdates, UNREGISTERED_MISSING_WORKTREE_MESSAGE, prefetchWorktreeCreateBase, prepareLocalWorktreeRootForRepo, closeLocalWatcherForWorktreePath, closeRemoteWatcherForWorktreePath, forgetLocalWatcherRemovalSnapshot, forgetRemoteWatcherRemovalSnapshot, restoreLocalWatcherAfterFailedRemoval, restoreRemoteWatcherAfterFailedRemoval, acquireWatcherRemovalGate, createWatcherRemovalDeadline, drainBeforeWatcherRemoval, type WatcherRemovalDeadline, withWorktreeSpan, HeadlessEmulator, isNativeWindowsConptyPty, registerConptyDa1OverrideInstaller, shouldModelAnswerHiddenPtyQueries, getTerminalViewAttributes, getTerminalViewColorQueryReplyColors, registerTerminalViewAttributesApplier, killAllProcessesForWorktree, teardownRpcDeadline, stopMissingWorktreeTerminals, type ReplayableMobileNotification, RuntimeNotificationRegistry, MOBILE_SUBSCRIBE_SCROLLBACK_ROWS, createMobileSessionTabsNotifyCoalescer, type MobileSessionTabsNotifyCoalescer, getSshFilesystemProvider, assertFolderWorkspacePathUsable, getFolderWorkspacePathStatus, getFolderWorkspacePathStatusForPath, inferFolderWorkspacePathConnection, getSshGitProvider, getSshGitProviderGeneration, requireSshGitProvider, detectRepoIconAndUpstream, enrichMissingRepoGitRemoteIdentities, githubAvatarIcon, type ClaudeAccountService, type CodexAccountService, type CodexResetCreditRejectedBeforeProviderReason, type CodexAccountSelectionTarget, type RateLimitService, type CodexRateLimitResetOutcome, type RateLimitState, type CodexResetCreditExpectedScope, type VoiceSettings, getSpeechModelManager, getSpeechSttService, getCatalogModel, isLocalSpeechModel, SPEECH_MODEL_CATALOG, deleteLocalSpeechModel, getSpeechModelDeletionErrorCode, type CommitMessageAgentEnvironmentResolvers, scanNestedRepos, createNestedProjectGroupResolver, resolveNestedRepoSelection, createNestedRepoImportTargetResolver, RuntimeClientSettingsCommands, type RuntimeClientSettings, RuntimeAutomationCommands, type RuntimeAutomationCreateInput, type RuntimeAutomationUpdateInput, PtyLayoutQueue, type ApplyLayoutResult, type PtyLayoutState, type PtyLayoutTarget, PtyGenerationReferenceCount, RuntimeRepoHookCommands, branchSelectorMatches, buildRuntimeWorktreeSummaryPathIndex, canonicalizeTerminalSessionWorktreeId, classifyAgentTitle, classifyLatestAgentTitle, compareWorktreePs, findResolvedWorktreeIdForPath, findRuntimeWorktreeSummaryByPath, getExplicitWorktreeIdSelector, getLatestAgentCandidateTitle, getLatestAgentCandidateTitleInfo, getLatestLeafTitle, getLatestPtyTitle, getLeafWorktreeStatus, getSavedTabWorktreeStatus, includeTargetResolvedWorktree, indexPersistedPtySurfaceBindings, indexPersistedPtyWorktreeBindings, inferWorktreeIdFromPtyId, mapExplicitAgentStateToRuntimeTerminalStatus, maxTimestamp, mergeWorktreeStatus, notifyRuntimeListeners, parseRuntimeWorktreeId, resolveTerminalSessionWorktreeId, resolveWorktreeScanCacheTtlMs, runtimePathsEqual, runtimeWorktreeIdentityKey, runtimeWorktreeIdsEqual, type RuntimeWorktreeSummaryPathIndex, setBoundedMapEntry, setsEqual, terminalTitleBlocksExplicitAgentStatus, waitForWorktreeTerminalMutation, withTimeout, withTimeoutResult, getRuntimeWorktreeRemovalKey, getRuntimeWorktreeRemovalOptionsKey, isLocalRuntimeGitRepository, isRuntimeWorktreePathMissing, omitUndefinedProperties, parseExactWorktreeIdSelector, type PreservedBranchCleanupTarget, type RuntimeWorktreeRemovalInFlight, type RuntimeWorktreeRemovalTarget, addListenerToMap, canCheckoutExistingLocalBranch, clampTerminalViewport, getLocalGitHubPrForBranch, getSelectedHostedReviewForBranch, getSelectedReviewBranch, hasLocalGitOptions, isAllowedPushTargetRemoteConflict, isMatchingSelectedGitHubPr, resolveCreateBranchName, getRuntimeFolderWorkspaceInstanceId, getRuntimeFolderWorkspaceRootId, listRuntimeFolderWorkspaces, mergeRuntimeFolderWorkspace, copySleepingAgentLaunchConfig, deterministicAgentSessionUuid, inferCapturedClaudeAgentTeamsMode, isAgentSessionOperationOutcomeUnknown, isCursorAgentOrchestrationTarget, mergeTerminalEnvDeletionKeys, normalizeSparsePresetDirectoriesForSave, normalizeSparsePresetName, resolveBareAgentLaunchCommand, FETCH_FRESHNESS_MS, REMOTE_FETCH_TIMEOUT_MS, REMOTE_FETCH_CACHE_MAX, DRIFT_PROBE_SUBJECT_LIMIT, PTY_CONTROLLER_LIST_TIMEOUT_MS, WORKTREE_TERMINAL_SLEEP_TIMEOUT_MS, sanitizeNestedRepoRuntimeImportError, runtimeRepoMatchesExecutionHost, assertProjectHostSetupHostIsSupported, pathExists, resolveServerBrowsePath, type RuntimeAccountServices, type RemoteFetchResult, type RemoteTrackingBase, type AccountsSnapshot, type CodexRateLimitResetRpcResult, type RuntimeStore, type RuntimeLeafRecord, type RuntimePtyWorktreeRecord, type TerminalCreateOptions, AGENT_SESSION_OPERATION_PER_CLIENT_LIMIT, AGENT_SESSION_OPERATION_GLOBAL_LIMIT, SESSION_SNAPSHOT_STABILITY_ATTEMPTS, type PtyForegroundAgentRefresh, type RuntimeTerminalAgentStatusEvent, type RuntimePtyTitleTrackerEntry, type RuntimeAgentRowSnapshot, type AgentSessionCreateOperation, type RuntimeHeadlessTerminal, type RuntimePtyDataAdmission, type RuntimeVisibleTerminalState, type ProviderBufferAcquisition, type RuntimeTerminalBufferSnapshot, type HeadlessSeedMetadata, type RuntimePtyController, type PtyControllerTerminalIdentity, type PtyControllerInventory, type WorktreeStartupDraftPaste, type WorktreeStartupFollowup, getAgentLaunchPlatformForRepo, MOBILE_TERMINAL_CREATE_RESULT_TTL_MS, WORKTREE_CREATE_RESULT_TTL_MS, FOREGROUND_AGENT_WRAPPER_RETRY_INTERVAL_MS, FOREGROUND_AGENT_WRAPPER_RETRY_TIMEOUT_MS, BRACKETED_PASTE_BEGIN, BRACKETED_PASTE_END, BRACKETED_PASTE_QUIET_MS, DRAFT_PASTE_READY_TIMEOUT_MS, MOBILE_TERMINAL_SURFACE_TIMEOUT_MS, MOBILE_TERMINAL_READY_FALLBACK_MS, SSH_PANE_RECOVERY_GRACE_MS, isClientDisconnectedError, createTerminalRevealWarning, ownerSurfacing, resolveTerminalPresentation, type RuntimeNotifier, type TerminalHandleRecord, type OrchestrationCompatibilityTerminalAuthority, type LegacyWorkerTerminalRecoveryResult, type OrchestrationCompatibilityCallerAuthority, type RestoredOrchestrationAuthorityReceipt, type OrchestrationCompatibilitySshAttachmentAuthority, type TerminalWaiter, type ResolvedWorktree, type LinearAgentWriteTarget, type LinearCreateFieldIntent, AGENT_HOOK_RUNTIME_ENV_KEYS, sameStringSet, labelsForIds, type TerminalWorkspaceLaunchScope, type WorktreeLineageInput, type ResolvedWorkspaceParent, type WorktreeLineageResolution, type RuntimeWorktreeScanResult, type WorktreeLineageCandidate, extractOrchestrationTaskId, RuntimeLineageError, WorktreeIdRequiresFullPathError, type ResolvedWorktreeSnapshot, type MobileNotificationDispatchEvent, type RuntimeWorktreeLifecycleEvent, type MobileNotificationDismissEvent, type MobileNotificationEvent, type DriverState, type NativeChatLaunchDraftResolutionTombstone, MAX_NATIVE_CHAT_LAUNCH_DRAFT_RESOLUTION_TOMBSTONES, MAX_DELETED_FOLDER_TERMINAL_RETIREMENT_FENCES, MAX_TERMINAL_SURFACE_RETIREMENT_FENCES, hasLocalWorktreeBaseRef, makePtyDurableRetirementKey } from './orca-runtime-symbols'
import { OrcaRuntimeLinearIssueListForAgentsPart81 } from './orca-runtime-linear-issue-list-for-agents-part-81'

export class OrcaRuntimeLinearIssueUpdateTaskPart82 extends OrcaRuntimeLinearIssueListForAgentsPart81 {
  async linearIssueUpdateTask(
    params: LinearIssueTaskUpdateRequest
  ): Promise<LinearIssueTaskUpdateResult> {
    const target = await this.resolveLinearAgentWriteTarget(params)
    const current = await this.readLinearAgentIssueWriteRecord(target.issue.id, target.workspaceId)
    const update = await this.buildLinearTaskUpdate(params, current, target.workspaceId)
    if (!update) {
      throw linearError('linear_write_failed', 'No Linear task field update was requested.')
    }
    const alreadySet = this.linearTaskFieldAlreadySet(params.operation, current, update)
    if (!alreadySet) {
      await this.runLinearAgentWrite(
        async (signal) => {
          const updated = await updateLinearIssueForAgent(
            target.issue.id,
            update.fields,
            target.workspaceId,
            { signal }
          )
          if (!this.linearTaskFieldAlreadySet(params.operation, updated, update)) {
            throw new LinearWriteFailure(
              'unconfirmed',
              'Linear task field update could not be confirmed.'
            )
          }
          return updated
        },
        (cause) =>
          linearError(
            'linear_write_unconfirmed',
            'Linear may have applied the task update, but Orca could not confirm it.',
            {
              nextSteps: [
                `Run \`orca linear issue ${target.issue.identifier} --workspace ${target.workspaceId} --json\` and check the updated field before retrying.`
              ],
              ...(cause ? { cause } : {})
            }
          )
      )
    }
    await this.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
    const finalRecord = alreadySet
      ? current
      : await this.readLinearAgentIssueWriteRecord(target.issue.id, target.workspaceId)
    return this.linearTaskUpdateResult(
      params.operation,
      target.issue,
      target.workspaceId,
      current,
      finalRecord,
      alreadySet
    )
  }
  async linearIssueAddComment(params: {
    input?: string
    current?: boolean
    workspaceId?: string
    body: string
    replyTo?: string
    writeId?: string
    context?: LinearCurrentIssueContextHints
  }): Promise<LinearCommentAddResult> {
    if (params.body.length > LINEAR_WRITE_BODY_CAP) {
      throw linearError('linear_body_too_large', 'Linear comment body is too large.')
    }
    const target = await this.resolveLinearAgentWriteTarget(params)
    const parentId = params.replyTo
      ? await this.resolveLinearCommentParentId(target.issue.id, params.replyTo, target.workspaceId)
      : null
    const writeId = params.writeId ?? randomUUID()
    const existing =
      params.writeId !== undefined
        ? await this.getMatchingLinearCommentWrite(
            writeId,
            target.issue.id,
            parentId,
            target.workspaceId,
            true
          )
        : null
    if (existing) {
      await this.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
      return this.linearCommentResult(existing, target, params.body.length, writeId, true)
    }

    try {
      const comment = await this.runLinearAgentWrite(
        (signal) =>
          addLinearIssueCommentForAgent(target.issue.id, params.body, target.workspaceId, {
            id: writeId,
            parentId,
            signal
          }),
        (cause) =>
          this.linearCreateStyleUnconfirmed('comment', writeId, target, {
            parentId,
            bodyRequired: true,
            cause
          })
      )
      await this.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
      return this.linearCommentResult(comment, target, params.body.length, writeId, false)
    } catch (error) {
      if (error instanceof LinearWriteFailure && error.kind === 'duplicate_id') {
        const comment = await this.refetchLinearCommentAfterDuplicate(
          writeId,
          target.issue.id,
          parentId,
          target.workspaceId,
          () =>
            this.linearCreateStyleUnconfirmed('comment', writeId, target, {
              parentId,
              bodyRequired: true
            })
        )
        await this.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
        return this.linearCommentResult(comment, target, params.body.length, writeId, true)
      }
      throw error
    }
  }
  async linearIssueAttachLink(params: {
    input?: string
    current?: boolean
    workspaceId?: string
    url: string
    title?: string
    writeId?: string
    context?: LinearCurrentIssueContextHints
  }): Promise<LinearAttachResult> {
    const url = this.parseLinearAttachmentUrl(params.url)
    const target = await this.resolveLinearAgentWriteTarget(params)
    const writeId = params.writeId ?? randomUUID()
    const title = params.title?.trim() || this.defaultLinearAttachmentTitle(url)
    const existing =
      params.writeId !== undefined
        ? await this.getMatchingLinearAttachmentWrite(
            writeId,
            target.issue.id,
            target.workspaceId,
            true
          )
        : null
    if (existing) {
      await this.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
      return this.linearAttachResult(existing, target, writeId, true)
    }
    try {
      const attachment = await this.runLinearAgentWrite(
        (signal) =>
          createLinearIssueAttachment(
            target.issue.id,
            { id: writeId, title, url: url.toString() },
            target.workspaceId,
            { signal }
          ),
        (cause) =>
          this.linearCreateStyleUnconfirmed('attach', writeId, target, {
            title,
            url: url.toString(),
            cause
          })
      )
      await this.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
      return this.linearAttachResult(attachment, target, writeId, false)
    } catch (error) {
      if (error instanceof LinearWriteFailure && error.kind === 'duplicate_id') {
        const attachment = await this.refetchLinearAttachmentAfterDuplicate(
          writeId,
          target.issue.id,
          target.workspaceId,
          () =>
            this.linearCreateStyleUnconfirmed('attach', writeId, target, {
              title,
              url: url.toString()
            })
        )
        await this.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
        return this.linearAttachResult(attachment, target, writeId, true)
      }
      throw error
    }
  }
  async linearIssueCreate(params: {
    title: string
    body?: string
    teamInput?: string
    teamKey?: string
    state?: string
    assignee?: string
    priority?: number
    estimate?: number
    dueDate?: string
    labels?: string[]
    projectInput?: string
    parentInput?: string
    parentCurrent?: boolean
    workspaceId?: string
    writeId?: string
    context?: LinearCurrentIssueContextHints
  }): Promise<LinearCreateResult> {
    if ((params.body?.length ?? 0) > LINEAR_WRITE_BODY_CAP) {
      throw linearError('linear_body_too_large', 'Linear issue body is too large.')
    }
    const parent =
      params.parentInput || params.parentCurrent
        ? await this.resolveLinearAgentWriteTarget({
            input: params.parentInput,
            current: params.parentCurrent,
            workspaceId: params.workspaceId,
            context: params.context
          })
        : null
    if (parent && params.workspaceId && params.workspaceId !== parent.workspaceId) {
      throw linearError(
        'linear_invalid_workspace',
        'The parent issue belongs to a different workspace.'
      )
    }
    const team = await this.resolveLinearCreateTeam(
      params.teamInput ?? params.teamKey,
      params.workspaceId,
      parent
    )
    const createFields = await this.resolveLinearCreateFields(params, team)
    const parentId = parent?.issue.id ?? null
    const writeId = params.writeId ?? randomUUID()
    const existing =
      params.writeId !== undefined
        ? await this.getMatchingLinearCreatedIssue(
            writeId,
            team.id,
            parentId,
            team.workspaceId,

            true,
            createFields
          )
        : null
    if (existing) {
      if (parent) {
        await this.notifyLinearLinkedIssueUpdated(parent.workspaceId, parent.issue.identifier)
      }
      return this.linearCreateResult(existing, team.workspaceId, writeId, true)
    }

    try {
      const issue = await this.runLinearAgentWrite(
        async (signal) => {
          const created = await createLinearIssueForAgent(
            team.id,
            params.title,
            params.body,
            team.workspaceId,
            {
              id: writeId,
              parentId,
              ...createFields,
              signal
            }
          )
          if (!this.linearCreatedIssueMatchesIntent(created, createFields)) {
            throw new LinearWriteFailure(
              'unconfirmed',
              'Linear issue create could not be confirmed with the requested task fields.'
            )
          }
          return created
        },
        (cause) =>
          this.linearCreateStyleUnconfirmed('create', writeId, null, {
            team,
            parent,
            title: params.title,
            bodyRequired: params.body !== undefined,
            createFields,
            cause
          })
      )
      if (parent) {
        await this.notifyLinearLinkedIssueUpdated(parent.workspaceId, parent.issue.identifier)
      }
      return this.linearCreateResult(issue, team.workspaceId, writeId, false)
    } catch (error) {
      if (error instanceof LinearWriteFailure && error.kind === 'duplicate_id') {
        const issue = await this.refetchLinearIssueAfterDuplicate(
          writeId,
          team.id,
          parentId,
          team.workspaceId,
          createFields,
          () =>
            this.linearCreateStyleUnconfirmed('create', writeId, null, {
              team,
              parent,
              title: params.title,
              bodyRequired: params.body !== undefined,
              createFields
            })
        )
        if (parent) {
          await this.notifyLinearLinkedIssueUpdated(parent.workspaceId, parent.issue.identifier)
        }
        return this.linearCreateResult(issue, team.workspaceId, writeId, true)
      }
      throw error
    }
  }
  protected async resolveLinearAgentWriteTarget(params: {
    input?: string
    current?: boolean
    workspaceId?: string
    context?: LinearCurrentIssueContextHints
  }): Promise<LinearAgentWriteTarget> {
    const result = await readLinearIssueContext(
      {
        input: params.input,
        current: params.current,
        workspaceId: params.workspaceId,
        include: {
          comments: false,
          children: false,
          attachments: false,
          relations: false,
          activity: false
        },
        depth: 0,
        context: params.context
      },
      (context) => this.linearResolveCurrentIssue(context)
    )
    return { issue: result.issue, workspaceId: result.meta.resolved.workspaceId }
  }
  protected async getLinearTeamStatesForWrite(
    teamId: string,
    workspaceId: string
  ): Promise<Awaited<ReturnType<typeof getLinearTeamStatesOrThrow>>> {
    try {
      return await getLinearTeamStatesOrThrow(teamId, workspaceId)
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
  }
  protected resolveLinearAgentState(
    input: string,
    states: Awaited<ReturnType<typeof getLinearTeamStatesOrThrow>>
  ): Awaited<ReturnType<typeof getLinearTeamStatesOrThrow>>[number] | null {
    const normalized = input.toLocaleLowerCase()
    const exact = states.find(
      (state) =>
        state.id.toLocaleLowerCase() === normalized || state.name.toLocaleLowerCase() === normalized
    )
    // Why: Linear MCP accepts lifecycle types; keep explicit IDs/names authoritative when they collide.
    return exact ?? states.find((state) => state.type.toLocaleLowerCase() === normalized) ?? null
  }
  protected async getLinearTeamLabelsForWrite(
    teamId: string,
    workspaceId: string
  ): Promise<Awaited<ReturnType<typeof getLinearTeamLabelsOrThrow>>> {
    try {
      return await getLinearTeamLabelsOrThrow(teamId, workspaceId)
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
  }
  protected async readLinearAgentIssueWriteRecord(
    issueId: string,
    workspaceId: string
  ): Promise<NonNullable<Awaited<ReturnType<typeof getLinearIssueByUuidForAgent>>>> {
    const issue = await this.readLinearWriteLookup(() =>
      getLinearIssueByUuidForAgent(issueId, workspaceId)
    )
    if (!issue) {
      throw linearError('linear_issue_not_found', 'Linear issue was not found.')
    }
    return issue
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
