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

import { WEB_SESSION_GROUP_PREFIX, latestSessionTabsSnapshotByWorktree, replayableSessionTabsSnapshotByWorktree, lastHostTerminalTabCountByWorktree, hostSessionTabIdByLocalKey, isSessionTabsListAllResult, sessionTabsFreshnessKey, rememberHostTerminalTabCount, getLastKnownHostTerminalTabCount, getLatestWebSessionTabsPublicationEpoch, acceptReplayedWebSessionTabsSnapshot, shouldApplyWebSessionTabsSnapshot, shouldBootstrapInitialWebRuntimeTerminal, shouldRespawnWebRuntimeTerminalAfterWake, shouldSyncRuntimeSessionTabs, shouldSyncAllRuntimeSessionTabs, resetWebSessionTabsSnapshotFreshnessForTests, _getWebSessionTabsTrackingCountsForTest, clearWebSessionTabsTrackingForWorktree, clearWebSessionTabsTrackingForEnvironment, hostSessionTabMappingKey, resolveHostSessionTabIdForWebSessionTab, isReadyTerminalTab, isTerminalSurfaceTab, isReadyBrowserTab, isReadyEditorTab, localEditorFileId, editorSourceFileId, isRuntimeTerminalTabForEnvironment, isMirroredTerminalSurfaceId, chooseRemoteTerminalLayout, shouldReplaceTerminalTab, buildMirroredTerminalTabs, toMirroredPaneKey, remapHostAgentStatus, isMirroredAgentPaneKeyForTabs, buildMirroredAgentStatusPatch, buildTerminalUnifiedTab, buildBrowserUnifiedTab, buildEditorUnifiedTab, findExistingEditorUnifiedTab, buildMirroredEditorTabs, findBrowserWorkspaceForRemotePage, browserWorkspaceHasRemoteEnvironmentPage, buildMirroredBrowserTabs, chooseTargetGroupId, collectLayoutGroupIds, buildHostGroupIdByTabId, pruneTabGroupLayout, appendTabGroupLayout, tabGroupLayoutEqual, mapHostRecentTabIds, buildHostToLocalTabIdMap, updateHostSessionTabIdMappings, buildMirroredHostGroups, applyWebSessionTabsSnapshot, useWebSessionTabsSync, type SessionTabsStreamEvent, type SessionTabsListAllResult, type SnapshotFreshness, type TerminalSurface, type ReadyTerminalSurface, type ReadyBrowserSurface, type ReadyEditorSurface, type MirroredTerminalTab, type MirroredBrowserTab, type MirroredEditorTab, type WebSessionTabsSyncState } from './web-session-tabs-reconciliation'

export function applyWebSessionTabsSnapshots(
  state: WebSessionTabsSyncState,
  snapshots: readonly RuntimeMobileSessionTabsResult[],
  environmentId: string,
  now = Date.now()
): WebSessionTabsSyncState | Partial<WebSessionTabsSyncState> {
  let nextState = state
  let mergedPatch: Partial<WebSessionTabsSyncState> = {}
  for (const snapshot of snapshots) {
    const patch = applyWebSessionTabsSnapshot(nextState, snapshot, environmentId, now)
    if (patch === nextState) {
      continue
    }
    mergedPatch = { ...mergedPatch, ...patch }
    nextState = { ...nextState, ...patch }
  }
  return Object.keys(mergedPatch).length === 0 ? state : mergedPatch
}

export function applyFreshWebSessionTabsSnapshot(
  state: WebSessionTabsSyncState,
  snapshot: RuntimeMobileSessionTabsResult,
  environmentId: string,
  now = Date.now()
): WebSessionTabsSyncState | Partial<WebSessionTabsSyncState> {
  if (!shouldApplyWebSessionTabsSnapshot(snapshot, environmentId)) {
    return state
  }
  return applyWebSessionTabsSnapshot(state, snapshot, environmentId, now)
}

export function applyFreshWebSessionTabsSnapshots(
  state: WebSessionTabsSyncState,
  snapshots: readonly RuntimeMobileSessionTabsResult[],
  environmentId: string,
  now = Date.now()
): WebSessionTabsSyncState | Partial<WebSessionTabsSyncState> {
  const freshSnapshots = snapshots.filter((snapshot) =>
    shouldApplyWebSessionTabsSnapshot(snapshot, environmentId)
  )
  return freshSnapshots.length === 0
    ? state
    : applyWebSessionTabsSnapshots(state, freshSnapshots, environmentId, now)
}

export function applyWebSessionTabsStorePatch(
  buildPatch: (state: AppState) => WebSessionTabsSyncState | Partial<WebSessionTabsSyncState>
): void {
  let mirroredAgentStatusChanged = false
  useAppStore.setState((state) => {
    const patch = buildPatch(state)
    mirroredAgentStatusChanged =
      patch !== state && Object.prototype.hasOwnProperty.call(patch, 'agentStatusByPaneKey')
    return patch
  })
  // Why: paired-web snapshots bypass setAgentStatus, so arm the stale-boundary timer explicitly like local hook events do.
  if (mirroredAgentStatusChanged) {
    useAppStore.getState().scheduleAgentStatusFreshness()
  }
}

