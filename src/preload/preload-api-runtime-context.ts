import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { preloadE2EConfig } from './e2e-config'
import { glApi } from './gitlab'
import type { AppIdentity } from '../shared/app-identity'
import type { DashboardSnapshot, DashboardRevealAgentArgs } from '../shared/dashboard-snapshot'
import type {
  TerminalPreviewConnectResult,
  TerminalPreviewDataPayload
} from '../shared/terminal-preview'
import type { CliInstallStatus } from '../shared/cli-install-types'
import type { AgentHookInstallStatus } from '../shared/agent-hook-types'
import type { CodexConfigSyncStatus } from '../shared/codex-config-sync-types'
import type { TerminalPaneSplitSource } from '../shared/feature-education-telemetry'
import type { TerminalTabCreateReply } from '../shared/terminal-reveal-identity'
import type { ProjectExecutionRuntimeResolution } from '../shared/project-execution-runtime'
import type { StartupCommandDelivery } from '../shared/codex-startup-delivery'
import type {
  AgentProviderSessionMetadata,
  SleepingAgentLaunchConfig
} from '../shared/agent-session-resume'
import type { MobileRelayStatus } from '../shared/mobile-relay-status'
import type { MobilePairingConnectionMode } from '../shared/mobile-pairing-connection-mode'
import type { MobileRelayMintFailure } from '../shared/mobile-relay-mint-failure'
import type { VerifyAndAddRuntimeEnvironmentResult } from '../shared/remote-pairing-verification'
import type {
  SshMutationExpectation,
  SshConnectionState,
  SshConfigImportResult,
  SshTargetAddResult,
  SshTarget,
  PortForwardEntry,
  EnrichedDetectedPort
} from '../shared/ssh-types'
import {
  admitSshConnectionStateForAuthorityReconciliation,
  admitSshDetectedPorts
} from '../shared/ssh-retained-payload-admission'
import type {
  HostRepoCatalogSnapshot,
  ListReposForExecutionHostArgs
} from '../shared/host-repo-catalog-contract'
import type {
  HostLineageSnapshot,
  ListDesktopLineageForHostArgs
} from '../shared/host-lineage-contract'
import type {
  PluginPanelActionOutcome,
  PluginPanelEntry
} from '../shared/plugins/plugin-panel-bridge'
import type { PluginConsentRequest } from '../shared/plugins/plugin-consent-request'
import type { PluginChangeEvent } from '../shared/plugins/plugin-change-event'
import type {
  BaseRefSearchResult,
  BaseRefDefaultResult,
  BrowserViewportOverride,
  CustomPet,
  FsChangedPayload,
  FilesystemPathFlavor,
  GetRateLimitResult,
  GitHubPRRefreshCandidate,
  GitHubPRRefreshEvent,
  GitHubPRRefreshReason,
  GitHubAssignableUser,
  GitHubCommentResult,
  GitHubCreateIssueResult,
  GitHubOwnerRepo,
  GitHubWorkItem,
  JiraProjectStatusOrder,
  GitPushTarget,
  GitStagingArea,
  GitForkSyncExpectedUpstream,
  GitForkSyncResult,
  GitUpstreamStatus,
  GhosttyImportPreview,
  ListWorkItemsResult,
  LinearProjectDetail,
  MemorySnapshot,
  NotificationDismissResult,
  NotificationDispatchResult,
  NotificationDeliveryProbeResult,
  NotificationPermissionStatusResult,
  NotificationSoundDataResult,
  NotificationSoundPathResult,
  NotificationSoundResult,
  NestedRepoScanResult,
  OnboardingState,
  PersistedUIState,
  FloatingTerminalCwdRequest,
  MarkdownDocument,
  SearchResult,
  TuiAgent,
  UpdateStatus,
  WorktreeBaseStatusEvent,
  WorktreeDefaultTabsLaunch,
  WorktreeHeadIdentity,
  WorktreeRemoteBranchConflictEvent
} from '../shared/types'
import type { PtyModelRestoreNeededEvent } from '../shared/pty-model-restore-marker'
import type { PtyListedSession } from '../shared/pty-listed-session'
import type {
  PtyRendererDeliveryHealthReply,
  PtyRendererDeliveryStateReport
} from '../shared/pty-renderer-delivery-health'
import type { TerminalViewAttributes } from '../shared/terminal-view-attributes'
import type { WriteTerminalRenderDesyncEvidenceArgs } from '../shared/terminal-render-desync-evidence'
import type { PtyMainDeliveryDiagnostics } from '../shared/pty-delivery-diagnostics'
import type {
  WarpThemeImportPreview,
  WarpThemeImportSource
} from '../shared/terminal-custom-themes'
import type { GitHistoryOptions, GitHistoryResult } from '../shared/git-history'
import type {
  ShellOpenExternalEditorRequest,
  ShellOpenExternalEditorResult,
  ShellOpenLocalPathResult
} from '../shared/shell-open-types'
import type { SkillDiscoveryResult, SkillDiscoveryTarget } from '../shared/skills'
import type {
  SkillFreshnessInventory,
  SkillUpdateRun,
  SkillUpdateStartResult
} from '../shared/skill-freshness'
import type {
  RuntimeBrowserDriverState,
  RuntimeMobileSessionTabMove,
  RuntimeStatus,
  RuntimeSyncWindowGraphResult,
  RuntimeSyncWindowGraph,
  RuntimeTerminalCreateRequestPayload,
  RuntimeTerminalDriverState,
  RuntimeTerminalPresentation
} from '../shared/runtime-types'
import type { RuntimeRpcResponse } from '../shared/runtime-rpc-envelope'
import type { PublicKnownRuntimeEnvironment } from '../shared/runtime-environments'
import type { RemoteWorkspaceChangedEvent } from '../shared/remote-workspace-types'
import type {
  RuntimeMobileMarkdownRequest,
  RuntimeMobileMarkdownResponse
} from '../shared/mobile-markdown-document'
import type {
  CodexRateLimitResetResult,
  GrokAccountStatus,
  RateLimitRuntimeTarget,
  RateLimitState
} from '../shared/rate-limit-types'
import type { WorkspaceSpaceScanProgress } from '../shared/workspace-space-types'
import type { WorkspaceCleanupScanProgress } from '../shared/workspace-cleanup'
import type { WorkspacePortAdvertisedUrlChangedEvent } from '../shared/workspace-ports'
import type { GhAuthDiagnostic } from '../shared/github-auth-types'
import type { TaskSourceContext } from '../shared/task-source-context'
import type {
  AddIssueCommentBySlugArgs,
  ClearProjectItemFieldArgs,
  DeleteIssueCommentBySlugArgs,
  GetProjectViewTableArgs,
  GetProjectViewTableResult,
  GitHubProjectCommentMutationResult,
  GitHubProjectMutationResult,
  ListAccessibleProjectsArgs,
  ListAccessibleProjectsResult,
  ListAssignableUsersBySlugArgs,
  ListAssignableUsersBySlugResult,
  ListIssueTypesBySlugArgs,
  ListIssueTypesBySlugResult,
  ListLabelsBySlugArgs,
  ListLabelsBySlugResult,
  ListProjectViewsArgs,
  ListProjectViewsResult,
  ProjectWorkItemDetailsBySlugArgs,
  ProjectWorkItemDetailsBySlugResult,
  ResolveProjectRefArgs,
  ResolveProjectRefResult,
  UpdateIssueBySlugArgs,
  UpdateIssueCommentBySlugArgs,
  UpdateIssueTypeBySlugArgs,
  UpdatePullRequestBySlugArgs,
  UpdateProjectItemFieldArgs
} from '../shared/github-project-types'
import {
  richMarkdownContextMenuCommandChannel,
  type RichMarkdownContextMenuCommandPayload
} from '../shared/rich-markdown-context-menu'
import type {
  AgentStatusClearIpcPayload,
  AgentStatusIpcPayload,
  MigrationUnsupportedPtyEntry
} from '../shared/agent-status-types'
import type { AgentInterruptInferenceRequest } from '../shared/agent-interrupt-intent'
import type { AgentQuestionAnsweredInferenceRequest } from '../shared/agent-question-answered-intent'
import type { TerminalSideEffectBatch } from '../shared/terminal-side-effect-facts'
import type {
  SpeechErrorEvent,
  SpeechLifecycleEvent,
  SpeechModelManifest,
  SpeechModelState,
  SpeechTranscriptEvent
} from '../shared/speech-types'
import type {
  PreflightRuntimeContext,
  RefreshAgentsResult,
  PluginHostInstallResult,
  PluginHostInstallSource,
  PluginHostListEntry,
  PluginHostLogLine,
  PreloadApi
} from './api-types'
import type { AgentKind, LaunchSource, RequestKind } from '../shared/telemetry-events'
import { createBrowserFindSubscriptions } from './browser-find-subscriptions'
import type { AppStarSource } from '../shared/gh-star-source'
import type { ExecutionHostId } from '../shared/execution-host'
import type { KeybindingActionId, KeybindingFileSnapshot } from '../shared/keybindings'
import type { AiVaultListArgs, AiVaultSubagentListArgs } from '../shared/ai-vault-types'
import type { AiVaultPrepareSessionResumeArgs } from '../shared/ai-vault-resume-preparation'
import {
  ORCA_APP_RESTART_ABORTED_EVENT,
  ORCA_APP_RESTART_STARTED_EVENT,
  ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT,
  ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT
} from '../shared/updater-renderer-events'
import { ORCA_RENDERER_UNLOAD_PREVENTED_EVENT } from '../shared/renderer-shutdown-events'
import {
  ORCA_INTERNAL_FILE_DRAG_TYPE,
  createNativeFileDropPayload,
  createRejectedNativeFileDropPayload,
  hasNativeFileDragTypes,
  NATIVE_FILE_DROP_MAX_PATHS,
  resolveNativeFileDropPath,
  type NativeDropResolution,
  type NativeFileDropPayload,
  type NativeFileDropPathEntry
} from '../shared/native-file-drop'
import type {
  LocalLogTailChangedPayload,
  LocalLogTailReadArgs,
  LocalLogTailReadResult,
  LocalLogTailWatchArgs
} from '../shared/local-log-tail-types'
import { subscribeRuntimeEnvironmentFromPreload } from './runtime-environment-subscriptions'
import type { RuntimeEnvironmentSubscriptionHandle } from './runtime-environment-subscriptions'
import type { HostedReviewForBranchArgs } from '../shared/hosted-review'
import type { ReadClipboardTextOptions } from '../shared/clipboard-text'
import type {
  LocalhostWorktreeLabelResult,
  LocalhostWorktreeLabelRoute
} from '../shared/localhost-worktree-labels'
import type {
  CrashReportBreadcrumbData,
  CrashReportCopyDiagnosticsArgs,
  CrashReportSubmitArgs,
  CrashReportSubmitResult,
  ReactErrorBoundaryReportArgs,
  ReactErrorBoundaryReportResult
} from '../shared/crash-reporting'
import type { RendererHeapStatistics } from '../shared/renderer-heap-statistics'
import { readRendererHeapStatistics } from './renderer-heap-statistics-reader'
import {
  createUpdaterQuitAbortRelay,
  prepareRendererForAppRestart
} from './renderer-restart-preparation'

