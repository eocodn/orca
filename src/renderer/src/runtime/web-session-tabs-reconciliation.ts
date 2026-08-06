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
import { applyPreparedWebSessionTabsSnapshot } from './web-session-tabs-reconciliation-application'
import type { WebSessionTabsSyncState } from './web-session-tabs-tracking'

export function applyWebSessionTabsSnapshot(
  state: WebSessionTabsSyncState,
  rawSnapshot: RuntimeMobileSessionTabsResult,
  environmentId: string,
  now = Date.now()
): WebSessionTabsSyncState | Partial<WebSessionTabsSyncState> {
  return applyPreparedWebSessionTabsSnapshot(state, rawSnapshot, environmentId, now)
}

export {
  WEB_SESSION_GROUP_PREFIX,
  latestSessionTabsSnapshotByWorktree,
  replayableSessionTabsSnapshotByWorktree,
  lastHostTerminalTabCountByWorktree,
  hostSessionTabIdByLocalKey,
  isSessionTabsListAllResult,
  sessionTabsFreshnessKey,
  rememberHostTerminalTabCount,
  getLastKnownHostTerminalTabCount,
  getLatestWebSessionTabsPublicationEpoch,
  acceptReplayedWebSessionTabsSnapshot,
  shouldApplyWebSessionTabsSnapshot,
  shouldBootstrapInitialWebRuntimeTerminal,
  shouldRespawnWebRuntimeTerminalAfterWake,
  shouldSyncRuntimeSessionTabs,
  shouldSyncAllRuntimeSessionTabs,
  resetWebSessionTabsSnapshotFreshnessForTests,
  _getWebSessionTabsTrackingCountsForTest,
  clearWebSessionTabsTrackingForWorktree,
  clearWebSessionTabsTrackingForEnvironment,
  hostSessionTabMappingKey,
  resolveHostSessionTabIdForWebSessionTab
} from './web-session-tabs-tracking'
export type {
  SessionTabsStreamEvent,
  SessionTabsListAllResult,
  SnapshotFreshness,
  TerminalSurface,
  ReadyTerminalSurface,
  ReadyBrowserSurface,
  ReadyEditorSurface,
  MirroredTerminalTab,
  MirroredBrowserTab,
  MirroredEditorTab,
  WebSessionTabsSyncState
} from './web-session-tabs-tracking'
export {
  isReadyTerminalTab,
  isTerminalSurfaceTab,
  isReadyBrowserTab,
  isReadyEditorTab,
  localEditorFileId,
  editorSourceFileId,
  isRuntimeTerminalTabForEnvironment,
  isMirroredTerminalSurfaceId,
  chooseRemoteTerminalLayout,
  shouldReplaceTerminalTab,
  buildMirroredTerminalTabs,
  toMirroredPaneKey,
  remapHostAgentStatus,
  isMirroredAgentPaneKeyForTabs,
  buildMirroredAgentStatusPatch
} from './web-session-tabs-terminal-projection'
export {
  buildTerminalUnifiedTab,
  buildBrowserUnifiedTab,
  buildEditorUnifiedTab,
  findExistingEditorUnifiedTab,
  buildMirroredEditorTabs,
  findBrowserWorkspaceForRemotePage,
  browserWorkspaceHasRemoteEnvironmentPage,
  buildMirroredBrowserTabs
} from './web-session-tabs-surface-projection'
export {
  chooseTargetGroupId,
  collectLayoutGroupIds,
  buildHostGroupIdByTabId,
  pruneTabGroupLayout,
  appendTabGroupLayout,
  tabGroupLayoutEqual,
  mapHostRecentTabIds,
  buildHostToLocalTabIdMap,
  updateHostSessionTabIdMappings,
  buildMirroredHostGroups
} from './web-session-tabs-group-layout'
export {
  applyWebSessionTabsSnapshots,
  applyFreshWebSessionTabsSnapshot,
  applyFreshWebSessionTabsSnapshots,
  applyWebSessionTabsStorePatch
} from './web-session-tabs-apply-api'
export { useWebSessionTabsSync } from './web-session-tabs-sync-hook'
