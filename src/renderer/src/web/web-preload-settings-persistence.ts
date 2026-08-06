import type { PreloadApi, PreflightStatus, RefreshAgentsResult } from '../../../preload/api-types'
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
  createRuntimeApi,
  createRuntimeEnvironmentsApi,
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

export function getStoredSettings(): GlobalSettings {
  setActiveEnvironment(activeEnvironment ?? readStoredWebRuntimeEnvironment())
  const defaults = getDefaultSettings('~')
  const rawStoredSettings = window.localStorage.getItem(SETTINGS_STORAGE_KEY)
  const stored = readJson<Partial<GlobalSettings>>(SETTINGS_STORAGE_KEY, {})
  const migratedStored = {
    ...stored,
    ...normalizeAutoRenameBranchFromWorkDefaultOn(stored),
    ...normalizeTerminalCursorStyleDefault(stored),
    ...normalizeOsc52ClipboardDefaultOn(stored),
    terminalCustomThemes: normalizeTerminalCustomThemes(stored.terminalCustomThemes),
    uiLanguage: normalizeUiLanguage(stored.uiLanguage)
  }
  if (
    rawStoredSettings &&
    (stored.autoRenameBranchFromWork !== migratedStored.autoRenameBranchFromWork ||
      stored.autoRenameBranchFromWorkDefaultedOn !==
        migratedStored.autoRenameBranchFromWorkDefaultedOn ||
      stored.terminalCursorStyle !== migratedStored.terminalCursorStyle ||
      stored.terminalCursorStyleDefaultedToBlock !==
        migratedStored.terminalCursorStyleDefaultedToBlock ||
      // Kept even though the terminalCustomThemes reference compare below already forces
      // this branch for every stored blob: no migration should rely on that accident.
      stored.terminalAllowOsc52Clipboard !== migratedStored.terminalAllowOsc52Clipboard ||
      stored.terminalAllowOsc52ClipboardDefaultedOnForAllUsers !==
        migratedStored.terminalAllowOsc52ClipboardDefaultedOnForAllUsers ||
      stored.terminalCustomThemes !== migratedStored.terminalCustomThemes ||
      stored.uiLanguage !== migratedStored.uiLanguage)
  ) {
    try {
      const parsed = JSON.parse(rawStoredSettings) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        writeJson(SETTINGS_STORAGE_KEY, migratedStored)
        if (osc52ClipboardDefaultOnOverridesPersistedOff(stored)) {
          // Why a raw merge, not readLocalWebUIState(): that path calls back into
          // getStoredSettings(), and writing through it here would recurse.
          writeJson(UI_STORAGE_KEY, {
            ...readJson<Partial<PersistedUIState>>(UI_STORAGE_KEY, {}),
            osc52ClipboardDefaultOnNoticePending: true
          })
        }
      }
    } catch {
      // Keep readJson's invalid-JSON fallback non-destructive.
    }
  }
  return mergeSettings(
    {
      ...defaults,
      floatingTerminalEnabled: false,
      rightSidebarOpenByDefault: false,
      activeRuntimeEnvironmentId: null
    },
    migratedStored
  )
}
export function writeStoredSettings(
  settings: GlobalSettings,
  explicitActiveRuntimeEnvironmentId?: string | null
): void {
  const durable = { ...settings }
  if (explicitActiveRuntimeEnvironmentId !== undefined) {
    durable.activeRuntimeEnvironmentId = explicitActiveRuntimeEnvironmentId
  } else {
    const stored = readJson<Partial<GlobalSettings>>(SETTINGS_STORAGE_KEY, {})
    if (Object.hasOwn(stored, 'activeRuntimeEnvironmentId')) {
      durable.activeRuntimeEnvironmentId = stored.activeRuntimeEnvironmentId ?? null
    } else {
      delete durable.activeRuntimeEnvironmentId
    }
  }
  writeJson(SETTINGS_STORAGE_KEY, durable)
}

export async function getRuntimeBackedStoredSettings(): Promise<GlobalSettings> {
  const local = getStoredSettings()
  if (!requireActiveEnvironmentOrNull()) {
    return local
  }
  try {
    const result = await callRuntimeResult<{ settings: Partial<GlobalSettings> }>(
      'settings.get',
      undefined,
      15_000
    )
    const runtimeSettings: Partial<GlobalSettings> = {}
    if (typeof result.settings.experimentalNewWorktreeCardStyle === 'boolean') {
      runtimeSettings.experimentalNewWorktreeCardStyle =
        result.settings.experimentalNewWorktreeCardStyle
    }
    if (typeof result.settings.compactWorktreeCards === 'boolean') {
      runtimeSettings.compactWorktreeCards = result.settings.compactWorktreeCards
    }
    if (typeof result.settings.minimaxGroupId === 'string') {
      runtimeSettings.minimaxGroupId = result.settings.minimaxGroupId
    }
    if (typeof result.settings.minimaxUsageModels === 'string') {
      runtimeSettings.minimaxUsageModels = result.settings.minimaxUsageModels
    }
    if (Array.isArray(result.settings.prBotAuthorOverrides)) {
      runtimeSettings.prBotAuthorOverrides = normalizePRBotAuthorOverrides(
        result.settings.prBotAuthorOverrides
      )
    }
    const next = mergeSettings(local, runtimeSettings)
    writeStoredSettings(next)
    return next
  } catch {
    // Why: unpaired/offline web clients keep a local settings fallback.
    return local
  }
}

export async function syncRuntimeBackedSettings(
  updates: Partial<GlobalSettings>,
  localNext: GlobalSettings
): Promise<GlobalSettings> {
  if (!requireActiveEnvironmentOrNull()) {
    return localNext
  }
  const runtimeUpdates: Partial<GlobalSettings> = {}
  if (typeof updates.experimentalNewWorktreeCardStyle === 'boolean') {
    runtimeUpdates.experimentalNewWorktreeCardStyle = updates.experimentalNewWorktreeCardStyle
  }
  if (typeof updates.compactWorktreeCards === 'boolean') {
    runtimeUpdates.compactWorktreeCards = updates.compactWorktreeCards
  }
  if (typeof updates.minimaxGroupId === 'string') {
    runtimeUpdates.minimaxGroupId = updates.minimaxGroupId
  }
  if (typeof updates.minimaxUsageModels === 'string') {
    runtimeUpdates.minimaxUsageModels = updates.minimaxUsageModels
  }
  if (Array.isArray(updates.prBotAuthorOverrides)) {
    runtimeUpdates.prBotAuthorOverrides = normalizePRBotAuthorOverrides(
      updates.prBotAuthorOverrides
    )
  }
  if (Object.keys(runtimeUpdates).length === 0) {
    return localNext
  }
  try {
    const result = await callRuntimeResult<{ settings: Partial<GlobalSettings> }>(
      'settings.update',
      runtimeUpdates,
      15_000
    )
    const runtimeSettings = { ...result.settings }
    delete runtimeSettings.activeRuntimeEnvironmentId
    const next = mergeSettings(localNext, runtimeSettings)
    writeStoredSettings(next)
    return next
  } catch {
    // Why: unpaired/offline web clients still need local settings persistence.
    return localNext
  }
}
