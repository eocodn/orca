import { persistenceLoadDependencies as dependencies } from './persistence-store-repository-state'

export function loadRepositoryState(context: any, allowBackupRecovery = true): any {
  const {
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
  } = dependencies as any
    const dataFile = context.dataFile
    const fileExistedOnLoad = existsSync(dataFile)
    logPersistenceStartupMilestone('persistence-load-start', {
      fileExists: fileExistedOnLoad
    })

    let result: any | null = null
    try {
      if (fileExistedOnLoad) {
        const readStartedAt = performance.now()
        const raw = readFileSync(dataFile, 'utf-8')
        logPersistenceStartupMilestone('persistence-read-done', {
          bytes: Buffer.byteLength(raw),
          durationMs: Math.round(performance.now() - readStartedAt)
        })
        logPersistenceStartupMilestone('persistence-json-parse-start')
        const parsed = JSON.parse(raw) as any
        logPersistenceStartupMilestone('persistence-json-parse-done')

        if (parsed.settings?.opencodeSessionCookie) {
          parsed.settings.opencodeSessionCookie = decrypt(parsed.settings.opencodeSessionCookie)
        }
        if (parsed.settings?.httpProxyUrl) {
          parsed.settings.httpProxyUrl = decrypt(parsed.settings.httpProxyUrl)
        }
        if (parsed.ui?.browserKagiSessionLink) {
          parsed.ui.browserKagiSessionLink = decryptOptionalSecret(parsed.ui.browserKagiSessionLink)
        }

        const homeDir = homedir()
        const defaults = getDefaultPersistedState(homeDir)
        const migratedTerminalScrollback = migrateTerminalScrollbackRows(parsed.settings)
        if (migratedTerminalScrollback.needsSave) {
          context.loadNeedsSave = true
        }
        const migratedTerminalTuiScrollSensitivity = migrateTerminalTuiScrollSensitivityDefault(
          parsed.settings
        )
        if (migratedTerminalTuiScrollSensitivity.needsSave) {
          context.loadNeedsSave = true
        }
        const rawSourceControlAi = parsed.settings?.sourceControlAi
        const rawSourceControlAiMissing = rawSourceControlAi === undefined
        const rawSourceControlAiActionsMissing =
          rawSourceControlAi !== undefined && rawSourceControlAi.actions === undefined
        if (rawSourceControlAiMissing || rawSourceControlAiActionsMissing) {
          context.loadNeedsSave = true
        }
        const legacyCommitMessageAi = parsed.settings?.commitMessageAi
        const migratedSourceControlAi = rawSourceControlAiMissing
          ? sourceControlAiSettingsFromLegacy(
              legacyCommitMessageAi ?? defaults.settings.commitMessageAi
            )
          : mergeLegacyCommitMessageAiIntoSourceControlAi(
              parsed.settings?.sourceControlAi,
              legacyCommitMessageAi
            )
        const rawOptionAsAlt = parsed.settings?.terminalMacOptionAsAlt
        const alreadyMigrated = parsed.settings?.terminalMacOptionAsAltMigrated === true
        const migratedOptionAsAlt: 'auto' | 'true' | 'false' | 'left' | 'right' = alreadyMigrated
          ? (rawOptionAsAlt ?? 'auto')
          : rawOptionAsAlt === undefined || rawOptionAsAlt === 'true'
            ? 'auto'
            : rawOptionAsAlt
        const floatingTerminalDefaultedForAllUsers =
          parsed.settings?.floatingTerminalDefaultedForAllUsers === true
        const migratedFloatingTerminalEnabled = floatingTerminalDefaultedForAllUsers
          ? (parsed.settings?.floatingTerminalEnabled ?? true)
          : true
        const migratedOsc52Clipboard = normalizeOsc52ClipboardDefaultOn(parsed.settings)
        const osc52ClipboardNoticePending =
          osc52ClipboardDefaultOnOverridesPersistedOff(parsed.settings) ||
          parsed.ui?.osc52ClipboardDefaultOnNoticePending === true
        if (parsed.settings?.terminalAllowOsc52ClipboardDefaultedOnForAllUsers !== true) {
          context.loadNeedsSave = true
        }
        const floatingTerminalCwdMigrated =
          parsed.settings?.floatingTerminalCwdMigratedToAppWorkspace === true
        const migratedFloatingTerminalCwd = floatingTerminalCwdMigrated
          ? !parsed.settings?.floatingTerminalCwd
            ? defaults.settings.floatingTerminalCwd
            : parsed.settings.floatingTerminalCwd
          : parsed.settings?.floatingTerminalCwd === undefined
            ? defaults.settings.floatingTerminalCwd
            : parsed.settings.floatingTerminalCwd
        const normalizedFloatingTerminalTrustedCwds = normalizeFloatingWorkspaceTrustedCwds(
          parsed.settings?.floatingTerminalTrustedCwds,
          homeDir
        )
        const migratedFloatingTerminalTrustedCwds = [
          ...normalizedFloatingTerminalTrustedCwds.trustedCwds
        ]
        const rawLegacyFloatingTerminalCwd = parsed.settings?.floatingTerminalCwd
        const shouldTrustLegacyFloatingTerminalCwd =
          !floatingTerminalCwdMigrated &&
          typeof rawLegacyFloatingTerminalCwd === 'string' &&
          rawLegacyFloatingTerminalCwd.trim().length > 0 &&
          rawLegacyFloatingTerminalCwd.trim() !== '~'
        if (!floatingTerminalCwdMigrated) {
          context.loadNeedsSave = true
        }
        if (shouldTrustLegacyFloatingTerminalCwd && rawLegacyFloatingTerminalCwd) {
          const canonicalLegacyCwd = canonicalizePersistedFloatingWorkspaceDirectory(
            rawLegacyFloatingTerminalCwd,
            homeDir
          )
          if (
            canonicalLegacyCwd &&
            !migratedFloatingTerminalTrustedCwds.includes(canonicalLegacyCwd)
          ) {
            migratedFloatingTerminalTrustedCwds.push(canonicalLegacyCwd)
            normalizedFloatingTerminalTrustedCwds.changed = true
          }
        }
        if (normalizedFloatingTerminalTrustedCwds.changed) {
          context.loadNeedsSave = true
        }
        const experimentalActivityDefaultedOffForAllUsers =
          parsed.settings?.experimentalActivityDefaultedOffForAllUsers === true
        const migratedExperimentalActivity = experimentalActivityDefaultedOffForAllUsers
          ? (parsed.settings?.experimentalActivity ?? false)
          : false
        const autoRenameBranchFromWorkDefaultedOn =
          parsed.settings?.autoRenameBranchFromWorkDefaultedOn === true
        const migratedAutoRenameBranchFromWork = normalizeAutoRenameBranchFromWorkDefaultOn(
          parsed.settings
        )
        const migratedTerminalCursorStyle = normalizeTerminalCursorStyleDefault(parsed.settings)
        const migratedTerminalLineHeight = normalizeTerminalLineHeight(
          parsed.settings?.terminalLineHeight
        )
        const terminalRightClickToPasteDefaultedForPlatform =
          parsed.settings?.terminalRightClickToPasteDefaultedForPlatform === true
        if (!terminalRightClickToPasteDefaultedForPlatform) {
          context.loadNeedsSave = true
        }
        if (
          parsed.settings?.terminalLineHeight !== undefined &&
          parsed.settings.terminalLineHeight !== migratedTerminalLineHeight
        ) {
          context.loadNeedsSave = true
        }
        const rawTaskProviderSettings = normalizeTaskProviderSettings({
          visibleTaskProviders: parsed.settings?.visibleTaskProviders,
          defaultTaskSource: parsed.settings?.defaultTaskSource
        })
        const visibleTaskProvidersDefaultedForJira =
          parsed.settings?.visibleTaskProvidersDefaultedForJira === true
        const migratedVisibleTaskProviders = visibleTaskProvidersDefaultedForJira
          ? rawTaskProviderSettings.visibleTaskProviders
          : rawTaskProviderSettings.visibleTaskProviders.includes('jira')
            ? rawTaskProviderSettings.visibleTaskProviders
            : [...rawTaskProviderSettings.visibleTaskProviders, 'jira' as const]
        const taskProviderSettings = normalizeTaskProviderSettings({
          visibleTaskProviders: migratedVisibleTaskProviders,
          defaultTaskSource: rawTaskProviderSettings.defaultTaskSource
        })
        const primarySelectionDefaultedForLinux =
          parsed.settings?.primarySelectionMiddleClickPasteDefaultedForLinux === true
        const primarySelectionDefaultedForTerminalDefaults =
          parsed.settings?.primarySelectionMiddleClickPasteDefaultedForTerminalDefaults === true
        const primarySelectionPlatformDefaultEnabled =
          defaults.settings.primarySelectionMiddleClickPaste === true
        const primarySelectionAlreadyDefaultedForPlatform =
          primarySelectionDefaultedForTerminalDefaults ||
          (process.platform === 'linux' && primarySelectionDefaultedForLinux)
        const migratePrimarySelectionPlatformDefault =
          primarySelectionPlatformDefaultEnabled && !primarySelectionAlreadyDefaultedForPlatform
        const stampPrimarySelectionTerminalDefaults =
          primarySelectionPlatformDefaultEnabled && !primarySelectionDefaultedForTerminalDefaults
        if (migratePrimarySelectionPlatformDefault || stampPrimarySelectionTerminalDefaults) {
          context.loadNeedsSave = true
        }
        if (!visibleTaskProvidersDefaultedForJira) {
          context.loadNeedsSave = true
        }
        const claudeAgentTeamsDefaultDisabledMigrated =
          parsed.settings?.claudeAgentTeamsDefaultDisabledMigrated === true
        if (!claudeAgentTeamsDefaultDisabledMigrated) {
          context.loadNeedsSave = true
        }
        const migratedDisabledTuiAgents = normalizeDisabledTuiAgents(
          parsed.settings?.disabledTuiAgents
        )
        const migratedAgentYoloDefaults = migrateAgentYoloDefaults(parsed.settings)
        if (
          parsed.settings?.agentYoloDefaultsMigrated !== true ||
          hasUnsupportedTuiAgentArgs('opencode', parsed.settings?.agentDefaultArgs?.opencode) ||
          hasUnsupportedTuiAgentArgs('kilo', parsed.settings?.agentDefaultArgs?.kilo)
        ) {
          context.loadNeedsSave = true
        }
        if (
          !claudeAgentTeamsDefaultDisabledMigrated &&
          !migratedDisabledTuiAgents.includes('claude-agent-teams')
        ) {
          migratedDisabledTuiAgents.push('claude-agent-teams')
        }
        const migratedWindowsRuntimeDefault =
          parsed.settings?.localWindowsRuntimeDefault === undefined
            ? deriveGlobalWindowsRuntimeDefaultFromLegacySettings(parsed.settings).defaultRuntime
            : parsed.settings.localWindowsRuntimeDefault
        if (
          parsed.settings?.localWindowsRuntimeDefault === undefined &&
          migratedWindowsRuntimeDefault.kind === 'wsl'
        ) {
          context.loadNeedsSave = true
        }
        const localAccountRuntimeAlreadyMigrated =
          parsed.settings?.localAccountRuntimeDefaultedToAutoForAllUsers === true
        const migratedLocalAccountRuntime: GlobalSettings['localAccountRuntime'] =
          localAccountRuntimeAlreadyMigrated
            ? (parsed.settings?.localAccountRuntime ?? defaults.settings.localAccountRuntime)
            : parsed.settings?.localAccountRuntime === 'wsl'
              ? 'wsl'
              : 'auto'
        if (!localAccountRuntimeAlreadyMigrated) {
          context.loadNeedsSave = true
        }
        if (!autoRenameBranchFromWorkDefaultedOn) {
          context.loadNeedsSave = true
        }
        const normalizedOnboarding = normalizeLoadedOnboardingState(
          parsed.onboarding,
          defaults.onboarding
        )
        if (!parsed.onboarding) {
          context.loadNeedsSave = true
        }
        const normalizedProjectGroups = normalizeProjectGroups(parsed.projectGroups)
        const loadedCompactWorktreeCards =
          parsed.settings?.compactWorktreeCards ??
          parsed.settings?.experimentalCompactWorktreeCards ??
          defaults.settings.compactWorktreeCards
        const normalizedSourceControlGroupOrder = normalizeSourceControlGroupOrder(
          parsed.settings?.sourceControlGroupOrder
        )
        if (
          parsed.settings?.sourceControlGroupOrder !== undefined &&
          parsed.settings.sourceControlGroupOrder !== normalizedSourceControlGroupOrder
        ) {
          context.loadNeedsSave = true
        }
        result = {
          ...defaults,
          ...parsed,
          featureInteractionTelemetryBuckets: normalizeFeatureInteractionTelemetryBuckets(
            parsed.featureInteractionTelemetryBuckets
          ),
          projectGroups: normalizedProjectGroups,
          folderWorkspaces: normalizeFolderWorkspaces(
            parsed.folderWorkspaces,
            normalizedProjectGroups
          ),
          worktreeLineageById: parsed.worktreeLineageById ?? {},
          mobileClientTabSelectionsByDeviceId: normalizePersistedMobileClientTabSelections(
            parsed.mobileClientTabSelectionsByDeviceId
          ),
          workspaceLineageByChildKey: normalizeWorkspaceLineageByChildKey(
            parsed.workspaceLineageByChildKey
          ),
          settings: {
            ...defaults.settings,
            ...stripLegacyTerminalScrollbackBytes(parsed.settings),
            prBotAuthorOverrides: normalizePRBotAuthorOverrides(
              parsed.settings?.prBotAuthorOverrides
            ),
            experimentalPet:
              parsed.settings?.experimentalPet ?? readLegacySidekickFlag(parsed) ?? false,
            primarySelectionMiddleClickPaste: migratePrimarySelectionPlatformDefault
              ? true
              : (parsed.settings?.primarySelectionMiddleClickPaste ??
                defaults.settings.primarySelectionMiddleClickPaste),
            primarySelectionMiddleClickPasteDefaultedForLinux:
              primarySelectionDefaultedForLinux ||
              (process.platform === 'linux' && migratePrimarySelectionPlatformDefault),
            primarySelectionMiddleClickPasteDefaultedForTerminalDefaults:
              primarySelectionDefaultedForTerminalDefaults || stampPrimarySelectionTerminalDefaults,
            ...migratedAutoRenameBranchFromWork,
            ...migratedTerminalCursorStyle,
            terminalLineHeight: migratedTerminalLineHeight,
            terminalRightClickToPaste: terminalRightClickToPasteDefaultedForPlatform
              ? (parsed.settings?.terminalRightClickToPaste ??
                defaults.settings.terminalRightClickToPaste)
              : parsed.settings?.terminalRightClickToPaste === false
                ? false
                : defaults.settings.terminalRightClickToPaste,
            terminalRightClickToPasteDefaultedForPlatform: true,
            ...migratedTerminalTuiScrollSensitivity.settings,
            experimentalActivity: migratedExperimentalActivity,
            experimentalActivityDefaultedOffForAllUsers: true,
            compactWorktreeCards: loadedCompactWorktreeCards,
            experimentalCompactWorktreeCards: undefined,
            terminalMacOptionAsAlt: migratedOptionAsAlt,
            terminalMacOptionAsAltMigrated: true,
            localWindowsRuntimeDefault: migratedWindowsRuntimeDefault,
            localAccountRuntime: migratedLocalAccountRuntime,
            localAccountRuntimeDefaultedToAutoForAllUsers: true,
            ...migratedOsc52Clipboard,
            floatingTerminalEnabled: migratedFloatingTerminalEnabled,
            floatingTerminalDefaultedForAllUsers: true,
            floatingTerminalCwd: migratedFloatingTerminalCwd,
            floatingTerminalTrustedCwds: migratedFloatingTerminalTrustedCwds,
            floatingTerminalCwdMigratedToAppWorkspace: true,
            terminalScrollbackRows: migratedTerminalScrollback.rows,
            terminalQuickCommands: normalizeTerminalQuickCommands(
              parsed.settings?.terminalQuickCommands
            ),
            terminalCustomThemes: normalizeTerminalCustomThemes(
              parsed.settings?.terminalCustomThemes
            ),
            appIcon: normalizeAppIconId(parsed.settings?.appIcon),
            minimizeToTrayOnClose: parsed.settings?.minimizeToTrayOnClose === true,
            showMenuBarIcon: parsed.settings?.showMenuBarIcon !== false,
            uiLanguage: normalizeUiLanguage(parsed.settings?.uiLanguage),
            defaultTaskSource: taskProviderSettings.defaultTaskSource,
            visibleTaskProviders: taskProviderSettings.visibleTaskProviders,
            visibleTaskProvidersDefaultedForJira: true,
            terminalShortcutPolicy: normalizeTerminalShortcutPolicy(
              parsed.settings?.terminalShortcutPolicy
            ),
            disabledTuiAgents: migratedDisabledTuiAgents,
            ...migratedAgentYoloDefaults,
            claudeAgentTeamsDefaultDisabledMigrated: true,
            openInApplications: normalizeOpenInApplications(parsed.settings?.openInApplications, {
              seedDefaults: true
            }),
            notifications: normalizeNotificationSettings(parsed.settings?.notifications),
            sourceControlAi: migratedSourceControlAi,
            sourceControlGroupOrder: normalizedSourceControlGroupOrder,
            commitMessageAi: projectSourceControlAiToLegacyCommitMessageAi(
              migratedSourceControlAi,
              parsed.settings?.commitMessageAi ?? defaults.settings.commitMessageAi
            ),
            voice: {
              ...getDefaultVoiceSettings(),
              ...parsed.settings?.voice
            }
          },
          ui: (() => {
            const rawSort = parsed.ui?.sortBy
            const sort = normalizeSortBy(rawSort)
            const migrate = !parsed.ui?._sortBySmartMigrated && rawSort === 'recent'
            const rightSidebarOpen =
              typeof parsed.ui?.rightSidebarOpen === 'boolean'
                ? parsed.ui.rightSidebarOpen
                : typeof parsed.settings?.rightSidebarOpenByDefault === 'boolean'
                  ? parsed.settings.rightSidebarOpenByDefault
                  : defaults.ui.rightSidebarOpen
            if (typeof parsed.ui?.rightSidebarOpen !== 'boolean') {
              context.loadNeedsSave = true
            }
            const workspaceStatusesDefaultOrderMigrated =
              parsed.ui?._workspaceStatusesDefaultOrderMigrated === true
            const workspaceStatusesReorderedDefaultRepaired =
              parsed.ui?._workspaceStatusesReorderedDefaultRepaired === true
            const workspaceStatusesDefaultWorkflowMigrated =
              parsed.ui?._workspaceStatusesDefaultWorkflowMigrated === true
            const workspaceStatusesDefaultVisualsMigrated =
              parsed.ui?._workspaceStatusesDefaultVisualsMigrated === true
            const workspaceStatuses = normalizePersistedWorkspaceStatuses(
              parsed.ui?.workspaceStatuses,
              {
                migrateDefaultWorkflowStatuses: !workspaceStatusesDefaultWorkflowMigrated,
                repairReorderedDefaultStatuses: !workspaceStatusesReorderedDefaultRepaired,
                migrateLegacyDefaultStatusVisuals: !workspaceStatusesDefaultVisualsMigrated
              }
            )
            if (
              !workspaceStatusesDefaultOrderMigrated ||
              !workspaceStatusesReorderedDefaultRepaired ||
              !workspaceStatusesDefaultWorkflowMigrated ||
              !workspaceStatusesDefaultVisualsMigrated
            ) {
              context.loadNeedsSave = true
            }
            const rawCardProps = parsed.ui?.worktreeCardProperties
            const inlineAgentsMigrated = parsed.ui?._inlineAgentsDefaultedForAllUsers === true
            const expandedCardPropsMigrated =
              parsed.ui?._expandedWorktreeCardPropertiesDefaulted === true
            const jiraIssueCardPropDefaulted =
              parsed.ui?._jiraIssueWorktreeCardPropertyDefaulted === true
            const hadExperimentOn = readDeprecatedExperimentFlag(parsed)
            const deliberateUncheck =
              hadExperimentOn &&
              Array.isArray(rawCardProps) &&
              !rawCardProps.includes('inline-agents')
            const needsInlineAgentsMigration =
              !inlineAgentsMigrated &&
              !deliberateUncheck &&
              Array.isArray(rawCardProps) &&
              !rawCardProps.includes('inline-agents')
            const needsLegacyDefaultedCompactMigration =
              loadedCompactWorktreeCards &&
              parsed.ui?._worktreeCardModeDefaulted === true &&
              isDefaultedCompactWorktreeCardProperties(rawCardProps)
            const migratedCardProps = (() => {
              if (!Array.isArray(rawCardProps)) {
                return undefined
              }
              if (needsLegacyDefaultedCompactMigration) {
                return getWorktreeCardModeProperties('Compact')
              }
              const candidate = needsInlineAgentsMigration
                ? [...rawCardProps, 'inline-agents' as const]
                : rawCardProps
              const expandedCandidate = (() => {
                if (expandedCardPropsMigrated) {
                  return candidate
                }
                const next = [...candidate]
                if (candidate.includes('issue') && !candidate.includes('linear-issue')) {
                  next.push('linear-issue' as const)
                }
                if (!candidate.includes('ports')) {
                  next.push('ports' as const)
                }
                return next
              })()
              const jiraCandidate =
                jiraIssueCardPropDefaulted || expandedCandidate.includes('jira-issue')
                  ? expandedCandidate
                  : [...expandedCandidate, 'jira-issue' as const]
              const normalized = normalizeWorktreeCardProperties(jiraCandidate)
              const changed =
                normalized.length !== rawCardProps.length ||
                normalized.some((property, index) => property !== rawCardProps[index])
              return changed ? normalized : undefined
            })()
            if (
              migratedCardProps !== undefined ||
              !inlineAgentsMigrated ||
              !expandedCardPropsMigrated ||
              !jiraIssueCardPropDefaulted
            ) {
              context.loadNeedsSave = true
            }
            const setupGuideSidebarDismissed = resolveSetupGuideSidebarDismissedOnLoad(
              parsed.ui?.setupGuideSidebarDismissed,
              normalizedOnboarding
            )
            if (
              parsed.ui?.setupGuideSidebarDismissed !== setupGuideSidebarDismissed &&
              (setupGuideSidebarDismissed || parsed.ui?.setupGuideSidebarDismissed !== undefined)
            ) {
              context.loadNeedsSave = true
            }
            const usagePercentageDisplayChangeNoticeDismissed =
              resolveUsagePercentageDisplayChangeNoticeDismissed({
                rawDismissed: parsed.ui?.usagePercentageDisplayChangeNoticeDismissed,
                rawUsagePercentageDisplay: parsed.ui?.usagePercentageDisplay,
                isExistingProfile: isExistingPersistedProfile({
                  repoCount: parsed.repos?.length ?? 0,
                  onboardingClosedAt: normalizedOnboarding.closedAt,
                  ui: parsed.ui
                })
              })
            if (
              parsed.ui?.usagePercentageDisplayChangeNoticeDismissed !==
              usagePercentageDisplayChangeNoticeDismissed
            ) {
              context.loadNeedsSave = true
            }
            return {
              ...defaults.ui,
              worktreeCardProperties: getWorktreeCardModeProperties(
                loadedCompactWorktreeCards ? 'Compact' : 'Default'
              ),
              ...stripMainOwnedTelemetryMarkerFromUI(parsed.ui),
              rightSidebarOpen,
              rightSidebarTab: normalizeRightSidebarTab(parsed.ui?.rightSidebarTab),
              setupGuideSidebarDismissed,
              usagePercentageDisplayChangeNoticeDismissed,
              setupGuideBrowserMilestoneMigrated:
                typeof parsed.ui?.setupGuideBrowserMilestoneMigrated === 'boolean'
                  ? parsed.ui.setupGuideBrowserMilestoneMigrated
                  : false,
              setupGuideBrowserMilestoneLegacyComplete:
                parsed.ui?.setupGuideBrowserMilestoneLegacyComplete === true,
              osc52ClipboardDefaultOnNoticePending: osc52ClipboardNoticePending,
              sortBy: migrate ? ('smart' as const) : sort,
              showDotfilesByWorktree: normalizeShowDotfilesByWorktree(
                parsed.ui?.showDotfilesByWorktree
              ),
              workspaceStatuses,
              _workspaceStatusesDefaultOrderMigrated: true,
              _workspaceStatusesReorderedDefaultRepaired: true,
              _workspaceStatusesDefaultWorkflowMigrated: true,
              _workspaceStatusesDefaultVisualsMigrated: true,
              _sortBySmartMigrated: true,
              ...(migratedCardProps !== undefined
                ? { worktreeCardProperties: migratedCardProps }
                : {}),
              _inlineAgentsDefaultedForExperiment: true,
              _inlineAgentsDefaultedForAllUsers: true,
              _expandedWorktreeCardPropertiesDefaulted: true,
              _jiraIssueWorktreeCardPropertyDefaulted: true
            }
          })(),
          workspaceSession: (() => {
            if (parsed.workspaceSession === undefined) {
              return defaults.workspaceSession
            }
            const result = parseWorkspaceSession(parsed.workspaceSession)
            if (!result.ok) {
              console.error(
                '[persistence] Corrupt workspace session, using defaults:',
                result.error
              )
              return defaults.workspaceSession
            }
            return { ...defaults.workspaceSession, ...result.value }
          })(),
          workspaceSessionsByHostId: parseWorkspaceSessionsByHostId(
            parsed.workspaceSessionsByHostId,
            defaults.workspaceSession
          ),
          sshTargets: (parsed.sshTargets ?? []).map(normalizeSshTarget),
          deletedSshConfigAliases: Array.isArray(parsed.deletedSshConfigAliases)
            ? parsed.deletedSshConfigAliases.filter(
                (alias): alias is string => typeof alias === 'string'
              )
            : [],
          sshRemotePtyLeases: (parsed.sshRemotePtyLeases ?? [])
            .map(normalizeSshRemotePtyLease)
            .filter((lease): lease is SshRemotePtyLease => lease !== null),
          claudeLivePtySessionIds: normalizeClaudeLivePtySessionIds(parsed.claudeLivePtySessionIds),
          migrationUnsupportedPtyEntries: normalizeMigrationUnsupportedPtyEntries(
            parsed.migrationUnsupportedPtyEntries
          ),
          legacyPaneKeyAliasEntries: normalizeLegacyPaneKeyAliasEntries(
            parsed.legacyPaneKeyAliasEntries
          ),
          automations: Array.isArray(parsed.automations) ? parsed.automations : [],
          automationRuns: (() => {
            if (!Array.isArray(parsed.automationRuns)) {
              return []
            }
            const runs = pruneAutomationRuns(backfillAutomationRunNumbers(parsed.automationRuns))
            if (runs.length !== parsed.automationRuns.length) {
              context.loadNeedsSave = true
            }
            return runs
          })(),
          onboarding: normalizedOnboarding
        }
      }
    } catch (err) {
      console.error('[persistence] Failed to load primary state, trying backups:', err)
    }

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

