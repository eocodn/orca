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
import { mergeFeatureInteractionState, mergeContextualTourSeenIds, getContextualTourProgressionForFeatureInteraction, clampPetSize, presetToQuery, migrateStatusBarItems, DEFAULT_ON_PORTS_STATUS_BAR_ITEM, DEFAULT_ON_KIMI_STATUS_BAR_ITEM, DEFAULT_ON_MINIMAX_STATUS_BAR_ITEM, DEFAULT_ON_ANTIGRAVITY_STATUS_BAR_ITEM, DEFAULT_ON_GROK_STATUS_BAR_ITEM, normalizeHydratedVisibleWorkspaceHostIds, MIN_SIDEBAR_WIDTH, MAX_LEFT_SIDEBAR_WIDTH, MAX_RIGHT_SIDEBAR_WIDTH, LINEAR_TASK_PREFETCH_LIMIT, HYDRATE_MAX_AGE_MS, VALID_TASK_PRESETS, VALID_LINEAR_PRESETS, VALID_LINEAR_MODES, VALID_JIRA_PRESETS, resolvePaneKeyWorktreeIdFromTabs, collectAcknowledgedAgentNotificationId, isPlainPersistedRecord, sanitizePersistedRepoIds, sanitizeTrustedOrcaHooks, filterTrustedOrcaHooksToValidRepos, hydrateTrustedOrcaHooks, isSafePersistedRecordKey, sanitizeShowDotfilesByWorktree, sanitizePersistedSidebarWidth } from './ui-state'
import type { PendingSidebarWorktreeReveal, PendingSidebarRowReveal, AgentSendPopoverTargetMode, OpenAgentSendPopoverTargetModeArgs, UISlice } from './ui-state'
export function sanitizeAcknowledgedAgentsByPaneKey(value: unknown): Record<string, number> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const cutoff = Date.now() - HYDRATE_MAX_AGE_MS
  const out: Record<string, number> = {}
  for (const [key, ackAt] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== 'string' || !isSafePersistedRecordKey(key)) {
      continue
    }
    if (typeof ackAt !== 'number' || !Number.isFinite(ackAt) || ackAt <= 0) {
      continue
    }
    if (ackAt < cutoff) {
      continue
    }
    out[key] = ackAt
  }
  return out
}
export function sanitizeWorkspaceCleanupDismissals(
  value: unknown
): Record<string, WorkspaceCleanupDismissal> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const out: Record<string, WorkspaceCleanupDismissal> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      continue
    }
    const input = raw as Record<string, unknown>
    if (
      typeof input.worktreeId !== 'string' ||
      typeof input.dismissedAt !== 'number' ||
      !Number.isFinite(input.dismissedAt) ||
      typeof input.fingerprint !== 'string' ||
      input.classifierVersion !== WORKSPACE_CLEANUP_CLASSIFIER_VERSION
    ) {
      continue
    }
    out[key] = {
      worktreeId: input.worktreeId,
      dismissedAt: input.dismissedAt,
      fingerprint: input.fingerprint,
      classifierVersion: input.classifierVersion
    }
  }
  return out
}
export function hydratedUIPartialMatchesState(state: AppState, hydrated: Partial<UISlice>): boolean {
  return Object.entries(hydrated).every(([key, value]) =>
    persistedUIValuesEqual(state[key as keyof AppState], value)
  )
}
export function sanitizeHydratedActiveView(
  value: PersistedUIState['activeView'],
  experimentalActivityEnabled: boolean
): TopLevelView {
  // Why: older data (pre-activeView) or a view a different build doesn't have
  // falls back to terminal rather than rendering nothing.
  if (!isTopLevelView(value)) {
    return 'terminal'
  }
  // Why: activity is hidden when its setting is off, so gate only it (mobile/automations stay functional when hidden).
  if (value === 'activity' && !experimentalActivityEnabled) {
    return 'terminal'
  }
  return value
}

let agentSendTargetModeInstanceCounter = 0
export function createAgentSendTargetModeInstanceId(): string {
  agentSendTargetModeInstanceCounter += 1
  return `${Date.now()}:${agentSendTargetModeInstanceCounter}`
}
export function sanitizeTaskResumeState(value: unknown): TaskResumeState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const input = value as Record<string, unknown>
  const next: TaskResumeState = {}

  if (input.githubMode === 'items' || input.githubMode === 'project') {
    next.githubMode = input.githubMode
  }
  if (input.githubItemsPreset === null) {
    next.githubItemsPreset = null
  } else if (typeof input.githubItemsPreset === 'string') {
    if (VALID_TASK_PRESETS.has(input.githubItemsPreset as TaskViewPresetId)) {
      next.githubItemsPreset = input.githubItemsPreset as TaskViewPresetId
    }
  }
  if (typeof input.githubItemsQuery === 'string') {
    next.githubItemsQuery = input.githubItemsQuery
  }
  if (
    typeof input.linearPreset === 'string' &&
    VALID_LINEAR_PRESETS.has(input.linearPreset as NonNullable<TaskResumeState['linearPreset']>)
  ) {
    next.linearPreset = input.linearPreset as NonNullable<TaskResumeState['linearPreset']>
  }
  if (
    typeof input.linearMode === 'string' &&
    VALID_LINEAR_MODES.has(input.linearMode as NonNullable<TaskResumeState['linearMode']>)
  ) {
    next.linearMode = input.linearMode as NonNullable<TaskResumeState['linearMode']>
  }
  if (typeof input.linearQuery === 'string') {
    next.linearQuery = input.linearQuery
  }
  if (input.linearContext && typeof input.linearContext === 'object') {
    const context = input.linearContext as Record<string, unknown>
    if (
      (context.kind === 'project' || context.kind === 'view') &&
      typeof context.id === 'string' &&
      context.id.trim() &&
      typeof context.workspaceId === 'string' &&
      context.workspaceId.trim() &&
      context.workspaceId !== 'all'
    ) {
      next.linearContext = {
        kind: context.kind,
        id: context.id,
        workspaceId: context.workspaceId,
        model: context.model === 'issue' || context.model === 'project' ? context.model : undefined
      }
    }
  }
  if (
    typeof input.jiraPreset === 'string' &&
    VALID_JIRA_PRESETS.has(input.jiraPreset as NonNullable<TaskResumeState['jiraPreset']>)
  ) {
    next.jiraPreset = input.jiraPreset as NonNullable<TaskResumeState['jiraPreset']>
  }
  if (typeof input.jiraQuery === 'string') {
    next.jiraQuery = input.jiraQuery
  }

  return Object.keys(next).length > 0 ? next : undefined
}
