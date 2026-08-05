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

import { createWebKeybindingsApi } from './web-preload-keybindings'

import {
  SETTINGS_STORAGE_KEY,
  UI_STORAGE_KEY,
  SESSION_STORAGE_KEY,
  ONBOARDING_STORAGE_KEY,
  GITHUB_CACHE_STORAGE_KEY,
  webE2EExposeStore,
  webE2EQuery,
  webE2EConfig,
  WEB_RUNTIME_WORKTREE_LIST_LIMIT,
  MAX_CLIPBOARD_IMAGE_BASE64_CHARS,
  MAX_CLIPBOARD_IMAGE_SOURCE_BYTES,
  MAX_CLIPBOARD_IMAGE_PIXELS,
  CLIPBOARD_IMAGE_UPLOAD_CHUNK_BASE64_CHARS,
  CLIPBOARD_IMAGE_SINGLE_FRAME_FALLBACK_BASE64_CHARS,
  CLIPBOARD_IMAGE_SAVE_TIMEOUT_MS,
  activeEnvironment,
  activeClient,
  activeClientEnvironmentId,
  manuallyDisconnectedEnvironmentIds,
  cachedWorktrees,
  cachedDetectedWorktrees,
  runtimeCallQueuePool,
  blobToBase64,
  assertClipboardImageBlobWithinLimit,
  convertImageBlobToPng,
  readClipboardImagePngBase64,
  invalidateRuntimeWorktreeCaches,
  GITHUB_WEB_RPC_METHODS,
  GITLAB_WEB_RPC_METHODS,
  installWebPreloadApi,
  writeWebClipboardText,
  createWebPreloadApi,
  createRuntimeApi,
  createRuntimeEnvironmentsApi,
  createAiVaultApi,
  webAiVaultUnavailableResult,
  createReposApi,
  createWorktreesApi,
  createFileApi,
  webGitStatusAbortControllers,
  callAbortableRuntimeStatus,
  createGitApi,
  createBrowserApi,
  createEmulatorApi,
  createGitHubApi,
  createGitLabApi,
  createRuntimeNamespaceApi,
  createHooksApi,
  createWebUiApi,
  createPreflightApi,
  createCliApi,
  createAgentHooksApi,
  createMacosTccPromptsApi,
  createDeveloperPermissionsApi,
  createSkillsApi,
  createNotificationsApi,
  createRateLimitsApi,
  createMiniMaxCredentialsApi,
  createGrokAccountsApi,
  createAccountsApi,
  createUpdaterApi,
  createShellApi,
  createPtyApi,
  createSshApi,
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
  updateEnvironmentFromResponse,
  getStoredSettings,
  writeStoredSettings,
  getRuntimeBackedStoredSettings,
  syncRuntimeBackedSettings,
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
  mergeSettings,
  createEmptyMemorySnapshot,
  getBrowserPlatform,
  readJson,
  writeJson,
  cloneJson,
  withFallback,
  createFallbackProxy,
  getFallbackResult,
  noopUnsubscribe,
  type WebSettingsApi,
  type WebGitHubApi,
  type WebGitHubResult,
  type WebRuntimeResultCaller,
  type WebRuntimeEnvelopeCaller,
  type WebGitHubRouteKey,
  type WebGitHubRuntimeMethod,
  type WebGitLabApi,
  type WebGitLabResult,
  type WebGitLabRouteKey,
  type WebGitLabRuntimeMethod
} from './web-preload-compatibility'

import { setCachedDetectedWorktrees, setCachedWorktrees } from './web-preload-compatibility'

export async function listAllRuntimeWorktrees(): Promise<Worktree[]> {
  if (cachedWorktrees && Date.now() - cachedWorktrees.loadedAt < 5_000) {
    return cachedWorktrees.worktrees
  }
  const owned = await callRuntimeResultWithOwner<{ worktrees: Worktree[] }>('worktree.list', {
    limit: WEB_RUNTIME_WORKTREE_LIST_LIMIT
  })
  const worktrees = owned.result.worktrees.map((worktree) =>
    withRuntimeWorktreeOwner(worktree, owned.hostId)
  )
  assertActiveEnvironment(owned.environmentId)
  setCachedWorktrees({ loadedAt: Date.now(), worktrees })
  return worktrees
}
export async function listAllRuntimeDetectedWorktrees(
  callResult: WebRuntimeResultCaller = callRuntimeResult,
  callEnvelope: WebRuntimeEnvelopeCaller = callRuntimeEnvelope,
  useCache = true,
  expectedEnvironmentId = requireActiveEnvironment().id
): Promise<Worktree[]> {
  if (
    useCache &&
    cachedDetectedWorktrees &&
    Date.now() - cachedDetectedWorktrees.loadedAt < 5_000
  ) {
    return cachedDetectedWorktrees.worktrees
  }

  assertActiveEnvironment(expectedEnvironmentId)
  const repos = (await callResult<{ repos: Repo[] }>('repo.list')).repos
  const detectedLists = await Promise.all(
    repos.map((repo) =>
      callRuntimeDetectedWorktrees(repo.id, expectedEnvironmentId, callResult, callEnvelope)
    )
  )
  const worktrees = detectedLists.flatMap((result) => result.worktrees)
  assertActiveEnvironment(expectedEnvironmentId)
  if (useCache) {
    setCachedDetectedWorktrees({ loadedAt: Date.now(), worktrees })
  }
  return worktrees
}

