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

import { SETTINGS_STORAGE_KEY, UI_STORAGE_KEY, SESSION_STORAGE_KEY, ONBOARDING_STORAGE_KEY, GITHUB_CACHE_STORAGE_KEY, webE2EExposeStore, webE2EQuery, webE2EConfig, WEB_RUNTIME_WORKTREE_LIST_LIMIT, MAX_CLIPBOARD_IMAGE_BASE64_CHARS, MAX_CLIPBOARD_IMAGE_SOURCE_BYTES, MAX_CLIPBOARD_IMAGE_PIXELS, CLIPBOARD_IMAGE_UPLOAD_CHUNK_BASE64_CHARS, CLIPBOARD_IMAGE_SINGLE_FRAME_FALLBACK_BASE64_CHARS, CLIPBOARD_IMAGE_SAVE_TIMEOUT_MS, activeEnvironment, activeClient, activeClientEnvironmentId, manuallyDisconnectedEnvironmentIds, cachedWorktrees, cachedDetectedWorktrees, runtimeCallQueuePool, blobToBase64, assertClipboardImageBlobWithinLimit, convertImageBlobToPng, readClipboardImagePngBase64, invalidateRuntimeWorktreeCaches, GITHUB_WEB_RPC_METHODS, GITLAB_WEB_RPC_METHODS, installWebPreloadApi, writeWebClipboardText, createNativeChatApi, createRuntimeApi, createRuntimeEnvironmentsApi, createAiVaultApi, webAiVaultUnavailableResult, createReposApi, createWorktreesApi, createFileApi, webGitStatusAbortControllers, callAbortableRuntimeStatus, createGitApi, createBrowserApi, createEmulatorApi, createGitHubApi, createGitLabApi, createRuntimeNamespaceApi, createHooksApi, createWebUiApi, createPreflightApi, createCliApi, createAgentHooksApi, createMacosTccPromptsApi, createDeveloperPermissionsApi, createComputerUsePermissionsApi, createSkillsApi, createNotificationsApi, createRateLimitsApi, createMiniMaxCredentialsApi, createGrokAccountsApi, createAccountsApi, createUpdaterApi, createShellApi, createPtyApi, createSshApi, callRuntimeEnvelope, callEnvironmentEnvelope, callRuntimeResult, callRuntimeResultWithOwner, withRuntimeRepoOwner, withRuntimeRepoMutationOwner, withRuntimeWorktreeOwner, captureWebFileMutationSession, saveClipboardImageAsTempFileInRuntime, getRemoteRuntimeStatus, getClientForEnvironment, closeActiveRuntimeClients, disconnectActiveRuntimeEnvironment, removeActiveRuntimeEnvironment, manuallyDisconnectedResponse, resolveEnvironment, requireActiveEnvironment, requireActiveEnvironmentOrNull, assertActiveEnvironment, updateEnvironmentFromResponse, getStoredSettings, writeStoredSettings, getRuntimeBackedStoredSettings, syncRuntimeBackedSettings, updateRuntimePRBotAuthorOverride, getStoredOnboarding, sessionStorageKeyForHost, getStoredWorkspaceSession, closeWebOnboarding, readLocalWebUIState, mergeWebUIState, mergeFeatureInteractionState, mergeContextualTourSeenIds, mergeOsc52ClipboardNoticePending, mergeSettings, listAllRuntimeWorktrees, listAllRuntimeDetectedWorktrees, callRuntimeDetectedWorktrees, toLegacyDetectedWorktreeResult, isMissingPathError, resolveRuntimeWorktreeByPath, resolveRuntimeFilePath, mutateGitPath, mutateGitPaths, mapRepoPathArg, mapRuntimeNamespaceArg, createEmptyMemorySnapshot, getBrowserPlatform, readJson, writeJson, cloneJson, withFallback, createFallbackProxy, getFallbackResult, noopUnsubscribe, type WebSettingsApi, type WebGitHubApi, type WebGitHubResult, type WebRuntimeResultCaller, type WebRuntimeEnvelopeCaller, type WebGitHubRouteKey, type WebGitHubRuntimeMethod, type WebGitLabApi, type WebGitLabResult, type WebGitLabRouteKey, type WebGitLabRuntimeMethod } from './web-preload-compatibility'

