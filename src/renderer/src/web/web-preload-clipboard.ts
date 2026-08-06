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
  invalidateRuntimeWorktreeCaches,
  GITHUB_WEB_RPC_METHODS,
  GITLAB_WEB_RPC_METHODS,
  installWebPreloadApi,
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

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const commaIndex = result.indexOf(',')
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read clipboard image'))
    reader.readAsDataURL(blob)
  })
}
export function assertClipboardImageBlobWithinLimit(blob: Blob): void {
  assertClipboardImageByteLengthWithinLimit(blob.size)
}

export async function convertImageBlobToPng(blob: Blob): Promise<Blob> {
  assertClipboardImageBlobWithinLimit(blob)
  const bitmap = await createImageBitmap(blob)
  try {
    assertClipboardImageDimensionsWithinLimit(bitmap)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context || canvas.width <= 0 || canvas.height <= 0) {
      throw new Error('Clipboard image could not be decoded')
    }
    context.drawImage(bitmap, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((png) => {
        if (!png) {
          reject(new Error('Clipboard image could not be encoded as PNG'))
          return
        }
        try {
          assertClipboardImageBlobWithinLimit(png)
        } catch (error) {
          reject(error)
          return
        }
        resolve(png)
      }, 'image/png')
    })
  } finally {
    bitmap.close()
  }
}

export async function readClipboardImagePngBase64(): Promise<string | null> {
  const clipboard = navigator.clipboard as
    | (Clipboard & { read?: () => Promise<ClipboardItem[]> })
    | undefined
  if (!clipboard?.read) {
    return null
  }
  const items = await clipboard.read()
  for (const item of items) {
    const imageType = item.types.find((type) => type.startsWith('image/'))
    if (!imageType) {
      continue
    }
    const blob = await item.getType(imageType)
    assertClipboardImageBlobWithinLimit(blob)
    const pngBlob = imageType === 'image/png' ? blob : await convertImageBlobToPng(blob)
    return blobToBase64(pngBlob)
  }
  return null
}

export async function writeWebClipboardText(text: string): Promise<void> {
  await assertClipboardTextWriteWithinLimitWithYield(text)
  const clipboard = navigator.clipboard
  if (typeof clipboard?.writeText === 'function') {
    try {
      await clipboard.writeText(text)
      return
    } catch (error) {
      // Preserve the current user-activation turn for the synchronous fallback.
      if (copyClipboardTextViaExecCommand(text)) {
        return
      }
      throw error
    }
  }
  if (!copyClipboardTextViaExecCommand(text)) {
    throw new Error('Clipboard write is unavailable in this browser context')
  }
}
