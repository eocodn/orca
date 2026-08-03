import type {
  PreloadApi,
  PreflightStatus,
  RefreshAgentsResult,
  NativeChatApi,
  NativeChatAppendedMessages
} from '../../../preload/api-types'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import { parseHostAccessLink } from '../../../shared/remote-pairing-address'
import { verifyRemotePairingRuntimeStatus } from '../../../shared/remote-pairing-verification'
import type { AiVaultListArgs, AiVaultListResult } from '../../../shared/ai-vault-types'
import type {
  AiVaultPrepareSessionResumeArgs,
  AiVaultPrepareSessionResumeResult
} from '../../../shared/ai-vault-resume-preparation'
import { buildNativeChatUnsubscribe } from '../../../shared/native-chat-stream-unsubscribe'
import type {
  ComputerUsePermissionSetupResult,
  ComputerUsePermissionStatusResult
} from '../../../shared/computer-use-permissions-types'
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
import {
  RuntimeRpcCallCanceledError,
  RuntimeRpcCallQueuePool
} from '../../../shared/runtime-rpc-call-queue'
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
import {
  parseRuntimeNativeChatReadSessionResult,
  parseRuntimeNativeChatTurnLifecycle
} from '@/components/native-chat/native-chat-runtime-contract'
import { createWebFileMutationMethods } from './web-file-mutation-methods'

import { createWebKeybindingsApi } from './web-preload-keybindings'

import { SETTINGS_STORAGE_KEY, UI_STORAGE_KEY, SESSION_STORAGE_KEY, ONBOARDING_STORAGE_KEY, GITHUB_CACHE_STORAGE_KEY, webE2EExposeStore, webE2EQuery, webE2EConfig, WEB_RUNTIME_WORKTREE_LIST_LIMIT, MAX_CLIPBOARD_IMAGE_BASE64_CHARS, MAX_CLIPBOARD_IMAGE_SOURCE_BYTES, MAX_CLIPBOARD_IMAGE_PIXELS, CLIPBOARD_IMAGE_UPLOAD_CHUNK_BASE64_CHARS, CLIPBOARD_IMAGE_SINGLE_FRAME_FALLBACK_BASE64_CHARS, CLIPBOARD_IMAGE_SAVE_TIMEOUT_MS, activeEnvironment, activeClient, activeClientEnvironmentId, manuallyDisconnectedEnvironmentIds, cachedWorktrees, cachedDetectedWorktrees, runtimeCallQueuePool, blobToBase64, assertClipboardImageBlobWithinLimit, convertImageBlobToPng, readClipboardImagePngBase64, invalidateRuntimeWorktreeCaches, GITHUB_WEB_RPC_METHODS, GITLAB_WEB_RPC_METHODS, installWebPreloadApi, writeWebClipboardText, createWebPreloadApi, createNativeChatApi, createRuntimeApi, createRuntimeEnvironmentsApi, createAiVaultApi, webAiVaultUnavailableResult, createReposApi, createWorktreesApi, createFileApi, webGitStatusAbortControllers, callAbortableRuntimeStatus, createGitApi, createBrowserApi, createEmulatorApi, createGitHubApi, createGitLabApi, createRuntimeNamespaceApi, createHooksApi, createWebUiApi, createPreflightApi, createCliApi, createAgentHooksApi, createMacosTccPromptsApi, createDeveloperPermissionsApi, createComputerUsePermissionsApi, createSkillsApi, createNotificationsApi, createRateLimitsApi, createMiniMaxCredentialsApi, createGrokAccountsApi, createAccountsApi, createUpdaterApi, createShellApi, createPtyApi, createSshApi, getStoredSettings, writeStoredSettings, getRuntimeBackedStoredSettings, syncRuntimeBackedSettings, updateRuntimePRBotAuthorOverride, getStoredOnboarding, sessionStorageKeyForHost, getStoredWorkspaceSession, closeWebOnboarding, readLocalWebUIState, mergeWebUIState, mergeFeatureInteractionState, mergeContextualTourSeenIds, mergeOsc52ClipboardNoticePending, mergeSettings, listAllRuntimeWorktrees, listAllRuntimeDetectedWorktrees, callRuntimeDetectedWorktrees, toLegacyDetectedWorktreeResult, isMissingPathError, resolveRuntimeWorktreeByPath, resolveRuntimeFilePath, mutateGitPath, mutateGitPaths, mapRepoPathArg, mapRuntimeNamespaceArg, createEmptyMemorySnapshot, getBrowserPlatform, readJson, writeJson, cloneJson, withFallback, createFallbackProxy, getFallbackResult, noopUnsubscribe, type WebSettingsApi, type WebGitHubApi, type WebGitHubResult, type WebRuntimeResultCaller, type WebRuntimeEnvelopeCaller, type WebGitHubRouteKey, type WebGitHubRuntimeMethod, type WebGitLabApi, type WebGitLabResult, type WebGitLabRouteKey, type WebGitLabRuntimeMethod } from './web-preload-compatibility'

