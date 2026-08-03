import type { AgentStatusOrchestrationContext } from './agent-status-types'
import type { TerminalPaneLayoutNode } from './types'
import type {
  RuntimeMarkdownReadTabResult,
  RuntimeMarkdownSaveTabResult
} from './mobile-markdown-document'
import type { RuntimeCapability } from './protocol-version'
import type { RemoteRuntimeSharedConnectionDiagnostics } from './remote-runtime-shared-control-types'
import type { RemoteServerUpdateSupport } from './remote-server-update'

import type * as SharedRuntimeTypes from "./runtime-types"
type RuntimeMobileSessionTerminalTab = SharedRuntimeTypes.RuntimeMobileSessionTerminalTab; type RuntimeMobileTerminalTheme = SharedRuntimeTypes.RuntimeMobileTerminalTheme; type RuntimeMobileSessionMarkdownTab = SharedRuntimeTypes.RuntimeMobileSessionMarkdownTab; type RuntimeMobileSessionFileTab = SharedRuntimeTypes.RuntimeMobileSessionFileTab; type RuntimeMobileSessionBrowserTab = SharedRuntimeTypes.RuntimeMobileSessionBrowserTab; type RuntimeMobileSessionSnapshotTab = SharedRuntimeTypes.RuntimeMobileSessionSnapshotTab; type RuntimeMobileSessionTerminalClientTab = SharedRuntimeTypes.RuntimeMobileSessionTerminalClientTab; type RuntimeMobileSessionClientTab = SharedRuntimeTypes.RuntimeMobileSessionClientTab; type RuntimeMobileSessionTabGroup = SharedRuntimeTypes.RuntimeMobileSessionTabGroup; type RuntimeMobileSessionTabMove = SharedRuntimeTypes.RuntimeMobileSessionTabMove; type RuntimeMobileSessionTabMoveResult = SharedRuntimeTypes.RuntimeMobileSessionTabMoveResult; type RuntimeMobileSessionTabCloseResult = SharedRuntimeTypes.RuntimeMobileSessionTabCloseResult; type RuntimeSessionTabCloseReason = SharedRuntimeTypes.RuntimeSessionTabCloseReason; type RuntimeMobileSessionTabsSnapshot = SharedRuntimeTypes.RuntimeMobileSessionTabsSnapshot; type RuntimeMobileSessionTabsResult = SharedRuntimeTypes.RuntimeMobileSessionTabsResult; type RuntimeSessionSnapshot = SharedRuntimeTypes.RuntimeSessionSnapshot; type RuntimeSessionFlushResult = SharedRuntimeTypes.RuntimeSessionFlushResult; type RuntimeMobileSessionCreateTerminalResult = SharedRuntimeTypes.RuntimeMobileSessionCreateTerminalResult; type RuntimeMobileSessionTabsRemovedResult = SharedRuntimeTypes.RuntimeMobileSessionTabsRemovedResult; type RuntimeFileListEntry = SharedRuntimeTypes.RuntimeFileListEntry; type RuntimeFileListResult = SharedRuntimeTypes.RuntimeFileListResult; type RuntimeFileOpenResult = SharedRuntimeTypes.RuntimeFileOpenResult; type RuntimeFileReadResult = SharedRuntimeTypes.RuntimeFileReadResult; type RuntimeTerminalPathOpenTarget = SharedRuntimeTypes.RuntimeTerminalPathOpenTarget; type RuntimeTerminalPathResolution = SharedRuntimeTypes.RuntimeTerminalPathResolution; type RuntimeFilePreviewResult = SharedRuntimeTypes.RuntimeFilePreviewResult; type RuntimeFileReadChunkResult = SharedRuntimeTypes.RuntimeFileReadChunkResult; type RuntimeTerminalSummary = SharedRuntimeTypes.RuntimeTerminalSummary; type RuntimeTerminalVisualTerminalNode = SharedRuntimeTypes.RuntimeTerminalVisualTerminalNode; type RuntimeTerminalVisualPaneNode = SharedRuntimeTypes.RuntimeTerminalVisualPaneNode; type RuntimeTerminalVisualTab = SharedRuntimeTypes.RuntimeTerminalVisualTab; type RuntimeTerminalVisualGroupNode = SharedRuntimeTypes.RuntimeTerminalVisualGroupNode; type RuntimeTerminalVisualLayoutNode = SharedRuntimeTypes.RuntimeTerminalVisualLayoutNode; type RuntimeTerminalVisualLayout = SharedRuntimeTypes.RuntimeTerminalVisualLayout; type RuntimeTerminalListResult = SharedRuntimeTypes.RuntimeTerminalListResult; type RuntimeTerminalOrphanAdoptionClaim = SharedRuntimeTypes.RuntimeTerminalOrphanAdoptionClaim; type RuntimeTerminalOrphanTopologyTab = SharedRuntimeTypes.RuntimeTerminalOrphanTopologyTab; type RuntimeTerminalOrphanTopologyGroup = SharedRuntimeTypes.RuntimeTerminalOrphanTopologyGroup; type RuntimeTerminalOrphanTopology = SharedRuntimeTypes.RuntimeTerminalOrphanTopology; type RuntimeTerminalOrphanAdoptionRequest = SharedRuntimeTypes.RuntimeTerminalOrphanAdoptionRequest; type RuntimeTerminalOrphanAdoptionResult = SharedRuntimeTypes.RuntimeTerminalOrphanAdoptionResult; type RuntimeWorktreeTerminalSleepFailure = SharedRuntimeTypes.RuntimeWorktreeTerminalSleepFailure; type RuntimeWorktreeTerminalSleepResult = SharedRuntimeTypes.RuntimeWorktreeTerminalSleepResult; type RuntimeTerminalShow = SharedRuntimeTypes.RuntimeTerminalShow; type RuntimeTerminalInspect = SharedRuntimeTypes.RuntimeTerminalInspect; type RuntimeTerminalResize = SharedRuntimeTypes.RuntimeTerminalResize; type RuntimeTerminalState = SharedRuntimeTypes.RuntimeTerminalState; type RuntimeTerminalRead = SharedRuntimeTypes.RuntimeTerminalRead; type RuntimeTerminalRename = SharedRuntimeTypes.RuntimeTerminalRename; type RuntimeTerminalSend = SharedRuntimeTypes.RuntimeTerminalSend; type RuntimeTerminalAgentStatusState = SharedRuntimeTypes.RuntimeTerminalAgentStatusState; type RuntimeTerminalAgentStatus = SharedRuntimeTypes.RuntimeTerminalAgentStatus; type RuntimeTerminalPresentation = SharedRuntimeTypes.RuntimeTerminalPresentation; type RuntimeTerminalCreateRequestPayload = SharedRuntimeTypes.RuntimeTerminalCreateRequestPayload; type RuntimeTerminalCreate = SharedRuntimeTypes.RuntimeTerminalCreate; type RuntimeTerminalSplit = SharedRuntimeTypes.RuntimeTerminalSplit; type RuntimeTerminalResolvePane = SharedRuntimeTypes.RuntimeTerminalResolvePane; type RuntimeTerminalFocus = SharedRuntimeTypes.RuntimeTerminalFocus; type RuntimeTerminalClose = SharedRuntimeTypes.RuntimeTerminalClose; type RuntimeTerminalWaitCondition = SharedRuntimeTypes.RuntimeTerminalWaitCondition; type RuntimeTerminalWaitBlockedReason = SharedRuntimeTypes.RuntimeTerminalWaitBlockedReason; type RuntimeTerminalWait = SharedRuntimeTypes.RuntimeTerminalWait; type RuntimeWorktreeAgentRow = SharedRuntimeTypes.RuntimeWorktreeAgentRow; type RuntimeWorktreePsSummary = SharedRuntimeTypes.RuntimeWorktreePsSummary; type RuntimeGitLocalBranches = SharedRuntimeTypes.RuntimeGitLocalBranches; type RuntimeSpeechModelSummary = SharedRuntimeTypes.RuntimeSpeechModelSummary; type RuntimeSpeechSetupState = SharedRuntimeTypes.RuntimeSpeechSetupState; type RuntimeGitCheckoutResult = SharedRuntimeTypes.RuntimeGitCheckoutResult; type RuntimeWorktreeStatus = SharedRuntimeTypes.RuntimeWorktreeStatus; type RuntimeWorktreeRecord = SharedRuntimeTypes.RuntimeWorktreeRecord; type RuntimeWorktreeCreateResult = SharedRuntimeTypes.RuntimeWorktreeCreateResult; type RuntimeWorktreeRemoveResult = SharedRuntimeTypes.RuntimeWorktreeRemoveResult; type RuntimeWorktreePsResult = SharedRuntimeTypes.RuntimeWorktreePsResult; type RuntimeRepoList = SharedRuntimeTypes.RuntimeRepoList; type RuntimeRepoSearchRefs = SharedRuntimeTypes.RuntimeRepoSearchRefs; type RuntimeWorktreeListResult = SharedRuntimeTypes.RuntimeWorktreeListResult; type BrowserSnapshotRef = SharedRuntimeTypes.BrowserSnapshotRef; type BrowserSnapshotResult = SharedRuntimeTypes.BrowserSnapshotResult; type BrowserClickResult = SharedRuntimeTypes.BrowserClickResult; type BrowserGotoResult = SharedRuntimeTypes.BrowserGotoResult; type BrowserFillResult = SharedRuntimeTypes.BrowserFillResult; type BrowserTypeResult = SharedRuntimeTypes.BrowserTypeResult; type BrowserSelectResult = SharedRuntimeTypes.BrowserSelectResult; type BrowserScrollResult = SharedRuntimeTypes.BrowserScrollResult; type BrowserBackResult = SharedRuntimeTypes.BrowserBackResult; type BrowserReloadResult = SharedRuntimeTypes.BrowserReloadResult; type BrowserScreenshotResult = SharedRuntimeTypes.BrowserScreenshotResult; type BrowserScreencastReadyResult = SharedRuntimeTypes.BrowserScreencastReadyResult; type BrowserScreencastEndResult = SharedRuntimeTypes.BrowserScreencastEndResult; type BrowserScreencastDialogResult = SharedRuntimeTypes.BrowserScreencastDialogResult; type BrowserScreencastDialogClosedResult = SharedRuntimeTypes.BrowserScreencastDialogClosedResult; type BrowserScreencastErrorResult = SharedRuntimeTypes.BrowserScreencastErrorResult; type BrowserScreencastResult = SharedRuntimeTypes.BrowserScreencastResult; type BrowserEvalResult = SharedRuntimeTypes.BrowserEvalResult; type BrowserTabInfo = SharedRuntimeTypes.BrowserTabInfo; type BrowserTabListResult = SharedRuntimeTypes.BrowserTabListResult; type BrowserTabSwitchResult = SharedRuntimeTypes.BrowserTabSwitchResult; type BrowserTabSetProfileResult = SharedRuntimeTypes.BrowserTabSetProfileResult; type BrowserTabShowResult = SharedRuntimeTypes.BrowserTabShowResult; type BrowserTabCurrentResult = SharedRuntimeTypes.BrowserTabCurrentResult; type BrowserTabProfileShowResult = SharedRuntimeTypes.BrowserTabProfileShowResult; type BrowserTabProfileCloneResult = SharedRuntimeTypes.BrowserTabProfileCloneResult; type BrowserProfileListResult = SharedRuntimeTypes.BrowserProfileListResult; type BrowserProfileCreateResult = SharedRuntimeTypes.BrowserProfileCreateResult; type BrowserProfileDeleteResult = SharedRuntimeTypes.BrowserProfileDeleteResult; type BrowserDetectedProfileInfo = SharedRuntimeTypes.BrowserDetectedProfileInfo; type BrowserDetectedInfo = SharedRuntimeTypes.BrowserDetectedInfo; type BrowserDetectProfilesResult = SharedRuntimeTypes.BrowserDetectProfilesResult; type BrowserProfileImportFromBrowserResult = SharedRuntimeTypes.BrowserProfileImportFromBrowserResult; type BrowserProfileClearDefaultCookiesResult = SharedRuntimeTypes.BrowserProfileClearDefaultCookiesResult; type BrowserHoverResult = SharedRuntimeTypes.BrowserHoverResult; type BrowserDragResult = SharedRuntimeTypes.BrowserDragResult; type BrowserUploadResult = SharedRuntimeTypes.BrowserUploadResult; type BrowserWaitResult = SharedRuntimeTypes.BrowserWaitResult; type BrowserCheckResult = SharedRuntimeTypes.BrowserCheckResult; type BrowserFocusResult = SharedRuntimeTypes.BrowserFocusResult; type BrowserClearResult = SharedRuntimeTypes.BrowserClearResult; type BrowserSelectAllResult = SharedRuntimeTypes.BrowserSelectAllResult; type BrowserKeypressResult = SharedRuntimeTypes.BrowserKeypressResult; type BrowserPdfResult = SharedRuntimeTypes.BrowserPdfResult; type BrowserCookie = SharedRuntimeTypes.BrowserCookie; type BrowserCookieGetResult = SharedRuntimeTypes.BrowserCookieGetResult; type BrowserCookieSetResult = SharedRuntimeTypes.BrowserCookieSetResult; type BrowserCookieDeleteResult = SharedRuntimeTypes.BrowserCookieDeleteResult; type BrowserViewportResult = SharedRuntimeTypes.BrowserViewportResult; type BrowserGeolocationResult = SharedRuntimeTypes.BrowserGeolocationResult; type BrowserInterceptedRequest = SharedRuntimeTypes.BrowserInterceptedRequest; type BrowserInterceptEnableResult = SharedRuntimeTypes.BrowserInterceptEnableResult; type BrowserInterceptDisableResult = SharedRuntimeTypes.BrowserInterceptDisableResult; type BrowserConsoleEntry = SharedRuntimeTypes.BrowserConsoleEntry; type BrowserConsoleResult = SharedRuntimeTypes.BrowserConsoleResult; type BrowserNetworkEntry = SharedRuntimeTypes.BrowserNetworkEntry; type BrowserNetworkLogResult = SharedRuntimeTypes.BrowserNetworkLogResult; type BrowserCaptureStartResult = SharedRuntimeTypes.BrowserCaptureStartResult; type BrowserCaptureStopResult = SharedRuntimeTypes.BrowserCaptureStopResult; type BrowserExecResult = SharedRuntimeTypes.BrowserExecResult; type BrowserTabCreateResult = SharedRuntimeTypes.BrowserTabCreateResult; type BrowserTabCloseResult = SharedRuntimeTypes.BrowserTabCloseResult; type BrowserErrorCode = SharedRuntimeTypes.BrowserErrorCode; type EmulatorErrorCode = SharedRuntimeTypes.EmulatorErrorCode;

