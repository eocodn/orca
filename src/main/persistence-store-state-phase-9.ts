import { app, safeStorage } from 'electron'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  unlinkSync,
  copyFileSync,
  statSync,
  realpathSync
} from 'node:fs'
import { rename, mkdir, rm, copyFile, open } from 'node:fs/promises'
import { renameDurableSync, writeFileDurableSync } from './durable-file-write'
import { join, dirname, isAbsolute, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import type {
  Automation,
  AutomationCreateInput,
  AutomationDispatchResult,
  AutomationPrecheckResult,
  AutomationRunOutputSnapshot,
  AutomationRun,
  AutomationSchedulerOwner,
  AutomationRunTrigger,
  AutomationUpdateInput
} from '../shared/automations-types'
import {
  latestAutomationOccurrenceAtOrBefore,
  nextAutomationOccurrenceAfter
} from '../shared/automation-schedules'
import { getAutomationLegacyRepoId } from '../shared/automation-run-identity'
import { normalizeAutomationPrecheck } from '../shared/automation-precheck'
import type {
  PersistedState,
  Project,
  ProjectUpdateArgs,
  ProjectHostSetup,
  ProjectHostSetupCreateArgs,
  ProjectHostSetupCreateResult,
  ProjectHostSetupDeleteArgs,
  ProjectHostSetupDeleteResult,
  ProjectHostSetupUpdateArgs,
  ProjectHostSetupUpdateResult,
  RepoProjectHostSetupMethod,
  Repo,
  ProjectGroup,
  FolderWorkspace,
  SparsePreset,
  PersistedMobileClientTabSelections,
  WorktreeMeta,
  WorktreeLineage,
  WorkspaceLineage,
  WorkspaceKey,
  GlobalSettings,
  OrcaWorkspaceLayout,
  NotificationSettings,
  OnboardingChecklistState,
  OnboardingOutcome,
  OnboardingState,
  LegacyPaneKeyAliasEntry,
  TerminalPaneLayoutNode,
  TerminalLayoutSnapshot,
  TerminalTab,
  WorkspaceSessionPatch,
  WorkspaceSessionState
} from '../shared/types'
import {
  deriveGlobalWindowsRuntimeDefaultFromLegacySettings,
  normalizeProjectRuntimePreference
} from '../shared/project-execution-runtime'
import { projectHostSetupProjectionFromRepos } from '../shared/project-host-setup-projection'
import { isPluginPanelTabKey } from '../shared/plugins/plugin-manifest'
import type { GitRemoteIdentity } from '../shared/git-remote-identity'
import {
  areTaskSourceContextsEqual,
  buildTaskSourceContextFromRepo,
  buildWorkspaceRunContext,
  normalizeStoredTaskSourceContext
} from '../shared/task-source-context'
import {
  areWorkspaceLinkedItemsEqual,
  normalizeWorkspaceLinkedItem
} from '../shared/workspace-linked-item'
import { isWorkspaceLinkedItemSourceContextMatch } from '../shared/workspace-linked-item-source-context'
import type { MigrationUnsupportedPtyEntry } from '../shared/agent-status-types'
import { MOBILE_PAIRING_USERDATA_FILES } from './runtime/mobile-pairing-files'
import { normalizePersistedMobileClientTabSelections } from './runtime/client-session-tab-selection-persistence'
import { sanitizeWorkspaceSessionTerminalRetirements } from './runtime/mobile-session-terminal-persistence-retirement'
import {
  removeRepoFromHostWorkspaceSessions,
  removeRepoFromWorkspaceSession
} from './orca-profiles/profile-project-session-state'
import { hardenExistingSecureFile } from '../shared/secure-file'
import {
  LEGACY_DEFAULT_SSH_RELAY_GRACE_PERIOD_SECONDS,
  type RemovedSshTargetTombstone,
  type SshRemotePtyLease,
  type SshTarget
} from '../shared/ssh-types'
import { isFolderRepo } from '../shared/repo-kind'
import {
  getRepoExecutionHostId,
  parseExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  normalizeExecutionHostOrder,
  normalizeExecutionHostId,
  normalizeVisibleExecutionHostIds,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../shared/execution-host'
import {
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
  ONBOARDING_FINAL_STEP
} from '../shared/constants'
import { parseWorkspaceSession } from '../shared/workspace-session-schema'
import { normalizeUsagePercentageDisplay } from '../shared/usage-percentage-display'
import { normalizeStatusBarUsageMode } from '../shared/status-bar-usage-mode'
import { isExistingPersistedProfile } from '../shared/project-order-manual-default-notice'
import { resolveUsagePercentageDisplayChangeNoticeDismissed } from '../shared/usage-percentage-display-change-notice'
import { normalizePRBotAuthorOverrides } from '../shared/pr-bot-author-overrides'
import { toRelaySshPtyId } from './providers/ssh-pty-id'
import {
  migrateUiHostScopeSshTargetId,
  migrateWorkspaceSessionSshTargetId
} from './ssh/ssh-target-id-migration'
import { isWslUncPath } from '../shared/wsl-paths'
import {
  isTerminalLeafId,
  makePaneKey,
  parseLegacyNumericPaneKey,
  parsePaneKey
} from '../shared/stable-pane-id'
import {
  setMigrationUnsupportedPty,
  setMigrationUnsupportedPtyPersistenceListener
} from './agent-hooks/migration-unsupported-pty-state'
import { agentHookServer } from './agent-hooks/server'
import { pruneLocalTerminalScrollbackBuffers } from '../shared/workspace-session-terminal-buffers'
import {
  backfillAutomationRunNumbers,
  nextAutomationRunNumber,
  pruneAutomationRuns
} from '../shared/automation-run-retention'
import { pruneWorkspaceSessionBrowserHistory } from '../shared/workspace-session-browser-history'
import {
  FOLDER_WORKSPACE_INSTANCE_SEPARATOR,
  getRepoIdFromWorktreeId,
  getWorktreePathBasenameFromId
} from '../shared/worktree-id'
import {
  isPathInsideOrEqual,
  isWindowsAbsolutePathLike,
  normalizeRuntimePathForComparison
} from '../shared/cross-platform-path'
import { normalizeTerminalQuickCommands } from '../shared/terminal-quick-commands'
import { normalizeTaskProviderSettings } from '../shared/task-providers'
import { normalizeAutoRenameBranchFromWorkDefaultOn } from '../shared/auto-rename-branch-from-work-settings'
import { normalizeOpenInApplications } from '../shared/open-in-applications'
import { normalizeTerminalShortcutPolicy } from '../shared/keybindings'
import { normalizeSourceControlGroupOrder } from '../shared/source-control-group-order'
import { normalizeAppIconId } from '../shared/app-icon'
import { normalizeTerminalCustomThemes } from '../shared/terminal-custom-themes'
import {
  legacyTerminalScrollbackBytesToRows,
  normalizeDesktopTerminalScrollbackRows
} from '../shared/terminal-scrollback-policy'
import {
  compareFeatureInteractionUsageBuckets,
  getFeatureInteractionCategory,
  getFeatureInteractionUsageBucket,
  normalizeFeatureInteractions,
  normalizeFeatureInteractionTelemetryBuckets,
  type FeatureInteractionId
} from '../shared/feature-interactions'
import { normalizeContextualTourIds } from '../shared/contextual-tours'
import { normalizeFeatureTipIds } from '../shared/feature-tips'
import {
  parseCodexResetCreditAttemptLedger,
  type CodexResetCreditAttemptLedger
} from '../shared/codex-reset-credit-attempt-ledger'
import { normalizeManualRepoOrder } from '../shared/manual-repo-order'
import {
  DEFAULT_WORKSPACE_STATUS_ID,
  clampWorkspaceBoardColumnWidth,
  clampWorkspaceBoardOpacity,
  normalizePersistedWorkspaceStatuses,
  normalizeWorkspaceStatuses
} from '../shared/workspace-statuses'
import { clampMarkdownTocPanelWidth } from '../shared/markdown-toc-panel-width'
import { clampCombinedDiffFileTreeWidth } from '../shared/combined-diff-file-tree-width'
import { isLegacyRepoForExternalWorktreeVisibility } from '../shared/worktree-ownership'
import { sanitizeRepoIcon } from '../shared/repo-icon'
import { normalizeRepoBadgeColor } from '../shared/repo-badge-color'
import {
  clearMissingProjectGroupMemberships,
  createProjectGroup,
  getNextProjectGroupOrder,
  getProjectGroupSubtreeIds,
  normalizeProjectGroupName,
  normalizeProjectGroups
} from '../shared/project-groups'
import { createNestedProjectGroupResolver } from './project-groups/nested-repo-import'
import {
  mergeLegacyCommitMessageAiIntoSourceControlAi,
  normalizeRepoSourceControlAiOverrides,
  normalizeSourceControlAiSettings,
  projectSourceControlAiToLegacyCommitMessageAi,
  sourceControlAiSettingsFromLegacy
} from '../shared/source-control-ai'
import {
  DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES,
  SOURCE_CONTROL_TEXT_ACTION_IDS
} from '../shared/source-control-ai-actions'
import { normalizeDisabledTuiAgents } from '../shared/tui-agent-selection'
import {
  DEFAULT_TUI_AGENT_ARGS,
  DEFAULT_TUI_AGENT_ENV,
  hasUnsupportedTuiAgentArgs,
  normalizeTuiAgentArgsRecord,
  normalizeTuiAgentEnvRecord
} from '../shared/tui-agent-launch-defaults'
import { normalizeTerminalCursorStyleDefault } from '../shared/terminal-cursor-style-settings'
import {
  normalizeOsc52ClipboardDefaultOn,
  osc52ClipboardDefaultOnOverridesPersistedOff
} from '../shared/osc52-clipboard-settings'
import { normalizeTerminalLineHeight } from '../shared/terminal-line-height-settings'
import { normalizeUiLanguage } from '../shared/ui-language'
import { normalizeBrowserPageZoomLevel } from '../shared/browser-page-zoom'
import { persistedUIValuesEqual } from '../shared/persisted-ui-equality'
import { ActiveViewPreference } from './active-view-preference'
import {
  normalizeFolderWorkspaceName,
  normalizeFolderWorkspaceOperationId,
  normalizeFolderWorkspaces
} from '../shared/folder-workspaces'
import {
  folderWorkspaceKey,
  isWorkspaceKey,
  parseWorkspaceKey,
  worktreeWorkspaceKey
} from '../shared/workspace-scope'
import {
  collectTerminalScrollbackSnapshotRefs,
  deleteTerminalScrollbackSnapshotSync,
  getProfileTerminalScrollbackSnapshotRoot,
  migrateWorkspaceSessionTerminalScrollbackSnapshots,
  readTerminalScrollbackSnapshotSync,
  type TerminalScrollbackSnapshotStorage
} from './terminal-scrollback-snapshots'
import { track } from './telemetry/client'
import { getCohortAtEmit } from './telemetry/cohort-classifier'
import { isStartupDiagnosticsEnabled, logStartupDiagnostic } from './startup/startup-diagnostics'
import {
  cloneLayoutNode,
  cloneLayoutWithLeafIds,
  collectLayoutLeafCounts,
  collectLayoutLeafIdsInOrder,
  findWorktreeIdForTab,
  firstLayoutLeafId,
  leafRecordEquivalent,
  layoutContainsLeafId,
  preserveMissingLeafRecordEntries,
  remapLeafRecordForPersistence
} from './persistence-layout-records'

import { removeWorkspaceSessionOwner,
  removeWorkspaceSessionOwners,
  inferFolderScopeConnectionIdForMigration,
  backfillFolderScopeConnectionIds,
  deleteRemovedTerminalScrollbackSnapshots,
  type StoreOptions,
  getDefaultWorktreeMeta } from './persistence-state-phase-8'
import { StorePhase8 } from './persistence-store-write-lifecycle'

export class StorePhase9 extends StorePhase8 {
  updateSettings(
    updates: Partial<GlobalSettings>,
    options: { notifyListeners?: boolean; originWebContentsId?: number } = {}
  ): GlobalSettings {
    const sanitizedUpdates = stripLegacyTerminalScrollbackBytes(updates)
    // Why: coerce to boolean here (not the IPC edge) so every write path is covered and a truthy non-bool can't persist as "tray-minimize on".
    if ('minimizeToTrayOnClose' in updates) {
      sanitizedUpdates.minimizeToTrayOnClose = updates.minimizeToTrayOnClose === true
    }
    if ('showMenuBarIcon' in updates) {
      sanitizedUpdates.showMenuBarIcon = updates.showMenuBarIcon === true
    }
    if ('disabledTuiAgents' in updates) {
      sanitizedUpdates.disabledTuiAgents = normalizeDisabledTuiAgents(updates.disabledTuiAgents)
    }
    if ('agentDefaultArgs' in updates) {
      sanitizedUpdates.agentDefaultArgs = normalizeTuiAgentArgsRecord(updates.agentDefaultArgs)
      sanitizedUpdates.agentYoloDefaultsMigrated = true
    }
    if ('agentDefaultEnv' in updates) {
      sanitizedUpdates.agentDefaultEnv = normalizeTuiAgentEnvRecord(updates.agentDefaultEnv)
      sanitizedUpdates.agentYoloDefaultsMigrated = true
    }
    if ('terminalQuickCommands' in updates) {
      sanitizedUpdates.terminalQuickCommands = normalizeTerminalQuickCommands(
        updates.terminalQuickCommands
      )
    }
    if ('terminalCustomThemes' in updates) {
      sanitizedUpdates.terminalCustomThemes = normalizeTerminalCustomThemes(
        updates.terminalCustomThemes
      )
    }
    if ('terminalScrollbackRows' in updates) {
      sanitizedUpdates.terminalScrollbackRows = normalizeDesktopTerminalScrollbackRows(
        updates.terminalScrollbackRows
      )
    }
    if (
      'terminalTuiScrollSensitivity' in updates ||
      'terminalTuiScrollSensitivityDefaultedToOne' in updates
    ) {
      sanitizedUpdates.terminalTuiScrollSensitivityDefaultedToOne = true
    }
    if ('visibleTaskProviders' in updates || 'defaultTaskSource' in updates) {
      const taskProviderSettings = normalizeTaskProviderSettings({
        visibleTaskProviders:
          'visibleTaskProviders' in updates
            ? updates.visibleTaskProviders
            : this.state.settings.visibleTaskProviders,
        defaultTaskSource:
          'defaultTaskSource' in updates
            ? updates.defaultTaskSource
            : this.state.settings.defaultTaskSource
      })
      sanitizedUpdates.defaultTaskSource = taskProviderSettings.defaultTaskSource
      sanitizedUpdates.visibleTaskProviders = taskProviderSettings.visibleTaskProviders
      if ('visibleTaskProviders' in updates) {
        sanitizedUpdates.visibleTaskProvidersDefaultedForJira = true
      }
    }
    if ('autoRenameBranchFromWork' in updates || 'autoRenameBranchFromWorkDefaultedOn' in updates) {
      sanitizedUpdates.autoRenameBranchFromWorkDefaultedOn = true
    }
    if ('openInApplications' in updates) {
      sanitizedUpdates.openInApplications = normalizeOpenInApplications(updates.openInApplications)
    }
    if ('terminalShortcutPolicy' in updates) {
      sanitizedUpdates.terminalShortcutPolicy = normalizeTerminalShortcutPolicy(
        updates.terminalShortcutPolicy
      )
    }
    if ('sourceControlGroupOrder' in updates) {
      sanitizedUpdates.sourceControlGroupOrder = normalizeSourceControlGroupOrder(
        updates.sourceControlGroupOrder
      )
    }
    if ('appIcon' in updates) {
      sanitizedUpdates.appIcon = normalizeAppIconId(updates.appIcon)
    }
    if ('uiLanguage' in updates) {
      sanitizedUpdates.uiLanguage = normalizeUiLanguage(updates.uiLanguage)
    }
    if ('prBotAuthorOverrides' in updates) {
      // Why: every writer (desktop IPC, web RPC, migrations) hits this boundary, so the persisted list stays bounded and well-formed.
      sanitizedUpdates.prBotAuthorOverrides = normalizePRBotAuthorOverrides(
        updates.prBotAuthorOverrides
      )
    }
    const historyWithPreviousLayout = buildWorkspaceDirHistoryForUpdate(
      this.state.settings,
      sanitizedUpdates
    )
    if (historyWithPreviousLayout) {
      sanitizedUpdates.workspaceDirHistory = historyWithPreviousLayout
    }
    // Why deep-merge telemetry: a partial update (e.g. flipping only `optedIn`) must not clobber siblings like `installId`.
    const mergedTelemetry =
      sanitizedUpdates.telemetry !== undefined
        ? { ...this.state.settings.telemetry, ...sanitizedUpdates.telemetry }
        : this.state.settings.telemetry
    if ('sourceControlAi' in sanitizedUpdates) {
      sanitizedUpdates.sourceControlAi = retireLegacyInstructionsForClearedTextActionRecipes(
        sanitizedUpdates.sourceControlAi,
        this.state.settings
      )
      const normalizedSourceControlAi = normalizeSourceControlAiSettings(
        sanitizedUpdates.sourceControlAi,
        this.state.settings.commitMessageAi
      )
      sanitizedUpdates.sourceControlAi = normalizedSourceControlAi
      sanitizedUpdates.commitMessageAi = projectSourceControlAiToLegacyCommitMessageAi(
        normalizedSourceControlAi,
        this.state.settings.commitMessageAi
      )
    } else if ('commitMessageAi' in sanitizedUpdates) {
      sanitizedUpdates.sourceControlAi = mergeLegacyCommitMessageAiIntoSourceControlAi(
        this.state.settings.sourceControlAi,
        sanitizedUpdates.commitMessageAi
      )
    }
    const previousSettings = this.state.settings
    this.state.settings = {
      ...this.state.settings,
      ...sanitizedUpdates,
      notifications: normalizeNotificationSettings({
        ...this.state.settings.notifications,
        ...sanitizedUpdates.notifications
      }),
      ...(mergedTelemetry !== undefined ? { telemetry: mergedTelemetry } : {})
    }
    this.scheduleSave()
    const changedUpdates = {} as Partial<GlobalSettings> & Record<string, unknown>
    for (const key of Object.keys(sanitizedUpdates) as (keyof GlobalSettings)[]) {
      if (!Object.is(previousSettings[key], this.state.settings[key])) {
        changedUpdates[String(key)] = this.state.settings[key]
      }
    }
    if (options.notifyListeners === true && Object.keys(changedUpdates).length > 0) {
      this.notifySettingsChanged(changedUpdates, options.originWebContentsId)
    }
    return this.state.settings
  }

  // ── UI State ───────────────────────────────────────────────────────

  getUI(): PersistedState['ui'] {
    const uiState = stripMainOwnedTelemetryMarkerFromUI(this.state.ui)
    return {
      ...getDefaultUIState(),
      ...uiState,
      groupBy: normalizeGroupBy(this.state.ui?.groupBy),
      sortBy: normalizeSortBy(this.state.ui?.sortBy),
      projectOrderBy: normalizeProjectOrderBy(this.state.ui?.projectOrderBy),
      rightSidebarTab: normalizeRightSidebarTab(this.state.ui?.rightSidebarTab),
      rightSidebarExplorerView: normalizeRightSidebarExplorerView(
        this.state.ui?.rightSidebarExplorerView,
        this.state.ui?.rightSidebarTab
      ),
      worktreeCardProperties: normalizeWorktreeCardProperties(
        this.state.ui?.worktreeCardProperties
      ),
      agentActivityDisplayMode: normalizeAgentActivityDisplayMode(
        this.state.ui?.agentActivityDisplayMode
      ),
      workspaceStatuses: normalizeWorkspaceStatuses(this.state.ui?.workspaceStatuses),
      workspaceBoardOpacity: clampWorkspaceBoardOpacity(this.state.ui?.workspaceBoardOpacity),
      workspaceBoardColumnWidth: clampWorkspaceBoardColumnWidth(
        this.state.ui?.workspaceBoardColumnWidth
      ),
      syncTaskStatusFromWorkspaceBoard: this.state.ui?.syncTaskStatusFromWorkspaceBoard === true,
      usagePercentageDisplay: normalizeUsagePercentageDisplay(
        this.state.ui?.usagePercentageDisplay
      ),
      statusBarUsageMode: normalizeStatusBarUsageMode(this.state.ui?.statusBarUsageMode),
      // Why: strict boolean coercion so a missing/legacy value reads as false (first-run notice still fires).
      trayMinimizeNoticeShown: this.state.ui?.trayMinimizeNoticeShown === true,
      osc52ClipboardDefaultOnNoticePending:
        this.state.ui?.osc52ClipboardDefaultOnNoticePending === true,
      markdownTocPanelWidth: clampMarkdownTocPanelWidth(this.state.ui?.markdownTocPanelWidth),
      combinedDiffFileTreeWidth: clampCombinedDiffFileTreeWidth(
        this.state.ui?.combinedDiffFileTreeWidth
      ),
      visibleWorkspaceHostIds: normalizeVisibleExecutionHostIds(
        this.state.ui?.visibleWorkspaceHostIds
      ),
      workspaceHostOrder: normalizeExecutionHostOrder(this.state.ui?.workspaceHostOrder),
      manualRepoOrder: normalizeManualRepoOrder(this.state.ui?.manualRepoOrder),
      browserDefaultZoomLevel: normalizeBrowserPageZoomLevel(
        this.state.ui?.browserDefaultZoomLevel
      ),
      showDotfilesByWorktree: normalizeShowDotfilesByWorktree(
        this.state.ui?.showDotfilesByWorktree
      ),
      featureTipsSeenIds: normalizeFeatureTipIds(this.state.ui?.featureTipsSeenIds),
      contextualToursSeenIds: normalizeContextualTourIds(this.state.ui?.contextualToursSeenIds),
      featureInteractions: normalizeFeatureInteractions(this.state.ui?.featureInteractions),
      activeView: this.activeViewPreference.get()
    }
  }


}
