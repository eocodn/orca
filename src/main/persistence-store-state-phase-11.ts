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
import {
  normalizeWorkspaceSessionPaneIdentities,
  remapAcknowledgedAgentPaneKeys,
  remapSshRemotePtyLeaseLeafIds,
  MAX_CLAUDE_LIVE_PTY_SESSION_IDS,
  MAX_REMOVED_SSH_TARGET_TOMBSTONES
} from './persistence-state-session-migration'
import { registerPersistedPaneKeyAlias } from './persistence-state-ssh'
import { workspaceSessionPatchNeedsFullNormalization } from './persistence-state-foundation'

import { removeWorkspaceSessionOwner,
  removeWorkspaceSessionOwners,
  inferFolderScopeConnectionIdForMigration,
  backfillFolderScopeConnectionIds,
  deleteRemovedTerminalScrollbackSnapshots,
  type StoreOptions,
  getDefaultWorktreeMeta } from './persistence-state-phase-8'
import { StorePhase10 } from './persistence-store-state-phase-10'

export class StorePhase11 extends StorePhase10 {
  protected setLocalWorkspaceSession(session: PersistedState['workspaceSession']): void {
    const prior = this.state.workspaceSession
    session = sanitizeWorkspaceSessionTerminalRetirements(session, prior)
    session = pruneWorkspaceSessionBrowserHistory(
      pruneLocalTerminalScrollbackBuffers(session, this.state.repos)
    )

    // Why (Issue #217): merge existing bindings when the incoming binding is empty, so a stale pre-spawn snapshot can't overwrite the durable PTY binding.
    const normalized = normalizeWorkspaceSessionPaneIdentities(
      session,
      prior?.terminalLayoutsByTabId
    )
    for (const entry of normalized.migrationUnsupportedEntries) {
      setMigrationUnsupportedPty(entry)
    }
    const remappedAcknowledgements = remapAcknowledgedAgentPaneKeys(
      this.state.ui?.acknowledgedAgentsByPaneKey,
      normalized.leafIdByInputLeafIdByTabId
    )
    if (remappedAcknowledgements.changed) {
      this.state.ui = {
        ...this.state.ui,
        acknowledgedAgentsByPaneKey: remappedAcknowledgements.acknowledgements
      }
    }
    for (const entry of normalized.legacyPaneKeyAliasEntries) {
      registerPersistedPaneKeyAlias(entry)
    }
    session = normalized.session
    const remappedLeases = remapSshRemotePtyLeaseLeafIds(
      this.state.sshRemotePtyLeases ?? [],
      normalized.leafIdByInputLeafIdByTabId,
      normalized.leafIdByPtyIdByTabId
    )
    if (remappedLeases.changed) {
      this.state.sshRemotePtyLeases = remappedLeases.leases
    }
    if (session && prior) {
      const priorTabs = prior.tabsByWorktree ?? {}
      const nextTabs = session.tabsByWorktree ?? {}
      const worktreeIdByTabId = new Map<string, string>()
      for (const [worktreeId, tabs] of Object.entries({ ...priorTabs, ...nextTabs })) {
        for (const tab of tabs) {
          worktreeIdByTabId.set(tab.id, worktreeId)
        }
      }
      for (const [worktreeId, tabs] of Object.entries(nextTabs)) {
        const priorList = priorTabs[worktreeId]
        if (!priorList) {
          continue
        }
        for (const tab of tabs) {
          if (tab.ptyId) {
            continue
          }
          const priorTab = priorList.find((t) => t.id === tab.id)
          if (
            priorTab?.ptyId &&
            this.isRestorablePtyBinding({
              ptyId: priorTab.ptyId,
              worktreeId,
              targetId: this.getConnectionIdForWorktree(worktreeId),
              tabId: tab.id
            })
          ) {
            tab.ptyId = priorTab.ptyId
          }
        }
      }
      const priorLayouts = prior.terminalLayoutsByTabId ?? {}
      const nextLayouts = session.terminalLayoutsByTabId ?? {}
      for (const [tabId, layout] of Object.entries(nextLayouts)) {
        const priorLayout = priorLayouts[tabId]
        if (!priorLayout?.ptyIdsByLeafId) {
          continue
        }
        const incoming = layout.ptyIdsByLeafId ?? {}
        const incomingHasAnyBinding = Object.keys(incoming).length > 0
        const liveLeafIds = this.getTerminalLayoutLeafIds(layout.root)
        const worktreeId = worktreeIdByTabId.get(tabId)
        const targetId = worktreeId ? this.getConnectionIdForWorktree(worktreeId) : null
        const restorableBindings = Object.fromEntries(
          Object.entries(priorLayout.ptyIdsByLeafId).filter(
            ([leafId, ptyId]) =>
              liveLeafIds.has(leafId) &&
              incoming[leafId] === undefined &&
              // Why: an empty layout map may be a stale pre-spawn snapshot; a partial map is intentional unless a durable SSH lease proves it.
              (incomingHasAnyBinding
                ? this.hasRestorableSshRemotePtyLease({
                    ptyId,
                    targetId,
                    worktreeId,
                    tabId,
                    leafId
                  })
                : this.isRestorablePtyBinding({ ptyId, targetId, worktreeId, tabId, leafId }))
          )
        )
        if (Object.keys(restorableBindings).length > 0) {
          layout.ptyIdsByLeafId = { ...restorableBindings, ...incoming }
          // Why: the same stale write that drops ptyIdsByLeafId may come from an older renderer lacking UUID-keyed metadata.
          const buffersByLeafId = preserveMissingLeafRecordEntries(
            priorLayout.buffersByLeafId,
            layout.buffersByLeafId,
            liveLeafIds
          )
          const scrollbackRefsByLeafId = preserveMissingLeafRecordEntries(
            priorLayout.scrollbackRefsByLeafId,
            layout.scrollbackRefsByLeafId,
            liveLeafIds
          )
          const titlesByLeafId = preserveMissingLeafRecordEntries(
            priorLayout.titlesByLeafId,
            layout.titlesByLeafId,
            liveLeafIds
          )
          if (buffersByLeafId) {
            layout.buffersByLeafId = buffersByLeafId
          }
          if (scrollbackRefsByLeafId) {
            layout.scrollbackRefsByLeafId = scrollbackRefsByLeafId
          }
          if (titlesByLeafId) {
            layout.titlesByLeafId = titlesByLeafId
          }
        }
      }
    }
    session = pruneLocalTerminalScrollbackBuffers(session, this.state.repos)
    const migratedScrollback = migrateWorkspaceSessionTerminalScrollbackSnapshots(
      session,
      this.terminalScrollbackSnapshotStorage
    )
    session = migratedScrollback.session
    deleteRemovedTerminalScrollbackSnapshots(prior, session, this.terminalScrollbackSnapshotStorage)
    this.state.workspaceSession = session
    this.scheduleSave()
  }

