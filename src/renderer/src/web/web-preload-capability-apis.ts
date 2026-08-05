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

export function createPreflightApi(): NonNullable<Partial<PreloadApi>['preflight']> {
  const fallbackStatus: PreflightStatus = {
    git: { installed: false },
    gh: { installed: false, authenticated: false },
    glab: { installed: false, authenticated: false },
    bitbucket: { configured: false, authenticated: false, account: null },
    azureDevOps: {
      configured: false,
      authenticated: false,
      account: null,
      baseUrl: null,
      tokenConfigured: false
    },
    gitea: {
      configured: false,
      authenticated: false,
      account: null,
      baseUrl: null,
      tokenConfigured: false
    }
  }
  const fallbackRefreshAgents: RefreshAgentsResult = {
    agents: [],
    addedPathSegments: [],
    shellHydrationOk: false,
    pathSource: 'sync_seed_only',
    pathFailureReason: 'spawn_error'
  }
  type WindowsTerminalCapabilityBridgeResult = {
    wslAvailable: boolean
    wslDistros: string[]
    pwshAvailable: boolean
    gitBashAvailable: boolean
    hostPlatform: NodeJS.Platform | null
  }
  const fallbackWindowsTerminalCapabilities = {
    wslAvailable: false,
    wslDistros: [],
    pwshAvailable: false,
    gitBashAvailable: false,
    hostPlatform: null
  }
  return {
    check: async (args) => {
      if (!requireActiveEnvironmentOrNull()) {
        return fallbackStatus
      }
      return callRuntimeResult<PreflightStatus>('preflight.check', args)
    },
    detectAgents: async () => {
      if (!requireActiveEnvironmentOrNull()) {
        return []
      }
      return callRuntimeResult<string[]>('preflight.detectAgents').catch(() => [])
    },
    refreshAgents: () =>
      requireActiveEnvironmentOrNull()
        ? callRuntimeResult('preflight.refreshAgents')
            .then((result) => result as RefreshAgentsResult)
            .catch(() => fallbackRefreshAgents)
        : Promise.resolve(fallbackRefreshAgents),
    detectRemoteAgents: async (args) =>
      requireActiveEnvironmentOrNull()
        ? callRuntimeResult<string[]>('preflight.detectRemoteAgents', args).catch(() => [])
        : [],
    detectRemoteWindowsTerminalCapabilities: async (args) =>
      requireActiveEnvironmentOrNull()
        ? callRuntimeResult<WindowsTerminalCapabilityBridgeResult>(
            'preflight.detectRemoteWindowsTerminalCapabilities',
            args
          ).catch(() => fallbackWindowsTerminalCapabilities)
        : Promise.resolve(fallbackWindowsTerminalCapabilities)
  }
}
export function createCliApi(): NonNullable<Partial<PreloadApi>['cli']> {
  const status = {
    platform: getBrowserPlatform(),
    commandName: getBrowserPlatform() === 'linux' ? 'orca-ide' : 'orca',
    commandPath: null,
    pathDirectory: null,
    pathConfigured: false,
    launcherPath: null,
    installMethod: null,
    supported: false,
    state: 'unsupported',
    currentTarget: null,
    unsupportedReason: 'launch_mode_unavailable',
    detail: 'CLI registration is managed on the Orca server, not in the web browser.'
  } as const
  return {
    getInstallStatus: () => Promise.resolve(status),
    install: () => Promise.resolve(status),
    remove: () => Promise.resolve(status),
    getWslInstallStatus: (_args?: { distro?: string | null }) => Promise.resolve(status),
    installWsl: (_args?: { distro?: string | null }) => Promise.resolve(status),
    removeWsl: (_args?: { distro?: string | null }) => Promise.resolve(status)
  } as NonNullable<Partial<PreloadApi>['cli']>
}

export function createAgentHooksApi(): NonNullable<Partial<PreloadApi>['agentHooks']> {
  const status = (
    agent:
      | 'claude'
      | 'openclaude'
      | 'codex'
      | 'gemini'
      | 'antigravity'
      | 'amp'
      | 'cursor'
      | 'droid'
      | 'command-code'
      | 'grok'
      | 'copilot'
      | 'hermes'
      | 'devin'
  ) =>
    Promise.resolve({
      agent,
      state: 'not_installed',
      configPath: '',
      managedHooksPresent: false,
      detail: 'Agent hook status is only available on the Orca server.'
    } as const)
  return {
    claudeStatus: () => status('claude'),
    openClaudeStatus: () => status('openclaude'),
    codexStatus: () => status('codex'),
    geminiStatus: () => status('gemini'),
    antigravityStatus: () => status('antigravity'),
    ampStatus: () => status('amp'),
    cursorStatus: () => status('cursor'),
    droidStatus: () => status('droid'),
    commandCodeStatus: () => status('command-code'),
    grokStatus: () => status('grok'),
    copilotStatus: () => status('copilot'),
    hermesStatus: () => status('hermes'),
    devinStatus: () => status('devin')
  }
}

