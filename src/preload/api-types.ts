export type {
  ShellOpenExternalEditorRequest,
  ShellOpenExternalEditorResult,
  ShellOpenLocalPathResult
} from '../shared/shell-open-types'
import type {
  BrowserAwaitGrabSelectionArgs,
  BrowserCancelGrabArgs,
  BrowserCaptureSelectionScreenshotArgs,
  BrowserCaptureSelectionScreenshotResult,
  BrowserCertificateFailure,
  BrowserCertificateProceedResult,
  BrowserCookieImportResult,
  BrowserContextMenuDismissedEvent,
  BrowserContextMenuRequestedEvent,
  BrowserDownloadFinishedEvent,
  BrowserDownloadProgressEvent,
  BrowserDownloadRequestedEvent,
  BrowserExtractHoverArgs,
  BrowserExtractHoverResult,
  BrowserGrabResult,
  BrowserLoadError,
  BrowserPermissionDeniedEvent,
  BrowserPopupEvent,
  BrowserSessionProfile,
  BrowserSessionProfileScope,
  BrowserSetAnnotationViewportBridgeArgs,
  BrowserSetGrabModeArgs,
  BrowserSetGrabModeResult,
  BrowserViewportOverride,
  PathSource,
  ShellHydrationFailureReason,
  StatsSummary
} from './api-types-external'
import type { ProjectExecutionRuntimeResolution } from '../shared/project-execution-runtime'

export type DetectedBrowserProfileInfo = { name: string; directory: string }
export type DetectedBrowserInfo = {
  family: import('./api-types-external').BrowserSessionProfileSource['browserFamily']
  label: string
  profiles: DetectedBrowserProfileInfo[]
  selectedProfile: string
}

export type PreflightStatus = {
  git: { installed: boolean }
  gh: { installed: boolean; authenticated: boolean }
  glab?: { installed: boolean; authenticated: boolean }
  bitbucket?: { configured: boolean; authenticated: boolean; account: string | null }
  azureDevOps?: {
    configured: boolean
    authenticated: boolean
    account: string | null
    baseUrl: string | null
    tokenConfigured: boolean
  }
  gitea?: {
    configured: boolean
    authenticated: boolean
    account: string | null
    baseUrl: string | null
    tokenConfigured: boolean
  }
}

export type BrowserApi = {
  registerGuest: (args: {
    browserPageId: string
    workspaceId: string
    worktreeId: string
    sessionProfileId?: string | null
    webContentsId: number
  }) => Promise<boolean>
  unregisterGuest: (args: { browserPageId: string }) => Promise<void>
  openDevTools: (args: { browserPageId: string }) => Promise<boolean>
  setViewportOverride: (args: {
    browserPageId: string
    override: BrowserViewportOverride | null
  }) => Promise<boolean>
  setAnnotationViewportBridge: (args: BrowserSetAnnotationViewportBridgeArgs) => Promise<boolean>
  onGuestLoadFailed: (
    callback: (args: { browserPageId: string; loadError: BrowserLoadError }) => void
  ) => () => void
  onCertificateFailureChanged: (
    callback: (event: { browserPageId: string; failure: BrowserCertificateFailure | null }) => void
  ) => () => void
  proceedCertificate: (args: {
    browserPageId: string
    challengeId: string
  }) => Promise<BrowserCertificateProceedResult>
  onPermissionDenied: (callback: (event: BrowserPermissionDeniedEvent) => void) => () => void
  onPopup: (callback: (event: BrowserPopupEvent) => void) => () => void
  onDownloadRequested: (callback: (event: BrowserDownloadRequestedEvent) => void) => () => void
  onDownloadProgress: (callback: (event: BrowserDownloadProgressEvent) => void) => () => void
  onDownloadFinished: (callback: (event: BrowserDownloadFinishedEvent) => void) => () => void
  onContextMenuRequested: (
    callback: (event: BrowserContextMenuRequestedEvent) => void
  ) => () => void
  onContextMenuDismissed: (
    callback: (event: BrowserContextMenuDismissedEvent) => void
  ) => () => void
  onNavigationUpdate: (
    callback: (event: { browserPageId: string; url: string; title: string }) => void
  ) => () => void
  onActivateView: (
    callback: (data: { worktreeId?: string; browserPageId?: string }) => void
  ) => () => void
  onPaneFocus: (
    callback: (data: { worktreeId: string | null; browserPageId: string }) => void
  ) => () => void
  onOpenLinkInOrcaTab: (
    callback: (event: { browserPageId: string; url: string }) => void
  ) => () => void
  cancelDownload: (args: { downloadId: string }) => Promise<boolean>
  setGrabMode: (args: BrowserSetGrabModeArgs) => Promise<BrowserSetGrabModeResult>
  awaitGrabSelection: (args: BrowserAwaitGrabSelectionArgs) => Promise<BrowserGrabResult>
  cancelGrab: (args: BrowserCancelGrabArgs) => Promise<boolean>
  captureSelectionScreenshot: (
    args: BrowserCaptureSelectionScreenshotArgs
  ) => Promise<BrowserCaptureSelectionScreenshotResult>
  extractHoverPayload: (args: BrowserExtractHoverArgs) => Promise<BrowserExtractHoverResult>
  onGrabModeToggle: (callback: (browserPageId: string) => void) => () => void
  onGrabActionShortcut: (
    callback: (args: { browserPageId: string; key: 'c' | 's' }) => void
  ) => () => void
  sessionListProfiles: () => Promise<BrowserSessionProfile[]>
  sessionCreateProfile: (args: {
    scope: BrowserSessionProfileScope
    label: string
  }) => Promise<BrowserSessionProfile | null>
  sessionDeleteProfile: (args: { profileId: string }) => Promise<boolean>
  sessionImportCookies: (args: { profileId: string }) => Promise<BrowserCookieImportResult>
  sessionResolvePartition: (args: { profileId: string | null }) => Promise<string | null>
  sessionDetectBrowsers: () => Promise<DetectedBrowserInfo[]>
  sessionImportFromBrowser: (args: {
    profileId: string
    browserFamily: string
    browserProfile?: string
  }) => Promise<BrowserCookieImportResult>
  sessionClearDefaultCookies: () => Promise<boolean>
  notifyActiveTabChanged: (args: { browserPageId: string }) => Promise<boolean>
}