type NativeFileDropCallback = (data: NativeFileDropPayload) => void

const nativeFileDropCallbacks: NativeFileDropCallback[] = []
let nativeFileDropListenerRegistered = false
const updaterQuitAbortRelay = createUpdaterQuitAbortRelay(
  window,
  ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT
)

ipcRenderer.on('updater:status', (_event, status: UpdateStatus) => {
  updaterQuitAbortRelay.handleStatus(status)
})
ipcRenderer.on('window:unload-prevented', () => {
  window.dispatchEvent(new Event(ORCA_RENDERER_UNLOAD_PREVENTED_EVENT))
})

function getLinuxDisplayServer(): 'wayland' | 'x11' | null {
  if (process.platform !== 'linux') {
    return null
  }
  if (
    process.env.WAYLAND_DISPLAY ||
    process.env.XDG_SESSION_TYPE?.toLowerCase() === 'wayland' ||
    process.env.ELECTRON_OZONE_PLATFORM_HINT?.toLowerCase() === 'wayland'
  ) {
    return 'wayland'
  }
  return process.env.DISPLAY ? 'x11' : null
}

const onNativeFileDrop = (_event: Electron.IpcRendererEvent, data: NativeFileDropPayload): void => {
  for (const callback of Array.from(nativeFileDropCallbacks)) {
    callback(data)
  }
}

