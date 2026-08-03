import type { ExecutionHostId } from './execution-host'
import type { SleepingAgentSessionRecord } from './agent-session-resume'
import type { TuiAgent } from './types-settings-accounts'
import type { WorkspaceKey } from './types-repository'

// ─── Tab Group Layout ───────────────────────────────────────────────
export type TabGroupSplitDirection = 'horizontal' | 'vertical'

export type TabGroupLayoutNode =
  | { type: 'leaf'; groupId: string }
  | {
      type: 'split'
      direction: TabGroupSplitDirection
      first: TabGroupLayoutNode
      second: TabGroupLayoutNode
      /** Flex ratio of the first child (0–1). Defaults to 0.5 if absent. */
      ratio?: number
    }

// ─── Unified Tab ────────────────────────────────────────────────────
export type TabContentType =
  | 'terminal'
  | 'editor'
  | 'diff'
  | 'conflict-review'
  | 'check-details'
  | 'browser'
  | 'simulator'

export type WorkspaceVisibleTabType = 'terminal' | 'editor' | 'browser' | 'simulator'
export type CtrlTabOrderMode = 'mru' | 'sequential'

export type Tab = {
  id: string // UUID for terminals, filePath for editors (preserves current convention)
  entityId: string // ID of the backing content (terminal tab ID, file path, browser workspace ID)
  groupId: string
  worktreeId: string
  contentType: TabContentType
  label: string // display title (auto-derived from PTY or filename)
  generatedLabel?: string | null
  quickCommandLabel?: string | null
  customLabel: string | null
  color: string | null
  sortOrder: number
  createdAt: number
  isPreview?: boolean // preview tabs get replaced by next single-click open
  isPinned?: boolean // pinned tabs survive "close others"
  /** Why: per-tab rendering mode for coding-agent terminals. `'chat'` shows the
   *  native chat view as an overlay while the live terminal stays mounted
   *  underneath; `'terminal'` (the default for legacy/missing) shows the raw
   *  xterm. Optional so sessions persisted before this field hydrate cleanly. */
  viewMode?: 'terminal' | 'chat'
}

export type TabGroup = {
  id: string
  worktreeId: string
  activeTabId: string | null
  tabOrder: string[] // canonical visual order of tab IDs
  /** Per-group MRU stack (oldest → most-recent at the tail). Drives which tab
   *  becomes active when the current active tab closes: we pop back to the
   *  previously-active tab instead of jumping to a visual neighbor. Scoped to
   *  the group so split panes keep independent histories. Optional because
   *  sessions persisted before this field was added still hydrate cleanly —
   *  hydration seeds from activeTabId. */
  recentTabIds?: string[]
}

// ─── Terminal Tab (legacy — used by persistence and TerminalContentSlice) ─
export type TerminalTab = {
  id: string
  ptyId: string | null
  worktreeId: string
  title: string
  /** Stable fallback label for default-named terminals ("Terminal 1", etc.).
   *  Why: agent CLIs overwrite the live title via OSC updates, but Orca still
   *  needs the original terminal label for numbering and reset behavior. */
  defaultTitle?: string
  /** Stable opt-in label derived from the first known agent prompt. */
  generatedTitle?: string | null
  /** Stable label from the tab-bar Quick Command that created this terminal. */
  quickCommandLabel?: string | null
  customTitle: string | null
  color: string | null
  /** Pinned tabs survive "close others"; host-persisted for remote servers. */
  isPinned?: boolean
  /** Per-tab view preference (terminal xterm vs native chat); host-persisted so
   *  paired clients converge. Optional: older persisted tabs default to 'terminal'. */
  viewMode?: 'terminal' | 'chat'
  sortOrder: number
  createdAt: number
  /** Bumped on shutdown so TerminalPane remounts with a fresh PTY. */
  generation?: number
  /** Why: records the shell this tab was opened with (e.g. 'wsl.exe') so the
   *  PTY and tab icon stay stable even if the default shell setting changes
   *  later. Older persisted tabs may omit this field. */
  shellOverride?: string
  /** Why: explorer-created terminals can start below the workspace root while
   *  still belonging to that workspace for tab/session ownership. */
  startupCwd?: string
  /** Why: the coding-harness agent Orca launched in this tab. Lets the tab bar
   *  show the provider icon immediately, before the agent emits its first hook
   *  event (a freshly-launched, idle agent reports no live status yet). Live
   *  hook status overrides this once the agent does anything. Plain terminals
   *  and manually-started agents omit it. */
  launchAgent?: TuiAgent
  /** Why: when `setActiveWorktree` bumps generation on all-dead tabs to drive a
   *  TerminalPane remount, the fresh PTY that results is caused by navigation,
   *  not by the user doing work. Without this flag the resulting
   *  `updateTabPtyId` call would call `bumpWorktreeActivity` and flip the
   *  sidebar's recency sort on every click — the reorder-on-click bug. The
   *  flag is set by `setActiveWorktree` and consumed by the activation-driven
   *  PTY lifecycle calls that follow, which then suppress activity bumps and
   *  `sortEpoch` increments. Split layouts use a numeric count because one tab
   *  can remount several panes. Never persisted — it is a transient handoff. */
  pendingActivationSpawn?: boolean | number
}