  patchWorkspaceSession(patch: WorkspaceSessionPatch, hostId?: string | null): void {
    const resolved = this.resolveHostId(hostId)
    // Why: the debounced hot path sends only changed slices; scalar/UI patches skip terminal normalization, topology patches keep stale-PTY protections.
    let next: WorkspaceSessionState = {
      ...this.getWorkspaceSession(resolved),
      ...patch
    }
    if (workspaceSessionPatchNeedsFullNormalization(patch)) {
      this.setWorkspaceSession(next, resolved)
      return
    }
    if (Object.hasOwn(patch, 'browserUrlHistory')) {
      next = pruneWorkspaceSessionBrowserHistory(next)
    }
    if (resolved === LOCAL_EXECUTION_HOST_ID) {
      this.state.workspaceSession = next
    } else {
      this.state.workspaceSessionsByHostId = {
        ...this.state.workspaceSessionsByHostId,
        [resolved]: next
      }
    }
    this.scheduleSave()
  }

  protected getTerminalLayoutLeafIds(root: TerminalPaneLayoutNode | null): Set<string> {
    const leafIds = new Set<string>()
    const visit = (node: TerminalPaneLayoutNode | null): void => {
      if (!node) {
        return
      }
      if (node.type === 'leaf') {
        if (isTerminalLeafId(node.leafId)) {
          leafIds.add(node.leafId)
        }
        return
      }
      visit(node.first)
      visit(node.second)
    }
    visit(root)
    return leafIds
  }