function subscribeNativeFileDrop(callback: NativeFileDropCallback): () => void {
  nativeFileDropCallbacks.push(callback)
  if (!nativeFileDropListenerRegistered) {
    // Why: keep one real IPC listener and fan out locally â panes subscribe per split group, which would otherwise trip listener warnings.
    ipcRenderer.on('terminal:file-drop', onNativeFileDrop)
    nativeFileDropListenerRegistered = true
  }
  return () => {
    const callbackIndex = nativeFileDropCallbacks.indexOf(callback)
    if (callbackIndex !== -1) {
      nativeFileDropCallbacks.splice(callbackIndex, 1)
    }
    if (nativeFileDropCallbacks.length === 0 && nativeFileDropListenerRegistered) {
      ipcRenderer.removeListener('terminal:file-drop', onNativeFileDrop)
      nativeFileDropListenerRegistered = false
    }
  }
}

// Keep mutable playback state in one object so split preload modules share live state.
export const notificationSoundState: {
  cached: {
    path: string
    blobUrl: string
    audio: HTMLAudioElement
  } | null
  isPlaying: boolean
  cleanup: (() => void) | null
} = {
  cached: null,
  isPlaying: false,
  cleanup: null
}
// Cache one Audio + blob URL per path to avoid repeated IPC transfers for large sounds.
// Why: audio.play() can reject before ended/error fires â cleanup hook prevents leaked listeners on the cached Audio.

