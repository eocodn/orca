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
export function createUISliceSetSettingsProjectHostSelectionActions3(set: SliceSet, get: SliceGet) {
  return {
  setSettingsProjectHostSelection: (projectId, hostId, setupId) =>
    set((s) => {
      const nextSetupSelections = { ...s.settingsProjectSetupSelection }
      if (setupId) {
        nextSetupSelections[projectId] = setupId
      } else {
        delete nextSetupSelections[projectId]
      }
      if (
        s.settingsProjectHostSelection[projectId] === hostId &&
        s.settingsProjectSetupSelection[projectId] === setupId
      ) {
        return s
      }
      return {
        settingsProjectHostSelection: {
          ...s.settingsProjectHostSelection,
          [projectId]: hostId
        },
        settingsProjectSetupSelection: nextSetupSelections
      }
    }),
  appearanceAccordionDeepLink: null,
  setAppearanceAccordionDeepLink: (section) => set({ appearanceAccordionDeepLink: section }),
  clearAppearanceAccordionDeepLink: () => set({ appearanceAccordionDeepLink: null }),
  activeModal: 'none',
  modalData: {},
  openModal: (modal, data = {}) => {
    if (modal === 'add-repo' || modal === 'create-worktree') {
      get().recordFeatureInteraction?.('workspace-creation')
    }
    set({
      activeModal: modal,
      modalData: data
    })
  },
  closeModal: () => set({ activeModal: 'none', modalData: {} }),
  featureTipsSeenIds: [],
  markFeatureTipsSeen: (ids) =>
    set((s) => {
      if (ids.length === 0) {
        return s
      }
      const current = new Set(s.featureTipsSeenIds)
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
      window.api.ui.set({ featureTipsSeenIds: next }).catch(console.error)
      return { featureTipsSeenIds: next }
    }),
  featureInteractions: {},
  recordFeatureInteraction: (id) => {
    let tourProgression: ReturnType<typeof getContextualTourProgressionForFeatureInteraction> = null
    let persistPromise = Promise.resolve()
    set((s) => {
      if (!s.persistedUIReady) {
        return s
      }
      tourProgression = getContextualTourProgressionForFeatureInteraction(s, id)
      const existing = s.featureInteractions[id]
      const next: FeatureInteractionState = {
        ...s.featureInteractions,
        [id]: {
          firstInteractedAt: existing?.firstInteractedAt ?? Date.now(),
          interactionCount: (existing?.interactionCount ?? 0) + 1
        }
      }
      if (typeof window !== 'undefined') {
        const recordInteraction = window.api.ui.recordFeatureInteraction
        const persist = recordInteraction
          ? recordInteraction(id).then((ui) => {
              set((current) => ({
                featureInteractions: mergeFeatureInteractionState(
                  current.featureInteractions,
                  ui.featureInteractions
                ),
                contextualToursSeenIds: mergeContextualTourSeenIds(
                  current.contextualToursSeenIds,
                  ui.contextualToursSeenIds
                )
              }))
            })
          : window.api.ui.set({ featureInteractions: next })
        persistPromise = persist.catch(console.error)
      }
      if (tourProgression === 'reveal-sidebar-and-advance') {
        // Why: split can fire from keyboard/menu with the sidebar closed, but the next tour target lives in the sidebar.
        return {
          featureInteractions: next,
          sidebarOpen: true,
          activeContextualTourStepIndex: s.activeContextualTourStepIndex + 1
        }
      }
      return { featureInteractions: next }
    })
    if (tourProgression === 'complete') {
      get().completeContextualTour()
    } else if (tourProgression === 'advance') {
      get().advanceContextualTour()
    }
    return persistPromise
  },
  contextualToursSeenIds: [],
  contextualToursAutoEligible: null,
  activeContextualTourId: null,
  activeContextualTourStepIndex: 0,
  activeContextualTourSource: null,
  activeContextualTourSourceDetached: false,
  activeContextualTourWasFeaturePreviouslyInteracted: false,
  contextualTourNavigationInteractionSnapshot: {},
  activeContextualTourSuppressed: false,
  contextualTourShownThisSession: false,
  contextualToursOnboardingVisible: false,
  contextualToursBlockingSurfaceVisible: false,
  lastCompletedContextualTourId: null,
  setContextualToursAutoEligible: (eligible) =>
    set((s) => {
      if (s.contextualToursAutoEligible === eligible) {
        return s
      }
      if (typeof window !== 'undefined') {
        window.api.ui.set({ contextualToursAutoEligible: eligible }).catch(console.error)
      }
      return { contextualToursAutoEligible: eligible }
    }),
  setContextualToursOnboardingVisible: (visible) =>
    set((s) =>
      s.contextualToursOnboardingVisible === visible
        ? s
        : { contextualToursOnboardingVisible: visible }
    ),
  setContextualToursBlockingSurfaceVisible: (visible) =>
    set((s) =>
      s.contextualToursBlockingSurfaceVisible === visible
        ? s
        : { contextualToursBlockingSurfaceVisible: visible }
    ),
  requestContextualTour: (id, source, wasFeaturePreviouslyInteracted, options) =>
    set((s) => {
      const tour = getContextualTour(id)
      const decision = getContextualTourRequestDecision({
        tour,
        persistedUIReady: s.persistedUIReady,
        autoEligible: options?.force === true || s.contextualToursAutoEligible === true,
        onboardingVisible: s.contextualToursOnboardingVisible,
        seenIds: options?.force === true ? [] : s.contextualToursSeenIds,
        sessionConsumed: options?.force === true ? false : s.contextualTourShownThisSession,
        activeTourId: s.activeContextualTourId,
        activeModal: s.activeModal,
        blockingSurfaceVisible: s.contextualToursBlockingSurfaceVisible,
        targetExists: hasContextualTourTarget
      })
      if (decision.kind !== 'start') {
        if (s.contextualTourNavigationInteractionSnapshot[id] === undefined) {
          return s
        }
        const { [id]: _consumed, ...remainingNavigationSnapshot } =
          s.contextualTourNavigationInteractionSnapshot
        void _consumed
        return { contextualTourNavigationInteractionSnapshot: remainingNavigationSnapshot }
      }
      const navigationSnapshot = s.contextualTourNavigationInteractionSnapshot[id]
      const { [id]: _consumed, ...remainingNavigationSnapshot } =
        s.contextualTourNavigationInteractionSnapshot
      void _consumed
      return {
        activeContextualTourId: id,
        activeContextualTourStepIndex: decision.stepIndex,
        activeContextualTourSource: source,
        activeContextualTourSourceDetached: false,
        activeContextualTourWasFeaturePreviouslyInteracted:
          wasFeaturePreviouslyInteracted ??
          navigationSnapshot ??
          hasFeatureInteraction(s.featureInteractions, id),
        contextualTourNavigationInteractionSnapshot: remainingNavigationSnapshot,
        activeContextualTourSuppressed: false,
        contextualTourShownThisSession: true,
        lastCompletedContextualTourId: null
      }
    }),
  suppressContextualTour: (id, source) =>
    set((s) => {
      if (
        s.activeContextualTourId !== id ||
        s.activeContextualTourSource !== source ||
        s.activeContextualTourSourceDetached
      ) {
        return s
      }
      return s.activeContextualTourSuppressed ? s : { activeContextualTourSuppressed: true }
    }),
  detachContextualTourSource: (id, source) =>
    set((s) => {
      if (s.activeContextualTourId !== id || s.activeContextualTourSource !== source) {
        return s
      }
      return s.activeContextualTourSourceDetached ? s : { activeContextualTourSourceDetached: true }
    }),
  advanceContextualTour: () =>
    set((s) => {
      if (!s.activeContextualTourId) {
        return s
      }
      const tour = getContextualTour(s.activeContextualTourId)
      const nextStepIndex = getNextVisibleContextualTourStepIndex({
        tour,
        currentStepIndex: s.activeContextualTourStepIndex,
        targetExists: hasContextualTourTarget
      })
      if (nextStepIndex !== null) {
        return { activeContextualTourStepIndex: nextStepIndex }
      }
      // Why: browser step 3's target lives in a closed menu until that step is active.
      if (
        s.activeContextualTourId === 'browser' &&
        s.activeContextualTourStepIndex + 1 < tour.steps.length
      ) {
        return { activeContextualTourStepIndex: s.activeContextualTourStepIndex + 1 }
      }
      return s
    }),
  regressContextualTour: () =>
    set((s) => {
      if (!s.activeContextualTourId) {
        return s
      }
      const previousStepIndex = getPreviousVisibleContextualTourStepIndex({
        tour: getContextualTour(s.activeContextualTourId),
        currentStepIndex: s.activeContextualTourStepIndex,
        targetExists: hasContextualTourTarget
      })
      if (previousStepIndex === null) {
        return s
      }
      return { activeContextualTourStepIndex: previousStepIndex }
    }),
  dismissContextualTour: (id) => {
    const activeTourId = get().activeContextualTourId
    if (id && activeTourId !== id) {
      return
    }
    const tourId = id ?? activeTourId
    if (tourId) {
      get().markContextualToursSeen([tourId])
    }
    set((s) => {
      if (id && s.activeContextualTourId !== id) {
        return s
      }
      return {
        activeContextualTourId: null,
        activeContextualTourStepIndex: 0,
        activeContextualTourSource: null,
        activeContextualTourSourceDetached: false,
        activeContextualTourWasFeaturePreviouslyInteracted: false,
        activeContextualTourSuppressed: false,
        lastCompletedContextualTourId: null
      }
    })
  },
  completeContextualTour: (id) => {
    const activeTourId = get().activeContextualTourId
    if (id && activeTourId !== id) {
      return
    }
    const tourId = id ?? activeTourId
    if (tourId) {
      get().markContextualToursSeen([tourId])
    }
    set((s) => {
      if (id && s.activeContextualTourId !== id) {
        return s
      }
      return {
        activeContextualTourId: null,
        activeContextualTourStepIndex: 0,
        activeContextualTourSource: null,
        activeContextualTourSourceDetached: false,
        activeContextualTourWasFeaturePreviouslyInteracted: false,
        activeContextualTourSuppressed: false,
        lastCompletedContextualTourId: tourId ?? null
      }
    })
  },
  }
}
