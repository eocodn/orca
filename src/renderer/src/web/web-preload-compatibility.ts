import { createWebPreloadApi } from './web-preload-api-factory'
import { createFallbackProxy, withFallback } from './web-preload-fallbacks'
import type { PreloadApi, PreflightStatus, RefreshAgentsResult } from '../../../preload/api-types'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import { parseHostAccessLink } from '../../../shared/remote-pairing-address'
import { verifyRemotePairingRuntimeStatus } from '../../../shared/remote-pairing-verification'
import type { AiVaultListArgs, AiVaultListResult } from '../../../shared/ai-vault-types'
import type {
  AiVaultPrepareSessionResumeArgs,
  AiVaultPrepareSessionResumeResult
} from '../../../shared/ai-vault-resume-preparation'
import type {
  DetectedWorktreeListResult,
  DirEntry,
  ForceDeleteWorktreeBranchResult,
  GlobalSettings,
  MemorySnapshot,
  OnboardingState,
  PersistedUIState,
  Repo,
  RemoveWorktreeResult,
  SearchResult,
  StatsSummary,
  Worktree,
  WorktreeLineage,
  WorkspaceLineage,
  WorkspaceSessionPatch,
  WorkspaceSessionState
} from '../../../shared/types'
import type { SkillDiscoveryResult } from '../../../shared/skills'
import type { SkillFreshnessInventory } from '../../../shared/skill-freshness'
import type { SshConnectionState, SshTarget } from '../../../shared/ssh-types'
import {
  getDefaultOnboardingState,
  getDefaultSettings,
  getDefaultUIState,
  getDefaultWorkspaceSession,
  getWorktreeCardModeProperties,
  normalizeAgentActivityDisplayMode,
  normalizeWorktreeCardProperties,
  ONBOARDING_FLOW_VERSION
} from '../../../shared/constants'
import {
  createDefaultLocalOrcaProfile,
  DEFAULT_LOCAL_ORCA_PROFILE_ID
} from '../../../shared/orca-profiles'
import { legacyBaseRefSearchResult } from '../../../shared/base-ref-search-result'
import { EMPTY_PTY_MAIN_DELIVERY_DIAGNOSTICS } from '../../../shared/pty-delivery-diagnostics'
import { createE2EConfig } from '../../../shared/e2e-config'
import { relativePathInsideRoot } from '../../../shared/cross-platform-path'
import {
  applyPRBotAuthorOverride,
  normalizePRBotAuthorOverrides
} from '../../../shared/pr-bot-author-overrides'
import {
  LOCAL_EXECUTION_HOST_ID,
  normalizeExecutionHostScope,
  normalizeExecutionHostId,
  parseExecutionHostId,
  toRuntimeExecutionHostId,
  type ExecutionHostId
} from '../../../shared/execution-host'
import { toRuntimeWorktreeSelector } from '../runtime/runtime-worktree-selector'
import { callAbortableRuntimeEnvironment } from '../runtime/abortable-runtime-environment-call'
import { normalizeDisabledTuiAgents } from '../../../shared/tui-agent-selection'
import {
  normalizeTuiAgentArgsRecord,
  normalizeTuiAgentEnvRecord
} from '../../../shared/tui-agent-launch-defaults'
import { normalizeAutoRenameBranchFromWorkDefaultOn } from '../../../shared/auto-rename-branch-from-work-settings'
import { normalizeTerminalCursorStyleDefault } from '../../../shared/terminal-cursor-style-settings'
import {
  normalizeOsc52ClipboardDefaultOn,
  osc52ClipboardDefaultOnOverridesPersistedOff
} from '../../../shared/osc52-clipboard-settings'
import { normalizeTerminalCustomThemes } from '../../../shared/terminal-custom-themes'
import { normalizeUiLanguage } from '../../../shared/ui-language'
import { normalizeUsagePercentageDisplay } from '../../../shared/usage-percentage-display'
import { normalizeStatusBarUsageMode } from '../../../shared/status-bar-usage-mode'
import type { RateLimitState } from '../../../shared/rate-limit-types'
import type { RuntimeStatus, RuntimeSyncWindowGraph } from '../../../shared/runtime-types'
import { assertFileMutationOwnershipCapability } from '../../../shared/file-mutation-ownership'
import {
  clearStoredWebRuntimeEnvironment,
  createStoredWebRuntimeEnvironment,
  getPreferredWebPairingOffer,
  readStoredWebRuntimeEnvironment,
  redactStoredWebRuntimeEnvironment,
  saveStoredWebRuntimeEnvironment,
  updateStoredEnvironmentRuntimeId,
  type StoredWebRuntimeEnvironment
} from './web-runtime-environment'
import { parseWebPairingInput } from './web-pairing'
import { copyClipboardTextViaExecCommand } from './web-clipboard-copy-fallback'
import { WebRuntimeClient } from './web-runtime-client'
import { isWebRuntimeUnauthorizedError } from './web-runtime-client-error'
import { RuntimeRpcCallQueuePool } from '../../../shared/runtime-rpc-call-queue'
import {
  assertClipboardTextWriteWithinLimitWithYield,
  assertClipboardTextWithinLimitWithYield,
  type ReadClipboardTextOptions
} from '../../../shared/clipboard-text'
import {
  CLIPBOARD_IMAGE_MAX_BASE64_CHARS,
  CLIPBOARD_IMAGE_MAX_PIXELS,
  CLIPBOARD_IMAGE_MAX_SOURCE_BYTES,
  CLIPBOARD_IMAGE_TOO_LARGE_ERROR,
  assertClipboardImageByteLengthWithinLimit,
  assertClipboardImageDimensionsWithinLimit
} from '../../../shared/clipboard-image'
import { sanitizeWebRuntimeWorkspaceSession } from './web-workspace-session'
import {
  normalizeFeatureInteractions,
  type FeatureInteractionId,
  type FeatureInteractionState
} from '../../../shared/feature-interactions'
import { normalizeContextualTourIds, type ContextualTourId } from '../../../shared/contextual-tours'
import { translate } from '@/i18n/i18n'
import { translateHostAccessLinkError } from '@/lib/remote-pairing-copy'
import { getDefaultCreateProjectParent } from '@/components/sidebar/create-project-defaults'
import { createWebFileMutationMethods } from './web-file-mutation-methods'

