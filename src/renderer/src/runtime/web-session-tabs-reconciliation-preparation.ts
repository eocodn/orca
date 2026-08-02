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

import { WEB_SESSION_GROUP_PREFIX, latestSessionTabsSnapshotByWorktree, replayableSessionTabsSnapshotByWorktree, lastHostTerminalTabCountByWorktree, hostSessionTabIdByLocalKey, isSessionTabsListAllResult, sessionTabsFreshnessKey, rememberHostTerminalTabCount, getLastKnownHostTerminalTabCount, getLatestWebSessionTabsPublicationEpoch, acceptReplayedWebSessionTabsSnapshot, shouldApplyWebSessionTabsSnapshot, shouldBootstrapInitialWebRuntimeTerminal, shouldRespawnWebRuntimeTerminalAfterWake, shouldSyncRuntimeSessionTabs, shouldSyncAllRuntimeSessionTabs, resetWebSessionTabsSnapshotFreshnessForTests, _getWebSessionTabsTrackingCountsForTest, clearWebSessionTabsTrackingForWorktree, clearWebSessionTabsTrackingForEnvironment, hostSessionTabMappingKey, resolveHostSessionTabIdForWebSessionTab, isReadyTerminalTab, isTerminalSurfaceTab, isReadyBrowserTab, isReadyEditorTab, localEditorFileId, editorSourceFileId, isRuntimeTerminalTabForEnvironment, isMirroredTerminalSurfaceId, chooseRemoteTerminalLayout, shouldReplaceTerminalTab, buildMirroredTerminalTabs, toMirroredPaneKey, remapHostAgentStatus, isMirroredAgentPaneKeyForTabs, buildMirroredAgentStatusPatch, buildTerminalUnifiedTab, buildBrowserUnifiedTab, buildEditorUnifiedTab, findExistingEditorUnifiedTab, buildMirroredEditorTabs, findBrowserWorkspaceForRemotePage, browserWorkspaceHasRemoteEnvironmentPage, buildMirroredBrowserTabs, chooseTargetGroupId, collectLayoutGroupIds, buildHostGroupIdByTabId, pruneTabGroupLayout, appendTabGroupLayout, tabGroupLayoutEqual, mapHostRecentTabIds, buildHostToLocalTabIdMap, updateHostSessionTabIdMappings, buildMirroredHostGroups, applyWebSessionTabsSnapshot, applyWebSessionTabsSnapshots, applyFreshWebSessionTabsSnapshot, applyFreshWebSessionTabsSnapshots, applyWebSessionTabsStorePatch, useWebSessionTabsSync, type SessionTabsStreamEvent, type SessionTabsListAllResult, type SnapshotFreshness, type TerminalSurface, type ReadyTerminalSurface, type ReadyBrowserSurface, type ReadyEditorSurface, type MirroredTerminalTab, type MirroredBrowserTab, type MirroredEditorTab, type WebSessionTabsSyncState } from './web-session-tabs-reconciliation'

