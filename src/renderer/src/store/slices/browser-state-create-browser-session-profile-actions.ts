import { getClientRuntime } from '@/runtime/client-runtime'
 import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type {
  BrowserCookieImportResult,
  BrowserCookieImportSummary,
  BrowserCertificateFailure,
  BrowserHistoryEntry,
  BrowserLoadError,
  BrowserPage,
  BrowserSessionProfile,
  BrowserViewportPresetId,
  BrowserWorkspace,
  WorkspaceSessionState
} from '../../../../shared/types'
import { GRAB_BUDGET, type BrowserPageAnnotation } from '../../../../shared/browser-grab-types'
import { FLOATING_TERMINAL_WORKTREE_ID, ORCA_BROWSER_BLANK_URL } from '../../../../shared/constants'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { redactKagiSessionToken } from '../../../../shared/browser-url'
import {
  MAX_BROWSER_HISTORY_ENTRIES,
  normalizeBrowserHistoryEntries,
  normalizeBrowserHistoryUrl
} from '../../../../shared/workspace-session-browser-history'
import { pickNeighbor } from './tab-group-state'
import { destroyWorkspaceWebviews } from './browser-webview-cleanup'
import { pushRecentlyClosedTabKind } from './recently-closed-tabs'
import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { toRuntimeWorktreeSelector } from '@/runtime/runtime-worktree-selector'
import type {
  BrowserDetectProfilesResult,
  BrowserProfileClearDefaultCookiesResult,
  BrowserProfileCreateResult,
  BrowserProfileDeleteResult,
  BrowserProfileImportFromBrowserResult,
  BrowserProfileListResult
} from '../../../../shared/runtime-types'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { translate } from '@/i18n/i18n'
import {
  getSettingsFocusedExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  toRuntimeExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import {
  getExecutionHostIdForWorktree,
  getRuntimeEnvironmentIdForWorktree
} from '@/lib/worktree-runtime-owner'
import {
  addAdditionalValidWorkspaceKeys,
  type WorkspaceSessionHydrationOptions
} from '@/lib/workspace-session-hydration-keys'
import { buildValidWorktreeIdsForSessionHydration } from './degraded-repo-worktree-validity'
import { sanitizeBrowserPageAnnotation, normalizeUrl, normalizeBrowserTitle, getBrowserSettingsHostId, getBrowserSettingsRuntimeEnvironmentId, getBrowserWorktreeHostId, getBrowserSessionProfileHostId, isLocalBrowserPageOwner, profileListByHostUpdate, getBrowserProfilesForHost, getDefaultBrowserProfileForHost, browserImportStateForHostUpdate, closeRemoteBrowserPageInOwningEnvironment, buildBrowserPage, buildWorkspaceFromPage, mirrorWorkspaceFromActivePage, browserWorkspaceMirrorFieldsEqual, getFallbackTabTypeForWorktree, browserWorkspaceByIdCache, browserPageByIdCache, findWorkspace, findPage } from './browser-state'
import type { CreateBrowserTabOptions, CreateBrowserPageOptions, BrowserTabPageState, ClosedBrowserWorkspaceSnapshot, RemoteBrowserPageHandle, BrowserSlice } from './browser-state'
type SliceSet = Parameters<StateCreator<AppState>>[0]
type SliceGet = Parameters<StateCreator<AppState>>[1]
export function createBrowserSliceCreateBrowserSessionProfileActions6(set: SliceSet, get: SliceGet) {
  return {
  createBrowserSessionProfile: async (scope, label) => {
    const hostId = getBrowserSettingsHostId(get())
    const runtimeEnvironmentId = getBrowserSettingsRuntimeEnvironmentId(get())
    if (runtimeEnvironmentId) {
      try {
        const result = await callRuntimeRpc<BrowserProfileCreateResult>(
          { kind: 'environment', environmentId: runtimeEnvironmentId },
          'browser.profileCreate',
          { scope, label },
          { timeoutMs: 15_000 }
        )
        const profile = result.profile
        if (profile) {
          set((s) => ({
            ...profileListByHostUpdate(
              s,
              [...getBrowserProfilesForHost(s, hostId), profile],
              hostId
            )
          }))
        }
        return profile
      } catch {
        return null
      }
    }
    try {
      const profile = (await getClientRuntime().browser.sessionCreateProfile({
        scope,
        label
      })) as BrowserSessionProfile | null
      if (profile) {
        set((s) => ({
          ...profileListByHostUpdate(s, [...getBrowserProfilesForHost(s, hostId), profile], hostId)
        }))
      }
      return profile
    } catch {
      return null
    }
  },
  deleteBrowserSessionProfile: async (profileId) => {
    const hostId = getBrowserSettingsHostId(get())
    const runtimeEnvironmentId = getBrowserSettingsRuntimeEnvironmentId(get())
    if (runtimeEnvironmentId) {
      try {
        const result = await callRuntimeRpc<BrowserProfileDeleteResult>(
          { kind: 'environment', environmentId: runtimeEnvironmentId },
          'browser.profileDelete',
          { profileId },
          { timeoutMs: 15_000 }
        )
        if (result.deleted) {
          set((s) => ({
            ...profileListByHostUpdate(
              s,
              getBrowserProfilesForHost(s, hostId).filter((profile) => profile.id !== profileId),
              hostId
            ),
            ...(getDefaultBrowserProfileForHost(s, hostId) === profileId
              ? {
                  ...(getBrowserSettingsHostId(s) === hostId
                    ? { defaultBrowserSessionProfileId: null }
                    : {}),
                  defaultBrowserSessionProfileIdByHostId: {
                    ...s.defaultBrowserSessionProfileIdByHostId,
                    [hostId]: null
                  }
                }
              : {})
          }))
        }
        return result.deleted
      } catch {
        return false
      }
    }
    try {
      const ok = await getClientRuntime().browser.sessionDeleteProfile({ profileId })
      if (ok) {
        set((s) => ({
          ...profileListByHostUpdate(
            s,
            getBrowserProfilesForHost(s, hostId).filter((profile) => profile.id !== profileId),
            hostId
          ),
          ...(getDefaultBrowserProfileForHost(s, hostId) === profileId
            ? {
                ...(getBrowserSettingsHostId(s) === hostId
                  ? { defaultBrowserSessionProfileId: null }
                  : {}),
                defaultBrowserSessionProfileIdByHostId: {
                  ...s.defaultBrowserSessionProfileIdByHostId,
                  [hostId]: null
                }
              }
            : {})
        }))
      }
      return ok
    } catch {
      return false
    }
  },
  importCookiesToProfile: async (profileId) => {
    const hostId = getBrowserSettingsHostId(get())
    if (getBrowserSettingsRuntimeEnvironmentId(get())) {
      const reason = translate(
        'auto.store.slices.browser.remoteCookieImportUnavailable',
        'Manual cookie file import is unavailable while a remote runtime is active.'
      )
      set((state) =>
        browserImportStateForHostUpdate(state, hostId, {
          profileId,
          status: 'error',
          summary: null,
          error: reason
        })
      )
      return { ok: false as const, reason }
    }
    set((state) =>
      browserImportStateForHostUpdate(state, hostId, {
        profileId,
        status: 'importing',
        summary: null,
        error: null
      })
    )
    try {
      const result = (await getClientRuntime().browser.sessionImportCookies({
        profileId
      })) as BrowserCookieImportResult
      if (result.ok) {
        get().recordFeatureInteraction?.('cookie-import')
        set((state) =>
          browserImportStateForHostUpdate(state, hostId, {
            profileId,
            status: 'success',
            summary: result.summary,
            error: null
          })
        )
        if (getBrowserSettingsHostId(get()) === hostId) {
          await get()
            .fetchBrowserSessionProfiles()
            .catch(() => {})
        }
      } else {
        set((state) =>
          browserImportStateForHostUpdate(state, hostId, {
            profileId,
            status: result.reason === 'canceled' ? 'idle' : 'error',
            summary: null,
            error: result.reason === 'canceled' ? null : result.reason
          })
        )
      }
      return result
    } catch (err) {
      const reason = String((err as Error)?.message ?? err)
      set((state) =>
        browserImportStateForHostUpdate(state, hostId, {
          profileId,
          status: 'error',
          summary: null,
          error: reason
        })
      )
      return { ok: false as const, reason }
    }
  },
  clearBrowserSessionImportState: () => {
    set({ browserSessionImportState: null })
  },
  detectedBrowsers: [],
  detectedBrowsersLoaded: false,
  fetchDetectedBrowsers: async () => {
    const hostId = getBrowserSettingsHostId(get())
    const runtimeEnvironmentId = getBrowserSettingsRuntimeEnvironmentId(get())
    if (runtimeEnvironmentId) {
      try {
        const result = await callRuntimeRpc<BrowserDetectProfilesResult>(
          { kind: 'environment', environmentId: runtimeEnvironmentId },
          'browser.profileDetectBrowsers',
          undefined,
          { timeoutMs: 15_000 }
        )
        set((s) =>
          getBrowserSettingsHostId(s) === hostId
            ? { detectedBrowsers: result.browsers, detectedBrowsersLoaded: true }
            : {}
        )
      } catch {
        set((s) =>
          getBrowserSettingsHostId(s) === hostId
            ? { detectedBrowsers: [], detectedBrowsersLoaded: true }
            : {}
        )
      }
      return
    }
    if (get().detectedBrowsersLoaded) {
      return
    }
    try {
      const browsers = (await getClientRuntime().browser.sessionDetectBrowsers()) as {
        family: string
        label: string
        profiles: { name: string; directory: string }[]
        selectedProfile: string
      }[]
      set((s) =>
        getBrowserSettingsHostId(s) === hostId
          ? { detectedBrowsers: browsers, detectedBrowsersLoaded: true }
          : {}
      )
    } catch {
      /* best-effort — empty list is acceptable fallback */
      set((s) => (getBrowserSettingsHostId(s) === hostId ? { detectedBrowsersLoaded: true } : {}))
    }
  },
  }
}