export type BrowserHistoryEntry = {
  url: string
  normalizedUrl: string
  title: string
  lastVisitedAt: number
  visitCount: number
}

export type BrowserLoadError = {
  code: number
  description: string
  validatedUrl: string
}

export type BrowserCertificateFailure = {
  challengeId: string
  browserPageId: string
  errorCode: number | null
  error: string
  origin: string
  displayHost: string
  canProceed: boolean
  observedAt: number
}

export type BrowserCertificateProceedFailureReason =
  | 'expired'
  | 'changed'
  | 'ineligible'
  | 'missing'
  | 'navigated'

export type BrowserCertificateProceedResult =
  | { ok: true }
  | { ok: false; reason: BrowserCertificateProceedFailureReason }

// Why: BrowserPage persists the active viewport preset so CDP emulation can be
// reapplied on reload/navigation without the user re-picking from the toolbar.
export type BrowserViewportPresetId =
  | 'mobile-s'
  | 'mobile-m'
  | 'mobile-l'
  | 'tablet'
  | 'laptop'
  | 'laptop-l'
  | 'desktop'

export type BrowserViewportOverride = {
  width: number
  height: number
  deviceScaleFactor: number
  mobile: boolean
}

export type BrowserPage = {
  id: string
  workspaceId: string
  worktreeId: string
  url: string
  title: string
  loading: boolean
  faviconUrl: string | null
  canGoBack: boolean
  canGoForward: boolean
  loadError: BrowserLoadError | null
  createdAt: number
  // Why: remote-owned worktrees can still host client-local fallback browser
  // pages until headless remote runtimes support real browser panes.
  browserRuntimeEnvironmentId?: string | null
  /** Active CDP viewport emulation preset. null = default (fill pane, no CDP override) */
  viewportPresetId?: BrowserViewportPresetId | null
}

export type BrowserWorkspace = {
  id: string
  worktreeId: string
  /** Stable display label for the outer Orca tab ("Browser 1", "Browser 2", …).
   *  Optional so sessions persisted before this field was added fall back
   *  gracefully to the URL-derived label in getBrowserTabLabel. */
  label?: string
  // Why: each browser workspace binds to exactly one session profile at creation
  // time. The profile determines which Electron partition (and thus which
  // cookies/storage) the guest webview uses. Absent means the legacy shared
  // partition, which keeps backward compat with workspaces persisted before
  // session profiles existed.
  sessionProfileId?: string | null
  // Why: runtime-created tabs resolve profile partition in main. Persisting it
  // keeps isolated storage stable when the renderer profile mirror is stale.
  sessionPartition?: string | null
  activePageId?: string | null
  pageIds?: string[]
  // Why: the active page owns real browser chrome state now, but the top-level
  // Orca tab strip still renders one workspace entry. Mirror the active page's
  // title/url/loading metadata here so existing workspace-level UI can stay
  // stable while Phase 2 introduces nested browser pages.
  url: string
  title: string
  loading: boolean
  faviconUrl: string | null
  canGoBack: boolean
  canGoForward: boolean
  loadError: BrowserLoadError | null
  createdAt: number
}