export function prepareWebSessionTabsReconciliation(
  state: WebSessionTabsSyncState,
  rawSnapshot: RuntimeMobileSessionTabsResult,
  environmentId: string,
  now = Date.now()
) {
  const worktreeId = rawSnapshot.worktree
  if (worktreeId === FLOATING_TERMINAL_WORKTREE_ID) {
    return null
  }
  // Why: an in-flight pre-close snapshot can flash a closing tab back, so drop tabs the client is closing until the host confirms removal.
  // Why: key close intents by host session tab id (terminal parentTabId else tab.id), not browserPageId, or browser closes never get suppressed.
  const snapshotHostTabId = (tab: RuntimeMobileSessionTabsResult['tabs'][number]): string =>
    tab.type === 'terminal' ? tab.parentTabId : tab.id
  reconcileWebSessionCloseIntents(
    { environmentId },
    worktreeId,
    new Set(rawSnapshot.tabs.map((tab) => snapshotHostTabId(tab)))
  )
  const snapshot: RuntimeMobileSessionTabsResult = rawSnapshot.tabs.some((tab) =>
    isWebSessionCloseIntentPending({ environmentId }, worktreeId, snapshotHostTabId(tab), now)
  )
    ? {
        ...rawSnapshot,
        tabs: rawSnapshot.tabs.filter(
          (tab) =>
            !isWebSessionCloseIntentPending(
              { environmentId },
              worktreeId,
              snapshotHostTabId(tab),
              now
            )
        )
      }
    : rawSnapshot
  // Why: only a caller-recorded create intent may focus its arriving tab; unsolicited server-active must not steal focus (#5435).
  const focusIntent = peekWebSessionFocusIntent({ environmentId }, worktreeId)
  const focusIntentHostTabId = focusIntent?.hostTabId ?? null
  const callerFocusIntentTab =
    focusIntentHostTabId === null
      ? null
      : focusIntent?.leafId
        ? (snapshot.tabs.find(
            (tab) =>
              tab.type === 'terminal' &&
              tab.leafId === focusIntent.leafId &&
              (tab.id === focusIntentHostTabId || tab.parentTabId === focusIntentHostTabId)
          ) ?? null)
        : (snapshot.tabs.find(
            (tab) =>
              tab.id === focusIntentHostTabId ||
              (tab.type === 'terminal' && tab.parentTabId === focusIntentHostTabId) ||
              (tab.type === 'browser' && tab.browserPageId === focusIntentHostTabId)
          ) ?? null)
  const followIntentTab =
    snapshot.navigationIntent === 'follow'
      ? (snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId) ?? null)
      : null
  const navigationIntentTab = callerFocusIntentTab ?? followIntentTab
  const honorSnapshotActiveFocus = navigationIntentTab !== null
  if (callerFocusIntentTab) {
    clearWebSessionFocusIntent({ environmentId }, worktreeId)
  }
  const currentTerminalTabs = state.tabsByWorktree[worktreeId] ?? []
  const existingTerminalById = new Map(currentTerminalTabs.map((tab) => [tab.id, tab]))
  const terminalSurfaceTabs = snapshot.tabs.filter(isTerminalSurfaceTab)
  const readyTerminalTabs = terminalSurfaceTabs.filter(isReadyTerminalTab)
  const nextRemotePtyIds = new Set(
    readyTerminalTabs.map((tab) => toRemoteRuntimePtyId(tab.terminal, environmentId))
  )
  const nextMirroredTerminalIds = new Set(
    terminalSurfaceTabs.map((tab) => toWebTerminalSurfaceTabId(tab.parentTabId))
  )
  const nextHostTerminalTabIds = new Set(terminalSurfaceTabs.map((tab) => tab.parentTabId))
  const exactProvisionalHandoffs = new Set(
    currentTerminalTabs
      .filter((tab) => !isMirroredTerminalSurfaceId(tab.id))
      .filter((tab) => {
        if (nextHostTerminalTabIds.has(tab.id)) {
          return true
        }
        const handoff = {
          environmentId,
          worktreeId,
          provisionalTabId: tab.id
        }
        const hostTabId = resolveWebAgentSessionHandoff(handoff)
        return (
          hostTabId !== null &&
          (nextHostTerminalTabIds.has(hostTabId) ||
            isWebAgentSessionHandoffPostCreateSnapshotConfirmed(handoff))
        )
      })
      .map((tab) => tab.id)
  )
  const retainedTerminalTabs = currentTerminalTabs.filter(
    (tab) =>
      !shouldReplaceTerminalTab(
        tab,
        environmentId,
        nextRemotePtyIds,
        nextMirroredTerminalIds,
        exactProvisionalHandoffs
      )
  )
  const mirroredTerminalTabs = buildMirroredTerminalTabs(
    snapshot,
    environmentId,
    existingTerminalById,
    state.terminalLayoutsByTabId,
    retainedTerminalTabs.length,
    now,
    callerFocusIntentTab?.type === 'terminal'
      ? {
          parentTabId: callerFocusIntentTab.parentTabId,
          leafId: callerFocusIntentTab.leafId
        }
      : undefined
  )
  const mirroredTerminalTabEntries = mirroredTerminalTabs.map((entry) => entry.tab)
  const retainedTerminalIds = new Set(retainedTerminalTabs.map((tab) => tab.id))
  const nextTerminalTabs =
    retainedTerminalTabs.length + mirroredTerminalTabEntries.length > 0
      ? [...retainedTerminalTabs, ...mirroredTerminalTabEntries]
      : null
  const mirroredTerminalIds = new Set(mirroredTerminalTabEntries.map((tab) => tab.id))
  const removedTerminalIds = new Set(
    currentTerminalTabs.filter((tab) => !retainedTerminalIds.has(tab.id)).map((tab) => tab.id)
  )
  for (const provisionalTabId of exactProvisionalHandoffs) {
    clearWebAgentSessionHandoff({ environmentId, worktreeId, provisionalTabId })
  }

  const targetGroupId = chooseTargetGroupId(state, snapshot)
  const hostGroupIdByTabId = buildHostGroupIdByTabId(snapshot.tabGroups)
  const readyBrowserTabs = snapshot.tabs.filter(isReadyBrowserTab)
  const nextRemoteBrowserPageIds = new Set(readyBrowserTabs.map((tab) => tab.browserPageId))
  const mirroredBrowserTabs = buildMirroredBrowserTabs(
    snapshot,
    environmentId,
    state,
    hostGroupIdByTabId,
    targetGroupId,
    mirroredTerminalTabEntries.length,
    now
  )
  const mirroredBrowserWorkspaceIds = new Set(
    mirroredBrowserTabs.map((entry) => entry.workspace.id)
  )
  const currentBrowserTabs = state.browserTabsByWorktree[worktreeId] ?? []
  const removedBrowserWorkspaceIds = new Set(
    currentBrowserTabs
      .filter((tab) => {
        if (mirroredBrowserWorkspaceIds.has(tab.id)) {
          return true
        }
        if (!browserWorkspaceHasRemoteEnvironmentPage(state, tab, environmentId)) {
          return false
        }
        return !(state.browserPagesByWorkspace[tab.id] ?? []).some((page) => {
          const handle = state.remoteBrowserPageHandlesByPageId[page.id]
          return (
            handle?.environmentId === environmentId &&
            nextRemoteBrowserPageIds.has(handle.remotePageId)
          )
        })
      })
      .map((tab) => tab.id)
  )
  const retainedBrowserTabs = currentBrowserTabs.filter(
    (tab) => !removedBrowserWorkspaceIds.has(tab.id)
  )
  const nextBrowserTabs =
    retainedBrowserTabs.length + mirroredBrowserTabs.length > 0
      ? [...retainedBrowserTabs, ...mirroredBrowserTabs.map((entry) => entry.workspace)]
      : null
  const readyEditorTabs = snapshot.tabs.filter(isReadyEditorTab)
  const mirroredEditorTabs = buildMirroredEditorTabs(
    snapshot,
    environmentId,
    state,
    hostGroupIdByTabId,
    targetGroupId,
    mirroredTerminalTabEntries.length + mirroredBrowserTabs.length,
    now
  )
  const mirroredEditorFileIds = new Set(mirroredEditorTabs.map((entry) => entry.file.id))
  const mirroredEditorHostTabIds = new Set(mirroredEditorTabs.map((entry) => entry.hostTabId))
  const removedEditorFileIds = new Set(
    state.openFiles
      .filter(
        (file) =>
          file.worktreeId === worktreeId &&
          file.runtimeEnvironmentId === environmentId &&
          (file.mode === 'edit' || file.mode === 'markdown-preview') &&
          // Why: only cull host-mirrored tabs; locally opened files have no host counterpart, so their omission isn't a close signal.
          file.mirroredFromRuntimeSession === true &&
          !mirroredEditorFileIds.has(file.id)
      )
      .map((file) => file.id)
  )
  const nextOpenFiles = (() => {
    const retained = state.openFiles.filter(
      (file) =>
        !(
          file.worktreeId === worktreeId &&
          file.runtimeEnvironmentId === environmentId &&
          (removedEditorFileIds.has(file.id) || mirroredEditorFileIds.has(file.id))
        )
    )
    const next = [...retained, ...mirroredEditorTabs.map((entry) => entry.file)]
    return sameOpenFiles(state.openFiles, next) ? state.openFiles : next
  })()
  const currentUnifiedTabs = state.unifiedTabsByWorktree[worktreeId] ?? []
  const retainedUnifiedTabs = currentUnifiedTabs.filter((tab) => {
    if (tab.contentType === 'browser') {
      return (
        !removedBrowserWorkspaceIds.has(tab.entityId) &&
        !mirroredBrowserWorkspaceIds.has(tab.entityId)
      )
    }
    if (tab.contentType === 'editor') {
      return (
        !removedEditorFileIds.has(tab.entityId) &&
        !mirroredEditorFileIds.has(tab.entityId) &&
        !mirroredEditorHostTabIds.has(tab.id)
      )
    }
    if (tab.contentType !== 'terminal') {
      return true
    }
    if (removedTerminalIds.has(tab.entityId) || removedTerminalIds.has(tab.id)) {
      return false
    }
    return !mirroredTerminalIds.has(tab.entityId) && !mirroredTerminalIds.has(tab.id)
  })
  const existingViewModeByTabId = new Map(
    currentUnifiedTabs
      .filter((tab) => tab.contentType === 'terminal' && tab.viewMode)
      .map((tab) => [tab.id, tab.viewMode] as const)
  )
  const mirroredTerminalUnifiedTabs = mirroredTerminalTabs.map((entry) =>
    buildTerminalUnifiedTab(
      entry.tab,
      hostGroupIdByTabId.get(entry.hostTabId) ?? targetGroupId,
      entry.tab.viewMode ?? existingViewModeByTabId.get(entry.tab.id)
    )
  )
  const mirroredBrowserUnifiedTabs = mirroredBrowserTabs.map((entry) => entry.unifiedTab)
  const mirroredEditorUnifiedTabs = mirroredEditorTabs.map((entry) => entry.unifiedTab)
  const mirroredUnifiedTabs = [
    ...mirroredTerminalUnifiedTabs,
    ...mirroredBrowserUnifiedTabs,
    ...mirroredEditorUnifiedTabs
  ]
  const nextUnifiedTabs =
    retainedUnifiedTabs.length + mirroredUnifiedTabs.length > 0
      ? [...retainedUnifiedTabs, ...mirroredUnifiedTabs]
      : null
  const validUnifiedTabIds = new Set(nextUnifiedTabs?.map((tab) => tab.id) ?? [])
  const activeHostTerminalId =
    terminalSurfaceTabs.find((tab) => tab.id === snapshot.activeTabId)?.id ??
    terminalSurfaceTabs.find((tab) => tab.isActive)?.id ??
    null
  const activeHostTerminalParentId =
    terminalSurfaceTabs.find((tab) => tab.id === activeHostTerminalId)?.parentTabId ??
    terminalSurfaceTabs.find((tab) => tab.isActive)?.parentTabId ??
    null
  const activeMirroredTerminalId = activeHostTerminalId
    ? toWebTerminalSurfaceTabId(activeHostTerminalParentId ?? activeHostTerminalId)
    : null
  const activeHostBrowser =
    readyBrowserTabs.find((tab) => tab.id === snapshot.activeTabId) ??
    readyBrowserTabs.find((tab) => tab.isActive) ??
    null
  const activeMirroredBrowser = activeHostBrowser
    ? (mirroredBrowserTabs.find(
        (entry) => entry.remotePageId === activeHostBrowser.browserPageId
      ) ?? null)
    : null
  const activeMirroredBrowserTabId = activeMirroredBrowser?.unifiedTab.id ?? null
  const activeMirroredBrowserWorkspaceId = activeMirroredBrowser?.workspace.id ?? null
  const activeHostEditor =
    readyEditorTabs.find((tab) => tab.id === snapshot.activeTabId) ??
    readyEditorTabs.find((tab) => tab.isActive) ??
    null
  const activeMirroredEditor = activeHostEditor
    ? (mirroredEditorTabs.find((entry) => entry.hostTabId === activeHostEditor.id) ?? null)
    : null
  const activeMirroredEditorFileId = activeMirroredEditor?.file.id ?? null
  const activeMirroredEditorTabId = activeMirroredEditor?.unifiedTab.id ?? null
  const intentMirroredTerminalId =
    navigationIntentTab?.type === 'terminal'
      ? toWebTerminalSurfaceTabId(navigationIntentTab.parentTabId)
      : null
  const intentMirroredBrowser =
    navigationIntentTab?.type === 'browser'
      ? (mirroredBrowserTabs.find(
          (entry) =>
            entry.hostTabId === navigationIntentTab.id ||
            entry.remotePageId === navigationIntentTab.browserPageId
        ) ?? null)
      : null
  const intentMirroredEditor =
    navigationIntentTab?.type === 'markdown' || navigationIntentTab?.type === 'file'
      ? (mirroredEditorTabs.find((entry) => entry.hostTabId === navigationIntentTab.id) ?? null)
      : null
  const currentActiveTerminalStillExists =
    state.activeTabIdByWorktree[worktreeId] &&
    (nextTerminalTabs ?? []).some((tab) => tab.id === state.activeTabIdByWorktree[worktreeId])
      ? state.activeTabIdByWorktree[worktreeId]
      : null
  // Why: caller intent targets the requested tab even when an older host leaves its own active tab unchanged.
  const intentTerminalId =
    honorSnapshotActiveFocus && navigationIntentTab?.type === 'terminal'
      ? intentMirroredTerminalId
      : null
  const nextActiveTerminalId =
    intentTerminalId ??
    currentActiveTerminalStillExists ??
    (snapshot.activeTabType === 'terminal'
      ? (activeMirroredTerminalId ?? mirroredTerminalTabEntries[0]?.id)
      : mirroredTerminalTabEntries[0]?.id) ??
    null
  const currentActiveBrowserStillExists =
    state.activeBrowserTabIdByWorktree[worktreeId] &&
    (nextBrowserTabs ?? []).some((tab) => tab.id === state.activeBrowserTabIdByWorktree[worktreeId])
      ? state.activeBrowserTabIdByWorktree[worktreeId]
      : null
  const intentBrowserWorkspaceId =
    honorSnapshotActiveFocus && navigationIntentTab?.type === 'browser'
      ? (intentMirroredBrowser?.workspace.id ?? null)
      : null
  const nextActiveBrowserWorkspaceId =
    intentBrowserWorkspaceId ??
    currentActiveBrowserStillExists ??
    (snapshot.activeTabType === 'browser'
      ? (activeMirroredBrowserWorkspaceId ?? mirroredBrowserTabs[0]?.workspace.id)
      : mirroredBrowserTabs[0]?.workspace.id) ??
    null
  const currentActiveEditorStillExists =
    state.activeFileIdByWorktree[worktreeId] &&
    nextOpenFiles.some(
      (file) =>
        file.worktreeId === worktreeId && file.id === state.activeFileIdByWorktree[worktreeId]
    )
      ? state.activeFileIdByWorktree[worktreeId]
      : null
  const intentEditorFileId = honorSnapshotActiveFocus
    ? (intentMirroredEditor?.file.id ?? null)
    : null
  const nextActiveEditorFileId =
    intentEditorFileId ??
    currentActiveEditorStillExists ??
    (snapshot.activeTabType === 'markdown' || snapshot.activeTabType === 'file'
      ? (activeMirroredEditorFileId ?? mirroredEditorTabs[0]?.file.id)
      : mirroredEditorTabs[0]?.file.id) ??
    null
  const currentVisibleUnifiedTabId = findCurrentVisibleUnifiedTabId({
    state,
    worktreeId,
    nextUnifiedTabs
  })
  // Why: a client-initiated activation also drives the visible unified tab, overriding the sticky current-visible tab.
  const intentUnifiedTabId = honorSnapshotActiveFocus
    ? navigationIntentTab?.type === 'browser'
      ? (intentMirroredBrowser?.unifiedTab.id ?? null)
      : navigationIntentTab?.type === 'terminal'
        ? intentTerminalId
        : navigationIntentTab?.type === 'markdown' || navigationIntentTab?.type === 'file'
          ? (intentMirroredEditor?.unifiedTab.id ?? null)
          : null
    : null
  const nextActiveUnifiedTabId =
    intentUnifiedTabId ??
    currentVisibleUnifiedTabId ??
    (snapshot.activeTabType === 'browser'
      ? (activeMirroredBrowserTabId ??
        mirroredBrowserTabs[0]?.unifiedTab.id ??
        state.activeTabIdByWorktree[worktreeId] ??
        nextActiveTerminalId)
      : snapshot.activeTabType === 'markdown' || snapshot.activeTabType === 'file'
        ? (activeMirroredEditorTabId ??
          mirroredEditorTabs[0]?.unifiedTab.id ??
          state.activeTabIdByWorktree[worktreeId] ??
          nextActiveTerminalId)
        : nextActiveTerminalId)
  const mirroredUnifiedIds = new Set(mirroredUnifiedTabs.map((tab) => tab.id))
  const hostToLocalTabId = buildHostToLocalTabIdMap({
    terminalSurfaces: terminalSurfaceTabs,
    terminalTabs: mirroredTerminalTabEntries,
    browserTabs: mirroredBrowserTabs,
    editorTabs: mirroredEditorTabs
  })
  updateHostSessionTabIdMappings({
    environmentId,
    worktreeId,
    terminalSurfaces: terminalSurfaceTabs,
    terminalTabs: mirroredTerminalTabEntries,
    browserTabs: mirroredBrowserTabs,
    editorTabs: mirroredEditorTabs
  })
  return {
    worktreeId,
    snapshot,
    focusIntent,
    focusIntentHostTabId,
    callerFocusIntentTab,
    followIntentTab,
    navigationIntentTab,
    honorSnapshotActiveFocus,
    currentTerminalTabs,
    existingTerminalById,
    terminalSurfaceTabs,
    readyTerminalTabs,
    nextRemotePtyIds,
    nextMirroredTerminalIds,
    nextHostTerminalTabIds,
    exactProvisionalHandoffs,
    retainedTerminalTabs,
    mirroredTerminalTabs,
    mirroredTerminalTabEntries,
    retainedTerminalIds,
    nextTerminalTabs,
    mirroredTerminalIds,
    removedTerminalIds,
    targetGroupId,
    hostGroupIdByTabId,
    readyBrowserTabs,
    nextRemoteBrowserPageIds,
    mirroredBrowserTabs,
    mirroredBrowserWorkspaceIds,
    currentBrowserTabs,
    removedBrowserWorkspaceIds,
    retainedBrowserTabs,
    nextBrowserTabs,
    readyEditorTabs,
    mirroredEditorTabs,
    mirroredEditorFileIds,
    mirroredEditorHostTabIds,
    removedEditorFileIds,
    nextOpenFiles,
    currentUnifiedTabs,
    retainedUnifiedTabs,
    existingViewModeByTabId,
    mirroredTerminalUnifiedTabs,
    mirroredBrowserUnifiedTabs,
    mirroredEditorUnifiedTabs,
    mirroredUnifiedTabs,
    nextUnifiedTabs,
    validUnifiedTabIds,
    activeHostTerminalId,
    activeHostTerminalParentId,
    activeMirroredTerminalId,
    activeHostBrowser,
    activeMirroredBrowser,
    activeMirroredBrowserTabId,
    activeMirroredBrowserWorkspaceId,
    activeHostEditor,
    activeMirroredEditor,
    activeMirroredEditorFileId,
    activeMirroredEditorTabId,
    intentMirroredTerminalId,
    intentMirroredBrowser,
    intentMirroredEditor,
    currentActiveTerminalStillExists,
    intentTerminalId,
    nextActiveTerminalId,
    currentActiveBrowserStillExists,
    intentBrowserWorkspaceId,
    nextActiveBrowserWorkspaceId,
    currentActiveEditorStillExists,
    intentEditorFileId,
    nextActiveEditorFileId,
    currentVisibleUnifiedTabId,
    intentUnifiedTabId,
    nextActiveUnifiedTabId,
    mirroredUnifiedIds,
    hostToLocalTabId
  }
}
