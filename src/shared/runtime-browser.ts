import type {
  BrowserCookieImportResult,
  BrowserCertificateFailure,
  BrowserLoadError,
  BrowserSessionProfile,
  BrowserSessionProfileSource
} from './types'

import type * as SharedRuntimeTypes from "./runtime-types"
type RuntimeGraphStatus = SharedRuntimeTypes.RuntimeGraphStatus; type RuntimeDesktopWindowStatus = SharedRuntimeTypes.RuntimeDesktopWindowStatus; type DeviceScope = SharedRuntimeTypes.DeviceScope; type RuntimeTerminalDriverState = SharedRuntimeTypes.RuntimeTerminalDriverState; type RuntimeBrowserDriverState = SharedRuntimeTypes.RuntimeBrowserDriverState; type RuntimeStatus = SharedRuntimeTypes.RuntimeStatus; type CliRuntimeState = SharedRuntimeTypes.CliRuntimeState; type CliStatusResult = SharedRuntimeTypes.CliStatusResult; type RuntimeSyncedTab = SharedRuntimeTypes.RuntimeSyncedTab; type RuntimeSyncedLeaf = SharedRuntimeTypes.RuntimeSyncedLeaf; type RuntimeSyncWindowGraph = SharedRuntimeTypes.RuntimeSyncWindowGraph; type RuntimeNativeChatLaunchDraftResolution = SharedRuntimeTypes.RuntimeNativeChatLaunchDraftResolution; type RuntimeSyncWindowGraphResult = SharedRuntimeTypes.RuntimeSyncWindowGraphResult; type RuntimeMobileSessionTerminalTab = SharedRuntimeTypes.RuntimeMobileSessionTerminalTab; type RuntimeMobileTerminalTheme = SharedRuntimeTypes.RuntimeMobileTerminalTheme; type RuntimeMobileSessionMarkdownTab = SharedRuntimeTypes.RuntimeMobileSessionMarkdownTab; type RuntimeMobileSessionFileTab = SharedRuntimeTypes.RuntimeMobileSessionFileTab; type RuntimeMobileSessionBrowserTab = SharedRuntimeTypes.RuntimeMobileSessionBrowserTab; type RuntimeMobileSessionSnapshotTab = SharedRuntimeTypes.RuntimeMobileSessionSnapshotTab; type RuntimeMobileSessionTerminalClientTab = SharedRuntimeTypes.RuntimeMobileSessionTerminalClientTab; type RuntimeMobileSessionClientTab = SharedRuntimeTypes.RuntimeMobileSessionClientTab; type RuntimeMobileSessionTabGroup = SharedRuntimeTypes.RuntimeMobileSessionTabGroup; type RuntimeMobileSessionTabMove = SharedRuntimeTypes.RuntimeMobileSessionTabMove; type RuntimeMobileSessionTabMoveResult = SharedRuntimeTypes.RuntimeMobileSessionTabMoveResult; type RuntimeMobileSessionTabCloseResult = SharedRuntimeTypes.RuntimeMobileSessionTabCloseResult; type RuntimeSessionTabCloseReason = SharedRuntimeTypes.RuntimeSessionTabCloseReason; type RuntimeMobileSessionTabsSnapshot = SharedRuntimeTypes.RuntimeMobileSessionTabsSnapshot; type RuntimeMobileSessionTabsResult = SharedRuntimeTypes.RuntimeMobileSessionTabsResult; type RuntimeSessionSnapshot = SharedRuntimeTypes.RuntimeSessionSnapshot; type RuntimeSessionFlushResult = SharedRuntimeTypes.RuntimeSessionFlushResult; type RuntimeMobileSessionCreateTerminalResult = SharedRuntimeTypes.RuntimeMobileSessionCreateTerminalResult; type RuntimeMobileSessionTabsRemovedResult = SharedRuntimeTypes.RuntimeMobileSessionTabsRemovedResult; type RuntimeFileListEntry = SharedRuntimeTypes.RuntimeFileListEntry; type RuntimeFileListResult = SharedRuntimeTypes.RuntimeFileListResult; type RuntimeFileOpenResult = SharedRuntimeTypes.RuntimeFileOpenResult; type RuntimeFileReadResult = SharedRuntimeTypes.RuntimeFileReadResult; type RuntimeTerminalPathOpenTarget = SharedRuntimeTypes.RuntimeTerminalPathOpenTarget; type RuntimeTerminalPathResolution = SharedRuntimeTypes.RuntimeTerminalPathResolution; type RuntimeFilePreviewResult = SharedRuntimeTypes.RuntimeFilePreviewResult; type RuntimeFileReadChunkResult = SharedRuntimeTypes.RuntimeFileReadChunkResult; type RuntimeTerminalSummary = SharedRuntimeTypes.RuntimeTerminalSummary; type RuntimeTerminalVisualTerminalNode = SharedRuntimeTypes.RuntimeTerminalVisualTerminalNode; type RuntimeTerminalVisualPaneNode = SharedRuntimeTypes.RuntimeTerminalVisualPaneNode; type RuntimeTerminalVisualTab = SharedRuntimeTypes.RuntimeTerminalVisualTab; type RuntimeTerminalVisualGroupNode = SharedRuntimeTypes.RuntimeTerminalVisualGroupNode; type RuntimeTerminalVisualLayoutNode = SharedRuntimeTypes.RuntimeTerminalVisualLayoutNode; type RuntimeTerminalVisualLayout = SharedRuntimeTypes.RuntimeTerminalVisualLayout; type RuntimeTerminalListResult = SharedRuntimeTypes.RuntimeTerminalListResult; type RuntimeTerminalOrphanAdoptionClaim = SharedRuntimeTypes.RuntimeTerminalOrphanAdoptionClaim; type RuntimeTerminalOrphanTopologyTab = SharedRuntimeTypes.RuntimeTerminalOrphanTopologyTab; type RuntimeTerminalOrphanTopologyGroup = SharedRuntimeTypes.RuntimeTerminalOrphanTopologyGroup; type RuntimeTerminalOrphanTopology = SharedRuntimeTypes.RuntimeTerminalOrphanTopology; type RuntimeTerminalOrphanAdoptionRequest = SharedRuntimeTypes.RuntimeTerminalOrphanAdoptionRequest; type RuntimeTerminalOrphanAdoptionResult = SharedRuntimeTypes.RuntimeTerminalOrphanAdoptionResult; type RuntimeWorktreeTerminalSleepFailure = SharedRuntimeTypes.RuntimeWorktreeTerminalSleepFailure; type RuntimeWorktreeTerminalSleepResult = SharedRuntimeTypes.RuntimeWorktreeTerminalSleepResult; type RuntimeTerminalShow = SharedRuntimeTypes.RuntimeTerminalShow; type RuntimeTerminalInspect = SharedRuntimeTypes.RuntimeTerminalInspect; type RuntimeTerminalResize = SharedRuntimeTypes.RuntimeTerminalResize; type RuntimeTerminalState = SharedRuntimeTypes.RuntimeTerminalState; type RuntimeTerminalRead = SharedRuntimeTypes.RuntimeTerminalRead; type RuntimeTerminalRename = SharedRuntimeTypes.RuntimeTerminalRename; type RuntimeTerminalSend = SharedRuntimeTypes.RuntimeTerminalSend; type RuntimeTerminalAgentStatusState = SharedRuntimeTypes.RuntimeTerminalAgentStatusState; type RuntimeTerminalAgentStatus = SharedRuntimeTypes.RuntimeTerminalAgentStatus; type RuntimeTerminalPresentation = SharedRuntimeTypes.RuntimeTerminalPresentation; type RuntimeTerminalCreateRequestPayload = SharedRuntimeTypes.RuntimeTerminalCreateRequestPayload; type RuntimeTerminalCreate = SharedRuntimeTypes.RuntimeTerminalCreate; type RuntimeTerminalSplit = SharedRuntimeTypes.RuntimeTerminalSplit; type RuntimeTerminalResolvePane = SharedRuntimeTypes.RuntimeTerminalResolvePane; type RuntimeTerminalFocus = SharedRuntimeTypes.RuntimeTerminalFocus; type RuntimeTerminalClose = SharedRuntimeTypes.RuntimeTerminalClose; type RuntimeTerminalWaitCondition = SharedRuntimeTypes.RuntimeTerminalWaitCondition; type RuntimeTerminalWaitBlockedReason = SharedRuntimeTypes.RuntimeTerminalWaitBlockedReason; type RuntimeTerminalWait = SharedRuntimeTypes.RuntimeTerminalWait; type RuntimeWorktreeAgentRow = SharedRuntimeTypes.RuntimeWorktreeAgentRow; type RuntimeWorktreePsSummary = SharedRuntimeTypes.RuntimeWorktreePsSummary; type RuntimeGitLocalBranches = SharedRuntimeTypes.RuntimeGitLocalBranches; type RuntimeSpeechModelSummary = SharedRuntimeTypes.RuntimeSpeechModelSummary; type RuntimeSpeechSetupState = SharedRuntimeTypes.RuntimeSpeechSetupState; type RuntimeGitCheckoutResult = SharedRuntimeTypes.RuntimeGitCheckoutResult; type RuntimeWorktreeStatus = SharedRuntimeTypes.RuntimeWorktreeStatus; type RuntimeWorktreeRecord = SharedRuntimeTypes.RuntimeWorktreeRecord; type RuntimeWorktreeCreateResult = SharedRuntimeTypes.RuntimeWorktreeCreateResult; type RuntimeWorktreeRemoveResult = SharedRuntimeTypes.RuntimeWorktreeRemoveResult; type RuntimeWorktreePsResult = SharedRuntimeTypes.RuntimeWorktreePsResult; type RuntimeRepoList = SharedRuntimeTypes.RuntimeRepoList; type RuntimeRepoSearchRefs = SharedRuntimeTypes.RuntimeRepoSearchRefs; type RuntimeWorktreeListResult = SharedRuntimeTypes.RuntimeWorktreeListResult;