export const SETTINGS_STORAGE_KEY = 'orca.web.settings.v1'
export const UI_STORAGE_KEY = 'orca.web.ui.v1'
export const SESSION_STORAGE_KEY = 'orca.web.workspaceSession.v1'
export const ONBOARDING_STORAGE_KEY = 'orca.web.onboarding.v1'
export const GITHUB_CACHE_STORAGE_KEY = 'orca.web.githubCache.v1'
// Why: paired web clients lack Electron env/preload state; the E2E build gate keeps URL overrides out of releases.
export const webE2EExposeStore = String(import.meta.env.VITE_EXPOSE_STORE) === 'true'
export const webE2EQuery = webE2EExposeStore ? new URLSearchParams(window.location.search) : null
export const webE2EConfig = createE2EConfig({
  exposeStore: webE2EExposeStore,
  terminalParkingDelayMs: Number(webE2EQuery?.get('orcaE2ETerminalParkingDelayMs')) || null,
  terminalRetentionLimit: Number(webE2EQuery?.get('orcaE2ETerminalRetentionLimit')) || null
})
// Why: paired clients need parity for large dev sessions; the runtime default stays capped for lower-level RPC callers.
export const WEB_RUNTIME_WORKTREE_LIST_LIMIT = 10_000
export const MAX_CLIPBOARD_IMAGE_BASE64_CHARS = CLIPBOARD_IMAGE_MAX_BASE64_CHARS
export const MAX_CLIPBOARD_IMAGE_SOURCE_BYTES = CLIPBOARD_IMAGE_MAX_SOURCE_BYTES
export const MAX_CLIPBOARD_IMAGE_PIXELS = CLIPBOARD_IMAGE_MAX_PIXELS
export const CLIPBOARD_IMAGE_UPLOAD_CHUNK_BASE64_CHARS = 512 * 1024
export const CLIPBOARD_IMAGE_SINGLE_FRAME_FALLBACK_BASE64_CHARS = 256 * 1024
export const CLIPBOARD_IMAGE_SAVE_TIMEOUT_MS = 30_000

