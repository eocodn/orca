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
import type { PendingSidebarWorktreeReveal, PendingSidebarRowReveal, AgentSendPopoverTargetMode, OpenAgentSendPopoverTargetModeArgs } from './ui-state'
export type UISlice = {
  sidebarOpen: boolean;
  sidebarWidth: number;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  agentSendPopoverTargetMode: AgentSendPopoverTargetMode | null;
  openAgentSendPopoverTargetMode: (args: OpenAgentSendPopoverTargetModeArgs) => void;
  closeAgentSendPopoverTargetMode: (id?: string, instanceId?: string) => void;
  sendPromptToSidebarAgentTarget: (paneKey: string) => Promise<boolean>;
  /** Bumped to ask the active worktree's Source Control notes send menu to open (keyboard shortcut). `issuedAt` bounds staleness so a request the menu never consumed can't reopen it much later. */
  diffNotesSendMenuOpenRequest: { worktreeId: string; nonce: number; issuedAt: number } | null;
  /** Reveal Source Control and request its notes send menu open; returns false (no-op) when the active worktree has no unsent notes. */
  openDiffNotesSendMenuForActiveWorktree: () => boolean;
  consumeDiffNotesSendMenuOpenRequest: (worktreeId: string) => void;
  /** Per-agent "I've looked at this" timestamps (paneKey → ts). A row is unvisited when no ack exists or stateStartedAt is newer than the last ack. Persisted so visited rows don't return bold on relaunch. */
  acknowledgedAgentsByPaneKey: Record<string, number>;
  acknowledgeAgents: (paneKeys: string[]) => void;
  unacknowledgeAgents: (paneKeys: string[]) => void;
  activeView: TopLevelView;
  previousViewBeforeTasks:
    | 'terminal'
    | 'settings'
    | 'activity'
    | 'automations'
    | 'space'
    | 'skills'
    | 'mobile';
  previousViewBeforeSettings:
    | 'terminal'
    | 'tasks'
    | 'activity'
    | 'automations'
    | 'space'
    | 'skills'
    | 'mobile';
  previousViewBeforeActivity:
    | 'terminal'
    | 'settings'
    | 'tasks'
    | 'automations'
    | 'space'
    | 'skills'
    | 'mobile';
  previousViewBeforeAutomations:
    | 'terminal'
    | 'settings'
    | 'tasks'
    | 'activity'
    | 'space'
    | 'skills'
    | 'mobile';
  previousViewBeforeSpace:
    | 'terminal'
    | 'settings'
    | 'tasks'
    | 'activity'
    | 'automations'
    | 'skills'
    | 'mobile';
  previousViewBeforeSkills:
    | 'terminal'
    | 'settings'
    | 'tasks'
    | 'activity'
    | 'automations'
    | 'space'
    | 'mobile';
  previousViewBeforeMobile:
    | 'terminal'
    | 'settings'
    | 'tasks'
    | 'activity'
    | 'automations'
    | 'space'
    | 'skills';
  setActiveView: (view: UISlice['activeView']) => void;
  taskPageData: {
    preselectedRepoId?: string
    prefilledName?: string
    taskSource?: TaskProvider
    openGitHubWorkItem?: GitHubWorkItem
    openGitHubSourceContext?: TaskSourceContext | null
    openGitHubInitialTab?: 'conversation' | 'checks' | 'files'
    openGitLabWorkItem?: GitLabWorkItem
    openGitLabSourceContext?: TaskSourceContext | null
    openLinearIssue?: LinearIssue
    openLinearSourceContext?: TaskSourceContext | null
    openJiraIssue?: JiraIssue
    openJiraSourceContext?: TaskSourceContext | null
  };
  taskResumeState: TaskResumeState | undefined;
  setTaskResumeState: (updates: Partial<TaskResumeState>) => void;
  githubTaskDrawerWorkItem: GitHubWorkItem | null;
  setGithubTaskDrawerWorkItem: (item: GitHubWorkItem | null) => void;
  newWorkspaceDraft: {
    repoId: string | null
    // Why: project-first creation uses these when present; old drafts keep using only repoId during the additive migration.
    projectId?: string | null
    projectGroupId?: string | null
    hostId?: ExecutionHostId | null
    projectHostSetupId?: string | null
    name: string
    prompt: string
    note: string
    attachments: string[]
    linkedWorkItem: {
      provider?: 'github' | 'gitlab' | 'linear' | 'jira'
      type: 'issue' | 'pr' | 'mr'
      number: number
      title: string
      url: string
      linearIdentifier?: string
      linearBranchName?: string
      jiraIdentifier?: string
      repoId?: string
    } | null
    /** Preserve where provider data came from, separately from the host chosen to run the workspace. */
    taskSourceContext?: TaskSourceContext | null
    linkedTaskSourceContext?: TaskSourceContext | null
    agent: TuiAgent
    linkedIssue: string
    linkedPR: number | null
    /** GitLab parallels — number for an issue, iid for an MR. Optional so pre-GitLab drafts still load without migration. */
    linkedGitLabIssue?: number | null
    linkedGitLabMR?: number | null
    // Why: repo-scoped start ref from the "Start from" picker; absent means "use the repo's effective base ref".
    baseBranch?: string
    // Why: review worktrees start from a head ref/SHA while Source Control compares against the provider target branch.
    compareBaseRef?: string
  } | null;
  openTaskPage: (
    data?: UISlice['taskPageData'],
    options?: { recordTasksInteraction?: boolean }
  ) => void;
  closeTaskPage: () => void;
  openActivityPage: () => void;
  closeActivityPage: () => void;
  selectedAutomationId: string | null;
  setSelectedAutomationId: (id: string | null) => void;
  pendingAutomationRunNavigation: {
    automationId: string
    runId: string | null
    hostId?: ExecutionHostId
  } | null;
  setPendingAutomationRunNavigation: (
    navigation: { automationId: string; runId: string | null; hostId?: ExecutionHostId } | null
  ) => void;
  openAutomationsPage: () => void;
  closeAutomationsPage: () => void;
  openSpacePage: () => void;
  closeSpacePage: () => void;
  openSkillsPage: () => void;
  closeSkillsPage: () => void;
  openMobilePage: () => void;
  closeMobilePage: () => void;
  setNewWorkspaceDraft: (draft: NonNullable<UISlice['newWorkspaceDraft']>) => void;
  clearNewWorkspaceDraft: () => void;
  openSettingsPage: () => void;
  closeSettingsPage: () => void;
  settingsNavigationTarget: SettingsNavigationTarget | null;
  openSettingsTarget: (target: NonNullable<UISlice['settingsNavigationTarget']>) => void;
  clearSettingsTarget: () => void;
  /** Which host the Projects Settings pane shows per project (keyed by projectId). Ephemeral on purpose — never persisted, so reload reopens on the effective host. */
  settingsProjectHostSelection: Record<string, ExecutionHostId>;
  settingsProjectSetupSelection: Record<string, string>;
  setSettingsProjectHostSelection: (
    projectId: string,
    hostId: ExecutionHostId,
    setupId?: string
  ) => void;
  /** One-shot Appearance accordion to expand for nested Settings deep links (e.g. Usage percentages under Window & Sidebar). Cleared when Appearance consumes it. */
  appearanceAccordionDeepLink: 'interface' | 'terminal' | 'window' | null;
  setAppearanceAccordionDeepLink: (
    section: NonNullable<UISlice['appearanceAccordionDeepLink']>
  ) => void;
  clearAppearanceAccordionDeepLink: () => void;
  activeModal:
    | 'none'
    | 'create-worktree'
    | 'edit-meta'
    | 'delete-worktree'
    | 'forget-ssh-workspace'
    | 'confirm-add-project-from-folder'
    | 'confirm-non-git-folder'
    | 'confirm-remove-folder'
    | 'add-repo'
    | 'quick-open'
    | 'worktree-palette'
    | 'workspace-cleanup'
    | 'project-added'
    | 'worktree-visibility'
    | 'setup-guide'
    | 'feature-wall'
    | 'feature-tips'
    | 'new-workspace-composer'
    | 'confirm-orca-yaml-hooks';
  modalData: Record<string, unknown>;
  openModal: (modal: UISlice['activeModal'], data?: Record<string, unknown>) => void;
  closeModal: () => void;
  featureTipsSeenIds: FeatureTipId[];
  markFeatureTipsSeen: (ids: FeatureTipId[]) => void;
  featureInteractions: FeatureInteractionState;
  recordFeatureInteraction: (id: FeatureInteractionId) => Promise<void>;
  contextualToursSeenIds: ContextualTourId[];
  contextualToursAutoEligible: boolean | null;
  activeContextualTourId: ContextualTourId | null;
  activeContextualTourStepIndex: number;
  activeContextualTourSource: string | null;
  activeContextualTourSourceDetached: boolean;
  activeContextualTourWasFeaturePreviouslyInteracted: boolean;
  contextualTourNavigationInteractionSnapshot: Partial<Record<ContextualTourId, boolean>>;
  activeContextualTourSuppressed: boolean;
  contextualTourShownThisSession: boolean;
  contextualToursOnboardingVisible: boolean;
  contextualToursBlockingSurfaceVisible: boolean;
  lastCompletedContextualTourId: ContextualTourId | null;
  setContextualToursAutoEligible: (eligible: boolean) => void;
  setContextualToursOnboardingVisible: (visible: boolean) => void;
  setContextualToursBlockingSurfaceVisible: (visible: boolean) => void;
  requestContextualTour: (
    id: ContextualTourId,
    source: string,
    wasFeaturePreviouslyInteracted?: boolean,
    options?: { force?: boolean }
  ) => void;
  suppressContextualTour: (id: ContextualTourId, source: string) => void;
  detachContextualTourSource: (id: ContextualTourId, source: string) => void;
  advanceContextualTour: () => void;
  regressContextualTour: () => void;
  dismissContextualTour: (id?: ContextualTourId) => void;
  completeContextualTour: (id?: ContextualTourId) => void;
  cancelContextualTour: (id?: ContextualTourId) => void;
  markContextualToursSeen: (ids: ContextualTourId[]) => void;
  trustedOrcaHooks: PersistedTrustedOrcaHooks;
  markOrcaHookScriptConfirmed: (
    repoId: string,
    kind: OrcaHookScriptKind,
    contentHash: string
  ) => void;
  markOrcaHookRepoAlwaysTrusted: (repoId: string) => void;
  clearOrcaHookTrustForRepo: (repoId: string) => void;
  setupScriptPromptDismissedRepoIds: string[];
  dismissSetupScriptPrompt: (repoHostIdentity: string) => void;
  setupGuideSidebarDismissed: boolean;
  setSetupGuideSidebarDismissed: (dismissed: boolean) => void;
  setupGuideBrowserMilestoneMigrated: boolean;
  setupGuideBrowserMilestoneLegacyComplete: boolean;
  markSetupGuideBrowserMilestoneMigrated: (legacyComplete: boolean) => void;
  browserImportHintHidden: boolean;
  setBrowserImportHintHidden: (hidden: boolean) => void;
  mobileEmulatorTabIntroDismissed: boolean;
  dismissMobileEmulatorTabIntro: () => void;
  mobileEmulatorAgentSetupDismissed: boolean;
  dismissMobileEmulatorAgentSetup: () => void;
  projectOrderManualDefaultNoticeDismissed: boolean;
  dismissProjectOrderManualDefaultNotice: () => void;
  usagePercentageDisplayChangeNoticeDismissed: boolean;
  dismissUsagePercentageDisplayChangeNotice: () => void;
  usageEmptyStateDismissed: boolean;
  dismissUsageEmptyState: () => void;
  groupBy: 'none' | 'workspace-status' | 'repo' | 'pr-status';
  setGroupBy: (g: UISlice['groupBy']) => void;
  sortBy: 'name' | 'smart' | 'recent' | 'repo' | 'manual';
  setSortBy: (s: UISlice['sortBy']) => void;
  projectOrderBy: ProjectOrderBy;
  setProjectOrderBy: (p: ProjectOrderBy) => void;
  showActiveOnly: boolean;
  setShowActiveOnly: (v: boolean) => void;
  showSleepingWorkspaces: boolean;
  setShowSleepingWorkspaces: (v: boolean) => void;
  workspaceHostScope: WorkspaceHostScope;
  setWorkspaceHostScope: (scope: WorkspaceHostScope) => void;
  visibleWorkspaceHostIds: VisibleWorkspaceHostIds;
  setVisibleWorkspaceHostIds: (ids: VisibleWorkspaceHostIds) => void;
  workspaceHostOrder: WorkspaceHostOrder;
  setWorkspaceHostOrder: (ids: WorkspaceHostOrder) => void;
  manualRepoOrder: ManualRepoOrderEntry[];
  hideDefaultBranchWorkspace: boolean;
  setHideDefaultBranchWorkspace: (v: boolean) => void;
  hideAutomationGeneratedWorkspaces: boolean;
  setHideAutomationGeneratedWorkspaces: (v: boolean) => void;
  hideCliCreatedWorkspaces: boolean;
  setHideCliCreatedWorkspaces: (v: boolean) => void;
  hideDetachedHeadWorkspaces: boolean;
  setHideDetachedHeadWorkspaces: (v: boolean) => void;
  showDotfilesByWorktree: Record<string, boolean>;
  setShowDotfilesForWorktree: (worktreeId: string, showDotfiles: boolean) => void;
  toggleShowDotfilesForWorktree: (worktreeId: string) => void;
  filterRepoIds: string[];
  setFilterRepoIds: (ids: string[]) => void;
  collapsedGroups: Set<string>;
  toggleCollapsedGroup: (key: string) => void;
  worktreeCardProperties: WorktreeCardProperty[];
  _worktreeCardModeDefaulted: boolean;
  setWorktreeCardMode: (mode: WorktreeCardMode) => void;
  setWorktreeCardProperties: (properties: readonly WorktreeCardProperty[]) => void;
  agentActivityDisplayMode: AgentActivityDisplayMode;
  setAgentActivityDisplayMode: (mode: AgentActivityDisplayMode) => void;
  workspaceStatuses: WorkspaceStatusDefinition[];
  setWorkspaceStatuses: (statuses: WorkspaceStatusDefinition[]) => void;
  workspaceBoardOpacity: number;
  setWorkspaceBoardOpacity: (opacity: number) => void;
  workspaceBoardColumnWidth: number;
  setWorkspaceBoardColumnWidth: (width: number) => void;
  syncTaskStatusFromWorkspaceBoard: boolean;
  setSyncTaskStatusFromWorkspaceBoard: (enabled: boolean) => void;
  /** Transient: the in-window Agent Dashboard companion drawer is open. Not persisted. */
  agentDashboardDrawerOpen: boolean;
  setAgentDashboardDrawerOpen: (open: boolean) => void;
  statusBarItems: StatusBarItem[];
  toggleStatusBarItem: (item: StatusBarItem) => void;
  statusBarVisible: boolean;
  setStatusBarVisible: (v: boolean) => void;
  usagePercentageDisplay: UsagePercentageDisplay;
  setUsagePercentageDisplay: (display: UsagePercentageDisplay) => void;
  statusBarUsageMode: StatusBarUsageMode;
  setStatusBarUsageMode: (mode: StatusBarUsageMode) => void;
  workspacePortScan: { key: string; result: WorkspacePortScanResult } | null;
  workspacePortScansByKey: Record<string, WorkspacePortScanResult>;
  workspacePortScanRefreshing: boolean;
  setWorkspacePortScan: (scan: { key: string; result: WorkspacePortScanResult } | null) => void;
  setWorkspacePortScanProjection: (
    scan: { key: string; result: WorkspacePortScanResult } | null
  ) => void;
  replaceWorkspacePortScans: (
    scansByKey: Record<string, WorkspacePortScanResult>,
    projection: { key: string; result: WorkspacePortScanResult } | null
  ) => void;
  setWorkspacePortScanForKey: (key: string, result: WorkspacePortScanResult | null) => void;
  setWorkspacePortScanRefreshing: (refreshing: boolean) => void;
  /** Whether the pet overlay is currently visible. Persisted so "Hide pet" survives reload. Independent of the experimentalPet flag (which gates whether it can render at all). */
  petVisible: boolean;
  setPetVisible: (v: boolean) => void;
  /** Which pet is active — a bundled id or a custom UUID. Persisted via PersistedUIState. */
  petId: string;
  setPetId: (id: string) => void;
  /** User-uploaded pet images. Metadata only — bytes live in main's userData. */
  customPets: CustomPet[];
  addCustomPet: (model: CustomPet) => void;
  removeCustomPet: (id: string) => void;
  /** Pet overlay size in CSS pixels (square). User-adjustable so an oversized imported sprite isn't stuck on screen. */
  petSize: number;
  setPetSize: (size: number) => void;
  pendingRevealWorktree: PendingSidebarWorktreeReveal | null;
  pendingRevealSidebarRow: PendingSidebarRowReveal | null;
  revealWorktreeInSidebar: (
    worktreeId: string,
    options?: {
      behavior?: PendingSidebarWorktreeReveal['behavior']
      highlight?: boolean
      beginRename?: boolean
    }
  ) => void;
  revealSidebarRow: (
    rowKey: string,
    options?: {
      behavior?: PendingSidebarRowReveal['behavior']
      highlight?: boolean
    }
  ) => void;
  clearPendingRevealWorktreeId: () => void;
  clearPendingRevealSidebarRow: () => void;
  // Why: cleared by the diff decorator after it reveals the line, so the same id can be requested again without a stale value.
  scrollToDiffCommentId: string | null;
  setScrollToDiffCommentId: (id: string | null) => void;
  persistedUIReady: boolean;
  uiZoomLevel: number;
  setUIZoomLevel: (level: number) => void;
  editorFontZoomLevel: number;
  setEditorFontZoomLevel: (level: number) => void;
  hydratePersistedUI: (ui: PersistedUIState, source?: 'startup' | 'sync') => void;
  updateStatus: UpdateStatus;
  setUpdateStatus: (status: UpdateStatus) => void;
  // Why: cache last-'available' changelog so the card keeps rich content while downloading; cleared on idle/checking to avoid staleness.
  updateChangelog: ChangelogData | null;
  // Why: UpdateCard is lazy-loaded and may miss the transient checking status; hold manual-check intent until a terminal state consumes it.
  updateUserInitiatedCycle: boolean;
  dismissedUpdateVersion: string | null;
  dismissUpdate: (versionOverride?: string) => void;
  clearDismissedUpdateVersion: () => void;
  /** Dev-only channel override; null follows the running build's own channel. */
  releaseChannelOverride: ReleaseChannel | null;
  setReleaseChannelOverride: (channel: ReleaseChannel | null) => void;
  // Why: ephemeral, renderer-only — never persisted; resets each session and on every phase transition (see setUpdateStatus).
  updateCardCollapsed: boolean;
  setUpdateCardCollapsed: (collapsed: boolean) => void;
  updateReassuranceSeen: boolean;
  markUpdateReassuranceSeen: () => void;
  /** True on the launch where the OSC 52 default-on migration overrode a persisted `false`. */
  osc52ClipboardDefaultOnNoticePending: boolean;
  clearOsc52ClipboardDefaultOnNotice: () => void;
  isFullScreen: boolean;
  setIsFullScreen: (v: boolean) => void;
  /** URL opened when a new browser tab is created. Null = blank tab (default). */
  browserDefaultUrl: string | null;
  setBrowserDefaultUrl: (url: string | null) => void;
  browserDefaultSearchEngine: 'google' | 'duckduckgo' | 'bing' | 'kagi' | null;
  setBrowserDefaultSearchEngine: (engine: 'google' | 'duckduckgo' | 'bing' | 'kagi' | null) => void;
  browserDefaultZoomLevel: number;
  setBrowserDefaultZoomLevel: (level: number) => void;
  browserKagiSessionLink: string | null;
  setBrowserKagiSessionLink: (link: string | null) => void;
}