// ── Browser automation types ──

export type BrowserSnapshotRef = {
  ref: string
  role: string
  name: string
}

export type BrowserSnapshotResult = {
  browserPageId: string
  snapshot: string
  refs: BrowserSnapshotRef[]
  url: string
  title: string
}

export type BrowserClickResult = {
  clicked: string
}

export type BrowserGotoResult = {
  url: string
  title: string
}

export type BrowserFillResult = {
  filled: string
}

export type BrowserTypeResult = {
  typed: boolean
}

export type BrowserSelectResult = {
  selected: string
}

export type BrowserScrollResult = {
  scrolled: 'up' | 'down'
}

export type BrowserBackResult = {
  url: string
  title: string
}

export type BrowserReloadResult = {
  url: string
  title: string
}

export type BrowserScreenshotResult = {
  data: string
  format: 'png' | 'jpeg'
}

export type BrowserScreencastReadyResult = {
  type: 'ready'
  subscriptionId: string
  browserPageId: string
  format: 'jpeg' | 'png'
  tab: BrowserTabInfo
}

export type BrowserScreencastEndResult = {
  type: 'end'
  subscriptionId: string
}

export type BrowserScreencastDialogResult = {
  type: 'dialog'
  dialogType: string
  message: string
}

export type BrowserScreencastDialogClosedResult = {
  type: 'dialogClosed'
}

