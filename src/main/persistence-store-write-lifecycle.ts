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
import { StorePhase7 } from './persistence-store-ssh-state'

export class StorePhase8 extends StorePhase7 {
  migrateWorktreeIdentity(oldWorktreeId: string, newWorktreeId: string): void {
    if (oldWorktreeId === newWorktreeId) {
      return
    }
    const oldWorkspaceKey = worktreeWorkspaceKey(oldWorktreeId)
    const newWorkspaceKey = worktreeWorkspaceKey(newWorktreeId)
    const moveKey = <T>(
      record: Record<string, T>,
      mapValue: (value: T) => T = (value) => value
    ): boolean => {
      if (!(oldWorktreeId in record)) {
        return false
      }
      record[newWorktreeId] = mapValue(record[oldWorktreeId])
      delete record[oldWorktreeId]
      return true
    }
    const withNewWorktreeId = <T extends { worktreeId: string }>(value: T): T =>
      value.worktreeId === oldWorktreeId ? { ...value, worktreeId: newWorktreeId } : value
    const migrateSession = (session: WorkspaceSessionState | undefined): boolean => {
      if (!session) {
        return false
      }
      let sessionChanged = false
      const moveSessionKey = <T>(
        record: Record<string, T> | undefined,
        mapValue: (value: T) => T = (value) => value
      ): boolean => {
        if (!record) {
          return false
        }
        let moved = false
        const pairs: [string, string][] = [
          [oldWorktreeId, newWorktreeId],
          [oldWorkspaceKey, newWorkspaceKey]
        ]
        for (const [oldKey, newKey] of pairs) {
          if (!(oldKey in record)) {
            continue
          }
          record[newKey] = mapValue(record[oldKey])
          delete record[oldKey]
          moved = true
        }
        return moved
      }

      sessionChanged =
        moveSessionKey(session.tabsByWorktree, (tabs) => tabs.map(withNewWorktreeId)) ||
        sessionChanged
      sessionChanged =
        moveSessionKey(session.openFilesByWorktree, (files) => files.map(withNewWorktreeId)) ||
        sessionChanged
      sessionChanged = moveSessionKey(session.activeFileIdByWorktree) || sessionChanged
      sessionChanged =
        moveSessionKey(session.browserTabsByWorktree, (workspaces) =>
          workspaces.map(withNewWorktreeId)
        ) || sessionChanged
      if (session.browserPagesByWorkspace) {
        let pagesChanged = false
        const nextPagesByWorkspace = { ...session.browserPagesByWorkspace }
        for (const [workspaceId, pages] of Object.entries(nextPagesByWorkspace)) {
          if (!pages.some((page) => page.worktreeId === oldWorktreeId)) {
            continue
          }
          nextPagesByWorkspace[workspaceId] = pages.map(withNewWorktreeId)
          pagesChanged = true
        }
        if (pagesChanged) {
          session.browserPagesByWorkspace = nextPagesByWorkspace
          sessionChanged = true
        }
      }
      sessionChanged = moveSessionKey(session.activeBrowserTabIdByWorktree) || sessionChanged
      sessionChanged = moveSessionKey(session.activeTabTypeByWorktree) || sessionChanged
      sessionChanged = moveSessionKey(session.activeTabIdByWorktree) || sessionChanged
      sessionChanged =
        moveSessionKey(session.unifiedTabs, (tabs) => tabs.map(withNewWorktreeId)) || sessionChanged
      sessionChanged =
        moveSessionKey(session.tabGroups, (groups) => groups.map(withNewWorktreeId)) ||
        sessionChanged
      sessionChanged = moveSessionKey(session.tabGroupLayouts) || sessionChanged
      sessionChanged = moveSessionKey(session.activeGroupIdByWorktree) || sessionChanged
      sessionChanged = moveSessionKey(session.lastVisitedAtByWorktreeId) || sessionChanged
      sessionChanged =
        moveSessionKey(session.defaultTerminalTabsAppliedByWorktreeId) || sessionChanged
      if (session.activeWorktreeIdsOnShutdown?.includes(oldWorktreeId)) {
        session.activeWorktreeIdsOnShutdown = session.activeWorktreeIdsOnShutdown.map((id) =>
          id === oldWorktreeId ? newWorktreeId : id
        )
        sessionChanged = true
      }
      if (session.activeWorktreeId === oldWorktreeId) {
        session.activeWorktreeId = newWorktreeId
        sessionChanged = true
      }
      if (session.activeWorkspaceKey === oldWorkspaceKey) {
        session.activeWorkspaceKey = newWorkspaceKey
        sessionChanged = true
      }
      if (session.sleepingAgentSessionsByPaneKey) {
        let sleepingChanged = false
        const nextSleeping = { ...session.sleepingAgentSessionsByPaneKey }
        for (const [paneKey, record] of Object.entries(nextSleeping)) {
          if (record.worktreeId !== oldWorktreeId) {
            continue
          }
          nextSleeping[paneKey] = { ...record, worktreeId: newWorktreeId }
          sleepingChanged = true
        }
        if (sleepingChanged) {
          session.sleepingAgentSessionsByPaneKey = nextSleeping
          sessionChanged = true
        }
      }
      if (session.terminalSurfaceTombstonesByPaneKey) {
        let tombstonesChanged = false
        const nextTombstones = { ...session.terminalSurfaceTombstonesByPaneKey }
        for (const [paneKey, tombstone] of Object.entries(nextTombstones)) {
          if (tombstone.worktreeId !== oldWorktreeId) {
            continue
          }
          nextTombstones[paneKey] = { ...tombstone, worktreeId: newWorktreeId }
          tombstonesChanged = true
        }
        if (tombstonesChanged) {
          session.terminalSurfaceTombstonesByPaneKey = nextTombstones
          sessionChanged = true
        }
      }
      return sessionChanged
    }

    let changed = moveKey(this.state.worktreeMeta)
    // Record the prior id so a session minted under it isn't reaped as an orphan.
    const newMeta = this.state.worktreeMeta[newWorktreeId]
    if (newMeta) {
      const prior = newMeta.priorWorktreeIds ?? []
      if (!prior.includes(oldWorktreeId)) {
        newMeta.priorWorktreeIds = [...prior, oldWorktreeId]
        changed = true
      }
    }

    changed = moveKey(this.state.worktreeLineageById) || changed
    const movedLineage = this.state.worktreeLineageById[newWorktreeId]
    if (movedLineage && movedLineage.worktreeId === oldWorktreeId) {
      movedLineage.worktreeId = newWorktreeId
    }
    // Why: children carry this as parentWorktreeId; keep the denormalized path-derived id consistent (parentWorktreeInstanceId is stable).
    for (const lineage of Object.values(this.state.worktreeLineageById)) {
      if (lineage.parentWorktreeId === oldWorktreeId) {
        lineage.parentWorktreeId = newWorktreeId
        changed = true
      }
    }

    if (oldWorkspaceKey in this.state.workspaceLineageByChildKey) {
      const lineage = this.state.workspaceLineageByChildKey[oldWorkspaceKey]
      this.state.workspaceLineageByChildKey[newWorkspaceKey] = {
        ...lineage,
        childWorkspaceKey: newWorkspaceKey
      }
      delete this.state.workspaceLineageByChildKey[oldWorkspaceKey]
      changed = true
    }
    for (const [childKey, lineage] of Object.entries(this.state.workspaceLineageByChildKey)) {
      if (lineage.parentWorkspaceKey === oldWorkspaceKey) {
        this.state.workspaceLineageByChildKey[childKey as WorkspaceKey] = {
          ...lineage,
          parentWorkspaceKey: newWorkspaceKey
        }
        changed = true
      }
    }

    changed = migrateSession(this.state.workspaceSession) || changed
    for (const session of Object.values(this.state.workspaceSessionsByHostId ?? {})) {
      changed = migrateSession(session) || changed
    }
    for (const selectionsByWorktree of Object.values(
      this.state.mobileClientTabSelectionsByDeviceId ?? {}
    )) {
      changed = moveKey(selectionsByWorktree) || changed
    }
    const showDotfiles = this.state.ui?.showDotfilesByWorktree
    if (showDotfiles) {
      changed = moveKey(showDotfiles) || changed
    }

    if (changed) {
      this.scheduleSave()
    }
  }

