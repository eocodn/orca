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
import { StorePhase11 } from './persistence-store-state-phase-11'

export class StorePhase12 extends StorePhase11 {
  persistPtyBinding(
    args: {
      worktreeId: string
      tabId: string
      leafId: string
      ptyId: string
      incarnationId?: string
      startupCwd?: string
    },
    hostId?: string | null
  ): { rollbackIfCurrent: () => boolean } {
    const resolvedHostId = this.resolveHostId(hostId)
    const session = this.getWorkspaceSession(resolvedHostId)
    if (resolvedHostId !== LOCAL_EXECUTION_HOST_ID) {
      this.state.workspaceSessionsByHostId = {
        ...this.state.workspaceSessionsByHostId,
        [resolvedHostId]: session
      }
    }
    const sessionBeforeBinding = cloneWorkspaceSessionState(session)
    const paneKey = `${args.tabId}:${args.leafId}`
    let terminalMembershipChanged = false
    const advanceTopologyAfterMembershipChange = (): void => {
      const repoId = getRepoIdFromWorktreeId(args.worktreeId)
      const currentRevision = session.terminalTopologyRevisionByRepoId?.[repoId] ?? 0
      if (!terminalMembershipChanged || currentRevision <= 0) {
        return
      }
      // Why: a real host-admitted spawn after a retirement must be distinguishable from a stale renderer replay.
      session.terminalTopologyRevisionByRepoId = {
        ...session.terminalTopologyRevisionByRepoId,
        [repoId]: currentRevision + 1
      }
    }
    const assignSession = (value: WorkspaceSessionState): void => {
      if (resolvedHostId === LOCAL_EXECUTION_HOST_ID) {
        this.state.workspaceSession = value
      } else {
        this.state.workspaceSessionsByHostId = {
          ...this.state.workspaceSessionsByHostId,
          [resolvedHostId]: value
        }
      }
    }
    const restoreSession = (): void => assignSession(sessionBeforeBinding)
    const flushWithRollbackReceipt = (): { rollbackIfCurrent: () => boolean } => {
      try {
        this.flushOrThrow()
      } catch (err) {
        restoreSession()
        if (!this.writesFrozen) {
          this.scheduleSave()
        }
        throw err
      }
      const sessionAfterBinding = cloneWorkspaceSessionState(
        this.getWorkspaceSession(resolvedHostId)
      )
      const serializedAfterBinding = JSON.stringify(sessionAfterBinding)
      return Object.freeze({
        rollbackIfCurrent: (): boolean => {
          const current = cloneWorkspaceSessionState(this.getWorkspaceSession(resolvedHostId))
          if (JSON.stringify(current) !== serializedAfterBinding) {
            return false
          }
          assignSession(cloneWorkspaceSessionState(sessionBeforeBinding))
          try {
            this.flushOrThrow()
            return true
          } catch {
            // Why: keep memory on the pre-spawn state while the normal save queue retries the durable rollback.
            assignSession(sessionBeforeBinding)
            if (!this.writesFrozen) {
              this.scheduleSave()
            }
            return false
          }
        }
      })
    }
    if (args.incarnationId) {
      session.terminalPtyIncarnationsByPaneKey = {
        ...session.terminalPtyIncarnationsByPaneKey,
        [paneKey]: args.incarnationId
      }
      if (session.terminalSurfaceTombstonesByPaneKey?.[paneKey]) {
        session.terminalSurfaceTombstonesByPaneKey = {
          ...session.terminalSurfaceTombstonesByPaneKey
        }
        delete session.terminalSurfaceTombstonesByPaneKey[paneKey]
      }
    }
    const tabs = session.tabsByWorktree?.[args.worktreeId]
    const tab = tabs?.find((t) => t.id === args.tabId)
    if (tab) {
      tab.ptyId = args.ptyId
    } else {
      terminalMembershipChanged = true
      // Why: pty:spawn can beat the debounced writer; persist a minimal tab so hydration won't prune the binding as orphaned.
      const nextTabs = [
        ...(tabs ?? []),
        createMinimalPersistedTerminalTab({
          ...args,
          existingTabCount: tabs?.length ?? 0
        })
      ]
      session.tabsByWorktree = {
        ...session.tabsByWorktree,
        [args.worktreeId]: nextTabs
      }
      session.activeWorktreeId ??= args.worktreeId
      session.activeTabId ??= args.tabId
      session.activeTabIdByWorktree = {
        ...session.activeTabIdByWorktree,
        [args.worktreeId]: session.activeTabIdByWorktree?.[args.worktreeId] ?? args.tabId
      }
    }
    if (!isTerminalLeafId(args.leafId)) {
      // Why: keep legacy renderer-local pane ids out of durable leaf-keyed layout state after the UUID migration.
      advanceTopologyAfterMembershipChange()
      return flushWithRollbackReceipt()
    }
    const layout = session.terminalLayoutsByTabId?.[args.tabId]
    if (layout) {
      if (!layout.root) {
        terminalMembershipChanged = true
        // Why: createTab can persist an empty layout before TerminalPane mounts; the sync binding still needs a durable root.
        layout.root = { type: 'leaf', leafId: args.leafId }
        layout.activeLeafId = args.leafId
        layout.expandedLeafId = null
      } else if (!layoutContainsLeafId(layout.root, args.leafId)) {
        terminalMembershipChanged = true
        // Why: splitPane spawns before its snapshot reaches main; add a minimal leaf so a crash can't strand the pane's binding.
        layout.root = {
          type: 'split',
          direction: 'vertical',
          first: cloneLayoutNode(layout.root),
          second: { type: 'leaf', leafId: args.leafId }
        }
        layout.activeLeafId = args.leafId
        if (layout.expandedLeafId && !layoutContainsLeafId(layout.root, layout.expandedLeafId)) {
          layout.expandedLeafId = null
        }
      }
      layout.ptyIdsByLeafId = {
        ...layout.ptyIdsByLeafId,
        [args.leafId]: args.ptyId
      }
    } else {
      terminalMembershipChanged = true
      // Why: first tab spawn — persist a minimal layout so a SIGKILL before the renderer snapshot can't lose ptyIdsByLeafId.
      session.terminalLayoutsByTabId = {
        ...session.terminalLayoutsByTabId,
        [args.tabId]: {
          root: { type: 'leaf', leafId: args.leafId },
          activeLeafId: args.leafId,
          expandedLeafId: null,
          ptyIdsByLeafId: { [args.leafId]: args.ptyId }
        }
      }
    }
    advanceTopologyAfterMembershipChange()
    return flushWithRollbackReceipt()
  }

