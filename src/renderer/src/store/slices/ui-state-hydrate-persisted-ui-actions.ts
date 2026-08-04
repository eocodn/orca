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
export function createUISliceHydratePersistedUiActions6(set: SliceSet, get: SliceGet) {
  return {
  hydratePersistedUI: (ui, source = 'sync') =>
    set((s) => {
      const manualRepoOrder = normalizeManualRepoOrder(ui.manualRepoOrder)
      const orderedRepos = applyManualRepoOrder(s.repos, manualRepoOrder)
      const validRepoIds = new Set(s.repos.map((repo) => repo.id))
      const validRepoHostIdentities = new Set(s.repos.map(getRepoHostIdentity))
      const persistedFilterRepoIds = sanitizePersistedRepoIds(ui.filterRepoIds)
      // Why: pre-rename builds used sidekick* keys; read as fallback only so new pet* writes win after upgrade.
      const customPets = Array.isArray(ui.customPets)
        ? ui.customPets
        : Array.isArray(ui.customSidekicks)
          ? ui.customSidekicks
          : []
      const petId = ui.petId ?? ui.sidekickId
      // Migration: one-shot old-'recent'→'smart' runs in main (_sortBySmartMigrated), not here, so a deliberate 'recent' choice survives restart.
      const sortBy = ui.sortBy
      const migratedStatusBarItems = migrateStatusBarItems(ui.statusBarItems)
      const statusBarItemsWithPorts =
        ui._portsStatusBarDefaultAdded || migratedStatusBarItems.includes('ports')
          ? migratedStatusBarItems
          : [...migratedStatusBarItems, DEFAULT_ON_PORTS_STATUS_BAR_ITEM]
      const statusBarItems =
        ui._kimiStatusBarDefaultAdded || statusBarItemsWithPorts.includes('kimi')
          ? statusBarItemsWithPorts
          : [...statusBarItemsWithPorts, DEFAULT_ON_KIMI_STATUS_BAR_ITEM]
      const statusBarItemsWithMiniMax =
        ui._minimaxStatusBarDefaultAdded || statusBarItems.includes('minimax')
          ? statusBarItems
          : [...statusBarItems, DEFAULT_ON_MINIMAX_STATUS_BAR_ITEM]
      const statusBarItemsWithAntigravity =
        ui._antigravityStatusBarDefaultAdded || statusBarItemsWithMiniMax.includes('antigravity')
          ? statusBarItemsWithMiniMax
          : [...statusBarItemsWithMiniMax, DEFAULT_ON_ANTIGRAVITY_STATUS_BAR_ITEM]
      const statusBarItemsWithGrok =
        ui._grokStatusBarDefaultAdded || statusBarItemsWithAntigravity.includes('grok')
          ? statusBarItemsWithAntigravity
          : [...statusBarItemsWithAntigravity, DEFAULT_ON_GROK_STATUS_BAR_ITEM]
      if (
        (!ui._portsStatusBarDefaultAdded ||
          !ui._kimiStatusBarDefaultAdded ||
          !ui._minimaxStatusBarDefaultAdded ||
          !ui._antigravityStatusBarDefaultAdded ||
          !ui._grokStatusBarDefaultAdded) &&
        typeof window !== 'undefined'
      ) {
        window.api.ui
          .set({
            statusBarItems: statusBarItemsWithGrok,
            _portsStatusBarDefaultAdded: true,
            _kimiStatusBarDefaultAdded: true,
            _minimaxStatusBarDefaultAdded: true,
            _antigravityStatusBarDefaultAdded: true,
            _grokStatusBarDefaultAdded: true
          })
          .catch(console.error)
      }
      const rightSidebarRoute = normalizeRightSidebarRoute(
        ui.rightSidebarTab,
        ui.rightSidebarExplorerView
      )
      const hydrated = {
        // Why: persisted widths may be stale/corrupt/hand-edited; clamp during hydration so invalid values can't break layout.
        sidebarWidth: sanitizePersistedSidebarWidth(
          ui.sidebarWidth,
          s.sidebarWidth,
          MAX_LEFT_SIDEBAR_WIDTH
        ),
        rightSidebarWidth: sanitizePersistedSidebarWidth(
          ui.rightSidebarWidth,
          s.rightSidebarWidth,
          MAX_RIGHT_SIDEBAR_WIDTH
        ),
        markdownTocPanelWidth: clampMarkdownTocPanelWidth(
          ui.markdownTocPanelWidth,
          undefined,
          s.markdownTocPanelWidth
        ),
        combinedDiffFileTreeWidth: clampCombinedDiffFileTreeWidth(
          ui.combinedDiffFileTreeWidth,
          undefined,
          s.combinedDiffFileTreeWidth
        ),
        rightSidebarOpen: typeof ui.rightSidebarOpen === 'boolean' ? ui.rightSidebarOpen : true,
        rightSidebarTab: rightSidebarRoute.rightSidebarTab,
        rightSidebarExplorerView: rightSidebarRoute.rightSidebarExplorerView,
        groupBy: (ui.groupBy as UISlice['groupBy'] | 'parent') === 'parent' ? 'repo' : ui.groupBy,
        sortBy,
        // Why: main-process getUI() already normalized this (defaulting to 'manual'); read it through without migrating.
        projectOrderBy: ui.projectOrderBy,
        // Why: Active-only was retired; force the old flag off so an old profile can't invisibly narrow the workspace list.
        showActiveOnly: false,
        // Why: ignore older positive-form keys so old profiles start from the new default (sleeping workspaces visible).
        showSleepingWorkspaces: !(ui.hideSleepingWorkspaces ?? DEFAULT_HIDE_SLEEPING_WORKSPACES),
        workspaceHostScope: normalizeExecutionHostScope(ui.workspaceHostScope),
        visibleWorkspaceHostIds: normalizeHydratedVisibleWorkspaceHostIds(ui),
        workspaceHostOrder: normalizeExecutionHostOrder(ui.workspaceHostOrder),
        manualRepoOrder,
        // Why: apply the desktop-owned overlay immediately since UI state can arrive after a catalog or from another client.
        repos: orderedRepos,
        hideDefaultBranchWorkspace: ui.hideDefaultBranchWorkspace ?? false,
        hideAutomationGeneratedWorkspaces: ui.hideAutomationGeneratedWorkspaces === true,
        hideCliCreatedWorkspaces: ui.hideCliCreatedWorkspaces === true,
        hideDetachedHeadWorkspaces: ui.hideDetachedHeadWorkspaces === true,
        showDotfilesByWorktree: sanitizeShowDotfilesByWorktree(ui.showDotfilesByWorktree),
        // Why: startup hydrates UI before repo catalogs, so defer repo-filter validation to the all-host refresh.
        filterRepoIds:
          validRepoIds.size === 0
            ? persistedFilterRepoIds
            : persistedFilterRepoIds.filter((repoId) => validRepoIds.has(repoId)),
        collapsedGroups: new Set(ui.collapsedGroups ?? []),
        uiZoomLevel: ui.uiZoomLevel ?? 0,
        editorFontZoomLevel: ui.editorFontZoomLevel ?? 0,
        worktreeCardProperties: normalizeWorktreeCardProperties(ui.worktreeCardProperties),
        _worktreeCardModeDefaulted: ui._worktreeCardModeDefaulted === true,
        agentActivityDisplayMode: normalizeAgentActivityDisplayMode(ui.agentActivityDisplayMode),
        workspaceStatuses: normalizeWorkspaceStatuses(ui.workspaceStatuses),
        workspaceBoardOpacity: clampWorkspaceBoardOpacity(ui.workspaceBoardOpacity),
        workspaceBoardColumnWidth: clampWorkspaceBoardColumnWidth(ui.workspaceBoardColumnWidth),
        syncTaskStatusFromWorkspaceBoard: ui.syncTaskStatusFromWorkspaceBoard === true,
        statusBarItems: statusBarItemsWithGrok,
        statusBarVisible: ui.statusBarVisible ?? true,
        usagePercentageDisplay: normalizeUsagePercentageDisplay(ui.usagePercentageDisplay),
        statusBarUsageMode: normalizeStatusBarUsageMode(ui.statusBarUsageMode),
        // Why: default true so existing users see the pet on first enabling the flag; only an explicit Hide persists false.
        petVisible: ui.petVisible ?? ui.sidekickVisible ?? true,
        petSize: clampPetSize(ui.petSize ?? ui.sidekickSize ?? PET_SIZE_DEFAULT),
        customPets,
        // Why: fall back to default when the persisted id is unknown (e.g. custom pet removed elsewhere) so the overlay renders.
        petId: ((): string => {
          const id = petId
          if (typeof id !== 'string') {
            return DEFAULT_PET_ID
          }
          if (isBundledPetId(id)) {
            return id
          }
          if (customPets.some((m) => m.id === id)) {
            return id
          }
          return DEFAULT_PET_ID
        })(),
        dismissedUpdateVersion: ui.dismissedUpdateVersion ?? null,
        // Why: a persisted value from a build that knew a different channel set
        // would otherwise survive as-is; activeChannel only falls back on null,
        // so an unknown string reaches listBuilds and the segmented control.
        releaseChannelOverride: isReleaseChannel(ui.releaseChannelOverride)
          ? ui.releaseChannelOverride
          : null,
        updateReassuranceSeen: ui.updateReassuranceSeen ?? false,
        osc52ClipboardDefaultOnNoticePending: ui.osc52ClipboardDefaultOnNoticePending === true,
        browserDefaultUrl: ui.browserDefaultUrl ?? null,
        browserDefaultSearchEngine: ui.browserDefaultSearchEngine ?? null,
        browserDefaultZoomLevel: normalizeBrowserPageZoomLevel(ui.browserDefaultZoomLevel),
        browserKagiSessionLink: normalizeKagiSessionLink(ui.browserKagiSessionLink ?? ''),
        taskResumeState: sanitizeTaskResumeState(ui.taskResumeState),
        featureTipsSeenIds: normalizeFeatureTipIds(ui.featureTipsSeenIds),
        featureInteractions: normalizeFeatureInteractions(ui.featureInteractions),
        contextualToursSeenIds: normalizeContextualTourIds(ui.contextualToursSeenIds),
        contextualToursAutoEligible:
          typeof ui.contextualToursAutoEligible === 'boolean'
            ? ui.contextualToursAutoEligible
            : null,
        trustedOrcaHooks: hydrateTrustedOrcaHooks(ui.trustedOrcaHooks, validRepoIds),
        setupScriptPromptDismissedRepoIds:
          validRepoHostIdentities.size === 0
            ? sanitizeSetupScriptPromptDismissals(ui.setupScriptPromptDismissedRepoIds)
            : filterSetupScriptPromptDismissalsToValidRepos(
                ui.setupScriptPromptDismissedRepoIds,
                validRepoHostIdentities
              ),
        setupGuideSidebarDismissed: ui.setupGuideSidebarDismissed === true,
        setupGuideBrowserMilestoneMigrated: ui.setupGuideBrowserMilestoneMigrated === true,
        setupGuideBrowserMilestoneLegacyComplete:
          ui.setupGuideBrowserMilestoneLegacyComplete === true,
        browserImportHintHidden: ui.browserImportHintHidden === true,
        projectOrderManualDefaultNoticeDismissed:
          ui.projectOrderManualDefaultNoticeDismissed === true,
        // Why: treat only explicit true as dismissed so a false from migration still surfaces.
        usagePercentageDisplayChangeNoticeDismissed:
          ui.usagePercentageDisplayChangeNoticeDismissed === true,
        // Why: default false so existing users still see the CTA; only explicit dismissal persists true.
        usageEmptyStateDismissed: ui.usageEmptyStateDismissed === true,
        // Why: stale acks are inert (paneKey reuse beats them via stateStartedAt); sanitizer bounds growth past HYDRATE_MAX_AGE_MS.
        acknowledgedAgentsByPaneKey: sanitizeAcknowledgedAgentsByPaneKey(
          ui.acknowledgedAgentsByPaneKey
        ),
        workspaceCleanupDismissals: sanitizeWorkspaceCleanupDismissals(
          ui.workspaceCleanup?.dismissals
        ),
        // Why: restore only on startup; on 'sync' broadcasts it would clobber the window's current per-window view.
        activeView:
          source === 'startup'
            ? sanitizeHydratedActiveView(ui.activeView, s.settings?.experimentalActivity === true)
            : s.activeView,
        persistedUIReady: true
      }
      // Why: return the same ref on identical hydration so App's debounced writer doesn't echo it back to main.
      return hydratedUIPartialMatchesState(s, hydrated) ? s : hydrated
    }),
  updateStatus: { state: 'idle' },
  setUpdateStatus: (status) => {
    const prevState = get().updateStatus.state
    const update: Partial<
      Pick<
        UISlice,
        'updateStatus' | 'updateChangelog' | 'updateCardCollapsed' | 'updateUserInitiatedCycle'
      >
    > = {
      updateStatus: status
    }
    if (status.state === 'checking') {
      update.updateUserInitiatedCycle = status.userInitiated === true
    } else if (status.state === 'idle') {
      update.updateUserInitiatedCycle = false
    }
    if (status.state === 'available') {
      // Why: always overwrite (even with null) so a prior version's changelog can't leak into a later simple-mode update.
      update.updateChangelog = status.changelog ?? null
    } else if (
      status.state === 'idle' ||
      status.state === 'checking' ||
      status.state === 'not-available'
    ) {
      // Why: reset on cycle-boundary states so stale rich content from a previous cycle can't resurface.
      update.updateChangelog = null
    }
    // 'downloading'/'downloaded'/'error': leave updateChangelog untouched to keep the original 'available' content.
    if (status.state !== prevState) {
      // Why: re-surface the card on each phase transition so a collapsed `downloading` doesn't bury `downloaded`/`error`.
      update.updateCardCollapsed = false
    }
    set(update)
  },
  updateChangelog: null,
  updateUserInitiatedCycle: false,
  dismissedUpdateVersion: null,
  clearDismissedUpdateVersion: () => {
    set({ dismissedUpdateVersion: null })
  },
  releaseChannelOverride: null,
  setReleaseChannelOverride: (channel) => {
    void window.api.ui.set({ releaseChannelOverride: channel }).catch(console.error)
    set({ releaseChannelOverride: channel })
  },
  dismissUpdate: (versionOverride?: string) =>
    set((s) => {
      // Why: the 'error' variant has no version field, so the card passes it via versionOverride.
      const dismissedUpdateVersion =
        versionOverride ?? ('version' in s.updateStatus ? (s.updateStatus.version ?? null) : null)
      const activeNudgeId =
        'activeNudgeId' in s.updateStatus ? (s.updateStatus.activeNudgeId ?? null) : null
      // Why: persist dismissal so relaunch doesn't immediately re-show the same card until a newer release.
      void window.api.ui.set({ dismissedUpdateVersion }).catch(console.error)
      // Why: main can't otherwise tell an offered update was abandoned, which keeps a local-build session pinned and stalls background checks.
      void window.api.updater.dismissAvailableUpdate().catch(console.error)
      // Why: only consume the nudge campaign for cards from a nudge cycle, not ordinary dismissals.
      if (activeNudgeId) {
        void window.api.updater.dismissNudge().catch(console.error)
      }
      return { dismissedUpdateVersion, updateUserInitiatedCycle: false }
    }),
  updateCardCollapsed: false,
  setUpdateCardCollapsed: (collapsed) => set({ updateCardCollapsed: collapsed }),
  updateReassuranceSeen: false,
  markUpdateReassuranceSeen: () => {
    void window.api.ui.set({ updateReassuranceSeen: true }).catch(console.error)
    set({ updateReassuranceSeen: true })
  },
  osc52ClipboardDefaultOnNoticePending: false,
  clearOsc52ClipboardDefaultOnNotice: () => {
    // Why clear locally first: a failed persist must not re-toast this session. It will
    // re-arm on the next launch, which is the safe direction for a one-shot notice.
    set({ osc52ClipboardDefaultOnNoticePending: false })
    void window.api.ui.set({ osc52ClipboardDefaultOnNoticePending: false }).catch(console.error)
  },
  isFullScreen: false,
  setIsFullScreen: (v) => set({ isFullScreen: v }),
  browserDefaultUrl: null,
  setBrowserDefaultUrl: (url) => {
    void window.api.ui.set({ browserDefaultUrl: url }).catch(console.error)
    set({ browserDefaultUrl: url })
  },
  browserDefaultSearchEngine: null,
  setBrowserDefaultSearchEngine: (engine) => {
    void window.api.ui.set({ browserDefaultSearchEngine: engine }).catch(console.error)
    set({ browserDefaultSearchEngine: engine })
  },
  browserDefaultZoomLevel: DEFAULT_BROWSER_PAGE_ZOOM_LEVEL,
  setBrowserDefaultZoomLevel: (level) => {
    const normalized = normalizeBrowserPageZoomLevel(level)
    void window.api.ui.set({ browserDefaultZoomLevel: normalized }).catch(console.error)
    set({ browserDefaultZoomLevel: normalized })
  },
  browserKagiSessionLink: null,
  }
}