export type { RuntimeMarkdownReadTabResult, RuntimeMarkdownSaveTabResult }

export type RuntimeGraphStatus = 'ready' | 'reloading' | 'unavailable'

export type RuntimeDesktopWindowStatus = 'available' | 'openable' | 'initializing' | 'blocked'

// Why: headless serve still owns one runtime graph, but zero can never collide
// with Electron BrowserWindow ids and can be transferred safely on promotion.
export const HEADLESS_RUNTIME_WINDOW_ID = 0

// Why: the access scope a paired device token grants. Lives in shared so
// pairing offers, status.get, and the device registry use one vocabulary.
export type DeviceScope = 'mobile' | 'runtime'

// Why: presence-lock driver state crosses main/preload/renderer IPC. Keep one
// checked source so future variants cannot drift silently across layers.
export type RuntimeTerminalDriverState =
  | { kind: 'idle' }
  | { kind: 'desktop' }
  | { kind: 'mobile'; clientId: string }

export type RuntimeBrowserDriverState = RuntimeTerminalDriverState

export type RuntimeStatus = {
  runtimeId: string
  rendererGraphEpoch: number
  graphStatus: RuntimeGraphStatus
  authoritativeWindowId: number | null
  desktopWindowStatus?: RuntimeDesktopWindowStatus
  liveTabCount: number
  liveLeafCount: number
  // Why: optional so clients can read both new and pre-contract runtimes.
  // Absence is treated as protocol 0 by the compat evaluator.
  runtimeProtocolVersion?: number
  minCompatibleRuntimeClientVersion?: number
  capabilities?: RuntimeCapability[]
  // Why: optional fields let updated clients inventory both new and legacy paired servers.
  appVersion?: string
  remoteUpdateSupport?: RemoteServerUpdateSupport
  remoteControl?: RemoteRuntimeSharedConnectionDiagnostics | null
  hostPlatform?: NodeJS.Platform
  terminalWindowsShell?: string | null
  // Why: legacy or saved WebSocket pairings may not carry scope metadata, so
  // the server stamps the authenticated token scope here for status.get only.
  deviceScope?: DeviceScope
  // Why: mobile gates its Floating Workspace entry on this; absent on older
  // hosts, false when the user disabled the feature in desktop settings.
  floatingWorkspaceEnabled?: boolean
  // COMPAT(runtimeStatusMobileAliases): added 2026-05-15 for mobile builds
  // that still read these names; new desktop/CLI code uses the fields above.
  protocolVersion?: number
  minCompatibleMobileVersion?: number
}

