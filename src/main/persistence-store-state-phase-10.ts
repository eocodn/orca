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
import { StorePhase9 } from './persistence-store-state-phase-9'
import { StorePhase9 } from './persistence-store-state-phase-9'

export class StorePhase10 extends StorePhase9 {
  updateUI(updates: Partial<PersistedState['ui']>): void {
    const sanitizedUpdates = stripMainOwnedTelemetryMarkerFromUI(updates)
    const { activeView, ...durableUpdates } = sanitizedUpdates
    const activeViewChanged = this.activeViewPreference.set(activeView)
    if (Object.keys(durableUpdates).length === 0) {
      if (activeViewChanged) {
        this.notifyUIChanged()
      }
      return
    }
    const currentUI = {
      ...getDefaultUIState(),
      ...stripMainOwnedTelemetryMarkerFromUI(this.state.ui)
    }
    const previousUI = {
      ...this.getUI(),
      // Why: the legacy field stays unchanged as a migration/downgrade
      // fallback; the profile sidecar is authoritative in current builds.
      activeView: currentUI.activeView
    }
    const nextRightSidebarTab =
      sanitizedUpdates.rightSidebarTab !== undefined
        ? normalizeRightSidebarTab(sanitizedUpdates.rightSidebarTab)
        : normalizeRightSidebarTab(this.state.ui?.rightSidebarTab)
    const nextRightSidebarExplorerView =
      sanitizedUpdates.rightSidebarExplorerView !== undefined
        ? normalizeRightSidebarExplorerView(
            sanitizedUpdates.rightSidebarExplorerView,
            nextRightSidebarTab
          )
        : sanitizedUpdates.rightSidebarTab === 'search'
          ? 'search'
          : normalizeRightSidebarExplorerView(
              this.state.ui?.rightSidebarExplorerView,
              nextRightSidebarTab
            )
    const nextUI = {
      ...currentUI,
      ...durableUpdates,
      groupBy: durableUpdates.groupBy
        ? normalizeGroupBy(durableUpdates.groupBy)
        : normalizeGroupBy(this.state.ui?.groupBy),
      sortBy: durableUpdates.sortBy
        ? normalizeSortBy(durableUpdates.sortBy)
        : normalizeSortBy(this.state.ui?.sortBy),
      projectOrderBy: updates.projectOrderBy
        ? normalizeProjectOrderBy(updates.projectOrderBy)
        : normalizeProjectOrderBy(this.state.ui?.projectOrderBy),
      activeView: currentUI.activeView,
      rightSidebarTab: nextRightSidebarTab,
      rightSidebarExplorerView: nextRightSidebarExplorerView,
      worktreeCardProperties:
        sanitizedUpdates.worktreeCardProperties !== undefined
          ? normalizeWorktreeCardProperties(sanitizedUpdates.worktreeCardProperties)
          : normalizeWorktreeCardProperties(this.state.ui?.worktreeCardProperties),
      agentActivityDisplayMode:
        updates.agentActivityDisplayMode !== undefined
          ? normalizeAgentActivityDisplayMode(updates.agentActivityDisplayMode)
          : normalizeAgentActivityDisplayMode(this.state.ui?.agentActivityDisplayMode),
      workspaceStatuses:
        sanitizedUpdates.workspaceStatuses !== undefined
          ? normalizeWorkspaceStatuses(sanitizedUpdates.workspaceStatuses)
          : normalizeWorkspaceStatuses(this.state.ui?.workspaceStatuses),
      workspaceBoardOpacity: clampWorkspaceBoardOpacity(
        sanitizedUpdates.workspaceBoardOpacity ?? this.state.ui?.workspaceBoardOpacity
      ),
      workspaceBoardColumnWidth: clampWorkspaceBoardColumnWidth(
        sanitizedUpdates.workspaceBoardColumnWidth ?? this.state.ui?.workspaceBoardColumnWidth
      ),
      syncTaskStatusFromWorkspaceBoard:
        sanitizedUpdates.syncTaskStatusFromWorkspaceBoard !== undefined
          ? sanitizedUpdates.syncTaskStatusFromWorkspaceBoard === true
          : this.state.ui?.syncTaskStatusFromWorkspaceBoard === true,
      usagePercentageDisplay: normalizeUsagePercentageDisplay(
        sanitizedUpdates.usagePercentageDisplay ?? this.state.ui?.usagePercentageDisplay
      ),
      statusBarUsageMode: normalizeStatusBarUsageMode(
        sanitizedUpdates.statusBarUsageMode ?? this.state.ui?.statusBarUsageMode
      ),
      markdownTocPanelWidth: clampMarkdownTocPanelWidth(
        sanitizedUpdates.markdownTocPanelWidth ?? this.state.ui?.markdownTocPanelWidth
      ),
      combinedDiffFileTreeWidth: clampCombinedDiffFileTreeWidth(
        sanitizedUpdates.combinedDiffFileTreeWidth ?? this.state.ui?.combinedDiffFileTreeWidth
      ),
      visibleWorkspaceHostIds:
        updates.visibleWorkspaceHostIds !== undefined
          ? normalizeVisibleExecutionHostIds(updates.visibleWorkspaceHostIds)
          : normalizeVisibleExecutionHostIds(this.state.ui?.visibleWorkspaceHostIds),
      workspaceHostOrder:
        updates.workspaceHostOrder !== undefined
          ? normalizeExecutionHostOrder(updates.workspaceHostOrder)
          : normalizeExecutionHostOrder(this.state.ui?.workspaceHostOrder),
      manualRepoOrder:
        updates.manualRepoOrder !== undefined
          ? normalizeManualRepoOrder(updates.manualRepoOrder)
          : normalizeManualRepoOrder(this.state.ui?.manualRepoOrder),
      browserDefaultZoomLevel: normalizeBrowserPageZoomLevel(
        updates.browserDefaultZoomLevel ?? this.state.ui?.browserDefaultZoomLevel
      ),
      showDotfilesByWorktree:
        updates.showDotfilesByWorktree !== undefined
          ? normalizeShowDotfilesByWorktree(updates.showDotfilesByWorktree)
          : normalizeShowDotfilesByWorktree(this.state.ui?.showDotfilesByWorktree),
      featureTipsSeenIds:
        sanitizedUpdates.featureTipsSeenIds !== undefined
          ? normalizeFeatureTipIds(sanitizedUpdates.featureTipsSeenIds)
          : normalizeFeatureTipIds(this.state.ui?.featureTipsSeenIds),
      // Why: renderer and paired clients can mark different tours seen from stale snapshots; union so completed tours stay suppressed.
      contextualToursSeenIds:
        updates.contextualToursSeenIds !== undefined
          ? mergeContextualTourSeenIds(
              this.state.ui?.contextualToursSeenIds,
              updates.contextualToursSeenIds
            )
          : normalizeContextualTourIds(this.state.ui?.contextualToursSeenIds),
      // Why: runtime RPCs and the renderer both record education state; merge so a stale renderer snapshot can't erase runtime-only interactions.
      featureInteractions:
        sanitizedUpdates.featureInteractions !== undefined
          ? mergeFeatureInteractions(
              this.state.ui?.featureInteractions,
              sanitizedUpdates.featureInteractions
            )
          : normalizeFeatureInteractions(this.state.ui?.featureInteractions)
    }
    if (persistedUIValuesEqual(previousUI, nextUI)) {
      if (activeViewChanged) {
        this.notifyUIChanged()
      }
      return
    }
    this.state.ui = nextUI
    this.scheduleSave()
    this.notifyUIChanged()
  }