export type BrowserTab = BrowserWorkspace

export type BrowserSessionProfileScope = 'default' | 'isolated' | 'imported'

export type BrowserSessionProfileSource = {
  browserFamily:
    | 'chrome'
    | 'chromium'
    | 'arc'
    | 'edge'
    | 'firefox'
    | 'safari'
    | 'comet'
    | 'helium'
    | 'manual'
  profileName?: string
  importedAt: number
}

export type BrowserSessionProfile = {
  id: string
  scope: BrowserSessionProfileScope
  partition: string
  label: string
  source: BrowserSessionProfileSource | null
}

export type BrowserCookieImportSummary = {
  totalCookies: number
  importedCookies: number
  skippedCookies: number
  domains: string[]
  warning?: {
    code: 'restart-fallback-unavailable'
    loadedCookies: number
    failedCookies: number
  }
}

export type BrowserCookieImportResult =
  | { ok: true; profileId: string; summary: BrowserCookieImportSummary }
  | { ok: false; reason: string }

export type TerminalPaneSplitDirection = 'vertical' | 'horizontal'

export type TerminalPaneLayoutNode =
  | {
      type: 'leaf'
      leafId: string
    }
  | {
      type: 'split'
      direction: TerminalPaneSplitDirection
      first: TerminalPaneLayoutNode
      second: TerminalPaneLayoutNode
      /** Flex ratio of the first child (0–1). Defaults to 0.5 if absent. */
      ratio?: number
    }

export type TerminalLayoutSnapshot = {
  root: TerminalPaneLayoutNode | null
  activeLeafId: string | null
  expandedLeafId: string | null
  /** Live PTY IDs per leaf for in-session remounts such as tab-group moves.
   *  Not used for app restart because PTYs are transient processes. */
  ptyIdsByLeafId?: Record<string, string>
  /** Serialized terminal buffers per leaf for scrollback restoration on restart. */
  buffersByLeafId?: Record<string, string>
  /** Durable scrollback snapshot refs per leaf; raw bytes live outside session JSON. */
  scrollbackRefsByLeafId?: Record<string, string>
  /** User-assigned pane titles, keyed by stable layout leaf UUID.
   *  Persisted alongside buffers via the existing session:set flow. */
  titlesByLeafId?: Record<string, string>
}

/** Minimal subset of OpenFile persisted across restarts.
 *  Only edit-mode files are saved — diffs, conflict reviews, and other
 *  transient views are reconstructed on demand from git state. */
export type PersistedOpenFile = {
  filePath: string
  relativePath: string
  worktreeId: string
  language: string
  isPreview?: boolean
  runtimeEnvironmentId?: string | null
  /** SSH target that owns an absolute path outside the worktree. */
  externalSshTargetId?: string
  /** Unsaved editor buffer captured for hot exit; presence restores the tab dirty. */
  dirtyDraftContent?: string
  /** Signature of the disk content the dirty draft is based on; lets restore
   *  re-derive a changed-on-disk conflict from ground truth. */
  lastKnownDiskSignature?: string
  /** Why: a read-only tab (AI Vault View Log) must survive restart still
   *  read-only; persisted only when true so old sessions stay writable. */
  readOnly?: boolean
  /** Opt-in streaming append for a read-only local log tab. */
  liveTail?: boolean
}

