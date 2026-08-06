import type { PreloadApi, PreflightStatus, RefreshAgentsResult } from '../../../preload/api-types'
import type { RuntimeEnvironmentSubscriptionHandle } from '../../../preload/api-base'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import { parseHostAccessLink } from '../../../shared/remote-pairing-address'
import { verifyRemotePairingRuntimeStatus } from '../../../shared/remote-pairing-verification'
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
  createMacosTccPromptsApi,
  createDeveloperPermissionsApi,
  createSkillsApi,
  createNotificationsApi,
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
  mapRuntimeNamespaceArg,
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

import { setActiveEnvironment } from './web-preload-compatibility'

export function createRuntimeApi(): NonNullable<Partial<PreloadApi>['runtime']> {
  return {
    syncWindowGraph: async (_graph: RuntimeSyncWindowGraph) => getRemoteRuntimeStatus(),
    getStatus: () => getRemoteRuntimeStatus(),
    call: ({ method, params }) => callRuntimeEnvelope(method, params),
    getTerminalFitOverrides: () => Promise.resolve([]),
    getTerminalDrivers: () => Promise.resolve([]),
    getBrowserDrivers: () => Promise.resolve([]),
    restoreTerminalFit: () => Promise.resolve({ restored: false }),
    reclaimBrowserForDesktop: () => Promise.resolve({ reclaimed: false }),
    onTerminalFitOverrideChanged: () => noopUnsubscribe,
    onTerminalDriverChanged: () => noopUnsubscribe,
    onBrowserDriverChanged: () => noopUnsubscribe
  }
}

const WEB_RUNTIME_PAIRING_CHANGED_ERROR =
  'Runtime environment pairing changed; refresh and try again'

function assertExpectedEnvironmentPairingRevision(
  environment: StoredWebRuntimeEnvironment,
  expectedEnvironmentPairingRevision: number | undefined
): void {
  if (expectedEnvironmentPairingRevision === undefined) {
    return
  }
  const currentEnvironment = requireActiveEnvironmentOrNull()
  const currentRevision = currentEnvironment?.pairingRevision ?? currentEnvironment?.createdAt
  if (
    currentEnvironment?.id !== environment.id ||
    currentRevision !== expectedEnvironmentPairingRevision
  ) {
    throw new Error(WEB_RUNTIME_PAIRING_CHANGED_ERROR)
  }
}

function isExpectedEnvironmentPairingCurrent(
  environment: StoredWebRuntimeEnvironment,
  expectedEnvironmentPairingRevision: number | undefined
): boolean {
  if (expectedEnvironmentPairingRevision === undefined) {
    return true
  }
  const currentEnvironment = requireActiveEnvironmentOrNull()
  return (
    currentEnvironment?.id === environment.id &&
    (currentEnvironment.pairingRevision ?? currentEnvironment.createdAt) ===
      expectedEnvironmentPairingRevision
  )
}

// Why: client closure rejects pending work but does not explicitly tear down established streams.
const establishedRuntimeSubscriptions = new Set<RuntimeEnvironmentSubscriptionHandle>()

function trackRuntimeSubscription(
  subscription: RuntimeEnvironmentSubscriptionHandle
): RuntimeEnvironmentSubscriptionHandle {
  let closed = false
  const trackedSubscription: RuntimeEnvironmentSubscriptionHandle = {
    sendBinary: subscription.sendBinary,
    unsubscribe: () => {
      if (closed) {
        return
      }
      closed = true
      establishedRuntimeSubscriptions.delete(trackedSubscription)
      subscription.unsubscribe()
    }
  }
  establishedRuntimeSubscriptions.add(trackedSubscription)
  return trackedSubscription
}

function closeEstablishedRuntimeSubscriptions(): void {
  for (const subscription of establishedRuntimeSubscriptions) {
    subscription.unsubscribe()
  }
  establishedRuntimeSubscriptions.clear()
}

export function createRuntimeEnvironmentsApi(): NonNullable<
  Partial<PreloadApi>['runtimeEnvironments']
