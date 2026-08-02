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
import { StoreFoundation } from './persistence-store-foundation'

export class StorePhase1 extends StoreFoundation {
  protected load(allowBackupRecovery = true): PersistedState {
    // Capture "has run Orca before?" for telemetry cohort; the telemetry field is new, so field inference misclassifies old users as fresh.
    const dataFile = this.dataFile
    const fileExistedOnLoad = existsSync(dataFile)
    logPersistenceStartupMilestone('persistence-load-start', {
      fileExists: fileExistedOnLoad
    })

    let result: PersistedState | null = null
    try {
      if (fileExistedOnLoad) {
        const readStartedAt = performance.now()
        const raw = readFileSync(dataFile, 'utf-8')
        logPersistenceStartupMilestone('persistence-read-done', {
          bytes: Buffer.byteLength(raw),
          durationMs: Math.round(performance.now() - readStartedAt)
        })
        logPersistenceStartupMilestone('persistence-json-parse-start')
        const parsed = JSON.parse(raw) as PersistedState
        logPersistenceStartupMilestone('persistence-json-parse-done')

        // Why: secrets are stored encrypted via safeStorage; decrypt at the load boundary so the app sees plaintext.
        if (parsed.settings?.opencodeSessionCookie) {
          parsed.settings.opencodeSessionCookie = decrypt(parsed.settings.opencodeSessionCookie)
        }
        if (parsed.settings?.httpProxyUrl) {
          parsed.settings.httpProxyUrl = decrypt(parsed.settings.httpProxyUrl)
        }
        if (parsed.ui?.browserKagiSessionLink) {
          parsed.ui.browserKagiSessionLink = decryptOptionalSecret(parsed.ui.browserKagiSessionLink)
        }

        // Merge with defaults in case new fields were added
        const homeDir = homedir()
        const defaults = getDefaultPersistedState(homeDir)
        const migratedTerminalScrollback = migrateTerminalScrollbackRows(parsed.settings)
        if (migratedTerminalScrollback.needsSave) {
          this.loadNeedsSave = true
        }
        const migratedTerminalTuiScrollSensitivity = migrateTerminalTuiScrollSensitivityDefault(
          parsed.settings
        )
        if (migratedTerminalTuiScrollSensitivity.needsSave) {
          this.loadNeedsSave = true
        }
        const rawSourceControlAi = parsed.settings?.sourceControlAi
        const rawSourceControlAiMissing = rawSourceControlAi === undefined
        const rawSourceControlAiActionsMissing =
          rawSourceControlAi !== undefined && rawSourceControlAi.actions === undefined
        if (rawSourceControlAiMissing || rawSourceControlAiActionsMissing) {
          this.loadNeedsSave = true
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
        // Why (issue #903): old 'true' default broke non-US Option-layer chars; flip 'true'→'auto' once so the layout probe decides.
        const rawOptionAsAlt = parsed.settings?.terminalMacOptionAsAlt
        const alreadyMigrated = parsed.settings?.terminalMacOptionAsAltMigrated === true
        const migratedOptionAsAlt: 'auto' | 'true' | 'false' | 'left' | 'right' = alreadyMigrated
          ? (rawOptionAsAlt ?? 'auto')
          : rawOptionAsAlt === undefined || rawOptionAsAlt === 'true'
            ? 'auto'
            : rawOptionAsAlt
        const floatingTerminalDefaultedForAllUsers =
          parsed.settings?.floatingTerminalDefaultedForAllUsers === true
        // Why: early builds persisted the old off default; flip only unmigrated profiles so a later opt-out survives reload.
        const migratedFloatingTerminalEnabled = floatingTerminalDefaultedForAllUsers
          ? (parsed.settings?.floatingTerminalEnabled ?? true)
          : true
        // Why: the old off default persisted `false` for every profile, indistinguishable from a real opt-out — flip unmigrated profiles once (#10567).
        const migratedOsc52Clipboard = normalizeOsc52ClipboardDefaultOn(parsed.settings)
        const osc52ClipboardNoticePending =
          osc52ClipboardDefaultOnOverridesPersistedOff(parsed.settings) ||
          parsed.ui?.osc52ClipboardDefaultOnNoticePending === true
        if (parsed.settings?.terminalAllowOsc52ClipboardDefaultedOnForAllUsers !== true) {
          this.loadNeedsSave = true
        }
        const floatingTerminalCwdMigrated =
          parsed.settings?.floatingTerminalCwdMigratedToAppWorkspace === true
        // Why: an earlier migration wrote '' for the notes dir; floating terminals still open at home, notes use a separate IPC.
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
          this.loadNeedsSave = true
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
            // Why: pre-grant profiles with an explicit Floating Workspace cwd already showed intent; migrate only that legacy value.
            migratedFloatingTerminalTrustedCwds.push(canonicalLegacyCwd)
            normalizedFloatingTerminalTrustedCwds.changed = true
          }
        }
        if (normalizedFloatingTerminalTrustedCwds.changed) {
          this.loadNeedsSave = true
        }
        const experimentalActivityDefaultedOffForAllUsers =
          parsed.settings?.experimentalActivityDefaultedOffForAllUsers === true
        // Why: the Agents view moved back behind Experimental; flip pre-migration profiles off once, then preserve opt-ins.
        const migratedExperimentalActivity = experimentalActivityDefaultedOffForAllUsers
          ? (parsed.settings?.experimentalActivity ?? false)
          : false
        const autoRenameBranchFromWorkDefaultedOn =
          parsed.settings?.autoRenameBranchFromWorkDefaultedOn === true
        // Why: default-on rollout activates old profiles once, but a later Settings opt-out survives reloads.
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
          this.loadNeedsSave = true
        }
        if (
          parsed.settings?.terminalLineHeight !== undefined &&
          parsed.settings.terminalLineHeight !== migratedTerminalLineHeight
        ) {
          this.loadNeedsSave = true
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
          this.loadNeedsSave = true
        }
        if (!visibleTaskProvidersDefaultedForJira) {
          this.loadNeedsSave = true
        }
        const claudeAgentTeamsDefaultDisabledMigrated =
          parsed.settings?.claudeAgentTeamsDefaultDisabledMigrated === true
        if (!claudeAgentTeamsDefaultDisabledMigrated) {
          this.loadNeedsSave = true
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
          this.loadNeedsSave = true
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
          this.loadNeedsSave = true
        }
        // Why (#9537): migrate the indistinguishable legacy host default once so WSL-default users follow their runtime.
        const localAccountRuntimeAlreadyMigrated =
          parsed.settings?.localAccountRuntimeDefaultedToAutoForAllUsers === true
        const migratedLocalAccountRuntime: GlobalSettings['localAccountRuntime'] =
          localAccountRuntimeAlreadyMigrated
            ? (parsed.settings?.localAccountRuntime ?? defaults.settings.localAccountRuntime)
            : parsed.settings?.localAccountRuntime === 'wsl'
              ? 'wsl'
              : 'auto'
        if (!localAccountRuntimeAlreadyMigrated) {
          this.loadNeedsSave = true
        }
        if (!autoRenameBranchFromWorkDefaultedOn) {
          this.loadNeedsSave = true
        }
        const normalizedOnboarding = normalizeLoadedOnboardingState(
          parsed.onboarding,
          defaults.onboarding
        )
        if (!parsed.onboarding) {
          this.loadNeedsSave = true
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
          this.loadNeedsSave = true
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
            // Why (#7977): keep persisted experimentalNewWorktreeCardStyle:true — v1.4.130's onboarding auto-wrote it as a plain boolean, so it's indistinguishable from a real opt-in; only the default changed.
            ...stripLegacyTerminalScrollbackBytes(parsed.settings),
            prBotAuthorOverrides: normalizePRBotAuthorOverrides(
              parsed.settings?.prBotAuthorOverrides
            ),
            // Why: v1.3.42 renamed the sidekick setting to pet; carry the old flag forward once so enabled users don't lose it.
            experimentalPet:
              parsed.settings?.experimentalPet ?? readLegacySidekickFlag(parsed) ?? false,
            // Why: early builds saved the disabled default; flip Linux/macOS profiles once to match platform, guards keep opt-outs.
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
            // Why: the old true default was inherited, but false was always an explicit opt-out and must survive this one-shot reset.
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
            // Why: compact worktree cards graduated from Experimental; preserve the old opt-in for rollout-era profiles.
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
            // Why: persisted settings may be hand-edited or from older builds; keep tray-minimize false unless stored value is true.
            minimizeToTrayOnClose: parsed.settings?.minimizeToTrayOnClose === true,
            // Why: missing means default-on; round-trips unchanged on non-mac since darwin consumers gate the effect.
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
            // Why: rollback builds still read commitMessageAi, so refresh the legacy projection from sourceControlAi for compat.
            commitMessageAi: projectSourceControlAiToLegacyCommitMessageAi(
              migratedSourceControlAi,
              parsed.settings?.commitMessageAi ?? defaults.settings.commitMessageAi
            ),
            voice: {
              ...getDefaultVoiceSettings(),
              ...parsed.settings?.voice
            }
          },
          // Why: legacy 'recent' meant the smart sort; migrate once on the raw value so a fresh 'recent' default isn't remigrated.
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
              this.loadNeedsSave = true
            }
            const workspaceStatusesDefaultOrderMigrated =
              parsed.ui?._workspaceStatusesDefaultOrderMigrated === true
            // Why: a short-lived default put Done on the left; repair only the exact raw payload once so user reorders survive.
            const workspaceStatusesReorderedDefaultRepaired =
              parsed.ui?._workspaceStatusesReorderedDefaultRepaired === true
            // Why: only exact legacy default payloads migrate; customized status labels/colors/icons/order are kept.
            const workspaceStatusesDefaultWorkflowMigrated =
              parsed.ui?._workspaceStatusesDefaultWorkflowMigrated === true
            // Why: visual migration has its own guard so later user choices of valid legacy color/icon IDs are preserved.
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
              this.loadNeedsSave = true
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
                // Why: Linear rode the 'issue' property and Ports were always shown; split them out once to preserve existing cards.
                if (candidate.includes('issue') && !candidate.includes('linear-issue')) {
                  next.push('linear-issue' as const)
                }
                if (!candidate.includes('ports')) {
                  next.push('ports' as const)
                }
                return next
              })()
              // Why: 'jira-issue' joined the defaults after the expansion migration already stamped upgraded profiles, so it needs its own one-shot backfill.
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
              this.loadNeedsSave = true
            }
            const setupGuideSidebarDismissed = resolveSetupGuideSidebarDismissedOnLoad(
              parsed.ui?.setupGuideSidebarDismissed,
              normalizedOnboarding
            )
            if (
              parsed.ui?.setupGuideSidebarDismissed !== setupGuideSidebarDismissed &&
              (setupGuideSidebarDismissed || parsed.ui?.setupGuideSidebarDismissed !== undefined)
            ) {
              this.loadNeedsSave = true
            }
            // Why: only upgraded profiles still on the new default get the one-time usage-display notice; fresh profiles stay quiet.
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
              this.loadNeedsSave = true
            }
            return {
              ...defaults.ui,
              // Why: missing card properties follow the persisted layout mode; explicit choices are preserved below.
              worktreeCardProperties: getWorktreeCardModeProperties(
                loadedCompactWorktreeCards ? 'Compact' : 'Default'
              ),
              ...stripMainOwnedTelemetryMarkerFromUI(parsed.ui),
              // Why: migrate once from the retired Appearance setting only when no explicit chrome preference exists yet.
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
              // Why persist rather than notify inline: the flip lands during load, before any
              // window exists, and it must survive a crash before the user ever sees the notice.
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
              // Why: keep stamping the legacy flag for rollback forward-compat; the new flag actually gates the migration.
              _inlineAgentsDefaultedForExperiment: true,
              _inlineAgentsDefaultedForAllUsers: true,
              _expandedWorktreeCardPropertiesDefaulted: true,
              _jiraIssueWorktreeCardPropertyDefaulted: true
            }
          })(),
          // Why: volatile schema; zod-validate workspaceSession at read so a bad payload falls to defaults, not a renderer crash.
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
          // Why: per-host session partitions, validated independently; 'local' stays in workspaceSession for downgrade compat.
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
            // Why: nothing else marks dirty, so an oversized legacy file would otherwise only shrink at the next unrelated save.
            if (runs.length !== parsed.automationRuns.length) {
              this.loadNeedsSave = true
            }
            return runs
          })(),
          onboarding: normalizedOnboarding
        }
      }
    } catch (err) {
      console.error('[persistence] Failed to load primary state, trying backups:', err)
    }

    // Corrupt-file and no-file paths converge here; a corrupted install counts as existing, so it sees the opt-in banner.
    if (result === null && allowBackupRecovery) {
      let hasBackup = false
      for (let i = 0; i < BACKUP_COUNT; i++) {
        if (existsSync(backupPath(dataFile, i))) {
          hasBackup = true
          break
        }
      }
      if (fileExistedOnLoad || hasBackup) {
        if (this.restoreFromBackup(dataFile)) {
          return this.load(false)
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
      this.terminalScrollbackSnapshotStorage
    )
    if (migratedScrollback.changed) {
      this.loadNeedsSave = true
    }

    const repos = clearMissingProjectGroupMemberships(result.repos, result.projectGroups ?? [])
    const projectHostSetupCompatibility = mergeProjectHostSetupCompatibilityState(result, repos)
    if (!projectHostSetupCompatibilityStateEqual(result, projectHostSetupCompatibility)) {
      this.loadNeedsSave = true
    }

    const automationContextMigration = backfillLegacyAutomationContexts({
      ...result,
      repos,
      ...projectHostSetupCompatibility
    })
    if (automationContextMigration.changed) {
      this.loadNeedsSave = true
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
      this.loadNeedsSave = true
    }
    result = folderScopeConnectionMigration.state

    if (normalizeWorktreeLinkedItemMetadata(result)) {
      this.loadNeedsSave = true
    }

    if (gcStaleWorktreeMeta(result) > 0) {
      this.loadNeedsSave = true
    }

    const migrated = this.migrateTabSwitchKeybindings(
      this.migrateTelemetry(result, fileExistedOnLoad),
      fileExistedOnLoad
    )

    // githubCache is a sidecar file now (see getGithubCacheFile); legacy in-file caches seed the session, then get stripped.
    const legacyCache = migrated.githubCache
    const hasLegacyCache =
      Object.keys(legacyCache?.pr ?? {}).length > 0 ||
      Object.keys(legacyCache?.issue ?? {}).length > 0
    if (hasLegacyCache) {
      this.loadNeedsSave = true
      // Why: mark dirty so the first flush writes the sidecar even without a poll refresh this session, preserving the seed.
      this.githubCacheDirty = true
    } else {
      migrated.githubCache = readGithubCacheSnapshot(this.dataFile) ?? migrated.githubCache
    }

    logPersistenceStartupMilestone('persistence-load-done', {
      repos: migrated.repos.length,
      workspaceSessionBytes: Buffer.byteLength(JSON.stringify(migrated.workspaceSession))
    })
    return migrated
  }

  // One-shot telemetry cohort migration: seeds existedBeforeTelemetryRelease, optedIn, and installId (no-op once set).
  // One-shot tab-switch cohort freeze: fileExistedOnLoad tells existing vs fresh only on the first launch, so persist now.

}
