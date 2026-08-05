import type {
  AgentStatusState,
  AgentType
} from './agent-status-types'
import type {
  BaseRefSearchResult,
  CreateWorktreeResult,
  GitWorktreeInfo,
  RemoveWorktreeResult,
  Repo,
  TabGroupLayoutNode,
  TuiAgent,
  Worktree,
  WorktreeLineage,
  WorkspaceLineage,
  WorktreeLineageWarning,
  TerminalPaneLayoutNode
} from './types'
import type {
  AgentProviderSessionMetadata,
  SleepingAgentLaunchConfig
} from './agent-session-resume'
import type { StartupCommandDelivery } from './codex-startup-delivery'
import type { ExecutionHostId } from './execution-host'
import type { PtyIncarnationId } from './pty-incarnation'
import type * as SharedRuntimeTypes from './runtime-types'

type RuntimeMobileSessionTabsResult = SharedRuntimeTypes.RuntimeMobileSessionTabsResult; type RuntimeTerminalSummary = SharedRuntimeTypes.RuntimeTerminalSummary;

export type RuntimeTerminalVisualTerminalNode = {
  type: 'terminal'
  handle: string
  tabId: string
  leafId: string
  title: string | null
  connected: boolean
  active: boolean
}

export type RuntimeTerminalVisualPaneNode =
  | RuntimeTerminalVisualTerminalNode
  | {
      type: 'pane-split'
      direction: Extract<TerminalPaneLayoutNode, { type: 'split' }>['direction']
      first: RuntimeTerminalVisualPaneNode
      second: RuntimeTerminalVisualPaneNode
    }

export type RuntimeTerminalVisualTab = {
  tabId: string
  title: string | null
  activeLeafId: string | null
  panes: RuntimeTerminalVisualPaneNode
}

export type RuntimeTerminalVisualGroupNode = {
  type: 'group'
  groupId: string | null
  activeTabId: string | null
  tabs: RuntimeTerminalVisualTab[]
}

export type RuntimeTerminalVisualLayoutNode =
  | RuntimeTerminalVisualGroupNode
  | {
      type: 'split'
      direction: Extract<TabGroupLayoutNode, { type: 'split' }>['direction']
      first: RuntimeTerminalVisualLayoutNode
      second: RuntimeTerminalVisualLayoutNode
    }

export type RuntimeTerminalVisualLayout = {
  worktreeId: string
  worktreePath: string
  root: RuntimeTerminalVisualLayoutNode
}

export type RuntimeTerminalListResult = {
  terminals: RuntimeTerminalSummary[]
  visualLayouts?: RuntimeTerminalVisualLayout[]
  topologyRevisions?: Record<string, number>
  totalCount: number
  truncated: boolean
}


export type RuntimeTerminalOrphanAdoptionClaim = {
  terminal: string
  ptyId: string
  incarnationId: PtyIncarnationId
  tabId: string
  leafId: string
}

export type RuntimeTerminalOrphanTopologyTab = {
  tabId: string
  root: TerminalPaneLayoutNode
  activeLeafId: string
  expandedLeafId: string | null
}

export type RuntimeTerminalOrphanTopologyGroup = {
  id: string
  activeTabId: string
  tabOrder: string[]
  recentTabIds?: string[]
}

export type RuntimeTerminalOrphanTopology = {
  tabs: RuntimeTerminalOrphanTopologyTab[]
  groups: RuntimeTerminalOrphanTopologyGroup[]
  groupLayout?: TabGroupLayoutNode
}

export type RuntimeTerminalOrphanAdoptionRequest = {
  worktree: string
  expectedTopologyRevision: number
  claims: RuntimeTerminalOrphanAdoptionClaim[]
  activeTabId?: string
  activeGroupId?: string
  topology?: RuntimeTerminalOrphanTopology
}

export type RuntimeTerminalOrphanAdoptionResult = {
  adopted: boolean
  topologyRevision: number
  snapshot: RuntimeMobileSessionTabsResult
}

export type RuntimeWorktreeTerminalSleepFailure =
  | 'terminal_liveness_unavailable'
  | 'terminal_worktree_sleep_still_live'

export type RuntimeWorktreeTerminalSleepResult = {
  stopped: number
  stoppedPtyIds: string[]
  livePtyIds: string[]
} & (
  | {
      postStopVerified: true
      postStopFailure?: never
      remainingLivePtyIds?: never
    }
  | {
      postStopVerified: false
      postStopFailure: 'terminal_liveness_unavailable'
      remainingLivePtyIds?: never
    }
  | {
      postStopVerified: false
      postStopFailure: 'terminal_worktree_sleep_still_live'
      remainingLivePtyIds: string[]
    }
)

