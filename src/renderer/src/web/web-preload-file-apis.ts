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
import {
  parseRuntimeNativeChatReadSessionResult,
  parseRuntimeNativeChatTurnLifecycle
} from '@/components/native-chat/native-chat-runtime-contract'
import { createWebFileMutationMethods } from './web-file-mutation-methods'

import { createWebKeybindingsApi } from './web-preload-keybindings'

import { SETTINGS_STORAGE_KEY, UI_STORAGE_KEY, SESSION_STORAGE_KEY, ONBOARDING_STORAGE_KEY, GITHUB_CACHE_STORAGE_KEY, webE2EExposeStore, webE2EQuery, webE2EConfig, WEB_RUNTIME_WORKTREE_LIST_LIMIT, MAX_CLIPBOARD_IMAGE_BASE64_CHARS, MAX_CLIPBOARD_IMAGE_SOURCE_BYTES, MAX_CLIPBOARD_IMAGE_PIXELS, CLIPBOARD_IMAGE_UPLOAD_CHUNK_BASE64_CHARS, CLIPBOARD_IMAGE_SINGLE_FRAME_FALLBACK_BASE64_CHARS, CLIPBOARD_IMAGE_SAVE_TIMEOUT_MS, activeEnvironment, activeClient, activeClientEnvironmentId, manuallyDisconnectedEnvironmentIds, cachedWorktrees, cachedDetectedWorktrees, runtimeCallQueuePool, blobToBase64, assertClipboardImageBlobWithinLimit, convertImageBlobToPng, readClipboardImagePngBase64, invalidateRuntimeWorktreeCaches, GITHUB_WEB_RPC_METHODS, GITLAB_WEB_RPC_METHODS, installWebPreloadApi, writeWebClipboardText, createWebPreloadApi, createNativeChatApi, createRuntimeApi, createRuntimeEnvironmentsApi, createAiVaultApi, webAiVaultUnavailableResult, createReposApi, createWorktreesApi, createGitApi, createBrowserApi, createEmulatorApi, createGitHubApi, createGitLabApi, createRuntimeNamespaceApi, createHooksApi, createWebUiApi, createPreflightApi, createCliApi, createAgentHooksApi, createMacosTccPromptsApi, createDeveloperPermissionsApi, createComputerUsePermissionsApi, createSkillsApi, createNotificationsApi, createRateLimitsApi, createMiniMaxCredentialsApi, createGrokAccountsApi, createAccountsApi, createUpdaterApi, createShellApi, createPtyApi, createSshApi, callRuntimeEnvelope, callEnvironmentEnvelope, callRuntimeResult, callRuntimeResultWithOwner, withRuntimeRepoOwner, withRuntimeRepoMutationOwner, withRuntimeWorktreeOwner, captureWebFileMutationSession, saveClipboardImageAsTempFileInRuntime, getRemoteRuntimeStatus, getClientForEnvironment, closeActiveRuntimeClients, disconnectActiveRuntimeEnvironment, removeActiveRuntimeEnvironment, manuallyDisconnectedResponse, resolveEnvironment, requireActiveEnvironment, requireActiveEnvironmentOrNull, assertActiveEnvironment, updateEnvironmentFromResponse, getStoredSettings, writeStoredSettings, getRuntimeBackedStoredSettings, syncRuntimeBackedSettings, updateRuntimePRBotAuthorOverride, getStoredOnboarding, sessionStorageKeyForHost, getStoredWorkspaceSession, closeWebOnboarding, readLocalWebUIState, mergeWebUIState, mergeFeatureInteractionState, mergeContextualTourSeenIds, mergeOsc52ClipboardNoticePending, mergeSettings, listAllRuntimeWorktrees, listAllRuntimeDetectedWorktrees, callRuntimeDetectedWorktrees, toLegacyDetectedWorktreeResult, isMissingPathError, resolveRuntimeWorktreeByPath, resolveRuntimeFilePath, mutateGitPath, mutateGitPaths, mapRepoPathArg, mapRuntimeNamespaceArg, createEmptyMemorySnapshot, getBrowserPlatform, readJson, writeJson, cloneJson, withFallback, createFallbackProxy, getFallbackResult, noopUnsubscribe, type WebSettingsApi, type WebGitHubApi, type WebGitHubResult, type WebRuntimeResultCaller, type WebRuntimeEnvelopeCaller, type WebGitHubRouteKey, type WebGitHubRuntimeMethod, type WebGitLabApi, type WebGitLabResult, type WebGitLabRouteKey, type WebGitLabRuntimeMethod } from './web-preload-compatibility'