export type CliRuntimeState =
  | 'not_running'
  | 'starting'
  | 'ready'
  | 'graph_not_ready'
  | 'stale_bootstrap'

export type CliStatusResult = {
  app: {
    running: boolean
    pid: number | null
    desktopWindowStatus?: RuntimeDesktopWindowStatus
  }
  runtime: {
    state: CliRuntimeState
    reachable: boolean
    runtimeId: string | null
    appVersion?: string
    remoteUpdateSupport?: RemoteServerUpdateSupport
    capabilities?: RuntimeCapability[]
  }
  graph: {
    state: RuntimeGraphStatus | 'not_running' | 'starting'
  }
}

export type RuntimeSyncedTab = {
  tabId: string
  worktreeId: string
  title: string | null
  activeLeafId: string | null
  layout: TerminalPaneLayoutNode | null
}

export type RuntimeSyncedLeaf = {
  tabId: string
  worktreeId: string
  leafId: string
  paneRuntimeId: number
  ptyId: string | null
  paneTitle?: string | null
  title?: string | null
}

export type RuntimeSyncWindowGraph = {
  tabs: RuntimeSyncedTab[]
  leaves: RuntimeSyncedLeaf[]
  mobileSessionTabs?: RuntimeMobileSessionTabsSnapshot[]
}

export type RuntimeNativeChatLaunchDraftResolution = {
  tabId: string
  text: string
  createdAt: number
}

export type RuntimeSyncWindowGraphResult = RuntimeStatus & {
  /** Main owns terminal handles/dispatches, so renderer graph sync returns the
   *  parent metadata needed by title-derived agent rows without name guessing. */
  agentOrchestrationByPaneKey?: Record<string, AgentStatusOrchestrationContext>
  nativeChatLaunchDraftResolutions?: RuntimeNativeChatLaunchDraftResolution[]
}
