import { detectAgentStatusFromTitle, isClaudeManagementTitle, isCursorNativeAgentTitle, isShellProcess, normalizeTerminalTitle, extractOscTitleScanTail, normalizeFolderWorkspaceOperationId, isServerDriveListRequest, listWindowsDrives, extractLastOsc7Uri, extractOscScanTail, parseFileUriPathParts, type AgentStatus, type TerminalOscLinkRange, type TerminalOscColorQueryReplyColors, type TerminalOutputSourceRange, type RemoteTerminalSourceRangeConsumerHooks, type RemoteTerminalSourceRangeReplacementPublication, type RemoteTerminalSourceRangeReplacementReservation, type RemoteTerminalSourceRangeStreamIdentity, createTerminalTitleTracker, stripBrailleSpinnerGlyphs, type TerminalTitleTracker, createCommandCodeOutputStatusDetector, type TerminalSideEffectBatch, type TerminalSideEffectFact, type TerminalGitHubPRLink, TerminalKittyKeyboardModeTracker, AGENT_STATUS_STALE_AFTER_MS, isFreshNonDoneAgentStatus, type AgentStatusIpcPayload, type ParsedAgentStatusPayload, type AgentStatusOrchestrationContext, type AgentStatusEntry, indexAgentStatusRowsByPaneKey, type AgentHookAuthorityAttestation, type AgentSessionClaimedSpawnResult, type AgentSessionExecutionClaim, type AgentSessionSurfaceBinding, type AgentLaunchPreferences, type RuntimeAgentSessionRpcCaller, type RuntimeCreateAgentSessionRequest, type RuntimeCreateAgentSessionResult, type RuntimeEnsureAgentSessionRequest, type RuntimeEnsureAgentSessionResult, AGENT_SESSION_MAX_NEW_OPERATION_AGE_MS, AGENT_SESSION_OPERATION_FUTURE_SKEW_MS, parseAgentSessionOperationTimestamp, canonicalizeAgentSessionIdentity, createEphemeralAgentSessionClaimSigner, type AgentSessionClaimSigner, hasCompatibleAgentTitleIdentity, normalizeCompatibleAgentStatusEntryForOwner, normalizeCompatibleAgentTitleForOwner, resolveCompatibleAgentTypeForOwner, resolvePaneAgentOwner, createAgentStatusOscProcessor, type ProcessedAgentStatusChunk, buildOrchestrationTaskDisplayMetadata, assertTerminalDimensions, AGENT_PROMPT_SUBMIT, buildAgentPromptPasteBytes, gitExecFileAsync, gitSpawn, nonInteractiveGitEnv, runWithGitReadCacheInvalidation, cleanupClaimedCloneTarget, claimCloneTarget, deriveValidatedClonePath, getClonePathComparisonKey, getGitCloneFailureMessage, GIT_FETCH_SKIP_AUTO_MAINTENANCE_CONFIG_ARGS, createHash, randomUUID, homedir, isAbsolute, join, resolve, mkdir, readdir, rm, stat, resolveWorktreeCreateBase, resolveWorktreeAddBaseRef, OrchestrationDb, OrchestrationError, planLegacyWorkerTerminalRecovery, type LegacyWorkerTerminalRecoveryPlan, buildObservedSetupCommand, createSetupCompletionScanner, type RuntimeOrchestrationEnvelope, type TerminalRevealIdentity, type OrchestrationCompatibilityEvidence, type OrchestrationCompatibilityHostStamp, isOrchestrationMutation, orchestrationMigrationData, type OrchestrationEnvironmentTransport, type OrchestrationWorkerServer, syncFederatedDispatch, formatMessagesForInjection, selectExactWorkerProviderSession, type Automation, type AutomationRun, type AutomationWorkspaceProvenance, type CliWorkspaceProvenance, type BaseRefSearchResult, type CreateWorktreeResult, type DetectedWorktree, type DetectedWorktreeListResult, type ForceDeleteWorktreeBranchResult, type GitHubPrStartPoint, type GitPushTarget, type GitWorktreeInfo, type GitHubOwnerRepo, type GlobalSettings, type PersistedUIState, type Project, type ProjectUpdateArgs, type ProjectHostSetup, type ProjectHostSetupCloneArgs, type ProjectHostSetupCreateArgs, type ProjectHostSetupCreateResult, type ProjectHostSetupDeleteArgs, type ProjectHostSetupDeleteResult, type ProjectHostSetupExistingFolderArgs, type ProjectHostSetupResult, type ProjectHostSetupUpdateArgs, type ProjectHostSetupUpdateResult, type Repo, type RemoveWorktreeResult, type StatsSummary, type Worktree, type WorktreeLineage, type WorkspaceLineage, type WorkspaceKey, type WorktreeLineageWarning, type WorktreeMeta, type WorktreeBaseStatusEvent, type WorktreeRemoteBranchConflictEvent, type WorktreeStartupLaunch, type LinearIssueUpdate, type LinearProjectSummary, type NestedRepoScanResult, type ProjectGroup, type FolderWorkspace, type ProjectGroupImportMode, type ProjectGroupImportResult, type MemorySnapshot, type Tab, type TabGroupLayoutNode, type TerminalQuickCommand, type TerminalLayoutSnapshot, type TerminalPaneLayoutNode, type TerminalTab, type TuiAgent, type WorkspaceCreateTelemetrySource, type WorkspaceSessionState, type WorkspaceLinkedItem, type DirEntry, type FilesystemPathFlavor, type GitLabIssueUpdate, type GitLabMRInlineCommentInput, type GitLabProjectRef, type GitLabWorkItem, type MRListState, type ClaudeRateLimitAccountsState, type CodexRateLimitAccountsState, type TaskSourceContext, assertWorktreeUnlockedForRemoval, LOCAL_EXECUTION_HOST_ID, getRepoExecutionHostId, getWorktreeExecutionHostId, parseExecutionHostId, toSshExecutionHostId, type ExecutionHostId, getRegisteredSshState, type AgentProviderSessionMetadata, type SleepingAgentLaunchConfig, type ExactWorkerProviderSession, type RuntimeClientEvent, toRuntimeActivateWorktreeEvent, navigationTargetsClients, navigationTargetsHost, type RuntimeNavigationTarget, type SshConnectionState, getPublicSshState, closeTerminalTabInWorkspaceSession, type LinearCurrentIssueContextHints, type LinearAttachResult, type LinearCommentAddResult, type LinearCreateResult, type LinearErrorCode, type LinearIssueListFilter, type LinearIssueListResult, type LinearProjectListResult, type LinearIssueSummary, type LinearIssueRequest, type LinearIssueTaskUpdateRequest, type LinearIssueTaskUpdateResult, type LinearMcpIssueListRequest, type LinearMcpIssueListResult, type LinearIssueRelationWriteRequest, type LinearIssueRelationWriteResult, type LinearSaveIssueRequest, type LinearSaveIssueResult, type LinearTeamLabelsResult, type LinearTeamListResult, type LinearTeamMembersResult, type LinearTeamStatesResult, type LinearStatusSetResult, HEADLESS_RUNTIME_WINDOW_ID, type RuntimeDesktopWindowStatus, type RuntimeGraphStatus, type RuntimeRepoSearchRefs, type RuntimeTerminalRead, type RuntimeTerminalRename, type RuntimeTerminalAgentStatus, type RuntimeTerminalSend, type RuntimeTerminalCreate, type RuntimeTerminalPresentation, type RuntimeTerminalSplit, type RuntimeTerminalFocus, type RuntimeTerminalClose, type RuntimeTerminalListResult, type RuntimeTerminalOrphanAdoptionRequest, type RuntimeTerminalOrphanAdoptionResult, type RuntimeWorktreeTerminalSleepResult, type RuntimeTerminalResolvePane, type RuntimeStatus, type RuntimeSyncWindowGraphResult, type RuntimeTerminalWait, type RuntimeTerminalWaitCondition, type RuntimeWorktreePsSummary, type RuntimeWorktreeAgentRow, type RuntimeSpeechModelSummary, type RuntimeSpeechSetupState, type RuntimeTerminalShow, type RuntimeTerminalInspect, type RuntimeTerminalResize, type RuntimeTerminalSummary, type RuntimeTerminalVisualGroupNode, type RuntimeTerminalVisualLayout, type RuntimeTerminalVisualLayoutNode, type RuntimeTerminalVisualPaneNode, type RuntimeTerminalVisualTab, type RuntimeSyncedLeaf, type RuntimeSyncedTab, type RuntimeMarkdownReadTabResult, type RuntimeMarkdownSaveTabResult, type RuntimeMobileSessionCreateTerminalResult, type RuntimeMobileSessionClientTab, type RuntimeMobileSessionTabCloseResult, type RuntimeMobileSessionMarkdownTab, type RuntimeMobileSessionTabMove, type RuntimeMobileSessionTabMoveResult, type RuntimeMobileSessionTabGroup, type RuntimeMobileSessionSnapshotTab, type RuntimeMobileSessionTerminalTab, type RuntimeMobileSessionBrowserTab, type RuntimeMobileSessionTabsRemovedResult, type RuntimeMobileSessionTabsResult, type RuntimeMobileSessionTabsSnapshot, type RuntimeSessionFlushResult, type RuntimeSessionSnapshot, type RuntimeNativeChatLaunchDraftResolution, type RuntimeSessionTabCloseReason, type RuntimeBrowserDriverState, type RuntimeTerminalDriverState, type RuntimeSyncWindowGraph, type RuntimeWorktreeListResult, type BrowserTabInfo, type BrowserScreencastResult, LINEAR_SEARCH_MAX_LIMIT, LINEAR_WRITE_BODY_CAP, clampLinearSearchLimit, isLinearUuid, type FeatureInteractionId, type TerminalPaneSplitSource, WORKTREE_ID_SEPARATOR, getRepoIdFromWorktreeId, splitWorktreeId, splitWorktreeIdForFilesystem, getProjectIdForProviderIdentity, getProjectHostSetupForRepo, getProjectHostSetupWorktreeMeta, clampLinearIssueListLimit, isFolderRepo, DEFAULT_WORKSPACE_STATUS_ID, buildSetupRunnerCommand, getSetupRunnerCommandPlatformForPath, createSequencedSetupAgentCommands, SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV, FIRST_PANE_ID, isTerminalLeafId, makePaneKey, parsePaneKey, parseAppSshPtyId, isValidHostTerminalTabId, isValidTerminalTabId, type TerminalQuickCommandMutation, isPtyIncarnationId, type PtyIncarnationId, buildAgentDraftLaunchPlan, buildAgentResumeStartupPlan, buildAgentStartupPlan, repoIsRemote, isAgentForegroundWrapperProcess, isExpectedAgentProcess, recognizeAgentProcess, isTuiAgentEnabled, pickTuiAgent, resolveTuiAgentLaunchArgs, resolveTuiAgentLaunchEnv, resolveLocalWindowsAgentStartupShell, isTuiAgent, TUI_AGENT_CONFIG, createDraftPasteReadyScanner, detectInstalledAgentsWithShellPathHydration, detectRemoteAgents, markCodexProjectTrusted, markCopilotFolderTrusted, markCursorWorkspaceTrusted, markRemoteAgentWorkspaceTrusted, applyAgentStatusHooksEnabled, recordManagedHookInstallFailure, isWindowsAbsolutePathLike, isPathInsideOrEqual, normalizeRuntimePathForComparison, resolveTerminalStartupCwd, isWslUncPath, parseWslUncPath, folderWorkspaceKey, isWorkspaceKey, parseWorkspaceKey, worktreeWorkspaceKey, projectResolvedWorktreeLineage, sharesResolvedWorktreeLineageBoundary, folderWorkspaceToWorktree, type FolderWorkspacePathStatus, type FolderWorkspacePathStatusRequest, applyMetadataFallbackVisibility, buildKnownOrcaWorkspaceLayouts, isLegacyRepoForExternalWorktreeVisibility, toDetectedWorktree, createAgentScratchWorktreePathMatcher, type AgentScratchWorktreePathMatcher, BROWSER_HEADLESS_RUNTIME_CAPABILITY, BROWSER_CERTIFICATE_TRUST_RUNTIME_CAPABILITY, MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION, ORCHESTRATION_CONTRACT_RUNTIME_CAPABILITY, ORCHESTRATION_CONTRACT_VERSION, REMOTE_RUNTIME_SHARED_CONTROL_CAPABILITY, RUNTIME_CAPABILITIES, RUNTIME_PROTOCOL_VERSION, TERMINAL_PAIRED_PARKING_RUNTIME_CAPABILITY, type RuntimeCapability, configureAiVaultSessionSources, listAiVaultSessions, type AiVaultListArgs, type AiVaultListResult, type AiVaultPrepareSessionResumeArgs, type AiVaultPrepareSessionResumeResult, type WorkspacePortKillRequest, type WorkspacePortKillResult, type WorkspacePortProbe, type WorkspacePortScanResult, filterWorkspacePortProbes, killWorkspacePort, scanWorkspacePortProbes, advertisedUrlWatcher, type AutomationService, RuntimeBrowserCommands, RemoteRuntimeTerminalCreateIdempotency, deriveRemoteRuntimeTerminalCreateHandle, buildHeadlessTerminalSplitLayout, countTerminalLayoutLeaves, RECENT_PTY_OUTPUT_LIMIT, TerminalOutputState, type RuntimeTerminalDataMeta, RuntimeGithubProjectCommands, RuntimeJiraCommands, WorktreeResolutionState, RuntimeTerminalInputCommands, RuntimeLinearQueryCommands, RuntimeLinearConnectionCommands, RuntimeReviewQueryCommands, RuntimeReviewMutationCommands, RuntimeRepoWorkItemCommands, RuntimeMessageWaiters, type MessageWaitResult, buildHeadlessTabGroupMove, buildHeadlessTabGroupSplit, hasExactTerminalOrphanGroupLayout, mergeTerminalOrphanGroupLayout, terminalOrphanExecutionOwnersEqual, retireTerminalSurfacesFromSnapshot, type RetiredTerminalSurface, retireTerminalSurfaceFromPersistence, advanceTerminalTopologyRevision, hasHostAuthoritativeTerminalMembership, RuntimeEmulatorCommands, setEmulatorBridge, type EmulatorBridge, RuntimeFileCommands, RuntimeGitCommands, appendRecentPtyPathCandidates, recentTerminalOutputIncludesPath, recentTerminalPathCandidatesIncludePath, detectTerminalWaitBlockedReason, isKnownReadyPromptPreview, buildPreview, buildTerminalWaitText, computeTerminalTailWaitState, MAX_TAIL_CHARS, tailGainedNewerBlockedReason, type TerminalTailWaitState, appendNormalizedToTailBuffer, type RetainedTailRedrawCursor, appendCompletedTerminalTranscript, tailStateMatches, normalizeTerminalChunk, DEFAULT_TERMINAL_READ_LIMIT, readTerminalTail, terminalReadLimit, shouldFallbackToVisibleTerminalSnapshot, visibleNonBlankTerminalLines, buildVisibleSnapshotReadFallback, MOBILE_AUTO_RESTORE_FIT_MAX_MS, MOBILE_AUTO_RESTORE_FIT_MIN_MS, TUI_IDLE_DEFAULT_TIMEOUT_MS, TUI_IDLE_POLL_INTERVAL_MS, TUI_IDLE_QUIESCENCE_MS, assertTerminalInputWithinLimitWithYield, buildSendPayload, buildPtyTerminalWaitResult, buildPtyTerminalWaitBlockedResult, buildTerminalWaitResult, buildTerminalWaitBlockedResult, detectExplicitIdleStatusFromTitle, getTerminalState, activateClientSessionTabSelection, ClientSessionTabSelectionStore, deriveClientSessionTabSelection, projectClientSessionTabSelection, type PtyProviderBufferSnapshot, type IPtyProvider, type PtyProcessInfo, type PtyTransientFact, ClaudeAgentTeamsService, type AgentTeamsTmuxCompatRequest, type AgentTeamsTmuxCompatResponse, buildClaudeAgentTeamsLaunchPlan, ensureClaudeAgentTeamsShimDir, resolveClaudeAgentTeamsShimBin, addClaudeTeammateModeAuto, addClaudeTeammateModeInProcess, collectMemorySnapshot, app, BrowserWindow, ipcMain, Notification, type AgentBrowserBridge, type BrowserBackend, BrowserError, getRepoSlug, getRepoUpstream, type getPRForBranch, resolveGitHubPrStartPoint, fetchGitHubPullRequestHeadRef, fetchPrHeadTrackingRef, gitlabMergeRequestHeadLocalRef, reviewHeadRemoteRefComponent, fetchGitLabMergeRequestHeadRef, isTransientReviewHeadFetchError, resolveGitHubReviewHeadRemote, fetchCompareBaseRefWithLocalFallback, pickPreferredGitRemote, closeGitLabMR, createGitLabIssue, diagnoseGitLabAuthClient, getGitLabJobTrace, getGitLabProjectRefForRemote, getGitLabRateLimit, getGitLabWorkItemByProjectRef, addGitLabIssueComment, addGitLabMRInlineComment, addGitLabMRComment, listGitLabTodos, listGitLabIssues, listGitLabLabels, listGitLabMergeRequests, listGitLabWorkItems, mergeGitLabMR, reopenGitLabMR, resolveGitLabMRDiscussion, retryGitLabJob, updateGitLabMR, updateGitLabMRReviewers, updateGitLabIssue, getGlabKnownHosts, getGitLabWorkItemDetails, normalizeGitLabIssueListArgs, normalizeGitLabMRListState, normalizeGitLabPositiveInteger, type GitLabIssueListState, recordGitLabProjectRecent, type CreateHostedReviewInput, type CreateHostedReviewResult, type HostedReviewCreationEligibility, type HostedReviewCreationEligibilityArgs, type HostedReviewInfo, getHostedReviewForBranchFromRepo, createHostedReviewFromRepo, getHostedReviewCreationEligibilityFromRepo, getLocalProjectGitExecOptions, getLocalProjectWorktreeGitOptions, getLocalProjectWorktreeGitOptionsForRuntime, resolveLocalProjectRuntimeForRepo, resolveLocalProjectRuntimesForRepos, resolveLocalProjectRuntimeForWorktreeId, type ProjectExecutionRuntimeResolution, resolveTerminalOrchestrationCliCommand, getLocalWorktreePathAccess, removeLocalWorktreePath, toLocalWorktreeRuntimePath, removeStaleLocalWorktreeRegistrationAfterFilesystemRemoval, recoverLocalWindowsWorktreeRemoval, getLinearStatus, isLinearAuthError, addLinearIssueCommentForAgent, createLinearIssueAttachment, createLinearIssueForAgent, getLinearAttachmentByUuidForAgent, getLinearCommentByUuidForAgent, getLinearIssueByUuidForAgent, getLinearIssueCommentThreadRoot, listLinearIssues, updateLinearIssueForAgent, LinearWriteFailure, LinearAgentAccessError, getLinearCurrentIssueFromWorktree, readLinearIssueContext, resolveLegacyLinearLinkWorkspace, classifyLinearError, linearError, linearMessage, sanitizeLinearErrorMessage, listMcpIssues, writeIssueRelation, getLinearProject, listLinearProjectsByExactName, listLinearProjectTeams, listLinearProjects, getLinearTeamLabelsOrThrow, getLinearTeamMembersOrThrow, getLinearTeamStatesOrThrow, getLinearViewerForWorkspaceOrThrow, listLinearTeamsForAgent, listLinearTeamsOrThrow, getBaseRefDefault, getDefaultRemote, getBranchConflictKind, isGitRepo, getRepoName, searchBaseRefDetails, getRemoteCount, normalizeRefSearchQuery, parseAndFilterSearchRefDetails, parseRemoteCount, resolveDefaultBaseRefViaExec, resolveDefaultBaseRefWithLocalGit, buildSearchBaseRefsArgv, isForEachRefExcludeUnsupportedError, mergeBaseRefSearchResultGroups, getRemoteDrift, getRecentDriftSubjects, hasCommitObjectViaGitExec, hasWorktreeBaseCommitRef, resolveLocalGitUsername, getSshGitCapabilityCache, listWorktrees, listWorktreesStrict, addWorktree, addSparseWorktree, assertWorktreeCleanForRemoval, forceDeleteLocalBranch, removeWorktree, type AddWorktreeOptions, type AddWorktreeResult, isENOENT, invalidateAuthorizedRootsCache, createSetupRunnerScript, getDefaultTabsLaunch, getEffectiveHooks, loadHooks, runHook, shouldRunSetupForCreate, DEFAULT_REPO_BADGE_COLOR, FLOATING_TERMINAL_WORKTREE_ID, getDefaultVoiceSettings, listRepoWorktrees, createWorktreeCopiedPaths, createWorktreeLinkedPaths, createWorktreeSharedPaths, findExistingWorktreeSymlinkPaths, removeWorktreeLinkedPaths, formatWorktreeIncludeCopyWarning, resolveWorktreeIncludePaths, getWorktreeSharedLinkPaths, resolveWorktreeSharedDirectories, deleteWorktreeHistoryDir, cleanupUnusedWorktreePushTargetRemote, cleanupUnusedWorktreePushTargetRemoteSsh, createRemoteWorktree, configureCreatedWorktreePushTarget, prepareWorktreePushTarget, getBranchNameOverrideCandidate, getWorktreeCreateCandidate, WORKTREE_CREATE_MAX_SUFFIX_ATTEMPTS, normalizeSparseDirectories, type Store, type StatsCollector, AgentDetector, computeWorktreePath, computeWorkspaceRoot, ensurePathWithinWorkspace, formatWorktreeRemovalError, getWorktreeCreationLayout, getWorktreePathSettings, isOrphanCompatiblePreflightError, isOrphanedWorktreeError, mergeWorktree, sanitizeWorktreeName, shouldSetDisplayName, areWorktreePathsEqual, findCreatedWorktree, assertWorktreeDoesNotContainRegisteredWorktree, canCleanupUnregisteredOrcaLeftoverDirectory, canCleanupUnregisteredOrcaWorktreeDirectory, canSafelyRemoveOrphanedWorktreeDirectory, findRegisteredDeletableWorktree, isDangerousWorktreeRemovalPath, ORPHANED_WORKTREE_DIRECTORY_MESSAGE, stripOrcaProvenanceMetaUpdates, UNREGISTERED_MISSING_WORKTREE_MESSAGE, prefetchWorktreeCreateBase, prepareLocalWorktreeRootForRepo, closeLocalWatcherForWorktreePath, closeRemoteWatcherForWorktreePath, forgetLocalWatcherRemovalSnapshot, forgetRemoteWatcherRemovalSnapshot, restoreLocalWatcherAfterFailedRemoval, restoreRemoteWatcherAfterFailedRemoval, acquireWatcherRemovalGate, createWatcherRemovalDeadline, drainBeforeWatcherRemoval, type WatcherRemovalDeadline, withWorktreeSpan, HeadlessEmulator, isNativeWindowsConptyPty, registerConptyDa1OverrideInstaller, shouldModelAnswerHiddenPtyQueries, getTerminalViewAttributes, getTerminalViewColorQueryReplyColors, registerTerminalViewAttributesApplier, killAllProcessesForWorktree, teardownRpcDeadline, stopMissingWorktreeTerminals, type ReplayableMobileNotification, RuntimeNotificationRegistry, MOBILE_SUBSCRIBE_SCROLLBACK_ROWS, createMobileSessionTabsNotifyCoalescer, type MobileSessionTabsNotifyCoalescer, getSshFilesystemProvider, assertFolderWorkspacePathUsable, getFolderWorkspacePathStatus, getFolderWorkspacePathStatusForPath, inferFolderWorkspacePathConnection, getSshGitProvider, getSshGitProviderGeneration, requireSshGitProvider, detectRepoIconAndUpstream, enrichMissingRepoGitRemoteIdentities, githubAvatarIcon, type ClaudeAccountService, type CodexAccountService, type CodexResetCreditRejectedBeforeProviderReason, type CodexAccountSelectionTarget, type RateLimitService, type CodexRateLimitResetOutcome, type RateLimitState, type CodexResetCreditExpectedScope, type VoiceSettings, getSpeechModelManager, getSpeechSttService, getCatalogModel, isLocalSpeechModel, SPEECH_MODEL_CATALOG, deleteLocalSpeechModel, getSpeechModelDeletionErrorCode, type CommitMessageAgentEnvironmentResolvers, scanNestedRepos, createNestedProjectGroupResolver, resolveNestedRepoSelection, createNestedRepoImportTargetResolver, RuntimeClientSettingsCommands, type RuntimeClientSettings, RuntimeAutomationCommands, type RuntimeAutomationCreateInput, type RuntimeAutomationUpdateInput, PtyLayoutQueue, type ApplyLayoutResult, type PtyLayoutState, type PtyLayoutTarget, PtyGenerationReferenceCount, RuntimeRepoHookCommands, branchSelectorMatches, buildRuntimeWorktreeSummaryPathIndex, canonicalizeTerminalSessionWorktreeId, classifyAgentTitle, classifyLatestAgentTitle, compareWorktreePs, findResolvedWorktreeIdForPath, findRuntimeWorktreeSummaryByPath, getExplicitWorktreeIdSelector, getLatestAgentCandidateTitle, getLatestAgentCandidateTitleInfo, getLatestLeafTitle, getLatestPtyTitle, getLeafWorktreeStatus, getSavedTabWorktreeStatus, includeTargetResolvedWorktree, indexPersistedPtySurfaceBindings, indexPersistedPtyWorktreeBindings, inferWorktreeIdFromPtyId, mapExplicitAgentStateToRuntimeTerminalStatus, maxTimestamp, mergeWorktreeStatus, notifyRuntimeListeners, parseRuntimeWorktreeId, resolveTerminalSessionWorktreeId, resolveWorktreeScanCacheTtlMs, runtimePathsEqual, runtimeWorktreeIdentityKey, runtimeWorktreeIdsEqual, type RuntimeWorktreeSummaryPathIndex, setBoundedMapEntry, setsEqual, terminalTitleBlocksExplicitAgentStatus, waitForWorktreeTerminalMutation, withTimeout, withTimeoutResult, getRuntimeWorktreeRemovalKey, getRuntimeWorktreeRemovalOptionsKey, isLocalRuntimeGitRepository, isRuntimeWorktreePathMissing, omitUndefinedProperties, parseExactWorktreeIdSelector, type PreservedBranchCleanupTarget, type RuntimeWorktreeRemovalInFlight, type RuntimeWorktreeRemovalTarget, addListenerToMap, canCheckoutExistingLocalBranch, clampTerminalViewport, getLocalGitHubPrForBranch, getSelectedHostedReviewForBranch, getSelectedReviewBranch, hasLocalGitOptions, isAllowedPushTargetRemoteConflict, isMatchingSelectedGitHubPr, resolveCreateBranchName, getRuntimeFolderWorkspaceInstanceId, getRuntimeFolderWorkspaceRootId, listRuntimeFolderWorkspaces, mergeRuntimeFolderWorkspace, copySleepingAgentLaunchConfig, deterministicAgentSessionUuid, inferCapturedClaudeAgentTeamsMode, isAgentSessionOperationOutcomeUnknown, isCursorAgentOrchestrationTarget, mergeTerminalEnvDeletionKeys, normalizeSparsePresetDirectoriesForSave, normalizeSparsePresetName, resolveBareAgentLaunchCommand, FETCH_FRESHNESS_MS, REMOTE_FETCH_TIMEOUT_MS, REMOTE_FETCH_CACHE_MAX, DRIFT_PROBE_SUBJECT_LIMIT, PTY_CONTROLLER_LIST_TIMEOUT_MS, WORKTREE_TERMINAL_SLEEP_TIMEOUT_MS, sanitizeNestedRepoRuntimeImportError, runtimeRepoMatchesExecutionHost, assertProjectHostSetupHostIsSupported, pathExists, resolveServerBrowsePath, type RuntimeAccountServices, type RemoteFetchResult, type RemoteTrackingBase, type AccountsSnapshot, type CodexRateLimitResetRpcResult, type RuntimeStore, type RuntimeLeafRecord, type RuntimePtyWorktreeRecord, type TerminalCreateOptions, AGENT_SESSION_OPERATION_PER_CLIENT_LIMIT, AGENT_SESSION_OPERATION_GLOBAL_LIMIT, SESSION_SNAPSHOT_STABILITY_ATTEMPTS, type PtyForegroundAgentRefresh, type RuntimeTerminalAgentStatusEvent, type RuntimePtyTitleTrackerEntry, type RuntimeAgentRowSnapshot, type AgentSessionCreateOperation, type RuntimeHeadlessTerminal, type RuntimePtyDataAdmission, type RuntimeVisibleTerminalState, type ProviderBufferAcquisition, type RuntimeTerminalBufferSnapshot, type HeadlessSeedMetadata, type RuntimePtyController, type PtyControllerTerminalIdentity, type PtyControllerInventory, type WorktreeStartupDraftPaste, type WorktreeStartupFollowup, getAgentLaunchPlatformForRepo, MOBILE_TERMINAL_CREATE_RESULT_TTL_MS, WORKTREE_CREATE_RESULT_TTL_MS, FOREGROUND_AGENT_WRAPPER_RETRY_INTERVAL_MS, FOREGROUND_AGENT_WRAPPER_RETRY_TIMEOUT_MS, BRACKETED_PASTE_BEGIN, BRACKETED_PASTE_END, BRACKETED_PASTE_QUIET_MS, DRAFT_PASTE_READY_TIMEOUT_MS, MOBILE_TERMINAL_SURFACE_TIMEOUT_MS, MOBILE_TERMINAL_READY_FALLBACK_MS, SSH_PANE_RECOVERY_GRACE_MS, isClientDisconnectedError, createTerminalRevealWarning, ownerSurfacing, resolveTerminalPresentation, type RuntimeNotifier, type TerminalHandleRecord, type OrchestrationCompatibilityTerminalAuthority, type LegacyWorkerTerminalRecoveryResult, type OrchestrationCompatibilityCallerAuthority, type RestoredOrchestrationAuthorityReceipt, type OrchestrationCompatibilitySshAttachmentAuthority, type TerminalWaiter, type ResolvedWorktree, type LinearAgentWriteTarget, type LinearCreateFieldIntent, AGENT_HOOK_RUNTIME_ENV_KEYS, sameStringSet, labelsForIds, type TerminalWorkspaceLaunchScope, type WorktreeLineageInput, type ResolvedWorkspaceParent, type WorktreeLineageResolution, type RuntimeWorktreeScanResult, type WorktreeLineageCandidate, extractOrchestrationTaskId, RuntimeLineageError, WorktreeIdRequiresFullPathError, type ResolvedWorktreeSnapshot, type MobileNotificationDispatchEvent, type RuntimeWorktreeLifecycleEvent, type MobileNotificationDismissEvent, type MobileNotificationEvent, type DriverState, type NativeChatLaunchDraftResolutionTombstone, MAX_NATIVE_CHAT_LAUNCH_DRAFT_RESOLUTION_TOMBSTONES, MAX_DELETED_FOLDER_TERMINAL_RETIREMENT_FENCES, MAX_TERMINAL_SURFACE_RETIREMENT_FENCES, hasLocalWorktreeBaseRef, makePtyDurableRetirementKey } from './orca-runtime-symbols'
import { OrcaRuntimeForceDeletePreservedBranchPart58 } from './orca-runtime-force-delete-preserved-branch-part-58'