export let activeEnvironment: StoredWebRuntimeEnvironment | null = readStoredWebRuntimeEnvironment()
export let activeClient: WebRuntimeClient | null = null
export let activeClientEnvironmentId: string | null = null
export const manuallyDisconnectedEnvironmentIds = new Set<string>()
export let cachedWorktrees: { loadedAt: number; worktrees: Worktree[] } | null = null
export let cachedDetectedWorktrees: { loadedAt: number; worktrees: Worktree[] } | null = null
export const runtimeCallQueuePool = new RuntimeRpcCallQueuePool()

export function setActiveEnvironment(value: StoredWebRuntimeEnvironment | null): void {
  activeEnvironment = value
}

export function setActiveClient(value: WebRuntimeClient | null): void {
  activeClient = value
}

export function setActiveClientEnvironmentId(value: string | null): void {
  activeClientEnvironmentId = value
}

export function setCachedWorktrees(value: typeof cachedWorktrees): void {
  cachedWorktrees = value
}

export function setCachedDetectedWorktrees(value: typeof cachedDetectedWorktrees): void {
  cachedDetectedWorktrees = value
}

export function invalidateRuntimeWorktreeCaches(): void {
  cachedWorktrees = null
  cachedDetectedWorktrees = null
}

export type WebSettingsApi = NonNullable<PreloadApi['settings']>
export type WebGitHubApi = NonNullable<PreloadApi['gh']>
export type WebGitHubResult<K extends keyof WebGitHubApi> = Awaited<ReturnType<WebGitHubApi[K]>>
export type WebRuntimeResultCaller = <TResult>(
  method: string,
  params?: unknown,
  timeoutMs?: number
) => Promise<TResult>
export type WebRuntimeEnvelopeCaller = <TResult>(
  method: string,
  params?: unknown,
  timeoutMs?: number
) => Promise<RuntimeRpcResponse<TResult>>
export type WebGitHubRouteKey =
  | 'repoSlug'
  | 'repoUpstream'
  | 'prForBranch'
  | 'issue'
  | 'workItem'
  | 'workItemByOwnerRepo'
  | 'workItemDetails'
  | 'prFileContents'
  | 'listIssues'
  | 'createIssue'
  | 'countWorkItems'
  | 'listWorkItems'
  | 'prChecks'
  | 'prCheckDetails'
  | 'rerunPRChecks'
  | 'prComments'
  | 'resolveReviewThread'
  | 'setPRFileViewed'
  | 'updatePRTitle'
  | 'mergePR'
  | 'setPRAutoMerge'
  | 'updatePRState'
  | 'requestPRReviewers'
  | 'removePRReviewers'
  | 'updateIssue'
  | 'addIssueComment'
  | 'addPRReviewCommentReply'
  | 'addPRReviewComment'
  | 'listLabels'
  | 'listAssignableUsers'
  | 'rateLimit'
  | 'listAccessibleProjects'
  | 'resolveProjectRef'
  | 'listProjectViews'
  | 'getProjectViewTable'
  | 'projectWorkItemDetailsBySlug'
  | 'updateProjectItemField'
  | 'clearProjectItemField'
  | 'updateIssueBySlug'
  | 'updatePullRequestBySlug'
  | 'addIssueCommentBySlug'
  | 'updateIssueCommentBySlug'
  | 'deleteIssueCommentBySlug'
  | 'listLabelsBySlug'
  | 'listAssignableUsersBySlug'
  | 'listIssueTypesBySlug'
  | 'updateIssueTypeBySlug'
