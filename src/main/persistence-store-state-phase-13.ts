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
import { StorePhase12 } from './persistence-store-state-phase-12'

export class StorePhase13 extends StorePhase12 {
  reassignSshTargetId(oldTargetId: string, newTargetId: string): string[] {
    if (oldTargetId === newTargetId) {
      return []
    }
    const oldHostId = toSshExecutionHostId(oldTargetId)
    const newHostId = toSshExecutionHostId(newTargetId)
    const repoIds = new Set<string>()
    for (const repo of this.state.repos) {
      const matchesConnection = repo.connectionId === oldTargetId
      const matchesHost = repo.executionHostId === oldHostId
      if (!matchesConnection && !matchesHost) {
        continue
      }
      if (matchesConnection) {
        repo.connectionId = newTargetId
      }
      // Why: don't stamp executionHostId where it was unset — addRemoteRepoFromPath repos derive the host from connectionId.
      if (matchesHost) {
        repo.executionHostId = newHostId
      }
      repoIds.add(repo.id)
    }
    // Re-point worktree metas whose hostId pointed at the old SSH host.
    let metaChanged = false
    for (const meta of Object.values(this.state.worktreeMeta)) {
      if (meta.hostId === oldHostId) {
        meta.hostId = newHostId
        metaChanged = true
      }
    }
    // Why: any carrier still holding the old id later throws `SSH target not found` (STA-1468); migrate them all.
    let carrierChanged = migrateWorkspaceSessionSshTargetId(
      this.state.workspaceSession,
      oldTargetId,
      newTargetId
    )
    for (const session of Object.values(this.state.workspaceSessionsByHostId ?? {})) {
      if (session && migrateWorkspaceSessionSshTargetId(session, oldTargetId, newTargetId)) {
        carrierChanged = true
      }
    }
    // Why: partitions are read by host id; re-key from the removed id to the new one (keep new if it already exists).
    const partitions = this.state.workspaceSessionsByHostId
    const oldPartition = partitions?.[oldHostId]
    if (partitions && oldPartition) {
      delete partitions[oldHostId]
      partitions[newHostId] ??= oldPartition
      carrierChanged = true
    }
    if (migrateUiHostScopeSshTargetId(this.state.ui, oldTargetId, newTargetId)) {
      carrierChanged = true
    }
    for (const lease of this.state.sshRemotePtyLeases ?? []) {
      if (lease.targetId === oldTargetId) {
        lease.targetId = newTargetId
        carrierChanged = true
      }
    }
    let setupsChanged = false
    const keptSetups: ProjectHostSetup[] = []
    for (const setup of this.state.projectHostSetups) {
      if (setup.hostId !== oldHostId) {
        keptSetups.push(setup)
        continue
      }
      const duplicate = this.state.projectHostSetups.some(
        (entry) =>
          entry !== setup && entry.projectId === setup.projectId && entry.hostId === newHostId
      )
      // Why: drop the old ghost row that would violate (projectId, hostId) uniqueness with the re-added host's setup.
      if (duplicate) {
        setupsChanged = true
        continue
      }
      setup.hostId = newHostId
      setup.updatedAt = Date.now()
      keptSetups.push(setup)
      setupsChanged = true
    }
    if (setupsChanged) {
      this.state.projectHostSetups = keptSetups
    }
    // Why: repo-row and host-setup rewrites affect host-setup compatibility; meta-only rewrites don't, so gate the sync here.
    if (repoIds.size > 0 || setupsChanged) {
      this.syncProjectHostSetupCompatibilityState()
    }
    if (repoIds.size > 0 || metaChanged || carrierChanged || setupsChanged) {
      this.scheduleSave()
    }
    return [...repoIds]
  }

  // ── SSH Remote PTY Leases ──────────────────────────────────────────

  getSshRemotePtyLeases(targetId?: string): SshRemotePtyLease[] {
    const leases = this.state.sshRemotePtyLeases ?? []
    return leases.filter((lease) => targetId === undefined || lease.targetId === targetId)
  }

  upsertSshRemotePtyLease(
    lease: Omit<SshRemotePtyLease, 'createdAt' | 'updatedAt'> &
      Partial<Pick<SshRemotePtyLease, 'createdAt' | 'updatedAt'>>
  ): void {
    this.state.sshRemotePtyLeases ??= []
    const normalizedLease = { ...lease }
    if (normalizedLease.leafId !== undefined && !isTerminalLeafId(normalizedLease.leafId)) {
      delete normalizedLease.leafId
    }
    // Why: store target-local pty ids in leases so reconnect can call relay pty.attach with raw ids (app ids are global).
    normalizedLease.ptyId = this.getRelayPtyIdForSshLeaseStorage(
      normalizedLease.targetId,
      normalizedLease.ptyId
    )
    const now = Date.now()
    const existingIndex = this.state.sshRemotePtyLeases.findIndex(
      (entry) =>
        entry.targetId === normalizedLease.targetId && entry.ptyId === normalizedLease.ptyId
    )
    const existing = existingIndex >= 0 ? this.state.sshRemotePtyLeases[existingIndex] : undefined
    const next: SshRemotePtyLease = {
      ...existing,
      ...normalizedLease,
      createdAt: existing?.createdAt ?? normalizedLease.createdAt ?? now,
      updatedAt: normalizedLease.updatedAt ?? now
    }
    if (existingIndex >= 0) {
      this.state.sshRemotePtyLeases[existingIndex] = next
    } else {
      this.state.sshRemotePtyLeases.push(next)
    }
    this.flush()
  }