export type RuntimeTerminalShow = RuntimeTerminalSummary & {
  paneRuntimeId: number
  ptyId: string | null
  rendererGraphEpoch: number
}

export type RuntimeTerminalInspect = RuntimeTerminalShow & {
  processIncarnation: string
  lifecycle: {
    state: 'running' | 'disconnected' | 'exited'
    exit: { code: number; reason: 'process-exit' | 'transport-loss' } | null
  }
  size: { cols: number; rows: number } | null
  history: {
    oldestCursor: string
    latestCursor: string
    truncated: boolean
    bounded: true
  }
  reattach: {
    disposition: 'attached' | 'provider-reconnect-required' | 'exited'
  }
}

export type RuntimeTerminalResize = {
  handle: string
  ptyId: string
  processIncarnation: string
  requested: { cols: number; rows: number }
  applied: { cols: number; rows: number }
  authoritative: true
}

export type RuntimeTerminalState = 'running' | 'exited' | 'unknown'

export type RuntimeTerminalRead = {
  handle: string
  status: RuntimeTerminalState
  tail: string[]
  truncated: boolean
  limited?: boolean
  oldestCursor?: string
  nextCursor: string | null
  latestCursor?: string
  returnedLineCount?: number
}

export type RuntimeTerminalRename = {
  handle: string
  tabId: string
  title: string | null
}

export type RuntimeTerminalSend = {
  handle: string
  accepted: boolean
  bytesWritten: number
  refusedReason?: 'no-agent' | 'permission'
}

export type RuntimeTerminalAgentStatusState = 'working' | 'permission' | 'idle' | null

export type RuntimeTerminalAgentStatus = {
  handle: string
  isRunningAgent: boolean
  status: RuntimeTerminalAgentStatusState
}

export type RuntimeTerminalPresentation = 'background' | 'focused'
type RuntimeTerminalCreateBaseRequestPayload = {
  requestId: string
  worktreeId?: string
  afterTabId?: string
  targetGroupId?: string
  command?: string
  cwd?: string
  env?: Record<string, string>
  envToDelete?: string[]
  launchConfig?: SleepingAgentLaunchConfig
  resumeProviderSession?: AgentProviderSessionMetadata
  launchToken?: string
  launchAgent?: TuiAgent
  viewMode?: 'terminal' | 'chat'
  startupCommandDelivery?: StartupCommandDelivery
  title?: string
  activate?: boolean
  presentation?: RuntimeTerminalPresentation
  /**
   * Why: adopting a terminal is separate from pointing the user at it. `false`
   * keeps the tab silent — no sidebar reveal, no tab focus — for terminals the
   * user never asked to see (e.g. a workspace created in the background).
   * Absent means "surface it", so this is a suppression switch, never `true`.
   */
  surfaceOwner?: false
}

export type RuntimeTerminalCreateRequestPayload =
  | (RuntimeTerminalCreateBaseRequestPayload & { source?: undefined })
  | (RuntimeTerminalCreateBaseRequestPayload & {
      worktreeId: string
      // Why: only the host-owned runtime-session bridge may bypass the renderer's
      // active-runtime local terminal guard; ordinary UI requests must omit this.
      source: 'runtime-session'
    })

export type RuntimeTerminalCreate = {
  handle: string
  tabId?: string
  paneKey?: string | null
  ptyId?: string | null
  worktreeId: string
  title: string | null
  /** Spawn-time execution identity; paired clients must not infer nested SSH from their own graph. */
  executionHostId?: ExecutionHostId
  hostPlatform?: NodeJS.Platform
  surface?: 'background' | 'visible'
  warning?: string
  /** Present only for the structured host-authority resume path. */
  agentSessionDisposition?: 'created' | 'adopted'
}

export type RuntimeTerminalSplit = {
  handle: string
  tabId: string
  paneRuntimeId: number
}

export type RuntimeTerminalResolvePane = {
  handle: string
  tabId: string
  leafId: string
  ptyId: string | null
  worktreeId?: string
  executionHostId?: ExecutionHostId
  hostPlatform?: NodeJS.Platform
}

export type RuntimeTerminalFocus = {
  handle: string
  tabId: string
  worktreeId: string
}

export type RuntimeTerminalClose = {
  handle: string
  tabId: string
  /** Present for the durable whole-tab lifecycle without changing legacy receipts. */
  closeMode?: 'tab'
  ptyKilled: boolean
}