  getWorkspaceLineage(childWorkspaceKey: WorkspaceKey): WorkspaceLineage | undefined {
    return this.state.workspaceLineageByChildKey[childWorkspaceKey]
  }

  getAllWorkspaceLineage(): Record<WorkspaceKey, WorkspaceLineage> {
    return this.state.workspaceLineageByChildKey
  }

  setWorkspaceLineage(lineage: WorkspaceLineage): WorkspaceLineage {
    this.state.workspaceLineageByChildKey[lineage.childWorkspaceKey] = lineage
    this.scheduleSave()
    return lineage
  }

  removeWorkspaceLineage(childWorkspaceKey: WorkspaceKey): void {
    delete this.state.workspaceLineageByChildKey[childWorkspaceKey]
    this.scheduleSave()
  }

  protected removeWorkspaceLineageForFolderParent(folderWorkspaceId: string): void {
    const parentKey = folderWorkspaceKey(folderWorkspaceId)
    for (const [childKey, lineage] of Object.entries(this.state.workspaceLineageByChildKey)) {
      if (lineage.parentWorkspaceKey === parentKey) {
        delete this.state.workspaceLineageByChildKey[childKey as WorkspaceKey]
      }
    }
  }

  // ── Settings ───────────────────────────────────────────────────────

  getSettings(): GlobalSettings {
    return this.state.settings
  }

  onSettingsChanged(
    listener: (
      updates: Partial<GlobalSettings>,
      settings: GlobalSettings,
      originWebContentsId?: number
    ) => void
  ): () => void {
    this.settingsChangeListeners.add(listener)
    return () => {
      this.settingsChangeListeners.delete(listener)
    }
  }

  protected notifySettingsChanged(
    updates: Partial<GlobalSettings>,
    originWebContentsId?: number
  ): void {
    for (const listener of this.settingsChangeListeners) {
      listener(updates, this.state.settings, originWebContentsId)
    }
  }

  // Why: UI view-state is written from both desktop and mobile (ui.set RPC), so notify to keep bi-directional sync (desktop hydrates UI only once).
  onUIChanged(listener: (ui: PersistedState['ui']) => void): () => void {
    this.uiChangeListeners.add(listener)
    return () => {
      this.uiChangeListeners.delete(listener)
    }
  }

  protected notifyUIChanged(): void {
    if (this.uiChangeListeners.size === 0) {
      return
    }
    const ui = this.getUI()
    for (const listener of this.uiChangeListeners) {
      listener(ui)
    }
  }


}