const WEB_RUNTIME_PAIRING_CHANGED_ERROR =
  'Runtime environment pairing changed; refresh and try again'

let runtimeEnvironmentGeneration = 0

function isCurrentRuntimeEnvironment(
  environment: StoredWebRuntimeEnvironment,
  generation: number
): boolean {
  return activeEnvironment?.id === environment.id && runtimeEnvironmentGeneration === generation
}

function assertCurrentRuntimeEnvironment(
  environment: StoredWebRuntimeEnvironment,
  generation: number
): void {
  if (!isCurrentRuntimeEnvironment(environment, generation)) {
    throw new RuntimeRpcCallCanceledError(environment.id, generation)
  }
}

function mapCanceledRuntimeCall(
  error: unknown,
  environment: StoredWebRuntimeEnvironment,
  generation: number
): RuntimeRpcResponse<never> | never {
  if (!(error instanceof RuntimeRpcCallCanceledError) || error.generation !== generation) {
    throw error
  }
  if (manuallyDisconnectedEnvironmentIds.has(environment.id)) {
    return manuallyDisconnectedResponse(environment)
  }
  throw new Error(WEB_RUNTIME_PAIRING_CHANGED_ERROR)
}

export async function callRuntimeEnvelope<TResult = unknown>(
  method: string,
  params?: unknown,
  timeoutMs?: number
): Promise<RuntimeRpcResponse<TResult>> {
  const environment = requireActiveEnvironment()
  if (manuallyDisconnectedEnvironmentIds.has(environment.id)) {
    return manuallyDisconnectedResponse(environment)
  }
  const generation = runtimeEnvironmentGeneration
  const response = await runtimeCallQueuePool
    .enqueue(
      environment.id,
      method,
      () => {
        assertCurrentRuntimeEnvironment(environment, generation)
        if (manuallyDisconnectedEnvironmentIds.has(environment.id)) {
          return Promise.resolve(manuallyDisconnectedResponse(environment))
        }
        return getClientForEnvironment(environment).call(method, params, { timeoutMs })
      },
      0,
      generation
    )
    .catch((error: unknown) => mapCanceledRuntimeCall(error, environment, generation))
  if (manuallyDisconnectedEnvironmentIds.has(environment.id)) {
    return manuallyDisconnectedResponse(environment)
  }
  updateEnvironmentFromResponse(environment, response)
  return response as RuntimeRpcResponse<TResult>
}
export async function callEnvironmentEnvelope<TResult = unknown>(
  selector: string,
  method: string,
  params?: unknown,
  timeoutMs?: number
): Promise<RuntimeRpcResponse<TResult>> {
  const environment = resolveEnvironment(selector)
  if (manuallyDisconnectedEnvironmentIds.has(environment.id)) {
    return manuallyDisconnectedResponse(environment)
  }
  const generation = runtimeEnvironmentGeneration
  const response = await runtimeCallQueuePool
    .enqueue(
      environment.id,
      method,
      () => {
        assertCurrentRuntimeEnvironment(environment, generation)
        if (manuallyDisconnectedEnvironmentIds.has(environment.id)) {
          return Promise.resolve(manuallyDisconnectedResponse(environment))
        }
        return getClientForEnvironment(environment).call(method, params, { timeoutMs })
      },
      0,
      generation
    )
    .catch((error: unknown) => mapCanceledRuntimeCall(error, environment, generation))
  if (manuallyDisconnectedEnvironmentIds.has(environment.id)) {
    return manuallyDisconnectedResponse(environment)
  }
  updateEnvironmentFromResponse(environment, response)
  return response as RuntimeRpcResponse<TResult>
}

export async function callRuntimeResult<TResult>(
  method: string,
  params?: unknown,
  timeoutMs?: number
): Promise<TResult> {
  const response = await callRuntimeEnvelope(method, params, timeoutMs)
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return response.result as TResult
}

export async function callRuntimeResultWithOwner<TResult>(
  method: string,
  params?: unknown,
  timeoutMs?: number
): Promise<{ result: TResult; hostId: ExecutionHostId; environmentId: string }> {
  const environmentId = requireActiveEnvironment().id
  const result = await callRuntimeResult<TResult>(method, params, timeoutMs)
  return { result, hostId: toRuntimeExecutionHostId(environmentId), environmentId }
}

