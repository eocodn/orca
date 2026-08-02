import { detectAgentStatusFromTitle, isClaudeManagementTitle, isCursorNativeAgentTitle, isShellProcess, normalizeTerminalTitle, extractOscTitleScanTail, normalizeFolderWorkspaceOperationId, isServerDriveListRequest, listWindowsDrives, extractLastOsc7Uri, extractOscScanTail, parseFileUriPathParts, type AgentStatus, type TerminalOscLinkRange, type TerminalOscColorQueryReplyColors, type TerminalOutputSourceRange, type RemoteTerminalSourceRangeConsumerHooks, type RemoteTerminalSourceRangeReplacementPublication, type RemoteTerminalSourceRangeReplacementReservation, type RemoteTerminalSourceRangeStreamIdentity, createTerminalTitleTracker, stripBrailleSpinnerGlyphs, type TerminalTitleTracker, createCommandCodeOutputStatusDetector, type TerminalSideEffectBatch, type TerminalSideEffectFact, type TerminalGitHubPRLink, TerminalKittyKeyboardModeTracker, AGENT_STATUS_STALE_AFTER_MS, isFreshNonDoneAgentStatus, type AgentStatusIpcPayload, type ParsedAgentStatusPayload, type AgentStatusOrchestrationContext, type AgentStatusEntry, indexAgentStatusRowsByPaneKey, type AgentHookAuthorityAttestation, type AgentSessionClaimedSpawnResult, type AgentSessionExecutionClaim, type AgentSessionSurfaceBinding, type AgentLaunchPreferences, type RuntimeAgentSessionRpcCaller, type RuntimeCreateAgentSessionRequest, type RuntimeCreateAgentSessionResult, type RuntimeEnsureAgentSessionRequest, type RuntimeEnsureAgentSessionResult, AGENT_SESSION_MAX_NEW_OPERATION_AGE_MS, AGENT_SESSION_OPERATION_FUTURE_SKEW_MS, parseAgentSessionOperationTimestamp, canonicalizeAgentSessionIdentity, createEphemeralAgentSessionClaimSigner, type AgentSessionClaimSigner, hasCompatibleAgentTitleIdentity, normalizeCompatibleAgentStatusEntryForOwner, normalizeCompatibleAgentTitleForOwner, resolveCompatibleAgentTypeForOwner, resolvePaneAgentOwner, createAgentStatusOscProcessor, type ProcessedAgentStatusChunk, buildOrchestrationTaskDisplayMetadata, assertTerminalDimensions, AGENT_PROMPT_SUBMIT, buildAgentPromptPasteBytes, gitExecFileAsync, gitSpawn, nonInteractiveGitEnv, runWithGitReadCacheInvalidation, cleanupClaimedCloneTarget, claimCloneTarget, deriveValidatedClonePath, getClonePathComparisonKey, getGitCloneFailureMessage, GIT_FETCH_SKIP_AUTO_MAINTENANCE_CONFIG_ARGS, createHash, randomUUID, homedir, isAbsolute, join, resolve, mkdir, readdir, rm, stat, resolveWorktreeCreateBase, resolveWorktreeAddBaseRef, OrchestrationDb, OrchestrationError, planLegacyWorkerTerminalRecovery, type LegacyWorkerTerminalRecoveryPlan, buildObservedSetupCommand, createSetupCompletionScanner, type RuntimeOrchestrationEnvelope, type TerminalRevealIdentity, type OrchestrationCompatibilityEvidence, type OrchestrationCompatibilityHostStamp, isOrchestrationMutation, orchestrationMigrationData, type OrchestrationEnvironmentTransport, type OrchestrationWorkerServer, syncFederatedDispatch, formatMessagesForInjection, selectExactWorkerProviderSession, type Automation, type AutomationRun, type AutomationWorkspaceProvenance, type CliWorkspaceProvenance, type BaseRefSearchResult, type CreateWorktreeResult, type DetectedWorktree, type DetectedWorktreeListResult, type ForceDeleteWorktreeBranchResult, type GitHubPrStartPoint, type GitPushTarget, type GitWorktreeInfo, type GitHubOwnerRepo, type GlobalSettings, type PersistedUIState, type Project, type ProjectUpdateArgs, type ProjectHostSetup, type ProjectHostSetupCloneArgs, type ProjectHostSetupCreateArgs, type ProjectHostSetupCreateResult, type ProjectHostSetupDeleteArgs, type ProjectHostSetupDeleteResult, type ProjectHostSetupExistingFolderArgs, type ProjectHostSetupResult, type ProjectHostSetupUpdateArgs, type ProjectHostSetupUpdateResult, type Repo, type RemoveWorktreeResult, type StatsSummary, type Worktree, type WorktreeLineage, type WorkspaceLineage, type WorkspaceKey, type WorktreeLineageWarning, type WorktreeMeta, type WorktreeBaseStatusEvent, type WorktreeRemoteBranchConflictEvent, type WorktreeStartupLaunch, type LinearIssueUpdate, type LinearProjectSummary, type NestedRepoScanResult, type ProjectGroup, type FolderWorkspace, type ProjectGroupImportMode, type ProjectGroupImportResult, type MemorySnapshot, type Tab, type TabGroupLayoutNode, type TerminalQuickCommand, type TerminalLayoutSnapshot, type TerminalPaneLayoutNode, type TerminalTab, type TuiAgent, type WorkspaceCreateTelemetrySource, type WorkspaceSessionState, type WorkspaceLinkedItem, type DirEntry, type FilesystemPathFlavor, type GitLabIssueUpdate, type GitLabMRInlineCommentInput, type GitLabProjectRef, type GitLabWorkItem, type MRListState, type ClaudeRateLimitAccountsState, type CodexRateLimitAccountsState, type TaskSourceContext, assertWorktreeUnlockedForRemoval, LOCAL_EXECUTION_HOST_ID, getRepoExecutionHostId, getWorktreeExecutionHostId, parseExecutionHostId, toSshExecutionHostId, type ExecutionHostId, getRegisteredSshState, type AgentProviderSessionMetadata, type SleepingAgentLaunchConfig, type ExactWorkerProviderSession, type RuntimeClientEvent, toRuntimeActivateWorktreeEvent, navigationTargetsClients, navigationTargetsHost, type RuntimeNavigationTarget, type SshConnectionState, getPublicSshState, closeTerminalTabInWorkspaceSession, type LinearCurrentIssueContextHints, type LinearAttachResult, type LinearCommentAddResult, type LinearCreateResult, type LinearErrorCode, type LinearIssueListFilter, type LinearIssueListResult, type LinearProjectListResult, type LinearIssueSummary, type LinearIssueRequest, type LinearIssueTaskUpdateRequest, type LinearIssueTaskUpdateResult, type LinearMcpIssueListRequest, type LinearMcpIssueListResult, type LinearIssueRelationWriteRequest, type LinearIssueRelationWriteResult, type LinearSaveIssueRequest, type LinearSaveIssueResult, type LinearTeamLabelsResult, type LinearTeamListResult, type LinearTeamMembersResult, type LinearTeamStatesResult, type LinearStatusSetResult, HEADLESS_RUNTIME_WINDOW_ID, type RuntimeDesktopWindowStatus, type RuntimeGraphStatus, type RuntimeRepoSearchRefs, type RuntimeTerminalRead, type RuntimeTerminalRename, type RuntimeTerminalAgentStatus, type RuntimeTerminalSend, type RuntimeTerminalCreate, type RuntimeTerminalPresentation, type RuntimeTerminalSplit, type RuntimeTerminalFocus, type RuntimeTerminalClose, type RuntimeTerminalListResult, type RuntimeTerminalOrphanAdoptionRequest, type RuntimeTerminalOrphanAdoptionResult, type RuntimeWorktreeTerminalSleepResult, type RuntimeTerminalResolvePane, type RuntimeStatus, type RuntimeSyncWindowGraphResult, type RuntimeTerminalWait, type RuntimeTerminalWaitCondition, type RuntimeWorktreePsSummary, type RuntimeWorktreeAgentRow, type RuntimeSpeechModelSummary, type RuntimeSpeechSetupState, type RuntimeTerminalShow, type RuntimeTerminalInspect, type RuntimeTerminalResize, type RuntimeTerminalSummary, type RuntimeTerminalVisualGroupNode, type RuntimeTerminalVisualLayout, type RuntimeTerminalVisualLayoutNode, type RuntimeTerminalVisualPaneNode, type RuntimeTerminalVisualTab, type RuntimeSyncedLeaf, type RuntimeSyncedTab, type RuntimeMarkdownReadTabResult, type RuntimeMarkdownSaveTabResult, type RuntimeMobileSessionCreateTerminalResult, type RuntimeMobileSessionClientTab, type RuntimeMobileSessionTabCloseResult, type RuntimeMobileSessionMarkdownTab, type RuntimeMobileSessionTabMove, type RuntimeMobileSessionTabMoveResult, type RuntimeMobileSessionTabGroup, type RuntimeMobileSessionSnapshotTab, type RuntimeMobileSessionTerminalTab, type RuntimeMobileSessionBrowserTab, type RuntimeMobileSessionTabsRemovedResult, type RuntimeMobileSessionTabsResult, type RuntimeMobileSessionTabsSnapshot, type RuntimeSessionFlushResult, type RuntimeSessionSnapshot, type RuntimeNativeChatLaunchDraftResolution, type RuntimeSessionTabCloseReason, type RuntimeBrowserDriverState, type RuntimeTerminalDriverState, type RuntimeSyncWindowGraph, type RuntimeWorktreeListResult, type BrowserTabInfo, type BrowserScreencastResult, LINEAR_SEARCH_MAX_LIMIT, LINEAR_WRITE_BODY_CAP, clampLinearSearchLimit, isLinearUuid, type FeatureInteractionId, type TerminalPaneSplitSource, WORKTREE_ID_SEPARATOR, getRepoIdFromWorktreeId, splitWorktreeId, splitWorktreeIdForFilesystem, getProjectIdForProviderIdentity, getProjectHostSetupForRepo, getProjectHostSetupWorktreeMeta, clampLinearIssueListLimit, isFolderRepo, DEFAULT_WORKSPACE_STATUS_ID, buildSetupRunnerCommand, getSetupRunnerCommandPlatformForPath, createSequencedSetupAgentCommands, SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV, FIRST_PANE_ID, isTerminalLeafId, makePaneKey, parsePaneKey, parseAppSshPtyId, isValidHostTerminalTabId, isValidTerminalTabId, type TerminalQuickCommandMutation, isPtyIncarnationId, type PtyIncarnationId, buildAgentDraftLaunchPlan, buildAgentResumeStartupPlan, buildAgentStartupPlan, repoIsRemote, isAgentForegroundWrapperProcess, isExpectedAgentProcess, recognizeAgentProcess, isTuiAgentEnabled, pickTuiAgent, resolveTuiAgentLaunchArgs, resolveTuiAgentLaunchEnv, resolveLocalWindowsAgentStartupShell, isTuiAgent, TUI_AGENT_CONFIG, createDraftPasteReadyScanner, detectInstalledAgentsWithShellPathHydration, detectRemoteAgents, markCodexProjectTrusted, markCopilotFolderTrusted, markCursorWorkspaceTrusted, markRemoteAgentWorkspaceTrusted, applyAgentStatusHooksEnabled, recordManagedHookInstallFailure, isWindowsAbsolutePathLike, isPathInsideOrEqual, normalizeRuntimePathForComparison, resolveTerminalStartupCwd, isWslUncPath, parseWslUncPath, folderWorkspaceKey, isWorkspaceKey, parseWorkspaceKey, worktreeWorkspaceKey, projectResolvedWorktreeLineage, sharesResolvedWorktreeLineageBoundary, folderWorkspaceToWorktree, type FolderWorkspacePathStatus, type FolderWorkspacePathStatusRequest, applyMetadataFallbackVisibility, buildKnownOrcaWorkspaceLayouts, isLegacyRepoForExternalWorktreeVisibility, toDetectedWorktree, createAgentScratchWorktreePathMatcher, type AgentScratchWorktreePathMatcher, BROWSER_HEADLESS_RUNTIME_CAPABILITY, BROWSER_CERTIFICATE_TRUST_RUNTIME_CAPABILITY, MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION, ORCHESTRATION_CONTRACT_RUNTIME_CAPABILITY, ORCHESTRATION_CONTRACT_VERSION, REMOTE_RUNTIME_SHARED_CONTROL_CAPABILITY, RUNTIME_CAPABILITIES, RUNTIME_PROTOCOL_VERSION, TERMINAL_PAIRED_PARKING_RUNTIME_CAPABILITY, type RuntimeCapability, configureAiVaultSessionSources, listAiVaultSessions, type AiVaultListArgs, type AiVaultListResult, type AiVaultPrepareSessionResumeArgs, type AiVaultPrepareSessionResumeResult, type WorkspacePortKillRequest, type WorkspacePortKillResult, type WorkspacePortProbe, type WorkspacePortScanResult, filterWorkspacePortProbes, killWorkspacePort, scanWorkspacePortProbes, advertisedUrlWatcher, type AutomationService, RuntimeBrowserCommands, RemoteRuntimeTerminalCreateIdempotency, deriveRemoteRuntimeTerminalCreateHandle, buildHeadlessTerminalSplitLayout, countTerminalLayoutLeaves, RECENT_PTY_OUTPUT_LIMIT, TerminalOutputState, type RuntimeTerminalDataMeta, RuntimeGithubProjectCommands, RuntimeJiraCommands, WorktreeResolutionState, RuntimeTerminalInputCommands, RuntimeLinearQueryCommands, RuntimeLinearConnectionCommands, RuntimeReviewQueryCommands, RuntimeReviewMutationCommands, RuntimeRepoWorkItemCommands, RuntimeMessageWaiters, type MessageWaitResult, buildHeadlessTabGroupMove, buildHeadlessTabGroupSplit, hasExactTerminalOrphanGroupLayout, mergeTerminalOrphanGroupLayout, terminalOrphanExecutionOwnersEqual, retireTerminalSurfacesFromSnapshot, type RetiredTerminalSurface, retireTerminalSurfaceFromPersistence, advanceTerminalTopologyRevision, hasHostAuthoritativeTerminalMembership, RuntimeEmulatorCommands, setEmulatorBridge, type EmulatorBridge, RuntimeFileCommands, RuntimeGitCommands, appendRecentPtyPathCandidates, recentTerminalOutputIncludesPath, recentTerminalPathCandidatesIncludePath, detectTerminalWaitBlockedReason, isKnownReadyPromptPreview, buildPreview, buildTerminalWaitText, computeTerminalTailWaitState, MAX_TAIL_CHARS, tailGainedNewerBlockedReason, type TerminalTailWaitState, appendNormalizedToTailBuffer, type RetainedTailRedrawCursor, appendCompletedTerminalTranscript, tailStateMatches, normalizeTerminalChunk, DEFAULT_TERMINAL_READ_LIMIT, readTerminalTail, terminalReadLimit, shouldFallbackToVisibleTerminalSnapshot, visibleNonBlankTerminalLines, buildVisibleSnapshotReadFallback, MOBILE_AUTO_RESTORE_FIT_MAX_MS, MOBILE_AUTO_RESTORE_FIT_MIN_MS, TUI_IDLE_DEFAULT_TIMEOUT_MS, TUI_IDLE_POLL_INTERVAL_MS, TUI_IDLE_QUIESCENCE_MS, assertTerminalInputWithinLimitWithYield, buildSendPayload, buildPtyTerminalWaitResult, buildPtyTerminalWaitBlockedResult, buildTerminalWaitResult, buildTerminalWaitBlockedResult, detectExplicitIdleStatusFromTitle, getTerminalState, activateClientSessionTabSelection, ClientSessionTabSelectionStore, deriveClientSessionTabSelection, projectClientSessionTabSelection, type PtyProviderBufferSnapshot, type IPtyProvider, type PtyProcessInfo, type PtyTransientFact, ClaudeAgentTeamsService, type AgentTeamsTmuxCompatRequest, type AgentTeamsTmuxCompatResponse, buildClaudeAgentTeamsLaunchPlan, ensureClaudeAgentTeamsShimDir, resolveClaudeAgentTeamsShimBin, addClaudeTeammateModeAuto, addClaudeTeammateModeInProcess, collectMemorySnapshot, app, BrowserWindow, ipcMain, Notification, type AgentBrowserBridge, type BrowserBackend, BrowserError, getRepoSlug, getRepoUpstream, type getPRForBranch, resolveGitHubPrStartPoint, fetchGitHubPullRequestHeadRef, fetchPrHeadTrackingRef, gitlabMergeRequestHeadLocalRef, reviewHeadRemoteRefComponent, fetchGitLabMergeRequestHeadRef, isTransientReviewHeadFetchError, resolveGitHubReviewHeadRemote, fetchCompareBaseRefWithLocalFallback, pickPreferredGitRemote, closeGitLabMR, createGitLabIssue, diagnoseGitLabAuthClient, getGitLabJobTrace, getGitLabProjectRefForRemote, getGitLabRateLimit, getGitLabWorkItemByProjectRef, addGitLabIssueComment, addGitLabMRInlineComment, addGitLabMRComment, listGitLabTodos, listGitLabIssues, listGitLabLabels, listGitLabMergeRequests, listGitLabWorkItems, mergeGitLabMR, reopenGitLabMR, resolveGitLabMRDiscussion, retryGitLabJob, updateGitLabMR, updateGitLabMRReviewers, updateGitLabIssue, getGlabKnownHosts, getGitLabWorkItemDetails, normalizeGitLabIssueListArgs, normalizeGitLabMRListState, normalizeGitLabPositiveInteger, type GitLabIssueListState, recordGitLabProjectRecent, type CreateHostedReviewInput, type CreateHostedReviewResult, type HostedReviewCreationEligibility, type HostedReviewCreationEligibilityArgs, type HostedReviewInfo, getHostedReviewForBranchFromRepo, createHostedReviewFromRepo, getHostedReviewCreationEligibilityFromRepo, getLocalProjectGitExecOptions, getLocalProjectWorktreeGitOptions, getLocalProjectWorktreeGitOptionsForRuntime, resolveLocalProjectRuntimeForRepo, resolveLocalProjectRuntimesForRepos, resolveLocalProjectRuntimeForWorktreeId, type ProjectExecutionRuntimeResolution, resolveTerminalOrchestrationCliCommand, getLocalWorktreePathAccess, removeLocalWorktreePath, toLocalWorktreeRuntimePath, removeStaleLocalWorktreeRegistrationAfterFilesystemRemoval, recoverLocalWindowsWorktreeRemoval, getLinearStatus, isLinearAuthError, addLinearIssueCommentForAgent, createLinearIssueAttachment, createLinearIssueForAgent, getLinearAttachmentByUuidForAgent, getLinearCommentByUuidForAgent, getLinearIssueByUuidForAgent, getLinearIssueCommentThreadRoot, listLinearIssues, updateLinearIssueForAgent, LinearWriteFailure, LinearAgentAccessError, getLinearCurrentIssueFromWorktree, readLinearIssueContext, resolveLegacyLinearLinkWorkspace, classifyLinearError, linearError, linearMessage, sanitizeLinearErrorMessage, listMcpIssues, writeIssueRelation, getLinearProject, listLinearProjectsByExactName, listLinearProjectTeams, listLinearProjects, getLinearTeamLabelsOrThrow, getLinearTeamMembersOrThrow, getLinearTeamStatesOrThrow, getLinearViewerForWorkspaceOrThrow, listLinearTeamsForAgent, listLinearTeamsOrThrow, getBaseRefDefault, getDefaultRemote, getBranchConflictKind, isGitRepo, getRepoName, searchBaseRefDetails, getRemoteCount, normalizeRefSearchQuery, parseAndFilterSearchRefDetails, parseRemoteCount, resolveDefaultBaseRefViaExec, resolveDefaultBaseRefWithLocalGit, buildSearchBaseRefsArgv, isForEachRefExcludeUnsupportedError, mergeBaseRefSearchResultGroups, getRemoteDrift, getRecentDriftSubjects, hasCommitObjectViaGitExec, hasWorktreeBaseCommitRef, resolveLocalGitUsername, getSshGitCapabilityCache, listWorktrees, listWorktreesStrict, addWorktree, addSparseWorktree, assertWorktreeCleanForRemoval, forceDeleteLocalBranch, removeWorktree, type AddWorktreeOptions, type AddWorktreeResult, isENOENT, invalidateAuthorizedRootsCache, createSetupRunnerScript, getDefaultTabsLaunch, getEffectiveHooks, loadHooks, runHook, shouldRunSetupForCreate, DEFAULT_REPO_BADGE_COLOR, FLOATING_TERMINAL_WORKTREE_ID, getDefaultVoiceSettings, listRepoWorktrees, createWorktreeCopiedPaths, createWorktreeLinkedPaths, createWorktreeSharedPaths, findExistingWorktreeSymlinkPaths, removeWorktreeLinkedPaths, formatWorktreeIncludeCopyWarning, resolveWorktreeIncludePaths, getWorktreeSharedLinkPaths, resolveWorktreeSharedDirectories, deleteWorktreeHistoryDir, cleanupUnusedWorktreePushTargetRemote, cleanupUnusedWorktreePushTargetRemoteSsh, createRemoteWorktree, configureCreatedWorktreePushTarget, prepareWorktreePushTarget, getBranchNameOverrideCandidate, getWorktreeCreateCandidate, WORKTREE_CREATE_MAX_SUFFIX_ATTEMPTS, normalizeSparseDirectories, type Store, type StatsCollector, AgentDetector, computeWorktreePath, computeWorkspaceRoot, ensurePathWithinWorkspace, formatWorktreeRemovalError, getWorktreeCreationLayout, getWorktreePathSettings, isOrphanCompatiblePreflightError, isOrphanedWorktreeError, mergeWorktree, sanitizeWorktreeName, shouldSetDisplayName, areWorktreePathsEqual, findCreatedWorktree, assertWorktreeDoesNotContainRegisteredWorktree, canCleanupUnregisteredOrcaLeftoverDirectory, canCleanupUnregisteredOrcaWorktreeDirectory, canSafelyRemoveOrphanedWorktreeDirectory, findRegisteredDeletableWorktree, isDangerousWorktreeRemovalPath, ORPHANED_WORKTREE_DIRECTORY_MESSAGE, stripOrcaProvenanceMetaUpdates, UNREGISTERED_MISSING_WORKTREE_MESSAGE, prefetchWorktreeCreateBase, prepareLocalWorktreeRootForRepo, closeLocalWatcherForWorktreePath, closeRemoteWatcherForWorktreePath, forgetLocalWatcherRemovalSnapshot, forgetRemoteWatcherRemovalSnapshot, restoreLocalWatcherAfterFailedRemoval, restoreRemoteWatcherAfterFailedRemoval, acquireWatcherRemovalGate, createWatcherRemovalDeadline, drainBeforeWatcherRemoval, type WatcherRemovalDeadline, withWorktreeSpan, HeadlessEmulator, isNativeWindowsConptyPty, registerConptyDa1OverrideInstaller, shouldModelAnswerHiddenPtyQueries, getTerminalViewAttributes, getTerminalViewColorQueryReplyColors, registerTerminalViewAttributesApplier, killAllProcessesForWorktree, teardownRpcDeadline, stopMissingWorktreeTerminals, type ReplayableMobileNotification, RuntimeNotificationRegistry, MOBILE_SUBSCRIBE_SCROLLBACK_ROWS, createMobileSessionTabsNotifyCoalescer, type MobileSessionTabsNotifyCoalescer, getSshFilesystemProvider, assertFolderWorkspacePathUsable, getFolderWorkspacePathStatus, getFolderWorkspacePathStatusForPath, inferFolderWorkspacePathConnection, getSshGitProvider, getSshGitProviderGeneration, requireSshGitProvider, detectRepoIconAndUpstream, enrichMissingRepoGitRemoteIdentities, githubAvatarIcon, type ClaudeAccountService, type CodexAccountService, type CodexResetCreditRejectedBeforeProviderReason, type CodexAccountSelectionTarget, type RateLimitService, type CodexRateLimitResetOutcome, type RateLimitState, type CodexResetCreditExpectedScope, type VoiceSettings, getSpeechModelManager, getSpeechSttService, getCatalogModel, isLocalSpeechModel, SPEECH_MODEL_CATALOG, deleteLocalSpeechModel, getSpeechModelDeletionErrorCode, type CommitMessageAgentEnvironmentResolvers, scanNestedRepos, createNestedProjectGroupResolver, resolveNestedRepoSelection, createNestedRepoImportTargetResolver, RuntimeClientSettingsCommands, type RuntimeClientSettings, RuntimeAutomationCommands, type RuntimeAutomationCreateInput, type RuntimeAutomationUpdateInput, PtyLayoutQueue, type ApplyLayoutResult, type PtyLayoutState, type PtyLayoutTarget, PtyGenerationReferenceCount, RuntimeRepoHookCommands, branchSelectorMatches, buildRuntimeWorktreeSummaryPathIndex, canonicalizeTerminalSessionWorktreeId, classifyAgentTitle, classifyLatestAgentTitle, compareWorktreePs, findResolvedWorktreeIdForPath, findRuntimeWorktreeSummaryByPath, getExplicitWorktreeIdSelector, getLatestAgentCandidateTitle, getLatestAgentCandidateTitleInfo, getLatestLeafTitle, getLatestPtyTitle, getLeafWorktreeStatus, getSavedTabWorktreeStatus, includeTargetResolvedWorktree, indexPersistedPtySurfaceBindings, indexPersistedPtyWorktreeBindings, inferWorktreeIdFromPtyId, mapExplicitAgentStateToRuntimeTerminalStatus, maxTimestamp, mergeWorktreeStatus, notifyRuntimeListeners, parseRuntimeWorktreeId, resolveTerminalSessionWorktreeId, resolveWorktreeScanCacheTtlMs, runtimePathsEqual, runtimeWorktreeIdentityKey, runtimeWorktreeIdsEqual, type RuntimeWorktreeSummaryPathIndex, setBoundedMapEntry, setsEqual, terminalTitleBlocksExplicitAgentStatus, waitForWorktreeTerminalMutation, withTimeout, withTimeoutResult, getRuntimeWorktreeRemovalKey, getRuntimeWorktreeRemovalOptionsKey, isLocalRuntimeGitRepository, isRuntimeWorktreePathMissing, omitUndefinedProperties, parseExactWorktreeIdSelector, type PreservedBranchCleanupTarget, type RuntimeWorktreeRemovalInFlight, type RuntimeWorktreeRemovalTarget, addListenerToMap, canCheckoutExistingLocalBranch, clampTerminalViewport, getLocalGitHubPrForBranch, getSelectedHostedReviewForBranch, getSelectedReviewBranch, hasLocalGitOptions, isAllowedPushTargetRemoteConflict, isMatchingSelectedGitHubPr, resolveCreateBranchName, getRuntimeFolderWorkspaceInstanceId, getRuntimeFolderWorkspaceRootId, listRuntimeFolderWorkspaces, mergeRuntimeFolderWorkspace, copySleepingAgentLaunchConfig, deterministicAgentSessionUuid, inferCapturedClaudeAgentTeamsMode, isAgentSessionOperationOutcomeUnknown, isCursorAgentOrchestrationTarget, mergeTerminalEnvDeletionKeys, normalizeSparsePresetDirectoriesForSave, normalizeSparsePresetName, resolveBareAgentLaunchCommand, FETCH_FRESHNESS_MS, REMOTE_FETCH_TIMEOUT_MS, REMOTE_FETCH_CACHE_MAX, DRIFT_PROBE_SUBJECT_LIMIT, PTY_CONTROLLER_LIST_TIMEOUT_MS, WORKTREE_TERMINAL_SLEEP_TIMEOUT_MS, sanitizeNestedRepoRuntimeImportError, runtimeRepoMatchesExecutionHost, assertProjectHostSetupHostIsSupported, pathExists, resolveServerBrowsePath, type RuntimeAccountServices, type RemoteFetchResult, type RemoteTrackingBase, type AccountsSnapshot, type CodexRateLimitResetRpcResult, type RuntimeStore, type RuntimeLeafRecord, type RuntimePtyWorktreeRecord, type TerminalCreateOptions, AGENT_SESSION_OPERATION_PER_CLIENT_LIMIT, AGENT_SESSION_OPERATION_GLOBAL_LIMIT, SESSION_SNAPSHOT_STABILITY_ATTEMPTS, type PtyForegroundAgentRefresh, type RuntimeTerminalAgentStatusEvent, type RuntimePtyTitleTrackerEntry, type RuntimeAgentRowSnapshot, type AgentSessionCreateOperation, type RuntimeHeadlessTerminal, type RuntimePtyDataAdmission, type RuntimeVisibleTerminalState, type ProviderBufferAcquisition, type RuntimeTerminalBufferSnapshot, type HeadlessSeedMetadata, type RuntimePtyController, type PtyControllerTerminalIdentity, type PtyControllerInventory, type WorktreeStartupDraftPaste, type WorktreeStartupFollowup, getAgentLaunchPlatformForRepo, MOBILE_TERMINAL_CREATE_RESULT_TTL_MS, WORKTREE_CREATE_RESULT_TTL_MS, FOREGROUND_AGENT_WRAPPER_RETRY_INTERVAL_MS, FOREGROUND_AGENT_WRAPPER_RETRY_TIMEOUT_MS, BRACKETED_PASTE_BEGIN, BRACKETED_PASTE_END, BRACKETED_PASTE_QUIET_MS, DRAFT_PASTE_READY_TIMEOUT_MS, MOBILE_TERMINAL_SURFACE_TIMEOUT_MS, MOBILE_TERMINAL_READY_FALLBACK_MS, SSH_PANE_RECOVERY_GRACE_MS, isClientDisconnectedError, createTerminalRevealWarning, ownerSurfacing, resolveTerminalPresentation, type RuntimeNotifier, type TerminalHandleRecord, type OrchestrationCompatibilityTerminalAuthority, type LegacyWorkerTerminalRecoveryResult, type OrchestrationCompatibilityCallerAuthority, type RestoredOrchestrationAuthorityReceipt, type OrchestrationCompatibilitySshAttachmentAuthority, type TerminalWaiter, type ResolvedWorktree, type LinearAgentWriteTarget, type LinearCreateFieldIntent, AGENT_HOOK_RUNTIME_ENV_KEYS, sameStringSet, labelsForIds, type TerminalWorkspaceLaunchScope, type WorktreeLineageInput, type ResolvedWorkspaceParent, type WorktreeLineageResolution, type RuntimeWorktreeScanResult, type WorktreeLineageCandidate, extractOrchestrationTaskId, RuntimeLineageError, WorktreeIdRequiresFullPathError, type ResolvedWorktreeSnapshot, type MobileNotificationDispatchEvent, type RuntimeWorktreeLifecycleEvent, type MobileNotificationDismissEvent, type MobileNotificationEvent, type DriverState, type NativeChatLaunchDraftResolutionTombstone, MAX_NATIVE_CHAT_LAUNCH_DRAFT_RESOLUTION_TOMBSTONES, MAX_DELETED_FOLDER_TERMINAL_RETIREMENT_FENCES, MAX_TERMINAL_SURFACE_RETIREMENT_FENCES, hasLocalWorktreeBaseRef, makePtyDurableRetirementKey } from './orca-runtime-symbols'
import { OrcaRuntimePersistHeadlessTerminalPaneLayoutPart16 } from './orca-runtime-persist-headless-terminal-pane-layout-part-16'