export type WebGitHubRuntimeMethod =
  | 'github.repoSlug'
  | 'github.repoUpstream'
  | 'github.prForBranch'
  | 'github.issue'
  | 'github.workItem'
  | 'github.workItemByOwnerRepo'
  | 'github.workItemDetails'
  | 'github.prFileContents'
  | 'github.listIssues'
  | 'github.createIssue'
  | 'github.countWorkItems'
  | 'github.listWorkItems'
  | 'github.prChecks'
  | 'github.prCheckDetails'
  | 'github.rerunPRChecks'
  | 'github.prComments'
  | 'github.resolveReviewThread'
  | 'github.setPRFileViewed'
  | 'github.updatePRTitle'
  | 'github.mergePR'
  | 'github.setPRAutoMerge'
  | 'github.updatePRState'
  | 'github.requestPRReviewers'
  | 'github.removePRReviewers'
  | 'github.updateIssue'
  | 'github.addIssueComment'
  | 'github.addPRReviewCommentReply'
  | 'github.addPRReviewComment'
  | 'github.listLabels'
  | 'github.listAssignableUsers'
  | 'github.rateLimit'
  | 'github.project.listAccessible'
  | 'github.project.resolveRef'
  | 'github.project.listViews'
  | 'github.project.viewTable'
  | 'github.project.workItemDetailsBySlug'
  | 'github.project.updateItemField'
  | 'github.project.clearItemField'
  | 'github.project.updateIssueBySlug'
  | 'github.project.updatePullRequestBySlug'
  | 'github.project.addIssueCommentBySlug'
  | 'github.project.updateIssueCommentBySlug'
  | 'github.project.deleteIssueCommentBySlug'
  | 'github.project.listLabelsBySlug'
  | 'github.project.listAssignableUsersBySlug'
  | 'github.project.listIssueTypesBySlug'
  | 'github.project.updateIssueTypeBySlug'
export type WebGitLabApi = NonNullable<PreloadApi['gl']>
export type WebGitLabResult<K extends keyof WebGitLabApi> = Awaited<ReturnType<WebGitLabApi[K]>>
export type WebGitLabRouteKey =
  | 'diagnoseAuth'
  | 'rateLimit'
  | 'listMRs'
  | 'listWorkItems'
  | 'listIssues'
  | 'createIssue'
  | 'updateIssue'
  | 'addIssueComment'
  | 'listLabels'
  | 'todos'
  | 'workItemDetails'
  | 'closeMR'
  | 'reopenMR'
  | 'mergeMR'
  | 'updateMR'
  | 'updateMRReviewers'
  | 'addMRComment'
  | 'addMRInlineComment'
  | 'resolveMRDiscussion'
  | 'jobTrace'
  | 'retryJob'
  | 'workItemByPath'
export type WebGitLabRuntimeMethod =
  | 'gitlab.diagnoseAuth'
  | 'gitlab.rateLimit'
  | 'gitlab.listMRs'
  | 'gitlab.listWorkItems'
  | 'gitlab.listIssues'
  | 'gitlab.createIssue'
  | 'gitlab.updateIssue'
  | 'gitlab.addIssueComment'
  | 'gitlab.listLabels'
  | 'gitlab.todos'
  | 'gitlab.workItemDetails'
  | 'gitlab.updateMRState'
  | 'gitlab.mergeMR'
  | 'gitlab.updateMR'
  | 'gitlab.updateMRReviewers'
  | 'gitlab.addMRComment'
  | 'gitlab.addMRInlineComment'
  | 'gitlab.resolveMRDiscussion'
  | 'gitlab.jobTrace'
  | 'gitlab.retryJob'
  | 'gitlab.workItemByPath'
