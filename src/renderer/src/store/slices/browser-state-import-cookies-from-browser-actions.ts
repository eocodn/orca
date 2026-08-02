/* import type { StateCreator } from 'zustand'
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
export function createBrowserSliceImportCookiesFromBrowserActions7(set: SliceSet, get: SliceGet) {
  return {
  importCookiesFromBrowser: async (profileId, browserFamily, browserProfile?) => {
    const hostId = getBrowserSettingsHostId(get())
    const runtimeEnvironmentId = getBrowserSettingsRuntimeEnvironmentId(get())
    if (runtimeEnvironmentId) {
      set((state) =>
        browserImportStateForHostUpdate(state, hostId, {
          profileId,
          status: 'importing',
          summary: null,
          error: null
        })
      )
      try {
        const result = await callRuntimeRpc<BrowserProfileImportFromBrowserResult>(
          { kind: 'environment', environmentId: runtimeEnvironmentId },
          'browser.profileImportFromBrowser',
          { profileId, browserFamily, browserProfile },
          { timeoutMs: 30_000 }
        )
        if (result.ok) {
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
              status: 'error',
              summary: null,
              error: result.reason
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
      const result = (await window.api.browser.sessionImportFromBrowser({
        profileId,
        browserFamily,
        browserProfile
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
            status: 'error',
            summary: null,
            error: result.reason
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
  clearDefaultSessionCookies: async () => {
    const hostId = getBrowserSettingsHostId(get())
    const runtimeEnvironmentId = getBrowserSettingsRuntimeEnvironmentId(get())
    if (runtimeEnvironmentId) {
      try {
        const result = await callRuntimeRpc<BrowserProfileClearDefaultCookiesResult>(
          { kind: 'environment', environmentId: runtimeEnvironmentId },
          'browser.profileClearDefaultCookies',
          undefined,
          { timeoutMs: 15_000 }
        )
        if (result.cleared && getBrowserSettingsHostId(get()) === hostId) {
          await get().fetchBrowserSessionProfiles()
        }
        return result.cleared
      } catch {
        return false
      }
    }
    try {
      const ok = await window.api.browser.sessionClearDefaultCookies()
      if (ok && getBrowserSettingsHostId(get()) === hostId) {
        get().recordFeatureInteraction?.('cookie-import')
        await get().fetchBrowserSessionProfiles()
      }
      return ok
    } catch {
      return false
    }
  },
  addBrowserHistoryEntry: (url, title) => {
    const safeUrl = redactKagiSessionToken(url)
    if (safeUrl === ORCA_BROWSER_BLANK_URL || safeUrl === 'about:blank' || !safeUrl) {
      return
    }
    const normalized = normalizeBrowserHistoryUrl(safeUrl)
    set((s) => {
      const existing = s.browserUrlHistory.find((entry) => entry.normalizedUrl === normalized)
      let next: BrowserHistoryEntry[] = existing
        ? s.browserUrlHistory.map((entry) =>
            entry === existing
              ? { ...entry, title, lastVisitedAt: Date.now(), visitCount: entry.visitCount + 1 }
              : entry
          )
        : [
            {
              url: safeUrl,
              normalizedUrl: normalized,
              title,
              lastVisitedAt: Date.now(),
              visitCount: 1
            },
            ...s.browserUrlHistory
          ]
      if (next.length > MAX_BROWSER_HISTORY_ENTRIES) {
        next = next
          .sort((a, b) => b.lastVisitedAt - a.lastVisitedAt)
          .slice(0, MAX_BROWSER_HISTORY_ENTRIES)
      }
      return { browserUrlHistory: next }
    })
  },
  clearBrowserHistory: () => set({ browserUrlHistory: [] })
  }
}