  recordFeatureInteraction(id: FeatureInteractionId): PersistedState['ui'] {
    const featureInteractions = normalizeFeatureInteractions(this.state.ui?.featureInteractions)
    const telemetryBuckets = normalizeFeatureInteractionTelemetryBuckets(
      this.state.featureInteractionTelemetryBuckets
    )
    const existing = featureInteractions[id]
    const previousCount = existing?.interactionCount ?? 0
    const nextCount = previousCount + 1
    const previousBucket = getFeatureInteractionUsageBucket(previousCount)
    const nextBucket = getFeatureInteractionUsageBucket(nextCount)
    const lastEmittedBucket = telemetryBuckets[id] ?? null
    const shouldEmit =
      nextBucket !== null &&
      (lastEmittedBucket === null ||
        compareFeatureInteractionUsageBuckets(nextBucket, lastEmittedBucket) > 0)

    this.updateUI({
      featureInteractions: {
        ...featureInteractions,
        [id]: {
          firstInteractedAt: existing?.firstInteractedAt ?? Date.now(),
          interactionCount: nextCount
        }
      }
    })
    this.state.featureInteractionTelemetryBuckets = shouldEmit
      ? { ...telemetryBuckets, [id]: nextBucket }
      : telemetryBuckets
    this.scheduleSave()

    if (shouldEmit) {
      track('feature_interaction_usage_bucket_reached', {
        feature_id: id,
        feature_category: getFeatureInteractionCategory(id),
        count_bucket: nextBucket,
        bucket_source:
          lastEmittedBucket === null && previousBucket !== null && previousBucket === nextBucket
            ? 'observed_existing'
            : 'crossed_now',
        ...getCohortAtEmit()
      })
    }
    return this.getUI()
  }