export async function callRuntimeDetectedWorktrees(
  repoId: string,
  expectedEnvironmentId = requireActiveEnvironment().id,
  callResult: WebRuntimeResultCaller = callRuntimeResult,
  callEnvelope: WebRuntimeEnvelopeCaller = callRuntimeEnvelope
): Promise<DetectedWorktreeListResult> {
  assertActiveEnvironment(expectedEnvironmentId)
  const hostId = toRuntimeExecutionHostId(expectedEnvironmentId)
  const response = await callEnvelope<DetectedWorktreeListResult>(
    'worktree.detectedList',
    { repo: repoId },
    15_000
  )
  if (response.ok) {
    return {
      ...response.result,
      worktrees: response.result.worktrees.map((worktree) =>
        withRuntimeWorktreeOwner(worktree, hostId)
      )
    }
  }
  if (response.error.code !== 'method_not_found') {
    throw new Error(response.error.message)
  }

  assertActiveEnvironment(expectedEnvironmentId)
  const legacy = await callResult<{ worktrees: Worktree[] }>(
    'worktree.list',
    { repo: repoId, limit: WEB_RUNTIME_WORKTREE_LIST_LIMIT },
    15_000
  )
  return toLegacyDetectedWorktreeResult(
    repoId,
    legacy.worktrees.map((worktree) => withRuntimeWorktreeOwner(worktree, hostId))
  )
}

export function toLegacyDetectedWorktreeResult(
  repoId: string,
  worktrees: Worktree[]
): DetectedWorktreeListResult {
  return {
    repoId,
    authoritative: true,
    source: 'session-fallback',
    worktrees: worktrees.map((worktree) => ({
      ...worktree,
      ownership: 'orca-managed',
      selectedCheckout: false,
      visible: true
    }))
  }
}

export function isMissingPathError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  return /\bENOENT\b|not found|no such file/i.test(error.message)
}

export async function resolveRuntimeWorktreeByPath(
  worktreePath: string,
  callResult: WebRuntimeResultCaller = callRuntimeResult,
  callEnvelope: WebRuntimeEnvelopeCaller = callRuntimeEnvelope,
  useDetectedWorktreeCache = true,
  expectedEnvironmentId = requireActiveEnvironment().id
): Promise<Worktree> {
  // Why: hidden-but-open worktrees must still resolve, but `worktree.list` is sidebar-visible only — resolve via detected rows.
  const worktrees = await listAllRuntimeDetectedWorktrees(
    callResult,
    callEnvelope,
    useDetectedWorktreeCache,
    expectedEnvironmentId
  )
  const match = worktrees
    .map((worktree) => ({
      worktree,
      relativePath: relativePathInsideRoot(worktree.path, worktreePath)
    }))
    .filter((entry) => entry.relativePath !== null)
    .sort((a, b) => b.worktree.path.length - a.worktree.path.length)[0]
  if (!match) {
    throw new Error(`No runtime worktree owns ${worktreePath}`)
  }
  return match.worktree
}

export async function resolveRuntimeFilePath(
  filePath: string,
  preferredWorktreePath?: string,
  callResult: WebRuntimeResultCaller = callRuntimeResult,
  callEnvelope: WebRuntimeEnvelopeCaller = callRuntimeEnvelope,
  useDetectedWorktreeCache = true,
  expectedEnvironmentId = requireActiveEnvironment().id
): Promise<{ worktree: Worktree; relativePath: string }> {
  const worktree = preferredWorktreePath
    ? await resolveRuntimeWorktreeByPath(
        preferredWorktreePath,
        callResult,
        callEnvelope,
        useDetectedWorktreeCache,
        expectedEnvironmentId
      )
    : await resolveRuntimeWorktreeByPath(
        filePath,
        callResult,
        callEnvelope,
        useDetectedWorktreeCache,
        expectedEnvironmentId
      )
  const relativePath = relativePathInsideRoot(worktree.path, filePath)
  if (relativePath === null) {
    throw new Error(`File is outside runtime worktree: ${filePath}`)
  }
  return { worktree, relativePath }
}

export async function mutateGitPath(
  method: string,
  worktreePath: string,
  filePath: string
): Promise<void> {
  const file = await resolveRuntimeFilePath(filePath, worktreePath)
  await callRuntimeResult(method, {
    worktree: toRuntimeWorktreeSelector(file.worktree.id),
    filePath: file.relativePath
  })
}

export async function mutateGitPaths(
  method: string,
  worktreePath: string,
  filePaths: string[]
): Promise<void> {
  const worktree = await resolveRuntimeWorktreeByPath(worktreePath)
  await callRuntimeResult(method, { worktree: toRuntimeWorktreeSelector(worktree.id), filePaths })
}

export function mapRepoPathArg(args: unknown): unknown {
  if (!args || typeof args !== 'object' || !('repoPath' in args)) {
    return args
  }
  const record = args as Record<string, unknown>
  const repoId = typeof record.repoId === 'string' && record.repoId.trim() ? record.repoId : null
  return {
    ...record,
    // Why: duplicate checked-out repos make path/name selectors ambiguous; prefer the explicit repo id the renderer passes.
    repo: repoId ? `id:${repoId}` : record.repoPath
  }
}

export function mapRuntimeNamespaceArg(prefix: string, args: unknown): unknown {
  if (prefix !== 'hostedReview') {
    return args
  }
  return mapRepoPathArg(args)
}
