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
import {
  normalizeAutomationPrecheckResult,
  normalizeAutomationRunOutputSnapshot,
  normalizeAutomationRunTerminalPaneKey,
  normalizeAutomationRunTerminalPtyId,
  normalizeAutomationRunWorkspaceDisplayName
} from './persistence-state-migrations'
import { StorePhase6 } from './persistence-store-pty-state'

export class StorePhase7 extends StorePhase6 {
  deleteAutomation(id: string): void {
    this.state.automations = (this.state.automations ?? []).filter((entry) => entry.id !== id)
    this.state.automationRuns = (this.state.automationRuns ?? []).filter(
      (entry) => entry.automationId !== id
    )
    this.flush()
  }

  createAutomationRun(
    automation: Automation,
    scheduledFor: number,
    trigger: AutomationRunTrigger = 'scheduled'
  ): AutomationRun {
    const existing = (this.state.automationRuns ?? []).find(
      (run) => run.automationId === automation.id && run.scheduledFor === scheduledFor
    )
    if (existing) {
      return existing
    }
    const now = Date.now()
    // Why: retention prunes old runs, so the retained count isn't the ordinal — carry the number forward from the newest survivor.
    const runNumber = nextAutomationRunNumber(
      (this.state.automationRuns ?? []).filter((run) => run.automationId === automation.id)
    )
    const run: AutomationRun = {
      id: randomUUID(),
      automationId: automation.id,
      runNumber,
      runContext: automation.runContext ?? null,
      sourceContext: automation.sourceContext ?? null,
      title: `${automation.name} run ${runNumber}`,
      scheduledFor,
      status: 'pending',
      trigger,
      workspaceId: automation.workspaceId,
      workspaceDisplayName: this.getAutomationRunWorkspaceDisplayName(automation.workspaceId),
      sessionKind: 'terminal',
      chatSessionId: null,
      terminalSessionId: null,
      terminalPaneKey: null,
      terminalPtyId: null,
      outputSnapshot: null,
      precheckResult: null,
      usage: null,
      error: null,
      startedAt: null,
      dispatchedAt: null,
      createdAt: now
    }
    this.state.automationRuns = pruneAutomationRuns([...(this.state.automationRuns ?? []), run])
    if (trigger === 'manual') {
      this.recordFeatureInteraction('automation-run')
    }
    this.flush()
    return run
  }

  updateAutomationRun(result: AutomationDispatchResult): AutomationRun {
    const index = (this.state.automationRuns ?? []).findIndex((entry) => entry.id === result.runId)
    if (index === -1) {
      throw new Error('Automation run not found.')
    }
    const now = Date.now()
    const current = this.state.automationRuns[index]
    const workspaceId = result.workspaceId ?? current.workspaceId
    const workspaceDisplayName = Object.hasOwn(result, 'workspaceDisplayName')
      ? normalizeAutomationRunWorkspaceDisplayName(result.workspaceDisplayName ?? null)
      : null
    const updated: AutomationRun = {
      ...current,
      status: result.status,
      workspaceId,
      workspaceDisplayName:
        workspaceDisplayName ??
        normalizeAutomationRunWorkspaceDisplayName(current.workspaceDisplayName ?? null) ??
        this.getAutomationRunWorkspaceDisplayName(workspaceId),
      terminalSessionId: Object.hasOwn(result, 'terminalSessionId')
        ? (result.terminalSessionId ?? null)
        : current.terminalSessionId,
      terminalPaneKey: Object.hasOwn(result, 'terminalPaneKey')
        ? normalizeAutomationRunTerminalPaneKey(result.terminalPaneKey)
        : normalizeAutomationRunTerminalPaneKey(current.terminalPaneKey),
      terminalPtyId: Object.hasOwn(result, 'terminalPtyId')
        ? normalizeAutomationRunTerminalPtyId(result.terminalPtyId)
        : normalizeAutomationRunTerminalPtyId(current.terminalPtyId),
      outputSnapshot: Object.hasOwn(result, 'outputSnapshot')
        ? normalizeAutomationRunOutputSnapshot(result.outputSnapshot)
        : normalizeAutomationRunOutputSnapshot(current.outputSnapshot),
      precheckResult: Object.hasOwn(result, 'precheckResult')
        ? normalizeAutomationPrecheckResult(result.precheckResult)
        : normalizeAutomationPrecheckResult(current.precheckResult),
      usage: Object.hasOwn(result, 'usage') ? (result.usage ?? null) : (current.usage ?? null),
      error: result.error ?? null,
      startedAt: current.startedAt ?? now,
      dispatchedAt: result.status === 'dispatched' ? now : current.dispatchedAt
    }
    this.state.automationRuns[index] = updated
    const automation = this.state.automations.find((entry) => entry.id === updated.automationId)
    if (automation) {
      automation.lastRunAt = now
      automation.updatedAt = now
    }
    this.flush()
    return updated
  }

