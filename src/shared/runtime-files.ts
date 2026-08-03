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
type RuntimeGraphStatus = SharedRuntimeTypes.RuntimeGraphStatus; type RuntimeDesktopWindowStatus = SharedRuntimeTypes.RuntimeDesktopWindowStatus; type DeviceScope = SharedRuntimeTypes.DeviceScope; type RuntimeTerminalDriverState = SharedRuntimeTypes.RuntimeTerminalDriverState; type RuntimeBrowserDriverState = SharedRuntimeTypes.RuntimeBrowserDriverState; type RuntimeStatus = SharedRuntimeTypes.RuntimeStatus; type CliRuntimeState = SharedRuntimeTypes.CliRuntimeState; type CliStatusResult = SharedRuntimeTypes.CliStatusResult; type RuntimeSyncedTab = SharedRuntimeTypes.RuntimeSyncedTab; type RuntimeSyncedLeaf = SharedRuntimeTypes.RuntimeSyncedLeaf; type RuntimeSyncWindowGraph = SharedRuntimeTypes.RuntimeSyncWindowGraph; type RuntimeNativeChatLaunchDraftResolution = SharedRuntimeTypes.RuntimeNativeChatLaunchDraftResolution; type RuntimeSyncWindowGraphResult = SharedRuntimeTypes.RuntimeSyncWindowGraphResult; type RuntimeMobileSessionTerminalTab = SharedRuntimeTypes.RuntimeMobileSessionTerminalTab; type RuntimeMobileTerminalTheme = SharedRuntimeTypes.RuntimeMobileTerminalTheme; type RuntimeMobileSessionMarkdownTab = SharedRuntimeTypes.RuntimeMobileSessionMarkdownTab; type RuntimeMobileSessionFileTab = SharedRuntimeTypes.RuntimeMobileSessionFileTab; type RuntimeMobileSessionBrowserTab = SharedRuntimeTypes.RuntimeMobileSessionBrowserTab; type RuntimeMobileSessionSnapshotTab = SharedRuntimeTypes.RuntimeMobileSessionSnapshotTab; type RuntimeMobileSessionTerminalClientTab = SharedRuntimeTypes.RuntimeMobileSessionTerminalClientTab; type RuntimeMobileSessionClientTab = SharedRuntimeTypes.RuntimeMobileSessionClientTab; type RuntimeMobileSessionTabGroup = SharedRuntimeTypes.RuntimeMobileSessionTabGroup; type RuntimeMobileSessionTabMove = SharedRuntimeTypes.RuntimeMobileSessionTabMove; type RuntimeMobileSessionTabMoveResult = SharedRuntimeTypes.RuntimeMobileSessionTabMoveResult; type RuntimeMobileSessionTabCloseResult = SharedRuntimeTypes.RuntimeMobileSessionTabCloseResult; type RuntimeSessionTabCloseReason = SharedRuntimeTypes.RuntimeSessionTabCloseReason; type RuntimeMobileSessionTabsSnapshot = SharedRuntimeTypes.RuntimeMobileSessionTabsSnapshot; type RuntimeMobileSessionTabsResult = SharedRuntimeTypes.RuntimeMobileSessionTabsResult; type RuntimeSessionSnapshot = SharedRuntimeTypes.RuntimeSessionSnapshot; type RuntimeSessionFlushResult = SharedRuntimeTypes.RuntimeSessionFlushResult; type RuntimeMobileSessionCreateTerminalResult = SharedRuntimeTypes.RuntimeMobileSessionCreateTerminalResult; type RuntimeMobileSessionTabsRemovedResult = SharedRuntimeTypes.RuntimeMobileSessionTabsRemovedResult; type RuntimeTerminalVisualTerminalNode = SharedRuntimeTypes.RuntimeTerminalVisualTerminalNode; type RuntimeTerminalVisualPaneNode = SharedRuntimeTypes.RuntimeTerminalVisualPaneNode; type RuntimeTerminalVisualTab = SharedRuntimeTypes.RuntimeTerminalVisualTab; type RuntimeTerminalVisualGroupNode = SharedRuntimeTypes.RuntimeTerminalVisualGroupNode; type RuntimeTerminalVisualLayoutNode = SharedRuntimeTypes.RuntimeTerminalVisualLayoutNode; type RuntimeTerminalVisualLayout = SharedRuntimeTypes.RuntimeTerminalVisualLayout; type RuntimeTerminalListResult = SharedRuntimeTypes.RuntimeTerminalListResult; type RuntimeTerminalOrphanAdoptionClaim = SharedRuntimeTypes.RuntimeTerminalOrphanAdoptionClaim; type RuntimeTerminalOrphanTopologyTab = SharedRuntimeTypes.RuntimeTerminalOrphanTopologyTab; type RuntimeTerminalOrphanTopologyGroup = SharedRuntimeTypes.RuntimeTerminalOrphanTopologyGroup; type RuntimeTerminalOrphanTopology = SharedRuntimeTypes.RuntimeTerminalOrphanTopology; type RuntimeTerminalOrphanAdoptionRequest = SharedRuntimeTypes.RuntimeTerminalOrphanAdoptionRequest; type RuntimeTerminalOrphanAdoptionResult = SharedRuntimeTypes.RuntimeTerminalOrphanAdoptionResult; type RuntimeWorktreeTerminalSleepFailure = SharedRuntimeTypes.RuntimeWorktreeTerminalSleepFailure; type RuntimeWorktreeTerminalSleepResult = SharedRuntimeTypes.RuntimeWorktreeTerminalSleepResult; type RuntimeTerminalShow = SharedRuntimeTypes.RuntimeTerminalShow; type RuntimeTerminalInspect = SharedRuntimeTypes.RuntimeTerminalInspect; type RuntimeTerminalResize = SharedRuntimeTypes.RuntimeTerminalResize; type RuntimeTerminalState = SharedRuntimeTypes.RuntimeTerminalState; type RuntimeTerminalRead = SharedRuntimeTypes.RuntimeTerminalRead; type RuntimeTerminalRename = SharedRuntimeTypes.RuntimeTerminalRename; type RuntimeTerminalSend = SharedRuntimeTypes.RuntimeTerminalSend; type RuntimeTerminalAgentStatusState = SharedRuntimeTypes.RuntimeTerminalAgentStatusState; type RuntimeTerminalAgentStatus = SharedRuntimeTypes.RuntimeTerminalAgentStatus; type RuntimeTerminalPresentation = SharedRuntimeTypes.RuntimeTerminalPresentation; type RuntimeTerminalCreateRequestPayload = SharedRuntimeTypes.RuntimeTerminalCreateRequestPayload; type RuntimeTerminalCreate = SharedRuntimeTypes.RuntimeTerminalCreate; type RuntimeTerminalSplit = SharedRuntimeTypes.RuntimeTerminalSplit; type RuntimeTerminalResolvePane = SharedRuntimeTypes.RuntimeTerminalResolvePane; type RuntimeTerminalFocus = SharedRuntimeTypes.RuntimeTerminalFocus; type RuntimeTerminalClose = SharedRuntimeTypes.RuntimeTerminalClose; type RuntimeTerminalWaitCondition = SharedRuntimeTypes.RuntimeTerminalWaitCondition; type RuntimeTerminalWaitBlockedReason = SharedRuntimeTypes.RuntimeTerminalWaitBlockedReason; type RuntimeTerminalWait = SharedRuntimeTypes.RuntimeTerminalWait; type RuntimeWorktreeAgentRow = SharedRuntimeTypes.RuntimeWorktreeAgentRow; type RuntimeWorktreePsSummary = SharedRuntimeTypes.RuntimeWorktreePsSummary; type RuntimeGitLocalBranches = SharedRuntimeTypes.RuntimeGitLocalBranches; type RuntimeSpeechModelSummary = SharedRuntimeTypes.RuntimeSpeechModelSummary; type RuntimeSpeechSetupState = SharedRuntimeTypes.RuntimeSpeechSetupState; type RuntimeGitCheckoutResult = SharedRuntimeTypes.RuntimeGitCheckoutResult; type RuntimeWorktreeStatus = SharedRuntimeTypes.RuntimeWorktreeStatus; type RuntimeWorktreeRecord = SharedRuntimeTypes.RuntimeWorktreeRecord; type RuntimeWorktreeCreateResult = SharedRuntimeTypes.RuntimeWorktreeCreateResult; type RuntimeWorktreeRemoveResult = SharedRuntimeTypes.RuntimeWorktreeRemoveResult; type RuntimeWorktreePsResult = SharedRuntimeTypes.RuntimeWorktreePsResult; type RuntimeRepoList = SharedRuntimeTypes.RuntimeRepoList; type RuntimeRepoSearchRefs = SharedRuntimeTypes.RuntimeRepoSearchRefs; type RuntimeWorktreeListResult = SharedRuntimeTypes.RuntimeWorktreeListResult; type BrowserSnapshotRef = SharedRuntimeTypes.BrowserSnapshotRef; type BrowserSnapshotResult = SharedRuntimeTypes.BrowserSnapshotResult; type BrowserClickResult = SharedRuntimeTypes.BrowserClickResult; type BrowserGotoResult = SharedRuntimeTypes.BrowserGotoResult; type BrowserFillResult = SharedRuntimeTypes.BrowserFillResult; type BrowserTypeResult = SharedRuntimeTypes.BrowserTypeResult; type BrowserSelectResult = SharedRuntimeTypes.BrowserSelectResult; type BrowserScrollResult = SharedRuntimeTypes.BrowserScrollResult; type BrowserBackResult = SharedRuntimeTypes.BrowserBackResult; type BrowserReloadResult = SharedRuntimeTypes.BrowserReloadResult; type BrowserScreenshotResult = SharedRuntimeTypes.BrowserScreenshotResult; type BrowserScreencastReadyResult = SharedRuntimeTypes.BrowserScreencastReadyResult; type BrowserScreencastEndResult = SharedRuntimeTypes.BrowserScreencastEndResult; type BrowserScreencastDialogResult = SharedRuntimeTypes.BrowserScreencastDialogResult; type BrowserScreencastDialogClosedResult = SharedRuntimeTypes.BrowserScreencastDialogClosedResult; type BrowserScreencastErrorResult = SharedRuntimeTypes.BrowserScreencastErrorResult; type BrowserScreencastResult = SharedRuntimeTypes.BrowserScreencastResult; type BrowserEvalResult = SharedRuntimeTypes.BrowserEvalResult; type BrowserTabInfo = SharedRuntimeTypes.BrowserTabInfo; type BrowserTabListResult = SharedRuntimeTypes.BrowserTabListResult; type BrowserTabSwitchResult = SharedRuntimeTypes.BrowserTabSwitchResult; type BrowserTabSetProfileResult = SharedRuntimeTypes.BrowserTabSetProfileResult; type BrowserTabShowResult = SharedRuntimeTypes.BrowserTabShowResult; type BrowserTabCurrentResult = SharedRuntimeTypes.BrowserTabCurrentResult; type BrowserTabProfileShowResult = SharedRuntimeTypes.BrowserTabProfileShowResult; type BrowserTabProfileCloneResult = SharedRuntimeTypes.BrowserTabProfileCloneResult; type BrowserProfileListResult = SharedRuntimeTypes.BrowserProfileListResult; type BrowserProfileCreateResult = SharedRuntimeTypes.BrowserProfileCreateResult; type BrowserProfileDeleteResult = SharedRuntimeTypes.BrowserProfileDeleteResult; type BrowserDetectedProfileInfo = SharedRuntimeTypes.BrowserDetectedProfileInfo; type BrowserDetectedInfo = SharedRuntimeTypes.BrowserDetectedInfo; type BrowserDetectProfilesResult = SharedRuntimeTypes.BrowserDetectProfilesResult; type BrowserProfileImportFromBrowserResult = SharedRuntimeTypes.BrowserProfileImportFromBrowserResult; type BrowserProfileClearDefaultCookiesResult = SharedRuntimeTypes.BrowserProfileClearDefaultCookiesResult; type BrowserHoverResult = SharedRuntimeTypes.BrowserHoverResult; type BrowserDragResult = SharedRuntimeTypes.BrowserDragResult; type BrowserUploadResult = SharedRuntimeTypes.BrowserUploadResult; type BrowserWaitResult = SharedRuntimeTypes.BrowserWaitResult; type BrowserCheckResult = SharedRuntimeTypes.BrowserCheckResult; type BrowserFocusResult = SharedRuntimeTypes.BrowserFocusResult; type BrowserClearResult = SharedRuntimeTypes.BrowserClearResult; type BrowserSelectAllResult = SharedRuntimeTypes.BrowserSelectAllResult; type BrowserKeypressResult = SharedRuntimeTypes.BrowserKeypressResult; type BrowserPdfResult = SharedRuntimeTypes.BrowserPdfResult; type BrowserCookie = SharedRuntimeTypes.BrowserCookie; type BrowserCookieGetResult = SharedRuntimeTypes.BrowserCookieGetResult; type BrowserCookieSetResult = SharedRuntimeTypes.BrowserCookieSetResult; type BrowserCookieDeleteResult = SharedRuntimeTypes.BrowserCookieDeleteResult; type BrowserViewportResult = SharedRuntimeTypes.BrowserViewportResult; type BrowserGeolocationResult = SharedRuntimeTypes.BrowserGeolocationResult; type BrowserInterceptedRequest = SharedRuntimeTypes.BrowserInterceptedRequest; type BrowserInterceptEnableResult = SharedRuntimeTypes.BrowserInterceptEnableResult; type BrowserInterceptDisableResult = SharedRuntimeTypes.BrowserInterceptDisableResult; type BrowserConsoleEntry = SharedRuntimeTypes.BrowserConsoleEntry; type BrowserConsoleResult = SharedRuntimeTypes.BrowserConsoleResult; type BrowserNetworkEntry = SharedRuntimeTypes.BrowserNetworkEntry; type BrowserNetworkLogResult = SharedRuntimeTypes.BrowserNetworkLogResult; type BrowserCaptureStartResult = SharedRuntimeTypes.BrowserCaptureStartResult; type BrowserCaptureStopResult = SharedRuntimeTypes.BrowserCaptureStopResult; type BrowserExecResult = SharedRuntimeTypes.BrowserExecResult; type BrowserTabCreateResult = SharedRuntimeTypes.BrowserTabCreateResult; type BrowserTabCloseResult = SharedRuntimeTypes.BrowserTabCloseResult; type BrowserErrorCode = SharedRuntimeTypes.BrowserErrorCode; type EmulatorErrorCode = SharedRuntimeTypes.EmulatorErrorCode;

