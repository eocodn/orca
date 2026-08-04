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
export function createBrowserSliceFocusBrowserTabInWorktreeActions4(set: SliceSet, get: SliceGet) {
  return {
  focusBrowserTabInWorktree: (worktreeId, browserPageId, options) => {
    // Why: bridge targets a browserPageId but tabs activate a workspace; find the owning workspace (they differ for multi-page tabs).
    const tabsForWorktree = get().browserTabsByWorktree[worktreeId] ?? []
    const workspace = tabsForWorktree.find((tab) => (tab.pageIds ?? []).includes(browserPageId))
    if (!workspace) {
      // Best-effort: worktree state may not be hydrated yet, or the page closed between bridge switch and this IPC arriving.
      return
    }
    // Default true: the only caller (tab switch --focus) wants the pane surfaced; false is an opt-out for pre-staging callers.
    const surfacePane = options?.surfacePane ?? true
    const pages = get().browserPagesByWorkspace[workspace.id] ?? []
    const nextWorkspace = mirrorWorkspaceFromActivePage(
      { ...workspace, activePageId: browserPageId },
      pages
    )
    // TODO: duplicates setActiveBrowserTab/Page; can't reuse (they touch globals unconditionally). Extract a per-worktree-only helper.
    set((s) => {
      const isActiveWorktree = s.activeWorktreeId === worktreeId
      // Per-worktree slots: always update — safe pre-staging, only visible when user navigates here.
      const nextTabsByWorktree = {
        ...s.browserTabsByWorktree,
        [worktreeId]: tabsForWorktree.map((tab) => (tab.id === workspace.id ? nextWorkspace : tab))
      }
      const nextActiveTabIdByWorktree = {
        ...s.activeBrowserTabIdByWorktree,
        [worktreeId]: workspace.id
      }
      const nextActiveTabTypeByWorktree = surfacePane
        ? { ...s.activeTabTypeByWorktree, [worktreeId]: 'browser' as const }
        : s.activeTabTypeByWorktree
      // Globals: mutate only when the targeted worktree is active — keeps cross-worktree --focus silent.
      return {
        browserTabsByWorktree: nextTabsByWorktree,
        activeBrowserTabIdByWorktree: nextActiveTabIdByWorktree,
        activeTabTypeByWorktree: nextActiveTabTypeByWorktree,
        activeBrowserTabId: isActiveWorktree ? workspace.id : s.activeBrowserTabId,
        activeTabType: isActiveWorktree && surfacePane ? 'browser' : s.activeTabType
      }
    })

    // Why: notify the CDP bridge which guest webContents is active so agent commands target the correct page.
    const focusedPage = pages.find((page) => page.id === browserPageId)
    if (
      isLocalBrowserPageOwner(get(), worktreeId, focusedPage?.browserRuntimeEnvironmentId) &&
      typeof window !== 'undefined' &&
      window.api?.browser
    ) {
      getClientRuntime().browser.notifyActiveTabChanged({ browserPageId }).catch(() => {})
    }

    // Why: sync the unified-tab strip's active entry; activateTab only mutates per-worktree slices, so it's cross-worktree-safe.
    const item = (get().unifiedTabsByWorktree[worktreeId] ?? []).find(
      (entry) => entry.contentType === 'browser' && entry.entityId === workspace.id
    )
    if (item) {
      get().activateTab(item.id)
    }
  },
  consumeAddressBarFocusRequest: (pageId) => {
    const state = get()
    if (
      !state.pendingAddressBarFocusByPageId[pageId] &&
      !state.pendingAddressBarFocusByTabId[pageId]
    ) {
      return false
    }

    set((s) => {
      const nextByPageId = { ...s.pendingAddressBarFocusByPageId }
      delete nextByPageId[pageId]
      const nextByTabId = { ...s.pendingAddressBarFocusByTabId }
      delete nextByTabId[pageId]
      return {
        pendingAddressBarFocusByPageId: nextByPageId,
        pendingAddressBarFocusByTabId: nextByTabId
      }
    })

    return true
  },
  updateBrowserTabPageState: (pageId, updates) => get().updateBrowserPageState(pageId, updates),
  updateBrowserPageState: (pageId, updates) => {
    set((s) => {
      const page = findPage(s.browserPagesByWorkspace, pageId)
      if (!page) {
        return s
      }
      const workspace = findWorkspace(s.browserTabsByWorktree, page.workspaceId)
      if (!workspace) {
        return s
      }
      const nextPage = {
        ...page,
        title:
          updates.title === undefined ? page.title : normalizeBrowserTitle(updates.title, page.url),
        loading: updates.loading ?? page.loading,
        faviconUrl: updates.faviconUrl === undefined ? page.faviconUrl : updates.faviconUrl,
        canGoBack: updates.canGoBack ?? page.canGoBack,
        canGoForward: updates.canGoForward ?? page.canGoForward,
        loadError: updates.loadError === undefined ? page.loadError : updates.loadError
      }
      const unifiedTabs = s.unifiedTabsByWorktree[workspace.worktreeId] ?? []
      const unifiedIndex =
        workspace.activePageId === pageId && updates.title !== undefined
          ? unifiedTabs.findIndex(
              (entry) => entry.contentType === 'browser' && entry.entityId === workspace.id
            )
          : -1
      const unifiedLabelNeedsRepair =
        unifiedIndex !== -1 && unifiedTabs[unifiedIndex]?.label !== nextPage.title
      const pageStateUnchanged =
        nextPage.title === page.title &&
        nextPage.loading === page.loading &&
        nextPage.faviconUrl === page.faviconUrl &&
        nextPage.canGoBack === page.canGoBack &&
        nextPage.canGoForward === page.canGoForward &&
        nextPage.loadError === page.loadError
      const currentPages = s.browserPagesByWorkspace[workspace.id] ?? []
      const mirroredWorkspace = pageStateUnchanged
        ? mirrorWorkspaceFromActivePage(workspace, currentPages)
        : null
      const workspaceNeedsRepair =
        mirroredWorkspace !== null &&
        !browserWorkspaceMirrorFieldsEqual(workspace, mirroredWorkspace)
      if (pageStateUnchanged && !unifiedLabelNeedsRepair && !workspaceNeedsRepair) {
        return s
      }
      if (pageStateUnchanged) {
        const nextState: Partial<AppState> = {}
        if (workspaceNeedsRepair && mirroredWorkspace) {
          nextState.browserTabsByWorktree = {
            ...s.browserTabsByWorktree,
            [workspace.worktreeId]: (s.browserTabsByWorktree[workspace.worktreeId] ?? []).map(
              (tab) => (tab.id === workspace.id ? mirroredWorkspace : tab)
            )
          }
        }
        if (unifiedLabelNeedsRepair) {
          nextState.unifiedTabsByWorktree = {
            ...s.unifiedTabsByWorktree,
            [workspace.worktreeId]: unifiedTabs.map((entry, index) =>
              index === unifiedIndex ? { ...entry, label: nextPage.title } : entry
            )
          }
        }
        return nextState
      }
      const nextPages = currentPages.map((entry) => (entry.id === pageId ? nextPage : entry))
      const nextWorkspace = mirrorWorkspaceFromActivePage(workspace, nextPages)
      const nextState: Partial<AppState> = {
        browserPagesByWorkspace: {
          ...s.browserPagesByWorkspace,
          [workspace.id]: nextPages
        }
      }
      if (!browserWorkspaceMirrorFieldsEqual(workspace, nextWorkspace)) {
        nextState.browserTabsByWorktree = {
          ...s.browserTabsByWorktree,
          [workspace.worktreeId]: (s.browserTabsByWorktree[workspace.worktreeId] ?? []).map((tab) =>
            tab.id === workspace.id ? nextWorkspace : tab
          )
        }
      }
      if (workspace.activePageId === pageId && updates.title !== undefined && unifiedIndex !== -1) {
        if (unifiedLabelNeedsRepair || unifiedTabs[unifiedIndex]?.label !== nextWorkspace.title) {
          nextState.unifiedTabsByWorktree = {
            ...s.unifiedTabsByWorktree,
            [workspace.worktreeId]: unifiedTabs.map((entry, index) =>
              index === unifiedIndex ? { ...entry, label: nextWorkspace.title } : entry
            )
          }
        }
      }
      return nextState
    })
    if (updates.loadError === null) {
      get().setBrowserPageCertificateFailure(pageId, null)
    }
  },
  setBrowserPageCertificateFailure: (pageId, failure) => {
    set((s) => {
      const current = s.browserCertificateFailuresByPageId[pageId]
      if (failure === null) {
        if (!current) {
          return s
        }
        const nextFailures = { ...s.browserCertificateFailuresByPageId }
        delete nextFailures[pageId]
        return { browserCertificateFailuresByPageId: nextFailures }
      }
      if (!findPage(s.browserPagesByWorkspace, pageId) || current === failure) {
        return s
      }
      return {
        browserCertificateFailuresByPageId: {
          ...s.browserCertificateFailuresByPageId,
          [pageId]: failure
        }
      }
    })
  },
  setBrowserTabUrl: (pageId, url) => get().setBrowserPageUrl(pageId, url),
  setBrowserPageUrl: (pageId, url) => {
    const nextUrl = normalizeUrl(url)
    if (nextUrl !== 'about:blank' && nextUrl !== ORCA_BROWSER_BLANK_URL) {
      const currentPage = findPage(get().browserPagesByWorkspace, pageId)
      if (currentPage) {
        get().recordFeatureInteraction?.('browser')
      }
    }
    set((s) => {
      const page = findPage(s.browserPagesByWorkspace, pageId)
      if (!page) {
        return s
      }
      const workspace = findWorkspace(s.browserTabsByWorktree, page.workspaceId)
      if (!workspace) {
        return s
      }
      // Why: annotations point at DOM coords of the loaded document; a real URL change invalidates those markers.
      const shouldClearAnnotations = normalizeUrl(page.url) !== nextUrl
      const nextPages = (s.browserPagesByWorkspace[workspace.id] ?? []).map((entry) =>
        entry.id === pageId
          ? {
              ...entry,
              url: nextUrl,
              title: normalizeBrowserTitle(entry.title, nextUrl),
              loading: true,
              loadError: null
            }
          : entry
      )
      const nextWorkspace = mirrorWorkspaceFromActivePage(workspace, nextPages)
      const nextBrowserAnnotationsByPageId = shouldClearAnnotations
        ? { ...s.browserAnnotationsByPageId }
        : s.browserAnnotationsByPageId
      if (shouldClearAnnotations) {
        delete nextBrowserAnnotationsByPageId[pageId]
      }
      return {
        browserPagesByWorkspace: {
          ...s.browserPagesByWorkspace,
          [workspace.id]: nextPages
        },
        browserTabsByWorktree: {
          ...s.browserTabsByWorktree,
          [workspace.worktreeId]: (s.browserTabsByWorktree[workspace.worktreeId] ?? []).map((tab) =>
            tab.id === workspace.id ? nextWorkspace : tab
          )
        },
        ...(shouldClearAnnotations
          ? { browserAnnotationsByPageId: nextBrowserAnnotationsByPageId }
          : {})
      }
    })
    get().setBrowserPageCertificateFailure(pageId, null)
  },
  setRemoteBrowserPageHandle: (pageId, handle) => {
    set((s) => ({
      remoteBrowserPageHandlesByPageId: {
        ...s.remoteBrowserPageHandlesByPageId,
        [pageId]: handle
      }
    }))
  },
  removeRemoteBrowserPageHandle: (pageId, remotePageId) => {
    let removedHandle: RemoteBrowserPageHandle | null = null
    set((s) => {
      const current = s.remoteBrowserPageHandlesByPageId[pageId]
      if (!current || (remotePageId && current.remotePageId !== remotePageId)) {
        return s
      }
      removedHandle = current
      const nextRemoteBrowserPageHandlesByPageId = {
        ...s.remoteBrowserPageHandlesByPageId
      }
      delete nextRemoteBrowserPageHandlesByPageId[pageId]
      return { remoteBrowserPageHandlesByPageId: nextRemoteBrowserPageHandlesByPageId }
    })
    return removedHandle
  },

  // viewportPresetId is intentionally page-local (no workspace-layer UI consumer); do NOT add mirrorWorkspaceFromActivePage here.
  }
}