  // ── Onboarding ────────────────────────────────────────────────────

  getOnboarding(): PersistedState['onboarding'] {
    const defaults = getDefaultOnboardingState()
    return {
      ...defaults,
      ...this.state.onboarding,
      checklist: {
        ...defaults.checklist,
        ...this.state.onboarding?.checklist
      }
    }
  }

  updateOnboarding(
    updates: Partial<Omit<PersistedState['onboarding'], 'checklist'>> & {
      checklist?: Partial<OnboardingChecklistState>
    }
  ): PersistedState['onboarding'] {
    const current = this.getOnboarding()
    this.state.onboarding = {
      ...current,
      ...updates,
      checklist: {
        ...current.checklist,
        ...updates.checklist
      }
    }
    this.scheduleSave()
    return this.getOnboarding()
  }

  // ── GitHub Cache ──────────────────────────────────────────────────

  getGitHubCache(): PersistedState['githubCache'] {
    return this.state.githubCache
  }

  setGitHubCache(cache: PersistedState['githubCache']): void {
    // Why no scheduleSave: cache is memory-only and snapshotted to a sidecar at flush; persisting here rewrote the whole state file every poll cycle.
    this.state.githubCache = cache
    this.githubCacheDirty = true
  }

  // ── Workspace Session ─────────────────────────────────────────────

  /** Resolve an execution host argument to a canonical id; unknown/empty falls back to 'local' for legacy callers. */
  protected resolveHostId(hostId?: string | null): ExecutionHostId {
    return normalizeExecutionHostId(hostId) ?? LOCAL_EXECUTION_HOST_ID
  }

  getWorkspaceSession(hostId?: string | null): PersistedState['workspaceSession'] {
    const resolved = this.resolveHostId(hostId)
    if (resolved === LOCAL_EXECUTION_HOST_ID) {
      return this.state.workspaceSession ?? getDefaultWorkspaceSession()
    }
    return this.state.workspaceSessionsByHostId?.[resolved] ?? getDefaultWorkspaceSession()
  }

  getWorkspaceSessionHostIds(): ExecutionHostId[] {
    const hostIds = new Set<ExecutionHostId>([LOCAL_EXECUTION_HOST_ID])
    for (const key of Object.keys(this.state.workspaceSessionsByHostId ?? {})) {
      const hostId = normalizeExecutionHostId(key)
      if (hostId) {
        hostIds.add(hostId)
      }
    }
    return [...hostIds]
  }

  readTerminalScrollbackSnapshot(ref: string): string | null {
    return readTerminalScrollbackSnapshotSync(ref, this.terminalScrollbackSnapshotStorage)
  }

  /** Resolve the worktree a terminal tab belongs to; more reliable than agent-echoed hook fields. */
  getWorktreeIdForTab(tabId: string): string | undefined {
    return findWorktreeIdForTab(this.getWorkspaceSession(), tabId)
  }

  setWorkspaceSession(session: PersistedState['workspaceSession'], hostId?: string | null): void {
    const resolved = this.resolveHostId(hostId)
    if (resolved === LOCAL_EXECUTION_HOST_ID) {
      this.setLocalWorkspaceSession(session)
      return
    }
    this.setHostWorkspaceSession(resolved, session)
  }

  /** Persist a non-'local' host partition; remote hosts skip setLocalWorkspaceSession's local-daemon PTY-binding race guards. */
  protected setHostWorkspaceSession(hostId: ExecutionHostId, session: WorkspaceSessionState): void {
    // Why: each partition owns its topology fence; renderer writes omit it and must rebase locally.
    session = sanitizeWorkspaceSessionTerminalRetirements(
      session,
      this.state.workspaceSessionsByHostId?.[hostId]
    )
    const pruned = pruneWorkspaceSessionBrowserHistory(
      pruneLocalTerminalScrollbackBuffers(session, this.state.repos)
    )
    this.state.workspaceSessionsByHostId = {
      ...this.state.workspaceSessionsByHostId,
      [hostId]: pruned
    }
    this.scheduleSave()
  }


}