export type WorkspaceSessionState = {
  activeRepoId: string | null
  /** Scope-aware active owner for folder workspaces. Legacy worktree UI still reads activeWorktreeId. */
  activeWorkspaceKey?: WorkspaceKey | null
  activeWorkspaceExecutionHostId?: ExecutionHostId | null
  activeWorktreeId: string | null
  activeTabId: string | null
  /** Keys may be legacy raw worktree IDs or canonical WorkspaceKey values. */
  tabsByWorktree: Record<string, TerminalTab[]>
  terminalLayoutsByTabId: Record<string, TerminalLayoutSnapshot>
  /** Worktree IDs that had at least one tab with a live PTY at shutdown.
   *  Used on startup to eagerly re-spawn PTY processes so the Active filter
   *  works immediately after restart. */
  activeWorktreeIdsOnShutdown?: string[]
  /** Editor files that were open at shutdown, keyed by worktree ID.
   *  Only edit-mode files are persisted — diffs and conflict views are
   *  transient and not restored. */
  openFilesByWorktree?: Record<string, PersistedOpenFile[]>
  /** Per-worktree active editor file ID (filePath) at shutdown. */
  activeFileIdByWorktree?: Record<string, string | null>
  /** Per-file markdown preview front-matter visibility. Absent entry means hidden. */
  markdownFrontmatterVisible?: Record<string, boolean>
  /** Persisted browser workspaces, keyed by worktree ID. */
  browserTabsByWorktree?: Record<string, BrowserWorkspace[]>
  /** Persisted browser pages, keyed by workspace ID. */
  browserPagesByWorkspace?: Record<string, BrowserPage[]>
  /** Per-worktree active browser workspace ID at shutdown. */
  activeBrowserTabIdByWorktree?: Record<string, string | null>
  /** Per-worktree active tab type (terminal vs editor vs browser) at shutdown. */
  activeTabTypeByWorktree?: Record<string, WorkspaceVisibleTabType>
  /** Global browser URL history for address bar autocomplete. */
  browserUrlHistory?: BrowserHistoryEntry[]
  /** Per-worktree last-active terminal tab ID at shutdown. */
  activeTabIdByWorktree?: Record<string, string | null>
  /** Unified tab model — present when saved by a build that includes TabsSlice.
   *  Read-path checks for this first; falls back to legacy fields if absent. */
  unifiedTabs?: Record<string, Tab[]>
  /** Tab group model — present alongside unifiedTabs. */
  tabGroups?: Record<string, TabGroup[]>
  /** Persisted split layout tree per worktree. */
  tabGroupLayouts?: Record<string, TabGroupLayoutNode>
  /** Per-worktree focused group at shutdown. */
  activeGroupIdByWorktree?: Record<string, string>
  /** SSH target IDs that were connected at shutdown. Used on startup to
   *  auto-reconnect before attempting remote PTY reattach. */
  activeConnectionIdsAtShutdown?: string[]
  /** Maps tab IDs to their remote relay PTY session IDs. Populated at
   *  shutdown from renderer state so remote PTYs can be reattached via
   *  the relay's pty.attach RPC on startup. */
  remoteSessionIdsByTabId?: Record<string, string>
  /** Per-worktree focus-recency timestamps used by the Cmd+J empty-query
   *  ordering. Separate from worktree.lastActivityAt (background signal)
   *  and worktreeNavHistory (Back/Forward stack). See
   *  docs/cmd-j-empty-query-ordering.md. Absent in sessions written by
   *  older builds — hydration tolerates missing/partial maps and the
   *  active worktree is seeded on first restore. */
  lastVisitedAtByWorktreeId?: Record<string, number>
  /** Worktrees whose repo-defined default terminal tabs have already been
   *  considered. Persisted so closing all tabs and re-opening the workspace
   *  does not recreate the template. */
  defaultTerminalTabsAppliedByWorktreeId?: Record<string, true>
  /** Provider-session resume records captured when workspaces sleep. */
  sleepingAgentSessionsByPaneKey?: Record<string, SleepingAgentSessionRecord>
  /** Host-issued process incarnation for each durable terminal surface. */
  terminalPtyIncarnationsByPaneKey?: Record<string, string>
  /** Monotonic host authority watermark for terminal membership in each repo. */
  terminalTopologyRevisionByRepoId?: Record<string, number>
  /** Legacy per-surface fences migrated into terminalTopologyRevisionByRepoId on load. */
  terminalSurfaceTombstonesByPaneKey?: Record<
    string,
    {
      worktreeId: string
      parentTabId: string
      leafId: string
      ptyId: string
      incarnationId: string
      retiredAt: number
    }
  >
}

export type WorkspaceSessionPatch = Partial<WorkspaceSessionState>