export class OrcaRuntimeSaveMobileMarkdownTabPart17 extends OrcaRuntimePersistHeadlessTerminalPaneLayoutPart16 {
  async saveMobileMarkdownTab(
    worktreeSelector: string,
    tabId: string,
    baseVersion: string,
    content: string
  ): Promise<RuntimeMarkdownSaveTabResult> {
    const worktreeId = await this.resolveMobileMarkdownWorktreeId(worktreeSelector, tabId)
    if (!this.notifier?.saveMobileMarkdownTab) {
      throw new Error('renderer_unavailable')
    }
    return await this.notifier.saveMobileMarkdownTab(worktreeId, tabId, baseVersion, content)
  }

  protected readonly fileCommands = new RuntimeFileCommands({
    getRuntimeId: () => this.runtimeId,
    requireStore: () => this.requireStore(),
    resolveWorktreeSelector: (selector) => this.resolveWorktreeSelector(selector),
    resolveRuntimeFileTarget: (selector) => this.resolveRuntimeFileTarget(selector),
    resolveTerminalCwd: (terminalHandle) => this.resolveTerminalCwd(terminalHandle),
    resolveTerminalContext: (terminalHandle) => this.resolveTerminalContext(terminalHandle),
    resolveTerminalFileUriHostname: (terminalHandle) =>
      this.resolveTerminalFileUriHostname(terminalHandle),
    hasRecentTerminalOutputPath: (terminalHandle, pathText, absolutePath) =>
      this.hasRecentTerminalOutputPath(terminalHandle, pathText, absolutePath),
    resolveRuntimeGitTarget: (selector) => this.resolveRuntimeGitTarget(selector),
    openFile: (worktreeId, filePath, relativePath, runtimeEnvironmentId) => {
      if (!this.notifier?.openFile) {
        throw new Error('renderer_unavailable')
      }
      this.notifier.openFile(worktreeId, filePath, relativePath, runtimeEnvironmentId)
    },
    openDiff: (worktreeId, filePath, relativePath, staged, runtimeEnvironmentId) => {
      if (!this.notifier?.openDiff) {
        throw new Error('renderer_unavailable')
      }
      this.notifier.openDiff(worktreeId, filePath, relativePath, staged, runtimeEnvironmentId)
    }
  })

