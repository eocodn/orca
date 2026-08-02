import {
  app,
  safeStorage,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  unlinkSync,
  copyFileSync,
  statSync,
  realpathSync,
  rename,
  mkdir,
  rm,
  copyFile,
  open,
  renameDurableSync,
  writeFileDurableSync,
  join,
  dirname,
  isAbsolute,
  resolve,
  sep,
  homedir,
  createHash,
  randomUUID,
  latestAutomationOccurrenceAtOrBefore,
  nextAutomationOccurrenceAfter,
  getAutomationLegacyRepoId,
  normalizeAutomationPrecheck,
  deriveGlobalWindowsRuntimeDefaultFromLegacySettings,
  normalizeProjectRuntimePreference,
  projectHostSetupProjectionFromRepos,
  isPluginPanelTabKey,
  areTaskSourceContextsEqual,
  buildTaskSourceContextFromRepo,
  buildWorkspaceRunContext,
  normalizeStoredTaskSourceContext,
  areWorkspaceLinkedItemsEqual,
  normalizeWorkspaceLinkedItem,
  isWorkspaceLinkedItemSourceContextMatch,
  MOBILE_PAIRING_USERDATA_FILES,
  BACKUP_COUNT,
  backupPath,
  projectHostSetupCompatibilityStateEqual,
  mergeProjectHostSetupCompatibilityState,
  backfillLegacyAutomationContexts,
  normalizeWorktreeLinkedItemMetadata,
  gcStaleWorktreeMeta,
  readGithubCacheSnapshot,
  normalizePersistedMobileClientTabSelections,
  sanitizeWorkspaceSessionTerminalRetirements,
  removeRepoFromHostWorkspaceSessions,
  removeRepoFromWorkspaceSession,
  hardenExistingSecureFile,
  LEGACY_DEFAULT_SSH_RELAY_GRACE_PERIOD_SECONDS,
  isFolderRepo,
  getRepoExecutionHostId,
  parseExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  normalizeExecutionHostOrder,
  normalizeExecutionHostId,
  normalizeVisibleExecutionHostIds,
  toSshExecutionHostId,
  getDefaultPersistedState,
  getDefaultNotificationSettings,
  getDefaultOnboardingState,
  getDefaultVoiceSettings,
  getDefaultUIState,
  getDefaultRepoHookSettings,
  getDefaultWorkspaceSession,
  getWorktreeCardModeProperties,
  isDefaultedCompactWorktreeCardProperties,
  normalizeAgentActivityDisplayMode,
  normalizeWorktreeCardProperties,
  ONBOARDING_FLOW_VERSION,
  ONBOARDING_FINAL_STEP,
  parseWorkspaceSession,
  normalizeUsagePercentageDisplay,
  normalizeStatusBarUsageMode,
  isExistingPersistedProfile,
  resolveUsagePercentageDisplayChangeNoticeDismissed,
  normalizePRBotAuthorOverrides,
  toRelaySshPtyId,
  migrateUiHostScopeSshTargetId,
  migrateWorkspaceSessionSshTargetId,
  isWslUncPath,
  isTerminalLeafId,
  makePaneKey,
  parseLegacyNumericPaneKey,
  parsePaneKey,
  setMigrationUnsupportedPty,
  setMigrationUnsupportedPtyPersistenceListener,
  agentHookServer,
  pruneLocalTerminalScrollbackBuffers,
  backfillAutomationRunNumbers,
  nextAutomationRunNumber,
  pruneAutomationRuns,
  pruneWorkspaceSessionBrowserHistory,
  FOLDER_WORKSPACE_INSTANCE_SEPARATOR,
  getRepoIdFromWorktreeId,
  getWorktreePathBasenameFromId,
  isPathInsideOrEqual,
  isWindowsAbsolutePathLike,
  normalizeRuntimePathForComparison,
  normalizeTerminalQuickCommands,
  normalizeTaskProviderSettings,
  normalizeAutoRenameBranchFromWorkDefaultOn,
  normalizeOpenInApplications,
  normalizeTerminalShortcutPolicy,
  normalizeSourceControlGroupOrder,
  normalizeAppIconId,
  normalizeTerminalCustomThemes,
  legacyTerminalScrollbackBytesToRows,
  normalizeDesktopTerminalScrollbackRows,
  compareFeatureInteractionUsageBuckets,
  getFeatureInteractionCategory,
  getFeatureInteractionUsageBucket,
  normalizeFeatureInteractions,
  normalizeFeatureInteractionTelemetryBuckets,
  normalizeContextualTourIds,
  normalizeFeatureTipIds,
  parseCodexResetCreditAttemptLedger,
  normalizeManualRepoOrder,
  DEFAULT_WORKSPACE_STATUS_ID,
  clampWorkspaceBoardColumnWidth,
  clampWorkspaceBoardOpacity,
  normalizePersistedWorkspaceStatuses,
  normalizeWorkspaceStatuses,
  clampMarkdownTocPanelWidth,
  clampCombinedDiffFileTreeWidth,
  isLegacyRepoForExternalWorktreeVisibility,
  sanitizeRepoIcon,
  normalizeRepoBadgeColor,
  clearMissingProjectGroupMemberships,
  createProjectGroup,
  getNextProjectGroupOrder,
  getProjectGroupSubtreeIds,
  normalizeProjectGroupName,
  normalizeProjectGroups,
  createNestedProjectGroupResolver,
  mergeLegacyCommitMessageAiIntoSourceControlAi,
  normalizeRepoSourceControlAiOverrides,
  normalizeSourceControlAiSettings,
  projectSourceControlAiToLegacyCommitMessageAi,
  sourceControlAiSettingsFromLegacy,
  DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES,
  SOURCE_CONTROL_TEXT_ACTION_IDS,
  normalizeDisabledTuiAgents,
  DEFAULT_TUI_AGENT_ARGS,
  DEFAULT_TUI_AGENT_ENV,
  hasUnsupportedTuiAgentArgs,
  normalizeTuiAgentArgsRecord,
  normalizeTuiAgentEnvRecord,
  normalizeTerminalCursorStyleDefault,
  normalizeOsc52ClipboardDefaultOn,
  osc52ClipboardDefaultOnOverridesPersistedOff,
  normalizeTerminalLineHeight,
  normalizeUiLanguage,
  normalizeBrowserPageZoomLevel,
  persistedUIValuesEqual,
  ActiveViewPreference,
  normalizeFolderWorkspaceName,
  normalizeFolderWorkspaceOperationId,
  normalizeFolderWorkspaces,
  folderWorkspaceKey,
  isWorkspaceKey,
  parseWorkspaceKey,
  worktreeWorkspaceKey,
  collectTerminalScrollbackSnapshotRefs,
  deleteTerminalScrollbackSnapshotSync,
  getProfileTerminalScrollbackSnapshotRoot,
  migrateWorkspaceSessionTerminalScrollbackSnapshots,
  readTerminalScrollbackSnapshotSync,
  track,
  getCohortAtEmit,
  isStartupDiagnosticsEnabled,
  logStartupDiagnostic,
  cloneLayoutNode,
  cloneLayoutWithLeafIds,
  collectLayoutLeafCounts,
  collectLayoutLeafIdsInOrder,
  findWorktreeIdForTab,
  firstLayoutLeafId,
  leafRecordEquivalent,
  layoutContainsLeafId,
  preserveMissingLeafRecordEntries,
  remapLeafRecordForPersistence,
  removeWorkspaceSessionOwner,
  removeWorkspaceSessionOwners,
  inferFolderScopeConnectionIdForMigration,
  backfillFolderScopeConnectionIds,
  deleteRemovedTerminalScrollbackSnapshots,
  getDefaultWorktreeMeta,
  StoreFoundation
} from './persistence-store-repository-load-api'

