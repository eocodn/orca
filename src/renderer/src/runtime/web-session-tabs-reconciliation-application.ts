import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusEntry
} from '../../../shared/agent-status-types'
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
import type { WebSessionTabsSyncState } from './web-session-tabs-reconciliation'
import type { RuntimeMobileSessionTabsResult } from '../../../shared/runtime-types'
import { prepareWebSessionTabsReconciliation as prepareSnapshot } from './web-session-tabs-reconciliation-preparation'

export function applyPreparedWebSessionTabsSnapshot(
  state: WebSessionTabsSyncState,
  rawSnapshot: RuntimeMobileSessionTabsResult,
  environmentId: string,
  now = Date.now()
): WebSessionTabsSyncState | Partial<WebSessionTabsSyncState> {
  const prepared = prepareSnapshot(state, rawSnapshot, environmentId, now)
  if (!prepared) {
    return state
  }
  const {
    worktreeId, snapshot, focusIntent, focusIntentHostTabId, callerFocusIntentTab,
    followIntentTab, navigationIntentTab, honorSnapshotActiveFocus, currentTerminalTabs,
    existingTerminalById, terminalSurfaceTabs, readyTerminalTabs, nextRemotePtyIds,
    nextMirroredTerminalIds, nextHostTerminalTabIds, exactProvisionalHandoffs,
    retainedTerminalTabs, mirroredTerminalTabs, mirroredTerminalTabEntries, retainedTerminalIds,
    nextTerminalTabs, mirroredTerminalIds, removedTerminalIds, targetGroupId, hostGroupIdByTabId,
    readyBrowserTabs, nextRemoteBrowserPageIds, mirroredBrowserTabs, mirroredBrowserWorkspaceIds,
    currentBrowserTabs, removedBrowserWorkspaceIds, retainedBrowserTabs, nextBrowserTabs,
    readyEditorTabs, mirroredEditorTabs, mirroredEditorFileIds, mirroredEditorHostTabIds,
    removedEditorFileIds, nextOpenFiles, currentUnifiedTabs, retainedUnifiedTabs,
    existingViewModeByTabId, mirroredTerminalUnifiedTabs, mirroredBrowserUnifiedTabs,
    mirroredEditorUnifiedTabs, mirroredUnifiedTabs, nextUnifiedTabs, validUnifiedTabIds,
    activeHostTerminalId, activeHostTerminalParentId, activeMirroredTerminalId, activeHostBrowser,
    activeMirroredBrowser, activeMirroredBrowserTabId, activeMirroredBrowserWorkspaceId,
    activeHostEditor, activeMirroredEditor, activeMirroredEditorFileId, activeMirroredEditorTabId,
    intentMirroredTerminalId, intentMirroredBrowser, intentMirroredEditor,
    currentActiveTerminalStillExists, intentTerminalId, nextActiveTerminalId,
    currentActiveBrowserStillExists, intentBrowserWorkspaceId, nextActiveBrowserWorkspaceId,
    currentActiveEditorStillExists, intentEditorFileId, nextActiveEditorFileId,
    currentVisibleUnifiedTabId, intentUnifiedTabId, nextActiveUnifiedTabId, mirroredUnifiedIds,
    hostToLocalTabId
  } = prepared
  const currentGroups = state.groupsByWorktree[worktreeId] ?? []
  const nextGroups = (() => {
    if (!nextUnifiedTabs || nextUnifiedTabs.length === 0) {
      return null
    }
    if (snapshot.tabGroups && snapshot.tabGroups.length > 0) {
      return buildMirroredHostGroups({
        currentGroups,
        hostGroups: snapshot.tabGroups,
        hostToLocalTabId,
        mirroredUnifiedIds,
        nextActiveUnifiedTabId,
        now,
        validUnifiedTabIds,
        environmentId,
        worktreeId
      })
    }
    const strippedGroups = currentGroups.map((group) => ({
      ...group,
      tabOrder: group.tabOrder.filter(
        (tabId) => validUnifiedTabIds.has(tabId) && !mirroredUnifiedIds.has(tabId)
      ),
      recentTabIds: sanitizeRecentTabIds(
        group.recentTabIds,
        group.tabOrder.filter(
          (tabId) => validUnifiedTabIds.has(tabId) && !mirroredUnifiedIds.has(tabId)
        )
      )
    }))
    const target = strippedGroups.find((group) => group.id === targetGroupId) ?? {
      id: targetGroupId,
      worktreeId,
      activeTabId: null,
      tabOrder: [],
      recentTabIds: []
    }
    const targetOrder = [
      ...target.tabOrder.filter((tabId) => validUnifiedTabIds.has(tabId)),
      ...mirroredUnifiedTabs.map((tab) => tab.id)
    ]
    const targetActiveTabId =
      nextActiveUnifiedTabId && targetOrder.includes(nextActiveUnifiedTabId)
        ? nextActiveUnifiedTabId
        : target.activeTabId && targetOrder.includes(target.activeTabId)
          ? target.activeTabId
          : (targetOrder[0] ?? null)
    const updatedTarget: TabGroup = {
      ...target,
      worktreeId,
      tabOrder: targetOrder,
      activeTabId: targetActiveTabId,
      recentTabIds: targetActiveTabId
        ? pushRecentTabId(sanitizeRecentTabIds(target.recentTabIds, targetOrder), targetActiveTabId)
        : []
    }
    const merged = strippedGroups.some((group) => group.id === targetGroupId)
      ? strippedGroups.map((group) => (group.id === targetGroupId ? updatedTarget : group))
      : [...strippedGroups, updatedTarget]
    return merged.filter((group) => group.id === targetGroupId || group.tabOrder.length > 0)
  })()

  const nextTabBarOrder = (() => {
    const current = state.tabBarOrderByWorktree[worktreeId] ?? []
    const validTabBarIds = new Set([
      ...retainedUnifiedTabs.map((tab) => tab.id),
      ...mirroredUnifiedTabs.map((tab) => tab.id)
    ])
    const hostTabBarOrder =
      snapshot.tabGroups?.flatMap((group) =>
        group.tabOrder
          .map((tabId) => hostToLocalTabId.get(tabId))
          .filter((tabId): tabId is string => tabId !== undefined && validTabBarIds.has(tabId))
      ) ?? []
    const next: string[] = []
    const push = (tabId: string): void => {
      if (validTabBarIds.has(tabId) && !next.includes(tabId)) {
        next.push(tabId)
      }
    }
    // Why: snapshots can arrive after the client staged local browser tabs, so preserve visible order and only append new host tabs.
    for (const tabId of current) {
      push(tabId)
    }
    const hostOrMirroredOrder =
      hostTabBarOrder.length > 0 ? hostTabBarOrder : mirroredUnifiedTabs.map((tab) => tab.id)
    for (const tabId of hostOrMirroredOrder) {
      push(tabId)
    }
    return next
  })()

  let nextPtyIdsByTabId = state.ptyIdsByTabId
  for (const removedId of removedTerminalIds) {
    if (nextPtyIdsByTabId[removedId]) {
      nextPtyIdsByTabId =
        nextPtyIdsByTabId === state.ptyIdsByTabId ? { ...state.ptyIdsByTabId } : nextPtyIdsByTabId
      delete nextPtyIdsByTabId[removedId]
    }
  }
  for (const { tab, ptyIds } of mirroredTerminalTabs) {
    const current = nextPtyIdsByTabId[tab.id] ?? []
    if (!sameStringArray(current, ptyIds)) {
      nextPtyIdsByTabId =
        nextPtyIdsByTabId === state.ptyIdsByTabId ? { ...state.ptyIdsByTabId } : nextPtyIdsByTabId
      nextPtyIdsByTabId[tab.id] = ptyIds
    }
  }

  let nextTerminalLayoutsByTabId = state.terminalLayoutsByTabId
  for (const removedId of removedTerminalIds) {
    if (nextTerminalLayoutsByTabId[removedId]) {
      nextTerminalLayoutsByTabId =
        nextTerminalLayoutsByTabId === state.terminalLayoutsByTabId
          ? { ...state.terminalLayoutsByTabId }
          : nextTerminalLayoutsByTabId
      delete nextTerminalLayoutsByTabId[removedId]
    }
  }
  for (const { tab, layout } of mirroredTerminalTabs) {
    if (!terminalLayoutEqual(nextTerminalLayoutsByTabId[tab.id], layout)) {
      nextTerminalLayoutsByTabId =
        nextTerminalLayoutsByTabId === state.terminalLayoutsByTabId
          ? { ...state.terminalLayoutsByTabId }
          : nextTerminalLayoutsByTabId
      nextTerminalLayoutsByTabId[tab.id] = layout
    }
  }

  let nextUnreadTerminalTabs = state.unreadTerminalTabs
  for (const removedId of removedTerminalIds) {
    if (nextUnreadTerminalTabs[removedId]) {
      nextUnreadTerminalTabs =
        nextUnreadTerminalTabs === state.unreadTerminalTabs
          ? { ...state.unreadTerminalTabs }
          : nextUnreadTerminalTabs
      delete nextUnreadTerminalTabs[removedId]
    }
  }

  const pendingStartupByTabId = state.pendingStartupByTabId ?? {}
  let nextPendingStartupByTabId = pendingStartupByTabId
  const automaticAgentResumeClaimsByTabId = state.automaticAgentResumeClaimsByTabId ?? {}
  let nextAutomaticAgentResumeClaimsByTabId = automaticAgentResumeClaimsByTabId
  for (const removedId of exactProvisionalHandoffs) {
    if (nextPendingStartupByTabId[removedId]) {
      nextPendingStartupByTabId =
        nextPendingStartupByTabId === pendingStartupByTabId
          ? { ...pendingStartupByTabId }
          : nextPendingStartupByTabId
      delete nextPendingStartupByTabId[removedId]
    }
    if (nextAutomaticAgentResumeClaimsByTabId[removedId]) {
      nextAutomaticAgentResumeClaimsByTabId =
        nextAutomaticAgentResumeClaimsByTabId === automaticAgentResumeClaimsByTabId
          ? { ...automaticAgentResumeClaimsByTabId }
          : nextAutomaticAgentResumeClaimsByTabId
      delete nextAutomaticAgentResumeClaimsByTabId[removedId]
    }
  }

  let nextBrowserPagesByWorkspace = state.browserPagesByWorkspace
  let nextRemoteBrowserPageHandlesByPageId = state.remoteBrowserPageHandlesByPageId
  let nextBrowserCertificateFailuresByPageId = state.browserCertificateFailuresByPageId
  for (const removedWorkspaceId of removedBrowserWorkspaceIds) {
    const pages = nextBrowserPagesByWorkspace[removedWorkspaceId] ?? []
    if (nextBrowserPagesByWorkspace[removedWorkspaceId]) {
      nextBrowserPagesByWorkspace =
        nextBrowserPagesByWorkspace === state.browserPagesByWorkspace
          ? { ...state.browserPagesByWorkspace }
          : nextBrowserPagesByWorkspace
      delete nextBrowserPagesByWorkspace[removedWorkspaceId]
    }
    for (const page of pages) {
      if (nextBrowserCertificateFailuresByPageId[page.id]) {
        nextBrowserCertificateFailuresByPageId =
          nextBrowserCertificateFailuresByPageId === state.browserCertificateFailuresByPageId
            ? { ...state.browserCertificateFailuresByPageId }
            : nextBrowserCertificateFailuresByPageId
        delete nextBrowserCertificateFailuresByPageId[page.id]
      }
      if (nextRemoteBrowserPageHandlesByPageId[page.id]) {
        nextRemoteBrowserPageHandlesByPageId =
          nextRemoteBrowserPageHandlesByPageId === state.remoteBrowserPageHandlesByPageId
            ? { ...state.remoteBrowserPageHandlesByPageId }
            : nextRemoteBrowserPageHandlesByPageId
        delete nextRemoteBrowserPageHandlesByPageId[page.id]
      }
    }
  }
  for (const { page, certificateFailure, remotePageId } of mirroredBrowserTabs) {
    const current = nextBrowserPagesByWorkspace[page.workspaceId] ?? []
    if (!sameBrowserPages(current, [page])) {
      nextBrowserPagesByWorkspace =
        nextBrowserPagesByWorkspace === state.browserPagesByWorkspace
          ? { ...state.browserPagesByWorkspace }
          : nextBrowserPagesByWorkspace
      nextBrowserPagesByWorkspace[page.workspaceId] = [page]
    }
    const currentHandle = nextRemoteBrowserPageHandlesByPageId[page.id]
    if (
      currentHandle?.environmentId !== environmentId ||
      currentHandle.remotePageId !== remotePageId
    ) {
      nextRemoteBrowserPageHandlesByPageId =
        nextRemoteBrowserPageHandlesByPageId === state.remoteBrowserPageHandlesByPageId
          ? { ...state.remoteBrowserPageHandlesByPageId }
          : nextRemoteBrowserPageHandlesByPageId
      nextRemoteBrowserPageHandlesByPageId[page.id] = {
        environmentId,
        remotePageId
      }
    }
    if (
      !browserCertificateFailureEqual(
        nextBrowserCertificateFailuresByPageId[page.id],
        certificateFailure
      )
    ) {
      nextBrowserCertificateFailuresByPageId =
        nextBrowserCertificateFailuresByPageId === state.browserCertificateFailuresByPageId
          ? { ...state.browserCertificateFailuresByPageId }
          : nextBrowserCertificateFailuresByPageId
      if (certificateFailure) {
        nextBrowserCertificateFailuresByPageId[page.id] = certificateFailure
      } else {
        delete nextBrowserCertificateFailuresByPageId[page.id]
      }
    }
  }

  const nextTabsByWorktree = withWorktreeEntry(
    state.tabsByWorktree,
    worktreeId,
    nextTerminalTabs,
    sameTerminalTabs
  )
  const nextBrowserTabsByWorktree = withWorktreeEntry(
    state.browserTabsByWorktree,
    worktreeId,
    nextBrowserTabs,
    sameBrowserTabs
  )
  const nextUnifiedTabsByWorktree = withWorktreeEntry(
    state.unifiedTabsByWorktree,
    worktreeId,
    nextUnifiedTabs,
    sameUnifiedTabs
  )
  const nextGroupsByWorktree = withWorktreeEntry(
    state.groupsByWorktree,
    worktreeId,
    nextGroups,
    sameGroups
  )
  const nextActiveGroupId =
    // Why: status/title snapshots carry the host's last active tab; a client that already switched panes keeps its local group focus.
    nextGroups?.find((group) => group.activeTabId === nextActiveUnifiedTabId)?.id ??
    nextGroups?.find((group) => group.id === snapshot.activeGroupId)?.id ??
    nextGroups?.[0]?.id ??
    null
  const nextActiveGroupIdByWorktree =
    nextGroups && state.activeGroupIdByWorktree[worktreeId] !== nextActiveGroupId
      ? { ...state.activeGroupIdByWorktree, [worktreeId]: nextActiveGroupId ?? targetGroupId }
      : state.activeGroupIdByWorktree
  const nextLayoutByWorktree = (() => {
    if (!nextGroups) {
      return state.layoutByWorktree
    }
    const validGroupIds = new Set(nextGroups.map((group) => group.id))
    const hostLayout = pruneTabGroupLayout(snapshot.tabGroupLayout, validGroupIds)
    const defaultLeafLayout = { type: 'leaf' as const, groupId: nextActiveGroupId ?? targetGroupId }
    const hostLayoutGroupIds = collectLayoutGroupIds(hostLayout ?? undefined)
    const hostGroupIds = new Set(snapshot.tabGroups?.map((group) => group.id) ?? [])
    const extraGroupIds = new Set(
      nextGroups
        .map((group) => group.id)
        .filter((groupId) =>
          hostLayout
            ? !hostLayoutGroupIds.has(groupId)
            : snapshot.tabGroups && snapshot.tabGroups.length > 0
              ? !hostGroupIds.has(groupId)
              : false
        )
    )
    const localExtraLayout = pruneTabGroupLayout(state.layoutByWorktree[worktreeId], extraGroupIds)
    const hostBaseLayout =
      hostLayout ?? (snapshot.tabGroups && snapshot.tabGroups.length > 0 ? defaultLeafLayout : null)
    const fallbackLayout =
      appendTabGroupLayout(hostBaseLayout, localExtraLayout) ??
      (snapshot.tabGroups && snapshot.tabGroups.length > 0
        ? defaultLeafLayout
        : state.layoutByWorktree[worktreeId]
          ? null
          : defaultLeafLayout)
    if (!fallbackLayout) {
      return state.layoutByWorktree
    }
    if (tabGroupLayoutEqual(state.layoutByWorktree[worktreeId], fallbackLayout)) {
      return state.layoutByWorktree
    }
    return {
      ...state.layoutByWorktree,
      [worktreeId]: fallbackLayout
    }
  })()
  const nextTabBarOrderByWorktree = withWorktreeEntry(
    state.tabBarOrderByWorktree,
    worktreeId,
    nextTabBarOrder.length > 0 ? nextTabBarOrder : null,
    (a, b) => sameStringArray(a ?? [], b ?? [])
  )
  const nextActiveTabIdByWorktree =
    (state.activeTabIdByWorktree[worktreeId] ?? null) !== nextActiveTerminalId
      ? { ...state.activeTabIdByWorktree, [worktreeId]: nextActiveTerminalId }
      : state.activeTabIdByWorktree
  const nextActiveBrowserTabIdByWorktree =
    (state.activeBrowserTabIdByWorktree[worktreeId] ?? null) !== nextActiveBrowserWorkspaceId
      ? { ...state.activeBrowserTabIdByWorktree, [worktreeId]: nextActiveBrowserWorkspaceId }
      : state.activeBrowserTabIdByWorktree
  const nextActiveFileIdByWorktree =
    (state.activeFileIdByWorktree[worktreeId] ?? null) !== nextActiveEditorFileId
      ? { ...state.activeFileIdByWorktree, [worktreeId]: nextActiveEditorFileId }
      : state.activeFileIdByWorktree
  const isActiveWorktree = state.activeWorktreeId === worktreeId
  const focusIntentVisibleTabType =
    navigationIntentTab?.type === 'browser' && intentBrowserWorkspaceId
      ? ('browser' as const)
      : navigationIntentTab?.type === 'terminal' && intentTerminalId
        ? ('terminal' as const)
        : intentEditorFileId
          ? ('editor' as const)
          : null
  const snapshotVisibleTabType =
    snapshot.activeTabType === 'browser' && nextActiveBrowserWorkspaceId
      ? ('browser' as const)
      : snapshot.activeTabType === 'terminal' && nextActiveTerminalId
        ? ('terminal' as const)
        : (snapshot.activeTabType === 'markdown' || snapshot.activeTabType === 'file') &&
            nextActiveEditorFileId
          ? ('editor' as const)
          : null
  const currentVisibleTabType =
    state.activeTabTypeByWorktree[worktreeId] ?? (isActiveWorktree ? state.activeTabType : null)
  const currentVisibleTabTypeStillValid =
    currentVisibleTabType === 'browser' && currentActiveBrowserStillExists
      ? ('browser' as const)
      : currentVisibleTabType === 'editor' && currentActiveEditorStillExists
        ? ('editor' as const)
        : currentVisibleTabType === 'terminal' && currentActiveTerminalStillExists
          ? ('terminal' as const)
          : null
  const activeUnifiedTab =
    nextActiveUnifiedTabId && nextUnifiedTabs
      ? (nextUnifiedTabs.find((tab) => tab.id === nextActiveUnifiedTabId) ?? null)
      : null
  const fallbackVisibleTabType =
    activeUnifiedTab !== null
      ? toVisibleTabType(activeUnifiedTab)
      : nextActiveTerminalId
        ? ('terminal' as const)
        : nextActiveBrowserWorkspaceId
          ? ('browser' as const)
          : nextActiveEditorFileId
            ? ('editor' as const)
            : ('terminal' as const)
  // Why: don't keep pointing shortcuts at a removed browser/editor; a client-initiated activation lets the snapshot's type switch the visible pane.
  const nextVisibleTabType = honorSnapshotActiveFocus
    ? (focusIntentVisibleTabType ??
      currentVisibleTabTypeStillValid ??
      snapshotVisibleTabType ??
      fallbackVisibleTabType)
    : (currentVisibleTabTypeStillValid ?? snapshotVisibleTabType ?? fallbackVisibleTabType)
  const currentActiveTerminalStillValid =
    state.activeTabId && (nextTerminalTabs ?? []).some((tab) => tab.id === state.activeTabId)
      ? state.activeTabId
      : null
  const currentActiveEditorStillValid =
    state.activeFileId &&
    nextOpenFiles.some((file) => file.worktreeId === worktreeId && file.id === state.activeFileId)
      ? state.activeFileId
      : null
  const nextActiveTabId = isActiveWorktree
    ? snapshot.activeTabType === 'terminal'
      ? nextActiveTerminalId
      : (currentActiveTerminalStillValid ?? nextActiveTerminalId)
    : state.activeTabId
  const nextActiveBrowserTabId = isActiveWorktree
    ? nextActiveBrowserWorkspaceId
    : state.activeBrowserTabId
  const nextActiveFileId = isActiveWorktree
    ? snapshot.activeTabType === 'markdown' || snapshot.activeTabType === 'file'
      ? nextActiveEditorFileId
      : (currentActiveEditorStillValid ?? nextActiveEditorFileId)
    : state.activeFileId
  const nextActiveTabType = isActiveWorktree ? nextVisibleTabType : state.activeTabType
  const nextActiveTabTypeByWorktree =
    state.activeTabTypeByWorktree[worktreeId] !== nextVisibleTabType
      ? { ...state.activeTabTypeByWorktree, [worktreeId]: nextVisibleTabType }
      : state.activeTabTypeByWorktree
  const agentStatusPatch = buildMirroredAgentStatusPatch(
    state,
    currentTerminalTabs,
    terminalSurfaceTabs,
    now
  )

  const patch: Partial<WebSessionTabsSyncState> = {
    ...agentStatusPatch,
    ...(nextOpenFiles !== state.openFiles ? { openFiles: nextOpenFiles } : {}),
    ...(nextTabsByWorktree !== state.tabsByWorktree ? { tabsByWorktree: nextTabsByWorktree } : {}),
    ...(nextBrowserTabsByWorktree !== state.browserTabsByWorktree
      ? { browserTabsByWorktree: nextBrowserTabsByWorktree }
      : {}),
    ...(nextUnifiedTabsByWorktree !== state.unifiedTabsByWorktree
      ? { unifiedTabsByWorktree: nextUnifiedTabsByWorktree }
      : {}),
    ...(nextGroupsByWorktree !== state.groupsByWorktree
      ? { groupsByWorktree: nextGroupsByWorktree }
      : {}),
    ...(nextActiveGroupIdByWorktree !== state.activeGroupIdByWorktree
      ? { activeGroupIdByWorktree: nextActiveGroupIdByWorktree }
      : {}),
    ...(nextLayoutByWorktree !== state.layoutByWorktree
      ? { layoutByWorktree: nextLayoutByWorktree }
      : {}),
    ...(nextTabBarOrderByWorktree !== state.tabBarOrderByWorktree
      ? { tabBarOrderByWorktree: nextTabBarOrderByWorktree }
      : {}),
    ...(nextPtyIdsByTabId !== state.ptyIdsByTabId ? { ptyIdsByTabId: nextPtyIdsByTabId } : {}),
    ...(nextTerminalLayoutsByTabId !== state.terminalLayoutsByTabId
      ? { terminalLayoutsByTabId: nextTerminalLayoutsByTabId }
      : {}),
    ...(nextUnreadTerminalTabs !== state.unreadTerminalTabs
      ? { unreadTerminalTabs: nextUnreadTerminalTabs }
      : {}),
    ...(nextPendingStartupByTabId !== pendingStartupByTabId
      ? { pendingStartupByTabId: nextPendingStartupByTabId }
      : {}),
    ...(nextAutomaticAgentResumeClaimsByTabId !== automaticAgentResumeClaimsByTabId
      ? { automaticAgentResumeClaimsByTabId: nextAutomaticAgentResumeClaimsByTabId }
      : {}),
    ...(nextBrowserPagesByWorkspace !== state.browserPagesByWorkspace
      ? { browserPagesByWorkspace: nextBrowserPagesByWorkspace }
      : {}),
    ...(nextRemoteBrowserPageHandlesByPageId !== state.remoteBrowserPageHandlesByPageId
      ? { remoteBrowserPageHandlesByPageId: nextRemoteBrowserPageHandlesByPageId }
      : {}),
    ...(nextBrowserCertificateFailuresByPageId !== state.browserCertificateFailuresByPageId
      ? { browserCertificateFailuresByPageId: nextBrowserCertificateFailuresByPageId }
      : {}),
    ...(nextActiveTabIdByWorktree !== state.activeTabIdByWorktree
      ? { activeTabIdByWorktree: nextActiveTabIdByWorktree }
      : {}),
    ...(nextActiveBrowserTabIdByWorktree !== state.activeBrowserTabIdByWorktree
      ? { activeBrowserTabIdByWorktree: nextActiveBrowserTabIdByWorktree }
      : {}),
    ...(nextActiveFileIdByWorktree !== state.activeFileIdByWorktree
      ? { activeFileIdByWorktree: nextActiveFileIdByWorktree }
      : {}),
    ...(nextActiveTabId !== state.activeTabId ? { activeTabId: nextActiveTabId } : {}),
    ...(nextActiveBrowserTabId !== state.activeBrowserTabId
      ? { activeBrowserTabId: nextActiveBrowserTabId }
      : {}),
    ...(nextActiveFileId !== state.activeFileId ? { activeFileId: nextActiveFileId } : {}),
    ...(nextActiveTabType !== state.activeTabType ? { activeTabType: nextActiveTabType } : {}),
    ...(nextActiveTabTypeByWorktree !== state.activeTabTypeByWorktree
      ? { activeTabTypeByWorktree: nextActiveTabTypeByWorktree }
      : {})
  }

  return Object.keys(patch).length === 0 ? state : patch
}