  listMobileFiles: RuntimeFileCommands['listMobileFiles'] = this.fileCommands.listMobileFiles.bind(
    this.fileCommands
  )
  searchMobileFilePaths: RuntimeFileCommands['searchMobileFilePaths'] =
    this.fileCommands.searchMobileFilePaths.bind(this.fileCommands)
  openMobileFile: RuntimeFileCommands['openMobileFile'] = this.fileCommands.openMobileFile.bind(
    this.fileCommands
  )
  openMobileDiff: RuntimeFileCommands['openMobileDiff'] = this.fileCommands.openMobileDiff.bind(
    this.fileCommands
  )
  readMobileFile: RuntimeFileCommands['readMobileFile'] = this.fileCommands.readMobileFile.bind(
    this.fileCommands
  )
  resolveTerminalPath: RuntimeFileCommands['resolveTerminalPath'] =
    this.fileCommands.resolveTerminalPath.bind(this.fileCommands)
  readTerminalArtifactFile: RuntimeFileCommands['readTerminalArtifactFile'] =
    this.fileCommands.readTerminalArtifactFile.bind(this.fileCommands)
  readTerminalArtifactPreview: RuntimeFileCommands['readTerminalArtifactPreview'] =
    this.fileCommands.readTerminalArtifactPreview.bind(this.fileCommands)
  writeTerminalArtifactFile: RuntimeFileCommands['writeTerminalArtifactFile'] =
    this.fileCommands.writeTerminalArtifactFile.bind(this.fileCommands)
  revokeTerminalFileGrantsForClient: RuntimeFileCommands['revokeTerminalFileGrantsForClient'] =
    this.fileCommands.revokeTerminalFileGrantsForClient.bind(this.fileCommands)
  readFileExplorerDir: RuntimeFileCommands['readFileExplorerDir'] =
    this.fileCommands.readFileExplorerDir.bind(this.fileCommands)
  watchFileExplorer: RuntimeFileCommands['watchFileExplorer'] =
    this.fileCommands.watchFileExplorer.bind(this.fileCommands)
  closeFileWatchersForRemoval = async (
    worktreePath: string,
    connectionId?: string,
    deadline: WatcherRemovalDeadline = createWatcherRemovalDeadline()
  ): Promise<void> => {
    // Why drain the remote/explorer closes: they await SSH round trips and lease suspends that a dead
    // link never answers. The local close bounds its own awaits against the same deadline internally.
    const results = await Promise.allSettled([
      connectionId
        ? drainBeforeWatcherRemoval(
            closeRemoteWatcherForWorktreePath(connectionId, worktreePath),
            deadline,
            `remote watcher close for ${worktreePath}`
          )
        : closeLocalWatcherForWorktreePath(worktreePath, deadline),
      drainBeforeWatcherRemoval(
        this.fileCommands.closeFileExplorerWatchersForPath(worktreePath, connectionId),
        deadline,
        `file explorer watcher close for ${worktreePath}`
      )
    ])
    const failure = results.find((result): result is PromiseRejectedResult => {
      return result.status === 'rejected'
    })
    if (failure) {
      // Why: restoration must start only after every bounded teardown settles;
      // otherwise a late close can stale a just-restored logical subscription.
      throw failure.reason
    }
  }
  restoreFileWatchersAfterFailedRemoval = async (
    worktreePath: string,
    connectionId?: string
  ): Promise<void> => {
    await Promise.all([
      connectionId
        ? restoreRemoteWatcherAfterFailedRemoval(connectionId, worktreePath)
        : restoreLocalWatcherAfterFailedRemoval(worktreePath),
      this.fileCommands.restoreFileExplorerWatchersAfterFailedRemoval(worktreePath, connectionId)
    ])
  }
  forgetFileWatchersAfterRemoval = (worktreePath: string, connectionId?: string): void => {
    if (connectionId) {
      forgetRemoteWatcherRemovalSnapshot(connectionId, worktreePath)
    } else {
      forgetLocalWatcherRemovalSnapshot(worktreePath)
    }
    this.fileCommands.forgetFileExplorerWatchersAfterRemoval(worktreePath, connectionId)
  }
  acquireFileWatcherRemoval = async (
    worktreePath: string,
    connectionId?: string
  ): Promise<{ finish(removed: boolean): Promise<void> }> => {
    const gate = acquireWatcherRemovalGate(worktreePath, connectionId)
    // Why: one budget for the whole preparation — independent per-await timeouts would compose into minutes.
    const deadline = createWatcherRemovalDeadline()
    try {
      // Why: the first pass aborts desktop setup immediately; the second catches
      // any pre-gate runtime install that published after the first snapshot.
      await this.closeFileWatchersForRemoval(worktreePath, connectionId, deadline)
      // Why: a wedged install never releases its fence slot, so gate.ready can hang forever; the delete
      // must proceed instead, or the gate stays held and every later install under this root is rejected.
      const fenceDrain = await drainBeforeWatcherRemoval(
        gate.ready,
        deadline,
        `watcher install fence for ${worktreePath}`
      )
      if (fenceDrain === 'timeout') {
        // Why: a wedged install holds its fence slot for the process lifetime, so leaving it counted
        // makes every later removal of this root burn the whole drain budget again.
        gate.abandonPendingInstalls()
      }
      await this.closeFileWatchersForRemoval(worktreePath, connectionId, deadline)
      let finished = false
      return {
        finish: async (removed) => {
          if (finished) {
            return
          }
          finished = true
          if (removed) {
            this.forgetFileWatchersAfterRemoval(worktreePath, connectionId)
          }
          gate.release()
          if (!removed) {
            await this.restoreFileWatchersAfterFailedRemoval(worktreePath, connectionId).catch(
              (restoreError: unknown) => {
                console.error('[worktrees] failed to restore watchers after removal failed', {
                  worktreePath,
                  restoreError
                })
              }
            )
          }
        }
      }

    } catch (error) {
      gate.release()
      await this.restoreFileWatchersAfterFailedRemoval(worktreePath, connectionId).catch(
        (restoreError: unknown) => {
          console.error('[worktrees] failed to restore watchers after removal setup failed', {
            worktreePath,
            restoreError
          })
        }
      )
      throw error
    }
  }
  readFileExplorerPreview: RuntimeFileCommands['readFileExplorerPreview'] =
    this.fileCommands.readFileExplorerPreview.bind(this.fileCommands)
  readFileExplorerChunk: RuntimeFileCommands['readFileExplorerChunk'] =
    this.fileCommands.readFileExplorerChunk.bind(this.fileCommands)
  writeFileExplorerFile: RuntimeFileCommands['writeFileExplorerFile'] =
    this.fileCommands.writeFileExplorerFile.bind(this.fileCommands)
  writeFileExplorerFileBase64: RuntimeFileCommands['writeFileExplorerFileBase64'] =
    this.fileCommands.writeFileExplorerFileBase64.bind(this.fileCommands)
  writeFileExplorerFileBase64Chunk: RuntimeFileCommands['writeFileExplorerFileBase64Chunk'] =
    this.fileCommands.writeFileExplorerFileBase64Chunk.bind(this.fileCommands)
  createFileExplorerFile: RuntimeFileCommands['createFileExplorerFile'] =
    this.fileCommands.createFileExplorerFile.bind(this.fileCommands)
  createFileExplorerDir: RuntimeFileCommands['createFileExplorerDir'] =
    this.fileCommands.createFileExplorerDir.bind(this.fileCommands)
  createFileExplorerDirNoClobber: RuntimeFileCommands['createFileExplorerDirNoClobber'] =
    this.fileCommands.createFileExplorerDirNoClobber.bind(this.fileCommands)
  commitFileExplorerUpload: RuntimeFileCommands['commitFileExplorerUpload'] =
    this.fileCommands.commitFileExplorerUpload.bind(this.fileCommands)
  renameFileExplorerPath: RuntimeFileCommands['renameFileExplorerPath'] =
    this.fileCommands.renameFileExplorerPath.bind(this.fileCommands)
  copyFileExplorerPath: RuntimeFileCommands['copyFileExplorerPath'] =
    this.fileCommands.copyFileExplorerPath.bind(this.fileCommands)
  deleteFileExplorerPath: RuntimeFileCommands['deleteFileExplorerPath'] =
    this.fileCommands.deleteFileExplorerPath.bind(this.fileCommands)
  searchRuntimeFiles: RuntimeFileCommands['searchRuntimeFiles'] =
    this.fileCommands.searchRuntimeFiles.bind(this.fileCommands)
  listRuntimeFiles: RuntimeFileCommands['listRuntimeFiles'] =
    this.fileCommands.listRuntimeFiles.bind(this.fileCommands)
  listRuntimeMarkdownDocuments: RuntimeFileCommands['listRuntimeMarkdownDocuments'] =
    this.fileCommands.listRuntimeMarkdownDocuments.bind(this.fileCommands)
  statRuntimeFile: RuntimeFileCommands['statRuntimeFile'] = this.fileCommands.statRuntimeFile.bind(
    this.fileCommands
  )

