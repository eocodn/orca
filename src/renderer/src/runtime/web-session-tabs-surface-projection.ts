import { useEffect } from 'react'
import type { AppState } from '../store'
import { useAppStore } from '../store'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusEntry
} from '../../../shared/agent-status-types'
import type {
  RuntimeMobileSessionTabsResult,
  RuntimeMobileSessionBrowserTab,
  RuntimeMobileSessionFileTab,
  RuntimeMobileSessionMarkdownTab,
  RuntimeMobileSessionTabGroup,
  RuntimeMobileSessionTerminalClientTab
} from '../../../shared/runtime-types'
import type {
  BrowserCertificateFailure,
  BrowserPage,
  BrowserWorkspace,
  Tab,
  TabGroup,
  TabGroupLayoutNode,
  TerminalLayoutSnapshot,
  TerminalPaneLayoutNode,
  TerminalTab
} from '../../../shared/types'
import type { OpenFile } from '../store/slices/editor'
import { isTerminalLeafId, makePaneKey, parsePaneKey } from '../../../shared/stable-pane-id'
import { getRemoteRuntimePtyEnvironmentId, toRemoteRuntimePtyId } from './runtime-terminal-stream'
import { sanitizeTerminalLayoutPaneTitlesForLabels } from '@/lib/terminal-pane-title-sanitization'
import {
  getExplicitRuntimeEnvironmentIdForWorktree,
  getRuntimeSessionMirrorEnvironmentIds
} from '@/lib/worktree-runtime-owner'
import {
  createWebRuntimeSessionTerminal,
  HOST_TERMINAL_SURFACE_SEPARATOR,
  isWebTerminalSurfaceTabId,
  toWebTerminalSurfaceTabId,
  WEB_TERMINAL_SURFACE_TAB_PREFIX
} from './web-runtime-session'
import {
  normalizeCompatibleAgentStatusEntryForOwner,
  normalizeCompatibleAgentTitleForOwner
} from '../../../shared/agent-title-owner'
import { resolvePaneAgentOwner } from '../../../shared/pane-agent-owner'
import { resolveTerminalLayoutRoot } from './remote-terminal-layout-resolution'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'
import {
  clearWebSessionFocusIntent,
  clearWebSessionFocusIntentsForOwner,
  peekWebSessionFocusIntent
} from './web-session-focus-intent'
import {
  clearWebSessionCloseIntentsForOwner,
  clearWebSessionCloseIntentsForWorktree,
  isWebSessionCloseIntentPending,
  reconcileWebSessionCloseIntents
} from './web-session-close-intent'
import {
  clearWebSessionReorderIntentsForOwner,
  clearWebSessionReorderIntentsForWorktree,
  resolveWebSessionReorderedOrder
} from './web-session-reorder-intent'
import {
  beginWebRuntimeWakeTerminalRespawn,
  clearAllWebRuntimeWakeTerminalRespawn,
  clearWebRuntimeWakeTerminalRespawnForWorktree,
  endWebRuntimeWakeTerminalRespawn,
  shouldSkipWebRuntimeWakeTerminalRespawn
} from './web-runtime-wake-terminal-respawn'
import { isRuntimeSubscriptionReplayResponse } from '../../../shared/runtime-subscription-replay'
import { queueAcceptedWebSessionTerminalSnapshot } from './web-session-terminal-handle-events'
import { recoverWebSessionTerminalOrphansBeforeApply } from './web-session-terminal-orphan-recovery'
import {
  clearWebAgentSessionHandoff,
  clearWebAgentSessionHandoffsForEnvironment,
  clearWebAgentSessionHandoffsForWorktree,
  isWebAgentSessionHandoffPostCreateSnapshotConfirmed,
  resolveWebAgentSessionHandoff
} from './web-agent-session-handoff'
import { getRuntimeEnvironmentRevision } from './runtime-environment-revision'
import {
  agentStatusEntryEqual,
  browserCertificateFailureEqual,
  browserPageEqual,
  browserWorkspaceEqual,
  findCurrentVisibleUnifiedTabId,
  groupEqual,
  isAgentStatusFresh,
  isMirroredCommandCodeTurnBump,
  openFileEqual,
  pushRecentTabId,
  sanitizeRecentTabIds,
  sameAgentStateHistory,
  sameBrowserPages,
  sameBrowserTabs,
  sameGroups,
  sameOpenFiles,
  sameStringArray,
  sameStringRecord,
  sameTerminalTabs,
  sameUnifiedTabs,
  tabEqual,
  terminalTabEqual,
  terminalLayoutNodeEqual,
  terminalLayoutEqual,
  toVisibleTabType,
  withWorktreeEntry
} from './web-session-tabs-equality'