export function createFileApi(): NonNullable<Partial<PreloadApi>['fs']> {
  return {
    readDir: async ({ dirPath }) => {
      const file = await resolveRuntimeFilePath(dirPath)
      return callRuntimeResult<DirEntry[]>('files.readDir', {
        worktree: toRuntimeWorktreeSelector(file.worktree.id),
        relativePath: file.relativePath
      })
    },
    readFile: async ({ filePath }) => {
      const file = await resolveRuntimeFilePath(filePath)
      return callRuntimeResult('files.readPreview', {
        worktree: toRuntimeWorktreeSelector(file.worktree.id),
        relativePath: file.relativePath
      })
    },
    readLocalLogTail: async () => {
      throw new Error('Local log tailing is unavailable in paired web clients.')
    },
    startLocalLogTail: async () => {
      throw new Error('Local log tailing is unavailable in paired web clients.')
    },
    stopLocalLogTail: async () => {},
    onLocalLogTailChanged: () => noopUnsubscribe,
    downloadFile: async () => {
      throw new Error('Remote file download is unavailable in paired web clients.')
    },
    downloadFolder: async () => {
      throw new Error('Remote folder download is unavailable in paired web clients.')
    },
    saveDownloadedFile: async () => {
      throw new Error('Remote file download is unavailable in paired web clients.')
    },
    startDownloadedFile: async () => {
      throw new Error('Remote file download is unavailable in paired web clients.')
    },
    appendDownloadedFileChunk: async () => {
      throw new Error('Remote file download is unavailable in paired web clients.')
    },
    finishDownloadedFile: async () => {
      throw new Error('Remote file download is unavailable in paired web clients.')
    },
    cancelDownloadedFile: async () => {
      throw new Error('Remote file download is unavailable in paired web clients.')
    },
    listMarkdownDocuments: async ({ rootPath }) => {
      const file = await resolveRuntimeFilePath(rootPath)
      return callRuntimeResult('files.listMarkdownDocuments', {
        worktree: toRuntimeWorktreeSelector(file.worktree.id)
      })
    },
    ...createWebFileMutationMethods({
      captureSession: captureWebFileMutationSession
    }),
    authorizeExternalPath: () => Promise.resolve(),
    stat: async ({ filePath }) => {
      const file = await resolveRuntimeFilePath(filePath)
      return callRuntimeResult('files.stat', {
        worktree: toRuntimeWorktreeSelector(file.worktree.id),
        relativePath: file.relativePath
      })
    },
    pathExists: async ({ filePath }) => {
      try {
        const file = await resolveRuntimeFilePath(filePath)
        await callRuntimeResult('files.stat', {
          worktree: toRuntimeWorktreeSelector(file.worktree.id),
          relativePath: file.relativePath
        })
        return true
      } catch (error) {
        if (isMissingPathError(error)) {
          return false
        }
        throw error
      }
    },
    listFiles: async ({ rootPath, excludePaths }) => {
      const file = await resolveRuntimeFilePath(rootPath)
      const result = await callRuntimeResult<{ files: { relativePath: string }[] }>(
        'files.listAll',
        {
          worktree: toRuntimeWorktreeSelector(file.worktree.id),
          excludePaths
        }
      )
      return result.files.map((entry) => entry.relativePath)
    },
    cancelListFiles: async () => {
      // Why: paired-web lists files over runtime RPC with its own timeout; there's no host-side scan to abort here.
    },
    search: async (args) => {
      const file = await resolveRuntimeFilePath(args.rootPath)
      return callRuntimeResult<SearchResult>('files.search', {
        worktree: toRuntimeWorktreeSelector(file.worktree.id),
        query: args.query,
        caseSensitive: args.caseSensitive,
        wholeWord: args.wholeWord,
        useRegex: args.useRegex,
        includePattern: args.includePattern,
        excludePattern: args.excludePattern,
        maxResults: args.maxResults
      })
    },
    importExternalPaths: async () => ({ results: [] }),
    stageExternalPathsForRuntimeUpload: async () => ({ sources: [] }),
    resolveDroppedPathsForAgent: async () => ({ resolvedPaths: [], skipped: [], failed: [] }),
    watchWorktree: () => Promise.resolve(),
    unwatchWorktree: () => Promise.resolve(),
    onFsChanged: () => noopUnsubscribe
  }
}
// Why: track the in-flight abortable status request per token so cancelStatus can abort it and close its remote context.
export const webGitStatusAbortControllers = new Map<string, AbortController>()

export async function callAbortableRuntimeStatus<TResult>(
  requestToken: string,
  params: unknown
): Promise<TResult> {
  const environment = requireActiveEnvironment()
  webGitStatusAbortControllers.get(requestToken)?.abort()
  const controller = new AbortController()
  webGitStatusAbortControllers.set(requestToken, controller)
  try {
    const response = await callAbortableRuntimeEnvironment(
      environment.id,
      'git.status',
      params,
      undefined,
      controller.signal
    )
    updateEnvironmentFromResponse(environment, response)
    if (!response.ok) {
      throw new Error(response.error.message)
    }
    return response.result as TResult
  } finally {
    if (webGitStatusAbortControllers.get(requestToken) === controller) {
      webGitStatusAbortControllers.delete(requestToken)
    }
  }
}