  protected readonly gitCommands = new RuntimeGitCommands({
    resolveRuntimeGitTarget: (selector) => this.resolveRuntimeGitTarget(selector),
    getRuntimeSettings: () => this.requireStore().getSettings() as GlobalSettings,
    getCommitMessageAgentEnvironment: () => this.commitMessageAgentEnv ?? undefined,
    // Why: resolved worktrees are cached for a second, so link/unlink would lag
    // generation; meta is keyed by the same id the resolver returns.
    getWorktreeLinkedIssue: (worktreeId) => {
      const store = this.store
      // Why: an unreadable store is "unknown", not "unlinked" — undefined keeps
      // the resolver's cached linkedIssue instead of suppressing {linkedIssue}.
      if (!store?.getWorktreeMeta) {
        return undefined
      }
      return store.getWorktreeMeta(worktreeId)?.linkedIssue ?? null
    }
  })

  getRuntimeGitStatus: RuntimeGitCommands['getRuntimeGitStatus'] =
    this.gitCommands.getRuntimeGitStatus.bind(this.gitCommands)
  getRuntimeGitSubmoduleStatus: RuntimeGitCommands['getRuntimeGitSubmoduleStatus'] =
    this.gitCommands.getRuntimeGitSubmoduleStatus.bind(this.gitCommands)
  checkRuntimeGitIgnoredPaths: RuntimeGitCommands['checkRuntimeGitIgnoredPaths'] =
    this.gitCommands.checkRuntimeGitIgnoredPaths.bind(this.gitCommands)
  getRuntimeGitHistory: RuntimeGitCommands['getRuntimeGitHistory'] =
    this.gitCommands.getRuntimeGitHistory.bind(this.gitCommands)
  getRuntimeGitConflictOperation: RuntimeGitCommands['getRuntimeGitConflictOperation'] =
    this.gitCommands.getRuntimeGitConflictOperation.bind(this.gitCommands)
  abortRuntimeGitMerge: RuntimeGitCommands['abortRuntimeGitMerge'] =
    this.gitCommands.abortRuntimeGitMerge.bind(this.gitCommands)
  abortRuntimeGitRebase: RuntimeGitCommands['abortRuntimeGitRebase'] =
    this.gitCommands.abortRuntimeGitRebase.bind(this.gitCommands)
  checkoutRuntimeGitBranch: RuntimeGitCommands['checkoutRuntimeGitBranch'] =
    this.gitCommands.checkoutRuntimeGitBranch.bind(this.gitCommands)
  listRuntimeGitLocalBranches: RuntimeGitCommands['listRuntimeGitLocalBranches'] =
    this.gitCommands.listRuntimeGitLocalBranches.bind(this.gitCommands)
  getRuntimeGitDiff: RuntimeGitCommands['getRuntimeGitDiff'] =
    this.gitCommands.getRuntimeGitDiff.bind(this.gitCommands)
  getRuntimeGitBranchCompare: RuntimeGitCommands['getRuntimeGitBranchCompare'] =
    this.gitCommands.getRuntimeGitBranchCompare.bind(this.gitCommands)
  getRuntimeGitCommitCompare: RuntimeGitCommands['getRuntimeGitCommitCompare'] =
    this.gitCommands.getRuntimeGitCommitCompare.bind(this.gitCommands)
  getRuntimeGitUpstreamStatus: RuntimeGitCommands['getRuntimeGitUpstreamStatus'] =
    this.gitCommands.getRuntimeGitUpstreamStatus.bind(this.gitCommands)
  fetchRuntimeGit: RuntimeGitCommands['fetchRuntimeGit'] = this.gitCommands.fetchRuntimeGit.bind(
    this.gitCommands
  )
  syncRuntimeGitForkDefaultBranch: RuntimeGitCommands['syncRuntimeGitForkDefaultBranch'] =
    this.gitCommands.syncRuntimeGitForkDefaultBranch.bind(this.gitCommands)
  pullRuntimeGit: RuntimeGitCommands['pullRuntimeGit'] = this.gitCommands.pullRuntimeGit.bind(
    this.gitCommands
  )
  fastForwardRuntimeGit: RuntimeGitCommands['fastForwardRuntimeGit'] =
    this.gitCommands.fastForwardRuntimeGit.bind(this.gitCommands)
  rebaseRuntimeGitFromBase: RuntimeGitCommands['rebaseRuntimeGitFromBase'] =
    this.gitCommands.rebaseRuntimeGitFromBase.bind(this.gitCommands)
  pushRuntimeGit: RuntimeGitCommands['pushRuntimeGit'] = this.gitCommands.pushRuntimeGit.bind(
    this.gitCommands
  )
  getRuntimeGitBranchDiff: RuntimeGitCommands['getRuntimeGitBranchDiff'] =
    this.gitCommands.getRuntimeGitBranchDiff.bind(this.gitCommands)
  getRuntimeGitCommitDiff: RuntimeGitCommands['getRuntimeGitCommitDiff'] =
    this.gitCommands.getRuntimeGitCommitDiff.bind(this.gitCommands)
  commitRuntimeGit: RuntimeGitCommands['commitRuntimeGit'] = this.gitCommands.commitRuntimeGit.bind(
    this.gitCommands
  )
  generateRuntimeCommitMessage: RuntimeGitCommands['generateRuntimeCommitMessage'] =
    this.gitCommands.generateRuntimeCommitMessage.bind(this.gitCommands)
  discoverRuntimeCommitMessageModels: RuntimeGitCommands['discoverRuntimeCommitMessageModels'] =
    this.gitCommands.discoverRuntimeCommitMessageModels.bind(this.gitCommands)
  cancelRuntimeGenerateCommitMessage: RuntimeGitCommands['cancelRuntimeGenerateCommitMessage'] =
    this.gitCommands.cancelRuntimeGenerateCommitMessage.bind(this.gitCommands)
  generateRuntimePullRequestFields: RuntimeGitCommands['generateRuntimePullRequestFields'] =
    this.gitCommands.generateRuntimePullRequestFields.bind(this.gitCommands)
  cancelRuntimeGeneratePullRequestFields: RuntimeGitCommands['cancelRuntimeGeneratePullRequestFields'] =
    this.gitCommands.cancelRuntimeGeneratePullRequestFields.bind(this.gitCommands)
  stageRuntimeGitPath: RuntimeGitCommands['stageRuntimeGitPath'] =
    this.gitCommands.stageRuntimeGitPath.bind(this.gitCommands)
  unstageRuntimeGitPath: RuntimeGitCommands['unstageRuntimeGitPath'] =
    this.gitCommands.unstageRuntimeGitPath.bind(this.gitCommands)
  bulkStageRuntimeGitPaths: RuntimeGitCommands['bulkStageRuntimeGitPaths'] =
    this.gitCommands.bulkStageRuntimeGitPaths.bind(this.gitCommands)
  bulkUnstageRuntimeGitPaths: RuntimeGitCommands['bulkUnstageRuntimeGitPaths'] =
    this.gitCommands.bulkUnstageRuntimeGitPaths.bind(this.gitCommands)
  bulkDiscardRuntimeGitPaths: RuntimeGitCommands['bulkDiscardRuntimeGitPaths'] =
    this.gitCommands.bulkDiscardRuntimeGitPaths.bind(this.gitCommands)
  discardRuntimeGitPath: RuntimeGitCommands['discardRuntimeGitPath'] =
    this.gitCommands.discardRuntimeGitPath.bind(this.gitCommands)
  getRuntimeGitRemoteFileUrl: RuntimeGitCommands['getRuntimeGitRemoteFileUrl'] =
    this.gitCommands.getRuntimeGitRemoteFileUrl.bind(this.gitCommands)
  getRuntimeGitRemoteCommitUrl: RuntimeGitCommands['getRuntimeGitRemoteCommitUrl'] =
    this.gitCommands.getRuntimeGitRemoteCommitUrl.bind(this.gitCommands)
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