  snapshotAutomationRunWorkspaceDisplayName(workspaceId: string, displayName: string): number {
    const normalizedDisplayName = normalizeAutomationRunWorkspaceDisplayName(displayName)
    if (!normalizedDisplayName) {
      return 0
    }
    let updatedCount = 0
    this.state.automationRuns = (this.state.automationRuns ?? []).map((run) => {
      if (run.workspaceId !== workspaceId || run.workspaceDisplayName === normalizedDisplayName) {
        return run
      }
      updatedCount += 1
      return { ...run, workspaceDisplayName: normalizedDisplayName }
    })
    if (updatedCount > 0) {
      this.flush()
    }
    return updatedCount
  }

  protected getAutomationRunWorkspaceDisplayName(
    workspaceId: string | null | undefined
  ): string | null {
    if (!workspaceId) {
      return null
    }
    return normalizeAutomationRunWorkspaceDisplayName(
      this.state.worktreeMeta[workspaceId]?.displayName ??
        getWorktreePathBasenameFromId(workspaceId)
    )
  }

  advanceAutomationNextRun(id: string, now = Date.now()): Automation {
    const index = (this.state.automations ?? []).findIndex((entry) => entry.id === id)
    if (index === -1) {
      throw new Error('Automation not found.')
    }
    const current = this.state.automations[index]
    const nextRunAt = nextAutomationOccurrenceAfter(current.rrule, current.dtstart, now)
    const updated = { ...current, nextRunAt, updatedAt: Date.now() }
    this.state.automations[index] = updated
    this.flush()
    return updated
  }

  getLatestAutomationOccurrence(automation: Automation, now = Date.now()): number | null {
    return latestAutomationOccurrenceAtOrBefore(automation.rrule, automation.dtstart, now)
  }

  // ── Worktree Meta ──────────────────────────────────────────────────

  getWorktreeMeta(worktreeId: string): WorktreeMeta | undefined {
    return this.state.worktreeMeta[worktreeId]
  }

  getAllWorktreeMeta(): Record<string, WorktreeMeta> {
    return this.state.worktreeMeta
  }

  setWorktreeMeta(worktreeId: string, meta: Partial<WorktreeMeta>): WorktreeMeta {
    const existing = this.state.worktreeMeta[worktreeId] || getDefaultWorktreeMeta()
    const updated = { ...existing, ...meta }
    updated.linkedWorkItem = normalizeWorkspaceLinkedItem(updated.linkedWorkItem)
    const linkedTaskSourceContext = normalizeStoredTaskSourceContext(
      updated.linkedTaskSourceContext
    )
    updated.linkedTaskSourceContext = isWorkspaceLinkedItemSourceContextMatch(
      updated.linkedWorkItem,
      linkedTaskSourceContext
    )
      ? linkedTaskSourceContext
      : null
    if (!updated.instanceId) {
      updated.instanceId = randomUUID()
    }
    this.state.worktreeMeta[worktreeId] = updated
    this.scheduleSave()
    return updated
  }

  removeWorktreeMeta(worktreeId: string): void {
    delete this.state.worktreeMeta[worktreeId]
    delete this.state.worktreeLineageById[worktreeId]
    delete this.state.workspaceLineageByChildKey[worktreeWorkspaceKey(worktreeId)]
    this.state.workspaceSession = removeWorkspaceSessionOwner(
      this.state.workspaceSession,
      worktreeId,
      { advanceTerminalTopologyRevision: true }
    )!
    this.scheduleSave()
  }

  getWorktreeLineage(worktreeId: string): WorktreeLineage | undefined {
    return this.state.worktreeLineageById[worktreeId]
  }

  getAllWorktreeLineage(): Record<string, WorktreeLineage> {
    return this.state.worktreeLineageById
  }

  setWorktreeLineage(worktreeId: string, lineage: WorktreeLineage): WorktreeLineage {
    this.state.worktreeLineageById[worktreeId] = lineage
    this.scheduleSave()
    return lineage
  }

  removeWorktreeLineage(worktreeId: string): void {
    delete this.state.worktreeLineageById[worktreeId]
    this.scheduleSave()
  }

  /**
   * Re-key every worktreeId-keyed record from `oldWorktreeId` to `newWorktreeId` after the worktree folder (and its
   * `${repoId}::${path}` id) was renamed on disk, so a refresh re-binds state instead of orphaning it. Records the old id on
   * the new meta's `priorWorktreeIds` so session GC/hydration still recognizes PTY sessions minted under it. No-op when ids match.
   * Renderer counterpart: `buildWorktreeRenameState` in store/slices/worktrees.ts.
   */

}
