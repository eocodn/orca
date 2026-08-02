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

import { SETTINGS_STORAGE_KEY, UI_STORAGE_KEY, SESSION_STORAGE_KEY, ONBOARDING_STORAGE_KEY, GITHUB_CACHE_STORAGE_KEY, webE2EExposeStore, webE2EQuery, webE2EConfig, WEB_RUNTIME_WORKTREE_LIST_LIMIT, MAX_CLIPBOARD_IMAGE_BASE64_CHARS, MAX_CLIPBOARD_IMAGE_SOURCE_BYTES, MAX_CLIPBOARD_IMAGE_PIXELS, CLIPBOARD_IMAGE_UPLOAD_CHUNK_BASE64_CHARS, CLIPBOARD_IMAGE_SINGLE_FRAME_FALLBACK_BASE64_CHARS, CLIPBOARD_IMAGE_SAVE_TIMEOUT_MS, activeEnvironment, activeClient, activeClientEnvironmentId, manuallyDisconnectedEnvironmentIds, cachedWorktrees, cachedDetectedWorktrees, runtimeCallQueuePool, blobToBase64, assertClipboardImageBlobWithinLimit, convertImageBlobToPng, readClipboardImagePngBase64, invalidateRuntimeWorktreeCaches, GITHUB_WEB_RPC_METHODS, GITLAB_WEB_RPC_METHODS, installWebPreloadApi, writeWebClipboardText, createWebPreloadApi, createRuntimeApi, createRuntimeEnvironmentsApi, createAiVaultApi, webAiVaultUnavailableResult, createReposApi, createWorktreesApi, createFileApi, webGitStatusAbortControllers, callAbortableRuntimeStatus, createGitApi, createBrowserApi, createEmulatorApi, createGitHubApi, createGitLabApi, createRuntimeNamespaceApi, createHooksApi, createWebUiApi, createPreflightApi, createCliApi, createAgentHooksApi, createMacosTccPromptsApi, createDeveloperPermissionsApi, createComputerUsePermissionsApi, createSkillsApi, createNotificationsApi, createRateLimitsApi, createMiniMaxCredentialsApi, createGrokAccountsApi, createAccountsApi, createUpdaterApi, createShellApi, createPtyApi, createSshApi, callRuntimeEnvelope, callEnvironmentEnvelope, callRuntimeResult, callRuntimeResultWithOwner, withRuntimeRepoOwner, withRuntimeRepoMutationOwner, withRuntimeWorktreeOwner, captureWebFileMutationSession, saveClipboardImageAsTempFileInRuntime, getRemoteRuntimeStatus, getClientForEnvironment, closeActiveRuntimeClients, disconnectActiveRuntimeEnvironment, removeActiveRuntimeEnvironment, manuallyDisconnectedResponse, resolveEnvironment, requireActiveEnvironment, requireActiveEnvironmentOrNull, assertActiveEnvironment, updateEnvironmentFromResponse, getStoredSettings, writeStoredSettings, getRuntimeBackedStoredSettings, syncRuntimeBackedSettings, updateRuntimePRBotAuthorOverride, getStoredOnboarding, sessionStorageKeyForHost, getStoredWorkspaceSession, closeWebOnboarding, readLocalWebUIState, mergeWebUIState, mergeFeatureInteractionState, mergeContextualTourSeenIds, mergeOsc52ClipboardNoticePending, mergeSettings, listAllRuntimeWorktrees, listAllRuntimeDetectedWorktrees, callRuntimeDetectedWorktrees, toLegacyDetectedWorktreeResult, isMissingPathError, resolveRuntimeWorktreeByPath, resolveRuntimeFilePath, mutateGitPath, mutateGitPaths, mapRepoPathArg, mapRuntimeNamespaceArg, createEmptyMemorySnapshot, getBrowserPlatform, readJson, writeJson, cloneJson, withFallback, createFallbackProxy, getFallbackResult, noopUnsubscribe, type WebSettingsApi, type WebGitHubApi, type WebGitHubResult, type WebRuntimeResultCaller, type WebRuntimeEnvelopeCaller, type WebGitHubRouteKey, type WebGitHubRuntimeMethod, type WebGitLabApi, type WebGitLabResult, type WebGitLabRouteKey, type WebGitLabRuntimeMethod } from './web-preload-compatibility'