> {
  return {
    list: async () => {
      const environment = requireActiveEnvironmentOrNull()
      return environment ? [redactStoredWebRuntimeEnvironment(environment)] : []
    },
    addFromPairingCode: async ({ name, pairingCode }) => {
      const offer = parseWebPairingInput(pairingCode)
      if (!offer) {
        throw new Error('Invalid Orca pairing code.')
      }
      const previousEnvironment = activeEnvironment
      closeEstablishedRuntimeSubscriptions()
      closeActiveRuntimeClients()
      setActiveEnvironment(createStoredWebRuntimeEnvironment({ name, offer, previousEnvironment }))
      manuallyDisconnectedEnvironmentIds.clear()
      saveStoredWebRuntimeEnvironment(activeEnvironment)
      return { environment: redactStoredWebRuntimeEnvironment(activeEnvironment) }
    },
    verifyAndAddFromPairingCode: async ({ name, pairingCode, allowLoopback }) => {
      const parsed = parseHostAccessLink(pairingCode)
      if (!parsed.ok) {
        return {
          ok: false,
          kind: 'access-link-invalid',
          message: translateHostAccessLinkError(parsed.kind)
        }
      }
      if (parsed.value.endpointKind === 'loopback' && !allowLoopback) {
        return {
          ok: false,
          kind: 'host-unreachable',
          message: translate(
            'auto.web.webPreloadApi.loopbackPairingBlocked',
            'This access link points back to this device.'
          )
        }
      }
      let client: WebRuntimeClient | null = null
      let runtimeStatus: RuntimeStatus
      try {
        client = new WebRuntimeClient(parsed.value.pairing)
        const response = (await client.call('status.get', undefined, {
          timeoutMs: 15_000
        })) as RuntimeRpcResponse<RuntimeStatus>
        if (!response.ok) {
          return {
            ok: false,
            kind: 'connection-interrupted',
            message: response.error.message
          }
        }
        const statusVerification = verifyRemotePairingRuntimeStatus(response.result)
        if (!statusVerification.ok) {
          return statusVerification
        }
        runtimeStatus = statusVerification.runtimeStatus
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Invalid public key')) {
          return {
            ok: false,
            kind: 'access-link-invalid',
            message: translate(
              'auto.web.webPreloadApi.remotePairingInvalidDetails',
              'This access link contains invalid connection details.'
            )
          }
        }
        if (
          isWebRuntimeUnauthorizedError(error) ||
          (error instanceof Error && error.message.startsWith('Unauthorized.'))
        ) {
          return {
            ok: false,
            kind: 'access-link-invalid',
            message: error.message
          }
        }
        return {
          ok: false,
          kind: 'host-unreachable',
          message: translate(
            'auto.web.webPreloadApi.remotePairingUnreachable',
            'Cannot reach Orca at {{endpoint}}.',
            { endpoint: parsed.value.displayEndpoint }
          )
        }
      } finally {
        client?.close()
      }
      const usesSshTunnel = parsed.value.endpointKind === 'loopback' && allowLoopback === true
      const nextEnvironment = createStoredWebRuntimeEnvironment({
        name,
        offer: parsed.value.pairing,
        previousEnvironment: activeEnvironment,
        ...(usesSshTunnel ? { connectionDependency: 'ssh-tunnel' as const } : {})
      })
      // Why: a browser storage failure must leave the currently active host usable.
      try {
        saveStoredWebRuntimeEnvironment(nextEnvironment)
      } catch {
        return {
          ok: false,
          kind: 'environment-save-failed',
          message: translate(
            'auto.web.webPreloadApi.remotePairingSaveFailed',
            'Orca verified the host but could not save it. Check browser storage and try again.'
          )
        }
      }
      manuallyDisconnectedEnvironmentIds.clear()
      closeEstablishedRuntimeSubscriptions()
      closeActiveRuntimeClients()
      setActiveEnvironment(nextEnvironment)
      return {
        ok: true,
        environment: redactStoredWebRuntimeEnvironment(nextEnvironment),
        runtimeStatus
      }
    },
    resolve: async ({ selector }) =>
      redactStoredWebRuntimeEnvironment(resolveEnvironment(selector)),
    remove: async ({ selector }) => {
      const environment = resolveEnvironment(selector)
      if (activeEnvironment?.id === environment.id) {
        closeEstablishedRuntimeSubscriptions()
        removeActiveRuntimeEnvironment()
      }
      manuallyDisconnectedEnvironmentIds.delete(environment.id)
      return { removed: redactStoredWebRuntimeEnvironment(environment) }
    },
    disconnect: async ({ selector }) => {
      const environment = resolveEnvironment(selector)
      closeEstablishedRuntimeSubscriptions()
      if (activeEnvironment?.id === environment.id) {
        manuallyDisconnectedEnvironmentIds.add(environment.id)
        disconnectActiveRuntimeEnvironment()
      }
      return { disconnected: redactStoredWebRuntimeEnvironment(environment) }
    },
    connect: ({ selector, timeoutMs }) => {
      const environment = resolveEnvironment(selector)
      manuallyDisconnectedEnvironmentIds.delete(environment.id)
      return callEnvironmentEnvelope<RuntimeStatus>(
        environment.id,
        'status.get',
        undefined,
        timeoutMs
      )
    },
    getStatus: ({ selector, timeoutMs }) =>
      callEnvironmentEnvelope<RuntimeStatus>(selector, 'status.get', undefined, timeoutMs),
    call: async ({ selector, method, params, timeoutMs, expectedEnvironmentPairingRevision }) => {
      const environment = resolveEnvironment(selector)
      assertExpectedEnvironmentPairingRevision(environment, expectedEnvironmentPairingRevision)
      const response = await callEnvironmentEnvelope(selector, method, params, timeoutMs)
      assertExpectedEnvironmentPairingRevision(environment, expectedEnvironmentPairingRevision)
      return response
    },
    subscribe: async (
      { selector, method, params, timeoutMs, expectedEnvironmentPairingRevision },
      callbacks
    ) => {
      const environment = resolveEnvironment(selector)
      assertExpectedEnvironmentPairingRevision(environment, expectedEnvironmentPairingRevision)
      const client = getClientForEnvironment(environment)
      const guardedCallbacks =
        expectedEnvironmentPairingRevision === undefined
          ? callbacks
          : {
              ...callbacks,
              onResponse: (response: RuntimeRpcResponse<unknown>) => {
                if (
                  isExpectedEnvironmentPairingCurrent(
                    environment,
                    expectedEnvironmentPairingRevision
                  )
                ) {
                  callbacks.onResponse(response)
                }
              },
              onBinary: (bytes: Uint8Array<ArrayBufferLike>) => {
                if (
                  isExpectedEnvironmentPairingCurrent(
                    environment,
                    expectedEnvironmentPairingRevision
                  )
                ) {
                  callbacks.onBinary?.(bytes)
                }
              },
              onError: (error: { code: string; message: string }) => {
                if (
                  isExpectedEnvironmentPairingCurrent(
                    environment,
                    expectedEnvironmentPairingRevision
                  )
                ) {
                  callbacks.onError?.(error)
                }
              },
              onClose: () => {
                if (
                  isExpectedEnvironmentPairingCurrent(
                    environment,
                    expectedEnvironmentPairingRevision
                  )
                ) {
                  callbacks.onClose?.()
                }
              }
            }
      const subscription = await client.subscribe(method, params, guardedCallbacks, { timeoutMs })
      try {
        assertExpectedEnvironmentPairingRevision(environment, expectedEnvironmentPairingRevision)
      } catch (error) {
        subscription.unsubscribe()
        throw error
      }
      if (manuallyDisconnectedEnvironmentIds.has(environment.id)) {
        subscription.unsubscribe()
        throw new Error('runtime_manually_disconnected')
      }
      return trackRuntimeSubscription(subscription)
    }
  }
}