import { WEB_SESSION_GROUP_PREFIX, latestSessionTabsSnapshotByWorktree, replayableSessionTabsSnapshotByWorktree, lastHostTerminalTabCountByWorktree, hostSessionTabIdByLocalKey, isSessionTabsListAllResult, sessionTabsFreshnessKey, rememberHostTerminalTabCount, getLastKnownHostTerminalTabCount, getLatestWebSessionTabsPublicationEpoch, acceptReplayedWebSessionTabsSnapshot, shouldApplyWebSessionTabsSnapshot, shouldBootstrapInitialWebRuntimeTerminal, shouldRespawnWebRuntimeTerminalAfterWake, shouldSyncRuntimeSessionTabs, shouldSyncAllRuntimeSessionTabs, resetWebSessionTabsSnapshotFreshnessForTests, _getWebSessionTabsTrackingCountsForTest, clearWebSessionTabsTrackingForWorktree, clearWebSessionTabsTrackingForEnvironment, hostSessionTabMappingKey, resolveHostSessionTabIdForWebSessionTab, isReadyTerminalTab, isTerminalSurfaceTab, isReadyBrowserTab, isReadyEditorTab, localEditorFileId, editorSourceFileId, isRuntimeTerminalTabForEnvironment, isMirroredTerminalSurfaceId, chooseRemoteTerminalLayout, shouldReplaceTerminalTab, buildMirroredTerminalTabs, toMirroredPaneKey, remapHostAgentStatus, isMirroredAgentPaneKeyForTabs, buildMirroredAgentStatusPatch, chooseTargetGroupId, collectLayoutGroupIds, buildHostGroupIdByTabId, pruneTabGroupLayout, appendTabGroupLayout, tabGroupLayoutEqual, mapHostRecentTabIds, buildHostToLocalTabIdMap, updateHostSessionTabIdMappings, buildMirroredHostGroups, applyWebSessionTabsSnapshot, applyWebSessionTabsSnapshots, applyFreshWebSessionTabsSnapshot, applyFreshWebSessionTabsSnapshots, applyWebSessionTabsStorePatch, useWebSessionTabsSync, type SessionTabsStreamEvent, type SessionTabsListAllResult, type SnapshotFreshness, type TerminalSurface, type ReadyTerminalSurface, type ReadyBrowserSurface, type ReadyEditorSurface, type MirroredTerminalTab, type MirroredBrowserTab, type MirroredEditorTab, type WebSessionTabsSyncState } from './web-session-tabs-reconciliation'

export function buildTerminalUnifiedTab(
  tab: TerminalTab,
  groupId: string,
  // Why: viewMode is host-tracked but the client's optimistic toggle must win during the echo window; callers pass the reconciled value.
  viewMode?: Tab['viewMode']
): Tab {
  return {
    id: tab.id,
    entityId: tab.id,
    groupId,
    worktreeId: tab.worktreeId,
    contentType: 'terminal',
    label: tab.title,
    ...(tab.quickCommandLabel?.trim() ? { quickCommandLabel: tab.quickCommandLabel.trim() } : {}),
    ...(tab.generatedTitle?.trim() ? { generatedLabel: tab.generatedTitle.trim() } : {}),
    customLabel: tab.customTitle,
    color: tab.color,
    sortOrder: tab.sortOrder,
    createdAt: tab.createdAt,
    isPreview: false,
    isPinned: tab.isPinned === true,
    ...(viewMode ? { viewMode } : {})
  }
}

