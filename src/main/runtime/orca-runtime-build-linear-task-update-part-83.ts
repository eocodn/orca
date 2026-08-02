import { detectAgentStatusFromTitle, isClaudeManagementTitle, isCursorNativeAgentTitle, isShellProcess, normalizeTerminalTitle, extractOscTitleScanTail, normalizeFolderWorkspaceOperationId, isServerDriveListRequest, listWindowsDrives, extractLastOsc7Uri, extractOscScanTail, parseFileUriPathParts, type AgentStatus, type TerminalOscLinkRange, type TerminalOscColorQueryReplyColors, type TerminalOutputSourceRange, type RemoteTerminalSourceRangeConsumerHooks, type RemoteTerminalSourceRangeReplacementPublication, type RemoteTerminalSourceRangeReplacementReservation, type RemoteTerminalSourceRangeStreamIdentity, createTerminalTitleTracker, stripBrailleSpinnerGlyphs, type TerminalTitleTracker, createCommandCodeOutputStatusDetector, type TerminalSideEffectBatch, type TerminalSideEffectFact, type TerminalGitHubPRLink, TerminalKittyKeyboardModeTracker, AGENT_STATUS_STALE_AFTER_MS, isFreshNonDoneAgentStatus, type AgentStatusIpcPayload, type ParsedAgentStatusPayload, type AgentStatusOrchestrationContext, type AgentStatusEntry, indexAgentStatusRowsByPaneKey, type AgentHookAuthorityAttestation, type AgentSessionClaimedSpawnResult, type AgentSessionExecutionClaim, type AgentSessionSurfaceBinding, type AgentLaunchPreferences, type RuntimeAgentSessionRpcCaller, type RuntimeCreateAgentSessionRequest, type RuntimeCreateAgentSessionResult, type RuntimeEnsureAgentSessionRequest, type RuntimeEnsureAgentSessionResult, AGENT_SESSION_MAX_NEW_OPERATION_AGE_MS, AGENT_SESSION_OPERATION_FUTURE_SKEW_MS, parseAgentSessionOperationTimestamp, canonicalizeAgentSessionIdentity, createEphemeralAgentSessionClaimSigner, type AgentSessionClaimSigner, hasCompatibleAgentTitleIdentity, normalizeCompatibleAgentStatusEntryForOwner, normalizeCompatibleAgentTitleForOwner, resolveCompatibleAgentTypeForOwner, resolvePaneAgentOwner, createAgentStatusOscProcessor, type ProcessedAgentStatusChunk, buildOrchestrationTaskDisplayMetadata, assertTerminalDimensions, AGENT_PROMPT_SUBMIT, buildAgentPromptPasteBytes, gitExecFileAsync, gitSpawn, nonInteractiveGitEnv, runWithGitReadCacheInvalidation, cleanupClaimedCloneTarget, claimCloneTarget, deriveValidatedClonePath, getClonePathComparisonKey, getGitCloneFailureMessage, GIT_FETCH_SKIP_AUTO_MAINTENANCE_CONFIG_ARGS, createHash, randomUUID, homedir, isAbsolute, join, resolve, mkdir, readdir, rm, stat, resolveWorktreeCreateBase, resolveWorktreeAddBaseRef, OrchestrationDb, OrchestrationError, planLegacyWorkerTerminalRecovery, type LegacyWorkerTerminalRecoveryPlan, buildObservedSetupCommand, createSetupCompletionScanner, type RuntimeOrchestrationEnvelope, type TerminalRevealIdentity, type OrchestrationCompatibilityEvidence, type OrchestrationCompatibilityHostStamp, isOrchestrationMutation, orchestrationMigrationData, type OrchestrationEnvironmentTransport, type OrchestrationWorkerServer, syncFederatedDispatch, formatMessagesForInjection, selectExactWorkerProviderSession, type Automation, type AutomationRun, type AutomationWorkspaceProvenance, type CliWorkspaceProvenance, type BaseRefSearchResult, type CreateWorktreeResult, type DetectedWorktree, type DetectedWorktreeListResult, type ForceDeleteWorktreeBranchResult, type GitHubPrStartPoint, type GitPushTarget, type GitWorktreeInfo, type GitHubOwnerRepo, type GlobalSettings, type PersistedUIState, type Project, type ProjectUpdateArgs, type ProjectHostSetup, type ProjectHostSetupCloneArgs, type ProjectHostSetupCreateArgs, type ProjectHostSetupCreateResult, type ProjectHostSetupDeleteArgs, type ProjectHostSetupDeleteResult, type ProjectHostSetupExistingFolderArgs, type ProjectHostSetupResult, type ProjectHostSetupUpdateArgs, type ProjectHostSetupUpdateResult, type Repo, type RemoveWorktreeResult, type StatsSummary, type Worktree, type WorktreeLineage, type WorkspaceLineage, type WorkspaceKey, type WorktreeLineageWarning, type WorktreeMeta, type WorktreeBaseStatusEvent, type WorktreeRemoteBranchConflictEvent, type WorktreeStartupLaunch, type LinearIssueUpdate, type LinearProjectSummary, type NestedRepoScanResult, type ProjectGroup, type FolderWorkspace, type ProjectGroupImportMode, type ProjectGroupImportResult, type MemorySnapshot, type Tab, type TabGroupLayoutNode, type TerminalQuickCommand, type TerminalLayoutSnapshot, type TerminalPaneLayoutNode, type TerminalTab, type TuiAgent, type WorkspaceCreateTelemetrySource, type WorkspaceSessionState, type WorkspaceLinkedItem, type DirEntry, type FilesystemPathFlavor, type GitLabIssueUpdate, type GitLabMRInlineCommentInput, type GitLabProjectRef, type GitLabWorkItem, type MRListState, type ClaudeRateLimitAccountsState, type CodexRateLimitAccountsState, type TaskSourceContext, assertWorktreeUnlockedForRemoval, LOCAL_EXECUTION_HOST_ID, getRepoExecutionHostId, getWorktreeExecutionHostId, parseExecutionHostId, toSshExecutionHostId, type ExecutionHostId, getRegisteredSshState, type AgentProviderSessionMetadata, type SleepingAgentLaunchConfig, type ExactWorkerProviderSession, type RuntimeClientEvent, toRuntimeActivateWorktreeEvent, navigationTargetsClients, navigationTargetsHost, type RuntimeNavigationTarget, type SshConnectionState, getPublicSshState, closeTerminalTabInWorkspaceSession, type LinearCurrentIssueContextHints, type LinearAttachResult, type LinearCommentAddResult, type LinearCreateResult, type LinearErrorCode, type LinearIssueListFilter, type LinearIssueListResult, type LinearProjectListResult, type LinearIssueSummary, type LinearIssueRequest, type LinearIssueTaskUpdateRequest, type LinearIssueTaskUpdateResult, type LinearMcpIssueListRequest, type LinearMcpIssueListResult, type LinearIssueRelationWriteRequest, type LinearIssueRelationWriteResult, type LinearSaveIssueRequest, type LinearSaveIssueResult, type LinearTeamLabelsResult, type LinearTeamListResult, type LinearTeamMembersResult, type LinearTeamStatesResult, type LinearStatusSetResult, HEADLESS_RUNTIME_WINDOW_ID, type RuntimeDesktopWindowStatus, type RuntimeGraphStatus, type RuntimeRepoSearchRefs, type RuntimeTerminalRead, type RuntimeTerminalRename, type RuntimeTerminalAgentStatus, type RuntimeTerminalSend, type RuntimeTerminalCreate, type RuntimeTerminalPresentation, type RuntimeTerminalSplit, type RuntimeTerminalFocus, type RuntimeTerminalClose, type RuntimeTerminalListResult, type RuntimeTerminalOrphanAdoptionRequest, type RuntimeTerminalOrphanAdoptionResult, type RuntimeWorktreeTerminalSleepResult, type RuntimeTerminalResolvePane, type RuntimeStatus, type RuntimeSyncWindowGraphResult, type RuntimeTerminalWait, type RuntimeTerminalWaitCondition, type RuntimeWorktreePsSummary, type RuntimeWorktreeAgentRow, type RuntimeSpeechModelSummary, type RuntimeSpeechSetupState, type RuntimeTerminalShow, type RuntimeTerminalInspect, type RuntimeTerminalResize, type RuntimeTerminalSummary, type RuntimeTerminalVisualGroupNode, type RuntimeTerminalVisualLayout, type RuntimeTerminalVisualLayoutNode, type RuntimeTerminalVisualPaneNode, type RuntimeTerminalVisualTab, type RuntimeSyncedLeaf, type RuntimeSyncedTab, type RuntimeMarkdownReadTabResult, type RuntimeMarkdownSaveTabResult, type RuntimeMobileSessionCreateTerminalResult, type RuntimeMobileSessionClientTab, type RuntimeMobileSessionTabCloseResult, type RuntimeMobileSessionMarkdownTab, type RuntimeMobileSessionTabMove, type RuntimeMobileSessionTabMoveResult, type RuntimeMobileSessionTabGroup, type RuntimeMobileSessionSnapshotTab, type RuntimeMobileSessionTerminalTab, type RuntimeMobileSessionBrowserTab, type RuntimeMobileSessionTabsRemovedResult, type RuntimeMobileSessionTabsResult, type RuntimeMobileSessionTabsSnapshot, type RuntimeSessionFlushResult, type RuntimeSessionSnapshot, type RuntimeNativeChatLaunchDraftResolution, type RuntimeSessionTabCloseReason, type RuntimeBrowserDriverState, type RuntimeTerminalDriverState, type RuntimeSyncWindowGraph, type RuntimeWorktreeListResult, type BrowserTabInfo, type BrowserScreencastResult, LINEAR_SEARCH_MAX_LIMIT, LINEAR_WRITE_BODY_CAP, clampLinearSearchLimit, isLinearUuid, type FeatureInteractionId, type TerminalPaneSplitSource, WORKTREE_ID_SEPARATOR, getRepoIdFromWorktreeId, splitWorktreeId, splitWorktreeIdForFilesystem, getProjectIdForProviderIdentity, getProjectHostSetupForRepo, getProjectHostSetupWorktreeMeta, clampLinearIssueListLimit, isFolderRepo, DEFAULT_WORKSPACE_STATUS_ID, buildSetupRunnerCommand, getSetupRunnerCommandPlatformForPath, createSequencedSetupAgentCommands, SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV, FIRST_PANE_ID, isTerminalLeafId, makePaneKey, parsePaneKey, parseAppSshPtyId, isValidHostTerminalTabId, isValidTerminalTabId, type TerminalQuickCommandMutation, isPtyIncarnationId, type PtyIncarnationId, buildAgentDraftLaunchPlan, buildAgentResumeStartupPlan, buildAgentStartupPlan, repoIsRemote, isAgentForegroundWrapperProcess, isExpectedAgentProcess, recognizeAgentProcess, isTuiAgentEnabled, pickTuiAgent, resolveTuiAgentLaunchArgs, resolveTuiAgentLaunchEnv, resolveLocalWindowsAgentStartupShell, isTuiAgent, TUI_AGENT_CONFIG, createDraftPasteReadyScanner, detectInstalledAgentsWithShellPathHydration, detectRemoteAgents, markCodexProjectTrusted, markCopilotFolderTrusted, markCursorWorkspaceTrusted, markRemoteAgentWorkspaceTrusted, applyAgentStatusHooksEnabled, recordManagedHookInstallFailure, isWindowsAbsolutePathLike, isPathInsideOrEqual, normalizeRuntimePathForComparison, resolveTerminalStartupCwd, isWslUncPath, parseWslUncPath, folderWorkspaceKey, isWorkspaceKey, parseWorkspaceKey, worktreeWorkspaceKey, projectResolvedWorktreeLineage, sharesResolvedWorktreeLineageBoundary, folderWorkspaceToWorktree, type FolderWorkspacePathStatus, type FolderWorkspacePathStatusRequest, applyMetadataFallbackVisibility, buildKnownOrcaWorkspaceLayouts, isLegacyRepoForExternalWorktreeVisibility, toDetectedWorktree, createAgentScratchWorktreePathMatcher, type AgentScratchWorktreePathMatcher, BROWSER_HEADLESS_RUNTIME_CAPABILITY, BROWSER_CERTIFICATE_TRUST_RUNTIME_CAPABILITY, MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION, ORCHESTRATION_CONTRACT_RUNTIME_CAPABILITY, ORCHESTRATION_CONTRACT_VERSION, REMOTE_RUNTIME_SHARED_CONTROL_CAPABILITY, RUNTIME_CAPABILITIES, RUNTIME_PROTOCOL_VERSION, TERMINAL_PAIRED_PARKING_RUNTIME_CAPABILITY, type RuntimeCapability, configureAiVaultSessionSources, listAiVaultSessions, type AiVaultListArgs, type AiVaultListResult, type AiVaultPrepareSessionResumeArgs, type AiVaultPrepareSessionResumeResult, type WorkspacePortKillRequest, type WorkspacePortKillResult, type WorkspacePortProbe, type WorkspacePortScanResult, filterWorkspacePortProbes, killWorkspacePort, scanWorkspacePortProbes, advertisedUrlWatcher, type AutomationService, RuntimeBrowserCommands, RemoteRuntimeTerminalCreateIdempotency, deriveRemoteRuntimeTerminalCreateHandle, buildHeadlessTerminalSplitLayout, countTerminalLayoutLeaves, RECENT_PTY_OUTPUT_LIMIT, TerminalOutputState, type RuntimeTerminalDataMeta, RuntimeGithubProjectCommands, RuntimeJiraCommands, WorktreeResolutionState, RuntimeTerminalInputCommands, RuntimeLinearQueryCommands, RuntimeLinearConnectionCommands, RuntimeReviewQueryCommands, RuntimeReviewMutationCommands, RuntimeRepoWorkItemCommands, RuntimeMessageWaiters, type MessageWaitResult, buildHeadlessTabGroupMove, buildHeadlessTabGroupSplit, hasExactTerminalOrphanGroupLayout, mergeTerminalOrphanGroupLayout, terminalOrphanExecutionOwnersEqual, retireTerminalSurfacesFromSnapshot, type RetiredTerminalSurface, retireTerminalSurfaceFromPersistence, advanceTerminalTopologyRevision, hasHostAuthoritativeTerminalMembership, RuntimeEmulatorCommands, setEmulatorBridge, type EmulatorBridge, RuntimeFileCommands, RuntimeGitCommands, appendRecentPtyPathCandidates, recentTerminalOutputIncludesPath, recentTerminalPathCandidatesIncludePath, detectTerminalWaitBlockedReason, isKnownReadyPromptPreview, buildPreview, buildTerminalWaitText, computeTerminalTailWaitState, MAX_TAIL_CHARS, tailGainedNewerBlockedReason, type TerminalTailWaitState, appendNormalizedToTailBuffer, type RetainedTailRedrawCursor, appendCompletedTerminalTranscript, tailStateMatches, normalizeTerminalChunk, DEFAULT_TERMINAL_READ_LIMIT, readTerminalTail, terminalReadLimit, shouldFallbackToVisibleTerminalSnapshot, visibleNonBlankTerminalLines, buildVisibleSnapshotReadFallback, MOBILE_AUTO_RESTORE_FIT_MAX_MS, MOBILE_AUTO_RESTORE_FIT_MIN_MS, TUI_IDLE_DEFAULT_TIMEOUT_MS, TUI_IDLE_POLL_INTERVAL_MS, TUI_IDLE_QUIESCENCE_MS, assertTerminalInputWithinLimitWithYield, buildSendPayload, buildPtyTerminalWaitResult, buildPtyTerminalWaitBlockedResult, buildTerminalWaitResult, buildTerminalWaitBlockedResult, detectExplicitIdleStatusFromTitle, getTerminalState, activateClientSessionTabSelection, ClientSessionTabSelectionStore, deriveClientSessionTabSelection, projectClientSessionTabSelection, type PtyProviderBufferSnapshot, type IPtyProvider, type PtyProcessInfo, type PtyTransientFact, ClaudeAgentTeamsService, type AgentTeamsTmuxCompatRequest, type AgentTeamsTmuxCompatResponse, buildClaudeAgentTeamsLaunchPlan, ensureClaudeAgentTeamsShimDir, resolveClaudeAgentTeamsShimBin, addClaudeTeammateModeAuto, addClaudeTeammateModeInProcess, collectMemorySnapshot, app, BrowserWindow, ipcMain, Notification, type AgentBrowserBridge, type BrowserBackend, BrowserError, getRepoSlug, getRepoUpstream, type getPRForBranch, resolveGitHubPrStartPoint, fetchGitHubPullRequestHeadRef, fetchPrHeadTrackingRef, gitlabMergeRequestHeadLocalRef, reviewHeadRemoteRefComponent, fetchGitLabMergeRequestHeadRef, isTransientReviewHeadFetchError, resolveGitHubReviewHeadRemote, fetchCompareBaseRefWithLocalFallback, pickPreferredGitRemote, closeGitLabMR, createGitLabIssue, diagnoseGitLabAuthClient, getGitLabJobTrace, getGitLabProjectRefForRemote, getGitLabRateLimit, getGitLabWorkItemByProjectRef, addGitLabIssueComment, addGitLabMRInlineComment, addGitLabMRComment, listGitLabTodos, listGitLabIssues, listGitLabLabels, listGitLabMergeRequests, listGitLabWorkItems, mergeGitLabMR, reopenGitLabMR, resolveGitLabMRDiscussion, retryGitLabJob, updateGitLabMR, updateGitLabMRReviewers, updateGitLabIssue, getGlabKnownHosts, getGitLabWorkItemDetails, normalizeGitLabIssueListArgs, normalizeGitLabMRListState, normalizeGitLabPositiveInteger, type GitLabIssueListState, recordGitLabProjectRecent, type CreateHostedReviewInput, type CreateHostedReviewResult, type HostedReviewCreationEligibility, type HostedReviewCreationEligibilityArgs, type HostedReviewInfo, getHostedReviewForBranchFromRepo, createHostedReviewFromRepo, getHostedReviewCreationEligibilityFromRepo, getLocalProjectGitExecOptions, getLocalProjectWorktreeGitOptions, getLocalProjectWorktreeGitOptionsForRuntime, resolveLocalProjectRuntimeForRepo, resolveLocalProjectRuntimesForRepos, resolveLocalProjectRuntimeForWorktreeId, type ProjectExecutionRuntimeResolution, resolveTerminalOrchestrationCliCommand, getLocalWorktreePathAccess, removeLocalWorktreePath, toLocalWorktreeRuntimePath, removeStaleLocalWorktreeRegistrationAfterFilesystemRemoval, recoverLocalWindowsWorktreeRemoval, getLinearStatus, isLinearAuthError, addLinearIssueCommentForAgent, createLinearIssueAttachment, createLinearIssueForAgent, getLinearAttachmentByUuidForAgent, getLinearCommentByUuidForAgent, getLinearIssueByUuidForAgent, getLinearIssueCommentThreadRoot, listLinearIssues, updateLinearIssueForAgent, LinearWriteFailure, LinearAgentAccessError, getLinearCurrentIssueFromWorktree, readLinearIssueContext, resolveLegacyLinearLinkWorkspace, classifyLinearError, linearError, linearMessage, sanitizeLinearErrorMessage, listMcpIssues, writeIssueRelation, getLinearProject, listLinearProjectsByExactName, listLinearProjectTeams, listLinearProjects, getLinearTeamLabelsOrThrow, getLinearTeamMembersOrThrow, getLinearTeamStatesOrThrow, getLinearViewerForWorkspaceOrThrow, listLinearTeamsForAgent, listLinearTeamsOrThrow, getBaseRefDefault, getDefaultRemote, getBranchConflictKind, isGitRepo, getRepoName, searchBaseRefDetails, getRemoteCount, normalizeRefSearchQuery, parseAndFilterSearchRefDetails, parseRemoteCount, resolveDefaultBaseRefViaExec, resolveDefaultBaseRefWithLocalGit, buildSearchBaseRefsArgv, isForEachRefExcludeUnsupportedError, mergeBaseRefSearchResultGroups, getRemoteDrift, getRecentDriftSubjects, hasCommitObjectViaGitExec, hasWorktreeBaseCommitRef, resolveLocalGitUsername, getSshGitCapabilityCache, listWorktrees, listWorktreesStrict, addWorktree, addSparseWorktree, assertWorktreeCleanForRemoval, forceDeleteLocalBranch, removeWorktree, type AddWorktreeOptions, type AddWorktreeResult, isENOENT, invalidateAuthorizedRootsCache, createSetupRunnerScript, getDefaultTabsLaunch, getEffectiveHooks, loadHooks, runHook, shouldRunSetupForCreate, DEFAULT_REPO_BADGE_COLOR, FLOATING_TERMINAL_WORKTREE_ID, getDefaultVoiceSettings, listRepoWorktrees, createWorktreeCopiedPaths, createWorktreeLinkedPaths, createWorktreeSharedPaths, findExistingWorktreeSymlinkPaths, removeWorktreeLinkedPaths, formatWorktreeIncludeCopyWarning, resolveWorktreeIncludePaths, getWorktreeSharedLinkPaths, resolveWorktreeSharedDirectories, deleteWorktreeHistoryDir, cleanupUnusedWorktreePushTargetRemote, cleanupUnusedWorktreePushTargetRemoteSsh, createRemoteWorktree, configureCreatedWorktreePushTarget, prepareWorktreePushTarget, getBranchNameOverrideCandidate, getWorktreeCreateCandidate, WORKTREE_CREATE_MAX_SUFFIX_ATTEMPTS, normalizeSparseDirectories, type Store, type StatsCollector, AgentDetector, computeWorktreePath, computeWorkspaceRoot, ensurePathWithinWorkspace, formatWorktreeRemovalError, getWorktreeCreationLayout, getWorktreePathSettings, isOrphanCompatiblePreflightError, isOrphanedWorktreeError, mergeWorktree, sanitizeWorktreeName, shouldSetDisplayName, areWorktreePathsEqual, findCreatedWorktree, assertWorktreeDoesNotContainRegisteredWorktree, canCleanupUnregisteredOrcaLeftoverDirectory, canCleanupUnregisteredOrcaWorktreeDirectory, canSafelyRemoveOrphanedWorktreeDirectory, findRegisteredDeletableWorktree, isDangerousWorktreeRemovalPath, ORPHANED_WORKTREE_DIRECTORY_MESSAGE, stripOrcaProvenanceMetaUpdates, UNREGISTERED_MISSING_WORKTREE_MESSAGE, prefetchWorktreeCreateBase, prepareLocalWorktreeRootForRepo, closeLocalWatcherForWorktreePath, closeRemoteWatcherForWorktreePath, forgetLocalWatcherRemovalSnapshot, forgetRemoteWatcherRemovalSnapshot, restoreLocalWatcherAfterFailedRemoval, restoreRemoteWatcherAfterFailedRemoval, acquireWatcherRemovalGate, createWatcherRemovalDeadline, drainBeforeWatcherRemoval, type WatcherRemovalDeadline, withWorktreeSpan, HeadlessEmulator, isNativeWindowsConptyPty, registerConptyDa1OverrideInstaller, shouldModelAnswerHiddenPtyQueries, getTerminalViewAttributes, getTerminalViewColorQueryReplyColors, registerTerminalViewAttributesApplier, killAllProcessesForWorktree, teardownRpcDeadline, stopMissingWorktreeTerminals, type ReplayableMobileNotification, RuntimeNotificationRegistry, MOBILE_SUBSCRIBE_SCROLLBACK_ROWS, createMobileSessionTabsNotifyCoalescer, type MobileSessionTabsNotifyCoalescer, getSshFilesystemProvider, assertFolderWorkspacePathUsable, getFolderWorkspacePathStatus, getFolderWorkspacePathStatusForPath, inferFolderWorkspacePathConnection, getSshGitProvider, getSshGitProviderGeneration, requireSshGitProvider, detectRepoIconAndUpstream, enrichMissingRepoGitRemoteIdentities, githubAvatarIcon, type ClaudeAccountService, type CodexAccountService, type CodexResetCreditRejectedBeforeProviderReason, type CodexAccountSelectionTarget, type RateLimitService, type CodexRateLimitResetOutcome, type RateLimitState, type CodexResetCreditExpectedScope, type VoiceSettings, getSpeechModelManager, getSpeechSttService, getCatalogModel, isLocalSpeechModel, SPEECH_MODEL_CATALOG, deleteLocalSpeechModel, getSpeechModelDeletionErrorCode, type CommitMessageAgentEnvironmentResolvers, scanNestedRepos, createNestedProjectGroupResolver, resolveNestedRepoSelection, createNestedRepoImportTargetResolver, RuntimeClientSettingsCommands, type RuntimeClientSettings, RuntimeAutomationCommands, type RuntimeAutomationCreateInput, type RuntimeAutomationUpdateInput, PtyLayoutQueue, type ApplyLayoutResult, type PtyLayoutState, type PtyLayoutTarget, PtyGenerationReferenceCount, RuntimeRepoHookCommands, branchSelectorMatches, buildRuntimeWorktreeSummaryPathIndex, canonicalizeTerminalSessionWorktreeId, classifyAgentTitle, classifyLatestAgentTitle, compareWorktreePs, findResolvedWorktreeIdForPath, findRuntimeWorktreeSummaryByPath, getExplicitWorktreeIdSelector, getLatestAgentCandidateTitle, getLatestAgentCandidateTitleInfo, getLatestLeafTitle, getLatestPtyTitle, getLeafWorktreeStatus, getSavedTabWorktreeStatus, includeTargetResolvedWorktree, indexPersistedPtySurfaceBindings, indexPersistedPtyWorktreeBindings, inferWorktreeIdFromPtyId, mapExplicitAgentStateToRuntimeTerminalStatus, maxTimestamp, mergeWorktreeStatus, notifyRuntimeListeners, parseRuntimeWorktreeId, resolveTerminalSessionWorktreeId, resolveWorktreeScanCacheTtlMs, runtimePathsEqual, runtimeWorktreeIdentityKey, runtimeWorktreeIdsEqual, type RuntimeWorktreeSummaryPathIndex, setBoundedMapEntry, setsEqual, terminalTitleBlocksExplicitAgentStatus, waitForWorktreeTerminalMutation, withTimeout, withTimeoutResult, getRuntimeWorktreeRemovalKey, getRuntimeWorktreeRemovalOptionsKey, isLocalRuntimeGitRepository, isRuntimeWorktreePathMissing, omitUndefinedProperties, parseExactWorktreeIdSelector, type PreservedBranchCleanupTarget, type RuntimeWorktreeRemovalInFlight, type RuntimeWorktreeRemovalTarget, addListenerToMap, canCheckoutExistingLocalBranch, clampTerminalViewport, getLocalGitHubPrForBranch, getSelectedHostedReviewForBranch, getSelectedReviewBranch, hasLocalGitOptions, isAllowedPushTargetRemoteConflict, isMatchingSelectedGitHubPr, resolveCreateBranchName, getRuntimeFolderWorkspaceInstanceId, getRuntimeFolderWorkspaceRootId, listRuntimeFolderWorkspaces, mergeRuntimeFolderWorkspace, copySleepingAgentLaunchConfig, deterministicAgentSessionUuid, inferCapturedClaudeAgentTeamsMode, isAgentSessionOperationOutcomeUnknown, isCursorAgentOrchestrationTarget, mergeTerminalEnvDeletionKeys, normalizeSparsePresetDirectoriesForSave, normalizeSparsePresetName, resolveBareAgentLaunchCommand, FETCH_FRESHNESS_MS, REMOTE_FETCH_TIMEOUT_MS, REMOTE_FETCH_CACHE_MAX, DRIFT_PROBE_SUBJECT_LIMIT, PTY_CONTROLLER_LIST_TIMEOUT_MS, WORKTREE_TERMINAL_SLEEP_TIMEOUT_MS, sanitizeNestedRepoRuntimeImportError, runtimeRepoMatchesExecutionHost, assertProjectHostSetupHostIsSupported, pathExists, resolveServerBrowsePath, type RuntimeAccountServices, type RemoteFetchResult, type RemoteTrackingBase, type AccountsSnapshot, type CodexRateLimitResetRpcResult, type RuntimeStore, type RuntimeLeafRecord, type RuntimePtyWorktreeRecord, type TerminalCreateOptions, AGENT_SESSION_OPERATION_PER_CLIENT_LIMIT, AGENT_SESSION_OPERATION_GLOBAL_LIMIT, SESSION_SNAPSHOT_STABILITY_ATTEMPTS, type PtyForegroundAgentRefresh, type RuntimeTerminalAgentStatusEvent, type RuntimePtyTitleTrackerEntry, type RuntimeAgentRowSnapshot, type AgentSessionCreateOperation, type RuntimeHeadlessTerminal, type RuntimePtyDataAdmission, type RuntimeVisibleTerminalState, type ProviderBufferAcquisition, type RuntimeTerminalBufferSnapshot, type HeadlessSeedMetadata, type RuntimePtyController, type PtyControllerTerminalIdentity, type PtyControllerInventory, type WorktreeStartupDraftPaste, type WorktreeStartupFollowup, getAgentLaunchPlatformForRepo, MOBILE_TERMINAL_CREATE_RESULT_TTL_MS, WORKTREE_CREATE_RESULT_TTL_MS, FOREGROUND_AGENT_WRAPPER_RETRY_INTERVAL_MS, FOREGROUND_AGENT_WRAPPER_RETRY_TIMEOUT_MS, BRACKETED_PASTE_BEGIN, BRACKETED_PASTE_END, BRACKETED_PASTE_QUIET_MS, DRAFT_PASTE_READY_TIMEOUT_MS, MOBILE_TERMINAL_SURFACE_TIMEOUT_MS, MOBILE_TERMINAL_READY_FALLBACK_MS, SSH_PANE_RECOVERY_GRACE_MS, isClientDisconnectedError, createTerminalRevealWarning, ownerSurfacing, resolveTerminalPresentation, type RuntimeNotifier, type TerminalHandleRecord, type OrchestrationCompatibilityTerminalAuthority, type LegacyWorkerTerminalRecoveryResult, type OrchestrationCompatibilityCallerAuthority, type RestoredOrchestrationAuthorityReceipt, type OrchestrationCompatibilitySshAttachmentAuthority, type TerminalWaiter, type ResolvedWorktree, type LinearAgentWriteTarget, type LinearCreateFieldIntent, AGENT_HOOK_RUNTIME_ENV_KEYS, sameStringSet, labelsForIds, type TerminalWorkspaceLaunchScope, type WorktreeLineageInput, type ResolvedWorkspaceParent, type WorktreeLineageResolution, type RuntimeWorktreeScanResult, type WorktreeLineageCandidate, extractOrchestrationTaskId, RuntimeLineageError, WorktreeIdRequiresFullPathError, type ResolvedWorktreeSnapshot, type MobileNotificationDispatchEvent, type RuntimeWorktreeLifecycleEvent, type MobileNotificationDismissEvent, type MobileNotificationEvent, type DriverState, type NativeChatLaunchDraftResolutionTombstone, MAX_NATIVE_CHAT_LAUNCH_DRAFT_RESOLUTION_TOMBSTONES, MAX_DELETED_FOLDER_TERMINAL_RETIREMENT_FENCES, MAX_TERMINAL_SURFACE_RETIREMENT_FENCES, hasLocalWorktreeBaseRef, makePtyDurableRetirementKey } from './orca-runtime-symbols'
import { OrcaRuntimeLinearIssueUpdateTaskPart82 } from './orca-runtime-linear-issue-update-task-part-82'

