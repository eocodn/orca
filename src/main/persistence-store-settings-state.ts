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
import { StorePhase3 } from './persistence-store-automation-state'

export class StorePhase4 extends StorePhase3 {
  createFolderWorkspace(input: {
    projectGroupId: string
    name?: string
    folderPath?: string | null
    linkedTask?: FolderWorkspace['linkedTask']
    linkedTaskSourceContext?: FolderWorkspace['linkedTaskSourceContext']
    connectionId?: string | null
    createdWithAgent?: FolderWorkspace['createdWithAgent']
    pendingFirstAgentMessageRename?: boolean
    operationId?: string
  }): FolderWorkspace {
    const operationId = normalizeFolderWorkspaceOperationId(input.operationId)
    const group = (this.state.projectGroups ?? []).find(
      (entry) => entry.id === input.projectGroupId
    )
    const folderPath =
      typeof input.folderPath === 'string' && input.folderPath.trim().length > 0
        ? input.folderPath
        : group?.parentPath
    if (!group || !folderPath) {
      throw new Error('folder_workspace_project_group_not_found')
    }
    const linkedTask = normalizeWorkspaceLinkedItem(input.linkedTask)
    const sourceContext = normalizeStoredTaskSourceContext(input.linkedTaskSourceContext)
    const name = normalizeFolderWorkspaceName(input.name, `${group.name} workspace`)
    const connectionId = input.connectionId ?? group.connectionId ?? null
    const creationFingerprint = JSON.stringify({
      projectGroupId: group.id,
      name,
      folderPath,
      connectionId,
      linkedTask,
      linkedTaskSourceContext: isWorkspaceLinkedItemSourceContextMatch(linkedTask, sourceContext)
        ? sourceContext
        : null,
      createdWithAgent: input.createdWithAgent ?? null,
      pendingFirstAgentMessageRename:
        input.pendingFirstAgentMessageRename === true && Boolean(input.createdWithAgent)
    })
    if (operationId) {
      const existing = this.getFolderWorkspaceByCreationOperationId(operationId)
      if (existing) {
        if (existing.creationFingerprint !== creationFingerprint) {
          throw new Error('folder_workspace_operation_conflict')
        }
        return existing
      }
      if (this.pendingWrite !== null) {
        throw new Error('folder_workspace_persistence_busy')
      }
    }
    const now = Date.now()
    const workspace: FolderWorkspace = {
      id: randomUUID(),
      ...(operationId ? { creationOperationId: operationId, creationFingerprint } : {}),
      projectGroupId: group.id,
      name,
      folderPath,
      connectionId,
      linkedTask,
      linkedTaskSourceContext: isWorkspaceLinkedItemSourceContextMatch(linkedTask, sourceContext)
        ? sourceContext
        : null,
      comment: '',
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: now,
      ...(input.createdWithAgent ? { createdWithAgent: input.createdWithAgent } : {}),
      ...(input.pendingFirstAgentMessageRename === true && input.createdWithAgent
        ? { pendingFirstAgentMessageRename: true }
        : {}),
      lastActivityAt: 0,
      createdAt: now,
      updatedAt: now
    }
    const previousFolderWorkspaces = this.state.folderWorkspaces ?? []
    this.state.folderWorkspaces = [workspace, ...previousFolderWorkspaces]
    if (operationId) {
      try {
        // The create return is the idempotency acknowledgement boundary. Persist the
        // workspace and its operation binding atomically before a caller can retry.
        this.flushOrThrow()
      } catch (error) {
        this.state.folderWorkspaces = previousFolderWorkspaces
        // flushOrThrow clears the shared debounce timer; restore pending persistence
        // for state that existed before this operation began.
        this.scheduleSave()
        throw error
      }
    } else {
      this.scheduleSave()
    }
    return workspace
  }