function clearNotificationSoundPlaybackState(): void {
  notificationSoundState.cleanup?.()
  notificationSoundState.cleanup = null
  notificationSoundState.isPlaying = false
}

function disposeCachedNotificationSound(): void {
  if (notificationSoundState.cached) {
    clearNotificationSoundPlaybackState()
    notificationSoundState.cached.audio.pause()
    notificationSoundState.cached.audio.src = ''
    URL.revokeObjectURL(notificationSoundState.cached.blobUrl)
    notificationSoundState.cached = null
  }
}

/**
 * Classify which UI surface the native OS drop landed on, and for file-explorer drops
 * extract the destination directory from `data-native-file-drop-dir`.
 *
 * Why: preload consumes the native `drop` before React can read paths, so it must capture
 * the destination dir now â otherwise the renderer can't tell "root" from "inside this folder".
 */
function resolveNativeFileDrop(event: DragEvent): NativeDropResolution | null {
  const pathEntries: NativeFileDropPathEntry[] = []
  for (const entry of event.composedPath()) {
    if (entry instanceof HTMLElement) {
      pathEntries.push({
        nativeFileDropTarget: entry.dataset.nativeFileDropTarget,
        nativeFileDropDir: entry.dataset.nativeFileDropDir,
        terminalTabId: entry.dataset.terminalTabId,
        terminalPaneLeafId: entry.dataset.terminalPaneLeafId ?? entry.dataset.leafId
      })
    }
  }
  return resolveNativeFileDropPath(pathEntries)
}

// File drag-and-drop lives in preload because webUtils (Fileâpath) is only available in the preload/main world, not the renderer's isolated world.
document.addEventListener(
  'dragover',
  (e) => {
    // Let in-app drags through to React handlers (their own dropEffect); only override for native OS file drops.
    if (e.dataTransfer && !hasNativeFileDragTypes(e.dataTransfer.types)) {
      return
    }
    e.preventDefault()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy'
    }
  },
  true
)

document.addEventListener(
  'drop',
  (e) => {
    // Let in-app drags (e.g. file explorer â terminal) through to React handlers
    if (e.dataTransfer?.types.includes(ORCA_INTERNAL_FILE_DRAG_TYPE)) {
      return
    }

    e.preventDefault()
    e.stopPropagation()
    const files = e.dataTransfer?.files
    if (!files || files.length === 0) {
      return
    }
    const resolution = resolveNativeFileDrop(e)

    // Why: reject oversized gestures by count before resolving every File object (path resolution is synchronous here).
    if (files.length > NATIVE_FILE_DROP_MAX_PATHS) {
      ipcRenderer.send(
        'terminal:file-dropped-from-preload',
        createRejectedNativeFileDropPayload({
          byteLength: 0,
          pathCount: files.length,
          reason: 'too-many-paths',
          status: 'rejected'
        })
      )
      return
    }

    const paths: string[] = []
    for (let i = 0; i < files.length; i++) {
      // webUtils.getPathForFile is the Electron 28+ replacement for File.path
      const filePath = webUtils.getPathForFile(files[i])
      if (filePath) {
        paths.push(filePath)
      }
    }

    if (paths.length === 0) {
      return
    }

    // Why: explorer marker present but no destination dir resolved â reject entirely, no editor fallback (fail-closed, design Â§7.1).
    if (resolution?.target === 'rejected') {
      return
    }

    const payload = createNativeFileDropPayload(resolution, paths)
    if (!payload) {
      return
    }
    // Why: emit exactly one native-drop event per gesture (the shared planner rejects oversized payloads without leaking path contents).
    ipcRenderer.send('terminal:file-dropped-from-preload', payload)
  },
  true
)

