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
export function createUISliceSetWorktreeCardPropertiesActions5(set: SliceSet, get: SliceGet) {
  return {
  setWorktreeCardProperties: (properties) => {
    const normalized = normalizeWorktreeCardProperties(properties)
    set({ worktreeCardProperties: normalized, _worktreeCardModeDefaulted: false })
    window.api.ui
      .set({ worktreeCardProperties: normalized, _worktreeCardModeDefaulted: false })
      .catch(console.error)
  },
  agentActivityDisplayMode: DEFAULT_AGENT_ACTIVITY_DISPLAY_MODE,
  setAgentActivityDisplayMode: (mode) => {
    const normalized = normalizeAgentActivityDisplayMode(mode)
    window.api.ui.set({ agentActivityDisplayMode: normalized }).catch(console.error)
    set({ agentActivityDisplayMode: normalized })
  },
  workspaceStatuses: cloneDefaultWorkspaceStatuses(),
  setWorkspaceStatuses: (statuses) => {
    const normalized = normalizeWorkspaceStatuses(statuses)
    window.api.ui.set({ workspaceStatuses: normalized }).catch(console.error)
    set({ workspaceStatuses: normalized })
  },
  workspaceBoardOpacity: 1,
  setWorkspaceBoardOpacity: (opacity) => {
    const clamped = clampWorkspaceBoardOpacity(opacity)
    window.api.ui.set({ workspaceBoardOpacity: clamped }).catch(console.error)
    set({ workspaceBoardOpacity: clamped })
  },
  workspaceBoardColumnWidth: WORKSPACE_BOARD_COLUMN_WIDTH_DEFAULT,
  setWorkspaceBoardColumnWidth: (width) => {
    const clamped = clampWorkspaceBoardColumnWidth(width)
    window.api.ui.set({ workspaceBoardColumnWidth: clamped }).catch(console.error)
    set({ workspaceBoardColumnWidth: clamped })
  },
  syncTaskStatusFromWorkspaceBoard: false,
  setSyncTaskStatusFromWorkspaceBoard: (enabled) => {
    window.api.ui.set({ syncTaskStatusFromWorkspaceBoard: enabled }).catch(console.error)
    set({ syncTaskStatusFromWorkspaceBoard: enabled })
  },
  statusBarItems: [...DEFAULT_STATUS_BAR_ITEMS],
  toggleStatusBarItem: (item) =>
    set((s) => {
      const current = s.statusBarItems || DEFAULT_STATUS_BAR_ITEMS
      const updated = current.includes(item)
        ? current.filter((i) => i !== item)
        : [...current, item]
      window.api.ui.set({ statusBarItems: updated }).catch(console.error)
      return { statusBarItems: updated }
    }),
  agentDashboardDrawerOpen: false,
  setAgentDashboardDrawerOpen: (open) => set({ agentDashboardDrawerOpen: open }),
  statusBarVisible: true,
  setStatusBarVisible: (v) => {
    window.api.ui.set({ statusBarVisible: v }).catch(console.error)
    set({ statusBarVisible: v })
  },
  usagePercentageDisplay: DEFAULT_USAGE_PERCENTAGE_DISPLAY,
  setUsagePercentageDisplay: (display) => {
    const normalized = normalizeUsagePercentageDisplay(display)
    // Why: changing the control is the discovery path, so permanently dismiss the one-time change notice.
    window.api.ui
      .set({
        usagePercentageDisplay: normalized,
        usagePercentageDisplayChangeNoticeDismissed: true
      })
      .catch(console.error)
    set({
      usagePercentageDisplay: normalized,
      usagePercentageDisplayChangeNoticeDismissed: true
    })
  },
  statusBarUsageMode: DEFAULT_STATUS_BAR_USAGE_MODE,
  setStatusBarUsageMode: (mode) => {
    const normalized = normalizeStatusBarUsageMode(mode)
    window.api.ui.set({ statusBarUsageMode: normalized }).catch(console.error)
    set({ statusBarUsageMode: normalized })
  },
  workspacePortScan: null,
  workspacePortScansByKey: {},
  workspacePortScanRefreshing: false,
  setWorkspacePortScan: (scan) =>
    set((state) => {
      if (!scan) {
        if (!state.workspacePortScan && Object.keys(state.workspacePortScansByKey).length === 0) {
          return state
        }
        return { workspacePortScan: null, workspacePortScansByKey: {} }
      }
      if (
        state.workspacePortScan?.key === scan.key &&
        state.workspacePortScan.result === scan.result &&
        state.workspacePortScansByKey[scan.key] === scan.result
      ) {
        return state
      }
      return {
        workspacePortScan: scan,
        workspacePortScansByKey: { ...state.workspacePortScansByKey, [scan.key]: scan.result }
      }
    }),
  // Why: target changes rebuild the aggregate without republishing or clearing per-host scans.
  setWorkspacePortScanProjection: (scan) =>
    set((state) => {
      if (
        state.workspacePortScan?.key === scan?.key &&
        state.workspacePortScan?.result === scan?.result
      ) {
        return state
      }
      return { workspacePortScan: scan }
    }),
  // Why: drop stale per-host scans in one store update so a large host set can't fan out notifications to every subscriber.
  replaceWorkspacePortScans: (scansByKey, projection) =>
    set((state) => {
      if (
        state.workspacePortScansByKey === scansByKey &&
        state.workspacePortScan?.key === projection?.key &&
        state.workspacePortScan?.result === projection?.result
      ) {
        return state
      }
      return { workspacePortScansByKey: scansByKey, workspacePortScan: projection }
    }),
  setWorkspacePortScanForKey: (key, result) =>
    set((state) => {
      const currentResult = state.workspacePortScansByKey[key]
      if (currentResult === result || (!result && !currentResult)) {
        return state
      }
      const nextScansByKey = { ...state.workspacePortScansByKey }
      if (result) {
        nextScansByKey[key] = result
      } else {
        delete nextScansByKey[key]
      }
      return {
        workspacePortScansByKey: nextScansByKey,
        workspacePortScan:
          state.workspacePortScan?.key === key
            ? result
              ? { key, result }
              : null
            : state.workspacePortScan
      }
    }),
  setWorkspacePortScanRefreshing: (refreshing) => set({ workspacePortScanRefreshing: refreshing }),

  // Why: default true so enabling experimentalPet shows the pet immediately (persisted; "Hide pet" flips it false).
  petVisible: true,
  setPetVisible: (v) => {
    window.api.ui.set({ petVisible: v }).catch(console.error)
    set({ petVisible: v })
  },
  petId: DEFAULT_PET_ID,
  setPetId: (id) => {
    window.api.ui.set({ petId: id }).catch(console.error)
    set({ petId: id })
  },
  petSize: PET_SIZE_DEFAULT,
  setPetSize: (size) => {
    const clamped = clampPetSize(size)
    window.api.ui.set({ petSize: clamped }).catch(console.error)
    set({ petSize: clamped })
  },
  customPets: [],
  addCustomPet: (model) =>
    set((s) => {
      const next = [...s.customPets.filter((m) => m.id !== model.id), model]
      window.api.ui.set({ customPets: next }).catch(console.error)
      return { customPets: next }
    }),
  removeCustomPet: (id) =>
    set((s) => {
      const target = s.customPets.find((m) => m.id === id)
      if (!target) {
        return s
      }
      const next = s.customPets.filter((m) => m.id !== id)
      // Why: removing the active custom pet falls back to bundled default so the overlay isn't empty.
      const fallback = s.petId === id ? DEFAULT_PET_ID : s.petId
      // Why: single combined IPC update so customPets and petId persist atomically.
      const ipcPayload: { customPets: CustomPet[]; petId?: string } = {
        customPets: next
      }
      if (fallback !== s.petId) {
        ipcPayload.petId = fallback
      }
      window.api.ui.set(ipcPayload).catch(console.error)
      // Why: revoke the cached blob: URL so the Blob is released, not leaked for the session.
      revokeCustomPetBlobUrl(id)
      // Why: best-effort delete — bytes owned by main; fresh-UUID imports mean an orphaned file is never re-referenced.
      window.api.pet.delete(id, target.fileName, target.kind).catch(console.error)
      const partial: Partial<UISlice> = { customPets: next }
      if (fallback !== s.petId) {
        partial.petId = fallback
      }
      return partial
    }),
  pendingRevealWorktree: null,
  pendingRevealSidebarRow: null,
  revealWorktreeInSidebar: (worktreeId, options) =>
    set({
      pendingRevealWorktree: {
        worktreeId,
        behavior: options?.behavior ?? 'smooth',
        ...(options?.highlight ? { highlight: true } : {}),
        ...(options?.beginRename ? { beginRename: true } : {})
      }
    }),
  revealSidebarRow: (rowKey, options) =>
    set({
      pendingRevealSidebarRow: {
        rowKey,
        behavior: options?.behavior ?? 'smooth',
        ...(options?.highlight === false ? {} : { highlight: true })
      }
    }),
  clearPendingRevealWorktreeId: () => set({ pendingRevealWorktree: null }),
  clearPendingRevealSidebarRow: () => set({ pendingRevealSidebarRow: null }),
  scrollToDiffCommentId: null,
  setScrollToDiffCommentId: (id) => set({ scrollToDiffCommentId: id }),
  persistedUIReady: false,
  uiZoomLevel: 0,
  setUIZoomLevel: (level) => set({ uiZoomLevel: level }),
  editorFontZoomLevel: 0,
  setEditorFontZoomLevel: (level) => set({ editorFontZoomLevel: level }),
  }
}
