/* import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import { normalizeRightSidebarRoute } from '../right-sidebar-route'
import {
  findPrevLiveNonTaskStackHistoryIndex,
  findPrevLiveWorktreeHistoryIndex
} from './worktree-nav-history'
import type {
  ChangelogData,
  CustomPet,
  GitHubWorkItem,
  JiraIssue,
  LinearIssue,
  ManualRepoOrderEntry,
  PersistedTrustedOrcaHooks,
  PersistedUIState,
  StatusBarItem,
  TaskProvider,
  TaskResumeState,
  TaskViewPresetId,
  TuiAgent,
  UpdateStatus,
  WorkspaceStatusDefinition,
  AgentActivityDisplayMode,
  ProjectOrderBy,
  WorktreeCardProperty,
  WorktreeCardMode,
  WorkspaceHostOrder,
  WorkspaceHostScope,
  VisibleWorkspaceHostIds,
  TopLevelView
} from '../../../../shared/types'
import {
  applyManualRepoOrder,
  normalizeManualRepoOrder
} from '../../../../shared/manual-repo-order'
import { isTopLevelView } from '../../../../shared/top-level-view'
import { isReleaseChannel, type ReleaseChannel } from '../../../../shared/release-channel'
import type { UsagePercentageDisplay } from '../../../../shared/usage-percentage-display'
import {
  DEFAULT_USAGE_PERCENTAGE_DISPLAY,
  normalizeUsagePercentageDisplay
} from '../../../../shared/usage-percentage-display'
import {
  DEFAULT_STATUS_BAR_USAGE_MODE,
  normalizeStatusBarUsageMode,
  type StatusBarUsageMode
} from '../../../../shared/status-bar-usage-mode'
import type { GitLabWorkItem } from '../../../../shared/gitlab-types'
import type { LaunchSource } from '../../../../shared/telemetry-events'
import type { TaskSourceContext } from '../../../../shared/task-source-context'
import { PET_SIZE_DEFAULT, PET_SIZE_MAX, PET_SIZE_MIN } from '../../../../shared/types'
import {
  WORKSPACE_CLEANUP_CLASSIFIER_VERSION,
  type WorkspaceCleanupDismissal
} from '../../../../shared/workspace-cleanup'
import { normalizeFeatureTipIds, type FeatureTipId } from '../../../../shared/feature-tips'
import {
  hasFeatureInteraction,
  normalizeFeatureInteractions,
  type FeatureInteractionId,
  type FeatureInteractionState
} from '../../../../shared/feature-interactions'
import {
  getContextualTour,
  normalizeContextualTourIds,
  type ContextualTourId
} from '../../../../shared/contextual-tours'
import { PER_REPO_FETCH_LIMIT } from '../../../../shared/work-items'
import {
  normalizeVisibleTaskProviders,
  restoreAvailableDefaultTaskProvider,
  resolveVisibleTaskProvider
} from '../../../../shared/task-providers'
import {
  DEFAULT_HIDE_SLEEPING_WORKSPACES,
  DEFAULT_AGENT_ACTIVITY_DISPLAY_MODE,
  DEFAULT_SHOW_SLEEPING_WORKSPACES,
  DEFAULT_STATUS_BAR_ITEMS,
  DEFAULT_WORKTREE_CARD_PROPERTIES,
  getWorktreeCardModeUpdates,
  normalizeAgentActivityDisplayMode,
  normalizeWorktreeCardProperties
} from '../../../../shared/constants'
import {
  DEFAULT_BROWSER_PAGE_ZOOM_LEVEL,
  normalizeBrowserPageZoomLevel
} from '../../../../shared/browser-page-zoom'
import { persistedUIValuesEqual } from '../../../../shared/persisted-ui-equality'
import {
  normalizeExecutionHostOrder,
  normalizeExecutionHostScope,
  normalizeVisibleExecutionHostIds,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import {
  WORKSPACE_BOARD_COLUMN_WIDTH_DEFAULT,
  clampWorkspaceBoardColumnWidth,
  clampWorkspaceBoardOpacity,
  cloneDefaultWorkspaceStatuses,
  normalizeWorkspaceStatuses
} from '../../../../shared/workspace-statuses'
import { clampMarkdownTocPanelWidth } from '../../../../shared/markdown-toc-panel-width'
import { clampCombinedDiffFileTreeWidth } from '../../../../shared/combined-diff-file-tree-width'
import { normalizeKagiSessionLink } from '../../../../shared/browser-url'
import type { OrcaHookScriptKind } from '../../lib/orca-hook-trust'
import {
  isSettingsNavigationTarget,
  type SettingsNavigationTarget
} from '@/lib/settings-navigation-types'
import {
  filterSetupScriptPromptDismissalsToValidRepos,
  getSetupScriptPromptDismissalKey,
  sanitizeSetupScriptPromptDismissals
} from '../../lib/setup-script-prompt'
import { DEFAULT_PET_ID, isBundledPetId } from '../../components/pet/pet-models'
import { revokeCustomPetBlobUrl } from '../../components/pet/pet-blob-cache'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import type { WorkspacePortScanResult } from '../../../../shared/workspace-ports'
import {
  getContextualTourRequestDecision,
  hasContextualTourTarget,
  getNextVisibleContextualTourStepIndex,
  getPreviousVisibleContextualTourStepIndex
} from '../../components/contextual-tours/contextual-tour-gate'
import { agentKindForAgentType, formatAgentTypeLabel } from '../../lib/agent-status'
import {
  deriveRunningAgentSendTargets,
  resolveRunningAgentSendTarget
} from '../../lib/running-agent-targets'
import { buildAgentNotificationId } from '../../../../shared/agent-notification-id'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import { translate } from '@/i18n/i18n'
import { getRepoHostIdentity } from './repo-host-identity'
import { mergeFeatureInteractionState, mergeContextualTourSeenIds, getContextualTourProgressionForFeatureInteraction, clampPetSize, presetToQuery, migrateStatusBarItems, DEFAULT_ON_PORTS_STATUS_BAR_ITEM, DEFAULT_ON_KIMI_STATUS_BAR_ITEM, DEFAULT_ON_MINIMAX_STATUS_BAR_ITEM, DEFAULT_ON_ANTIGRAVITY_STATUS_BAR_ITEM, DEFAULT_ON_GROK_STATUS_BAR_ITEM, normalizeHydratedVisibleWorkspaceHostIds, MIN_SIDEBAR_WIDTH, MAX_LEFT_SIDEBAR_WIDTH, MAX_RIGHT_SIDEBAR_WIDTH, LINEAR_TASK_PREFETCH_LIMIT, HYDRATE_MAX_AGE_MS, VALID_TASK_PRESETS, VALID_LINEAR_PRESETS, VALID_LINEAR_MODES, VALID_JIRA_PRESETS, resolvePaneKeyWorktreeIdFromTabs, collectAcknowledgedAgentNotificationId, isPlainPersistedRecord, sanitizePersistedRepoIds, sanitizeTrustedOrcaHooks, filterTrustedOrcaHooksToValidRepos, hydrateTrustedOrcaHooks, isSafePersistedRecordKey, sanitizeShowDotfilesByWorktree, sanitizePersistedSidebarWidth, sanitizeAcknowledgedAgentsByPaneKey, sanitizeWorkspaceCleanupDismissals, hydratedUIPartialMatchesState, sanitizeHydratedActiveView, createAgentSendTargetModeInstanceId, sanitizeTaskResumeState } from './ui-state'
import type { PendingSidebarWorktreeReveal, PendingSidebarRowReveal, AgentSendPopoverTargetMode, OpenAgentSendPopoverTargetModeArgs, UISlice } from './ui-state'
type SliceSet = Parameters<StateCreator<AppState>>[0]
type SliceGet = Parameters<StateCreator<AppState>>[1]
export function createUISliceCancelContextualTourActions4(set: SliceSet, get: SliceGet) {
  return {
  cancelContextualTour: (id) =>
    set((s) => {
      const activeTourId = s.activeContextualTourId
      const tourId = id ?? activeTourId
      if (!tourId || (id && activeTourId !== id)) {
        return s
      }
      const alreadyShown = s.contextualToursSeenIds.includes(tourId)
      return {
        activeContextualTourId: null,
        activeContextualTourStepIndex: 0,
        activeContextualTourSource: null,
        activeContextualTourSourceDetached: false,
        activeContextualTourWasFeaturePreviouslyInteracted: false,
        activeContextualTourSuppressed: false,
        lastCompletedContextualTourId: null,
        contextualTourShownThisSession: alreadyShown ? s.contextualTourShownThisSession : false
      }
    }),
  markContextualToursSeen: (ids) =>
    set((s) => {
      if (ids.length === 0) {
        return s
      }
      const current = new Set(s.contextualToursSeenIds)
      let changed = false
      for (const id of ids) {
        if (!current.has(id)) {
          current.add(id)
          changed = true
        }
      }
      if (!changed) {
        return s
      }
      const next = [...current]
      if (typeof window !== 'undefined') {
        window.api.ui.set({ contextualToursSeenIds: next }).catch(console.error)
      }
      return { contextualToursSeenIds: next }
    }),
  trustedOrcaHooks: {},
  markOrcaHookScriptConfirmed: (repoId, kind, contentHash) =>
    set((s) => {
      const existing = s.trustedOrcaHooks[repoId]
      const currentEntry = existing?.[kind]
      if (currentEntry?.contentHash === contentHash) {
        return s
      }
      const nextRepo = {
        ...existing,
        [kind]: { contentHash, approvedAt: Date.now() }
      }
      const next = { ...s.trustedOrcaHooks, [repoId]: nextRepo }
      window.api.ui.set({ trustedOrcaHooks: next }).catch(console.error)
      return { trustedOrcaHooks: next }
    }),
  markOrcaHookRepoAlwaysTrusted: (repoId) =>
    set((s) => {
      const existing = s.trustedOrcaHooks[repoId]
      if (existing?.all) {
        return s
      }
      const next = {
        ...s.trustedOrcaHooks,
        [repoId]: {
          ...existing,
          all: { approvedAt: Date.now() }
        }
      }
      window.api.ui.set({ trustedOrcaHooks: next }).catch(console.error)
      return { trustedOrcaHooks: next }
    }),
  clearOrcaHookTrustForRepo: (repoId) =>
    set((s) => {
      if (!(repoId in s.trustedOrcaHooks)) {
        return s
      }
      const next = { ...s.trustedOrcaHooks }
      delete next[repoId]
      window.api.ui.set({ trustedOrcaHooks: next }).catch(console.error)
      return { trustedOrcaHooks: next }
    }),
  setupScriptPromptDismissedRepoIds: [],
  dismissSetupScriptPrompt: (repoHostIdentity) =>
    set((s) => {
      const dismissalKey = getSetupScriptPromptDismissalKey(repoHostIdentity)
      if (!repoHostIdentity || s.setupScriptPromptDismissedRepoIds.includes(dismissalKey)) {
        return s
      }
      const next = [...s.setupScriptPromptDismissedRepoIds, dismissalKey]
      window.api.ui.set({ setupScriptPromptDismissedRepoIds: next }).catch(console.error)
      return { setupScriptPromptDismissedRepoIds: next }
    }),
  setupGuideSidebarDismissed: false,
  setSetupGuideSidebarDismissed: (dismissed) =>
    set((s) => {
      if (s.setupGuideSidebarDismissed === dismissed) {
        return s
      }
      window.api.ui.set({ setupGuideSidebarDismissed: dismissed }).catch(console.error)
      return { setupGuideSidebarDismissed: dismissed }
    }),
  setupGuideBrowserMilestoneMigrated: true,
  setupGuideBrowserMilestoneLegacyComplete: false,
  markSetupGuideBrowserMilestoneMigrated: (legacyComplete) =>
    set((s) => {
      if (
        s.setupGuideBrowserMilestoneMigrated &&
        s.setupGuideBrowserMilestoneLegacyComplete === legacyComplete
      ) {
        return s
      }
      const updates = {
        setupGuideBrowserMilestoneMigrated: true,
        setupGuideBrowserMilestoneLegacyComplete: legacyComplete
      }
      window.api.ui.set(updates).catch(console.error)
      return updates
    }),
  browserImportHintHidden: false,
  setBrowserImportHintHidden: (hidden) =>
    set((s) => {
      if (s.browserImportHintHidden === hidden) {
        return s
      }
      window.api.ui.set({ browserImportHintHidden: hidden }).catch(console.error)
      return { browserImportHintHidden: hidden }
    }),
  mobileEmulatorTabIntroDismissed: false,
  dismissMobileEmulatorTabIntro: () =>
    set((s) => {
      if (s.mobileEmulatorTabIntroDismissed) {
        return s
      }
      window.api.ui.set({ mobileEmulatorTabIntroDismissed: true }).catch(console.error)
      return { mobileEmulatorTabIntroDismissed: true }
    }),
  mobileEmulatorAgentSetupDismissed: false,
  dismissMobileEmulatorAgentSetup: () =>
    set((s) => {
      if (s.mobileEmulatorAgentSetupDismissed) {
        return s
      }
      window.api.ui.set({ mobileEmulatorAgentSetupDismissed: true }).catch(console.error)
      return { mobileEmulatorAgentSetupDismissed: true }
    }),
  projectOrderManualDefaultNoticeDismissed: true,
  dismissProjectOrderManualDefaultNotice: () =>
    set((s) => {
      if (s.projectOrderManualDefaultNoticeDismissed) {
        return s
      }
      window.api.ui.set({ projectOrderManualDefaultNoticeDismissed: true }).catch(console.error)
      return { projectOrderManualDefaultNoticeDismissed: true }
    }),
  // Why: default true so pre-hydration / new sessions never flash the change notice before persistence resolves.
  usagePercentageDisplayChangeNoticeDismissed: true,
  dismissUsagePercentageDisplayChangeNotice: () =>
    set((s) => {
      if (s.usagePercentageDisplayChangeNoticeDismissed) {
        return s
      }
      window.api.ui.set({ usagePercentageDisplayChangeNoticeDismissed: true }).catch(console.error)
      return { usagePercentageDisplayChangeNoticeDismissed: true }
    }),
  usageEmptyStateDismissed: false,
  dismissUsageEmptyState: () =>
    set((s) => {
      if (s.usageEmptyStateDismissed) {
        return s
      }
      window.api.ui.set({ usageEmptyStateDismissed: true }).catch(console.error)
      return { usageEmptyStateDismissed: true }
    }),
  groupBy: 'repo',
  // Why: group keys are mode-specific, so clear collapsed state on mode switch — stale keys are meaningless and accumulate.
  setGroupBy: (g) => {
    window.api.ui.set({ groupBy: g, collapsedGroups: [] }).catch(console.error)
    set({ groupBy: g, collapsedGroups: new Set<string>() })
  },
  sortBy: 'recent',
  setSortBy: (s) => set({ sortBy: s }),

  // Why: bare set — persists only via the debounced window.api.ui.set writer in App.tsx, not on its own.
  projectOrderBy: 'manual',
  setProjectOrderBy: (p) => set({ projectOrderBy: p }),
  showActiveOnly: false,
  setShowActiveOnly: (v) => set({ showActiveOnly: v }),
  showSleepingWorkspaces: DEFAULT_SHOW_SLEEPING_WORKSPACES,
  setShowSleepingWorkspaces: (v) => set({ showSleepingWorkspaces: v }),
  workspaceHostScope: 'all',
  // Why: host scope is presentation/filtering only — must never trigger resource teardown (terminals, browser pages).
  setWorkspaceHostScope: (scope) => {
    const normalized = normalizeExecutionHostScope(scope)
    const visibleWorkspaceHostIds = normalized === 'all' ? null : [normalized]
    set({ workspaceHostScope: normalized, visibleWorkspaceHostIds })
    window.api.ui
      .set({ workspaceHostScope: normalized, visibleWorkspaceHostIds })
      .catch(console.error)
  },
  visibleWorkspaceHostIds: null,
  setVisibleWorkspaceHostIds: (ids) => {
    const normalized = normalizeVisibleExecutionHostIds(ids)
    // Why: workspaceHostScope stays the compat/default-host signal for creation flows; visibility can now be multi-select.
    let workspaceHostScope: WorkspaceHostScope = get().workspaceHostScope
    if (normalized === null) {
      workspaceHostScope = 'all'
    } else if (normalized.length === 1) {
      workspaceHostScope = normalized[0]
    }
    set({ visibleWorkspaceHostIds: normalized, workspaceHostScope })
    window.api.ui
      .set({ visibleWorkspaceHostIds: normalized, workspaceHostScope })
      .catch(console.error)
  },
  workspaceHostOrder: [],
  setWorkspaceHostOrder: (ids) => {
    const workspaceHostOrder = normalizeExecutionHostOrder(ids)
    set({ workspaceHostOrder })
    window.api.ui.set({ workspaceHostOrder }).catch(console.error)
  },
  manualRepoOrder: [],
  hideDefaultBranchWorkspace: false,
  setHideDefaultBranchWorkspace: (v) => set({ hideDefaultBranchWorkspace: v }),
  hideAutomationGeneratedWorkspaces: false,
  setHideAutomationGeneratedWorkspaces: (v) => set({ hideAutomationGeneratedWorkspaces: v }),
  hideCliCreatedWorkspaces: false,
  setHideCliCreatedWorkspaces: (v) => set({ hideCliCreatedWorkspaces: v }),
  hideDetachedHeadWorkspaces: false,
  setHideDetachedHeadWorkspaces: (v) => set({ hideDetachedHeadWorkspaces: v }),
  showDotfilesByWorktree: {},
  setShowDotfilesForWorktree: (worktreeId, showDotfiles) =>
    set((s) => {
      if (!worktreeId) {
        return s
      }
      const current = s.showDotfilesByWorktree[worktreeId] ?? true
      if (current === showDotfiles) {
        return s
      }
      const next = { ...s.showDotfilesByWorktree }
      // Why: showing dotfiles is the default; only persist worktree-level opt-outs.
      if (showDotfiles) {
        delete next[worktreeId]
      } else {
        next[worktreeId] = false
      }
      return { showDotfilesByWorktree: next }
    }),
  toggleShowDotfilesForWorktree: (worktreeId) =>
    set((s) => {
      if (!worktreeId) {
        return s
      }
      const nextShowDotfiles = !(s.showDotfilesByWorktree[worktreeId] ?? true)
      const next = { ...s.showDotfilesByWorktree }
      if (nextShowDotfiles) {
        delete next[worktreeId]
      } else {
        next[worktreeId] = false
      }
      return { showDotfilesByWorktree: next }
    }),
  filterRepoIds: [],
  setFilterRepoIds: (ids) => set({ filterRepoIds: ids }),
  collapsedGroups: new Set<string>(),
  toggleCollapsedGroup: (key) =>
    set((s) => {
      const next = new Set(s.collapsedGroups)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      window.api.ui.set({ collapsedGroups: [...next] }).catch(console.error)
      return { collapsedGroups: next }
    }),
  worktreeCardProperties: [...DEFAULT_WORKTREE_CARD_PROPERTIES],
  _worktreeCardModeDefaulted: true,
  setWorktreeCardMode: (mode) => {
    const updates = getWorktreeCardModeUpdates(mode)
    set((s) => ({
      settings: s.settings ? { ...s.settings, ...updates.settings } : s.settings,
      worktreeCardProperties: updates.ui.worktreeCardProperties,
      _worktreeCardModeDefaulted: true
    }))
    void Promise.all([
      window.api.settings.set(updates.settings).then((nextSettings) => {
        if (nextSettings) {
          set({ settings: nextSettings })
        }
      }),
      window.api.ui.set(updates.ui)
    ]).catch(console.error)
  },
  }
}