export function withRuntimeRepoOwner(repo: Repo, hostId: ExecutionHostId): Repo {
  return { ...repo, executionHostId: hostId }
}

export function withRuntimeRepoMutationOwner(
  result: { repo: Repo } | { error: string },
  hostId: ExecutionHostId
): { repo: Repo } | { error: string } {
  return 'repo' in result ? { ...result, repo: withRuntimeRepoOwner(result.repo, hostId) } : result
}

export function withRuntimeWorktreeOwner<T extends Worktree>(worktree: T, hostId: ExecutionHostId): T {
  const runtimeOwner = parseExecutionHostId(hostId)
  if (runtimeOwner?.kind !== 'runtime') {
    return worktree
  }
  return { ...worktree, runtimeOwnerEnvironmentId: runtimeOwner.environmentId }
}

export function captureWebFileMutationSession(): {
  resolveFilePath: (filePath: string) => Promise<Awaited<ReturnType<typeof resolveRuntimeFilePath>>>
  assertMutationSupported: () => Promise<void>
  callRuntimeResult: WebRuntimeResultCaller
  getSshState: (targetId: string) => Promise<SshConnectionState | null>
} {
  const environment = requireActiveEnvironment()
  const client = getClientForEnvironment(environment)
  const generation = runtimeEnvironmentGeneration
  const assertCurrent = (): void => {
    if (
      activeClient !== client ||
      !isCurrentRuntimeEnvironment(environment, generation) ||
      requireActiveEnvironmentOrNull()?.id !== environment.id
    ) {
      throw new Error('Runtime pairing changed; refresh and try again')
    }
  }
  const callBoundRuntimeEnvelope: WebRuntimeEnvelopeCaller = async <TResult>(
    method: string,
    params?: unknown,
    timeoutMs?: number
  ): Promise<RuntimeRpcResponse<TResult>> => {
    assertCurrent()
    const response = await runtimeCallQueuePool
      .enqueue(
        environment.id,
        method,
        () => {
          assertCurrent()
          return client.call(method, params, { timeoutMs })
        },
        0,
        generation
      )
      .catch((error: unknown) => {
        if (error instanceof RuntimeRpcCallCanceledError && error.generation === generation) {
          throw new Error('Runtime pairing changed; refresh and try again')
        }
        throw error
      })
    assertCurrent()
    updateEnvironmentFromResponse(environment, response)
    return response as RuntimeRpcResponse<TResult>
  }
  const callBoundRuntimeResult: WebRuntimeResultCaller = async <TResult>(
    method: string,
    params?: unknown,
    timeoutMs?: number
  ): Promise<TResult> => {
    const response = await callBoundRuntimeEnvelope<TResult>(method, params, timeoutMs)
    if (!response.ok) {
      throw new Error(response.error.message)
    }
    return response.result as TResult
  }
  return {
    resolveFilePath: (filePath) =>
      resolveRuntimeFilePath(
        filePath,
        undefined,
        callBoundRuntimeResult,
        callBoundRuntimeEnvelope,
        false,
        environment.id
      ),
    assertMutationSupported: async () => {
      assertFileMutationOwnershipCapability(
        await callBoundRuntimeResult<RuntimeStatus>('status.get', undefined, 15_000)
      )
    },
    callRuntimeResult: callBoundRuntimeResult,
    getSshState: async (targetId) =>
      (
        await callBoundRuntimeResult<{ state: SshConnectionState | null }>('ssh.getState', {
          targetId
        })
      ).state
  }
}

export async function saveClipboardImageAsTempFileInRuntime(
  contentBase64: string,
  args?: { connectionId?: string | null; runtimeEnvironmentId?: string | null }
): Promise<string> {
  if (contentBase64.length > MAX_CLIPBOARD_IMAGE_BASE64_CHARS) {
    throw new Error(CLIPBOARD_IMAGE_TOO_LARGE_ERROR)
  }
  const connectionId = args?.connectionId ?? null
  const startResponse = await callRuntimeEnvelope<{ uploadId: string }>(
    'clipboard.startImageUpload',
    { expectedBase64Length: contentBase64.length, connectionId },
    CLIPBOARD_IMAGE_SAVE_TIMEOUT_MS
  )
  if (!startResponse.ok) {
    if (
      startResponse.error.code === 'method_not_found' &&
      contentBase64.length <= CLIPBOARD_IMAGE_SINGLE_FRAME_FALLBACK_BASE64_CHARS
    ) {
      return callRuntimeResult<string>(
        'clipboard.saveImageAsTempFile',
        { contentBase64, connectionId },
        CLIPBOARD_IMAGE_SAVE_TIMEOUT_MS
      )
    }
    throw new Error(startResponse.error.message)
  }

  const { uploadId } = startResponse.result
  try {
    for (
      let offset = 0;
      offset < contentBase64.length;
      offset += CLIPBOARD_IMAGE_UPLOAD_CHUNK_BASE64_CHARS
    ) {
      await callRuntimeResult(
        'clipboard.appendImageUploadChunk',
        {
          uploadId,
          offset,
          contentBase64: contentBase64.slice(
            offset,
            offset + CLIPBOARD_IMAGE_UPLOAD_CHUNK_BASE64_CHARS
          )
        },
        CLIPBOARD_IMAGE_SAVE_TIMEOUT_MS
      )
    }
    return await callRuntimeResult<string>(
      'clipboard.commitImageUpload',
      { uploadId },
      CLIPBOARD_IMAGE_SAVE_TIMEOUT_MS
    )
  } catch (error) {
    // Why: after chunked paste holds server-side state, release the bounded slot on failure rather than wait for TTL cleanup.
    await callRuntimeResult(
      'clipboard.abortImageUpload',
      { uploadId },
      CLIPBOARD_IMAGE_SAVE_TIMEOUT_MS
    ).catch(() => {})
    throw error
  }
}

