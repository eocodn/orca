import type {
  AgentStatusEntry,
  AgentStatusOrchestrationContext,
  AgentStatusState,
  AgentType
} from './agent-status-types'
import type {
  BaseRefSearchResult,
  BrowserCookieImportResult,
  BrowserCertificateFailure,
  BrowserLoadError,
  BrowserSessionProfile,
  BrowserSessionProfileSource,
  CreateWorktreeResult,
  GitWorktreeInfo,
  RemoveWorktreeResult,
  Repo,
  TabGroupLayoutNode,
  TerminalColorOverrides,
  TerminalLayoutSnapshot,
  TuiAgent,
  Worktree,
  WorktreeLineage,
  WorkspaceLineage,
  WorktreeLineageWarning,
  TerminalPaneLayoutNode
} from './types'
import type {
  RuntimeMarkdownReadTabResult,
  RuntimeMarkdownSaveTabResult
} from './mobile-markdown-document'
import type { RuntimeCapability } from './protocol-version'
import type { RemoteRuntimeSharedConnectionDiagnostics } from './remote-runtime-shared-control-types'
import type {
  AgentProviderSessionMetadata,
  SleepingAgentLaunchConfig
} from './agent-session-resume'
import type { StartupCommandDelivery } from './codex-startup-delivery'
import type { RemoteServerUpdateSupport } from './remote-server-update'
import type { ExecutionHostId } from './execution-host'
import type { PtyIncarnationId } from './pty-incarnation'
import type { RasterImageDimensions } from './raster-image-dimensions'

