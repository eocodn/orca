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
export function createBrowserSliceSetBrowserPageViewportPresetActions5(set: SliceSet, get: SliceGet) {
  return {
  setBrowserPageViewportPreset: (pageId, viewportPresetId) =>
    set((s) => {
      const page = findPage(s.browserPagesByWorkspace, pageId)
      if (!page) {
        return s
      }
      const workspace = findWorkspace(s.browserTabsByWorktree, page.workspaceId)
      if (!workspace) {
        return s
      }
      const nextPages = (s.browserPagesByWorkspace[workspace.id] ?? []).map((entry) =>
        entry.id === pageId ? { ...entry, viewportPresetId } : entry
      )
      return {
        browserPagesByWorkspace: {
          ...s.browserPagesByWorkspace,
          [workspace.id]: nextPages
        }
      }
    }),
  addBrowserPageAnnotation: (annotation) =>
    set((s) => {
      const existing = s.browserAnnotationsByPageId[annotation.browserPageId] ?? []
      const next = [...existing, sanitizeBrowserPageAnnotation(annotation)].slice(
        -GRAB_BUDGET.annotationsMaxPerPage
      )
      return {
        browserAnnotationsByPageId: {
          ...s.browserAnnotationsByPageId,
          [annotation.browserPageId]: next
        }
      }
    }),
  deleteBrowserPageAnnotation: (pageId, annotationId) =>
    set((s) => {
      const existing = s.browserAnnotationsByPageId[pageId] ?? []
      const next = existing.filter((annotation) => annotation.id !== annotationId)
      if (next.length === existing.length) {
        return s
      }
      const nextByPageId = { ...s.browserAnnotationsByPageId }
      if (next.length > 0) {
        nextByPageId[pageId] = next
      } else {
        delete nextByPageId[pageId]
      }
      return { browserAnnotationsByPageId: nextByPageId }
    }),
  clearBrowserPageAnnotations: (pageId) =>
    set((s) => {
      if (!s.browserAnnotationsByPageId[pageId]?.length) {
        return s
      }
      const nextByPageId = { ...s.browserAnnotationsByPageId }
      delete nextByPageId[pageId]
      return { browserAnnotationsByPageId: nextByPageId }
    }),
  hydrateBrowserSession: (session, options) => {
    const persistedTabsByWorktree = session.browserTabsByWorktree ?? {}
    const currentState = get()
    const validWorktreeIdsForCleanup = buildValidWorktreeIdsForSessionHydration(
      currentState,
      Object.keys(persistedTabsByWorktree)
    )
    validWorktreeIdsForCleanup.add(FLOATING_TERMINAL_WORKTREE_ID)
    for (const workspace of currentState.folderWorkspaces) {
      validWorktreeIdsForCleanup.add(folderWorkspaceKey(workspace.id))
    }
    addAdditionalValidWorkspaceKeys(validWorktreeIdsForCleanup, options)

    // Why: destroy dropped workspaces' webviews before the pure reducer; no-op today (boot registry empty), defends future re-hydration callers.
    const droppedWorkspaceIds: string[] = []
    for (const [worktreeId, tabs] of Object.entries(persistedTabsByWorktree)) {
      if (!validWorktreeIdsForCleanup.has(worktreeId)) {
        for (const tab of tabs) {
          droppedWorkspaceIds.push(tab.id)
        }
      }
    }
    for (const workspaceId of droppedWorkspaceIds) {
      destroyWorkspaceWebviews(currentState.browserPagesByWorkspace, workspaceId)
    }

    set((s) => {
      const persistedPagesByWorkspace = session.browserPagesByWorkspace ?? {}
      const persistedActiveBrowserTabIdByWorktree = session.activeBrowserTabIdByWorktree ?? {}
      const persistedActiveTabTypeByWorktree = session.activeTabTypeByWorktree ?? {}
      const validWorktreeIds = buildValidWorktreeIdsForSessionHydration(
        s,
        Object.keys(persistedTabsByWorktree)
      )
      validWorktreeIds.add(FLOATING_TERMINAL_WORKTREE_ID)
      for (const workspace of s.folderWorkspaces) {
        validWorktreeIds.add(folderWorkspaceKey(workspace.id))
      }
      addAdditionalValidWorkspaceKeys(validWorktreeIds, options)

      const browserTabsByWorktree: Record<string, BrowserWorkspace[]> = {}
      const browserPagesByWorkspace: Record<string, BrowserPage[]> = {}

      for (const [worktreeId, tabs] of Object.entries(persistedTabsByWorktree)) {
        if (!validWorktreeIds.has(worktreeId)) {
          continue
        }
        const hydratedTabs: BrowserWorkspace[] = []
        for (const tab of tabs) {
          const persistedPages = persistedPagesByWorkspace[tab.id] ?? [
            {
              id: createBrowserUuid(),
              workspaceId: tab.id,
              worktreeId,
              url: normalizeUrl(tab.url),
              title: tab.title,
              loading: false,
              faviconUrl: tab.faviconUrl ?? null,
              canGoBack: tab.canGoBack,
              canGoForward: tab.canGoForward,
              loadError: tab.loadError ?? null,
              createdAt: tab.createdAt
            } satisfies BrowserPage
          ]
          const nextPages = persistedPages.map((page) => ({
            ...page,
            workspaceId: tab.id,
            worktreeId,
            url: normalizeUrl(page.url),
            loading: false,
            loadError: page.loadError ?? null
          }))
          browserPagesByWorkspace[tab.id] = nextPages
          hydratedTabs.push(
            mirrorWorkspaceFromActivePage(
              {
                ...tab,
                activePageId: nextPages.some((page) => page.id === tab.activePageId)
                  ? (tab.activePageId ?? nextPages[0]?.id ?? null)
                  : (nextPages[0]?.id ?? null),
                pageIds: nextPages.map((page) => page.id)
              },
              nextPages
            )
          )
        }
        if (hydratedTabs.length > 0) {
          browserTabsByWorktree[worktreeId] = hydratedTabs
        }
      }

      const validBrowserTabIds = new Set(
        Object.values(browserTabsByWorktree)
          .flat()
          .map((tab) => tab.id)
      )

      const activeBrowserTabIdByWorktree: Record<string, string | null> = {}
      for (const [worktreeId, tabs] of Object.entries(browserTabsByWorktree)) {
        const persistedTabId = persistedActiveBrowserTabIdByWorktree[worktreeId]
        activeBrowserTabIdByWorktree[worktreeId] =
          persistedTabId && validBrowserTabIds.has(persistedTabId)
            ? persistedTabId
            : (tabs[0]?.id ?? null)
      }

      const activeWorktreeId = s.activeWorktreeId
      const activeBrowserTabId =
        activeWorktreeId && activeBrowserTabIdByWorktree[activeWorktreeId]
          ? activeBrowserTabIdByWorktree[activeWorktreeId]
          : null

      const nextActiveTabTypeByWorktree = { ...s.activeTabTypeByWorktree }
      for (const worktreeId of validWorktreeIds) {
        const hasBrowserTabs = (browserTabsByWorktree[worktreeId] ?? []).length > 0
        if (
          persistedActiveTabTypeByWorktree[worktreeId] === 'browser' &&
          hasBrowserTabs &&
          !nextActiveTabTypeByWorktree[worktreeId]
        ) {
          nextActiveTabTypeByWorktree[worktreeId] = 'browser'
          continue
        }
        if (nextActiveTabTypeByWorktree[worktreeId] === 'browser' && !hasBrowserTabs) {
          nextActiveTabTypeByWorktree[worktreeId] = getFallbackTabTypeForWorktree(
            worktreeId,
            s.openFiles,
            s.tabsByWorktree,
            browserTabsByWorktree
          )
        }
      }

      const activeTabType = (() => {
        if (!activeWorktreeId) {
          return s.activeTabType
        }
        const restoredTabType = nextActiveTabTypeByWorktree[activeWorktreeId]
        if (restoredTabType === 'browser' && activeBrowserTabId) {
          return 'browser'
        }
        if (
          restoredTabType === 'editor' &&
          s.openFiles.some((file) => file.worktreeId === activeWorktreeId)
        ) {
          return 'editor'
        }
        return getFallbackTabTypeForWorktree(
          activeWorktreeId,
          s.openFiles,
          s.tabsByWorktree,
          browserTabsByWorktree
        )
      })()

      return {
        browserTabsByWorktree,
        browserPagesByWorkspace,
        activeBrowserTabIdByWorktree,
        activeBrowserTabId,
        activeTabTypeByWorktree: nextActiveTabTypeByWorktree,
        activeTabType,
        remoteBrowserPageHandlesByPageId: {},
        browserCertificateFailuresByPageId: {},
        browserAnnotationsByPageId: {},
        browserUrlHistory: normalizeBrowserHistoryEntries(session.browserUrlHistory ?? [])
      }
    })

    const state = get()
    for (const [worktreeId, browserTabs] of Object.entries(state.browserTabsByWorktree)) {
      for (const bt of browserTabs) {
        const exists = (state.unifiedTabsByWorktree[worktreeId] ?? []).some(
          (t) => t.contentType === 'browser' && t.entityId === bt.id
        )
        if (!exists) {
          state.createUnifiedTab(worktreeId, 'browser', {
            entityId: bt.id,
            label: bt.title,
            recordInteraction: false
          })
        }
      }
    }
  },
  switchBrowserTabProfile: (workspaceId, profileId, sessionPartition) => {
    set((s) => {
      for (const [worktreeId, tabs] of Object.entries(s.browserTabsByWorktree)) {
        const tabIndex = tabs.findIndex((t) => t.id === workspaceId)
        if (tabIndex !== -1) {
          const updatedTabs = [...tabs]
          updatedTabs[tabIndex] = {
            ...updatedTabs[tabIndex],
            sessionProfileId: profileId,
            sessionPartition: sessionPartition ?? null
          }
          return {
            browserTabsByWorktree: {
              ...s.browserTabsByWorktree,
              [worktreeId]: updatedTabs
            }
          }
        }
      }
      return {}
    })
  },
  fetchBrowserSessionProfiles: async () => {
    const hostId = getBrowserSettingsHostId(get())
    const runtimeEnvironmentId = getBrowserSettingsRuntimeEnvironmentId(get())
    if (runtimeEnvironmentId) {
      try {
        const result = await callRuntimeRpc<BrowserProfileListResult>(
          { kind: 'environment', environmentId: runtimeEnvironmentId },
          'browser.profileList',
          undefined,
          { timeoutMs: 15_000 }
        )
        set((s) => profileListByHostUpdate(s, result.profiles, hostId))
      } catch {
        set((s) => profileListByHostUpdate(s, [], hostId))
      }
      return
    }
    try {
      const profiles = (await window.api.browser.sessionListProfiles()) as BrowserSessionProfile[]
      set((s) => profileListByHostUpdate(s, profiles, hostId))
    } catch {
      /* best-effort — stale profile list is preferable to a crash */
    }
  },
  }
}