  markSshRemotePtyLeases(targetId: string, state: SshRemotePtyLease['state']): void {
    const now = Date.now()
    let changed = false
    const shouldClearBindings = state === 'terminated' || state === 'expired'
    const leasesToClear: SshRemotePtyLease[] = []
    this.state.sshRemotePtyLeases ??= []
    for (const lease of this.state.sshRemotePtyLeases) {
      if (lease.targetId !== targetId) {
        continue
      }
      if (state === 'detached' && lease.state !== 'attached') {
        continue
      }
      if (lease.state !== state) {
        lease.state = state
        lease.updatedAt = now
        if (state === 'attached') {
          lease.lastAttachedAt = now
        } else if (state === 'detached') {
          lease.lastDetachedAt = now
        }
        changed = true
      }
      if (shouldClearBindings) {
        leasesToClear.push(lease)
      }
    }
    const bindingsChanged = shouldClearBindings
      ? this.clearSshRemotePtyBindingsForLeases(targetId, leasesToClear)
      : false
    if (changed || bindingsChanged) {
      this.flush()
    }
  }

  markSshRemotePtyLease(targetId: string, ptyId: string, state: SshRemotePtyLease['state']): void {
    const relayPtyId = this.getRelayPtyIdForSshLeaseStorage(targetId, ptyId)
    const lease = this.state.sshRemotePtyLeases?.find(
      (entry) => entry.targetId === targetId && entry.ptyId === relayPtyId
    )
    if (!lease) {
      return
    }
    const shouldClearBindings = state === 'terminated' || state === 'expired'
    if (lease.state === state) {
      if (shouldClearBindings && this.clearSshRemotePtyBindingsForLeases(targetId, [lease])) {
        this.flush()
      }
      return
    }
    const now = Date.now()
    lease.state = state
    lease.updatedAt = now
    if (state === 'attached') {
      lease.lastAttachedAt = now
    } else if (state === 'detached') {
      lease.lastDetachedAt = now
    }
    if (shouldClearBindings) {
      this.clearSshRemotePtyBindingsForLeases(targetId, [lease])
    }
    this.flush()
  }

  removeSshRemotePtyLease(targetId: string, ptyId: string): void {
    const relayPtyId = this.getRelayPtyIdForSshLeaseStorage(targetId, ptyId)
    const leases = (this.state.sshRemotePtyLeases ?? []).filter(
      (lease) => lease.targetId === targetId && lease.ptyId === relayPtyId
    )
    const before = this.state.sshRemotePtyLeases?.length ?? 0
    this.clearSshRemotePtyBindingsForLeases(targetId, leases)
    this.state.sshRemotePtyLeases = (this.state.sshRemotePtyLeases ?? []).filter(
      (lease) => lease.targetId !== targetId || lease.ptyId !== relayPtyId
    )
    if (this.state.sshRemotePtyLeases.length !== before) {
      this.flush()
    }
  }

  removeSshRemotePtyLeases(targetId: string): void {
    this.state.sshRemotePtyLeases ??= []
    this.clearSshRemotePtyBindingsForTarget(targetId)
    const before = this.state.sshRemotePtyLeases.length
    this.state.sshRemotePtyLeases = this.state.sshRemotePtyLeases.filter(
      (lease) => lease.targetId !== targetId
    )
    if (this.state.sshRemotePtyLeases.length !== before) {
      this.flush()
    }
  }

  protected clearSshRemotePtyBindingsForTarget(targetId: string): void {
    const leases = this.state.sshRemotePtyLeases?.filter((lease) => lease.targetId === targetId)
    this.clearSshRemotePtyBindingsForLeases(targetId, leases ?? [])
  }

  protected clearSshRemotePtyBindingsForLeases(
    targetId: string,
    leases: SshRemotePtyLease[]
  ): boolean {
    if (!leases?.length) {
      return false
    }
    let changed = false
    const sessions = new Set(
      [
        this.state.workspaceSession,
        this.state.workspaceSessionsByHostId?.[toSshExecutionHostId(targetId)]
      ].filter((session): session is WorkspaceSessionState => Boolean(session))
    )
    for (const session of sessions) {
      for (const [worktreeId, tabs] of Object.entries(session.tabsByWorktree ?? {})) {
        for (const tab of tabs) {
          if (
            tab.ptyId &&
            leases.some((lease) =>
              this.sshRemotePtyLeaseMayReferenceBinding(lease, {
                ptyId: tab.ptyId!,
                worktreeId,
                targetId,
                tabId: tab.id
              })
            )
          ) {
            tab.ptyId = null
            changed = true
          }
        }
      }
      for (const [tabId, layout] of Object.entries(session.terminalLayoutsByTabId ?? {})) {
        const bindings = layout.ptyIdsByLeafId
        if (!bindings) {
          continue
        }
        const worktreeId = Object.entries(session.tabsByWorktree ?? {}).find(([, tabs]) =>
          tabs.some((tab) => tab.id === tabId)
        )?.[0]
        const nextBindings = Object.fromEntries(
          Object.entries(bindings).filter(
            ([leafId, ptyId]) =>
              !leases.some((lease) =>
                this.sshRemotePtyLeaseMayReferenceBinding(lease, {
                  ptyId,
                  targetId,
                  worktreeId,
                  tabId,
                  leafId
                })
              )
          )
        )
        if (Object.keys(nextBindings).length !== Object.keys(bindings).length) {
          layout.ptyIdsByLeafId = nextBindings
          changed = true
        }
      }
    }
    if (changed) {
      this.scheduleSave()
    }
    return changed
  }

  // ── Flush (for shutdown) ───────────────────────────────────────────


}