export const GITHUB_WEB_RPC_METHODS = {
  repoSlug: 'github.repoSlug',
  repoUpstream: 'github.repoUpstream',
  prForBranch: 'github.prForBranch',
  issue: 'github.issue',
  workItem: 'github.workItem',
  workItemByOwnerRepo: 'github.workItemByOwnerRepo',
  workItemDetails: 'github.workItemDetails',
  prFileContents: 'github.prFileContents',
  listIssues: 'github.listIssues',
  createIssue: 'github.createIssue',
  countWorkItems: 'github.countWorkItems',
  listWorkItems: 'github.listWorkItems',
  prChecks: 'github.prChecks',
  prCheckDetails: 'github.prCheckDetails',
  rerunPRChecks: 'github.rerunPRChecks',
  prComments: 'github.prComments',
  resolveReviewThread: 'github.resolveReviewThread',
  setPRFileViewed: 'github.setPRFileViewed',
  updatePRTitle: 'github.updatePRTitle',
  mergePR: 'github.mergePR',
  setPRAutoMerge: 'github.setPRAutoMerge',
  updatePRState: 'github.updatePRState',
  requestPRReviewers: 'github.requestPRReviewers',
  removePRReviewers: 'github.removePRReviewers',
  updateIssue: 'github.updateIssue',
  addIssueComment: 'github.addIssueComment',
  addPRReviewCommentReply: 'github.addPRReviewCommentReply',
  addPRReviewComment: 'github.addPRReviewComment',
  listLabels: 'github.listLabels',
  listAssignableUsers: 'github.listAssignableUsers',
  rateLimit: 'github.rateLimit',
  listAccessibleProjects: 'github.project.listAccessible',
  resolveProjectRef: 'github.project.resolveRef',
  listProjectViews: 'github.project.listViews',
  getProjectViewTable: 'github.project.viewTable',
  projectWorkItemDetailsBySlug: 'github.project.workItemDetailsBySlug',
  updateProjectItemField: 'github.project.updateItemField',
  clearProjectItemField: 'github.project.clearItemField',
  updateIssueBySlug: 'github.project.updateIssueBySlug',
  updatePullRequestBySlug: 'github.project.updatePullRequestBySlug',
  addIssueCommentBySlug: 'github.project.addIssueCommentBySlug',
  updateIssueCommentBySlug: 'github.project.updateIssueCommentBySlug',
  deleteIssueCommentBySlug: 'github.project.deleteIssueCommentBySlug',
  listLabelsBySlug: 'github.project.listLabelsBySlug',
  listAssignableUsersBySlug: 'github.project.listAssignableUsersBySlug',
  listIssueTypesBySlug: 'github.project.listIssueTypesBySlug',
  updateIssueTypeBySlug: 'github.project.updateIssueTypeBySlug'
} as const satisfies Record<WebGitHubRouteKey, WebGitHubRuntimeMethod>

export const GITLAB_WEB_RPC_METHODS = {
  diagnoseAuth: 'gitlab.diagnoseAuth',
  rateLimit: 'gitlab.rateLimit',
  listMRs: 'gitlab.listMRs',
  listWorkItems: 'gitlab.listWorkItems',
  listIssues: 'gitlab.listIssues',
  createIssue: 'gitlab.createIssue',
  updateIssue: 'gitlab.updateIssue',
  addIssueComment: 'gitlab.addIssueComment',
  listLabels: 'gitlab.listLabels',
  todos: 'gitlab.todos',
  workItemDetails: 'gitlab.workItemDetails',
  closeMR: 'gitlab.updateMRState',
  reopenMR: 'gitlab.updateMRState',
  mergeMR: 'gitlab.mergeMR',
  updateMR: 'gitlab.updateMR',
  updateMRReviewers: 'gitlab.updateMRReviewers',
  addMRComment: 'gitlab.addMRComment',
  addMRInlineComment: 'gitlab.addMRInlineComment',
  resolveMRDiscussion: 'gitlab.resolveMRDiscussion',
  jobTrace: 'gitlab.jobTrace',
  retryJob: 'gitlab.retryJob',
  workItemByPath: 'gitlab.workItemByPath'
} as const satisfies Record<WebGitLabRouteKey, WebGitLabRuntimeMethod>