export type RuntimeFileListEntry = {
  relativePath: string
  basename: string
  kind: 'text' | 'binary'
}

export type RuntimeFileListResult = {
  worktree: string
  rootPath: string
  files: RuntimeFileListEntry[]
  totalCount: number
  truncated: boolean
}

export type RuntimeFileOpenResult = {
  worktree: string
  relativePath: string
  kind: 'markdown' | 'text' | 'binary' | 'image'
  opened: boolean
}

export type RuntimeFileReadResult = {
  worktree: string
  relativePath: string
  content: string
  truncated: boolean
  byteLength: number
}

export type RuntimeTerminalPathOpenTarget =
  | {
      kind: 'worktree-file'
      provider: 'local' | 'ssh'
      relativePath: string
      absolutePath: string
    }
  | {
      kind: 'absolute-file'
      provider: 'local' | 'ssh'
      absolutePath: string
      grantId: string
    }
  | {
      kind: 'unsupported'
      reason: string
    }

/** Result of resolving a file path tapped in the mobile terminal against the
 *  worktree root (+ optional cwd). relativePath is null when the path resolves
 *  outside the worktree (not openable via the worktree-scoped file RPCs). */
export type RuntimeTerminalPathResolution = {
  worktree: string
  relativePath: string | null
  /** Absolute on-disk path (or remote path), present when relativePath is.
   *  Used to build a file:// URL for opening HTML in a browser tab. */
  absolutePath: string | null
  exists: boolean
  isDirectory: boolean
  openTarget?: RuntimeTerminalPathOpenTarget
}

export type RuntimeFilePreviewResult = {
  content: string
  isBinary: boolean
  isImage?: boolean
  mimeType?: string
  imageDimensions?: RasterImageDimensions
}

export type RuntimeFileReadChunkResult = {
  contentBase64: string
  bytesRead: number
  eof: boolean
}

export type RuntimeTerminalSummary = {
  handle: string
  ptyId: string | null
  incarnationId?: string | null
  orphaned?: boolean
  worktreeId: string
  worktreePath: string
  branch: string
  tabId: string
  leafId: string
  title: string | null
  connected: boolean
  writable: boolean
  lastOutputAt: number | null
  preview: string
}

