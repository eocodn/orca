import { detectAgentStatusFromTitle, isClaudeManagementTitle, isCursorNativeAgentTitle, isShellProcess, normalizeTerminalTitle, extractOscTitleScanTail, normalizeFolderWorkspaceOperationId, isServerDriveListRequest, listWindowsDrives, extractLastOsc7Uri, extractOscScanTail, parseFileUriPathParts, type AgentStatus, type TerminalOscLinkRange, type TerminalOscColorQueryReplyColors, type TerminalOutputSourceRange, type RemoteTerminalSourceRangeConsumerHooks, type RemoteTerminalSourceRangeReplacementPublication, type RemoteTerminalSourceRangeReplacementReservation, type RemoteTerminalSourceRangeStreamIdentity, createTerminalTitleTracker, stripBrailleSpinnerGlyphs, type TerminalTitleTracker, createCommandCodeOutputStatusDetector, type TerminalSideEffectBatch, type TerminalSideEffectFact, type TerminalGitHubPRLink, TerminalKittyKeyboardModeTracker, AGENT_STATUS_STALE_AFTER_MS, isFreshNonDoneAgentStatus, type AgentStatusIpcPayload, type ParsedAgentStatusPayload, type AgentStatusOrchestrationContext, type AgentStatusEntry, indexAgentStatusRowsByPaneKey, type AgentHookAuthorityAttestation, type AgentSessionClaimedSpawnResult, type AgentSessionExecutionClaim, type AgentSessionSurfaceBinding, type AgentLaunchPreferences, type RuntimeAgentSessionRpcCaller, type RuntimeCreateAgentSessionRequest, type RuntimeCreateAgentSessionResult, type RuntimeEnsureAgentSessionRequest, type RuntimeEnsureAgentSessionResult, AGENT_SESSION_MAX_NEW_OPERATION_AGE_MS, AGENT_SESSION_OPERATION_FUTURE_SKEW_MS, parseAgentSessionOperationTimestamp, canonicalizeAgentSessionIdentity, createEphemeralAgentSessionClaimSigner, type AgentSessionClaimSigner, hasCompatibleAgentTitleIdentity, normalizeCompatibleAgentStatusEntryForOwner, normalizeCompatibleAgentTitleForOwner, resolveCompatibleAgentTypeForOwner, resolvePaneAgentOwner, createAgentStatusOscProcessor, type ProcessedAgentStatusChunk, buildOrchestrationTaskDisplayMetadata, assertTerminalDimensions, AGENT_PROMPT_SUBMIT, buildAgentPromptPasteBytes, gitExecFileAsync, gitSpawn, nonInteractiveGitEnv, runWithGitReadCacheInvalidation, cleanupClaimedCloneTarget, claimCloneTarget, deriveValidatedClonePath, getClonePathComparisonKey, getGitCloneFailureMessage, GIT_FETCH_SKIP_AUTO_MAINTENANCE_CONFIG_ARGS, createHash, randomUUID, homedir, isAbsolute, join, resolve, mkdir, readdir, rm, stat, resolveWorktreeCreateBase, resolveWorktreeAddBaseRef, OrchestrationDb, OrchestrationError, planLegacyWorkerTerminalRecovery, type LegacyWorkerTerminalRecoveryPlan, buildObservedSetupCommand, createSetupCompletionScanner, type RuntimeOrchestrationEnvelope, type TerminalRevealIdentity, type OrchestrationCompatibilityEvidence, type OrchestrationCompatibilityHostStamp, isOrchestrationMutation, orchestrationMigrationData, type OrchestrationEnvironmentTransport, type OrchestrationWorkerServer, syncFederatedDispatch, formatMessagesForInjection, selectExactWorkerProviderSession, type Automation, type AutomationRun, type AutomationWorkspaceProvenance, type CliWorkspaceProvenance, type BaseRefSearchResult, type CreateWorktreeResult, type DetectedWorktree, type DetectedWorktreeListResult, type ForceDeleteWorktreeBranchResult, type GitHubPrStartPoint, type GitPushTarget, type GitWorktreeInfo, type GitHubOwnerRepo, type GlobalSettings, type PersistedUIState, type Project, type ProjectUpdateArgs, type ProjectHostSetup, type ProjectHostSetupCloneArgs, type ProjectHostSetupCreateArgs, type ProjectHostSetupCreateResult, type ProjectHostSetupDeleteArgs, type ProjectHostSetupDeleteResult, type ProjectHostSetupExistingFolderArgs, type ProjectHostSetupResult, type ProjectHostSetupUpdateArgs, type ProjectHostSetupUpdateResult, type Repo, type RemoveWorktreeResult, type StatsSummary, type Worktree, type WorktreeLineage, type WorkspaceLineage, type WorkspaceKey, type WorktreeLineageWarning, type WorktreeMeta, type WorktreeBaseStatusEvent, type WorktreeRemoteBranchConflictEvent, type WorktreeStartupLaunch, type LinearIssueUpdate, type LinearProjectSummary, type NestedRepoScanResult, type ProjectGroup, type FolderWorkspace, type ProjectGroupImportMode, type ProjectGroupImportResult, type MemorySnapshot, type Tab, type TabGroupLayoutNode, type TerminalQuickCommand, type TerminalLayoutSnapshot, type TerminalPaneLayoutNode, type TerminalTab, type TuiAgent, type WorkspaceCreateTelemetrySource, type WorkspaceSessionState, type WorkspaceLinkedItem, type DirEntry, type FilesystemPathFlavor, type GitLabIssueUpdate, type GitLabMRInlineCommentInput, type GitLabProjectRef, type GitLabWorkItem, type MRListState, type ClaudeRateLimitAccountsState, type CodexRateLimitAccountsState, type TaskSourceContext, assertWorktreeUnlockedForRemoval, LOCAL_EXECUTION_HOST_ID, getRepoExecutionHostId, getWorktreeExecutionHostId, parseExecutionHostId, toSshExecutionHostId, type ExecutionHostId, getRegisteredSshState, type AgentProviderSessionMetadata, type SleepingAgentLaunchConfig, type ExactWorkerProviderSession, type RuntimeClientEvent, toRuntimeActivateWorktreeEvent, navigationTargetsClients, navigationTargetsHost, type RuntimeNavigationTarget, type SshConnectionState, getPublicSshState, closeTerminalTabInWorkspaceSession, type LinearCurrentIssueContextHints, type LinearAttachResult, type LinearCommentAddResult, type LinearCreateResult, type LinearErrorCode, type LinearIssueListFilter, type LinearIssueListResult, type LinearProjectListResult, type LinearIssueSummary, type LinearIssueRequest, type LinearIssueTaskUpdateRequest, type LinearIssueTaskUpdateResult, type LinearMcpIssueListRequest, type LinearMcpIssueListResult, type LinearIssueRelationWriteRequest, type LinearIssueRelationWriteResult, type LinearSaveIssueRequest, type LinearSaveIssueResult, type LinearTeamLabelsResult, type LinearTeamListResult, type LinearTeamMembersResult, type LinearTeamStatesResult, type LinearStatusSetResult, HEADLESS_RUNTIME_WINDOW_ID, type RuntimeDesktopWindowStatus, type RuntimeGraphStatus, type RuntimeRepoSearchRefs, type RuntimeTerminalRead, type RuntimeTerminalRename, type RuntimeTerminalAgentStatus, type RuntimeTerminalSend, type RuntimeTerminalCreate, type RuntimeTerminalPresentation, type RuntimeTerminalSplit, type RuntimeTerminalFocus, type RuntimeTerminalClose, type RuntimeTerminalListResult, type RuntimeTerminalOrphanAdoptionRequest, type RuntimeTerminalOrphanAdoptionResult, type RuntimeWorktreeTerminalSleepResult, type RuntimeTerminalResolvePane, type RuntimeStatus, type RuntimeSyncWindowGraphResult, type RuntimeTerminalWait, type RuntimeTerminalWaitCondition, type RuntimeWorktreePsSummary, type RuntimeWorktreeAgentRow, type RuntimeSpeechModelSummary, type RuntimeSpeechSetupState, type RuntimeTerminalShow, type RuntimeTerminalInspect, type RuntimeTerminalResize, type RuntimeTerminalSummary, type RuntimeTerminalVisualGroupNode, type RuntimeTerminalVisualLayout, type RuntimeTerminalVisualLayoutNode, type RuntimeTerminalVisualPaneNode, type RuntimeTerminalVisualTab, type RuntimeSyncedLeaf, type RuntimeSyncedTab, type RuntimeMarkdownReadTabResult, type RuntimeMarkdownSaveTabResult, type RuntimeMobileSessionCreateTerminalResult, type RuntimeMobileSessionClientTab, type RuntimeMobileSessionTabCloseResult, type RuntimeMobileSessionMarkdownTab, type RuntimeMobileSessionTabMove, type RuntimeMobileSessionTabMoveResult, type RuntimeMobileSessionTabGroup, type RuntimeMobileSessionSnapshotTab, type RuntimeMobileSessionTerminalTab, type RuntimeMobileSessionBrowserTab, type RuntimeMobileSessionTabsRemovedResult, type RuntimeMobileSessionTabsResult, type RuntimeMobileSessionTabsSnapshot, type RuntimeSessionFlushResult, type RuntimeSessionSnapshot, type RuntimeNativeChatLaunchDraftResolution, type RuntimeSessionTabCloseReason, type RuntimeBrowserDriverState, type RuntimeTerminalDriverState, type RuntimeSyncWindowGraph, type RuntimeWorktreeListResult, type BrowserTabInfo, type BrowserScreencastResult, LINEAR_SEARCH_MAX_LIMIT, LINEAR_WRITE_BODY_CAP, clampLinearSearchLimit, isLinearUuid, type FeatureInteractionId, type TerminalPaneSplitSource, WORKTREE_ID_SEPARATOR, getRepoIdFromWorktreeId, splitWorktreeId, splitWorktreeIdForFilesystem, getProjectIdForProviderIdentity, getProjectHostSetupForRepo, getProjectHostSetupWorktreeMeta, clampLinearIssueListLimit, isFolderRepo, DEFAULT_WORKSPACE_STATUS_ID, buildSetupRunnerCommand, getSetupRunnerCommandPlatformForPath, createSequencedSetupAgentCommands, SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV, FIRST_PANE_ID, isTerminalLeafId, makePaneKey, parsePaneKey, parseAppSshPtyId, isValidHostTerminalTabId, isValidTerminalTabId, type TerminalQuickCommandMutation, isPtyIncarnationId, type PtyIncarnationId, buildAgentDraftLaunchPlan, buildAgentResumeStartupPlan, buildAgentStartupPlan, repoIsRemote, isAgentForegroundWrapperProcess, isExpectedAgentProcess, recognizeAgentProcess, isTuiAgentEnabled, pickTuiAgent, resolveTuiAgentLaunchArgs, resolveTuiAgentLaunchEnv, resolveLocalWindowsAgentStartupShell, isTuiAgent, TUI_AGENT_CONFIG, createDraftPasteReadyScanner, detectInstalledAgentsWithShellPathHydration, detectRemoteAgents, markCodexProjectTrusted, markCopilotFolderTrusted, markCursorWorkspaceTrusted, markRemoteAgentWorkspaceTrusted, applyAgentStatusHooksEnabled, recordManagedHookInstallFailure, isWindowsAbsolutePathLike, isPathInsideOrEqual, normalizeRuntimePathForComparison, resolveTerminalStartupCwd, isWslUncPath, parseWslUncPath, folderWorkspaceKey, isWorkspaceKey, parseWorkspaceKey, worktreeWorkspaceKey, projectResolvedWorktreeLineage, sharesResolvedWorktreeLineageBoundary, folderWorkspaceToWorktree, type FolderWorkspacePathStatus, type FolderWorkspacePathStatusRequest, applyMetadataFallbackVisibility, buildKnownOrcaWorkspaceLayouts, isLegacyRepoForExternalWorktreeVisibility, toDetectedWorktree, createAgentScratchWorktreePathMatcher, type AgentScratchWorktreePathMatcher, BROWSER_HEADLESS_RUNTIME_CAPABILITY, BROWSER_CERTIFICATE_TRUST_RUNTIME_CAPABILITY, MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION, ORCHESTRATION_CONTRACT_RUNTIME_CAPABILITY, ORCHESTRATION_CONTRACT_VERSION, REMOTE_RUNTIME_SHARED_CONTROL_CAPABILITY, RUNTIME_CAPABILITIES, RUNTIME_PROTOCOL_VERSION, TERMINAL_PAIRED_PARKING_RUNTIME_CAPABILITY, type RuntimeCapability, configureAiVaultSessionSources, listAiVaultSessions, type AiVaultListArgs, type AiVaultListResult, type AiVaultPrepareSessionResumeArgs, type AiVaultPrepareSessionResumeResult, type WorkspacePortKillRequest, type WorkspacePortKillResult, type WorkspacePortProbe, type WorkspacePortScanResult, filterWorkspacePortProbes, killWorkspacePort, scanWorkspacePortProbes, advertisedUrlWatcher, type AutomationService, RuntimeBrowserCommands, RemoteRuntimeTerminalCreateIdempotency, deriveRemoteRuntimeTerminalCreateHandle, buildHeadlessTerminalSplitLayout, countTerminalLayoutLeaves, RECENT_PTY_OUTPUT_LIMIT, TerminalOutputState, type RuntimeTerminalDataMeta, RuntimeGithubProjectCommands, RuntimeJiraCommands, WorktreeResolutionState, RuntimeTerminalInputCommands, RuntimeLinearQueryCommands, RuntimeLinearConnectionCommands, RuntimeReviewQueryCommands, RuntimeReviewMutationCommands, RuntimeRepoWorkItemCommands, RuntimeMessageWaiters, type MessageWaitResult, buildHeadlessTabGroupMove, buildHeadlessTabGroupSplit, hasExactTerminalOrphanGroupLayout, mergeTerminalOrphanGroupLayout, terminalOrphanExecutionOwnersEqual, retireTerminalSurfacesFromSnapshot, type RetiredTerminalSurface, retireTerminalSurfaceFromPersistence, advanceTerminalTopologyRevision, hasHostAuthoritativeTerminalMembership, RuntimeEmulatorCommands, setEmulatorBridge, type EmulatorBridge, RuntimeFileCommands, RuntimeGitCommands, appendRecentPtyPathCandidates, recentTerminalOutputIncludesPath, recentTerminalPathCandidatesIncludePath, detectTerminalWaitBlockedReason, isKnownReadyPromptPreview, buildPreview, buildTerminalWaitText, computeTerminalTailWaitState, MAX_TAIL_CHARS, tailGainedNewerBlockedReason, type TerminalTailWaitState, appendNormalizedToTailBuffer, type RetainedTailRedrawCursor, appendCompletedTerminalTranscript, tailStateMatches, normalizeTerminalChunk, DEFAULT_TERMINAL_READ_LIMIT, readTerminalTail, terminalReadLimit, shouldFallbackToVisibleTerminalSnapshot, visibleNonBlankTerminalLines, buildVisibleSnapshotReadFallback, MOBILE_AUTO_RESTORE_FIT_MAX_MS, MOBILE_AUTO_RESTORE_FIT_MIN_MS, TUI_IDLE_DEFAULT_TIMEOUT_MS, TUI_IDLE_POLL_INTERVAL_MS, TUI_IDLE_QUIESCENCE_MS, assertTerminalInputWithinLimitWithYield, buildSendPayload, buildPtyTerminalWaitResult, buildPtyTerminalWaitBlockedResult, buildTerminalWaitResult, buildTerminalWaitBlockedResult, detectExplicitIdleStatusFromTitle, getTerminalState, activateClientSessionTabSelection, ClientSessionTabSelectionStore, deriveClientSessionTabSelection, projectClientSessionTabSelection, type PtyProviderBufferSnapshot, type IPtyProvider, type PtyProcessInfo, type PtyTransientFact, ClaudeAgentTeamsService, type AgentTeamsTmuxCompatRequest, type AgentTeamsTmuxCompatResponse, buildClaudeAgentTeamsLaunchPlan, ensureClaudeAgentTeamsShimDir, resolveClaudeAgentTeamsShimBin, addClaudeTeammateModeAuto, addClaudeTeammateModeInProcess, collectMemorySnapshot, app, BrowserWindow, ipcMain, Notification, type AgentBrowserBridge, type BrowserBackend, BrowserError, getRepoSlug, getRepoUpstream, type getPRForBranch, resolveGitHubPrStartPoint, fetchGitHubPullRequestHeadRef, fetchPrHeadTrackingRef, gitlabMergeRequestHeadLocalRef, reviewHeadRemoteRefComponent, fetchGitLabMergeRequestHeadRef, isTransientReviewHeadFetchError, resolveGitHubReviewHeadRemote, fetchCompareBaseRefWithLocalFallback, pickPreferredGitRemote, closeGitLabMR, createGitLabIssue, diagnoseGitLabAuthClient, getGitLabJobTrace, getGitLabProjectRefForRemote, getGitLabRateLimit, getGitLabWorkItemByProjectRef, addGitLabIssueComment, addGitLabMRInlineComment, addGitLabMRComment, listGitLabTodos, listGitLabIssues, listGitLabLabels, listGitLabMergeRequests, listGitLabWorkItems, mergeGitLabMR, reopenGitLabMR, resolveGitLabMRDiscussion, retryGitLabJob, updateGitLabMR, updateGitLabMRReviewers, updateGitLabIssue, getGlabKnownHosts, getGitLabWorkItemDetails, normalizeGitLabIssueListArgs, normalizeGitLabMRListState, normalizeGitLabPositiveInteger, type GitLabIssueListState, recordGitLabProjectRecent, type CreateHostedReviewInput, type CreateHostedReviewResult, type HostedReviewCreationEligibility, type HostedReviewCreationEligibilityArgs, type HostedReviewInfo, getHostedReviewForBranchFromRepo, createHostedReviewFromRepo, getHostedReviewCreationEligibilityFromRepo, getLocalProjectGitExecOptions, getLocalProjectWorktreeGitOptions, getLocalProjectWorktreeGitOptionsForRuntime, resolveLocalProjectRuntimeForRepo, resolveLocalProjectRuntimesForRepos, resolveLocalProjectRuntimeForWorktreeId, type ProjectExecutionRuntimeResolution, resolveTerminalOrchestrationCliCommand, getLocalWorktreePathAccess, removeLocalWorktreePath, toLocalWorktreeRuntimePath, removeStaleLocalWorktreeRegistrationAfterFilesystemRemoval, recoverLocalWindowsWorktreeRemoval, getLinearStatus, isLinearAuthError, addLinearIssueCommentForAgent, createLinearIssueAttachment, createLinearIssueForAgent, getLinearAttachmentByUuidForAgent, getLinearCommentByUuidForAgent, getLinearIssueByUuidForAgent, getLinearIssueCommentThreadRoot, listLinearIssues, updateLinearIssueForAgent, LinearWriteFailure, LinearAgentAccessError, getLinearCurrentIssueFromWorktree, readLinearIssueContext, resolveLegacyLinearLinkWorkspace, classifyLinearError, linearError, linearMessage, sanitizeLinearErrorMessage, listMcpIssues, writeIssueRelation, getLinearProject, listLinearProjectsByExactName, listLinearProjectTeams, listLinearProjects, getLinearTeamLabelsOrThrow, getLinearTeamMembersOrThrow, getLinearTeamStatesOrThrow, getLinearViewerForWorkspaceOrThrow, listLinearTeamsForAgent, listLinearTeamsOrThrow, getBaseRefDefault, getDefaultRemote, getBranchConflictKind, isGitRepo, getRepoName, searchBaseRefDetails, getRemoteCount, normalizeRefSearchQuery, parseAndFilterSearchRefDetails, parseRemoteCount, resolveDefaultBaseRefViaExec, resolveDefaultBaseRefWithLocalGit, buildSearchBaseRefsArgv, isForEachRefExcludeUnsupportedError, mergeBaseRefSearchResultGroups, getRemoteDrift, getRecentDriftSubjects, hasCommitObjectViaGitExec, hasWorktreeBaseCommitRef, resolveLocalGitUsername, getSshGitCapabilityCache, listWorktrees, listWorktreesStrict, addWorktree, addSparseWorktree, assertWorktreeCleanForRemoval, forceDeleteLocalBranch, removeWorktree, type AddWorktreeOptions, type AddWorktreeResult, isENOENT, invalidateAuthorizedRootsCache, createSetupRunnerScript, getDefaultTabsLaunch, getEffectiveHooks, loadHooks, runHook, shouldRunSetupForCreate, DEFAULT_REPO_BADGE_COLOR, FLOATING_TERMINAL_WORKTREE_ID, getDefaultVoiceSettings, listRepoWorktrees, createWorktreeCopiedPaths, createWorktreeLinkedPaths, createWorktreeSharedPaths, findExistingWorktreeSymlinkPaths, removeWorktreeLinkedPaths, formatWorktreeIncludeCopyWarning, resolveWorktreeIncludePaths, getWorktreeSharedLinkPaths, resolveWorktreeSharedDirectories, deleteWorktreeHistoryDir, cleanupUnusedWorktreePushTargetRemote, cleanupUnusedWorktreePushTargetRemoteSsh, createRemoteWorktree, configureCreatedWorktreePushTarget, prepareWorktreePushTarget, getBranchNameOverrideCandidate, getWorktreeCreateCandidate, WORKTREE_CREATE_MAX_SUFFIX_ATTEMPTS, normalizeSparseDirectories, type Store, type StatsCollector, AgentDetector, computeWorktreePath, computeWorkspaceRoot, ensurePathWithinWorkspace, formatWorktreeRemovalError, getWorktreeCreationLayout, getWorktreePathSettings, isOrphanCompatiblePreflightError, isOrphanedWorktreeError, mergeWorktree, sanitizeWorktreeName, shouldSetDisplayName, areWorktreePathsEqual, findCreatedWorktree, assertWorktreeDoesNotContainRegisteredWorktree, canCleanupUnregisteredOrcaLeftoverDirectory, canCleanupUnregisteredOrcaWorktreeDirectory, canSafelyRemoveOrphanedWorktreeDirectory, findRegisteredDeletableWorktree, isDangerousWorktreeRemovalPath, ORPHANED_WORKTREE_DIRECTORY_MESSAGE, stripOrcaProvenanceMetaUpdates, UNREGISTERED_MISSING_WORKTREE_MESSAGE, prefetchWorktreeCreateBase, prepareLocalWorktreeRootForRepo, closeLocalWatcherForWorktreePath, closeRemoteWatcherForWorktreePath, forgetLocalWatcherRemovalSnapshot, forgetRemoteWatcherRemovalSnapshot, restoreLocalWatcherAfterFailedRemoval, restoreRemoteWatcherAfterFailedRemoval, acquireWatcherRemovalGate, createWatcherRemovalDeadline, drainBeforeWatcherRemoval, type WatcherRemovalDeadline, withWorktreeSpan, HeadlessEmulator, isNativeWindowsConptyPty, registerConptyDa1OverrideInstaller, shouldModelAnswerHiddenPtyQueries, getTerminalViewAttributes, getTerminalViewColorQueryReplyColors, registerTerminalViewAttributesApplier, killAllProcessesForWorktree, teardownRpcDeadline, stopMissingWorktreeTerminals, type ReplayableMobileNotification, RuntimeNotificationRegistry, MOBILE_SUBSCRIBE_SCROLLBACK_ROWS, createMobileSessionTabsNotifyCoalescer, type MobileSessionTabsNotifyCoalescer, getSshFilesystemProvider, assertFolderWorkspacePathUsable, getFolderWorkspacePathStatus, getFolderWorkspacePathStatusForPath, inferFolderWorkspacePathConnection, getSshGitProvider, getSshGitProviderGeneration, requireSshGitProvider, detectRepoIconAndUpstream, enrichMissingRepoGitRemoteIdentities, githubAvatarIcon, type ClaudeAccountService, type CodexAccountService, type CodexResetCreditRejectedBeforeProviderReason, type CodexAccountSelectionTarget, type RateLimitService, type CodexRateLimitResetOutcome, type RateLimitState, type CodexResetCreditExpectedScope, type VoiceSettings, getSpeechModelManager, getSpeechSttService, getCatalogModel, isLocalSpeechModel, SPEECH_MODEL_CATALOG, deleteLocalSpeechModel, getSpeechModelDeletionErrorCode, type CommitMessageAgentEnvironmentResolvers, scanNestedRepos, createNestedProjectGroupResolver, resolveNestedRepoSelection, createNestedRepoImportTargetResolver, RuntimeClientSettingsCommands, type RuntimeClientSettings, RuntimeAutomationCommands, type RuntimeAutomationCreateInput, type RuntimeAutomationUpdateInput, PtyLayoutQueue, type ApplyLayoutResult, type PtyLayoutState, type PtyLayoutTarget, PtyGenerationReferenceCount, RuntimeRepoHookCommands, branchSelectorMatches, buildRuntimeWorktreeSummaryPathIndex, canonicalizeTerminalSessionWorktreeId, classifyAgentTitle, classifyLatestAgentTitle, compareWorktreePs, findResolvedWorktreeIdForPath, findRuntimeWorktreeSummaryByPath, getExplicitWorktreeIdSelector, getLatestAgentCandidateTitle, getLatestAgentCandidateTitleInfo, getLatestLeafTitle, getLatestPtyTitle, getLeafWorktreeStatus, getSavedTabWorktreeStatus, includeTargetResolvedWorktree, indexPersistedPtySurfaceBindings, indexPersistedPtyWorktreeBindings, inferWorktreeIdFromPtyId, mapExplicitAgentStateToRuntimeTerminalStatus, maxTimestamp, mergeWorktreeStatus, notifyRuntimeListeners, parseRuntimeWorktreeId, resolveTerminalSessionWorktreeId, resolveWorktreeScanCacheTtlMs, runtimePathsEqual, runtimeWorktreeIdentityKey, runtimeWorktreeIdsEqual, type RuntimeWorktreeSummaryPathIndex, setBoundedMapEntry, setsEqual, terminalTitleBlocksExplicitAgentStatus, waitForWorktreeTerminalMutation, withTimeout, withTimeoutResult, getRuntimeWorktreeRemovalKey, getRuntimeWorktreeRemovalOptionsKey, isLocalRuntimeGitRepository, isRuntimeWorktreePathMissing, omitUndefinedProperties, parseExactWorktreeIdSelector, type PreservedBranchCleanupTarget, type RuntimeWorktreeRemovalInFlight, type RuntimeWorktreeRemovalTarget, addListenerToMap, canCheckoutExistingLocalBranch, clampTerminalViewport, getLocalGitHubPrForBranch, getSelectedHostedReviewForBranch, getSelectedReviewBranch, hasLocalGitOptions, isAllowedPushTargetRemoteConflict, isMatchingSelectedGitHubPr, resolveCreateBranchName, getRuntimeFolderWorkspaceInstanceId, getRuntimeFolderWorkspaceRootId, listRuntimeFolderWorkspaces, mergeRuntimeFolderWorkspace, copySleepingAgentLaunchConfig, deterministicAgentSessionUuid, inferCapturedClaudeAgentTeamsMode, isAgentSessionOperationOutcomeUnknown, isCursorAgentOrchestrationTarget, mergeTerminalEnvDeletionKeys, normalizeSparsePresetDirectoriesForSave, normalizeSparsePresetName, resolveBareAgentLaunchCommand, FETCH_FRESHNESS_MS, REMOTE_FETCH_TIMEOUT_MS, REMOTE_FETCH_CACHE_MAX, DRIFT_PROBE_SUBJECT_LIMIT, PTY_CONTROLLER_LIST_TIMEOUT_MS, WORKTREE_TERMINAL_SLEEP_TIMEOUT_MS, sanitizeNestedRepoRuntimeImportError, runtimeRepoMatchesExecutionHost, assertProjectHostSetupHostIsSupported, pathExists, resolveServerBrowsePath, type RuntimeAccountServices, type RemoteFetchResult, type RemoteTrackingBase, type AccountsSnapshot, type CodexRateLimitResetRpcResult, type RuntimeStore, type RuntimeLeafRecord, type RuntimePtyWorktreeRecord, type TerminalCreateOptions, AGENT_SESSION_OPERATION_PER_CLIENT_LIMIT, AGENT_SESSION_OPERATION_GLOBAL_LIMIT, SESSION_SNAPSHOT_STABILITY_ATTEMPTS, type PtyForegroundAgentRefresh, type RuntimeTerminalAgentStatusEvent, type RuntimePtyTitleTrackerEntry, type RuntimeAgentRowSnapshot, type AgentSessionCreateOperation, type RuntimeHeadlessTerminal, type RuntimePtyDataAdmission, type RuntimeVisibleTerminalState, type ProviderBufferAcquisition, type RuntimeTerminalBufferSnapshot, type HeadlessSeedMetadata, type RuntimePtyController, type PtyControllerTerminalIdentity, type PtyControllerInventory, type WorktreeStartupDraftPaste, type WorktreeStartupFollowup, getAgentLaunchPlatformForRepo, MOBILE_TERMINAL_CREATE_RESULT_TTL_MS, WORKTREE_CREATE_RESULT_TTL_MS, FOREGROUND_AGENT_WRAPPER_RETRY_INTERVAL_MS, FOREGROUND_AGENT_WRAPPER_RETRY_TIMEOUT_MS, BRACKETED_PASTE_BEGIN, BRACKETED_PASTE_END, BRACKETED_PASTE_QUIET_MS, DRAFT_PASTE_READY_TIMEOUT_MS, MOBILE_TERMINAL_SURFACE_TIMEOUT_MS, MOBILE_TERMINAL_READY_FALLBACK_MS, SSH_PANE_RECOVERY_GRACE_MS, isClientDisconnectedError, createTerminalRevealWarning, ownerSurfacing, resolveTerminalPresentation, type RuntimeNotifier, type TerminalHandleRecord, type OrchestrationCompatibilityTerminalAuthority, type LegacyWorkerTerminalRecoveryResult, type OrchestrationCompatibilityCallerAuthority, type RestoredOrchestrationAuthorityReceipt, type OrchestrationCompatibilitySshAttachmentAuthority, type TerminalWaiter, type ResolvedWorktree, type LinearAgentWriteTarget, type LinearCreateFieldIntent, AGENT_HOOK_RUNTIME_ENV_KEYS, sameStringSet, labelsForIds, type TerminalWorkspaceLaunchScope, type WorktreeLineageInput, type ResolvedWorkspaceParent, type WorktreeLineageResolution, type RuntimeWorktreeScanResult, type WorktreeLineageCandidate, extractOrchestrationTaskId, RuntimeLineageError, WorktreeIdRequiresFullPathError, type ResolvedWorktreeSnapshot, type MobileNotificationDispatchEvent, type RuntimeWorktreeLifecycleEvent, type MobileNotificationDismissEvent, type MobileNotificationEvent, type DriverState, type NativeChatLaunchDraftResolutionTombstone, MAX_NATIVE_CHAT_LAUNCH_DRAFT_RESOLUTION_TOMBSTONES, MAX_DELETED_FOLDER_TERMINAL_RETIREMENT_FENCES, MAX_TERMINAL_SURFACE_RETIREMENT_FENCES, hasLocalWorktreeBaseRef, makePtyDurableRetirementKey } from './orca-runtime-symbols'
import { OrcaRuntimeGetGitLabRepoWorkItemByPathPart50 } from './orca-runtime-get-git-lab-repo-work-item-by-path-part-50'