export function installWebPreloadApi(): void {
  activeEnvironment = readStoredWebRuntimeEnvironment()
  const webWindow = window as unknown as { __ORCA_WEB_CLIENT__?: boolean }
  webWindow.__ORCA_WEB_CLIENT__ = true
  window.electron = createFallbackProxy(['electron']) as Window['electron']
  window.api = withFallback(createWebPreloadApi(), []) as PreloadApi
}

export {
  blobToBase64,
  assertClipboardImageBlobWithinLimit,
  convertImageBlobToPng,
  readClipboardImagePngBase64,
  writeWebClipboardText
} from './web-preload-clipboard'
export { createWebPreloadApi } from './web-preload-api-factory'
export {
  createRuntimeApi,
  createRuntimeEnvironmentsApi,
  createAiVaultApi,
  webAiVaultUnavailableResult
} from './web-preload-runtime-apis'
export { createReposApi, createWorktreesApi } from './web-preload-repository-apis'
export {
  createFileApi,
  webGitStatusAbortControllers,
  callAbortableRuntimeStatus
} from './web-preload-file-apis'
export { createGitApi } from './web-preload-git-apis'
export { createBrowserApi, createEmulatorApi } from './web-preload-browser-api'
export {
  createGitHubApi,
  createGitLabApi,
  createRuntimeNamespaceApi
} from './web-preload-review-provider-apis'
export { createHooksApi, createWebUiApi } from './web-preload-ui-apis'
export {
  createPreflightApi,
  createCliApi,
  createAgentHooksApi,
  createMacosTccPromptsApi,
  createDeveloperPermissionsApi,
  createSkillsApi,
  createNotificationsApi,
  createRateLimitsApi,
  createMiniMaxCredentialsApi,
  createGrokAccountsApi
} from './web-preload-capability-apis'
export {
  createAccountsApi,
  createUpdaterApi,
  createShellApi,
  createPtyApi,
  createSshApi
} from './web-preload-integration-apis'
export {
  callRuntimeEnvelope,
  callEnvironmentEnvelope,
  callRuntimeResult,
  callRuntimeResultWithOwner,
  withRuntimeRepoOwner,
  withRuntimeRepoMutationOwner,
  withRuntimeWorktreeOwner,
  captureWebFileMutationSession,
  saveClipboardImageAsTempFileInRuntime,
  getRemoteRuntimeStatus,
  getClientForEnvironment,
  closeActiveRuntimeClients,
  disconnectActiveRuntimeEnvironment,
  removeActiveRuntimeEnvironment,
  manuallyDisconnectedResponse,
  resolveEnvironment,
  requireActiveEnvironment,
  requireActiveEnvironmentOrNull,
  assertActiveEnvironment,
  updateEnvironmentFromResponse
} from './web-preload-runtime-bridge'
export {
  getStoredSettings,
  writeStoredSettings,
  getRuntimeBackedStoredSettings,
  syncRuntimeBackedSettings
} from './web-preload-settings-persistence'
export {
  updateRuntimePRBotAuthorOverride,
  getStoredOnboarding,
  sessionStorageKeyForHost,
  getStoredWorkspaceSession,
  closeWebOnboarding,
  readLocalWebUIState,
  mergeWebUIState,
  mergeFeatureInteractionState,
  mergeContextualTourSeenIds,
  mergeOsc52ClipboardNoticePending,
  mergeSettings
} from './web-preload-session-persistence'
export {
  listAllRuntimeWorktrees,
  listAllRuntimeDetectedWorktrees,
  callRuntimeDetectedWorktrees,
  toLegacyDetectedWorktreeResult,
  isMissingPathError,
  resolveRuntimeWorktreeByPath,
  resolveRuntimeFilePath,
  mutateGitPath,
  mutateGitPaths,
  mapRepoPathArg,
  mapRuntimeNamespaceArg
} from './web-preload-worktree-operations'
export {
  createEmptyMemorySnapshot,
  getBrowserPlatform,
  readJson,
  writeJson,
  cloneJson,
  withFallback,
  createFallbackProxy,
  getFallbackResult,
  noopUnsubscribe
} from './web-preload-fallbacks'