export function createNativeChatApi(): NativeChatApi {
  return {
    readSession: async (agent, sessionId, limit, transcriptPath) =>
      parseRuntimeNativeChatReadSessionResult(
        await callRuntimeResult<unknown>('nativeChat.readSession', {
          agent,
          sessionId,
          limit,
          transcriptPath
        })
      ),
    subscribe: (args, onFrame) => {
      // No paired runtime yet: return a no-op teardown so the chat view mounts cleanly; only the not-paired case is swallowed.
      const environment = requireActiveEnvironmentOrNull()
      if (!environment) {
        onFrame({
          type: 'snapshot',
          messages: [],
          hasMore: false,
          error: translate(
            'components.native-chat.state.pairHost',
            'Pair a host to view agent chat history.'
          )
        })
        return () => {}
      }
      let handle: { unsubscribe: () => void } | null = null
      let cancelled = false
      let receivedInitial = false
      void getClientForEnvironment(environment)
        .subscribe(
          'nativeChat.subscribe',
          {
            agent: args.agent,
            sessionId: args.sessionId,
            subscriptionId: args.subscriptionId,
            transcriptPath: args.transcriptPath,
            limit: args.limit
          },
          {
            onResponse: (response) => {
              if (cancelled) {
                return
              }
              if (!response.ok) {
                if (!receivedInitial) {
                  receivedInitial = true
                  onFrame({
                    type: 'snapshot',
                    messages: [],
                    hasMore: false,
                    error: response.error.message
                  })
                }
                return
              }
              const result = response.result as {
                type?: string
                messages?: NativeChatAppendedMessages
                hasMore?: boolean
                error?: string
                lifecycle?: unknown
              }
              const lifecycle = parseRuntimeNativeChatTurnLifecycle(result?.lifecycle)
              if (
                (result?.type === 'appended' ||
                  result?.type === 'snapshot' ||
                  result?.type === 'replacement') &&
                Array.isArray(result.messages)
              ) {
                if (!receivedInitial) {
                  receivedInitial = true
                  onFrame({
                    type: 'snapshot',
                    messages: result.messages,
                    hasMore: result.hasMore ?? result.messages.length >= (args.limit ?? 300),
                    ...(result.error ? { error: result.error } : {}),
                    ...(lifecycle ? { lifecycle } : {})
                  })
                } else if (result.type === 'snapshot') {
                  onFrame({
                    type: 'snapshot',
                    messages: result.messages,
                    hasMore: result.hasMore ?? false,
                    ...(result.error ? { error: result.error } : {}),
                    ...(lifecycle ? { lifecycle } : {})
                  })
                } else {
                  onFrame(
                    result.type === 'replacement'
                      ? {
                          type: 'replacement',
                          messages: result.messages,
                          hasMore: result.hasMore ?? false,
                          ...(lifecycle ? { lifecycle } : {})
                        }
                      : {
                          type: 'appended',
                          messages: result.messages,
                          ...(lifecycle ? { lifecycle } : {})
                        }
                  )
                }
              } else if (!receivedInitial) {
                // Why: an unrecognized ok payload never flips receivedInitial, stranding the view on 'loading'; settle it empty instead.
                receivedInitial = true
                onFrame({
                  type: 'snapshot',
                  messages: [],
                  hasMore: false,
                  ...(result?.error ? { error: result.error } : {})
                })
              }
            }
          },
          {
            // Why: unsubscribe reaps the fs-watcher on view-toggle (leak fix); echo the pane token so two panes don't tear down each other's watcher.
            buildUnsubscribe: () =>
              buildNativeChatUnsubscribe(args.agent, args.sessionId, args.subscriptionId)
          }
        )
        .then((h) => {
          if (cancelled) {
            h.unsubscribe()
          } else {
            handle = h
          }
        })
        .catch((err: unknown) => {
          if (!cancelled && !receivedInitial) {
            receivedInitial = true
            onFrame({
              type: 'snapshot',
              messages: [],
              hasMore: false,
              error: err instanceof Error ? err.message : String(err)
            })
          }
        })
      return () => {
        cancelled = true
        handle?.unsubscribe()
      }
    }
  }
}