const startupDiagnosticsEnabled = process.env.ORCA_STARTUP_DIAGNOSTICS === '1'
const browserFindSubscriptions = createBrowserFindSubscriptions()

ipcRenderer.on('ui:findInBrowserPage', (_event, source: unknown) => {
  browserFindSubscriptions.dispatch(source)
})

// Custom APIs for renderer

export {
  contextBridge,
  ipcRenderer,
  webFrame,
  webUtils,
  electronAPI,
  preloadE2EConfig,
  glApi,
  admitSshConnectionStateForAuthorityReconciliation,
  admitSshDetectedPorts,
  richMarkdownContextMenuCommandChannel,
  createBrowserFindSubscriptions,
  ORCA_APP_RESTART_ABORTED_EVENT,
  ORCA_APP_RESTART_STARTED_EVENT,
  ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT,
  ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT,
  ORCA_RENDERER_UNLOAD_PREVENTED_EVENT,
  ORCA_INTERNAL_FILE_DRAG_TYPE,
  createNativeFileDropPayload,
  createRejectedNativeFileDropPayload,
  hasNativeFileDragTypes,
  NATIVE_FILE_DROP_MAX_PATHS,
  resolveNativeFileDropPath,
  subscribeRuntimeEnvironmentFromPreload,
  readRendererHeapStatistics,
  createUpdaterQuitAbortRelay,
  prepareRendererForAppRestart,
  nativeFileDropCallbacks,
  nativeFileDropListenerRegistered,
  updaterQuitAbortRelay,
  getLinuxDisplayServer,
  onNativeFileDrop,
  subscribeNativeFileDrop,
  clearNotificationSoundPlaybackState,
  disposeCachedNotificationSound,
  resolveNativeFileDrop,
  startupDiagnosticsEnabled,
  browserFindSubscriptions
}
export type {
  AppIdentity,
  DashboardSnapshot,
  DashboardRevealAgentArgs,
  TerminalPreviewConnectResult,
  TerminalPreviewDataPayload,
  CliInstallStatus,
  AgentHookInstallStatus,
  CodexConfigSyncStatus,
  TerminalPaneSplitSource,
  TerminalTabCreateReply,
  ProjectExecutionRuntimeResolution,
  StartupCommandDelivery,
  AgentProviderSessionMetadata,
  SleepingAgentLaunchConfig,
  MobileRelayStatus,
  MobilePairingConnectionMode,
  MobileRelayMintFailure,
  VerifyAndAddRuntimeEnvironmentResult,
  SshMutationExpectation,
  SshConnectionState,
  SshConfigImportResult,
  SshTargetAddResult,
  SshTarget,
  PortForwardEntry,
  EnrichedDetectedPort,
  HostRepoCatalogSnapshot,
  ListReposForExecutionHostArgs,
  HostLineageSnapshot,
  ListDesktopLineageForHostArgs,
  PluginPanelActionOutcome,
  PluginPanelEntry,
  PluginConsentRequest,
  PluginChangeEvent,
  BaseRefSearchResult,
  BaseRefDefaultResult,
  BrowserViewportOverride,
  CustomPet,
  FsChangedPayload,
  FilesystemPathFlavor,
  GetRateLimitResult,
  GitHubPRRefreshCandidate,
  GitHubPRRefreshEvent,
  GitHubPRRefreshReason,
  GitHubAssignableUser,
  GitHubCommentResult,
  GitHubCreateIssueResult,
  GitHubOwnerRepo,
  GitHubWorkItem,
  JiraProjectStatusOrder,
  GitPushTarget,
  GitStagingArea,
  GitForkSyncExpectedUpstream,
  GitForkSyncResult,
  GitUpstreamStatus,
  GhosttyImportPreview,
  ListWorkItemsResult,
  LinearProjectDetail,
  MemorySnapshot,
  NotificationDismissResult,
  NotificationDispatchResult,
  NotificationDeliveryProbeResult,
  NotificationPermissionStatusResult,
  NotificationSoundDataResult,
  NotificationSoundPathResult,
  NotificationSoundResult,
  NestedRepoScanResult,
  OnboardingState,
  PersistedUIState,
  FloatingTerminalCwdRequest,
  MarkdownDocument,
  SearchResult,
  TuiAgent,
  UpdateStatus,
  WorktreeBaseStatusEvent,
  WorktreeDefaultTabsLaunch,
  WorktreeHeadIdentity,
  WorktreeRemoteBranchConflictEvent,
  PtyModelRestoreNeededEvent,
  PtyListedSession,
  PtyRendererDeliveryHealthReply,
  PtyRendererDeliveryStateReport,
  TerminalViewAttributes,
  WriteTerminalRenderDesyncEvidenceArgs,
  PtyMainDeliveryDiagnostics,
  WarpThemeImportPreview,
  WarpThemeImportSource,
  GitHistoryOptions,
  GitHistoryResult,
  ShellOpenExternalEditorRequest,
  ShellOpenExternalEditorResult,
  ShellOpenLocalPathResult,
  SkillDiscoveryResult,
  SkillDiscoveryTarget,
  SkillFreshnessInventory,
  SkillUpdateRun,
  SkillUpdateStartResult,
  RuntimeBrowserDriverState,
  RuntimeMobileSessionTabMove,
  RuntimeStatus,
  RuntimeSyncWindowGraphResult,
  RuntimeSyncWindowGraph,
  RuntimeTerminalCreateRequestPayload,
  RuntimeTerminalDriverState,
  RuntimeTerminalPresentation,
  RuntimeRpcResponse,
  PublicKnownRuntimeEnvironment,
  RemoteWorkspaceChangedEvent,
  RuntimeMobileMarkdownRequest,
  RuntimeMobileMarkdownResponse,
  CodexRateLimitResetResult,
  GrokAccountStatus,
  RateLimitRuntimeTarget,
  RateLimitState,
  WorkspaceSpaceScanProgress,
  WorkspaceCleanupScanProgress,
  WorkspacePortAdvertisedUrlChangedEvent,
  GhAuthDiagnostic,
  TaskSourceContext,
  AddIssueCommentBySlugArgs,
  ClearProjectItemFieldArgs,
  DeleteIssueCommentBySlugArgs,
  GetProjectViewTableArgs,
  GetProjectViewTableResult,
  GitHubProjectCommentMutationResult,
  GitHubProjectMutationResult,
  ListAccessibleProjectsArgs,
  ListAccessibleProjectsResult,
  ListAssignableUsersBySlugArgs,
  ListAssignableUsersBySlugResult,
  ListIssueTypesBySlugArgs,
  ListIssueTypesBySlugResult,
  ListLabelsBySlugArgs,
  ListLabelsBySlugResult,
  ListProjectViewsArgs,
  ListProjectViewsResult,
  ProjectWorkItemDetailsBySlugArgs,
  ProjectWorkItemDetailsBySlugResult,
  ResolveProjectRefArgs,
  ResolveProjectRefResult,
  UpdateIssueBySlugArgs,
  UpdateIssueCommentBySlugArgs,
  UpdateIssueTypeBySlugArgs,
  UpdatePullRequestBySlugArgs,
  UpdateProjectItemFieldArgs,
  AgentStatusClearIpcPayload,
  AgentStatusIpcPayload,
  MigrationUnsupportedPtyEntry,
  AgentInterruptInferenceRequest,
  AgentQuestionAnsweredInferenceRequest,
  TerminalSideEffectBatch,
  SpeechErrorEvent,
  SpeechLifecycleEvent,
  SpeechModelManifest,
  SpeechModelState,
  SpeechTranscriptEvent,
  PreflightRuntimeContext,
  RefreshAgentsResult,
  PluginHostInstallResult,
  PluginHostInstallSource,
  PluginHostListEntry,
  PluginHostLogLine,
  PreloadApi,
  AgentKind,
  LaunchSource,
  RequestKind,
  AppStarSource,
  ExecutionHostId,
  KeybindingActionId,
  KeybindingFileSnapshot,
  AiVaultListArgs,
  AiVaultSubagentListArgs,
  AiVaultPrepareSessionResumeArgs,
  AgentType,
  LocalLogTailChangedPayload,
  LocalLogTailReadArgs,
  LocalLogTailReadResult,
  LocalLogTailWatchArgs,
  RuntimeEnvironmentSubscriptionHandle,
  HostedReviewForBranchArgs,
  ReadClipboardTextOptions,
  LocalhostWorktreeLabelResult,
  LocalhostWorktreeLabelRoute,
  CrashReportBreadcrumbData,
  CrashReportCopyDiagnosticsArgs,
  CrashReportSubmitArgs,
  CrashReportSubmitResult,
  ReactErrorBoundaryReportArgs,
  ReactErrorBoundaryReportResult,
  RendererHeapStatistics,
  NativeFileDropCallback,
  RichMarkdownContextMenuCommandPayload,
  NativeDropResolution,
  NativeFileDropPayload,
  NativeFileDropPathEntry
}