  updateFolderWorkspace(
    id: string,
    updates: Partial<
      Pick<
        FolderWorkspace,
        | 'name'
        | 'folderPath'
        | 'linkedTask'
        | 'linkedTaskSourceContext'
        | 'comment'
        | 'isArchived'
        | 'isUnread'
        | 'isPinned'
        | 'sortOrder'
        | 'manualOrder'
        | 'workspaceStatus'
        | 'createdWithAgent'
        | 'pendingFirstAgentMessageRename'
        | 'firstAgentMessageRenameError'
        | 'lastActivityAt'
      >
    >
  ): FolderWorkspace | null {
    const workspace = this.getFolderWorkspace(id)
    if (!workspace) {
      return null
    }
    if (updates.name !== undefined) {
      workspace.name = normalizeFolderWorkspaceName(updates.name, workspace.name)
    }
    if (typeof updates.folderPath === 'string' && updates.folderPath.trim().length > 0) {
      workspace.folderPath = updates.folderPath
    }
    if (updates.linkedTask !== undefined) {
      workspace.linkedTask = normalizeWorkspaceLinkedItem(updates.linkedTask)
      if (
        workspace.linkedTaskSourceContext &&
        !isWorkspaceLinkedItemSourceContextMatch(
          workspace.linkedTask,
          workspace.linkedTaskSourceContext
        )
      ) {
        workspace.linkedTaskSourceContext = null
      }
    }
    if (updates.linkedTaskSourceContext !== undefined) {
      const linkedTaskSourceContext = normalizeStoredTaskSourceContext(
        updates.linkedTaskSourceContext
      )
      workspace.linkedTaskSourceContext = isWorkspaceLinkedItemSourceContextMatch(
        workspace.linkedTask,
        linkedTaskSourceContext
      )
        ? linkedTaskSourceContext
        : null
    }
    if (updates.comment !== undefined) {
      workspace.comment = updates.comment
    }
    if (updates.isArchived !== undefined) {
      workspace.isArchived = updates.isArchived
    }
    if (updates.isUnread !== undefined) {
      workspace.isUnread = updates.isUnread
    }
    if (updates.isPinned !== undefined) {
      workspace.isPinned = updates.isPinned
    }
    if (updates.sortOrder !== undefined && Number.isFinite(updates.sortOrder)) {
      workspace.sortOrder = updates.sortOrder
    }
    if (updates.manualOrder !== undefined) {
      if (Number.isFinite(updates.manualOrder)) {
        workspace.manualOrder = updates.manualOrder
      } else {
        delete workspace.manualOrder
      }
    }
    if (updates.workspaceStatus !== undefined) {
      workspace.workspaceStatus = updates.workspaceStatus
    }
    if (updates.createdWithAgent !== undefined) {
      workspace.createdWithAgent = updates.createdWithAgent
    }
    if (updates.pendingFirstAgentMessageRename !== undefined) {
      workspace.pendingFirstAgentMessageRename = updates.pendingFirstAgentMessageRename
    }
    if (updates.firstAgentMessageRenameError !== undefined) {
      workspace.firstAgentMessageRenameError = updates.firstAgentMessageRenameError
    }
    if (updates.lastActivityAt !== undefined && Number.isFinite(updates.lastActivityAt)) {
      workspace.lastActivityAt = updates.lastActivityAt
    }
    workspace.updatedAt = Date.now()
    this.scheduleSave()
    return workspace
  }

  removeFolderWorkspace(id: string): boolean {
    const before = this.state.folderWorkspaces?.length ?? 0
    if (!(this.state.folderWorkspaces ?? []).some((workspace) => workspace.id === id)) {
      return false
    }
    if (this.pendingWrite !== null) {
      throw new Error('folder_workspace_persistence_busy')
    }
    // Deletion spans workspace, session, lineage, and mobile selection state. A full
    // snapshot keeps that aggregate atomic if the durable acknowledgement write fails.
    const previousState = structuredClone(this.state)
    this.state.folderWorkspaces = (this.state.folderWorkspaces ?? []).filter(
      (workspace) => workspace.id !== id
    )
    if ((this.state.folderWorkspaces?.length ?? 0) === before) {
      return false
    }
    this.state.workspaceSession = removeWorkspaceSessionOwner(
      this.state.workspaceSession,
      folderWorkspaceKey(id)
    )!
    this.removeWorkspaceLineageForFolderParent(id)
    this.pruneMobileClientTabSelections((worktreeId) => worktreeId === folderWorkspaceKey(id))
    try {
      this.flushOrThrow()
    } catch (error) {
      this.state = previousState
      // flushOrThrow clears the shared debounce timer; restore persistence for
      // state that existed before this deletion attempt.
      this.scheduleSave()
      throw error
    }
    return true
  }

  moveProjectToGroup(repoId: string, groupId: string | null, order?: number): Repo | null {
    const repo = this.state.repos.find((entry) => entry.id === repoId)
    if (!repo) {
      return null
    }
    const normalizedGroupId =
      groupId && (this.state.projectGroups ?? []).some((group) => group.id === groupId)
        ? groupId
        : null
    const siblingRepos = this.state.repos.filter((entry) => entry.id !== repoId)
    repo.projectGroupId = normalizedGroupId
    repo.projectGroupOrder =
      typeof order === 'number' && Number.isFinite(order)
        ? order
        : getNextProjectGroupOrder(siblingRepos, normalizedGroupId)
    this.scheduleSave()
    return this.hydrateRepo(repo)
  }

  addRepo(repo: Repo): void {
    this.state.repos.push(repo)
    this.syncProjectHostSetupCompatibilityState()
    this.scheduleSave()
  }

  // Why: return false on a stale permutation (concurrent add/remove) so the caller resyncs instead of persisting an order that drops/duplicates ids.
  reorderRepos(orderedIds: string[]): boolean {
    const current = this.state.repos
    if (orderedIds.length !== current.length) {
      return false
    }
    const seen = new Set<string>()
    for (const id of orderedIds) {
      if (typeof id !== 'string' || seen.has(id)) {
        return false
      }
      seen.add(id)
    }
    const byId = new Map<string, Repo>()
    for (const r of current) {
      byId.set(r.id, r)
    }
    const next: Repo[] = []
    for (const id of orderedIds) {
      const repo = byId.get(id)
      if (!repo) {
        return false
      }
      next.push(repo)
    }
    this.state.repos = next
    this.syncProjectHostSetupCompatibilityState()
    this.scheduleSave()
    return true
  }

  // Why: repo ids are unique only within an execution host; drags persist one permutation per host when local and SSH repos coexist.

}