export async function getRemoteRuntimeStatus(): Promise<RuntimeStatus> {
  return callRuntimeResult<RuntimeStatus>('status.get', undefined, 15_000)
}

export function getClientForEnvironment(environment: StoredWebRuntimeEnvironment): WebRuntimeClient {
  if (manuallyDisconnectedEnvironmentIds.has(environment.id)) {
    throw new Error('runtime_manually_disconnected')
  }
  if (!activeClient || activeClientEnvironmentId !== environment.id) {
    activeClient?.close()
    activeClient = new WebRuntimeClient(getPreferredWebPairingOffer(environment))
    activeClientEnvironmentId = environment.id
  }
  return activeClient
}

export function closeActiveRuntimeClients(): void {
  const environment = activeEnvironment
  const generation = runtimeEnvironmentGeneration
  runtimeEnvironmentGeneration += 1
  if (environment) {
    runtimeCallQueuePool.cancelQueued(
      environment.id,
      generation,
      new RuntimeRpcCallCanceledError(environment.id, generation)
    )
  }
  activeClient?.close()
  activeClient = null
  activeClientEnvironmentId = null
  invalidateRuntimeWorktreeCaches()
}

export function disconnectActiveRuntimeEnvironment(): void {
  closeActiveRuntimeClients()
}

export function removeActiveRuntimeEnvironment(): void {
  disconnectActiveRuntimeEnvironment()
  clearStoredWebRuntimeEnvironment()
  activeEnvironment = null
}

export function manuallyDisconnectedResponse(
  environment: StoredWebRuntimeEnvironment
): RuntimeRpcResponse<never> {
  return {
    id: 'runtime.manualDisconnect',
    ok: false,
    error: {
      code: 'runtime_manually_disconnected',
      message: translate(
        'auto.web.webPreloadApi.runtimeEnvironmentManuallyDisconnected',
        'Runtime environment is manually disconnected.'
      )
    },
    _meta: { runtimeId: environment.runtimeId }
  }
}

export function resolveEnvironment(selector: string): StoredWebRuntimeEnvironment {
  const environment = requireActiveEnvironment()
  if (selector === environment.id || selector === environment.name || selector === 'active') {
    return environment
  }
  if (environment.compatibleEnvironmentIds?.includes(selector)) {
    return environment
  }
  throw new Error(`Unknown Orca runtime environment: ${selector}`)
}

export function requireActiveEnvironment(): StoredWebRuntimeEnvironment {
  activeEnvironment = activeEnvironment ?? readStoredWebRuntimeEnvironment()
  if (!activeEnvironment) {
    throw new Error('Pair this web client with an Orca server first.')
  }
  return activeEnvironment
}

export function requireActiveEnvironmentOrNull(): StoredWebRuntimeEnvironment | null {
  activeEnvironment = activeEnvironment ?? readStoredWebRuntimeEnvironment()
  return activeEnvironment
}

export function assertActiveEnvironment(environmentId: string): void {
  if (requireActiveEnvironment().id !== environmentId) {
    throw new Error('The paired Orca server changed while the request was in progress.')
  }
}

export function updateEnvironmentFromResponse(
  environment: StoredWebRuntimeEnvironment,
  response: RuntimeRpcResponse<unknown>
): void {
  if (activeEnvironment?.id !== environment.id) {
    return
  }
  const runtimeId = response.ok ? response._meta.runtimeId : (response._meta?.runtimeId ?? null)
  activeEnvironment = updateStoredEnvironmentRuntimeId(environment, runtimeId)
}