export function createWebPreloadApi(): Partial<PreloadApi> {
  const webOrcaProfileAuthStatus = () =>
    Promise.resolve({
      activeProfileId: DEFAULT_LOCAL_ORCA_PROFILE_ID,
      configured: false,
      state: 'unconfigured' as const,
      persistence: 'none' as const,
      setupMessage: 'Orca Cloud sign-in is not available in the browser fallback.'
    })

  return {
    app: {
      getIdentity: () =>
        Promise.resolve({
          name: 'Orca',
          isDev: false,
          devLabel: null,
          devBranch: null,
          devWorktreeName: null,
          devRepoRoot: null,
          dockBadgeLabel: null
        }),
      getFeatureWallAssetBaseUrl: () => Promise.resolve('/'),
      relaunch: () => Promise.resolve(window.location.reload()),
      restart: () => Promise.resolve(window.location.reload()),
      reload: () => Promise.resolve(window.location.reload()),
      persistBeforeUnloadSync: ({ sessions, ui }) => {
        // Why: beforeunload cannot await the paired runtime, so the web adapter
        // guarantees immediate browser-local durability for the final snapshot.
        for (const { state, hostId } of sessions) {
          writeJson(sessionStorageKeyForHost(hostId), sanitizeWebRuntimeWorkspaceSession(state))
        }
        writeJson(UI_STORAGE_KEY, mergeWebUIState(readLocalWebUIState(), ui))
      },
      awaitFirstWindowStartupServices: () => Promise.resolve(),
      recoverLegacyWorkerTerminalsForRendererStartup: () => Promise.resolve(),
      startupDiagnostic: () => Promise.resolve(),
      getKeyboardInputSourceId: () => Promise.resolve(null),
      setUnreadDockBadgeCount: () => Promise.resolve(),
      getFloatingTerminalCwd: () => Promise.resolve(''),
      getFloatingMarkdownDirectory: () => Promise.resolve(''),
      pickFloatingMarkdownDocument: () => Promise.resolve(null),
      pickFloatingWorkspaceDirectory: () => Promise.resolve(null),
      // Browser fallback has no app-owned userData dir; reject so the sentinel can't claim sensitive evidence was persisted.
      writeTerminalRenderDesyncEvidence: () =>
        Promise.reject(
          new Error('Terminal render evidence is unavailable in the browser fallback.')
        )
    },
    starNag: {
      onShow: () => noopUnsubscribe,
      onHide: () => noopUnsubscribe,
      dismiss: () => Promise.resolve(),
      later: () => Promise.resolve(),
      complete: () => Promise.resolve(),
      disable: () => Promise.resolve(),
      openWeb: () => Promise.resolve(),
      starOrca: () => Promise.resolve(false),
      forceShow: () => Promise.resolve(),
      agentValueMoment: () => Promise.resolve({ status: 'skipped' }),
      showAgentValueMoment: () => Promise.resolve(),
      onboardingCompleted: () => Promise.resolve()
    },
    platform: {
      get: () => ({
        platform: getBrowserPlatform(),
        osRelease: '',
        displayServer: null
      })
    },
    workspacePorts: {
      // Why: browser-local workspaces have no host process to inspect; return capability state instead of the generic undefined fallback.
      scan: () =>
        Promise.resolve({
          platform: getBrowserPlatform(),
          scannedAt: Date.now(),
          ports: [],
          unavailableReason: 'Workspace port scanning is unavailable for browser-local workspaces.'
        }),
      kill: () =>
        Promise.resolve({
          ok: false,
          reason: 'Workspace port management is unavailable for browser-local workspaces.'
        }),
      onAdvertisedUrlChanged: () => noopUnsubscribe
    },
    orcaProfiles: {
      list: () =>
        Promise.resolve({
          activeProfileId: DEFAULT_LOCAL_ORCA_PROFILE_ID,
          profiles: [createDefaultLocalOrcaProfile(0)],
          multiProfileUi: false
        }),
      authStatus: webOrcaProfileAuthStatus,
      createLocal: () =>
        Promise.resolve({
          activeProfileId: DEFAULT_LOCAL_ORCA_PROFILE_ID,
          profiles: [createDefaultLocalOrcaProfile(0)],
          profile: createDefaultLocalOrcaProfile(0)
        }),
      createCloudLinked: async () => ({
        status: 'unconfigured',
        auth: await webOrcaProfileAuthStatus()
      }),
      switchProfile: () => Promise.resolve({ status: 'already-active' }),
      transferProject: (args) =>
        Promise.resolve({
          status: 'duplicate-target',
          sourceProfileId: args.sourceProfileId,
          targetProfileId: args.targetProfileId,
          sourceRepoId: args.repoId,
          duplicateRepoId: args.repoId
        }),
      findProjectProfiles: async () => ({ projects: [] }),
      connectCurrent: async () => ({
        status: 'unconfigured',
        auth: await webOrcaProfileAuthStatus()
      }),
      refreshAuth: async () => ({
        status: 'unconfigured',
        auth: await webOrcaProfileAuthStatus()
      }),
      signOutCurrent: async () => ({
        status: 'signed-out',
        auth: await webOrcaProfileAuthStatus(),
        activeProfileId: DEFAULT_LOCAL_ORCA_PROFILE_ID,
        profiles: [createDefaultLocalOrcaProfile(0)]
      }),
      selectOrg: async () => ({
        status: 'unconfigured',
        auth: await webOrcaProfileAuthStatus()
      }),
      orgMembersList: async () => ({ status: 'unconfigured' }),
      orgMemberInvite: async () => ({ status: 'unconfigured' }),
      orgInviteRevoke: async () => ({ status: 'unconfigured' }),
      orgMemberChangeRole: async () => ({ status: 'unconfigured' }),
      orgMemberRemove: async () => ({ status: 'unconfigured' })
    },
    e2e: {
      getConfig: () => webE2EConfig
    },
    settings: {
      get: async () => getRuntimeBackedStoredSettings(),
      // Why: localStorage-backed settings are synchronous, so the pre-hydration kill-switch read works the same as desktop.
      getSync: () => getStoredSettings(),
      set: async (updates) => {
        const sanitizedUpdates = { ...updates }
        delete sanitizedUpdates.activeRuntimeEnvironmentId
        if ('autoRenameBranchFromWorkDefaultedOn' in sanitizedUpdates) {
          sanitizedUpdates.autoRenameBranchFromWorkDefaultedOn = true
        }
        const next = mergeSettings(getStoredSettings(), sanitizedUpdates, {
          preserveAutoRenameBranchFromWorkUpdate: 'autoRenameBranchFromWork' in sanitizedUpdates
        })
        writeStoredSettings(next)
        return syncRuntimeBackedSettings(sanitizedUpdates, next)
      },
      setActiveRuntimeEnvironmentPreference: async ({ environmentId }) => {
        const requestedEnvironmentId = environmentId?.trim() || null
        const activeRuntimeEnvironmentId = requestedEnvironmentId
          ? resolveEnvironment(requestedEnvironmentId).id
          : null
        const next = mergeSettings(getStoredSettings(), {
          activeRuntimeEnvironmentId
        })
        writeStoredSettings(next, activeRuntimeEnvironmentId)
        return next
      },
      updatePRBotAuthorOverride: (args) => updateRuntimePRBotAuthorOverride(args),
      listFonts: () => Promise.resolve([]),
      onChanged: () => noopUnsubscribe
    } satisfies Partial<WebSettingsApi> as unknown as WebSettingsApi,
    keybindings: createWebKeybindingsApi(),
    ui: createWebUiApi(),
    crashReports: {
      getLatestPending: () => Promise.resolve(null),
      getLatestReport: () => Promise.resolve(null),
      dismiss: () => Promise.resolve(null),
      recordRendererError: () => Promise.resolve({ ok: true, report: null, deduped: true }),
      recordBreadcrumb: () => {},
      submit: () =>
        Promise.resolve({
          ok: false,
          status: null,
          error: translate('auto.web.web.preload.api.fb290366b2', 'Unavailable on web.')
        }),
      copyLatestDiagnostics: () =>
        Promise.resolve({
          ok: false,
          error: translate('auto.web.web.preload.api.fb290366b2', 'Unavailable on web.')
        }),
      // Why: no Electron process on web; the caller falls back to performance.memory.
      readHeapStatistics: () => null
    },
    diagnostics: {
      getStatus: () =>
        Promise.resolve({
          localFileEnabled: false,
          bundleEnabled: false,
          traceFilePath: '',
          traceFamilySize: 0
        }),
      collectBundle: () => Promise.reject(new Error('Review files are unavailable on web.')),
      openBundlePreview: () => Promise.reject(new Error('Review files are unavailable on web.')),
      discardBundlePreview: () => Promise.resolve(),
      uploadBundle: () => Promise.reject(new Error('Sending diagnostics is unavailable on web.')),
      deleteBundle: () => Promise.reject(new Error('Sent diagnostics are unavailable on web.'))
    },
    session: {
      // Mirrors desktop bridge: non-local hosts persist under a host-suffixed key so their sessions stay isolated from local.
      get: (hostId) => Promise.resolve(getStoredWorkspaceSession(hostId)),
      set: async (session, hostId) => {
        writeJson(sessionStorageKeyForHost(hostId), sanitizeWebRuntimeWorkspaceSession(session))
      },
      patch: async (patch: WorkspaceSessionPatch, hostId) => {
        writeJson(
          sessionStorageKeyForHost(hostId),
          sanitizeWebRuntimeWorkspaceSession({
            ...getStoredWorkspaceSession(hostId),
            ...patch
          })
        )
      },
      // localStorage writes synchronously, so there is no deferred web flush.
      flush: async () => {},
      readTerminalScrollback: () => null,
      setSync: (session, hostId) => {
        writeJson(sessionStorageKeyForHost(hostId), sanitizeWebRuntimeWorkspaceSession(session))
      }
    },
    onboarding: {
      get: () => Promise.resolve(getStoredOnboarding()),
      update: async (updates) => {
        const current = getStoredOnboarding()
        const next: OnboardingState = {
          ...current,
          ...updates,
          flowVersion: ONBOARDING_FLOW_VERSION,
          checklist: {
            ...current.checklist,
            ...updates.checklist
          }
        }
        writeJson(ONBOARDING_STORAGE_KEY, next)
        return next
      }
    },
    cache: {
      getGitHub: () =>
        Promise.resolve(
          readJson(GITHUB_CACHE_STORAGE_KEY, {
            pr: {},
            issue: {}
          })
        ),
      setGitHub: async ({ cache }) => {
        writeJson(GITHUB_CACHE_STORAGE_KEY, cache)
      }
    },
    runtime: createRuntimeApi(),
    nativeChat: createNativeChatApi(),
    runtimeEnvironments: createRuntimeEnvironmentsApi(),
    repos: createReposApi(),
    worktrees: createWorktreesApi(),
    fs: createFileApi(),
    git: createGitApi(),
    browser: createBrowserApi(),
    emulator: createEmulatorApi(),
    gh: createGitHubApi(),
    gl: createGitLabApi(),
    hostedReview: createRuntimeNamespaceApi('hostedReview'),
    linear: createRuntimeNamespaceApi('linear'),
    hooks: createHooksApi(),
    stats: {
      getSummary: async () =>
        callRuntimeResult<StatsSummary>('stats.summary').catch(() => ({
          totalAgentsSpawned: 0,
          totalPRsCreated: 0,
          totalAgentTimeMs: 0,
          firstEventAt: null
        }))
    },
    memory: {
      getSnapshot: () => Promise.resolve(createEmptyMemorySnapshot())
    },
    aiVault: createAiVaultApi(),
    preflight: createPreflightApi(),
    notifications: createNotificationsApi(),
    rateLimits: createRateLimitsApi(),
    minimaxCredentials: createMiniMaxCredentialsApi(),
    grokAccounts: createGrokAccountsApi(),
    codexAccounts: createAccountsApi(),
    claudeAccounts: createAccountsApi(),
    cli: createCliApi(),
    agentHooks: createAgentHooksApi(),
    macosTccPrompts: createMacosTccPromptsApi(),
    // Why: the desktop derives this from the host filesystem, which the web
    // client has no view of; reporting synced keeps the warning banner silent.
    codexConfigSync: {
      status: () =>
        Promise.resolve({ state: 'synced', reason: null, systemConfigPath: '' } as const)
    },
    developerPermissions: createDeveloperPermissionsApi(),
    computerUsePermissions: createComputerUsePermissionsApi(),
    updater: createUpdaterApi(),
    shell: createShellApi(),
    skills: createSkillsApi(),
    pty: createPtyApi(),
    ssh: createSshApi(),
    wsl: {
      isAvailable: () => callRuntimeResult<boolean>('host.wsl.isAvailable').catch(() => false),
      listDistros: () => callRuntimeResult<string[]>('host.wsl.listDistros').catch(() => [])
    },
    pwsh: {
      isAvailable: () => callRuntimeResult<boolean>('host.pwsh.isAvailable').catch(() => false)
    },
    gitBash: {
      isAvailable: () => callRuntimeResult<boolean>('host.gitBash.isAvailable').catch(() => false)
    },
    agentStatus: {
      onSet: () => noopUnsubscribe,
      onClear: () => noopUnsubscribe,
      getSnapshot: () => Promise.resolve([]),
      inferInterrupt: () => Promise.resolve(false),
      inferQuestionAnswered: () => Promise.resolve(false),
      onMigrationUnsupported: () => noopUnsubscribe,
      onMigrationUnsupportedClear: () => noopUnsubscribe,
      onLegacyWorkerTerminalRecovery: () => noopUnsubscribe,
      getMigrationUnsupportedSnapshot: () => Promise.resolve([]),
      drop: () => {},
      dropByTabPrefix: () => {},
      retirePaneAuthority: () => {},
      transferPaneAuthority: () => {}
    },
    mobile: {
      listNetworkInterfaces: () => Promise.resolve({ interfaces: [] }),
      getPairingQR: () => Promise.resolve({ available: false }),
      getWindowsFirewallStatus: () => Promise.resolve({ supported: false }),
      repairWindowsFirewall: () => Promise.resolve({ ok: false, reason: 'unsupported' }),
      openWindowsNetworkSettings: () => Promise.resolve(false),
      getRuntimePairingUrl: () => Promise.resolve({ available: false }),
      listDevices: () => Promise.resolve({ devices: [] }),
      revokeDevice: () => Promise.resolve({ revoked: false }),
      listRuntimeAccessGrants: () => Promise.resolve({ grants: [] }),
      revokeRuntimeAccess: () => Promise.resolve({ revoked: false }),
      isWebSocketReady: () =>
        Promise.resolve({ ready: Boolean(activeEnvironment), endpoint: null }),
      getRelayStatus: () => Promise.resolve({ status: 'offline' as const }),
      onRelayStatusChanged: () => noopUnsubscribe,
      consumePendingUnpairedDeviceAuthFailure: () => Promise.resolve(false),
      onUnpairedDeviceAuthFailure: () => noopUnsubscribe
    },
    telemetryTrack: () => Promise.resolve(),
    telemetrySetOptIn: () => Promise.resolve(),
    telemetryGetConsentState: () =>
      Promise.resolve({ optedIn: false, source: 'default', blockedByEnv: false } as never),
    telemetryAcknowledgeBanner: () => Promise.resolve()
  }
}


// Why: web has no IPC for native-chat transcripts, so route readSession/subscribe through runtime RPC (as mobile does).