export type RuntimeTerminalWaitCondition = 'exit' | 'tui-idle'
export type RuntimeTerminalWaitBlockedReason =
  | 'codex-update-prompt'
  | 'codex-trust-workspace'
  | 'codex-cwd-prompt'
  | 'codex-model-migration-prompt'
  | 'codex-hooks-review-prompt'
  | 'codex-interactive-prompt'

export type RuntimeTerminalWait = {
  handle: string
  condition: RuntimeTerminalWaitCondition
  satisfied: boolean
  status: RuntimeTerminalState
  exitCode: number | null
  blockedReason?: RuntimeTerminalWaitBlockedReason
}

/** One agent's live status as carried to mobile in a worktree.ps summary.
 *  Flat shape (parentPaneKey points to another row in the same worktree's list)
 *  so the client can rebuild the spawn-lineage tree desktop renders inline. */
export type RuntimeWorktreeAgentRow = {
  paneKey: string
  /** paneKey of the orchestration parent, or null for a root agent. */
  parentPaneKey: string | null
  state: AgentStatusState
  agentType: AgentType | null
  /** Raw hook-reported prompt. Display surfaces can prefer displayName. */
  prompt: string
  /** Explicit orchestration task title, or null outside dispatch. */
  taskTitle: string | null
  /** Explicit UI label for orchestration task rows, or null outside dispatch. */
  displayName: string | null
  lastAssistantMessage: string | null
  toolName: string | null
  toolInput: string | null
  interrupted: boolean
  /** When the current `state` was first reported (ms). Drives "Xm ago". */
  stateStartedAt: number
  updatedAt: number
}

export type RuntimeWorktreePsSummary = {
  workspaceKind?: 'git' | 'folder-workspace'
  worktreeId: string
  repoId: string
  hostId?: Worktree['hostId']
  terminalPlatform?: NodeJS.Platform
  repo: string
  path: string
  branch: string
  isArchived: boolean
  isMainWorktree: boolean
  hasHostSidebarActivity: boolean
  worktreeInstanceId?: string
  lineageWorktreeInstanceId?: string
  parentWorktreeInstanceId?: string
  parentWorktreeId: string | null
  childWorktreeIds: string[]
  displayName: string
  workspaceStatus: string
  sortOrder: number
  manualOrder?: number
  lastActivityAt?: number
  createdAt?: number
  linkedIssue: number | null
  linkedPR: { number: number; state: string } | null
  linkedLinearIssue: string | null
  linkedGitLabMR: number | null
  linkedGitLabIssue: number | null
  comment: string
  isPinned: boolean
  /** True for the worktree currently focused on the desktop/host
   *  (session.activeWorktreeId). Mobile scrolls it into view and highlights it
   *  so the list reflects the desktop's current selection. */
  isActive: boolean
  unread: boolean
  liveTerminalCount: number
  hasAttachedPty: boolean
  lastOutputAt: number | null
  preview: string
  status: RuntimeWorktreeStatus
  /** Live agents in this worktree, newest-state-first. Empty for shell-only
   *  worktrees. Mirrors desktop's inline agent list (WorktreeCardAgents). */
  agents: RuntimeWorktreeAgentRow[]
}

export type RuntimeGitLocalBranches = {
  current: string | null
  branches: string[]
}

export type RuntimeGitCheckoutResult = {
  ok: true
  branch: string
}

export type RuntimeWorktreeStatus = 'active' | 'working' | 'permission' | 'done' | 'inactive'

export type RuntimeWorktreeRecord = Worktree & {
  parentWorktreeId: string | null
  childWorktreeIds: string[]
  lineage: WorktreeLineage | null
  workspaceLineage?: WorkspaceLineage | null
  git: GitWorktreeInfo
}

export type RuntimeWorktreeCreateResult = {
  worktree: RuntimeWorktreeRecord
  lineage: WorktreeLineage | null
  workspaceLineage?: WorkspaceLineage | null
  warnings: WorktreeLineageWarning[]
  warning?: string
  startupTerminal?: CreateWorktreeResult['startupTerminal']
  agentTerminalHandle?: string
}

export type RuntimeWorktreeRemoveResult = RemoveWorktreeResult & {
  removed: boolean
  warning?: string
}

export type RuntimeWorktreePsResult = {
  worktrees: RuntimeWorktreePsSummary[]
  totalCount: number
  truncated: boolean
}

export type RuntimeRepoList = {
  repos: Repo[]
}

export type RuntimeRepoSearchRefs = {
  refs: string[]
  refDetails?: BaseRefSearchResult[]
  truncated: boolean
}

export type RuntimeWorktreeListResult = {
  worktrees: RuntimeWorktreeRecord[]
  totalCount: number
  truncated: boolean
}
