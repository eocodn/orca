import type { AgentStatusEntry } from './agent-status-types'
import type {
  BrowserCertificateFailure,
  BrowserLoadError,
  TabGroupLayoutNode,
  TerminalColorOverrides,
  TerminalLayoutSnapshot,
  TuiAgent
} from './types'



export type RuntimeMobileSessionTerminalTab = {
  type: 'terminal'
  id: string
  title: string
  quickCommandLabel?: string | null
  parentTabId: string
  leafId: string
  ptyId?: string | null
  terminalTheme?: RuntimeMobileTerminalTheme
  agentStatus?: AgentStatusEntry | null
  launchAgent?: TuiAgent
  startupCwd?: string
  parentLayout?: TerminalLayoutSnapshot
  /** Tab-level color/pin (per parentTabId), host-persisted for remote servers. */
  color?: string | null
  isPinned?: boolean
  /** Per-tab view preference (terminal xterm vs native chat). Host-persisted so
   *  paired clients converge; clients still win during the optimistic echo window. */
  viewMode?: 'terminal' | 'chat'
  /** Launch context delivered only into the TUI input as an unsent draft; the
   *  mobile chat composer adopts it so the context isn't invisible in chat. */
  launchDraft?: string
  /** Identity of the launch draft text, used to retire only the adopted generation. */
  launchDraftCreatedAt?: number
  isActive: boolean
}

export type RuntimeMobileTerminalTheme = {
  mode: 'dark' | 'light'
  theme: TerminalColorOverrides
}

export type RuntimeMobileSessionMarkdownTab = {
  type: 'markdown'
  id: string
  title: string
  filePath: string
  relativePath: string
  language: 'markdown'
  mode: 'edit' | 'markdown-preview'
  isDirty: boolean
  isActive: boolean
  sourceFileId: string
  sourceFilePath: string
  sourceRelativePath: string
  documentVersion: string
  /** Tab-level color/pin, host-persisted for remote servers. */
  color?: string | null
  isPinned?: boolean
}

export type RuntimeMobileSessionFileTab = {
  type: 'file'
  id: string
  title: string
  filePath: string
  relativePath: string
  language: string
  mode?: 'edit' | 'diff'
  diffSource?: 'staged' | 'unstaged'
  isDirty: boolean
  /** Tab-level color/pin, host-persisted for remote servers. */
  color?: string | null
  isPinned?: boolean
  isActive: boolean
}

export type RuntimeMobileSessionBrowserTab = {
  type: 'browser'
  id: string
  title: string
  browserWorkspaceId: string
  browserPageId: string | null
  url: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  loadError?: BrowserLoadError | null
  certificateFailure?: BrowserCertificateFailure | null
  color?: string | null
  isPinned?: boolean
  isActive: boolean
}

export type RuntimeMobileSessionSnapshotTab =
  | RuntimeMobileSessionTerminalTab
  | RuntimeMobileSessionMarkdownTab
  | RuntimeMobileSessionFileTab
  | RuntimeMobileSessionBrowserTab

export type RuntimeMobileSessionTerminalClientTab =
  | (RuntimeMobileSessionTerminalTab & {
      status: 'pending-handle'
      terminal: null
    })
  | (RuntimeMobileSessionTerminalTab & {
      status: 'ready'
      terminal: string
    })

export type RuntimeMobileSessionClientTab =
  | RuntimeMobileSessionTerminalClientTab
  | RuntimeMobileSessionMarkdownTab
  | RuntimeMobileSessionFileTab
  | RuntimeMobileSessionBrowserTab

export type RuntimeMobileSessionTabGroup = {
  id: string
  activeTabId: string | null
  tabOrder: string[]
  recentTabIds?: string[]
}

type RuntimeMobileSessionTabMoveBase = {
  tabId: string
  targetGroupId: string
}

export type RuntimeMobileSessionTabMove =
  | (RuntimeMobileSessionTabMoveBase & {
      kind: 'reorder'
      tabOrder: string[]
    })
  | (RuntimeMobileSessionTabMoveBase & {
      kind: 'move-to-group'
      index?: number
    })
  | (RuntimeMobileSessionTabMoveBase & {
      kind: 'split'
      splitDirection: 'left' | 'right' | 'up' | 'down'
    })

export type RuntimeMobileSessionTabMoveResult = {
  moved: true
}

export type RuntimeMobileSessionTabCloseResult = {
  closed: true
  refused?: true
  refusalReason?:
    | 'missing-intent'
    | 'stale-publication'
    | 'stale-terminal'
    | 'live-host-pty'
    | 'unknown-liveness'
    | 'retirement-owner'
  // Why: only a republished snapshot can restore a live mirror; dead-leaf refusals intentionally omit this marker.
  snapshotRepublished?: true
}

// Why: lets the host tell a user's close from a client-lifecycle echo
// ('pty-exit'/'cleanup') and adjudicate against its own PTY liveness.
// Absent on legacy clients, where the existing close endpoint remains user intent.
export type RuntimeSessionTabCloseReason = 'user' | 'pty-exit' | 'cleanup'

export type RuntimeMobileSessionTabsSnapshot = {
  worktree: string
  publicationEpoch: string
  snapshotVersion: number
  activeGroupId: string | null
  activeTabId: string | null
  activeTabType: 'terminal' | 'markdown' | 'file' | 'browser' | null
  tabGroups?: RuntimeMobileSessionTabGroup[]
  tabGroupLayout?: TabGroupLayoutNode | null
  tabs: RuntimeMobileSessionSnapshotTab[]
}

export type RuntimeMobileSessionTabsResult = {
  worktree: string
  publicationEpoch: string
  snapshotVersion: number
  /** Live-only targeted command; omitted from durable/list snapshots so reconnect cannot replay navigation. */
  navigationIntent?: 'follow'
  activeGroupId: string | null
  activeTabId: string | null
  activeTabType: 'terminal' | 'markdown' | 'file' | 'browser' | null
  tabGroups?: RuntimeMobileSessionTabGroup[]
  tabGroupLayout?: TabGroupLayoutNode | null
  tabs: RuntimeMobileSessionClientTab[]
}

export type RuntimeSessionSnapshot = {
  /** Runtime identity changes whenever the authoritative Host process restarts. */
  hostGeneration: string
  /** Durable state content revision; equal state produces an equal revision. */
  revision: string
  snapshots: RuntimeMobileSessionTabsResult[]
}

export type RuntimeSessionFlushResult = RuntimeSessionSnapshot & {
  flushed: true
}

export type RuntimeMobileSessionCreateTerminalResult = {
  tab: RuntimeMobileSessionTerminalClientTab
  publicationEpoch: string
  snapshotVersion: number
}

export type RuntimeMobileSessionTabsRemovedResult = RuntimeMobileSessionTabsResult & {
  removed: true
  activeGroupId: null
  activeTabId: null
  activeTabType: null
  tabs: []
}