export class OrcaRuntimeBuildLinearTaskUpdatePart83 extends OrcaRuntimeLinearIssueUpdateTaskPart82 {
  protected async buildLinearTaskUpdate(
    params: LinearIssueTaskUpdateRequest,
    current: NonNullable<Awaited<ReturnType<typeof getLinearIssueByUuidForAgent>>>,
    workspaceId: string
  ): Promise<{
    fields: {
      assigneeId?: string | null
      priority?: number
      estimate?: number | null
      dueDate?: string | null
      labelIds?: string[]
    }
    labels?: { id: string; name: string }[]
  } | null> {
    if (params.operation === 'assignee') {
      const assigneeId = params.assigneeMe
        ? (await this.getLinearViewerForWrite(workspaceId)).id
        : params.assigneeId
      if (assigneeId === undefined) {
        throw linearError('linear_invalid_assignee', 'Pass --me, --to-id, or clear assignee.')
      }
      return { fields: { assigneeId } }
    }
    if (params.operation === 'priority') {
      if (params.priority === undefined) {
        throw linearError('linear_write_failed', 'Missing priority value.')
      }
      return { fields: { priority: params.priority } }
    }
    if (params.operation === 'estimate') {
      if (params.estimate === undefined) {
        throw linearError('linear_write_failed', 'Missing estimate value.')
      }
      return { fields: { estimate: params.estimate } }
    }
    if (params.operation === 'dueDate') {
      if (params.dueDate === undefined) {
        throw linearError('linear_write_failed', 'Missing due date value.')
      }
      return { fields: { dueDate: params.dueDate } }
    }
    if (params.operation === 'labels') {
      const mode = params.labelMode
      const inputs = params.labels ?? []
      if (!mode || inputs.length === 0) {
        throw linearError('linear_invalid_label', 'Pass at least one --label.')
      }
      const labels = await this.resolveLinearLabelsForIssue(current, inputs, workspaceId)
      const requestedIds = labels.map((label) => label.id)
      const existingIds = current.labelIds ?? current.labels?.map((label) => label.id) ?? []
      const nextIds =
        mode === 'set'
          ? requestedIds
          : mode === 'add'
            ? Array.from(new Set([...existingIds, ...requestedIds]))
            : existingIds.filter((id) => !requestedIds.includes(id))
      return {
        fields: { labelIds: nextIds },
        labels: labelsForIds(nextIds, [...(current.labels ?? []), ...labels])
      }
    }
    return null
  }
  protected async buildLinearSaveUpdate(
    params: LinearSaveIssueRequest,
    current: NonNullable<Awaited<ReturnType<typeof getLinearIssueByUuidForAgent>>>,
    workspaceId: string
  ): Promise<LinearIssueUpdate> {
    const fields: LinearIssueUpdate = {}
    if (params.title !== undefined) {
      fields.title = params.title
    }
    if (params.description !== undefined) {
      fields.description = params.description
    }
    if (params.priority !== undefined) {
      fields.priority = params.priority
    }
    if (params.estimate !== undefined) {
      fields.estimate = params.estimate
    }
    if (params.dueDate !== undefined) {
      fields.dueDate = params.dueDate
    }
    if (params.state !== undefined) {
      const states = await this.getLinearTeamStatesForWrite(current.team.id, workspaceId)
      const state = this.resolveLinearAgentState(params.state, states)
      if (!state) {
        throw linearError(
          'linear_invalid_state',
          `No workflow state exactly matched "${params.state}".`
        )
      }
      fields.stateId = state.id
    }
    if (params.assignee !== undefined) {
      fields.assigneeId =
        params.assignee === null
          ? null
          : await this.resolveLinearAssignee(params.assignee, current.team.id, workspaceId)
    }
    if (params.labels !== undefined) {
      if (params.labels.length === 0) {
        fields.labelIds = []
      } else {
        const labels = await this.resolveLinearLabelsForIssue(current, params.labels, workspaceId)
        fields.labelIds = labels.map((label) => label.id)
      }
    }
    if (params.project !== undefined) {
      fields.projectId =
        params.project === null
          ? null
          : (
              await this.resolveLinearCreateProject(params.project, {
                id: current.team.id,
                workspaceId
              })
            ).id
    }
    if (params.parentId !== undefined) {
      fields.parentId =
        params.parentId === null
          ? null
          : (
              await this.resolveLinearAgentWriteTarget({
                input: params.parentId,
                workspaceId,
                context: params.context
              })
            ).issue.id
      if (fields.parentId === current.id) {
        throw linearError('linear_invalid_parent', 'An issue cannot be its own parent.')
      }
    }
    return fields
  }
  protected async resolveLinearAssignee(
    input: string,
    teamId: string,
    workspaceId: string
  ): Promise<string> {
    if (input.toLocaleLowerCase() === 'me') {
      return (await this.getLinearViewerForWrite(workspaceId)).id
    }
    // Why: caller-supplied IDs were accepted directly before save-issue; avoid a paginated member scan on that existing fast path.
    if (isLinearUuid(input)) {
      return input
    }
    let members: Awaited<ReturnType<typeof getLinearTeamMembersOrThrow>>
    try {
      members = await getLinearTeamMembersOrThrow(teamId, workspaceId)
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
    const normalized = input.toLocaleLowerCase()
    const matches = members.filter(
      (member) =>
        member.id.toLocaleLowerCase() === normalized ||
        member.displayName.toLocaleLowerCase() === normalized ||
        member.name?.toLocaleLowerCase() === normalized ||
        member.email?.toLocaleLowerCase() === normalized
    )
    if (matches.length === 1) {
      return matches[0].id
    }
    throw linearError(
      'linear_invalid_assignee',
      matches.length === 0
        ? `No team member exactly matched "${input}".`
        : `Multiple team members exactly matched "${input}".`
    )
  }
  protected linearSavedIssueMatchesIntent(
    issue: NonNullable<Awaited<ReturnType<typeof getLinearIssueByUuidForAgent>>>,
    fields: LinearIssueUpdate
  ): boolean {
    if (fields.title !== undefined && issue.title !== fields.title) {
      return false
    }
    if (fields.description !== undefined && (issue.description ?? '') !== fields.description) {
      return false
    }
    if (fields.parentId !== undefined && (issue.parent?.id ?? null) !== fields.parentId) {
      return false
    }
    if (fields.stateId !== undefined && issue.state?.id !== fields.stateId) {
      return false
    }
    if (fields.assigneeId !== undefined && (issue.assignee?.id ?? null) !== fields.assigneeId) {
      return false
    }
    if (fields.priority !== undefined && issue.priority !== fields.priority) {
      return false
    }
    if (fields.estimate !== undefined && (issue.estimate ?? null) !== fields.estimate) {
      return false
    }
    if (fields.dueDate !== undefined && (issue.dueDate ?? null) !== fields.dueDate) {
      return false
    }
    if (fields.projectId !== undefined && (issue.project?.id ?? null) !== fields.projectId) {
      return false
    }
    const issueLabelIds = issue.labelIds ?? issue.labels?.map((label) => label.id) ?? []
    return fields.labelIds === undefined || sameStringSet(issueLabelIds, fields.labelIds)
  }
  protected async resolveLinearCreateFields(
    params: {
      state?: string
      assignee?: string
      priority?: number
      estimate?: number
      dueDate?: string
      labels?: string[]
      projectInput?: string
    },
    team: { id: string; workspaceId: string }
  ): Promise<LinearCreateFieldIntent> {
    const fields: LinearCreateFieldIntent = {}
    if (params.state) {
      const states = await this.getLinearTeamStatesForWrite(team.id, team.workspaceId)
      const state = this.resolveLinearAgentState(params.state, states)
      if (!state) {
        throw linearError(
          'linear_invalid_state',
          `No workflow state exactly matched "${params.state}".`,
          { states: states.map(({ id, name, type }) => ({ id, name, type })) }
        )
      }
      fields.stateId = state.id
    }
    if (params.assignee) {
      fields.assigneeId = await this.resolveLinearAssignee(
        params.assignee,
        team.id,
        team.workspaceId
      )
    }
    if (params.priority !== undefined) {
      fields.priority = params.priority
    }
    if (params.estimate !== undefined) {
      fields.estimate = params.estimate
    }
    if (params.dueDate !== undefined) {
      fields.dueDate = params.dueDate
    }
    if (params.labels && params.labels.length > 0) {
      const labels = await this.resolveLinearLabelsForTeam(team.id, params.labels, team.workspaceId)
      fields.labelIds = labels.map((label) => label.id)
    }
    if (params.projectInput) {
      const project = await this.resolveLinearCreateProject(params.projectInput, team)
      fields.projectId = project.id
    }
    return fields
  }
  protected async resolveLinearCreateProject(
    input: string,
    team: { id: string; workspaceId: string }
  ): Promise<LinearProjectSummary> {
    const trimmed = input.trim()
    if (!trimmed) {
      throw linearError('linear_invalid_project', 'Pass a non-empty Linear project id or name.')
    }
    const byId = isLinearUuid(trimmed)
      ? await this.readLinearProjectByIdForCreate(trimmed, team.workspaceId)
      : null
    if (byId) {
      await this.assertLinearProjectIncludesTeam(byId, team.id, team.workspaceId, trimmed)
      return byId
    }
    const searchCandidates = await this.readLinearProjectsForCreate(trimmed, team.workspaceId)
    const normalized = trimmed.toLowerCase()
    const idMatch = searchCandidates.find((project) => project.id.toLowerCase() === normalized)
    if (idMatch) {
      await this.assertLinearProjectIncludesTeam(idMatch, team.id, team.workspaceId, trimmed)
      return idMatch
    }
    const slugMatch = searchCandidates.find(
      (project) => project.slugId?.toLowerCase() === normalized
    )
    if (slugMatch) {
      await this.assertLinearProjectIncludesTeam(slugMatch, team.id, team.workspaceId, trimmed)
      return slugMatch
    }
    const nameMatches = await this.readLinearProjectsByExactNameForCreate(trimmed, team.workspaceId)
    const compatibleNameMatches = await this.filterLinearProjectsForTeam(
      nameMatches,
      team.id,
      team.workspaceId
    )
    if (compatibleNameMatches.length === 1) {
      return compatibleNameMatches[0]
    }
    if (compatibleNameMatches.length > 1) {
      throw linearError(
        'linear_invalid_project',
        `Multiple Linear projects exactly matched "${trimmed}".`,
        {
          projects: compatibleNameMatches.map((project) => ({
            id: project.id,
            name: project.name,
            teams: project.teams
          })),
          nextSteps: ['Run `orca linear project list --query <name> --json` and retry by id.']
        }
      )
    }
    if (nameMatches.length > 0) {
      await this.assertLinearProjectIncludesTeam(nameMatches[0], team.id, team.workspaceId, trimmed)
    }
    throw linearError('linear_invalid_project', `No Linear project exactly matched "${trimmed}".`, {
      projects: searchCandidates.map((project) => ({
        id: project.id,
        name: project.name,
        teams: project.teams
      })),
      nextSteps: ['Run `orca linear project list --query <name> --json` and retry by id.']
    })
  }
  protected async readLinearProjectByIdForCreate(
    id: string,
    workspaceId: string
  ): Promise<LinearProjectSummary | null> {
    try {
      return await getLinearProject(id, workspaceId, true)
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
  }
  protected async readLinearProjectsForCreate(
    query: string,
    workspaceId: string
  ): Promise<LinearProjectSummary[]> {
    try {
      return (await listLinearProjects(query, LINEAR_SEARCH_MAX_LIMIT, workspaceId, true)).items
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
  }
  protected async readLinearProjectsByExactNameForCreate(
    name: string,
    workspaceId: string
  ): Promise<LinearProjectSummary[]> {
    try {
      return await listLinearProjectsByExactName(name, workspaceId, true)
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
  }
  protected async assertLinearProjectIncludesTeam(
    project: LinearProjectSummary,
    teamId: string,
    workspaceId: string,
    input: string
  ): Promise<void> {
    if (this.linearProjectIncludesTeam(project, teamId)) {
      return
    }
    let teams: NonNullable<LinearProjectSummary['teams']> = []
    try {
      // Why: summary reads cap project teams, so large cross-team projects need a paged membership check before rejecting a valid create.
      teams = await listLinearProjectTeams(project.id, workspaceId, true)
    } catch (error) {
      throw this.mapLinearReadFailure(error)
    }
    if (teams.some((team) => team.id === teamId)) {
      return
    }
    throw linearError(
      'linear_invalid_project',
      `Linear project "${input}" is not available to the target team.`,
      {
        project: { id: project.id, name: project.name, teams },
        nextSteps: ['Choose a project that includes the create target team, then retry by id.']
      }
    )
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