import type * as SharedRuntimeTypes from "./runtime-types"
type RuntimeGraphStatus = SharedRuntimeTypes.RuntimeGraphStatus; type RuntimeDesktopWindowStatus = SharedRuntimeTypes.RuntimeDesktopWindowStatus; type DeviceScope = SharedRuntimeTypes.DeviceScope; type RuntimeTerminalDriverState = SharedRuntimeTypes.RuntimeTerminalDriverState; type RuntimeBrowserDriverState = SharedRuntimeTypes.RuntimeBrowserDriverState; type RuntimeStatus = SharedRuntimeTypes.RuntimeStatus; type CliRuntimeState = SharedRuntimeTypes.CliRuntimeState; type CliStatusResult = SharedRuntimeTypes.CliStatusResult; type RuntimeSyncedTab = SharedRuntimeTypes.RuntimeSyncedTab; type RuntimeSyncedLeaf = SharedRuntimeTypes.RuntimeSyncedLeaf; type RuntimeSyncWindowGraph = SharedRuntimeTypes.RuntimeSyncWindowGraph; type RuntimeNativeChatLaunchDraftResolution = SharedRuntimeTypes.RuntimeNativeChatLaunchDraftResolution; type RuntimeSyncWindowGraphResult = SharedRuntimeTypes.RuntimeSyncWindowGraphResult; type RuntimeFileListEntry = SharedRuntimeTypes.RuntimeFileListEntry; type RuntimeFileListResult = SharedRuntimeTypes.RuntimeFileListResult; type RuntimeFileOpenResult = SharedRuntimeTypes.RuntimeFileOpenResult; type RuntimeFileReadResult = SharedRuntimeTypes.RuntimeFileReadResult; type RuntimeTerminalPathOpenTarget = SharedRuntimeTypes.RuntimeTerminalPathOpenTarget; type RuntimeTerminalPathResolution = SharedRuntimeTypes.RuntimeTerminalPathResolution; type RuntimeFilePreviewResult = SharedRuntimeTypes.RuntimeFilePreviewResult; type RuntimeFileReadChunkResult = SharedRuntimeTypes.RuntimeFileReadChunkResult; type RuntimeTerminalSummary = SharedRuntimeTypes.RuntimeTerminalSummary; type RuntimeTerminalVisualTerminalNode = SharedRuntimeTypes.RuntimeTerminalVisualTerminalNode; type RuntimeTerminalVisualPaneNode = SharedRuntimeTypes.RuntimeTerminalVisualPaneNode; type RuntimeTerminalVisualTab = SharedRuntimeTypes.RuntimeTerminalVisualTab; type RuntimeTerminalVisualGroupNode = SharedRuntimeTypes.RuntimeTerminalVisualGroupNode; type RuntimeTerminalVisualLayoutNode = SharedRuntimeTypes.RuntimeTerminalVisualLayoutNode; type RuntimeTerminalVisualLayout = SharedRuntimeTypes.RuntimeTerminalVisualLayout; type RuntimeTerminalListResult = SharedRuntimeTypes.RuntimeTerminalListResult; type RuntimeTerminalOrphanAdoptionClaim = SharedRuntimeTypes.RuntimeTerminalOrphanAdoptionClaim; type RuntimeTerminalOrphanTopologyTab = SharedRuntimeTypes.RuntimeTerminalOrphanTopologyTab; type RuntimeTerminalOrphanTopologyGroup = SharedRuntimeTypes.RuntimeTerminalOrphanTopologyGroup; type RuntimeTerminalOrphanTopology = SharedRuntimeTypes.RuntimeTerminalOrphanTopology; type RuntimeTerminalOrphanAdoptionRequest = SharedRuntimeTypes.RuntimeTerminalOrphanAdoptionRequest; type RuntimeTerminalOrphanAdoptionResult = SharedRuntimeTypes.RuntimeTerminalOrphanAdoptionResult; type RuntimeWorktreeTerminalSleepFailure = SharedRuntimeTypes.RuntimeWorktreeTerminalSleepFailure; type RuntimeWorktreeTerminalSleepResult = SharedRuntimeTypes.RuntimeWorktreeTerminalSleepResult; type RuntimeTerminalShow = SharedRuntimeTypes.RuntimeTerminalShow; type RuntimeTerminalInspect = SharedRuntimeTypes.RuntimeTerminalInspect; type RuntimeTerminalResize = SharedRuntimeTypes.RuntimeTerminalResize; type RuntimeTerminalState = SharedRuntimeTypes.RuntimeTerminalState; type RuntimeTerminalRead = SharedRuntimeTypes.RuntimeTerminalRead; type RuntimeTerminalRename = SharedRuntimeTypes.RuntimeTerminalRename; type RuntimeTerminalSend = SharedRuntimeTypes.RuntimeTerminalSend; type RuntimeTerminalAgentStatusState = SharedRuntimeTypes.RuntimeTerminalAgentStatusState; type RuntimeTerminalAgentStatus = SharedRuntimeTypes.RuntimeTerminalAgentStatus; type RuntimeTerminalPresentation = SharedRuntimeTypes.RuntimeTerminalPresentation; type RuntimeTerminalCreateRequestPayload = SharedRuntimeTypes.RuntimeTerminalCreateRequestPayload; type RuntimeTerminalCreate = SharedRuntimeTypes.RuntimeTerminalCreate; type RuntimeTerminalSplit = SharedRuntimeTypes.RuntimeTerminalSplit; type RuntimeTerminalResolvePane = SharedRuntimeTypes.RuntimeTerminalResolvePane; type RuntimeTerminalFocus = SharedRuntimeTypes.RuntimeTerminalFocus; type RuntimeTerminalClose = SharedRuntimeTypes.RuntimeTerminalClose; type RuntimeTerminalWaitCondition = SharedRuntimeTypes.RuntimeTerminalWaitCondition; type RuntimeTerminalWaitBlockedReason = SharedRuntimeTypes.RuntimeTerminalWaitBlockedReason; type RuntimeTerminalWait = SharedRuntimeTypes.RuntimeTerminalWait; type RuntimeWorktreeAgentRow = SharedRuntimeTypes.RuntimeWorktreeAgentRow; type RuntimeWorktreePsSummary = SharedRuntimeTypes.RuntimeWorktreePsSummary; type RuntimeGitLocalBranches = SharedRuntimeTypes.RuntimeGitLocalBranches; type RuntimeSpeechModelSummary = SharedRuntimeTypes.RuntimeSpeechModelSummary; type RuntimeSpeechSetupState = SharedRuntimeTypes.RuntimeSpeechSetupState; type RuntimeGitCheckoutResult = SharedRuntimeTypes.RuntimeGitCheckoutResult; type RuntimeWorktreeStatus = SharedRuntimeTypes.RuntimeWorktreeStatus; type RuntimeWorktreeRecord = SharedRuntimeTypes.RuntimeWorktreeRecord; type RuntimeWorktreeCreateResult = SharedRuntimeTypes.RuntimeWorktreeCreateResult; type RuntimeWorktreeRemoveResult = SharedRuntimeTypes.RuntimeWorktreeRemoveResult; type RuntimeWorktreePsResult = SharedRuntimeTypes.RuntimeWorktreePsResult; type RuntimeRepoList = SharedRuntimeTypes.RuntimeRepoList; type RuntimeRepoSearchRefs = SharedRuntimeTypes.RuntimeRepoSearchRefs; type RuntimeWorktreeListResult = SharedRuntimeTypes.RuntimeWorktreeListResult; type BrowserSnapshotRef = SharedRuntimeTypes.BrowserSnapshotRef; type BrowserSnapshotResult = SharedRuntimeTypes.BrowserSnapshotResult; type BrowserClickResult = SharedRuntimeTypes.BrowserClickResult; type BrowserGotoResult = SharedRuntimeTypes.BrowserGotoResult; type BrowserFillResult = SharedRuntimeTypes.BrowserFillResult; type BrowserTypeResult = SharedRuntimeTypes.BrowserTypeResult; type BrowserSelectResult = SharedRuntimeTypes.BrowserSelectResult; type BrowserScrollResult = SharedRuntimeTypes.BrowserScrollResult; type BrowserBackResult = SharedRuntimeTypes.BrowserBackResult; type BrowserReloadResult = SharedRuntimeTypes.BrowserReloadResult; type BrowserScreenshotResult = SharedRuntimeTypes.BrowserScreenshotResult; type BrowserScreencastReadyResult = SharedRuntimeTypes.BrowserScreencastReadyResult; type BrowserScreencastEndResult = SharedRuntimeTypes.BrowserScreencastEndResult; type BrowserScreencastDialogResult = SharedRuntimeTypes.BrowserScreencastDialogResult; type BrowserScreencastDialogClosedResult = SharedRuntimeTypes.BrowserScreencastDialogClosedResult; type BrowserScreencastErrorResult = SharedRuntimeTypes.BrowserScreencastErrorResult; type BrowserScreencastResult = SharedRuntimeTypes.BrowserScreencastResult; type BrowserEvalResult = SharedRuntimeTypes.BrowserEvalResult; type BrowserTabInfo = SharedRuntimeTypes.BrowserTabInfo; type BrowserTabListResult = SharedRuntimeTypes.BrowserTabListResult; type BrowserTabSwitchResult = SharedRuntimeTypes.BrowserTabSwitchResult; type BrowserTabSetProfileResult = SharedRuntimeTypes.BrowserTabSetProfileResult; type BrowserTabShowResult = SharedRuntimeTypes.BrowserTabShowResult; type BrowserTabCurrentResult = SharedRuntimeTypes.BrowserTabCurrentResult; type BrowserTabProfileShowResult = SharedRuntimeTypes.BrowserTabProfileShowResult; type BrowserTabProfileCloneResult = SharedRuntimeTypes.BrowserTabProfileCloneResult; type BrowserProfileListResult = SharedRuntimeTypes.BrowserProfileListResult; type BrowserProfileCreateResult = SharedRuntimeTypes.BrowserProfileCreateResult; type BrowserProfileDeleteResult = SharedRuntimeTypes.BrowserProfileDeleteResult; type BrowserDetectedProfileInfo = SharedRuntimeTypes.BrowserDetectedProfileInfo; type BrowserDetectedInfo = SharedRuntimeTypes.BrowserDetectedInfo; type BrowserDetectProfilesResult = SharedRuntimeTypes.BrowserDetectProfilesResult; type BrowserProfileImportFromBrowserResult = SharedRuntimeTypes.BrowserProfileImportFromBrowserResult; type BrowserProfileClearDefaultCookiesResult = SharedRuntimeTypes.BrowserProfileClearDefaultCookiesResult; type BrowserHoverResult = SharedRuntimeTypes.BrowserHoverResult; type BrowserDragResult = SharedRuntimeTypes.BrowserDragResult; type BrowserUploadResult = SharedRuntimeTypes.BrowserUploadResult; type BrowserWaitResult = SharedRuntimeTypes.BrowserWaitResult; type BrowserCheckResult = SharedRuntimeTypes.BrowserCheckResult; type BrowserFocusResult = SharedRuntimeTypes.BrowserFocusResult; type BrowserClearResult = SharedRuntimeTypes.BrowserClearResult; type BrowserSelectAllResult = SharedRuntimeTypes.BrowserSelectAllResult; type BrowserKeypressResult = SharedRuntimeTypes.BrowserKeypressResult; type BrowserPdfResult = SharedRuntimeTypes.BrowserPdfResult; type BrowserCookie = SharedRuntimeTypes.BrowserCookie; type BrowserCookieGetResult = SharedRuntimeTypes.BrowserCookieGetResult; type BrowserCookieSetResult = SharedRuntimeTypes.BrowserCookieSetResult; type BrowserCookieDeleteResult = SharedRuntimeTypes.BrowserCookieDeleteResult; type BrowserViewportResult = SharedRuntimeTypes.BrowserViewportResult; type BrowserGeolocationResult = SharedRuntimeTypes.BrowserGeolocationResult; type BrowserInterceptedRequest = SharedRuntimeTypes.BrowserInterceptedRequest; type BrowserInterceptEnableResult = SharedRuntimeTypes.BrowserInterceptEnableResult; type BrowserInterceptDisableResult = SharedRuntimeTypes.BrowserInterceptDisableResult; type BrowserConsoleEntry = SharedRuntimeTypes.BrowserConsoleEntry; type BrowserConsoleResult = SharedRuntimeTypes.BrowserConsoleResult; type BrowserNetworkEntry = SharedRuntimeTypes.BrowserNetworkEntry; type BrowserNetworkLogResult = SharedRuntimeTypes.BrowserNetworkLogResult; type BrowserCaptureStartResult = SharedRuntimeTypes.BrowserCaptureStartResult; type BrowserCaptureStopResult = SharedRuntimeTypes.BrowserCaptureStopResult; type BrowserExecResult = SharedRuntimeTypes.BrowserExecResult; type BrowserTabCreateResult = SharedRuntimeTypes.BrowserTabCreateResult; type BrowserTabCloseResult = SharedRuntimeTypes.BrowserTabCloseResult; type BrowserErrorCode = SharedRuntimeTypes.BrowserErrorCode; type EmulatorErrorCode = SharedRuntimeTypes.EmulatorErrorCode;

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

