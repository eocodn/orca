 import type { StateCreator } from 'zustand'
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
export function createUISliceOpenTaskPageActions2(set: SliceSet, get: SliceGet) {
  return {
  openTaskPage: (data = {}, options = {}) => {
    if (options.recordTasksInteraction !== false) {
      const wasTasksPreviouslyInteracted = hasFeatureInteraction(get().featureInteractions, 'tasks')
      set((state) => ({
        contextualTourNavigationInteractionSnapshot: {
          ...state.contextualTourNavigationInteractionSnapshot,
          tasks: wasTasksPreviouslyInteracted
        }
      }))
      get().recordFeatureInteraction?.('tasks')
    }
    if (data.openGitHubWorkItem) {
      get().recordFeatureInteraction?.('github-tasks')
    }
    if (data.openGitLabWorkItem) {
      get().recordFeatureInteraction?.('gitlab-tasks')
    }
    if (data.openLinearIssue) {
      get().recordFeatureInteraction?.('linear-tasks')
    }
    if (data.openJiraIssue) {
      get().recordFeatureInteraction?.('jira-tasks')
    }
    // Why: record a Tasks visit in shared back/forward history; all task-source variants collapse to one deduped 'tasks' entry.
    const detailEntry = data.openGitHubWorkItem
      ? ({
          kind: 'task-detail',
          source: 'github',
          workItem: data.openGitHubWorkItem,
          sourceContext: data.openGitHubSourceContext,
          initialTab: data.openGitHubInitialTab
        } as const)
      : data.openGitLabWorkItem
        ? ({
            kind: 'task-detail',
            source: 'gitlab',
            workItem: data.openGitLabWorkItem,
            sourceContext: data.openGitLabSourceContext
          } as const)
        : data.openLinearIssue
          ? ({
              kind: 'task-detail',
              source: 'linear',
              issue: data.openLinearIssue,
              sourceContext: data.openLinearSourceContext
            } as const)
          : data.openJiraIssue
            ? ({
                kind: 'task-detail',
                source: 'jira',
                issue: data.openJiraIssue,
                sourceContext: data.openJiraSourceContext
              } as const)
            : null
    const currentEntry = get().worktreeNavHistory[get().worktreeNavHistoryIndex]
    const currentIsTaskStack =
      currentEntry === 'tasks' ||
      (typeof currentEntry === 'object' && currentEntry.kind === 'task-detail')
    if (!detailEntry || !currentIsTaskStack) {
      get().recordViewVisit('tasks')
    }
    if (detailEntry) {
      get().recordViewVisit(detailEntry)
    }
    set((state) => ({
      activeView: 'tasks',
      previousViewBeforeTasks:
        state.activeView === 'tasks' ? state.previousViewBeforeTasks : state.activeView,
      taskPageData: data
    }))
    // Why: prefetch the work-item list during first render so the page's effect hits a warm/in-flight SWR cache (~300–800ms win).
    const state = get()
    const preferredVisibleTaskProviders = normalizeVisibleTaskProviders(
      state.settings?.visibleTaskProviders
    )
    const visibleTaskProviders = restoreAvailableDefaultTaskProvider(
      preferredVisibleTaskProviders,
      {
        gitlabInstalled: state.preflightStatus?.glab?.installed === true,
        linearConnected: state.linearStatus?.connected === true
      },
      state.settings?.defaultTaskSource
    )
    const resolvedSource = resolveVisibleTaskProvider(
      data.taskSource ?? state.settings?.defaultTaskSource,
      visibleTaskProviders
    )
    const resolvedMode = state.taskResumeState?.githubMode ?? 'items'
    if (resolvedSource === 'github' && resolvedMode === 'items') {
      const eligibleRepos = state.repos.filter((repo) => isGitRepoKind(repo) && repo.path)
      const selectedRepos = (() => {
        const preferred = data.preselectedRepoId
        if (preferred) {
          const repo = eligibleRepos.find((r) => r.id === preferred)
          return repo ? [repo] : []
        }
        const persisted = state.settings?.defaultRepoSelection
        if (Array.isArray(persisted)) {
          const selected = eligibleRepos.filter((repo) => persisted.includes(repo.id))
          if (selected.length > 0) {
            return selected
          }
        }
        return eligibleRepos
      })()

      const resume = state.taskResumeState
      const defaultPreset = state.settings?.defaultTaskViewPreset ?? 'all'
      // Why: must match the query TaskPage's resume effect mounts with, else the warm cache key misses and prefetch is wasted.
      const query =
        resume?.githubItemsPreset === null
          ? (resume.githubItemsQuery ?? '').trim()
          : presetToQuery(resume?.githubItemsPreset ?? defaultPreset)
      for (const repo of selectedRepos) {
        state.prefetchWorkItems(repo.id, repo.path, PER_REPO_FETCH_LIMIT, query, {
          sourceContext:
            data.openGitHubSourceContext?.provider === 'github' &&
            data.openGitHubSourceContext.repoId === repo.id
              ? data.openGitHubSourceContext
              : null
        })
      }
    }
    if (resolvedSource === 'linear' && typeof state.prefetchLinearIssues === 'function') {
      const resume = state.taskResumeState
      const query = (resume?.linearQuery ?? '').trim()
      const sourceContext =
        data.openLinearSourceContext?.provider === 'linear' ? data.openLinearSourceContext : null
      if (query) {
        state.prefetchLinearIssues(
          { kind: 'search', query, limit: LINEAR_TASK_PREFETCH_LIMIT },
          { sourceContext }
        )
      } else {
        // Why: TaskPage no longer exposes Linear preset filters; keep prefetch aligned with the default unsearched issue list.
        state.prefetchLinearIssues(
          {
            kind: 'list',
            filter: 'all',
            limit: LINEAR_TASK_PREFETCH_LIMIT
          },
          { sourceContext }
        )
      }
    }
  },
  setTaskResumeState: (updates) =>
    set((s) => {
      const next = { ...s.taskResumeState, ...updates }
      window.api.ui.set({ taskResumeState: next }).catch(console.error)
      return { taskResumeState: next }
    }),
  setGithubTaskDrawerWorkItem: (item) => set({ githubTaskDrawerWorkItem: item }),
  closeTaskPage: () =>
    set((state) => {
      // Why: if parked on a 'tasks' entry, rewind the history index so Back/Forward aren't no-ops; keep 0 if it's the only entry.
      const currentEntry = state.worktreeNavHistory[state.worktreeNavHistoryIndex]
      let nextHistoryIndex = state.worktreeNavHistoryIndex
      if (
        currentEntry === 'tasks' ||
        (typeof currentEntry === 'object' && currentEntry.kind === 'task-detail')
      ) {
        const prev = findPrevLiveNonTaskStackHistoryIndex(state)
        if (prev !== null) {
          nextHistoryIndex = prev
        } else if (typeof currentEntry === 'object' && state.worktreeNavHistory[0] === 'tasks') {
          nextHistoryIndex = 0
        }
      }
      return {
        activeView: state.previousViewBeforeTasks,
        taskPageData: {},
        githubTaskDrawerWorkItem: null,
        worktreeNavHistoryIndex: nextHistoryIndex
      }
    }),
  openActivityPage: () => {
    if (get().settings?.experimentalActivity !== true) {
      return
    }
    set((state) => ({
      activeView: 'activity',
      previousViewBeforeActivity:
        state.activeView === 'activity' ? state.previousViewBeforeActivity : state.activeView
    }))
  },
  closeActivityPage: () =>
    set((state) => ({
      activeView: state.previousViewBeforeActivity
    })),
  selectedAutomationId: null,
  setSelectedAutomationId: (id) => set({ selectedAutomationId: id }),
  pendingAutomationRunNavigation: null,
  setPendingAutomationRunNavigation: (navigation) =>
    set({ pendingAutomationRunNavigation: navigation }),
  openAutomationsPage: () => {
    get().recordViewVisit('automations')
    set((state) => ({
      activeView: 'automations',
      previousViewBeforeAutomations:
        state.activeView === 'automations' ? state.previousViewBeforeAutomations : state.activeView
    }))
  },
  closeAutomationsPage: () =>
    set((state) => {
      const currentEntry = state.worktreeNavHistory[state.worktreeNavHistoryIndex]
      let nextHistoryIndex = state.worktreeNavHistoryIndex
      if (currentEntry === 'automations') {
        const prev = findPrevLiveWorktreeHistoryIndex(state)
        if (prev !== null) {
          nextHistoryIndex = prev
        }
      }
      return {
        activeView: state.previousViewBeforeAutomations,
        worktreeNavHistoryIndex: nextHistoryIndex
      }
    }),
  openSpacePage: () => {
    get().recordFeatureInteraction?.('workspace-cleanup')
    set((state) => ({
      activeView: 'space',
      previousViewBeforeSpace:
        state.activeView === 'space' ? state.previousViewBeforeSpace : state.activeView
    }))
  },
  closeSpacePage: () =>
    set((state) => ({
      activeView: state.previousViewBeforeSpace
    })),
  openSkillsPage: () =>
    set((state) => ({
      activeView: 'skills',
      previousViewBeforeSkills:
        state.activeView === 'skills' ? state.previousViewBeforeSkills : state.activeView
    })),
  closeSkillsPage: () =>
    set((state) => ({
      activeView: state.previousViewBeforeSkills
    })),
  openMobilePage: () =>
    set((state) => ({
      activeView: 'mobile',
      previousViewBeforeMobile:
        state.activeView === 'mobile' ? state.previousViewBeforeMobile : state.activeView
    })),
  closeMobilePage: () =>
    set((state) => ({
      activeView: state.previousViewBeforeMobile
    })),
  setNewWorkspaceDraft: (draft) => set({ newWorkspaceDraft: draft }),
  clearNewWorkspaceDraft: () => set({ newWorkspaceDraft: null }),
  openSettingsPage: () => {
    // Why: settings search is a transient filter; opening Settings shouldn't inherit hidden sections from last visit.
    get().setSettingsSearchQuery('')
    set((state) => ({
      activeView: 'settings',
      // Why: preserve the originating view so Settings back returns there (e.g. in-progress draft), not always terminal.
      previousViewBeforeSettings:
        state.activeView === 'settings' ? state.previousViewBeforeSettings : state.activeView
    }))
  },
  closeSettingsPage: () =>
    set((state) => {
      const previousView =
        state.previousViewBeforeSettings === 'activity' &&
        state.settings?.experimentalActivity !== true
          ? 'terminal'
          : state.previousViewBeforeSettings
      return { activeView: previousView }
    }),
  settingsNavigationTarget: null,
  openSettingsTarget: (target) => {
    if (!isSettingsNavigationTarget(target)) {
      if (import.meta.env.DEV) {
        throw new TypeError('openSettingsTarget received an invalid navigation target')
      }
      return
    }
    set({ settingsNavigationTarget: target })
  },
  clearSettingsTarget: () => set({ settingsNavigationTarget: null }),
  settingsProjectHostSelection: {},
  settingsProjectSetupSelection: {},
  // Why: renderer-only, never persisted — no window.api.ui.set, and absent from the debounced UI writer in App.tsx.
  }
}
