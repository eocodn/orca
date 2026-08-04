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
export function createBrowserSliceCreateBrowserPageActions3(set: SliceSet, get: SliceGet) {
  return {
  createBrowserPage: (workspaceId, url, options) => {
    const workspace = findWorkspace(get().browserTabsByWorktree, workspaceId)
    if (!workspace) {
      return null
    }
    const page = buildBrowserPage(
      workspaceId,
      workspace.worktreeId,
      url,
      options?.title,
      options?.browserRuntimeEnvironmentId
    )

    set((s) => {
      const pages = s.browserPagesByWorkspace[workspaceId] ?? []
      const shouldActivate = options?.activate ?? true
      const nextPages = [...pages, page]
      const nextWorkspace = mirrorWorkspaceFromActivePage(
        {
          ...workspace,
          activePageId: shouldActivate ? page.id : (workspace.activePageId ?? page.id),
          pageIds: nextPages.map((entry) => entry.id)
        },
        nextPages
      )
      const shouldUpdateGlobalActiveSurface =
        shouldActivate &&
        s.activeWorktreeId === workspace.worktreeId &&
        s.activeBrowserTabIdByWorktree[workspace.worktreeId] === workspaceId
      const shouldFocusAddressBar =
        shouldUpdateGlobalActiveSurface &&
        (page.url === 'about:blank' || page.url === ORCA_BROWSER_BLANK_URL)

      return {
        browserPagesByWorkspace: {
          ...s.browserPagesByWorkspace,
          [workspaceId]: nextPages
        },
        browserTabsByWorktree: {
          ...s.browserTabsByWorktree,
          [workspace.worktreeId]: (s.browserTabsByWorktree[workspace.worktreeId] ?? []).map((tab) =>
            tab.id === workspaceId ? nextWorkspace : tab
          )
        },
        pendingAddressBarFocusByPageId: shouldFocusAddressBar
          ? {
              ...s.pendingAddressBarFocusByPageId,
              [page.id]: true
            }
          : s.pendingAddressBarFocusByPageId,
        pendingAddressBarFocusByTabId: shouldFocusAddressBar
          ? {
              ...s.pendingAddressBarFocusByTabId,
              [page.id]: true
            }
          : s.pendingAddressBarFocusByTabId
      }
    })

    const nextWorkspace = findWorkspace(get().browserTabsByWorktree, workspaceId)
    if (nextWorkspace?.activePageId === page.id) {
      const item = Object.values(get().unifiedTabsByWorktree)
        .flat()
        .find((entry) => entry.contentType === 'browser' && entry.entityId === workspaceId)
      if (item) {
        get().setTabLabel(item.id, page.title)
      }
    }
    return page
  },
  closeBrowserPage: (pageId) => {
    let closedWorkspaceIdForLabel: string | null = null
    const remotePagesToClose: { worktreeId: string; handle: RemoteBrowserPageHandle }[] = []
    set((s) => {
      const page = findPage(s.browserPagesByWorkspace, pageId)
      if (!page) {
        return s
      }
      const workspace = findWorkspace(s.browserTabsByWorktree, page.workspaceId)
      if (!workspace) {
        return s
      }
      closedWorkspaceIdForLabel = page.workspaceId
      const currentPages = s.browserPagesByWorkspace[workspace.id] ?? []
      const nextPages = currentPages.filter((entry) => entry.id !== pageId)
      const closedIdx = currentPages.findIndex((entry) => entry.id === pageId)
      const nextActivePageId =
        workspace.activePageId === pageId
          ? ((nextPages[closedIdx] ?? nextPages[closedIdx - 1] ?? null)?.id ?? null)
          : workspace.activePageId
      const nextWorkspace = mirrorWorkspaceFromActivePage(
        {
          ...workspace,
          activePageId: nextActivePageId,
          pageIds: nextPages.map((entry) => entry.id)
        },
        nextPages
      )
      const remoteHandle = s.remoteBrowserPageHandlesByPageId[pageId]
      if (remoteHandle) {
        remotePagesToClose.push({ worktreeId: page.worktreeId, handle: remoteHandle })
      }
      const nextRemoteBrowserPageHandlesByPageId = {
        ...s.remoteBrowserPageHandlesByPageId
      }
      delete nextRemoteBrowserPageHandlesByPageId[pageId]
      const nextBrowserAnnotationsByPageId = { ...s.browserAnnotationsByPageId }
      delete nextBrowserAnnotationsByPageId[pageId]
      const nextBrowserCertificateFailuresByPageId = {
        ...s.browserCertificateFailuresByPageId
      }
      delete nextBrowserCertificateFailuresByPageId[pageId]

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
        recentlyClosedBrowserPagesByWorkspace: {
          ...s.recentlyClosedBrowserPagesByWorkspace,
          [workspace.id]: [
            page,
            ...(s.recentlyClosedBrowserPagesByWorkspace[workspace.id] ?? []).filter(
              (entry) => entry.id !== page.id
            )
          ].slice(0, 10)
        },
        pendingAddressBarFocusByPageId: Object.fromEntries(
          Object.entries(s.pendingAddressBarFocusByPageId).filter(
            ([pendingPageId]) => pendingPageId !== pageId
          )
        ),
        pendingAddressBarFocusByTabId: Object.fromEntries(
          Object.entries(s.pendingAddressBarFocusByTabId).filter(
            ([pendingPageId]) => pendingPageId !== pageId
          )
        ),
        remoteBrowserPageHandlesByPageId: nextRemoteBrowserPageHandlesByPageId,
        browserCertificateFailuresByPageId: nextBrowserCertificateFailuresByPageId,
        browserAnnotationsByPageId: nextBrowserAnnotationsByPageId
      }
    })

    for (const remotePage of remotePagesToClose) {
      closeRemoteBrowserPageInOwningEnvironment(remotePage.worktreeId, remotePage.handle)
    }

    const closedWorkspaceId = closedWorkspaceIdForLabel
    if (!closedWorkspaceId) {
      return
    }
    const workspace = findWorkspace(get().browserTabsByWorktree, closedWorkspaceId)
    const item = Object.values(get().unifiedTabsByWorktree)
      .flat()
      .find((entry) => entry.contentType === 'browser' && entry.entityId === closedWorkspaceId)
    if (item && workspace) {
      get().setTabLabel(item.id, workspace.title)
    }
  },
  reopenClosedBrowserPage: (workspaceId) => {
    // Why: read and pop atomically inside set() so two rapid Cmd+Shift+T presses can't both restore the same page (TOCTOU).
    let pageToRestore: BrowserPage | undefined

    set((s) => {
      const recentlyClosed = s.recentlyClosedBrowserPagesByWorkspace[workspaceId] ?? []
      pageToRestore = recentlyClosed[0]
      if (!pageToRestore) {
        return s
      }
      return {
        recentlyClosedBrowserPagesByWorkspace: {
          ...s.recentlyClosedBrowserPagesByWorkspace,
          [workspaceId]: recentlyClosed.slice(1)
        }
      }
    })

    if (!pageToRestore) {
      return null
    }

    return get().createBrowserPage(workspaceId, pageToRestore.url, {
      title: pageToRestore.title,
      activate: true,
      browserRuntimeEnvironmentId: pageToRestore.browserRuntimeEnvironmentId
    })
  },
  setActiveBrowserPage: (workspaceId, pageId) => {
    set((s) => {
      const workspace = findWorkspace(s.browserTabsByWorktree, workspaceId)
      if (!workspace) {
        return s
      }
      const pages = s.browserPagesByWorkspace[workspaceId] ?? []
      if (!pages.some((page) => page.id === pageId)) {
        return s
      }
      const nextWorkspace = mirrorWorkspaceFromActivePage(
        {
          ...workspace,
          activePageId: pageId
        },
        pages
      )
      return {
        browserTabsByWorktree: {
          ...s.browserTabsByWorktree,
          [workspace.worktreeId]: (s.browserTabsByWorktree[workspace.worktreeId] ?? []).map((tab) =>
            tab.id === workspaceId ? nextWorkspace : tab
          )
        }
      }
    })

    // Why: switching the active page changes which guest webContents the CDP bridge targets for agent commands.
    const activePage = (get().browserPagesByWorkspace[workspaceId] ?? []).find(
      (page) => page.id === pageId
    )
    const workspace = findWorkspace(get().browserTabsByWorktree, workspaceId)
    if (
      workspace &&
      isLocalBrowserPageOwner(
        get(),
        workspace.worktreeId,
        activePage?.browserRuntimeEnvironmentId
      ) &&
      typeof window !== 'undefined' &&
      window.api?.browser
    ) {
      getClientRuntime().browser.notifyActiveTabChanged({ browserPageId: pageId }).catch(() => {})
    }
    if (!workspace) {
      return
    }
    const item = Object.values(get().unifiedTabsByWorktree)
      .flat()
      .find((entry) => entry.contentType === 'browser' && entry.entityId === workspaceId)
    if (item) {
      get().setTabLabel(item.id, workspace.title)
    }
  },
  }
}
