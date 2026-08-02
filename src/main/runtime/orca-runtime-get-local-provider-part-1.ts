import { detectAgentStatusFromTitle, isClaudeManagementTitle, isCursorNativeAgentTitle, isShellProcess, normalizeTerminalTitle, extractOscTitleScanTail, normalizeFolderWorkspaceOperationId, isServerDriveListRequest, listWindowsDrives, extractLastOsc7Uri, extractOscScanTail, parseFileUriPathParts, type AgentStatus, type TerminalOscLinkRange, type TerminalOscColorQueryReplyColors, type TerminalOutputSourceRange, type RemoteTerminalSourceRangeConsumerHooks, type RemoteTerminalSourceRangeReplacementPublication, type RemoteTerminalSourceRangeReplacementReservation, type RemoteTerminalSourceRangeStreamIdentity, createTerminalTitleTracker, stripBrailleSpinnerGlyphs, type TerminalTitleTracker, createCommandCodeOutputStatusDetector, type TerminalSideEffectBatch, type TerminalSideEffectFact, type TerminalGitHubPRLink, TerminalKittyKeyboardModeTracker, AGENT_STATUS_STALE_AFTER_MS, isFreshNonDoneAgentStatus, type AgentStatusIpcPayload, type ParsedAgentStatusPayload, type AgentStatusOrchestrationContext, type AgentStatusEntry, indexAgentStatusRowsByPaneKey, type AgentHookAuthorityAttestation, type AgentSessionClaimedSpawnResult, type AgentSessionExecutionClaim, type AgentSessionSurfaceBinding, type AgentLaunchPreferences, type RuntimeAgentSessionRpcCaller, type RuntimeCreateAgentSessionRequest, type RuntimeCreateAgentSessionResult, type RuntimeEnsureAgentSessionRequest, type RuntimeEnsureAgentSessionResult, AGENT_SESSION_MAX_NEW_OPERATION_AGE_MS, AGENT_SESSION_OPERATION_FUTURE_SKEW_MS, parseAgentSessionOperationTimestamp, canonicalizeAgentSessionIdentity, createEphemeralAgentSessionClaimSigner, type AgentSessionClaimSigner, hasCompatibleAgentTitleIdentity, normalizeCompatibleAgentStatusEntryForOwner, normalizeCompatibleAgentTitleForOwner, resolveCompatibleAgentTypeForOwner, resolvePaneAgentOwner, createAgentStatusOscProcessor, type ProcessedAgentStatusChunk, buildOrchestrationTaskDisplayMetadata, assertTerminalDimensions, AGENT_PROMPT_SUBMIT, buildAgentPromptPasteBytes, gitExecFileAsync, gitSpawn, nonInteractiveGitEnv, runWithGitReadCacheInvalidation, cleanupClaimedCloneTarget, claimCloneTarget, deriveValidatedClonePath, getClonePathComparisonKey, getGitCloneFailureMessage, GIT_FETCH_SKIP_AUTO_MAINTENANCE_CONFIG_ARGS, createHash, randomUUID, homedir, isAbsolute, join, resolve, mkdir, readdir, rm, stat, resolveWorktreeCreateBase, resolveWorktreeAddBaseRef, OrchestrationDb, OrchestrationError, planLegacyWorkerTerminalRecovery, type LegacyWorkerTerminalRecoveryPlan, buildObservedSetupCommand, createSetupCompletionScanner, type RuntimeOrchestrationEnvelope, type TerminalRevealIdentity, type OrchestrationCompatibilityEvidence, type OrchestrationCompatibilityHostStamp, isOrchestrationMutation, orchestrationMigrationData, type OrchestrationEnvironmentTransport, type OrchestrationWorkerServer, syncFederatedDispatch, formatMessagesForInjection, selectExactWorkerProviderSession, type Automation, type AutomationRun, type AutomationWorkspaceProvenance, type CliWorkspaceProvenance, type BaseRefSearchResult, type CreateWorktreeResult, type DetectedWorktree, type DetectedWorktreeListResult, type ForceDeleteWorktreeBranchResult, type GitHubPrStartPoint, type GitPushTarget, type GitWorktreeInfo, type GitHubOwnerRepo, type GlobalSettings, type PersistedUIState, type Project, type ProjectUpdateArgs, type ProjectHostSetup, type ProjectHostSetupCloneArgs, type ProjectHostSetupCreateArgs, type ProjectHostSetupCreateResult, type ProjectHostSetupDeleteArgs, type ProjectHostSetupDeleteResult, type ProjectHostSetupExistingFolderArgs, type ProjectHostSetupResult, type ProjectHostSetupUpdateArgs, type ProjectHostSetupUpdateResult, type Repo, type RemoveWorktreeResult, type StatsSummary, type Worktree, type WorktreeLineage, type WorkspaceLineage, type WorkspaceKey, type WorktreeLineageWarning, type WorktreeMeta, type WorktreeBaseStatusEvent, type WorktreeRemoteBranchConflictEvent, type WorktreeStartupLaunch, type LinearIssueUpdate, type LinearProjectSummary, type NestedRepoScanResult, type ProjectGroup, type FolderWorkspace, type ProjectGroupImportMode, type ProjectGroupImportResult, type MemorySnapshot, type Tab, type TabGroupLayoutNode, type TerminalQuickCommand, type TerminalLayoutSnapshot, type TerminalPaneLayoutNode, type TerminalTab, type TuiAgent, type WorkspaceCreateTelemetrySource, type WorkspaceSessionState, type WorkspaceLinkedItem, type DirEntry, type FilesystemPathFlavor, type GitLabIssueUpdate, type GitLabMRInlineCommentInput, type GitLabProjectRef, type GitLabWorkItem, type MRListState, type ClaudeRateLimitAccountsState, type CodexRateLimitAccountsState, type TaskSourceContext, assertWorktreeUnlockedForRemoval, LOCAL_EXECUTION_HOST_ID, getRepoExecutionHostId, getWorktreeExecutionHostId, parseExecutionHostId, toSshExecutionHostId, type ExecutionHostId, getRegisteredSshState, type AgentProviderSessionMetadata, type SleepingAgentLaunchConfig, type ExactWorkerProviderSession, type RuntimeClientEvent, toRuntimeActivateWorktreeEvent, navigationTargetsClients, navigationTargetsHost, type RuntimeNavigationTarget, type SshConnectionState, getPublicSshState, closeTerminalTabInWorkspaceSession, type LinearCurrentIssueContextHints, type LinearAttachResult, type LinearCommentAddResult, type LinearCreateResult, type LinearErrorCode, type LinearIssueListFilter, type LinearIssueListResult, type LinearProjectListResult, type LinearIssueSummary, type LinearIssueRequest, type LinearIssueTaskUpdateRequest, type LinearIssueTaskUpdateResult, type LinearMcpIssueListRequest, type LinearMcpIssueListResult, type LinearIssueRelationWriteRequest, type LinearIssueRelationWriteResult, type LinearSaveIssueRequest, type LinearSaveIssueResult, type LinearTeamLabelsResult, type LinearTeamListResult, type LinearTeamMembersResult, type LinearTeamStatesResult, type LinearStatusSetResult, HEADLESS_RUNTIME_WINDOW_ID, type RuntimeDesktopWindowStatus, type RuntimeGraphStatus, type RuntimeRepoSearchRefs, type RuntimeTerminalRead, type RuntimeTerminalRename, type RuntimeTerminalAgentStatus, type RuntimeTerminalSend, type RuntimeTerminalCreate, type RuntimeTerminalPresentation, type RuntimeTerminalSplit, type RuntimeTerminalFocus, type RuntimeTerminalClose, type RuntimeTerminalListResult, type RuntimeTerminalOrphanAdoptionRequest, type RuntimeTerminalOrphanAdoptionResult, type RuntimeWorktreeTerminalSleepResult, type RuntimeTerminalResolvePane, type RuntimeStatus, type RuntimeSyncWindowGraphResult, type RuntimeTerminalWait, type RuntimeTerminalWaitCondition, type RuntimeWorktreePsSummary, type RuntimeWorktreeAgentRow, type RuntimeSpeechModelSummary, type RuntimeSpeechSetupState, type RuntimeTerminalShow, type RuntimeTerminalInspect, type RuntimeTerminalResize, type RuntimeTerminalSummary, type RuntimeTerminalVisualGroupNode, type RuntimeTerminalVisualLayout, type RuntimeTerminalVisualLayoutNode, type RuntimeTerminalVisualPaneNode, type RuntimeTerminalVisualTab, type RuntimeSyncedLeaf, type RuntimeSyncedTab, type RuntimeMarkdownReadTabResult, type RuntimeMarkdownSaveTabResult, type RuntimeMobileSessionCreateTerminalResult, type RuntimeMobileSessionClientTab, type RuntimeMobileSessionTabCloseResult, type RuntimeMobileSessionMarkdownTab, type RuntimeMobileSessionTabMove, type RuntimeMobileSessionTabMoveResult, type RuntimeMobileSessionTabGroup, type RuntimeMobileSessionSnapshotTab, type RuntimeMobileSessionTerminalTab, type RuntimeMobileSessionBrowserTab, type RuntimeMobileSessionTabsRemovedResult, type RuntimeMobileSessionTabsResult, type RuntimeMobileSessionTabsSnapshot, type RuntimeSessionFlushResult, type RuntimeSessionSnapshot, type RuntimeNativeChatLaunchDraftResolution, type RuntimeSessionTabCloseReason, type RuntimeBrowserDriverState, type RuntimeTerminalDriverState, type RuntimeSyncWindowGraph, type RuntimeWorktreeListResult, type BrowserTabInfo, type BrowserScreencastResult, LINEAR_SEARCH_MAX_LIMIT, LINEAR_WRITE_BODY_CAP, clampLinearSearchLimit, isLinearUuid, type FeatureInteractionId, type TerminalPaneSplitSource, WORKTREE_ID_SEPARATOR, getRepoIdFromWorktreeId, splitWorktreeId, splitWorktreeIdForFilesystem, getProjectIdForProviderIdentity, getProjectHostSetupForRepo, getProjectHostSetupWorktreeMeta, clampLinearIssueListLimit, isFolderRepo, DEFAULT_WORKSPACE_STATUS_ID, buildSetupRunnerCommand, getSetupRunnerCommandPlatformForPath, createSequencedSetupAgentCommands, SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV, FIRST_PANE_ID, isTerminalLeafId, makePaneKey, parsePaneKey, parseAppSshPtyId, isValidHostTerminalTabId, isValidTerminalTabId, type TerminalQuickCommandMutation, isPtyIncarnationId, type PtyIncarnationId, buildAgentDraftLaunchPlan, buildAgentResumeStartupPlan, buildAgentStartupPlan, repoIsRemote, isAgentForegroundWrapperProcess, isExpectedAgentProcess, recognizeAgentProcess, isTuiAgentEnabled, pickTuiAgent, resolveTuiAgentLaunchArgs, resolveTuiAgentLaunchEnv, resolveLocalWindowsAgentStartupShell, isTuiAgent, TUI_AGENT_CONFIG, createDraftPasteReadyScanner, detectInstalledAgentsWithShellPathHydration, detectRemoteAgents, markCodexProjectTrusted, markCopilotFolderTrusted, markCursorWorkspaceTrusted, markRemoteAgentWorkspaceTrusted, applyAgentStatusHooksEnabled, recordManagedHookInstallFailure, isWindowsAbsolutePathLike, isPathInsideOrEqual, normalizeRuntimePathForComparison, resolveTerminalStartupCwd, isWslUncPath, parseWslUncPath, folderWorkspaceKey, isWorkspaceKey, parseWorkspaceKey, worktreeWorkspaceKey, projectResolvedWorktreeLineage, sharesResolvedWorktreeLineageBoundary, folderWorkspaceToWorktree, type FolderWorkspacePathStatus, type FolderWorkspacePathStatusRequest, applyMetadataFallbackVisibility, buildKnownOrcaWorkspaceLayouts, isLegacyRepoForExternalWorktreeVisibility, toDetectedWorktree, createAgentScratchWorktreePathMatcher, type AgentScratchWorktreePathMatcher, BROWSER_HEADLESS_RUNTIME_CAPABILITY, BROWSER_CERTIFICATE_TRUST_RUNTIME_CAPABILITY, MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION, ORCHESTRATION_CONTRACT_RUNTIME_CAPABILITY, ORCHESTRATION_CONTRACT_VERSION, REMOTE_RUNTIME_SHARED_CONTROL_CAPABILITY, RUNTIME_CAPABILITIES, RUNTIME_PROTOCOL_VERSION, TERMINAL_PAIRED_PARKING_RUNTIME_CAPABILITY, type RuntimeCapability, configureAiVaultSessionSources, listAiVaultSessions, type AiVaultListArgs, type AiVaultListResult, type AiVaultPrepareSessionResumeArgs, type AiVaultPrepareSessionResumeResult, type WorkspacePortKillRequest, type WorkspacePortKillResult, type WorkspacePortProbe, type WorkspacePortScanResult, filterWorkspacePortProbes, killWorkspacePort, scanWorkspacePortProbes, advertisedUrlWatcher, type AutomationService, RuntimeBrowserCommands, RemoteRuntimeTerminalCreateIdempotency, deriveRemoteRuntimeTerminalCreateHandle, buildHeadlessTerminalSplitLayout, countTerminalLayoutLeaves, RECENT_PTY_OUTPUT_LIMIT, TerminalOutputState, type RuntimeTerminalDataMeta, RuntimeGithubProjectCommands, RuntimeJiraCommands, WorktreeResolutionState, RuntimeTerminalInputCommands, RuntimeLinearQueryCommands, RuntimeLinearConnectionCommands, RuntimeReviewQueryCommands, RuntimeReviewMutationCommands, RuntimeRepoWorkItemCommands, RuntimeMessageWaiters, type MessageWaitResult, buildHeadlessTabGroupMove, buildHeadlessTabGroupSplit, hasExactTerminalOrphanGroupLayout, mergeTerminalOrphanGroupLayout, terminalOrphanExecutionOwnersEqual, retireTerminalSurfacesFromSnapshot, type RetiredTerminalSurface, retireTerminalSurfaceFromPersistence, advanceTerminalTopologyRevision, hasHostAuthoritativeTerminalMembership, RuntimeEmulatorCommands, setEmulatorBridge, type EmulatorBridge, RuntimeFileCommands, RuntimeGitCommands, appendRecentPtyPathCandidates, recentTerminalOutputIncludesPath, recentTerminalPathCandidatesIncludePath, detectTerminalWaitBlockedReason, isKnownReadyPromptPreview, buildPreview, buildTerminalWaitText, computeTerminalTailWaitState, MAX_TAIL_CHARS, tailGainedNewerBlockedReason, type TerminalTailWaitState, appendNormalizedToTailBuffer, type RetainedTailRedrawCursor, appendCompletedTerminalTranscript, tailStateMatches, normalizeTerminalChunk, DEFAULT_TERMINAL_READ_LIMIT, readTerminalTail, terminalReadLimit, shouldFallbackToVisibleTerminalSnapshot, visibleNonBlankTerminalLines, buildVisibleSnapshotReadFallback, MOBILE_AUTO_RESTORE_FIT_MAX_MS, MOBILE_AUTO_RESTORE_FIT_MIN_MS, TUI_IDLE_DEFAULT_TIMEOUT_MS, TUI_IDLE_POLL_INTERVAL_MS, TUI_IDLE_QUIESCENCE_MS, assertTerminalInputWithinLimitWithYield, buildSendPayload, buildPtyTerminalWaitResult, buildPtyTerminalWaitBlockedResult, buildTerminalWaitResult, buildTerminalWaitBlockedResult, detectExplicitIdleStatusFromTitle, getTerminalState, activateClientSessionTabSelection, ClientSessionTabSelectionStore, deriveClientSessionTabSelection, projectClientSessionTabSelection, type PtyProviderBufferSnapshot, type IPtyProvider, type PtyProcessInfo, type PtyTransientFact, ClaudeAgentTeamsService, type AgentTeamsTmuxCompatRequest, type AgentTeamsTmuxCompatResponse, buildClaudeAgentTeamsLaunchPlan, ensureClaudeAgentTeamsShimDir, resolveClaudeAgentTeamsShimBin, addClaudeTeammateModeAuto, addClaudeTeammateModeInProcess, collectMemorySnapshot, app, BrowserWindow, ipcMain, Notification, type AgentBrowserBridge, type BrowserBackend, BrowserError, getRepoSlug, getRepoUpstream, type getPRForBranch, resolveGitHubPrStartPoint, fetchGitHubPullRequestHeadRef, fetchPrHeadTrackingRef, gitlabMergeRequestHeadLocalRef, reviewHeadRemoteRefComponent, fetchGitLabMergeRequestHeadRef, isTransientReviewHeadFetchError, resolveGitHubReviewHeadRemote, fetchCompareBaseRefWithLocalFallback, pickPreferredGitRemote, closeGitLabMR, createGitLabIssue, diagnoseGitLabAuthClient, getGitLabJobTrace, getGitLabProjectRefForRemote, getGitLabRateLimit, getGitLabWorkItemByProjectRef, addGitLabIssueComment, addGitLabMRInlineComment, addGitLabMRComment, listGitLabTodos, listGitLabIssues, listGitLabLabels, listGitLabMergeRequests, listGitLabWorkItems, mergeGitLabMR, reopenGitLabMR, resolveGitLabMRDiscussion, retryGitLabJob, updateGitLabMR, updateGitLabMRReviewers, updateGitLabIssue, getGlabKnownHosts, getGitLabWorkItemDetails, normalizeGitLabIssueListArgs, normalizeGitLabMRListState, normalizeGitLabPositiveInteger, type GitLabIssueListState, recordGitLabProjectRecent, type CreateHostedReviewInput, type CreateHostedReviewResult, type HostedReviewCreationEligibility, type HostedReviewCreationEligibilityArgs, type HostedReviewInfo, getHostedReviewForBranchFromRepo, createHostedReviewFromRepo, getHostedReviewCreationEligibilityFromRepo, getLocalProjectGitExecOptions, getLocalProjectWorktreeGitOptions, getLocalProjectWorktreeGitOptionsForRuntime, resolveLocalProjectRuntimeForRepo, resolveLocalProjectRuntimesForRepos, resolveLocalProjectRuntimeForWorktreeId, type ProjectExecutionRuntimeResolution, resolveTerminalOrchestrationCliCommand, getLocalWorktreePathAccess, removeLocalWorktreePath, toLocalWorktreeRuntimePath, removeStaleLocalWorktreeRegistrationAfterFilesystemRemoval, recoverLocalWindowsWorktreeRemoval, getLinearStatus, isLinearAuthError, addLinearIssueCommentForAgent, createLinearIssueAttachment, createLinearIssueForAgent, getLinearAttachmentByUuidForAgent, getLinearCommentByUuidForAgent, getLinearIssueByUuidForAgent, getLinearIssueCommentThreadRoot, listLinearIssues, updateLinearIssueForAgent, LinearWriteFailure, LinearAgentAccessError, getLinearCurrentIssueFromWorktree, readLinearIssueContext, resolveLegacyLinearLinkWorkspace, classifyLinearError, linearError, linearMessage, sanitizeLinearErrorMessage, listMcpIssues, writeIssueRelation, getLinearProject, listLinearProjectsByExactName, listLinearProjectTeams, listLinearProjects, getLinearTeamLabelsOrThrow, getLinearTeamMembersOrThrow, getLinearTeamStatesOrThrow, getLinearViewerForWorkspaceOrThrow, listLinearTeamsForAgent, listLinearTeamsOrThrow, getBaseRefDefault, getDefaultRemote, getBranchConflictKind, isGitRepo, getRepoName, searchBaseRefDetails, getRemoteCount, normalizeRefSearchQuery, parseAndFilterSearchRefDetails, parseRemoteCount, resolveDefaultBaseRefViaExec, resolveDefaultBaseRefWithLocalGit, buildSearchBaseRefsArgv, isForEachRefExcludeUnsupportedError, mergeBaseRefSearchResultGroups, getRemoteDrift, getRecentDriftSubjects, hasCommitObjectViaGitExec, hasWorktreeBaseCommitRef, resolveLocalGitUsername, getSshGitCapabilityCache, listWorktrees, listWorktreesStrict, addWorktree, addSparseWorktree, assertWorktreeCleanForRemoval, forceDeleteLocalBranch, removeWorktree, type AddWorktreeOptions, type AddWorktreeResult, isENOENT, invalidateAuthorizedRootsCache, createSetupRunnerScript, getDefaultTabsLaunch, getEffectiveHooks, loadHooks, runHook, shouldRunSetupForCreate, DEFAULT_REPO_BADGE_COLOR, FLOATING_TERMINAL_WORKTREE_ID, getDefaultVoiceSettings, listRepoWorktrees, createWorktreeCopiedPaths, createWorktreeLinkedPaths, createWorktreeSharedPaths, findExistingWorktreeSymlinkPaths, removeWorktreeLinkedPaths, formatWorktreeIncludeCopyWarning, resolveWorktreeIncludePaths, getWorktreeSharedLinkPaths, resolveWorktreeSharedDirectories, deleteWorktreeHistoryDir, cleanupUnusedWorktreePushTargetRemote, cleanupUnusedWorktreePushTargetRemoteSsh, createRemoteWorktree, configureCreatedWorktreePushTarget, prepareWorktreePushTarget, getBranchNameOverrideCandidate, getWorktreeCreateCandidate, WORKTREE_CREATE_MAX_SUFFIX_ATTEMPTS, normalizeSparseDirectories, type Store, type StatsCollector, AgentDetector, computeWorktreePath, computeWorkspaceRoot, ensurePathWithinWorkspace, formatWorktreeRemovalError, getWorktreeCreationLayout, getWorktreePathSettings, isOrphanCompatiblePreflightError, isOrphanedWorktreeError, mergeWorktree, sanitizeWorktreeName, shouldSetDisplayName, areWorktreePathsEqual, findCreatedWorktree, assertWorktreeDoesNotContainRegisteredWorktree, canCleanupUnregisteredOrcaLeftoverDirectory, canCleanupUnregisteredOrcaWorktreeDirectory, canSafelyRemoveOrphanedWorktreeDirectory, findRegisteredDeletableWorktree, isDangerousWorktreeRemovalPath, ORPHANED_WORKTREE_DIRECTORY_MESSAGE, stripOrcaProvenanceMetaUpdates, UNREGISTERED_MISSING_WORKTREE_MESSAGE, prefetchWorktreeCreateBase, prepareLocalWorktreeRootForRepo, closeLocalWatcherForWorktreePath, closeRemoteWatcherForWorktreePath, forgetLocalWatcherRemovalSnapshot, forgetRemoteWatcherRemovalSnapshot, restoreLocalWatcherAfterFailedRemoval, restoreRemoteWatcherAfterFailedRemoval, acquireWatcherRemovalGate, createWatcherRemovalDeadline, drainBeforeWatcherRemoval, type WatcherRemovalDeadline, withWorktreeSpan, HeadlessEmulator, isNativeWindowsConptyPty, registerConptyDa1OverrideInstaller, shouldModelAnswerHiddenPtyQueries, getTerminalViewAttributes, getTerminalViewColorQueryReplyColors, registerTerminalViewAttributesApplier, killAllProcessesForWorktree, teardownRpcDeadline, stopMissingWorktreeTerminals, type ReplayableMobileNotification, RuntimeNotificationRegistry, MOBILE_SUBSCRIBE_SCROLLBACK_ROWS, createMobileSessionTabsNotifyCoalescer, type MobileSessionTabsNotifyCoalescer, getSshFilesystemProvider, assertFolderWorkspacePathUsable, getFolderWorkspacePathStatus, getFolderWorkspacePathStatusForPath, inferFolderWorkspacePathConnection, getSshGitProvider, getSshGitProviderGeneration, requireSshGitProvider, detectRepoIconAndUpstream, enrichMissingRepoGitRemoteIdentities, githubAvatarIcon, type ClaudeAccountService, type CodexAccountService, type CodexResetCreditRejectedBeforeProviderReason, type CodexAccountSelectionTarget, type RateLimitService, type CodexRateLimitResetOutcome, type RateLimitState, type CodexResetCreditExpectedScope, type VoiceSettings, getSpeechModelManager, getSpeechSttService, getCatalogModel, isLocalSpeechModel, SPEECH_MODEL_CATALOG, deleteLocalSpeechModel, getSpeechModelDeletionErrorCode, type CommitMessageAgentEnvironmentResolvers, scanNestedRepos, createNestedProjectGroupResolver, resolveNestedRepoSelection, createNestedRepoImportTargetResolver, RuntimeClientSettingsCommands, type RuntimeClientSettings, RuntimeAutomationCommands, type RuntimeAutomationCreateInput, type RuntimeAutomationUpdateInput, PtyLayoutQueue, type ApplyLayoutResult, type PtyLayoutState, type PtyLayoutTarget, PtyGenerationReferenceCount, RuntimeRepoHookCommands, branchSelectorMatches, buildRuntimeWorktreeSummaryPathIndex, canonicalizeTerminalSessionWorktreeId, classifyAgentTitle, classifyLatestAgentTitle, compareWorktreePs, findResolvedWorktreeIdForPath, findRuntimeWorktreeSummaryByPath, getExplicitWorktreeIdSelector, getLatestAgentCandidateTitle, getLatestAgentCandidateTitleInfo, getLatestLeafTitle, getLatestPtyTitle, getLeafWorktreeStatus, getSavedTabWorktreeStatus, includeTargetResolvedWorktree, indexPersistedPtySurfaceBindings, indexPersistedPtyWorktreeBindings, inferWorktreeIdFromPtyId, mapExplicitAgentStateToRuntimeTerminalStatus, maxTimestamp, mergeWorktreeStatus, notifyRuntimeListeners, parseRuntimeWorktreeId, resolveTerminalSessionWorktreeId, resolveWorktreeScanCacheTtlMs, runtimePathsEqual, runtimeWorktreeIdentityKey, runtimeWorktreeIdsEqual, type RuntimeWorktreeSummaryPathIndex, setBoundedMapEntry, setsEqual, terminalTitleBlocksExplicitAgentStatus, waitForWorktreeTerminalMutation, withTimeout, withTimeoutResult, getRuntimeWorktreeRemovalKey, getRuntimeWorktreeRemovalOptionsKey, isLocalRuntimeGitRepository, isRuntimeWorktreePathMissing, omitUndefinedProperties, parseExactWorktreeIdSelector, type PreservedBranchCleanupTarget, type RuntimeWorktreeRemovalInFlight, type RuntimeWorktreeRemovalTarget, addListenerToMap, canCheckoutExistingLocalBranch, clampTerminalViewport, getLocalGitHubPrForBranch, getSelectedHostedReviewForBranch, getSelectedReviewBranch, hasLocalGitOptions, isAllowedPushTargetRemoteConflict, isMatchingSelectedGitHubPr, resolveCreateBranchName, getRuntimeFolderWorkspaceInstanceId, getRuntimeFolderWorkspaceRootId, listRuntimeFolderWorkspaces, mergeRuntimeFolderWorkspace, copySleepingAgentLaunchConfig, deterministicAgentSessionUuid, inferCapturedClaudeAgentTeamsMode, isAgentSessionOperationOutcomeUnknown, isCursorAgentOrchestrationTarget, mergeTerminalEnvDeletionKeys, normalizeSparsePresetDirectoriesForSave, normalizeSparsePresetName, resolveBareAgentLaunchCommand, FETCH_FRESHNESS_MS, REMOTE_FETCH_TIMEOUT_MS, REMOTE_FETCH_CACHE_MAX, DRIFT_PROBE_SUBJECT_LIMIT, PTY_CONTROLLER_LIST_TIMEOUT_MS, WORKTREE_TERMINAL_SLEEP_TIMEOUT_MS, sanitizeNestedRepoRuntimeImportError, runtimeRepoMatchesExecutionHost, assertProjectHostSetupHostIsSupported, pathExists, resolveServerBrowsePath, type RuntimeAccountServices, type RemoteFetchResult, type RemoteTrackingBase, type AccountsSnapshot, type CodexRateLimitResetRpcResult, type RuntimeStore, type RuntimeLeafRecord, type RuntimePtyWorktreeRecord, type TerminalCreateOptions, AGENT_SESSION_OPERATION_PER_CLIENT_LIMIT, AGENT_SESSION_OPERATION_GLOBAL_LIMIT, SESSION_SNAPSHOT_STABILITY_ATTEMPTS, type PtyForegroundAgentRefresh, type RuntimeTerminalAgentStatusEvent, type RuntimePtyTitleTrackerEntry, type RuntimeAgentRowSnapshot, type AgentSessionCreateOperation, type RuntimeHeadlessTerminal, type RuntimePtyDataAdmission, type RuntimeVisibleTerminalState, type ProviderBufferAcquisition, type RuntimeTerminalBufferSnapshot, type HeadlessSeedMetadata, type RuntimePtyController, type PtyControllerTerminalIdentity, type PtyControllerInventory, type WorktreeStartupDraftPaste, type WorktreeStartupFollowup, getAgentLaunchPlatformForRepo, MOBILE_TERMINAL_CREATE_RESULT_TTL_MS, WORKTREE_CREATE_RESULT_TTL_MS, FOREGROUND_AGENT_WRAPPER_RETRY_INTERVAL_MS, FOREGROUND_AGENT_WRAPPER_RETRY_TIMEOUT_MS, BRACKETED_PASTE_BEGIN, BRACKETED_PASTE_END, BRACKETED_PASTE_QUIET_MS, DRAFT_PASTE_READY_TIMEOUT_MS, MOBILE_TERMINAL_SURFACE_TIMEOUT_MS, MOBILE_TERMINAL_READY_FALLBACK_MS, SSH_PANE_RECOVERY_GRACE_MS, isClientDisconnectedError, createTerminalRevealWarning, ownerSurfacing, resolveTerminalPresentation, type RuntimeNotifier, type TerminalHandleRecord, type OrchestrationCompatibilityTerminalAuthority, type LegacyWorkerTerminalRecoveryResult, type OrchestrationCompatibilityCallerAuthority, type RestoredOrchestrationAuthorityReceipt, type OrchestrationCompatibilitySshAttachmentAuthority, type TerminalWaiter, type ResolvedWorktree, type LinearAgentWriteTarget, type LinearCreateFieldIntent, AGENT_HOOK_RUNTIME_ENV_KEYS, sameStringSet, labelsForIds, type TerminalWorkspaceLaunchScope, type WorktreeLineageInput, type ResolvedWorkspaceParent, type WorktreeLineageResolution, type RuntimeWorktreeScanResult, type WorktreeLineageCandidate, extractOrchestrationTaskId, RuntimeLineageError, WorktreeIdRequiresFullPathError, type ResolvedWorktreeSnapshot, type MobileNotificationDispatchEvent, type RuntimeWorktreeLifecycleEvent, type MobileNotificationDismissEvent, type MobileNotificationEvent, type DriverState, type NativeChatLaunchDraftResolutionTombstone, MAX_NATIVE_CHAT_LAUNCH_DRAFT_RESOLUTION_TOMBSTONES, MAX_DELETED_FOLDER_TERMINAL_RETIREMENT_FENCES, MAX_TERMINAL_SURFACE_RETIREMENT_FENCES, hasLocalWorktreeBaseRef, makePtyDurableRetirementKey } from './orca-runtime-symbols'
import { OrcaRuntimeState } from './orca-runtime-state'