export type BrowserScreencastErrorResult = {
  type: 'error'
  message: string
}

export type BrowserScreencastResult =
  | BrowserScreencastReadyResult
  | BrowserScreencastEndResult
  | BrowserScreencastDialogResult
  | BrowserScreencastDialogClosedResult
  | BrowserScreencastErrorResult

export type BrowserEvalResult = {
  result: string
  origin: string
}

export type BrowserTabInfo = {
  browserPageId: string
  index: number
  url: string
  title: string
  active: boolean
  // Why: a failed load leaves getURL() at chrome-error://; surface the structured
  // error so an agent driving the browser can tell a bypassable certificate
  // failure from an ordinary network error the way the UI can.
  loadError?: BrowserLoadError | null
  certificateFailure?: BrowserCertificateFailure | null
  worktreeId?: string | null
  profileId?: string | null
  profileLabel?: string | null
}

export type BrowserTabListResult = {
  tabs: BrowserTabInfo[]
}

export type BrowserTabSwitchResult = {
  switched: number
  browserPageId: string
}

export type BrowserTabSetProfileResult = {
  browserPageId: string
  profileId: string | null
  profileLabel: string | null
}

export type BrowserTabShowResult = {
  tab: BrowserTabInfo
}

export type BrowserTabCurrentResult = {
  tab: BrowserTabInfo
}