  protected isRestorablePtyBinding(binding: {
    ptyId: string
    targetId?: string | null
    worktreeId?: string
    tabId?: string
    leafId?: string
  }): boolean {
    const leases = this.state.sshRemotePtyLeases?.filter((entry) =>
      this.sshRemotePtyLeaseMatchesBinding(entry, binding)
    )
    return !leases?.some((lease) => lease.state === 'terminated' || lease.state === 'expired')
  }

  protected getRelayPtyIdForSshLeaseComparison(targetId: string, ptyId: string): string {
    try {
      return toRelaySshPtyId(targetId, ptyId)
    } catch {
      return ptyId
    }
  }

  protected getRelayPtyIdForSshLeaseStorage(targetId: string, ptyId: string): string {
    return toRelaySshPtyId(targetId, ptyId)
  }

  protected sshRemotePtyLeaseMatchesBinding(
    lease: SshRemotePtyLease,
    binding: {
      ptyId: string
      targetId?: string | null
      worktreeId?: string
      tabId?: string
      leafId?: string
    }
  ): boolean {
    const bindingPtyId = this.getRelayPtyIdForSshLeaseComparison(lease.targetId, binding.ptyId)
    if (lease.ptyId !== bindingPtyId) {
      return false
    }
    // Why: remote PTY ids are scoped to a relay target; require stored lease context to match so missing fields don't tombstone unrelated panes.
    return (
      (binding.targetId === undefined ||
        binding.targetId === null ||
        lease.targetId === binding.targetId) &&
      (binding.worktreeId === undefined || lease.worktreeId === binding.worktreeId) &&
      (binding.tabId === undefined || lease.tabId === binding.tabId) &&
      (binding.leafId === undefined || lease.leafId === binding.leafId)
    )
  }

  protected hasRestorableSshRemotePtyLease(binding: {
    ptyId: string
    targetId?: string | null
    worktreeId?: string
    tabId?: string
    leafId?: string
  }): boolean {
    return (
      this.state.sshRemotePtyLeases?.some(
        (lease) =>
          this.sshRemotePtyLeaseMatchesBinding(lease, binding) &&
          lease.state !== 'terminated' &&
          lease.state !== 'expired'
      ) ?? false
    )
  }

  protected sshRemotePtyLeaseMayReferenceBinding(
    lease: SshRemotePtyLease,
    binding: {
      ptyId: string
      targetId: string
      worktreeId?: string
      tabId?: string
      leafId?: string
    }
  ): boolean {
    const bindingPtyId = this.getRelayPtyIdForSshLeaseComparison(binding.targetId, binding.ptyId)
    if (lease.targetId !== binding.targetId || lease.ptyId !== bindingPtyId) {
      return false
    }
    // Why: target removal is destructive; scrub matching bindings before deleting the lease, else removing the tombstone can revive stale PTY ids.
    return (
      (binding.worktreeId === undefined ||
        lease.worktreeId === undefined ||
        lease.worktreeId === binding.worktreeId) &&
      (binding.tabId === undefined || lease.tabId === undefined || lease.tabId === binding.tabId) &&
      (binding.leafId === undefined ||
        lease.leafId === undefined ||
        lease.leafId === binding.leafId)
    )
  }

  protected getConnectionIdForWorktree(worktreeId: string): string | null {
    const repoId = getRepoIdFromWorktreeId(worktreeId)
    return this.state.repos.find((repo) => repo.id === repoId)?.connectionId ?? null
  }

  // Why: sync-flush the pty binding before pty:spawn returns to close the spawn/persist SIGKILL race (Issue #217).

}