  // ── SSH Targets ────────────────────────────────────────────────────

  getSshTargets(): SshTarget[] {
    return (this.state.sshTargets ?? []).map(normalizeSshTarget)
  }

  getSshTarget(id: string): SshTarget | undefined {
    const target = this.state.sshTargets?.find((t) => t.id === id)
    return target ? normalizeSshTarget(target) : undefined
  }

  addSshTarget(target: SshTarget): void {
    this.state.sshTargets ??= []
    this.state.sshTargets.push(normalizeSshTarget(target))
    this.scheduleSave()
  }

  updateSshTarget(id: string, updates: Partial<Omit<SshTarget, 'id'>>): SshTarget | null {
    const target = this.state.sshTargets?.find((t) => t.id === id)
    if (!target) {
      return null
    }
    const normalized = normalizeSshTarget({ ...target, ...updates })
    Object.assign(target, updates, normalized)
    if (!Object.hasOwn(normalized, 'relayGracePeriodSeconds')) {
      delete target.relayGracePeriodSeconds
    }
    if (!Object.hasOwn(normalized, 'systemSshConnectionReuse')) {
      delete target.systemSshConnectionReuse
    }
    this.scheduleSave()
    return { ...target }
  }

  removeSshTarget(id: string): void {
    if (!this.state.sshTargets) {
      return
    }
    this.state.sshTargets = this.state.sshTargets.filter((t) => t.id !== id)
    this.scheduleSave()
  }

  // ── Live Claude PTY sessions ───────────────────────────────────────

  getClaudeLivePtySessionIds(): string[] {
    return [...(this.state.claudeLivePtySessionIds ?? [])]
  }

  addClaudeLivePtySessionId(sessionId: string): void {
    if (sessionId.length === 0 || sessionId.length > 512) {
      return
    }
    const ids = this.state.claudeLivePtySessionIds ?? []
    if (ids.includes(sessionId)) {
      return
    }
    // Why: drop oldest at the cap — stale ids get pruned against the daemon at startup, so only recency matters.
    this.state.claudeLivePtySessionIds = [...ids, sessionId].slice(-MAX_CLAUDE_LIVE_PTY_SESSION_IDS)
    // Why: flush sync so a force-quit right after a Claude spawn still seeds the live-PTY gate next launch.
    this.flush()
  }

  removeClaudeLivePtySessionId(sessionId: string): void {
    const ids = this.state.claudeLivePtySessionIds ?? []
    if (!ids.includes(sessionId)) {
      return
    }
    this.state.claudeLivePtySessionIds = ids.filter((id) => id !== sessionId)
    this.scheduleSave()
  }

  getDeletedSshConfigAliases(): string[] {
    return [...(this.state.deletedSshConfigAliases ?? [])]
  }

  addDeletedSshConfigAlias(alias: string): void {
    this.state.deletedSshConfigAliases ??= []
    if (!this.state.deletedSshConfigAliases.includes(alias)) {
      this.state.deletedSshConfigAliases.push(alias)
      this.scheduleSave()
    }
  }

  removeDeletedSshConfigAlias(alias: string): void {
    const current = this.state.deletedSshConfigAliases
    if (!current || !current.includes(alias)) {
      return
    }
    this.state.deletedSshConfigAliases = current.filter((entry) => entry !== alias)
    this.scheduleSave()
  }

  clearDeletedSshConfigAliases(): void {
    if (this.state.deletedSshConfigAliases && this.state.deletedSshConfigAliases.length > 0) {
      this.state.deletedSshConfigAliases = []
      this.scheduleSave()
    }
  }

  getRemovedSshTargetTombstones(): RemovedSshTargetTombstone[] {
    return [...(this.state.removedSshTargetTombstones ?? [])]
  }

  addRemovedSshTargetTombstone(tombstone: RemovedSshTargetTombstone): void {
    const existing = this.state.removedSshTargetTombstones ?? []
    // Why: dedupe by oldTargetId so re-removing the same id can't stack duplicate tombstones; newest wins.
    const filtered = existing.filter((t) => t.oldTargetId !== tombstone.oldTargetId)
    // Cap the history so pathological churn can't grow the state file unbounded.
    this.state.removedSshTargetTombstones = [...filtered, tombstone].slice(
      -MAX_REMOVED_SSH_TARGET_TOMBSTONES
    )
    this.scheduleSave()
  }

  removeRemovedSshTargetTombstone(oldTargetId: string): void {
    const existing = this.state.removedSshTargetTombstones
    if (!existing?.some((t) => t.oldTargetId === oldTargetId)) {
      return
    }
    this.state.removedSshTargetTombstones = existing.filter((t) => t.oldTargetId !== oldTargetId)
    this.scheduleSave()
  }

  /**
   * Re-point every repo and worktree meta pinned to a removed SSH target id onto
   * a re-added target's id so orphaned workspaces reattach. Returns re-pointed repo ids.
   */

}
