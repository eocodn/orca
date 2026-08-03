 import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type {
  Repo,
  SetupSplitDirection,
  Tab,
  TerminalLayoutSnapshot,
  TerminalTab,
  TuiAgent,
  Worktree,
  WorkspaceKey,
  WorkspaceSessionState
} from '../../../../shared/types'
import type {
  AgentProviderSessionMetadata,
  SleepingAgentLaunchConfig
} from '../../../../shared/agent-session-resume'
import type { DirectSshAuthority } from '../../../../shared/ssh-types'
import { parseAppSshPtyId } from '../../../../shared/ssh-pty-id'
import {
  DEFAULT_REPO_BADGE_COLOR,
  FLOATING_TERMINAL_WORKTREE_ID
} from '../../../../shared/constants'
import { parseExecutionHostId, type ExecutionHostId } from '../../../../shared/execution-host'
import {
  folderWorkspaceKey,
  parseWorkspaceKey,
  worktreeWorkspaceKey
} from '../../../../shared/workspace-scope'
import { deriveGeneratedTabTitle } from '../../../../shared/agent-tab-title'
import { isDecorativeAgentTitleFrameChange } from '../../../../shared/agent-decorative-title-signature'
import {
  makePaneKey,
  parseLegacyNumericPaneKey,
  parsePaneKey
} from '../../../../shared/stable-pane-id'
import { isValidHostTerminalTabId, isValidTerminalTabId } from '../../../../shared/terminal-tab-id'
import { buildByIdIndex, buildWorktreeByIdIndex } from './worktree-by-id-index'
import { isSameCodexRestartNoticeAccount } from './codex-restart-notice-account-identity'
import {
  getRepoIdFromWorktreeId,
  splitWorktreeIdForFilesystem
} from '../../../../shared/worktree-id'
import { isWslUncPath } from '../../../../shared/wsl-paths'
import type { ProjectExecutionRuntimeResolution } from '../../../../shared/project-execution-runtime'
import type { StartupCommandDelivery } from '../../../../shared/codex-startup-delivery'
import type { SessionOptionValue } from '../../../../shared/native-chat-session-options'
import { resolveLocalWindowsTerminalShellOverrideForTab } from '../../../../shared/local-windows-terminal-runtime'
import { WINDOWS_GIT_BASH_SHELL } from '../../../../shared/windows-terminal-shell'
import type { AgentStartedTelemetry } from '../../lib/worktree-activation'
import { scheduleRuntimeGraphSync } from '@/runtime/sync-runtime-graph'
import { forgetAgentHibernationTabOutput } from '@/lib/agent-hibernation-output-activity'
import { forgetForegroundTerminalTabs } from '@/lib/foreground-terminal-tabs'
import { forgetAgentStartupDeliveriesForTabs } from '@/lib/agent-startup-delivery-guards'
import { clearTransientTerminalState, emptyLayoutSnapshot } from './terminal-helpers'
import { pushClosedTerminalTabSnapshot, pushRecentlyClosedTabKind } from './recently-closed-tabs'
import { isClaudeAgent } from '@/lib/agent-status'
import { recordTerminalInputActivity } from '@/lib/terminal-input-activity-coalescing'
import { classifyTitleActivity } from '@/lib/pane-agent-evidence'
import { buildOrphanTerminalCleanupPatch, getOrphanTerminalIds } from './terminal-orphan-helpers'
import {
  dedupeTabOrder,
  ensureGroup,
  findTabByEntityInGroup,
  pushRecentTabId,
  sanitizeRecentTabIds,
  updateGroup
} from './tab-group-state'
import {
  restorePtyDataHandlersAfterFailedShutdown,
  unregisterPtyDataHandlers
} from '@/components/terminal-pane/pty-transport'
// Why: use the store-free registry (not terminal-parked-tab-watchers, which imports @/store) to avoid re-entering store creation during this slice's eval.
import {
  disposeParkedTerminalWatchersForPtyIds,
  retireParkedTerminalTab
} from '@/components/terminal-pane/terminal-parked-watcher-registry'
import {
  clearCommittedPtyShutdownSettlements,
  hasCommittedPtyShutdownSettlement,
  markCommittedPtyShutdowns,
  noteCommittedPtyShutdownSettlements,
  settleDeferredPtyShutdownExits
} from '@/components/terminal-pane/pty-shutdown-exit-deferral'
import {
  normalizeTerminalLayoutSnapshot,
  resolvePtyBoundActiveLeafId
} from '@/components/terminal-pane/terminal-layout-leaf-ids'
import { shutdownBufferCaptures } from '@/components/terminal-pane/shutdown-buffer-captures'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { parseRemoteRuntimePtyId, toRemoteRuntimePtyId } from '@/runtime/runtime-terminal-stream'
import { toRuntimeWorktreeSelector } from '@/runtime/runtime-worktree-selector'
import { requestRemoteWorktreeSleep } from '@/runtime/remote-worktree-sleep'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { getFolderWorkspaceConnectionId } from '@/lib/folder-workspace-connection'
import {
  clearDirectSshTerminalBindings,
  invalidateStaleDirectSshTerminalBindings,
  type DirectSshLivePtyBinding,
  type DirectSshPaneRetryAttempt,
  type DirectSshPaneRetryAttemptId,
  type DirectSshPaneRetryHistory,
  type DirectSshPaneRetryResult
} from './direct-ssh-terminal-recovery'
import {
  retryDirectSshTerminalPanes,
  retrySettledDirectSshTerminalPane
} from './direct-ssh-pane-retry-ledger'
import {
  directSshAuthoritiesEqual,
  settleDirectSshPaneRetryState,
  transferDirectSshPaneDetachLedger
} from './direct-ssh-terminal-authority-ledger'
import { resolveDirectSshTerminalWorkspaceKeys } from './direct-ssh-terminal-workspace-scope'
import { hasWorktreeSleepIntent } from '@/lib/worktree-sleep-intent'
import { sanitizeTerminalLayoutPaneTitles } from '@/lib/terminal-pane-title-sanitization'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { resolveTerminalWorktreeRoute } from '@/lib/terminal-worktree-route'
import { resolveWorktreeOperationRouteResult } from '@/lib/worktree-operation-route'
import { getLocalProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import type { NativeChatLaunchDraft, NativeChatLaunchPrompt } from '@/lib/native-chat-launch-prompt'
import {
  addAdditionalValidWorkspaceKeys,
  type WorkspaceSessionHydrationOptions
} from '@/lib/workspace-session-hydration-keys'
import {
  buildValidWorktreeIdsForSessionHydration,
  collectPersistedWorktreeIdsForSessionHydration
} from './degraded-repo-worktree-validity'
import {
  collectHibernatedCompletionEvidenceForWorktree,
  collectSleepingAgentSessionRecordsForWorktree,
  removeSleepingRecordsReplacedByManualWorktreeSleep,
  type AgentStatusWorktreeShutdownReason
} from './agent-status'
import {
  buildTerminalTabRetirementPlan,
  classifyTerminalRetirementWorktree,
  isTerminalTabPresent,
  removeSleepingAgentSessionsForTab,
  type TerminalTabCloseReason,
  type TerminalTabRetirementPlan
} from './terminal-tab-retirement'
import { getNextTerminalOrdinal, isRemoteRuntimePtyId, isCurrentDirectSshAuthority, resolveDirectSshTerminalKeys, getPendingActivationSpawnCount, consumePendingActivationSpawn, getFallbackTabTitle, getPathDisplayName, buildRuntimeSessionPlaceholders, getTerminalTabOwnerWorktreeId, updateUnifiedTerminalLabel, updateUnifiedTerminalGeneratedLabel, getTabIdFromPaneKey, isWindowsRendererRuntime, isAllowedRemoteWindowsTerminalShell, resolveCreatedTabShellOverride, worktreeUsesWslPath, worktreeUsesRemoteConnection, getRemoteConnectionIdForWorktree, resolveTerminalStopRuntimeEnvironmentId, sortedUniquePtyIds, equalStringSets, uniquePtyIds, resolvePrimaryLayoutPtyId, withTerminalTabPtyId, replaceHydratedRecordKeys, targetScopedWorkspaceHydrationPatch } from './terminals-state'
import type { AutomaticAgentResumeClaim, CodexRestartNotice, ReconnectPersistedTerminalsOptions, WorkspaceHydrationPatch } from './terminals-state'
export type TerminalSlice = {
  tabsByWorktree: Record<string, TerminalTab[]>;
  activeTabId: string | null;
  /** Per-worktree last-active tab, restored on worktree switch so the user returns to where they left, not tabs[0]. */
  activeTabIdByWorktree: Record<string, string | null>;
  ptyIdsByTabId: Record<string, string[]>;
  /** Live pane titles by tabId then paneId; preserves per-pane agent status (unlike the legacy tab title) while TerminalPane is mounted. */
  runtimePaneTitlesByTabId: Record<string, Record<number, string>>;
  /** Per-tab unread flags (BEL or agent-complete); ephemeral UI state, not persisted. Cleared when the user activates/interacts with the tab. */
  unreadTerminalTabs: Record<string, true>;
  /** Pane-keyed attention marker (narrower than unreadTerminalTabs); clears when the user interacts with the exact pane that raised it. */
  unreadTerminalPanes: Record<string, true>;
  /** Agent-completion marker for focus-return auto-ack; separate from unreadTerminalPanes so generic bells still show until interact. */
  unreadAgentCompletionPanes: Record<string, true>;
  // Remote guard keys must use renderer-visible, environment-scoped PTY ids; raw runtime handles are only valid at the RPC boundary.
  suppressedPtyExitIds: Record<string, true>;
  /** Reference-counted so overlapping shutdowns retain renderer PTY bindings until every owner settles. */
  pendingPtyShutdownIds: Record<string, number>;
  pendingCodexPaneRestartIds: Record<string, true>;
  codexRestartNoticeByPtyId: Record<string, CodexRestartNotice>;
  directSshPaneRetryByTabId: Record<string, DirectSshPaneRetryAttempt>;
  directSshLivePtyBindingByTabId: Record<string, DirectSshLivePtyBinding>;
  directSshPaneRetryHistoryByTabId: Record<string, DirectSshPaneRetryHistory>;
  expandedPaneByTabId: Record<string, boolean>;
  canExpandPaneByTabId: Record<string, boolean>;
  terminalLayoutsByTabId: Record<string, TerminalLayoutSnapshot>;
  /** Most recent quick-command id per group; in-memory only so a deleted command's stale id can't surface as the split-button label. */
  recentQuickCommandIdByGroup: Record<string, string>;
  setRecentQuickCommandForGroup: (groupId: string, quickCommandId: string) => void;
  /** Runtime-only claim for auto sleeping-session recovery tabs; bridges the gap between startup payload consumption and hooks going live. */
  automaticAgentResumeClaimsByTabId: Record<string, AutomaticAgentResumeClaim>;
  claimAutomaticAgentResume: (tabId: string, claim: AutomaticAgentResumeClaim) => void;
  /** Launch-time native-chat prompt echo, keyed by terminal tab. In-memory only. */
  nativeChatLaunchPromptByTabId: Record<string, NativeChatLaunchPrompt>;
  seedNativeChatLaunchPrompt: (prompt: NativeChatLaunchPrompt) => void;
  markNativeChatLaunchPromptFailed: (tabId: string) => void;
  clearNativeChatLaunchPrompt: (tabId: string) => void;
  /** Launch context prefilled into the TUI input as an unsent draft; the chat composer adopts it. In-memory only. */
  nativeChatLaunchDraftByTabId: Record<string, NativeChatLaunchDraft>;
  seedNativeChatLaunchDraft: (draft: NativeChatLaunchDraft) => void;
  markNativeChatLaunchDraftAdopted: (tabId: string) => void;
  resolveNativeChatLaunchDraft: (
    tabId: string,
    resolution: Pick<NativeChatLaunchDraft, 'createdAt' | 'text'>
  ) => void;
  clearNativeChatLaunchDraft: (tabId: string) => void;
  pendingStartupByTabId: Record<
    string,
    {
      command: string
      /** Renderer-delivered startup input for callers needing xterm paste semantics before the submit Enter. */
      delivery?: 'terminal-paste'
      startupCommandDelivery?: StartupCommandDelivery
      env?: Record<string, string>
      envToDelete?: string[]
      launchConfig?: SleepingAgentLaunchConfig
      resumeProviderSession?: AgentProviderSessionMetadata
      launchToken?: string
      launchAgent?: TuiAgent
      /** Explicit CLI override for host-owned agent launches; omission uses host settings. */
      agentArgsOverride?: string | null
      draftPrompt?: string
      sessionOptions?: Record<string, SessionOptionValue>
      /** Initial prompt-start status for agents that lack native prompt hooks. */
      initialAgentStatus?: { agent: TuiAgent; prompt: string }
      /** Show the restored-session banner when this startup command mounts. */
      showSessionRestoredBanner?: boolean
      /** Telemetry for the `agent_started` event; threaded to the pty:spawn handler so it fires only after spawn confirms, not on click-intent. */
      telemetry?: AgentStartedTelemetry
    }
  >;
  pendingInitialCwdByTabId: Record<string, string>;
  /** Queued setup-split requests; TerminalPane splits and runs the command in a new pane so the main terminal stays immediately interactive. */
  pendingSetupSplitByTabId: Record<
    string,
    { command: string; env?: Record<string, string>; direction: SetupSplitDirection }
  >;
  /** Queued issue-command-split requests, triggered when an issue is linked at worktree creation and the repo's issue automation is enabled. */
  pendingIssueCommandSplitByTabId: Record<string, { command: string; env?: Record<string, string> }>;
  tabBarOrderByWorktree: Record<string, string[]>;
  workspaceSessionReady: boolean;
  restoredRuntimeHostIdByWorkspaceSessionKey: Record<string, ExecutionHostId>;
  defaultTerminalTabsAppliedByWorktreeId: Record<string, true>;
  markDefaultTerminalTabsApplied: (worktreeId: string) => void;
  /** True only after hydrateWorkspaceSession loaded real orca-data.json; guards the session writer so an early-startup crash can't overwrite good data on disk. */
  hydrationSucceeded: boolean;
  setHydrationSucceeded: (value: boolean) => void;
  pendingReconnectWorktreeIds: string[];
  pendingReconnectTabByWorktree: Record<string, string[]>;
  /** tabId → previous session's ptyId; for daemon backends it doubles as the sessionId, so spawn createOrAttach returns the surviving terminal. */
  pendingReconnectPtyIdByTabId: Record<string, string>;
  // Why: clearTabPtyId nulls tab.ptyId on disconnect; keep the last relay ID here so session save can still capture it for reattach after restart.
  lastKnownRelayPtyIdByTabId: Record<string, string>;
  /** ANSI snapshots from daemon reattach, keyed by new ptyId; TerminalPane writes them to xterm.js to restore visual state. */
  pendingSnapshotByPtyId: Record<
    string,
    { snapshot: string; cols?: number; rows?: number; isAlternateScreen?: boolean }
  >;
  consumePendingSnapshot: (
    ptyId: string
  ) => { snapshot: string; cols?: number; rows?: number; isAlternateScreen?: boolean } | null;
  /** Cold-restore data (read-only scrollback shown above the fresh prompt) from disk history after a daemon crash, keyed by the new ptyId. */
  pendingColdRestoreByPtyId: Record<string, { scrollback: string; cwd: string }>;
  consumePendingColdRestore: (ptyId: string) => { scrollback: string; cwd: string } | null;
  createTab: (
    worktreeId: string,
    targetGroupId?: string,
    shellOverride?: string,
    options?: {
      pendingActivationSpawn?: boolean
      initialPtyId?: string
      activate?: boolean
      recordInteraction?: boolean
      /** Pre-allocated tab id (main mints it for CLI/runtime PTYs with a baked pane key); minted fresh on omit or cross-worktree collision. */
      id?: string
      /** Coding-harness agent launched here, recorded so the tab bar shows the provider icon before the agent's first hook event. */
      launchAgent?: TuiAgent
      quickCommandLabel?: string | null
      /** Initial native-chat view mode; agent launches pass 'chat' when openAgentTabsInChatByDefault is on, else omitted for the 'terminal' default. */
      viewMode?: Tab['viewMode']
      startupCwd?: string
    }
  ) => TerminalTab;
  openNewTerminalTabInActiveWorkspace: (groupId: string) => Promise<void>;
  closeTab: (
    tabId: string,
    opts?: {
      recordInteraction?: boolean
      reason?: TerminalTabCloseReason
      captureRecentlyClosed?: boolean
      remoteCloseOwnedByHost?: boolean
      localPtyTeardownOwnedExternally?: boolean
      precomputedRetirementPlan?: TerminalTabRetirementPlan
    }
  ) => void;
  reorderTabs: (worktreeId: string, tabIds: string[]) => void;
  setTabBarOrder: (worktreeId: string, order: string[]) => void;
  setActiveTab: (tabId: string) => void;
  setActiveTabForWorktree: (worktreeId: string, tabId: string) => void;
  updateTabTitle: (tabId: string, title: string) => void;
  setGeneratedTabTitleFromAgentPrompt: (
    paneKey: string,
    prompt: string,
    options?: { replaceExistingGeneratedTitle?: boolean }
  ) => void;
  clearTabLaunchAgent: (tabId: string) => void;
  setRuntimePaneTitle: (tabId: string, paneId: number, title: string) => void;
  clearRuntimePaneTitle: (tabId: string, paneId: number) => void;
  /** Mark a tab unread (agent working→idle); skipped when the tab is visible, since a "seen" flag would never clear. */
  markTerminalTabUnread: (tabId: string) => void;
  markTerminalPaneUnread: (paneKey: string) => void;
  markAgentCompletionPaneUnread: (paneKey: string) => void;
  /** Clear a tab's unread indicator on user interaction (ghostty "show until interact" model). */
  clearTerminalTabUnread: (tabId: string) => void;
  clearTerminalPaneUnread: (paneKey: string) => void;
  setTabCustomTitle: (
    tabId: string,
    title: string | null,
    opts?: { recordInteraction?: boolean }
  ) => void;
  setTabColor: (tabId: string, color: string | null) => void;
  updateTabPtyId: (
    tabId: string,
    ptyId: string,
    replacedPtyId?: string,
    directSshRetryAttemptId?: DirectSshPaneRetryAttemptId
  ) => void;
  clearTabPtyId: (tabId: string, ptyId?: string) => void;
  clearDirectSshTargetPtyBindings: (targetId: string) => number;
  invalidateStaleDirectSshTargetPtyBindings: (authority: DirectSshAuthority) => number;
  retryDirectSshTargetPanes: (authority: DirectSshAuthority, now?: number) => number;
  settleDirectSshPaneRetry: (result: DirectSshPaneRetryResult, now?: number) => void;
  shutdownWorktreeTerminals: (
    worktreeId: string,
    opts?: {
      keepIdentifiers?: boolean
      shutdownReason?: AgentStatusWorktreeShutdownReason
      sleepingPaneKeys?: string[]
      expectedRuntimePtyIds?: string[]
    }
  ) => Promise<void>;
  shutdownCompletedAgentPaneForHibernation: (
    worktreeId: string,
    opts: {
      paneKey: string
      tabId: string
      leafId: string
      ptyId: string
      expectedRuntimePtyId?: string
    }
  ) => Promise<void>;
  suppressPtyExit: (ptyId: string) => void;
  consumeSuppressedPtyExit: (ptyId: string) => boolean;
  isPtyShutdownPending: (ptyId: string) => boolean;
  queueCodexPaneRestarts: (ptyIds: string[]) => void;
  consumePendingCodexPaneRestart: (ptyId: string) => boolean;
  /** Returns the ptyIds left holding a notice, so callers can tell a raised
   *  prompt from one the A -> B -> A collapse dropped. */
  markCodexRestartNotices: (
    notices: (Pick<CodexRestartNotice, 'previousAccountLabel' | 'nextAccountLabel'> &
      Partial<Pick<CodexRestartNotice, 'previousAccountId' | 'nextAccountId'>> & {
        ptyId: string
      })[]
  ) => string[];
  clearCodexRestartNotice: (ptyId: string) => void;
  dismissCodexRestartNotices: (ptyIds: string[]) => void;
  setTabPaneExpanded: (tabId: string, expanded: boolean) => void;
  setTabCanExpandPane: (tabId: string, canExpand: boolean) => void;
  setTabLayout: (tabId: string, layout: TerminalLayoutSnapshot | null) => void;
  syncPaneDetachPtyOwnership: (args: {
    detachedLeafId: string
    detachedPtyId: string | null
    sourceLayout: TerminalLayoutSnapshot
    sourceTabId: string
    targetTabId: string
  }) => void;
  queueTabStartupCommand: (
    tabId: string,
    startup: {
      command: string
      delivery?: 'terminal-paste'
      startupCommandDelivery?: StartupCommandDelivery
      env?: Record<string, string>
      envToDelete?: string[]
      launchConfig?: SleepingAgentLaunchConfig
      resumeProviderSession?: AgentProviderSessionMetadata
      launchToken?: string
      launchAgent?: TuiAgent
      agentArgsOverride?: string | null
      draftPrompt?: string
      sessionOptions?: Record<string, SessionOptionValue>
      initialAgentStatus?: { agent: TuiAgent; prompt: string }
      showSessionRestoredBanner?: boolean
      telemetry?: AgentStartedTelemetry
    }
  ) => void;
  queueTabInitialCwd: (tabId: string, cwd: string) => void;
  consumeTabInitialCwd: (tabId: string) => string | null;
  consumeTabStartupCommand: (tabId: string) => {
    command: string
    delivery?: 'terminal-paste'
    startupCommandDelivery?: StartupCommandDelivery
    env?: Record<string, string>
    envToDelete?: string[]
    launchConfig?: SleepingAgentLaunchConfig
    resumeProviderSession?: AgentProviderSessionMetadata
    launchToken?: string
    launchAgent?: TuiAgent
    agentArgsOverride?: string | null
    draftPrompt?: string
    sessionOptions?: Record<string, SessionOptionValue>
    initialAgentStatus?: { agent: TuiAgent; prompt: string }
    showSessionRestoredBanner?: boolean
    telemetry?: AgentStartedTelemetry
  } | null;
  queueTabSetupSplit: (
    tabId: string,
    startup: { command: string; env?: Record<string, string>; direction: SetupSplitDirection }
  ) => void;
  consumeTabSetupSplit: (
    tabId: string
  ) => { command: string; env?: Record<string, string>; direction: SetupSplitDirection } | null;
  queueTabIssueCommandSplit: (
    tabId: string,
    issueCommand: { command: string; env?: Record<string, string> }
  ) => void;
  consumeTabIssueCommandSplit: (
    tabId: string
  ) => { command: string; env?: Record<string, string> } | null;
  /** `${tabId}:${leafId}` → ms when the prompt-cache countdown started (agent idle); null means no active timer for that pane. */
  cacheTimerByKey: Record<string, number | null>;
  setCacheTimerStartedAt: (key: string, ts: number | null) => void;
  /** paneKey → wall-clock user input time; hibernation uses it to avoid sleeping a completed agent pane the user turned into a shell. */
  lastTerminalInputAtByPaneKey: Record<string, number>;
  recordTerminalInput: (paneKey: string, timestamp?: number) => void;
  /** Seed cache timers for idle Claude sessions missing one; called when the feature is enabled mid-session. */
  seedCacheTimersForIdleTabs: () => void;
  /** SSH target IDs needing a passphrase; reconnect is deferred until the user focuses an affected terminal tab. */
  deferredSshReconnectTargets: string[];
  /** tabId → remote PTY session ID for deferred (passphrase) SSH tabs; survives the startup clear because reconnect runs later, on focus. */
  deferredSshSessionIdsByTabId: Record<string, string>;
  setDeferredSshReconnectTargets: (targetIds: string[]) => void;
  removeDeferredSshReconnectTarget: (targetId: string) => void;
  removeDeferredSshSessionId: (tabId: string) => void;
  hydrateWorkspaceSession: (
    session: WorkspaceSessionState,
    options?: HydrateWorkspaceSessionOptions
  ) => void;
  reconnectPersistedTerminals: (
    signal?: AbortSignal,
    options?: ReconnectPersistedTerminalsOptions
  ) => Promise<void>;
}
export type HydrateWorkspaceSessionOptions = {
  directSshAuthority?: DirectSshAuthority;
  runtimeHostIdByWorkspaceSessionKey?: Record<string, ExecutionHostId>;
} & WorkspaceSessionHydrationOptions
