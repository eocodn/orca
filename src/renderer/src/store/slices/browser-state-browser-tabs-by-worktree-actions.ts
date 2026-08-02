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
export function createBrowserSliceBrowserTabsByWorktreeActions(set: SliceSet, get: SliceGet) {
  return {
  browserTabsByWorktree: {},
  browserPagesByWorkspace: {},
  browserCertificateFailuresByPageId: {},
  browserAnnotationsByPageId: {},
  remoteBrowserPageHandlesByPageId: {},
  activeBrowserTabId: null,
  activeBrowserTabIdByWorktree: {},
  recentlyClosedBrowserTabsByWorktree: {},
  recentlyClosedBrowserPagesByWorkspace: {},
  pendingAddressBarFocusByTabId: {},
  pendingAddressBarFocusByPageId: {},
  browserSessionProfiles: [],
  browserSessionProfilesByHostId: {},
  browserSessionHostIdOverride: null,
  browserSessionImportState: null,
  browserUrlHistory: [],
  defaultBrowserSessionProfileId: null,
  defaultBrowserSessionProfileIdByHostId: {},
  setBrowserSessionHostId: async (hostId) => {
    const parsed = parseExecutionHostId(hostId)
    if (parsed?.kind !== 'local' && parsed?.kind !== 'runtime') {
      return
    }
    const nextHostId = parsed.id
    set((s) => ({
      browserSessionHostIdOverride: nextHostId,
      browserSessionProfiles: s.browserSessionProfilesByHostId[nextHostId] ?? [],
      defaultBrowserSessionProfileId: s.defaultBrowserSessionProfileIdByHostId[nextHostId] ?? null,
      browserSessionImportState: null,
      detectedBrowsers: [],
      detectedBrowsersLoaded: false
    }))
    await Promise.all([get().fetchBrowserSessionProfiles(), get().fetchDetectedBrowsers()])
  },
  setDefaultBrowserSessionProfileId: (profileId) => {
    set((s) => ({
      defaultBrowserSessionProfileId: profileId,
      defaultBrowserSessionProfileIdByHostId: {
        ...s.defaultBrowserSessionProfileIdByHostId,
        [getBrowserSettingsHostId(s)]: profileId
      }
    }))
  },
  createBrowserTab: (worktreeId, url, options) => {
    const workspaceId = createBrowserUuid()
    const page = buildBrowserPage(
      workspaceId,
      worktreeId,
      url,
      options?.title,
      options?.browserRuntimeEnvironmentId
    )
    // Why: with no explicit profile, inherit the user's default so a Settings preference applies to new tabs.
    const sessionProfileId =
      options?.sessionProfileId !== undefined
        ? options.sessionProfileId
        : (get().defaultBrowserSessionProfileIdByHostId[
            getBrowserSessionProfileHostId(get(), worktreeId, options?.browserRuntimeEnvironmentId)
          ] ?? get().defaultBrowserSessionProfileId)
    const browserTab = buildWorkspaceFromPage(
      workspaceId,
      worktreeId,
      page,
      [page.id],
      sessionProfileId,
      options?.sessionPartition
    )

    set((s) => {
      const existingTabs = s.browserTabsByWorktree[worktreeId] ?? []
      const nextTabBarOrder = (() => {
        const currentOrder = s.tabBarOrderByWorktree[worktreeId] ?? []
        const terminalIds = (s.tabsByWorktree[worktreeId] ?? []).map((tab) => tab.id)
        const editorIds = s.openFiles
          .filter((file) => file.worktreeId === worktreeId)
          .map((file) => file.id)
        const browserIds = existingTabs.map((tab) => tab.id)
        const allExistingIds = new Set([...terminalIds, ...editorIds, ...browserIds])
        const base = currentOrder.filter((entryId) => allExistingIds.has(entryId))
        const inBase = new Set(base)
        for (const entryId of [...terminalIds, ...editorIds, ...browserIds]) {
          if (!inBase.has(entryId)) {
            base.push(entryId)
            inBase.add(entryId)
          }
        }
        base.push(workspaceId)
        return base
      })()

      const shouldActivate = options?.activate ?? true
      const shouldUpdateGlobalActiveSurface = shouldActivate && s.activeWorktreeId === worktreeId
      const shouldFocusFloatingTab = shouldActivate && worktreeId === FLOATING_TERMINAL_WORKTREE_ID
      const shouldFocusAddressBar =
        (shouldUpdateGlobalActiveSurface || shouldFocusFloatingTab) &&
        (options?.focusAddressBar ??
          (page.url === 'about:blank' || page.url === ORCA_BROWSER_BLANK_URL))

      return {
        browserTabsByWorktree: {
          ...s.browserTabsByWorktree,
          [worktreeId]: [...existingTabs, browserTab]
        },
        browserPagesByWorkspace: {
          ...s.browserPagesByWorkspace,
          [workspaceId]: [page]
        },
        tabBarOrderByWorktree: {
          ...s.tabBarOrderByWorktree,
          [worktreeId]: nextTabBarOrder
        },
        activeBrowserTabId: shouldUpdateGlobalActiveSurface ? workspaceId : s.activeBrowserTabId,
        activeBrowserTabIdByWorktree: {
          ...s.activeBrowserTabIdByWorktree,
          [worktreeId]: shouldActivate
            ? workspaceId
            : (s.activeBrowserTabIdByWorktree[worktreeId] ?? null)
        },
        activeTabType: shouldUpdateGlobalActiveSurface ? 'browser' : s.activeTabType,
        activeTabTypeByWorktree: shouldActivate
          ? { ...s.activeTabTypeByWorktree, [worktreeId]: 'browser' }
          : s.activeTabTypeByWorktree,
        pendingAddressBarFocusByPageId: shouldFocusAddressBar
          ? {
              ...s.pendingAddressBarFocusByPageId,
              [page.id]: true
            }
          : s.pendingAddressBarFocusByPageId,
        pendingAddressBarFocusByTabId: shouldFocusAddressBar
          ? {
              ...s.pendingAddressBarFocusByTabId,
              [workspaceId]: true,
              [page.id]: true
            }
          : s.pendingAddressBarFocusByTabId
      }
    })

    const state = get()
    const alreadyHasUnifiedTab = (state.unifiedTabsByWorktree[worktreeId] ?? []).some(
      (t) => t.contentType === 'browser' && t.entityId === workspaceId
    )
    if (!alreadyHasUnifiedTab) {
      state.createUnifiedTab(worktreeId, 'browser', {
        entityId: workspaceId,
        label: browserTab.title,
        targetGroupId: options?.targetGroupId,
        activate: options?.activate ?? true
      })
    }
    return browserTab
  },
  openNewBrowserTabInActiveWorkspace: async (groupId) => {
    const state = get()
    const worktreeId = state.activeWorktreeId
    if (!worktreeId) {
      return
    }
    const defaultUrl = state.browserDefaultUrl ?? 'about:blank'
    const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(state, worktreeId)
    if (runtimeEnvironmentId) {
      const { createWebRuntimeSessionBrowserTab } = await import('@/runtime/web-runtime-session')
      try {
        const created = await createWebRuntimeSessionBrowserTab({
          worktreeId,
          environmentId: runtimeEnvironmentId,
          url: defaultUrl,
          targetGroupId: groupId
        })
        if (created) {
          get().recordFeatureInteraction('browser-tab-created')
          return
        }
      } catch (error) {
        // Why: browser.headless.v1 remotes succeed above, so a failure here is real; surface it instead of a confusing local-tab fallback (split ownership).
        console.warn(
          '[browser] remote browser tab creation failed:',
          error instanceof Error ? error.message : String(error)
        )
      }
      return
    }
    get().createBrowserTab(worktreeId, defaultUrl, {
      title: translate('auto.store.slices.browser.d175274b6d', 'New Browser Tab'),
      focusAddressBar: true,
      targetGroupId: groupId
    })
    get().recordFeatureInteraction('browser-tab-created')
  },
  }
}