export class OrcaRuntimeActivateManagedWorktreePart51 extends OrcaRuntimeGetGitLabRepoWorkItemByPathPart50 {
  async activateManagedWorktree(
    worktreeSelector: string,
    opts: {
      notifyClients?: boolean
      clientKind?: 'mobile' | 'runtime'
      navigation?: RuntimeNavigationTarget
    } = {}
  ): Promise<{
    repoId: string
    worktreeId: string
    activated: boolean
    /** Mobile-scoped slept-agent wake outcome. `unsupported-headless` means no
     *  renderer holds the sleeping records (headless `orca serve`), so nothing
     *  woke — clients must not present the worktree's agents as resumed. */
    sleepingAgentWake: 'requested' | 'unsupported-headless' | 'not-applicable'
  }> {
    this.assertGraphReady()
    const worktree = await this.resolveWorktreeSelector(worktreeSelector)
    const repo = this.store?.getRepo(worktree.repoId)
    if (!repo) {
      throw new Error('repo_not_found')
    }
    const navigation = opts.navigation ?? (opts.notifyClients === false ? 'caller' : 'all')
    const targetsHost = navigationTargetsHost(navigation)
    const targetsClients = navigationTargetsClients(navigation)

    if (!targetsHost && this.store?.getWorktreeMeta(worktree.id)?.isUnread) {
      // Why: mobile/web session activation intentionally bypasses renderer
      // selection, so the runtime must acknowledge the unread state itself.
      this.store.setWorktreeMeta(worktree.id, { isUnread: false })
      this.notifyWorktreesChanged(repo.id)
    }

    let sleepingAgentWake: 'requested' | 'unsupported-headless' | 'not-applicable' =
      'not-applicable'

    if (targetsHost || targetsClients) {
      // Why: inactive worktree terminal panes are renderer-owned and may not have
      // live PTYs until the desktop activates the worktree and mounts them.
      if (targetsHost) {
        this.notifyHostActivateWorktree(repo.id, worktree.id)
      }
      if (targetsClients) {
        this.notifyClientsActivateWorktree(repo.id, worktree.id)
      }
    }
    if (!targetsHost) {
      // Why: mobile/web selection needs fresh session surfaces without forcing
      // every attached desktop renderer to navigate to the phone's workspace.
      this.hydrateHeadlessMobileSessionTabsFromWorkspaceSession(worktree.id, {
        allowAttachedWindow: true
      })
      await this.refreshMobileSessionPtyRecords()
      this.notifyMobileSessionTabsChanged(worktree.id)
      // Why: a phone open must also wake the worktree's slept agents (experimental
      // agent sleep). Only the host renderer holds the sleeping records + wake
      // authority, so fire-and-forget ask it — mobile-scoped so web/desktop are
      // unaffected. Headless serve has no renderer to wake anything, so report
      // that explicitly instead of letting mobile assume the agents resumed.
      if (opts.clientKind === 'mobile') {
        if (this.getAvailableAuthoritativeWindow()) {
          this.notifier?.resumeSleepingAgents?.(worktree.id)
          sleepingAgentWake = 'requested'
        } else if (
          // Why: sleeping records are partitioned by execution host; reading
          // only the local partition would miss slept agents on SSH-host
          // worktrees and skip the headless warning for them.
          Object.values(
            this.store?.getWorkspaceSession?.(getRepoExecutionHostId(repo))
              .sleepingAgentSessionsByPaneKey ?? {}
          ).some((record) => record.worktreeId === worktree.id)
        ) {
          // Why: headless is only degraded when this worktree actually has a
          // persisted resume record. Ordinary mobile activation must not show
          // an unsupported warning merely because no desktop window is open.
          sleepingAgentWake = 'unsupported-headless'
        }
      }
    }
    return { repoId: repo.id, worktreeId: worktree.id, activated: true, sleepingAgentWake }
  }
  protected async buildStartupForDraft(
    repo: Repo,
    draft: string,
    requestedAgent?: TuiAgent
  ): Promise<{
    agent: TuiAgent
    startup: WorktreeStartupLaunch
    draftPaste?: WorktreeStartupDraftPaste
  } | null> {
    if (!this.store) {
      return null
    }
    const content = draft.trim()
    if (!content) {
      return null
    }
    const settings = this.store.getSettings()
    const preferredAgent = requestedAgent ?? settings.defaultTuiAgent
    if (preferredAgent === 'blank') {
      // Why: `blank` is an explicit user preference to create a shell-only
      // workspace, so linked task drafts must not auto-pick a detected agent.
      return null
    }
    let agent =
      isTuiAgent(preferredAgent) && isTuiAgentEnabled(preferredAgent, settings.disabledTuiAgents)
        ? preferredAgent
        : null
    if (!agent) {
      let detected: string[] = []
      try {
        // Why: startup-draft fallback can run from sparse runtime launch envs too.
        detected = repo.connectionId
          ? await detectRemoteAgents({ connectionId: repo.connectionId })
          : await detectInstalledAgentsWithShellPathHydration()
      } catch {
        detected = []
      }
      const typedDetected = detected.filter(isTuiAgent)
      agent = pickTuiAgent(null, typedDetected, settings.disabledTuiAgents)
    }
    if (!agent) {
      return null
    }

    // Why: a mobile client can run on Windows while the workspace shell is
    // Linux over SSH. Startup command quoting must target the shell that runs it.
    const agentLaunchPlatform = this.getAgentLaunchPlatformForRepo(repo)
    const isRemote = repoIsRemote(repo)
    const queuedShell = resolveLocalWindowsAgentStartupShell({
      platform: agentLaunchPlatform,
      isRemote,
      terminalWindowsShell: settings.terminalWindowsShell
    })
    const draftLaunchPlan = buildAgentDraftLaunchPlan({
      agent,
      draft: content,
      cmdOverrides: settings.agentCmdOverrides ?? {},
      agentArgs: resolveTuiAgentLaunchArgs(agent, settings.agentDefaultArgs),
      agentEnv: resolveTuiAgentLaunchEnv(agent, settings.agentDefaultEnv),
      platform: agentLaunchPlatform,
      shell: queuedShell,
      isRemote
    })
    if (draftLaunchPlan) {
      return {
        agent,
        startup: {
          command: draftLaunchPlan.launchCommand,
          launchConfig: draftLaunchPlan.launchConfig,
          ...(draftLaunchPlan.startupCommandDelivery
            ? { startupCommandDelivery: draftLaunchPlan.startupCommandDelivery }
            : {}),
          ...(draftLaunchPlan.env ? { env: draftLaunchPlan.env } : {})
        }
      }
    }

    const startupPlan = buildAgentStartupPlan({
      agent,
      prompt: '',
      cmdOverrides: settings.agentCmdOverrides ?? {},
      agentArgs: resolveTuiAgentLaunchArgs(agent, settings.agentDefaultArgs),
      agentEnv: resolveTuiAgentLaunchEnv(agent, settings.agentDefaultEnv),
      platform: agentLaunchPlatform,
      shell: queuedShell,
      isRemote,
      allowEmptyPromptLaunch: true
    })
    if (!startupPlan) {
      return null
    }
    return {
      agent,
      startup: {
        command: startupPlan.launchCommand,
        launchConfig: startupPlan.launchConfig,
        ...(startupPlan.startupCommandDelivery
          ? { startupCommandDelivery: startupPlan.startupCommandDelivery }
          : {}),
        ...(startupPlan.env ? { env: startupPlan.env } : {})
      },
      draftPaste: { agent, content }
    }
  }
  protected buildStartupForAgent(
    repo: Repo,
    agent: TuiAgent,
    prompt: string | undefined
  ): { agent: TuiAgent; startup: WorktreeStartupLaunch; followup?: WorktreeStartupFollowup } {
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }
    const settings = this.store.getSettings()
    if (!isTuiAgentEnabled(agent, settings.disabledTuiAgents)) {
      throw new Error('Selected agent is disabled. Choose an enabled agent before creating.')
    }
    // Why: CLI clients may target SSH runtimes from macOS/Windows, so quote for
    // the workspace shell rather than the client shell.
    const agentLaunchPlatform = this.getAgentLaunchPlatformForRepo(repo)
    const isRemote = repoIsRemote(repo)
    const queuedShell = resolveLocalWindowsAgentStartupShell({
      platform: agentLaunchPlatform,
      isRemote,
      terminalWindowsShell: settings.terminalWindowsShell
    })
    const startupPlan = buildAgentStartupPlan({
      agent,
      prompt: prompt ?? '',
      cmdOverrides: settings.agentCmdOverrides ?? {},
      agentArgs: resolveTuiAgentLaunchArgs(agent, settings.agentDefaultArgs),
      agentEnv: resolveTuiAgentLaunchEnv(agent, settings.agentDefaultEnv),
      platform: agentLaunchPlatform,
      shell: queuedShell,
      isRemote,
      allowEmptyPromptLaunch: true
    })
    if (!startupPlan) {
      throw new Error(`Could not build launch command for ${agent}.`)
    }
    return {
      agent,
      startup: {
        command: startupPlan.launchCommand,
        launchConfig: startupPlan.launchConfig,
        ...(startupPlan.startupCommandDelivery
          ? { startupCommandDelivery: startupPlan.startupCommandDelivery }
          : {}),
        ...(startupPlan.env ? { env: startupPlan.env } : {})
      },
      ...(startupPlan.followupPrompt
        ? {
            followup: {
              expectedProcess: startupPlan.expectedProcess,
              prompt: startupPlan.followupPrompt
            }
          }
        : {})
    }
  }
  protected markLocalWorkspaceTrustedForAgent(agent: TuiAgent, workspacePath: string): void {
    const preset = TUI_AGENT_CONFIG[agent].preflightTrust
    if (!preset) {
      return
    }
    try {
      if (preset === 'cursor') {
        markCursorWorkspaceTrusted(workspacePath)
      } else if (preset === 'copilot') {
        markCopilotFolderTrusted(workspacePath)
      } else if (preset === 'codex') {
        markCodexProjectTrusted(workspacePath)
      }
    } catch {
      // Best-effort: the user can still accept the agent trust prompt manually.
    }
  }
  protected async markRemoteWorkspaceTrustedForAgent(
    agent: TuiAgent,
    connectionId: string,
    workspacePath: string
  ): Promise<void> {
    const preset = TUI_AGENT_CONFIG[agent].preflightTrust
    if (!preset) {
      return
    }
    try {
      await markRemoteAgentWorkspaceTrusted({ preset, connectionId, workspacePath })
    } catch {
      // Best-effort: the user can still accept the remote agent trust prompt manually.
    }
  }
  protected recordCreatedWorktreeLineage(
    worktree: Pick<Worktree, 'id' | 'instanceId'>,
    lineageResolution: WorktreeLineageResolution
  ): {
    lineage: WorktreeLineage | null
    workspaceLineage: WorkspaceLineage | null
    warnings: WorktreeLineageWarning[]
  } {
    const warnings = lineageResolution.kind === 'none' ? [...lineageResolution.warnings] : []
    let lineage: WorktreeLineage | null = null
    let workspaceLineage: WorkspaceLineage | null = null
    if (lineageResolution.kind !== 'lineage') {
      return { lineage, workspaceLineage, warnings }
    }

    const childInstanceId = worktree.instanceId
    const parentInstanceId = lineageResolution.parent.instanceId
    const createdAt = Date.now()
    if (
      lineageResolution.parent.type === 'worktree' &&
      childInstanceId &&
      parentInstanceId &&
      this.store?.setWorktreeLineage
    ) {
      lineage = this.store.setWorktreeLineage(worktree.id, {
        worktreeId: worktree.id,
        worktreeInstanceId: childInstanceId,
        parentWorktreeId: lineageResolution.parent.worktree.id,
        parentWorktreeInstanceId: parentInstanceId,
        origin: lineageResolution.origin,
        capture: lineageResolution.capture,
        ...(lineageResolution.orchestrationRunId
          ? { orchestrationRunId: lineageResolution.orchestrationRunId }
          : {}),
        ...(lineageResolution.taskId ? { taskId: lineageResolution.taskId } : {}),
        ...(lineageResolution.coordinatorHandle
          ? { coordinatorHandle: lineageResolution.coordinatorHandle }
          : {}),
        ...(lineageResolution.createdByTerminalHandle
          ? { createdByTerminalHandle: lineageResolution.createdByTerminalHandle }
          : {}),
        createdAt
      })
    } else if (lineageResolution.parent.type === 'worktree') {
      warnings.push({
        code: 'LINEAGE_PARENT_CONTEXT_MISSING',
        message:
          'Worktree created, but Orca could not record lineage because instance identity was unavailable.',
        details: {
          childHasInstanceId: Boolean(childInstanceId),
          parentHasInstanceId: Boolean(parentInstanceId),
          storeSupportsLineage: Boolean(this.store?.setWorktreeLineage)
        }
      })
    }
    if (childInstanceId && this.store?.setWorkspaceLineage) {
      workspaceLineage = this.store.setWorkspaceLineage({
        childWorkspaceKey: worktreeWorkspaceKey(worktree.id),
        childInstanceId,
        parentWorkspaceKey: lineageResolution.parent.workspaceKey,
        parentInstanceId,
        origin: lineageResolution.origin,
        capture: lineageResolution.capture,
        ...(lineageResolution.taskId ? { taskId: lineageResolution.taskId } : {}),
        ...(lineageResolution.orchestrationRunId
          ? { orchestrationRunId: lineageResolution.orchestrationRunId }
          : {}),
        ...(lineageResolution.coordinatorHandle
          ? { coordinatorHandle: lineageResolution.coordinatorHandle }
          : {}),
        ...(lineageResolution.createdByTerminalHandle
          ? { createdByTerminalHandle: lineageResolution.createdByTerminalHandle }
          : {}),
        createdAt
      })
    }
    return { lineage, workspaceLineage, warnings }
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