export class OrcaRuntimeRemoveManagedWorktreePart59 extends OrcaRuntimeForceDeletePreservedBranchPart58 {
  async removeManagedWorktree(
    worktreeSelector: string,
    force = false,
    runHooks = false
  ): Promise<RemoveWorktreeResult & { warning?: string }> {
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }
    const store = this.store
    const removalTarget = await this.resolveWorktreeRemovalTarget(worktreeSelector)
    const optionsKey = getRuntimeWorktreeRemovalOptionsKey(force, runHooks)
    const removalKey = getRuntimeWorktreeRemovalKey(removalTarget)
    const inFlightRemoval = this.removeManagedWorktreeInFlight.get(removalKey)
    if (inFlightRemoval) {
      if (inFlightRemoval.optionsKey === optionsKey) {
        return inFlightRemoval.promise
      }
      throw new Error(`Worktree deletion already in progress: ${removalTarget.id}`)
    }

    // Why: runtime callers can race the same workspace through CLI/mobile
    // retries. Share one destructive Git/filesystem operation per worktree ID.
    const removal = (async (): Promise<RemoveWorktreeResult & { warning?: string }> => {
      // Why: CLI, mobile and headless serve delete through here rather than the IPC handler; without
      // this span their freezes are as invisible as desktop deletes were before `worktree.remove`.
      return withWorktreeSpan({ stage: 'remove', path: removalTarget.path }, async () => {
        const repo =
          store
            .getRepos()
            .find(
              (candidate) =>
                candidate.id === removalTarget.repoId &&
                (!removalTarget.hostId ||
                  getRepoExecutionHostId(candidate) === removalTarget.hostId)
            ) ?? store.getRepo(removalTarget.repoId)
        if (!repo) {
          throw new Error('repo_not_found')
        }
        if (isFolderRepo(repo)) {
          if (removalTarget.id === getRuntimeFolderWorkspaceRootId(repo)) {
            throw new Error(
              'Cannot delete the project root workspace. Remove the folder project instead.'
            )
          }
          const localProvider = this.getLocalProvider()
          if (localProvider) {
            // Why: folder workspace deletion has no Git removal phase where PTYs
            // would otherwise be swept; tear them down before hiding the workspace.
            await killAllProcessesForWorktree(removalTarget.id, {
              runtime: this,
              localProvider,
              onPtyStopped: this.onPtyStopped ?? undefined
            }).catch((err) => {
              console.warn(`[worktree-teardown] failed for ${removalTarget.id}:`, err)
            })
          }
          this.removeWorktreeMetadataAndHistory(store, removalTarget.id)
          this.preservedBranchCleanupByWorktreeId.delete(removalTarget.id)
          this.invalidateResolvedWorktreeCache()
          this.notifyWorktreesChanged(repo.id)
          return {}
        }
        const provider = repo.connectionId ? requireSshGitProvider(repo.connectionId) : null
        const fsProvider = repo.connectionId ? getSshFilesystemProvider(repo.connectionId) : null
        const localWorktreeGitOptions = repo.connectionId
          ? {}
          : getLocalProjectWorktreeGitOptions(this.requireStore(), repo)
        const hasLocalWorktreeGitOptions = Object.keys(localWorktreeGitOptions).length > 0
        const registeredWorktrees = repo.connectionId
          ? await provider!.listWorktrees(repo.path)
          : hasLocalWorktreeGitOptions
            ? await listWorktreesStrict(repo.path, localWorktreeGitOptions)
            : await listWorktreesStrict(repo.path)
        const removedMeta = store.getWorktreeMeta(removalTarget.id)
        const removedPushTarget = removedMeta?.pushTarget ?? removalTarget.pushTarget
        const registeredWorktree = findRegisteredDeletableWorktree(
          repo.path,
          removalTarget.path,
          registeredWorktrees
        )
        if (!registeredWorktree) {
          let canCleanOrphanedDirectory = false
          if (
            canCleanupUnregisteredOrcaWorktreeDirectory({
              meta: removedMeta
            })
          ) {
            if (repo.connectionId) {
              if (!fsProvider) {
                throw new Error('SSH filesystem provider unavailable')
              }
              if (!fsProvider.lstat) {
                throw new Error('SSH filesystem provider lstat unavailable')
              }
              canCleanOrphanedDirectory = await canSafelyRemoveOrphanedWorktreeDirectory(
                removalTarget.path,
                repo.path,
                (path) => fsProvider.lstat!(path),
                (path) => fsProvider.readFile(path)
              )
            } else {
              const access = getLocalWorktreePathAccess(localWorktreeGitOptions)
              canCleanOrphanedDirectory =
                !isDangerousWorktreeRemovalPath(removalTarget.path, repo.path) &&
                (await canSafelyRemoveOrphanedWorktreeDirectory(
                  toLocalWorktreeRuntimePath(removalTarget.path, localWorktreeGitOptions),
                  toLocalWorktreeRuntimePath(repo.path, localWorktreeGitOptions),
                  access.statPath,
                  access.readPath
                ))
            }
          }
          if (canCleanOrphanedDirectory) {
            assertWorktreeDoesNotContainRegisteredWorktree(removalTarget.path, registeredWorktrees)
            if (!force) {
              throw new Error(ORPHANED_WORKTREE_DIRECTORY_MESSAGE)
            }
            if (repo.connectionId) {
              const removalGate = await this.acquireFileWatcherRemoval(
                removalTarget.path,
                repo.connectionId
              )
              let removalCompleted = false
              try {
                await this.stopPtysForDestructiveWorktreeRemoval(
                  removalTarget.id,
                  repo.connectionId
                )
                await fsProvider!.deletePath(removalTarget.path, true)
                removalCompleted = true
              } finally {
                await removalGate.finish(removalCompleted)
              }
              await cleanupUnusedWorktreePushTargetRemoteSsh(
                provider!,
                repo.path,
                removalTarget.id,
                removedPushTarget,
                store
              )
            } else {
              const removalGate = await this.acquireFileWatcherRemoval(removalTarget.path)
              let removalCompleted = false
              try {
                await this.stopPtysForDestructiveWorktreeRemoval(removalTarget.id)
                await removeLocalWorktreePath(removalTarget.path, localWorktreeGitOptions)
                removalCompleted = true
              } finally {
                await removalGate.finish(removalCompleted)
              }
              await cleanupUnusedWorktreePushTargetRemote(
                repo.path,
                removalTarget.id,
                removedPushTarget,
                store,
                localWorktreeGitOptions
              )
            }
            this.clearOptimisticReconcileToken(removalTarget.id)
            this.removeWorktreeMetadataAndHistory(store, removalTarget.id)
            this.preservedBranchCleanupByWorktreeId.delete(removalTarget.id)
            this.invalidateResolvedWorktreeCache()
            this.invalidateWorktreeScanCacheForRepo(removalTarget.repoId)
            invalidateAuthorizedRootsCache()
            this.notifyWorktreesChanged(repo.id)
            return {}
          }
          if (!repo.connectionId) {
            const access = getLocalWorktreePathAccess(localWorktreeGitOptions)
            const runtimeWorktreePath = toLocalWorktreeRuntimePath(
              removalTarget.path,
              localWorktreeGitOptions
            )
            if (
              await canCleanupUnregisteredOrcaLeftoverDirectory({
                meta: removedMeta,
                worktreePath: removalTarget.path,
                runtimeWorktreePath,
                repo,
                runtimeRepoPath: toLocalWorktreeRuntimePath(repo.path, localWorktreeGitOptions),
                registeredWorktrees,
                statPath: access.statPath,
                isGitRepository: (path) =>
                  isLocalRuntimeGitRepository(path, localWorktreeGitOptions)
              })
            ) {
              if (!force) {
                throw new Error(ORPHANED_WORKTREE_DIRECTORY_MESSAGE)
              }
              const removalGate = await this.acquireFileWatcherRemoval(removalTarget.path)
              let removalCompleted = false
              try {
                await this.stopPtysForDestructiveWorktreeRemoval(removalTarget.id)
                await removeLocalWorktreePath(removalTarget.path, localWorktreeGitOptions)
                removalCompleted = true
              } finally {
                await removalGate.finish(removalCompleted)
              }
              await cleanupUnusedWorktreePushTargetRemote(
                repo.path,
                removalTarget.id,
                removedPushTarget,
                store,
                localWorktreeGitOptions
              )
              this.clearOptimisticReconcileToken(removalTarget.id)
              this.removeWorktreeMetadataAndHistory(store, removalTarget.id)
              this.preservedBranchCleanupByWorktreeId.delete(removalTarget.id)
              this.invalidateResolvedWorktreeCache()
              this.invalidateWorktreeScanCacheForRepo(removalTarget.repoId)
              invalidateAuthorizedRootsCache()
              this.notifyWorktreesChanged(repo.id)
              return {}
            }
          }
          if (
            await isRuntimeWorktreePathMissing(repo, removalTarget.path, localWorktreeGitOptions)
          ) {
            if (!force && !removedMeta) {
              // Why: without persisted metadata, require the renderer recovery
              // path before deleting Orca-only state for an unregistered path.
              throw new Error(UNREGISTERED_MISSING_WORKTREE_MESSAGE)
            }
            // Why: a manually deleted worktree is already gone from Git and disk.
            // Finish runtime metadata cleanup without requiring force or touching
            // any unregistered path that still exists.
            await (repo.connectionId
              ? cleanupUnusedWorktreePushTargetRemoteSsh(
                  provider!,
                  repo.path,
                  removalTarget.id,
                  removedPushTarget,
                  store
                )
              : cleanupUnusedWorktreePushTargetRemote(
                  repo.path,
                  removalTarget.id,
                  removedPushTarget,
                  store,
                  localWorktreeGitOptions
                ))
            this.clearOptimisticReconcileToken(removalTarget.id)
            this.removeWorktreeMetadataAndHistory(store, removalTarget.id)
            this.preservedBranchCleanupByWorktreeId.delete(removalTarget.id)
            this.invalidateResolvedWorktreeCache()
            this.invalidateWorktreeScanCacheForRepo(removalTarget.repoId)
            invalidateAuthorizedRootsCache()
            this.notifyWorktreesChanged(repo.id)
            return {}
          }
          throw new Error(`Refusing to delete unregistered worktree path: ${removalTarget.path}`)
        }
        const canonicalWorktreePath = registeredWorktree.path
        const deleteBranch = removedMeta?.preserveBranchOnDelete !== true

        // Why: a Git lock must block before archive hooks or linked-path cleanup
        // mutate the workspace; dirty-file force is a separate permission.
        try {
          assertWorktreeUnlockedForRemoval(registeredWorktree)
        } catch (error) {
          throw new Error(formatWorktreeRemovalError(error, canonicalWorktreePath, force))
        }

        // Why: a prior forced Windows recovery can delete the directory but leave
        // Git's stale registration; recover and verify it before clearing metadata.
        if (
          !repo.connectionId &&
          force === true &&
          process.platform === 'win32' &&
          (isWindowsAbsolutePathLike(canonicalWorktreePath) ||
            !!localWorktreeGitOptions.wslDistro) &&
          removedMeta &&
          (await isRuntimeWorktreePathMissing(repo, canonicalWorktreePath, localWorktreeGitOptions))
        ) {
          const removalResult = await removeStaleLocalWorktreeRegistrationAfterFilesystemRemoval({
            canonicalWorktreePath,
            repoPath: repo.path,
            localWorktreeGitOptions,
            registeredWorktree,
            deleteBranch
          })
          await cleanupUnusedWorktreePushTargetRemote(
            repo.path,
            removalTarget.id,
            removedPushTarget,
            store,
            localWorktreeGitOptions
          )
          this.rememberPreservedBranchCleanupTarget(
            removalTarget.id,
            removalResult,
            registeredWorktree.head,
            removedPushTarget
          )
          this.clearOptimisticReconcileToken(removalTarget.id)
          this.removeWorktreeMetadataAndHistory(store, removalTarget.id)
          this.invalidateResolvedWorktreeCache()
          this.invalidateWorktreeScanCacheForRepo(removalTarget.repoId)
          invalidateAuthorizedRootsCache()
          this.notifyWorktreesChanged(repo.id)
          return removalResult ?? {}
        }
        if (repo.connectionId) {
          const remoteRemoveOptions = !deleteBranch ? { deleteBranch } : {}
          const removalGate = await this.acquireFileWatcherRemoval(
            canonicalWorktreePath,
            repo.connectionId
          )
          let rawRemovalResult: RemoveWorktreeResult | undefined
          let removalCompleted = false
          try {
            await this.stopPtysForDestructiveWorktreeRemoval(removalTarget.id, repo.connectionId)
            rawRemovalResult = await (Object.keys(remoteRemoveOptions).length > 0
              ? provider!.removeWorktree(canonicalWorktreePath, force, remoteRemoveOptions)
              : provider!.removeWorktree(canonicalWorktreePath, force))
            removalCompleted = true
          } finally {
            await removalGate.finish(removalCompleted)
          }
          const removalResult = this.preserveBranchHeadFallback(
            rawRemovalResult,
            registeredWorktree.head
          )
          await cleanupUnusedWorktreePushTargetRemoteSsh(
            provider!,
            repo.path,
            removalTarget.id,
            removedPushTarget,
            store
          )
          this.rememberPreservedBranchCleanupTarget(
            removalTarget.id,
            removalResult,
            registeredWorktree.head,
            removedPushTarget
          )
          this.clearOptimisticReconcileToken(removalTarget.id)
          this.removeWorktreeMetadataAndHistory(store, removalTarget.id)
          this.invalidateResolvedWorktreeCache()
          this.invalidateWorktreeScanCacheForRepo(removalTarget.repoId)
          invalidateAuthorizedRootsCache()
          this.notifyWorktreesChanged(repo.id)
          return removalResult ?? {}
        }

        const hooks = getEffectiveHooks(repo)
        let warning: string | undefined
        if (hooks?.scripts.archive && runHooks) {
          const result = await runHook(
            'archive',
            canonicalWorktreePath,
            repo,
            undefined,
            hasLocalWorktreeGitOptions ? localWorktreeGitOptions : undefined
          )
          if (!result.success) {
            console.error(
              `[hooks] archive hook failed for ${canonicalWorktreePath}:`,
              result.output
            )
          }
        } else if (hooks?.scripts.archive) {
          // Runtime RPC calls have no renderer trust prompt, so hooks require explicit CLI opt-in.
          warning = `orca.yaml archive hook skipped for ${canonicalWorktreePath}; pass --run-hooks to run it.`
          console.warn(`[hooks] ${warning}`)
        }

        const refreshedWorktrees = hasLocalWorktreeGitOptions
          ? await listWorktreesStrict(repo.path, localWorktreeGitOptions)
          : await listWorktreesStrict(repo.path)
        const refreshedRegisteredWorktree = findRegisteredDeletableWorktree(
          repo.path,
          canonicalWorktreePath,
          refreshedWorktrees
        )
        if (!refreshedRegisteredWorktree) {
          throw new Error(
            `Worktree registration changed during deletion: ${canonicalWorktreePath}. Retry deletion.`
          )
        }
        try {
          // Why: an archive hook can race another Git client that locks the row;
          // recheck before linked-path, watcher, or terminal teardown side effects.
          assertWorktreeUnlockedForRemoval(refreshedRegisteredWorktree)
        } catch (error) {
          throw new Error(formatWorktreeRemovalError(error, canonicalWorktreePath, force))
        }

        // Why: `orca.yaml` shared directories are symlinked in too, and a
        // directory-only ignore rule leaves those links untracked, so removal must
        // tolerate and unlink them exactly like the per-user shared paths.
        const linkedPaths = getWorktreeSharedLinkPaths(repo)
        const ignoredLinkedPaths = force
          ? []
          : await findExistingWorktreeSymlinkPaths(canonicalWorktreePath, linkedPaths)
        try {
          await (hasLocalWorktreeGitOptions
            ? assertWorktreeCleanForRemoval(canonicalWorktreePath, force, {
                ...localWorktreeGitOptions,
                ...(ignoredLinkedPaths.length > 0
                  ? { ignoredUntrackedPaths: ignoredLinkedPaths }
                  : {})
              })
            : ignoredLinkedPaths.length > 0
              ? assertWorktreeCleanForRemoval(canonicalWorktreePath, force, {
                  ignoredUntrackedPaths: ignoredLinkedPaths
                })
              : assertWorktreeCleanForRemoval(canonicalWorktreePath, force))
        } catch (error) {
          if (!isOrphanCompatiblePreflightError(error)) {
            throw new Error(formatWorktreeRemovalError(error, canonicalWorktreePath, force))
          }
          // Why: Git can still classify this as an orphan after preflight;
          // retain strict PTY teardown before any recursive fallback deletion.
        }

        let removalResult: RemoveWorktreeResult | undefined
        const removalGate = await this.acquireFileWatcherRemoval(canonicalWorktreePath)
        let removalCompleted = false
        try {
          // Why: linked-path deletion is destructive too; PTYs must release every
          // handle before Windows or WSL filesystem cleanup starts.
          await this.stopPtysForDestructiveWorktreeRemoval(removalTarget.id)

          if (linkedPaths.length > 0) {
            await removeWorktreeLinkedPaths(canonicalWorktreePath, linkedPaths)
          }

          try {
            const removeOptions = {
              ...(!deleteBranch ? { deleteBranch } : {}),
              // Why: removal already validated the Git row under the selected
              // project runtime; keep branch cleanup on that same canonical row.
              knownRemovedWorktree: refreshedRegisteredWorktree,
              ...localWorktreeGitOptions
            }
            removalResult = this.preserveBranchHeadFallback(
              await removeWorktree(repo.path, canonicalWorktreePath, force, removeOptions),
              refreshedRegisteredWorktree.head
            )
          } catch (error) {
            // Why: Git for Windows can deregister a clean worktree before its
            // recursive filesystem deletion fails transiently.
            const recoveredRemovalResult = await recoverLocalWindowsWorktreeRemoval({
              error,
              force,
              canonicalWorktreePath,
              repoPath: repo.path,
              localWorktreeGitOptions,
              registeredWorktree: refreshedRegisteredWorktree,
              deleteBranch,
              closeWatcher: (worktreePath) => this.closeFileWatchersForRemoval(worktreePath)
            })
            if (recoveredRemovalResult) {
              removalResult = recoveredRemovalResult
              removalCompleted = true
            } else if (isOrphanedWorktreeError(error)) {
              const access = getLocalWorktreePathAccess(localWorktreeGitOptions)
              if (
                await canSafelyRemoveOrphanedWorktreeDirectory(
                  toLocalWorktreeRuntimePath(canonicalWorktreePath, localWorktreeGitOptions),
                  toLocalWorktreeRuntimePath(repo.path, localWorktreeGitOptions),
                  access.statPath,
                  access.readPath
                )
              ) {
                await this.closeFileWatchersForRemoval(canonicalWorktreePath)
                await removeLocalWorktreePath(canonicalWorktreePath, localWorktreeGitOptions).catch(
                  () => {}
                )
              } else {
                console.warn(
                  `[worktrees] Refusing recursive cleanup for unproven worktree directory: ${canonicalWorktreePath}`
                )
              }
              // Why: `git worktree remove` failed, so git's internal worktree tracking
              // (`.git/worktrees/<name>`) is still intact. Without pruning, `git worktree
              // list` continues to show the stale entry and the branch it had checked out
              // remains locked — other worktrees cannot check it out.
              await gitExecFileAsync(['worktree', 'prune'], {
                cwd: repo.path,
                ...localWorktreeGitOptions
              }).catch(() => {})
              await cleanupUnusedWorktreePushTargetRemote(
                repo.path,
                removalTarget.id,
                removedPushTarget,
                store,
                localWorktreeGitOptions
              )
              this.clearOptimisticReconcileToken(removalTarget.id)
              this.removeWorktreeMetadataAndHistory(store, removalTarget.id)
              this.preservedBranchCleanupByWorktreeId.delete(removalTarget.id)
              this.invalidateResolvedWorktreeCache()
              this.invalidateWorktreeScanCacheForRepo(removalTarget.repoId)
              invalidateAuthorizedRootsCache()
              this.notifyWorktreesChanged(repo.id)
              removalCompleted = true
              return {
                ...(warning ? { warning } : {})
              }
            } else {
              throw new Error(formatWorktreeRemovalError(error, canonicalWorktreePath, force))
            }
          }
          removalCompleted = true
        } finally {
          await removalGate.finish(removalCompleted)
        }

        await cleanupUnusedWorktreePushTargetRemote(
          repo.path,
          removalTarget.id,
          removedPushTarget,
          store,
          localWorktreeGitOptions
        )
        this.rememberPreservedBranchCleanupTarget(
          removalTarget.id,
          removalResult,
          refreshedRegisteredWorktree.head,
          removedPushTarget
        )
        this.clearOptimisticReconcileToken(removalTarget.id)
        this.removeWorktreeMetadataAndHistory(store, removalTarget.id)
        this.invalidateResolvedWorktreeCache()
        this.invalidateWorktreeScanCacheForRepo(removalTarget.repoId)
        invalidateAuthorizedRootsCache()
        this.notifyWorktreesChanged(repo.id)
        return {
          ...removalResult,
          ...(warning ? { warning } : {})
        }
      })
    })()
    this.removeManagedWorktreeInFlight.set(removalKey, { optionsKey, promise: removal })
    try {
      const result = await removal
      this.emitWorktreeLifecycle({
        kind: 'removed',
        worktreeId: removalTarget.id,
        path: removalTarget.path
      })
      return result
    } finally {
      if (this.removeManagedWorktreeInFlight.get(removalKey)?.promise === removal) {
        this.removeManagedWorktreeInFlight.delete(removalKey)
      }
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
