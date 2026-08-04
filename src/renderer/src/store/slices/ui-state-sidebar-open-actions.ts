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
export function createUISliceSidebarOpenActions(set: SliceSet, get: SliceGet) {
  return {
  sidebarOpen: true,
  sidebarWidth: 280,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  agentSendPopoverTargetMode: null,
  openAgentSendPopoverTargetMode: (args) => {
    const targets = deriveRunningAgentSendTargets(get(), args.worktreeId)
    const previousMode = get().agentSendPopoverTargetMode
    if (previousMode?.id === args.id && previousMode.status === 'sending') {
      return
    }
    const disabledPaneKeys: Record<string, string> = {}
    for (const target of targets) {
      if (target.status === 'disabled' && target.disabledReason) {
        disabledPaneKeys[target.paneKey] = target.disabledReason
      }
    }
    set({
      agentSendPopoverTargetMode: {
        ...args,
        instanceId: createAgentSendTargetModeInstanceId(),
        eligiblePaneKeys: targets
          .filter((target) => target.status === 'eligible')
          .map((target) => target.paneKey),
        disabledPaneKeys,
        status: 'open'
      }
    })
    if (
      targets.some((target) => target.status === 'eligible') &&
      (previousMode?.id !== args.id || previousMode.worktreeId !== args.worktreeId)
    ) {
      get().revealWorktreeInSidebar(args.worktreeId, { behavior: 'auto', highlight: true })
    }
  },
  diffNotesSendMenuOpenRequest: null,
  openDiffNotesSendMenuForActiveWorktree: () => {
    const worktreeId = get().activeWorktreeId
    if (!worktreeId) {
      return false
    }
    // Why: no unsent notes means nothing to send, so don't hijack focus or reveal the panel.
    if (
      !get()
        .getDiffComments(worktreeId)
        .some((comment) => !comment.sentAt)
    ) {
      return false
    }
    get().setRightSidebarTab('source-control')
    get().setRightSidebarOpen(true)
    const nonce = (get().diffNotesSendMenuOpenRequest?.nonce ?? 0) + 1
    set({ diffNotesSendMenuOpenRequest: { worktreeId, nonce, issuedAt: Date.now() } })
    return true
  },
  consumeDiffNotesSendMenuOpenRequest: (worktreeId) =>
    set((s) =>
      s.diffNotesSendMenuOpenRequest?.worktreeId === worktreeId
        ? { diffNotesSendMenuOpenRequest: null }
        : s
    ),
  closeAgentSendPopoverTargetMode: (id, instanceId) =>
    set((s) => {
      if (!s.agentSendPopoverTargetMode) {
        return s
      }
      if (id && s.agentSendPopoverTargetMode.id !== id) {
        return s
      }
      if (instanceId && s.agentSendPopoverTargetMode.instanceId !== instanceId) {
        return s
      }
      return { agentSendPopoverTargetMode: null }
    }),
  sendPromptToSidebarAgentTarget: async (paneKey) => {
    const mode = get().agentSendPopoverTargetMode
    if (!mode || mode.status === 'sending') {
      return false
    }

    const target = resolveRunningAgentSendTarget(get(), mode.worktreeId, paneKey)
    if (!target || target.status !== 'eligible' || !target.ptyId) {
      // Why: eligibility can drop after the menu opened; keep the picker open (row title explains) rather than adding toast noise.
      return false
    }

    set((s) =>
      s.agentSendPopoverTargetMode?.id === mode.id &&
      s.agentSendPopoverTargetMode.instanceId === mode.instanceId
        ? {
            agentSendPopoverTargetMode: {
              ...s.agentSendPopoverTargetMode,
              status: 'sending',
              sendingPaneKey: paneKey,
              error: undefined
            }
          }
        : s
    )

    const label = formatAgentTypeLabel(target.entry.agentType)
    const { activeAgentNotesSendFailureMessage, sendNotesToActiveAgentSession } =
      await import('@/lib/active-agent-note-send')
    const result = await sendNotesToActiveAgentSession({
      worktreeId: mode.worktreeId,
      prompt: mode.prompt,
      noteTarget: { tabId: target.tabId, leafId: target.leafId }
    }).catch((error) => {
      console.error('Failed to send notes to sidebar agent target:', error)
      return { status: 'no-active-terminal' as const }
    })

    const stillCurrent = (): boolean => {
      const current = get().agentSendPopoverTargetMode
      return current?.id === mode.id && current.instanceId === mode.instanceId
    }

    if (!stillCurrent()) {
      return false
    }

    if (result.status !== 'sent') {
      const message = activeAgentNotesSendFailureMessage(result.status, { explicitTarget: true })
      set((s) =>
        s.agentSendPopoverTargetMode?.id === mode.id &&
        s.agentSendPopoverTargetMode.instanceId === mode.instanceId
          ? {
              agentSendPopoverTargetMode: {
                ...s.agentSendPopoverTargetMode,
                status: 'error',
                sendingPaneKey: undefined,
                error: message
              }
            }
          : s
      )
      const { toast } = await import('sonner')
      if (!stillCurrent()) {
        return false
      }
      toast.error(
        translate('auto.store.slices.ui.53883b7bc3', "Couldn't send to {{value0}}", {
          value0: label
        }),
        { description: message }
      )
      return false
    }

    const [{ toast }, { track }] = await Promise.all([import('sonner'), import('@/lib/telemetry')])
    if (!stillCurrent()) {
      return false
    }
    mode.onPromptDelivered?.()
    track('agent_prompt_sent', {
      agent_kind: agentKindForAgentType(target.entry.agentType),
      launch_source: mode.launchSource,
      request_kind: 'followup'
    })
    toast.success(
      translate('auto.store.slices.ui.66e3bd7ce6', 'Sent to {{value0}}', { value0: label })
    )
    get().closeAgentSendPopoverTargetMode(mode.id, mode.instanceId)
    return true
  },
  acknowledgedAgentsByPaneKey: {},
  acknowledgeAgents: (paneKeys) => {
    const notificationIdsToDismiss = new Set<string>()
    set((s) => {
      if (paneKeys.length === 0) {
        return s
      }
      const now = Date.now()
      // Why: only reallocate if an ack advances; compare prev<now not !== — Date.now() ticks every ms and !== would rewrite the map every call.
      let next: Record<string, number> | null = null
      for (const key of paneKeys) {
        const prev = s.acknowledgedAgentsByPaneKey[key] ?? 0
        const liveEntry = s.agentStatusByPaneKey?.[key]
        if (liveEntry) {
          collectAcknowledgedAgentNotificationId({
            ids: notificationIdsToDismiss,
            worktreeId: resolvePaneKeyWorktreeIdFromTabs(s, key) ?? liveEntry.worktreeId,
            paneKey: key,
            stateStartedAt: liveEntry.stateStartedAt,
            previousAckAt: prev
          })
        }
        const retained = s.retainedAgentsByPaneKey?.[key]
        if (retained) {
          collectAcknowledgedAgentNotificationId({
            ids: notificationIdsToDismiss,
            worktreeId: retained.worktreeId,
            paneKey: key,
            stateStartedAt: retained.entry.stateStartedAt,
            previousAckAt: prev
          })
        }
        if (prev < now) {
          if (next === null) {
            next = { ...s.acknowledgedAgentsByPaneKey }
          }
          next[key] = now
        }
      }
      return next ? { acknowledgedAgentsByPaneKey: next } : s
    })
    const notificationIds = [...notificationIdsToDismiss]
    if (notificationIds.length > 0 && typeof window !== 'undefined') {
      void window.api?.notifications?.dismiss?.(notificationIds)
    }
  },
  unacknowledgeAgents: (paneKeys) =>
    set((s) => {
      if (paneKeys.length === 0) {
        return s
      }
      let next: Record<string, number> | null = null
      for (const key of paneKeys) {
        if (s.acknowledgedAgentsByPaneKey[key] !== undefined) {
          if (next === null) {
            next = { ...s.acknowledgedAgentsByPaneKey }
          }
          delete next[key]
        }
      }
      return next ? { acknowledgedAgentsByPaneKey: next } : s
    }),
  activeView: 'terminal',
  previousViewBeforeTasks: 'terminal',
  previousViewBeforeSettings: 'terminal',
  previousViewBeforeActivity: 'terminal',
  previousViewBeforeSpace: 'terminal',
  previousViewBeforeSkills: 'terminal',
  previousViewBeforeMobile: 'terminal',
  setActiveView: (view) => set({ activeView: view }),
  taskPageData: {},
  taskResumeState: undefined,
  githubTaskDrawerWorkItem: null,
  newWorkspaceDraft: null,
  }
}
