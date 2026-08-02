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
export function createBrowserSliceCloseBrowserTabActions2(set: SliceSet, get: SliceGet) {
  return {
  closeBrowserTab: (tabId) => {
    let remotePagesToClose: { worktreeId: string; handle: RemoteBrowserPageHandle }[] = []
    set((s) => {
      let owningWorktreeId: string | null = null
      let closedWorkspace: BrowserWorkspace | null = null
      const nextBrowserTabsByWorktree: Record<string, BrowserWorkspace[]> = {}
      for (const [worktreeId, tabs] of Object.entries(s.browserTabsByWorktree)) {
        const removedTab = tabs.find((tab) => tab.id === tabId) ?? null
        const filtered = tabs.filter((tab) => tab.id !== tabId)
        if (filtered.length !== tabs.length) {
          owningWorktreeId = worktreeId
          closedWorkspace = removedTab
        }
        if (filtered.length > 0) {
          nextBrowserTabsByWorktree[worktreeId] = filtered
        }
      }
      if (!owningWorktreeId || !closedWorkspace) {
        return s
      }

      const closedPages = s.browserPagesByWorkspace[tabId] ?? []
      const nextBrowserPagesByWorkspace = { ...s.browserPagesByWorkspace }
      delete nextBrowserPagesByWorkspace[tabId]
      const nextBrowserAnnotationsByPageId = { ...s.browserAnnotationsByPageId }
      const nextBrowserCertificateFailuresByPageId = {
        ...s.browserCertificateFailuresByPageId
      }
      for (const page of closedPages) {
        delete nextBrowserAnnotationsByPageId[page.id]
        delete nextBrowserCertificateFailuresByPageId[page.id]
      }
      remotePagesToClose = closedPages.flatMap((page) => {
        const handle = s.remoteBrowserPageHandlesByPageId[page.id]
        return handle ? [{ worktreeId: page.worktreeId, handle }] : []
      })
      const nextRemoteBrowserPageHandlesByPageId = {
        ...s.remoteBrowserPageHandlesByPageId
      }
      for (const page of closedPages) {
        delete nextRemoteBrowserPageHandlesByPageId[page.id]
      }

      const nextActiveBrowserTabIdByWorktree = { ...s.activeBrowserTabIdByWorktree }
      const remainingBrowserTabs = nextBrowserTabsByWorktree[owningWorktreeId] ?? []
      const tabBarOrder = s.tabBarOrderByWorktree[owningWorktreeId] ?? []
      const neighborTabId = pickNeighbor(tabBarOrder, tabId)
      if (nextActiveBrowserTabIdByWorktree[owningWorktreeId] === tabId) {
        nextActiveBrowserTabIdByWorktree[owningWorktreeId] =
          neighborTabId ?? remainingBrowserTabs[0]?.id ?? null
      }

      const nextTabBarOrder = {
        ...s.tabBarOrderByWorktree,
        [owningWorktreeId]: (s.tabBarOrderByWorktree[owningWorktreeId] ?? []).filter(
          (entryId) => entryId !== tabId
        )
      }

      const isActiveTabInOwningWorktree =
        s.activeWorktreeId === owningWorktreeId && s.activeBrowserTabId === tabId
      const nextActiveTabTypeByWorktree = { ...s.activeTabTypeByWorktree }
      let nextActiveTabType = s.activeTabType
      if (remainingBrowserTabs.length === 0) {
        const fallbackTabType = getFallbackTabTypeForWorktree(
          owningWorktreeId,
          s.openFiles,
          s.tabsByWorktree
        )
        nextActiveTabTypeByWorktree[owningWorktreeId] = fallbackTabType
        if (isActiveTabInOwningWorktree && s.activeTabType === 'browser') {
          nextActiveTabType = fallbackTabType
        }
      }

      const nextRecentlyClosedBrowserTabsByWorktree = { ...s.recentlyClosedBrowserTabsByWorktree }
      const existingSnapshots = nextRecentlyClosedBrowserTabsByWorktree[owningWorktreeId] ?? []
      nextRecentlyClosedBrowserTabsByWorktree[owningWorktreeId] = [
        { workspace: closedWorkspace, pages: closedPages },
        ...existingSnapshots.filter((entry) => entry.workspace.id !== closedWorkspace.id)
      ].slice(0, 10)
      const nextRecentlyClosedTabKindsByWorktree = pushRecentlyClosedTabKind(
        s.recentlyClosedTabKindsByWorktree,
        owningWorktreeId,
        'browser'
      )

      const nextRecentlyClosedBrowserPagesByWorkspace = {
        ...s.recentlyClosedBrowserPagesByWorkspace
      }
      delete nextRecentlyClosedBrowserPagesByWorkspace[tabId]

      const nextPendingAddressBarFocusByPageId = Object.fromEntries(
        Object.entries(s.pendingAddressBarFocusByPageId).filter(
          ([pageId]) => !closedPages.some((page) => page.id === pageId)
        )
      )
      const nextPendingAddressBarFocusByTabId = Object.fromEntries(
        Object.entries(s.pendingAddressBarFocusByTabId).filter(
          ([focusId]) => focusId !== tabId && !closedPages.some((page) => page.id === focusId)
        )
      )

      return {
        browserTabsByWorktree: nextBrowserTabsByWorktree,
        browserPagesByWorkspace: nextBrowserPagesByWorkspace,
        activeBrowserTabId:
          s.activeBrowserTabId === tabId
            ? (neighborTabId ?? remainingBrowserTabs[0]?.id ?? null)
            : s.activeBrowserTabId,
        activeBrowserTabIdByWorktree: nextActiveBrowserTabIdByWorktree,
        tabBarOrderByWorktree: nextTabBarOrder,
        activeTabType: nextActiveTabType,
        pendingAddressBarFocusByPageId: nextPendingAddressBarFocusByPageId,
        pendingAddressBarFocusByTabId: nextPendingAddressBarFocusByTabId,
        activeTabTypeByWorktree: nextActiveTabTypeByWorktree,
        recentlyClosedBrowserTabsByWorktree: nextRecentlyClosedBrowserTabsByWorktree,
        recentlyClosedTabKindsByWorktree: nextRecentlyClosedTabKindsByWorktree,
        recentlyClosedBrowserPagesByWorkspace: nextRecentlyClosedBrowserPagesByWorkspace,
        remoteBrowserPageHandlesByPageId: nextRemoteBrowserPageHandlesByPageId,
        browserCertificateFailuresByPageId: nextBrowserCertificateFailuresByPageId,
        browserAnnotationsByPageId: nextBrowserAnnotationsByPageId
      }
    })

    for (const remotePage of remotePagesToClose) {
      closeRemoteBrowserPageInOwningEnvironment(remotePage.worktreeId, remotePage.handle)
    }

    for (const tabs of Object.values(get().unifiedTabsByWorktree)) {
      const workspaceItem = tabs.find(
        (entry) => entry.contentType === 'browser' && entry.entityId === tabId
      )
      if (workspaceItem) {
        get().closeUnifiedTab(workspaceItem.id)
      }
    }
  },
  shutdownWorktreeBrowsers: async (worktreeId) => {
    const workspaces = get().browserTabsByWorktree[worktreeId] ?? []
    // Why: snapshot before the loop — closeBrowserTab empties the array, so set() below couldn't recompute hadBrowserTabs.
    const hadBrowserTabs = workspaces.length > 0
    for (const workspace of workspaces) {
      destroyWorkspaceWebviews(get().browserPagesByWorkspace, workspace.id)
      get().closeBrowserTab(workspace.id)
    }
    set((s) => {
      const nextBrowserTabsByWorktree = { ...s.browserTabsByWorktree }
      delete nextBrowserTabsByWorktree[worktreeId]
      const nextActiveBrowserTabIdByWorktree = { ...s.activeBrowserTabIdByWorktree }
      delete nextActiveBrowserTabIdByWorktree[worktreeId]
      // Why: reset the global browser surface only when the shut-down worktree is the active one AND had tabs.
      const shouldResetGlobalBrowser = s.activeWorktreeId === worktreeId && hadBrowserTabs
      return {
        browserTabsByWorktree: nextBrowserTabsByWorktree,
        activeBrowserTabIdByWorktree: nextActiveBrowserTabIdByWorktree,
        ...(shouldResetGlobalBrowser
          ? { activeBrowserTabId: null, activeTabType: 'terminal' as const }
          : {})
      }
    })
  },
  reopenClosedBrowserTab: (worktreeId) => {
    // Why: read and pop atomically inside set() so two rapid Cmd+Shift+T presses can't both restore the same entry (TOCTOU).
    let entryToRestore: ClosedBrowserWorkspaceSnapshot | undefined

    set((s) => {
      const recentlyClosed = s.recentlyClosedBrowserTabsByWorktree[worktreeId] ?? []
      entryToRestore = recentlyClosed[0]
      if (!entryToRestore) {
        return s
      }
      return {
        recentlyClosedBrowserTabsByWorktree: {
          ...s.recentlyClosedBrowserTabsByWorktree,
          [worktreeId]: recentlyClosed.slice(1)
        }
      }
    })

    if (!entryToRestore) {
      return null
    }

    const snap = entryToRestore.workspace
    const pages = entryToRestore.pages
    const sessionProfileId = snap.sessionProfileId ?? null
    const sessionPartition = snap.sessionPartition ?? null

    if (pages.length === 0) {
      const restored = get().createBrowserTab(worktreeId, snap.url, {
        title: snap.title,
        activate: true,
        sessionProfileId,
        sessionPartition
      })
      return get().browserTabsByWorktree[worktreeId]?.find((tab) => tab.id === restored.id) ?? null
    }

    // Why: append remaining pages in original order so multi-page workspaces preserve their page sequence.
    const [firstPage, ...restPages] = pages
    const restored = get().createBrowserTab(worktreeId, firstPage.url, {
      title: firstPage.title,
      activate: true,
      sessionProfileId,
      sessionPartition,
      browserRuntimeEnvironmentId: firstPage.browserRuntimeEnvironmentId
    })

    for (const p of restPages) {
      get().createBrowserPage(restored.id, p.url, {
        activate: false,
        title: p.title,
        browserRuntimeEnvironmentId: p.browserRuntimeEnvironmentId
      })
    }

    // Why: duplicate URLs are valid, so matching by URL can pick the wrong copy; restore preserves order, so map by index.
    const activePageId = snap.activePageId
    if (activePageId) {
      const restoredPages = get().browserPagesByWorkspace[restored.id] ?? []
      const activePageIndex = pages.findIndex((orig) => orig.id === activePageId)
      const targetPage = activePageIndex >= 0 ? restoredPages[activePageIndex] : null
      if (targetPage && targetPage.id !== restoredPages[0]?.id) {
        get().setActiveBrowserPage(restored.id, targetPage.id)
      }
    }

    return get().browserTabsByWorktree[worktreeId]?.find((tab) => tab.id === restored.id) ?? null
  },
  setActiveBrowserTab: (tabId) => {
    set((s) => {
      const browserTab = findWorkspace(s.browserTabsByWorktree, tabId)
      if (!browserTab) {
        return s
      }
      return {
        activeBrowserTabId: tabId,
        activeBrowserTabIdByWorktree: {
          ...s.activeBrowserTabIdByWorktree,
          [browserTab.worktreeId]: tabId
        },
        activeTabType: 'browser',
        activeTabTypeByWorktree: {
          ...s.activeTabTypeByWorktree,
          [browserTab.worktreeId]: 'browser'
        }
      }
    })

    // Why: notify the CDP bridge of the active guest; it keys on page IDs not workspace IDs, so resolve the workspace's active page.
    const workspace = findWorkspace(get().browserTabsByWorktree, tabId)
    const activePage = workspace?.activePageId
      ? (get().browserPagesByWorkspace[workspace.id] ?? []).find(
          (page) => page.id === workspace.activePageId
        )
      : undefined
    if (
      workspace?.activePageId &&
      isLocalBrowserPageOwner(
        get(),
        workspace.worktreeId,
        activePage?.browserRuntimeEnvironmentId
      ) &&
      typeof window !== 'undefined' &&
      window.api?.browser
    ) {
      window.api.browser
        .notifyActiveTabChanged({ browserPageId: workspace.activePageId })
        .catch(() => {})
    }

    const item = Object.values(get().unifiedTabsByWorktree)
      .flat()
      .find((entry) => entry.contentType === 'browser' && entry.entityId === tabId)
    if (item) {
      get().activateTab(item.id)
    }
  },
  }
}