export function buildBrowserUnifiedTab(
  tab: BrowserWorkspace,
  hostTab: RuntimeMobileSessionBrowserTab,
  existingUnifiedTab: Tab | null,
  groupId: string
): Tab {
  return {
    id: existingUnifiedTab?.id ?? hostTab.id,
    entityId: tab.id,
    groupId,
    worktreeId: tab.worktreeId,
    contentType: 'browser',
    label: tab.title,
    customLabel: null,
    color: hostTab.color !== undefined ? hostTab.color : (existingUnifiedTab?.color ?? null),
    sortOrder: tab.createdAt,
    createdAt: tab.createdAt,
    isPreview: false,
    isPinned:
      hostTab.isPinned !== undefined
        ? hostTab.isPinned === true
        : existingUnifiedTab?.isPinned === true
  }
}

export function buildEditorUnifiedTab(
  file: OpenFile,
  tab: ReadyEditorSurface,
  hostTabId: string,
  existingUnifiedTab: Tab | null,
  label: string,
  groupId: string,
  sortOrder: number,
  createdAt: number
): Tab {
  return {
    id: hostTabId,
    entityId: file.id,
    groupId,
    worktreeId: file.worktreeId,
    contentType: 'editor',
    label,
    customLabel: null,
    color: tab.color !== undefined ? tab.color : (existingUnifiedTab?.color ?? null),
    sortOrder,
    createdAt,
    isPreview: false,
    isPinned:
      tab.isPinned !== undefined ? tab.isPinned === true : existingUnifiedTab?.isPinned === true
  }
}

export function findExistingEditorUnifiedTab(
  state: WebSessionTabsSyncState,
  worktreeId: string,
  fileId: string,
  hostTabId: string
): Tab | null {
  return (
    (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
      (tab) => tab.contentType === 'editor' && (tab.id === hostTabId || tab.entityId === fileId)
    ) ?? null
  )
}

export function buildMirroredEditorTabs(
  snapshot: RuntimeMobileSessionTabsResult,
  environmentId: string,
  state: WebSessionTabsSyncState,
  hostGroupIdByTabId: ReadonlyMap<string, string>,
  fallbackGroupId: string,
  sortOffset: number,
  now: number
): MirroredEditorTab[] {
  return snapshot.tabs.filter(isReadyEditorTab).map((tab, index) => {
    const fileId = localEditorFileId(tab)
    const existingFile = state.openFiles.find(
      (file) => file.worktreeId === snapshot.worktree && file.id === fileId
    )
    const existingUnifiedTab = findExistingEditorUnifiedTab(
      state,
      snapshot.worktree,
      fileId,
      tab.id
    )
    const sourceFileId = editorSourceFileId(tab)
    const groupId = hostGroupIdByTabId.get(tab.id) ?? fallbackGroupId
    const file: OpenFile = {
      ...existingFile,
      id: fileId,
      filePath: tab.filePath,
      relativePath: tab.relativePath,
      worktreeId: snapshot.worktree,
      language: tab.language,
      isDirty: tab.isDirty,
      runtimeEnvironmentId: environmentId,
      mode: tab.type === 'markdown' ? tab.mode : 'edit',
      markdownPreviewSourceFileId: sourceFileId,
      // Why: marks this tab host-owned so a later snapshot that omits it can cull it; locally opened tabs lack this flag and survive.
      mirroredFromRuntimeSession: true
    }
    return {
      file,
      hostTabId: tab.id,
      unifiedTab: buildEditorUnifiedTab(
        file,
        tab,
        tab.id,
        existingUnifiedTab,
        tab.title.trim() || tab.relativePath || 'File',
        groupId,
        sortOffset + index,
        existingUnifiedTab?.createdAt ?? now + sortOffset + index
      )
    }
  })
}