export type RefreshAgentsResult = {
  agents: string[]
  addedPathSegments: string[]
  shellHydrationOk: boolean
  pathSource: PathSource
  pathFailureReason: ShellHydrationFailureReason
}

export type PreflightRuntimeContext = {
  wslDistro?: string | null
  wslDefault?: boolean
  projectRuntime?: ProjectExecutionRuntimeResolution
}

export type PreflightApi = {
  check: (args?: PreflightRuntimeContext & { force?: boolean }) => Promise<PreflightStatus>
  detectAgents: (args?: PreflightRuntimeContext) => Promise<string[]>
  refreshAgents: (args?: PreflightRuntimeContext) => Promise<RefreshAgentsResult>
  detectRemoteAgents: (args: { connectionId: string }) => Promise<string[]>
  detectRemoteWindowsTerminalCapabilities: (args: { connectionId: string }) => Promise<{
    wslAvailable: boolean
    wslDistros: string[]
    pwshAvailable: boolean
    gitBashAvailable: boolean
    hostPlatform: NodeJS.Platform | null
  }>
}

export type PtyManagementSession = {
  sessionId: string
  state: 'created' | 'spawning' | 'running' | 'exiting' | 'exited'
  shellState: 'pending' | 'ready' | 'timed_out' | 'unsupported'
  isAlive: boolean
  pid: number | null
  cwd: string | null
  cols: number
  rows: number
  createdAt: number
  protocolVersion: number
}

export type PtyManagementApi = {
  listSessions: () => Promise<{ sessions: PtyManagementSession[]; degraded: boolean }>
  killAll: () => Promise<{
    killedCount: number
    remainingCount: number
    killedSessionIds?: string[]
  }>
  killOne: (args: { sessionId: string }) => Promise<{ success: boolean }>
  restart: () => Promise<{ success: boolean }>
}

export type ExportApi = {
  htmlToPdf: (args: {
    html: string
    title: string
  }) => Promise<
    { success: true; filePath: string } | { success: false; cancelled?: boolean; error?: string }
  >
}

export type StatsApi = { getSummary: () => Promise<StatsSummary> }

export type DiagnosticsStatusPayload = {
  readonly localFileEnabled: boolean
  readonly bundleEnabled: boolean
  readonly traceFilePath: string
  readonly traceFamilySize: number
  readonly disabledReason?:
    | 'do_not_track'
    | 'orca_telemetry_disabled'
    | 'orca_diagnostics_disabled'
    | 'ci'
}

export type DiagnosticsBundlePayload = {
  readonly bundleSubmissionId: string
  readonly bytes: number
  readonly spanCount: number
}

export type DiagnosticsUploadPayload = { readonly ticketId: string } | { readonly canceled: true }

export * from './api-base'
export * from './api-usage-chat'
export * from './api-plugins'
export * from './api-preload'
export type { AgentType } from './api-types-external'