export function createMacosTccPromptsApi(): NonNullable<Partial<PreloadApi>['macosTccPrompts']> {
  // Why: TCC is a macOS-desktop concept; the web client has no log stream to watch.
  return {
    onThreshold: () => noopUnsubscribe,
    consumePending: () => Promise.resolve(null),
    acknowledgePending: () => Promise.resolve(),
    releasePending: () => Promise.resolve(),
    dismiss: () => Promise.resolve()
  }
}

export function createDeveloperPermissionsApi(): NonNullable<
  Partial<PreloadApi>['developerPermissions']
> {
  return {
    getStatus: () => Promise.resolve([]),
    request: ({ id }) =>
      Promise.resolve({ id, status: 'unsupported', openedSystemSettings: false } as const),
    openSettings: () => Promise.resolve()
  }
}

export function createSkillsApi(): NonNullable<Partial<PreloadApi>['skills']> {
  return {
    discover: (target) =>
      callRuntimeResult<SkillDiscoveryResult>('skills.discover', target, 15_000),
    // Why: browser clients have no local skill homes; remote-host freshness stays off until its update rail covers it.
    freshnessInventory: (): Promise<SkillFreshnessInventory> =>
      Promise.resolve({
        schemaVersion: 1,
        installations: [],
        eligibleUpdateNames: [],
        scanIssues: [],
        scannedAt: Date.now()
      }),
    // Why: with no local skill homes there is nothing to update, so the run rail
    // reports a permanently idle state rather than spawning anything.
    startUpdateRun: () => Promise.resolve({ started: false as const, reason: 'invalid-names' }),
    cancelUpdateRun: () => Promise.resolve(),
    acknowledgeUpdateRun: () => Promise.resolve(),
    getUpdateRun: () => Promise.resolve({ state: 'idle' as const }),
    onUpdateRun: () => () => {}
  }
}

export function createNotificationsApi(): NonNullable<Partial<PreloadApi>['notifications']> {
  return {
    dispatch: () => Promise.resolve({ delivered: false, reason: 'not-supported' }),
    dismiss: () => Promise.resolve({ dismissed: 0 }),
    openSystemSettings: () => Promise.resolve(),
    getPermissionStatus: () =>
      Promise.resolve({ supported: false, platform: getBrowserPlatform(), requested: false }),
    probeDelivery: () => Promise.resolve({ state: 'unsupported' as const, authoritative: false }),
    playSound: () => Promise.resolve({ played: false, reason: 'missing-path' })
  }
}

export function createRateLimitsApi(): NonNullable<Partial<PreloadApi>['rateLimits']> {
  const empty: RateLimitState = {
    claude: null,
    codex: null,
    gemini: null,
    opencodeGo: null,
    kimi: null,
    antigravity: null,
    minimax: null,
    grok: null,
    minimaxCookieConfigured: false,
    grokAuthConfigured: false,
    claudeTarget: { runtime: 'host', wslDistro: null },
    codexTarget: { runtime: 'host', wslDistro: null },
    inactiveClaudeAccounts: [],
    inactiveCodexAccounts: []
  }
  return {
    get: () => Promise.resolve(empty),
    refresh: () => Promise.resolve(empty),
    refreshCodexForTarget: () => Promise.resolve(empty),
    // Why: web clients don't own local Codex auth; report the safe no-credit outcome since redemption is desktop-only.
    consumeCodexResetCredit: () => Promise.resolve({ outcome: 'noCredit', state: empty }),
    refreshClaudeForTarget: () => Promise.resolve(empty),
    setPollingInterval: () => Promise.resolve(),
    fetchInactiveClaudeAccounts: () => Promise.resolve(),
    fetchInactiveCodexAccounts: () => Promise.resolve(),
    refreshMiniMax: () => Promise.resolve(empty),
    refreshGrok: () => Promise.resolve(empty),
    onUpdate: () => noopUnsubscribe
  }
}

export function createMiniMaxCredentialsApi(): NonNullable<
  Partial<PreloadApi>['minimaxCredentials']
> {
  const notConfigured = { configured: false }
  const unsupportedError = new Error('MiniMax cookie storage is only available in the desktop app.')
  return {
    getStatus: () => Promise.resolve(notConfigured),
    saveCookie: () => Promise.reject(unsupportedError),
    clearCookie: () => Promise.resolve(notConfigured)
  }
}

export function createGrokAccountsApi(): NonNullable<Partial<PreloadApi>['grokAccounts']> {
  const unsigned = {
    signedIn: false,
    email: null,
    teamId: null,
    tokenFresh: false,
    error: null
  }
  return {
    getStatus: () => Promise.resolve(unsigned)
  }
}