export function findBrowserWorkspaceForRemotePage(
  state: WebSessionTabsSyncState,
  worktreeId: string,
  environmentId: string,
  remotePageId: string
): { workspace: BrowserWorkspace; page: BrowserPage; unifiedTab: Tab | null } | null {
  const workspaces = state.browserTabsByWorktree[worktreeId] ?? []
  for (const workspace of workspaces) {
    const pages = state.browserPagesByWorkspace[workspace.id] ?? []
    for (const page of pages) {
      const handle = state.remoteBrowserPageHandlesByPageId[page.id]
      if (handle?.environmentId === environmentId && handle.remotePageId === remotePageId) {
        return {
          workspace,
          page,
          unifiedTab:
            (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
              (tab) => tab.contentType === 'browser' && tab.entityId === workspace.id
            ) ?? null
        }
      }
    }
  }
  return null
}

export function browserWorkspaceHasRemoteEnvironmentPage(
  state: WebSessionTabsSyncState,
  workspace: BrowserWorkspace,
  environmentId: string
): boolean {
  return (state.browserPagesByWorkspace[workspace.id] ?? []).some(
    (page) => state.remoteBrowserPageHandlesByPageId[page.id]?.environmentId === environmentId
  )
}

export function buildMirroredBrowserTabs(
  snapshot: RuntimeMobileSessionTabsResult,
  environmentId: string,
  state: WebSessionTabsSyncState,
  hostGroupIdByTabId: ReadonlyMap<string, string>,
  fallbackGroupId: string,
  sortOffset: number,
  now: number
): MirroredBrowserTab[] {
  return snapshot.tabs.filter(isReadyBrowserTab).map((tab, index) => {
    const existing = findBrowserWorkspaceForRemotePage(
      state,
      snapshot.worktree,
      environmentId,
      tab.browserPageId
    )
    const workspaceId = existing?.workspace.id ?? tab.browserWorkspaceId
    const pageId = existing?.page.id ?? tab.browserPageId
    const createdAt = existing?.page.createdAt ?? now + sortOffset + index
    const groupId = hostGroupIdByTabId.get(tab.id) ?? fallbackGroupId
    const title = tab.title.trim() || 'Browser'
    const page: BrowserPage = {
      id: pageId,
      workspaceId,
      worktreeId: snapshot.worktree,
      url: tab.url,
      title,
      loading: tab.loading,
      faviconUrl: existing?.page.faviconUrl ?? null,
      canGoBack: tab.canGoBack,
      canGoForward: tab.canGoForward,
      loadError: tab.loadError ?? null,
      createdAt,
      browserRuntimeEnvironmentId: environmentId,
      viewportPresetId: existing?.page.viewportPresetId ?? null
    }
    const workspace: BrowserWorkspace = {
      id: workspaceId,
      worktreeId: snapshot.worktree,
      label: existing?.workspace.label,
      sessionProfileId: existing?.workspace.sessionProfileId ?? null,
      activePageId: page.id,
      pageIds: [page.id],
      url: page.url,
      title: page.title,
      loading: page.loading,
      faviconUrl: page.faviconUrl,
      canGoBack: page.canGoBack,
      canGoForward: page.canGoForward,
      loadError: page.loadError,
      createdAt
    }
    return {
      workspace,
      page,
      certificateFailure: tab.certificateFailure ?? null,
      remotePageId: tab.browserPageId,
      unifiedTab: buildBrowserUnifiedTab(workspace, tab, existing?.unifiedTab ?? null, groupId),
      hostTabId: tab.id
    }
  })
}