export function finalizeLoadedRepositoryState(
  context: any,
  result: any | null,
  fileExistedOnLoad: boolean,
  allowBackupRecovery: boolean
): any {
    const dataFile = context.dataFile
    if (result === null && allowBackupRecovery) {
      let hasBackup = false
      for (let i = 0; i < BACKUP_COUNT; i++) {
        if (existsSync(backupPath(dataFile, i))) {
          hasBackup = true
          break
        }
      }
      if (fileExistedOnLoad || hasBackup) {
        if (context.restoreFromBackup(dataFile)) {
          return context.load(false)
        }
        console.error('[persistence] No usable state file or backup found, using defaults')
      }
    }

    if (result === null) {
      result = getDefaultPersistedState(homedir())
    }

    const workspaceSession = pruneWorkspaceSessionBrowserHistory(
      pruneLocalTerminalScrollbackBuffers(result.workspaceSession, result.repos)
    )
    const migratedScrollback = migrateWorkspaceSessionTerminalScrollbackSnapshots(
      workspaceSession,
      context.terminalScrollbackSnapshotStorage
    )
    if (migratedScrollback.changed) {
      context.loadNeedsSave = true
    }

    const repos = clearMissingProjectGroupMemberships(result.repos, result.projectGroups ?? [])
    const projectHostSetupCompatibility = mergeProjectHostSetupCompatibilityState(result, repos)
    if (!projectHostSetupCompatibilityStateEqual(result, projectHostSetupCompatibility)) {
      context.loadNeedsSave = true
    }

    const automationContextMigration = backfillLegacyAutomationContexts({
      ...result,
      repos,
      ...projectHostSetupCompatibility
    })
    if (automationContextMigration.changed) {
      context.loadNeedsSave = true
    }
    result = {
      ...result,
      automations: automationContextMigration.state.automations,
      automationRuns: automationContextMigration.state.automationRuns
    }

    const folderScopeConnectionMigration = backfillFolderScopeConnectionIds({
      ...result,
      repos,
      ...projectHostSetupCompatibility,
      workspaceSession: migratedScrollback.session
    })
    if (folderScopeConnectionMigration.changed) {
      context.loadNeedsSave = true
    }
    result = folderScopeConnectionMigration.state

    if (normalizeWorktreeLinkedItemMetadata(result)) {
      context.loadNeedsSave = true
    }

    if (gcStaleWorktreeMeta(result) > 0) {
      context.loadNeedsSave = true
    }

    const migrated = context.migrateTabSwitchKeybindings(
      context.migrateTelemetry(result, fileExistedOnLoad),
      fileExistedOnLoad
    )

    const legacyCache = migrated.githubCache
    const hasLegacyCache =
      Object.keys(legacyCache?.pr ?? {}).length > 0 ||
      Object.keys(legacyCache?.issue ?? {}).length > 0
    if (hasLegacyCache) {
      context.loadNeedsSave = true
      context.githubCacheDirty = true
    } else {
      migrated.githubCache = readGithubCacheSnapshot(context.dataFile) ?? migrated.githubCache
    }

    logPersistenceStartupMilestone('persistence-load-done', {
      repos: migrated.repos.length,
      workspaceSessionBytes: Buffer.byteLength(JSON.stringify(migrated.workspaceSession))
    })
    return migrated
}