export type BrowserTabProfileShowResult = {
  browserPageId: string
  worktreeId: string | null
  profileId: string | null
  profileLabel: string | null
}

export type BrowserTabProfileCloneResult = {
  browserPageId: string
  sourceBrowserPageId: string
  profileId: string | null
  profileLabel: string | null
}

export type BrowserProfileListResult = {
  profiles: BrowserSessionProfile[]
}

export type BrowserProfileCreateResult = {
  profile: BrowserSessionProfile | null
}

export type BrowserProfileDeleteResult = {
  deleted: boolean
  profileId: string
}

export type BrowserDetectedProfileInfo = {
  name: string
  directory: string
}

export type BrowserDetectedInfo = {
  family: BrowserSessionProfileSource['browserFamily']
  label: string
  profiles: BrowserDetectedProfileInfo[]
  selectedProfile: string
}

export type BrowserDetectProfilesResult = {
  browsers: BrowserDetectedInfo[]
}

export type BrowserProfileImportFromBrowserResult = BrowserCookieImportResult

export type BrowserProfileClearDefaultCookiesResult = {
  cleared: boolean
}

export type BrowserHoverResult = {
  hovered: string
}

export type BrowserDragResult = {
  dragged: { from: string; to: string }
}

export type BrowserUploadResult = {
  uploaded: number
}

export type BrowserWaitResult = {
  waited: boolean
}

export type BrowserCheckResult = {
  checked: boolean
}

export type BrowserFocusResult = {
  focused: string
}

export type BrowserClearResult = {
  cleared: string
}

export type BrowserSelectAllResult = {
  selected: string
}

export type BrowserKeypressResult = {
  pressed: string
}

export type BrowserPdfResult = {
  data: string
}

// ── Cookie management types ──

export type BrowserCookie = {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite: string
}

export type BrowserCookieGetResult = {
  cookies: BrowserCookie[]
}

export type BrowserCookieSetResult = {
  success: boolean
}

export type BrowserCookieDeleteResult = {
  deleted: boolean
}

// ── Viewport emulation types ──

export type BrowserViewportResult = {
  width: number
  height: number
  deviceScaleFactor: number
  mobile: boolean
}

// ── Geolocation types ──

export type BrowserGeolocationResult = {
  latitude: number
  longitude: number
  accuracy: number
}

// ── Request interception types ──

export type BrowserInterceptedRequest = {
  id: string
  url: string
  method: string
  headers: Record<string, string>
  resourceType: string
}

export type BrowserInterceptEnableResult = {
  enabled: boolean
  patterns: string[]
}

export type BrowserInterceptDisableResult = {
  disabled: boolean
}

// ── Console/network capture types ──

export type BrowserConsoleEntry = {
  level: string
  text: string
  timestamp: number
  url?: string
  line?: number
}

export type BrowserConsoleResult = {
  entries: BrowserConsoleEntry[]
  truncated: boolean
}

export type BrowserNetworkEntry = {
  url: string
  method: string
  status: number
  mimeType: string
  size: number
  timestamp: number
}

export type BrowserNetworkLogResult = {
  entries: BrowserNetworkEntry[]
  truncated: boolean
}

export type BrowserCaptureStartResult = {
  capturing: boolean
}

export type BrowserCaptureStopResult = {
  stopped: boolean
}

export type BrowserExecResult = {
  output: unknown
}

export type BrowserTabCreateResult = {
  browserPageId: string
}

export type BrowserTabCloseResult = {
  closed: boolean
}

export type BrowserErrorCode =
  | 'browser_no_tab'
  | 'browser_tab_not_found'
  | 'browser_tab_closed'
  | 'browser_tab_changed'
  | 'browser_owner_unavailable'
  | 'browser_stale_ref'
  | 'browser_ref_not_found'
  | 'browser_navigation_failed'
  | 'browser_element_not_interactable'
  | 'browser_eval_error'
  | 'browser_cdp_error'
  | 'browser_debugger_detached'
  | 'browser_timeout'
  | 'browser_error'

export type EmulatorErrorCode =
  | 'emulator_no_active'
  | 'emulator_device_not_found'
  | 'emulator_helper_failed'
  | 'emulator_not_macos'
  | 'emulator_error'