export class OrcaRuntimeGetLocalProviderPart1 extends OrcaRuntimeState {
  getLocalProvider(): IPtyProvider | null {
    return this.getLocalProviderFn ? this.getLocalProviderFn() : null
  }
  protected async stopPtysForDestructiveWorktreeRemoval(
    worktreeId: string,
    connectionId?: string
  ): Promise<void> {
    const provider = connectionId ? this.getSshProviderFn?.(connectionId) : this.getLocalProvider()
    if (!provider) {
      throw new Error(`PTY provider unavailable for worktree deletion: ${worktreeId}`)
    }
    const teardownResult = await killAllProcessesForWorktree(worktreeId, {
      runtime: this,
      localProvider: provider,
      onPtyStopped: this.onPtyStopped ?? undefined,
      requirePhysicalStop: true,
      ...(connectionId ? { includeLocalRegistry: false } : {})
    })
    const total =
      teardownResult.runtimeStopped +
      teardownResult.providerStopped +
      teardownResult.registryStopped
    if (total > 0) {
      console.info(
        `[worktree-teardown] ${worktreeId} killed runtime=${teardownResult.runtimeStopped} provider=${teardownResult.providerStopped} registry=${teardownResult.registryStopped}`
      )
    }
  }
  getStatsSummary(): StatsSummary | null {
    return this.stats?.getSummary() ?? null
  }
  getMemorySnapshot(): Promise<MemorySnapshot> {
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }
    return collectMemorySnapshot(this.store)
  }
  getUIState(): PersistedUIState {
    return this.clientSettingsCommands.getUIState()
  }
  updateUIState(updates: Partial<PersistedUIState>): PersistedUIState {
    return this.clientSettingsCommands.updateUIState(updates)
  }
  recordFeatureInteraction(id: FeatureInteractionId): PersistedUIState {
    return this.clientSettingsCommands.recordFeatureInteraction(id)
  }
  getClientSettings(): RuntimeClientSettings {
    return this.clientSettingsCommands.getClientSettings()
  }
  protected reconcileManagedAgentHooks(): Promise<void> {
    const generation = ++this.managedHookReconciliationGeneration
    const reconciliation = this.managedHookReconciliationTail.then(async () => {
      if (generation !== this.managedHookReconciliationGeneration) {
        return
      }
      const settings = this.store?.getSettings()
      if (!settings) {
        return
      }
      await applyAgentStatusHooksEnabled(settings.agentStatusHooksEnabled !== false, settings, {
        shouldHydrateShellPath: app.isPackaged && process.platform !== 'win32',
        onInstallError: recordManagedHookInstallFailure,
        shouldContinue: (agent) => {
          const current = this.store?.getSettings()
          return (
            current !== undefined &&
            current.agentStatusHooksEnabled !== false &&
            !current.disabledTuiAgents?.includes(agent)
          )
        }
      })
    })
    this.managedHookReconciliationTail = reconciliation.catch(() => {})
    return reconciliation
  }
  async updateClientSettings(
    updates: Pick<
      Partial<GlobalSettings>,
      | 'agentStatusHooksEnabled'
      | 'defaultTuiAgent'
      | 'disabledTuiAgents'
      | 'agentDefaultArgs'
      | 'agentDefaultEnv'
      | 'defaultTaskSource'
      | 'defaultTaskViewPreset'
      | 'visibleTaskProviders'
      | 'defaultRepoSelection'
      | 'defaultLinearTeamSelection'
      | 'githubProjects'
      | 'experimentalNewWorktreeCardStyle'
      | 'compactWorktreeCards'
      | 'minimaxGroupId'
      | 'minimaxUsageModels'
      | 'prBotAuthorOverrides'
    >
  ): Promise<
    Pick<
      GlobalSettings,
      | 'defaultTuiAgent'
      | 'disabledTuiAgents'
      | 'agentCmdOverrides'
      | 'agentDefaultArgs'
      | 'agentDefaultEnv'
      | 'agentStatusHooksEnabled'
      | 'defaultTaskSource'
      | 'defaultTaskViewPreset'
      | 'visibleTaskProviders'
      | 'defaultRepoSelection'
      | 'defaultLinearTeamSelection'
      | 'githubProjects'
      | 'experimentalNewWorktreeCardStyle'
      | 'compactWorktreeCards'
      | 'minimaxGroupId'
      | 'minimaxUsageModels'
      | 'prBotAuthorOverrides'
    >
  > {
    return this.clientSettingsCommands.updateClientSettings(updates)
  }
  getClientTerminalQuickCommands(): TerminalQuickCommand[] {
    return this.clientSettingsCommands.getClientTerminalQuickCommands()
  }
  updateClientTerminalQuickCommands(
    mutation: TerminalQuickCommandMutation
  ): TerminalQuickCommand[] {
    return this.clientSettingsCommands.updateClientTerminalQuickCommands(mutation)
  }
  updateClientPRBotAuthorOverride(args: { author: string; isBot: boolean }) {
    return this.clientSettingsCommands.updateClientPRBotAuthorOverride(args)
  }
  listAutomations(): Automation[] {
    return this.automationCommands.listAutomations()
  }
  listAutomationRuns(automationId?: string): AutomationRun[] {
    return this.automationCommands.listAutomationRuns(automationId)
  }
  showAutomation(id: string): Automation {
    return this.automationCommands.showAutomation(id)
  }
  async createAutomation(input: RuntimeAutomationCreateInput): Promise<Automation> {
    return this.automationCommands.createAutomation(input)
  }
  async updateAutomation(id: string, updates: RuntimeAutomationUpdateInput): Promise<Automation> {
    return this.automationCommands.updateAutomation(id, updates)
  }
  deleteAutomation(id: string): { removed: boolean; id: string } {
    return this.automationCommands.deleteAutomation(id)
  }
  async runAutomationNow(id: string): Promise<AutomationRun> {
    return this.automationCommands.runAutomationNow(id)
  }

  // Why: lazy initialization — the DB path depends on Electron's userData
  // which may not be finalized until after app.ready. Also allows unit tests
  // to inject an in-memory DB without touching the filesystem.
  getOrchestrationDb(): OrchestrationDb {
    if (!this._orchestrationDb) {
      const { app } = require('electron')
      const dbPath = join(app.getPath('userData'), 'orchestration.db')
      this._orchestrationDb = new OrchestrationDb(dbPath)
    }
    return this._orchestrationDb
  }
  setOrchestrationDb(db: OrchestrationDb): void {
    this._orchestrationDb = db
  }
  protected getLegacyWorkerTerminalRecoveryPlan(): LegacyWorkerTerminalRecoveryPlan {
    try {
      return planLegacyWorkerTerminalRecovery(
        this.getOrchestrationDb().listLegacyWorkerTerminalRecoveryRows()
      )
    } catch (error) {
      console.warn('[orchestration] failed to plan legacy worker terminal recovery', error)
      return { blockedPanes: [], candidates: [], ambiguousDispatchIds: [] }
    }
  }
  prepareLegacyWorkerTerminalRecovery(): LegacyWorkerTerminalRecoveryPlan {
    const plan = this.getLegacyWorkerTerminalRecoveryPlan()
    const store = this.store
    if (!store?.getWorkspaceSession || !store.setWorkspaceSession || !store.flushOrThrow) {
      return plan
    }
    const sessions = new Map<
      ExecutionHostId,
      { current: WorkspaceSessionState; next: WorkspaceSessionState }
    >()
    const changedHostIds = new Set<ExecutionHostId>()
    for (const blocked of plan.blockedPanes) {
      let hostIds: ExecutionHostId[]
      try {
        hostIds = [this.getWorkspaceSessionHostIdForWorktree(blocked.worktreeId)]
      } catch (error) {
        console.warn('[orchestration] legacy worker resume fence owner is unavailable', {
          worktreeId: blocked.worktreeId,
          error
        })
        hostIds = store.getWorkspaceSessionHostIds?.() ?? [LOCAL_EXECUTION_HOST_ID]
      }
      for (const hostId of hostIds) {
        let state = sessions.get(hostId)
        if (!state) {
          const current = store.getWorkspaceSession(hostId)
          if (!current) {
            continue
          }
          state = { current, next: structuredClone(current) }
          sessions.set(hostId, state)
        }
        const record = state.next.sleepingAgentSessionsByPaneKey?.[blocked.paneKey]
        if (
          !record ||
          !runtimeWorktreeIdsEqual(record.worktreeId, blocked.worktreeId) ||
          record.automaticResumeBlockedBy === 'legacy-orchestration-worker'
        ) {
          continue
        }
        state.next.sleepingAgentSessionsByPaneKey = {
          ...state.next.sleepingAgentSessionsByPaneKey,
          [blocked.paneKey]: {
            ...record,
            automaticResumeBlockedBy: 'legacy-orchestration-worker'
          }
        }
        changedHostIds.add(hostId)
      }
    }
    const changed = [...sessions].filter(([hostId]) => changedHostIds.has(hostId))
    if (changed.length === 0) {
      return plan
    }
    try {
      for (const [hostId, state] of changed) {
        store.setWorkspaceSession(state.next, hostId)
      }
      store.flushOrThrow()
    } catch (error) {
      console.warn('[orchestration] failed to persist legacy worker resume fence', error)
    }
    return plan
  }
  async reconcileLegacyWorkerTerminals(
    options: { connectionId?: string; materializeRenderer?: boolean } = {}
  ): Promise<LegacyWorkerTerminalRecoveryResult> {
    let resolveResult!: (result: LegacyWorkerTerminalRecoveryResult) => void
    let rejectResult!: (error: unknown) => void
    const result = new Promise<LegacyWorkerTerminalRecoveryResult>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })
    const run = this.legacyWorkerTerminalRecoveryQueue.then(async () => {
      try {
        resolveResult(await this.reconcileLegacyWorkerTerminalsNow(options))
      } catch (error) {
        rejectResult(error)
      }
    })
    this.legacyWorkerTerminalRecoveryQueue = run.catch(() => undefined)
    return result
  }
  async refreshRestoredOrchestrationAuthority(connectionId: string | null = null): Promise<void> {
    if (connectionId === null && !this.canRecoverPersistentLocalPtysFn()) {
      return
    }
    const inventory = await this.refreshPtyWorktreeRecordsWithControllerInventory(
      [...(await this.getResolvedWorktreeMap()).values()],
      null,
      undefined,
      connectionId
    )
    if (!inventory) {
      throw new Error('terminal_liveness_unavailable')
    }
  }
  protected hasExactTerminalSurfaceIdentity(expected: {
    worktreeId: string
    tabId: string
    leafId: string
    ptyId: string
    terminalHandle: string
    incarnationId: string
  }): boolean {

    if (this.graphStatus !== 'ready') {
      return false
    }
    const pty = this.ptysById.get(expected.ptyId)
    if (
      !pty?.connected ||
      pty.incarnationId !== expected.incarnationId ||
      pty.tabId !== expected.tabId ||
      pty.paneKey !== makePaneKey(expected.tabId, expected.leafId) ||
      !runtimeWorktreeIdsEqual(pty.worktreeId, expected.worktreeId) ||
      this.handleByPtyId.get(expected.ptyId) !== expected.terminalHandle
    ) {
      return false
    }
    const tab = this.tabs.get(expected.tabId)
    const leaf = this.leaves.get(this.getLeafKey(expected.tabId, expected.leafId))
    const ptyLeaves = this.getLeavesForPty(expected.ptyId)
    return (
      Boolean(tab && runtimeWorktreeIdsEqual(tab.worktreeId, expected.worktreeId)) &&
      Boolean(
        leaf &&
        leaf.ptyId === expected.ptyId &&
        runtimeWorktreeIdsEqual(leaf.worktreeId, expected.worktreeId)
      ) &&
      ptyLeaves.length === 1 &&
      ptyLeaves[0]?.tabId === expected.tabId &&
      ptyLeaves[0]?.leafId === expected.leafId
    )
  }
  protected hasExactPersistedTerminalSurfaceIdentity(expected: {
    worktreeId: string
    tabId: string
    leafId: string
    ptyId: string
    incarnationId: string
  }): boolean {
    const session = this.getWorkspaceSessionForWorktree(expected.worktreeId)
    const sessionWorktreeId = session
      ? resolveTerminalSessionWorktreeId(session, expected.worktreeId)
      : null
    if (!session || !sessionWorktreeId) {
      return false
    }
    const tab = session.tabsByWorktree[sessionWorktreeId]?.find(
      (candidate) => candidate.id === expected.tabId
    )
    const paneKey = makePaneKey(expected.tabId, expected.leafId)
    return Boolean(
      tab &&
      session.terminalLayoutsByTabId[expected.tabId]?.ptyIdsByLeafId?.[expected.leafId] ===
        expected.ptyId &&
      session.terminalPtyIncarnationsByPaneKey?.[paneKey] === expected.incarnationId
    )
  }
  protected persistLegacyWorkerTerminalRecoveryResolution(
    candidate: LegacyWorkerTerminalRecoveryPlan['candidates'][number],
    resolution: 'adopted' | 'exited'
  ): boolean {
    const store = this.store
    const session = this.getWorkspaceSessionForWorktree(candidate.worktreeId)
    if (!store?.setWorkspaceSession || !store.flushOrThrow || !session) {
      return false
    }
    const record = session.sleepingAgentSessionsByPaneKey?.[candidate.paneKey]
    if (!record || !runtimeWorktreeIdsEqual(record.worktreeId, candidate.worktreeId)) {
      return true
    }
    const next = structuredClone(session)
    delete next.sleepingAgentSessionsByPaneKey?.[candidate.paneKey]
    try {
      this.setWorkspaceSessionForWorktree(candidate.worktreeId, next)
      store.flushOrThrow()
      return true
    } catch (error) {
      this.setWorkspaceSessionForWorktree(candidate.worktreeId, session)
      console.warn('[orchestration] failed to persist legacy worker recovery resolution', {
        dispatchId: candidate.dispatchId,
        resolution,
        error
      })
      return false
    }
  }
  protected reconcileMissingLegacyWorkerTerminal(
    candidate: LegacyWorkerTerminalRecoveryPlan['candidates'][number]
  ): boolean {
    if (candidate.dispatchStatus !== 'pending' && candidate.dispatchStatus !== 'dispatched') {
      return true
    }
    try {
      this.getOrchestrationDb().reconcileMissingWorkerTerminal(
        candidate.dispatchId,
        'The assigned worker terminal is no longer live after orchestration recovery.'
      )
      return true
    } catch (error) {
      console.warn('[orchestration] failed to reconcile missing worker terminal', {
        dispatchId: candidate.dispatchId,
        error
      })
      return false
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
