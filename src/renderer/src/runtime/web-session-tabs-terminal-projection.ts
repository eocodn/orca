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

import { WEB_SESSION_GROUP_PREFIX, latestSessionTabsSnapshotByWorktree, replayableSessionTabsSnapshotByWorktree, lastHostTerminalTabCountByWorktree, hostSessionTabIdByLocalKey, isSessionTabsListAllResult, sessionTabsFreshnessKey, rememberHostTerminalTabCount, getLastKnownHostTerminalTabCount, getLatestWebSessionTabsPublicationEpoch, acceptReplayedWebSessionTabsSnapshot, shouldApplyWebSessionTabsSnapshot, shouldBootstrapInitialWebRuntimeTerminal, shouldRespawnWebRuntimeTerminalAfterWake, shouldSyncRuntimeSessionTabs, shouldSyncAllRuntimeSessionTabs, resetWebSessionTabsSnapshotFreshnessForTests, _getWebSessionTabsTrackingCountsForTest, clearWebSessionTabsTrackingForWorktree, clearWebSessionTabsTrackingForEnvironment, hostSessionTabMappingKey, resolveHostSessionTabIdForWebSessionTab, buildTerminalUnifiedTab, buildBrowserUnifiedTab, buildEditorUnifiedTab, findExistingEditorUnifiedTab, buildMirroredEditorTabs, findBrowserWorkspaceForRemotePage, browserWorkspaceHasRemoteEnvironmentPage, buildMirroredBrowserTabs, chooseTargetGroupId, collectLayoutGroupIds, buildHostGroupIdByTabId, pruneTabGroupLayout, appendTabGroupLayout, tabGroupLayoutEqual, mapHostRecentTabIds, buildHostToLocalTabIdMap, updateHostSessionTabIdMappings, buildMirroredHostGroups, applyWebSessionTabsSnapshot, applyWebSessionTabsSnapshots, applyFreshWebSessionTabsSnapshot, applyFreshWebSessionTabsSnapshots, applyWebSessionTabsStorePatch, useWebSessionTabsSync, type SessionTabsStreamEvent, type SessionTabsListAllResult, type SnapshotFreshness, type TerminalSurface, type ReadyTerminalSurface, type ReadyBrowserSurface, type ReadyEditorSurface, type MirroredTerminalTab, type MirroredBrowserTab, type MirroredEditorTab, type WebSessionTabsSyncState } from './web-session-tabs-reconciliation'

export function isReadyTerminalTab(
  tab: RuntimeMobileSessionTabsResult['tabs'][number]
): tab is ReadyTerminalSurface {
  return tab.type === 'terminal' && tab.status === 'ready' && tab.terminal.trim().length > 0
}

export function isTerminalSurfaceTab(
  tab: RuntimeMobileSessionTabsResult['tabs'][number]
): tab is TerminalSurface {
  return tab.type === 'terminal'
}

export function isReadyBrowserTab(
  tab: RuntimeMobileSessionTabsResult['tabs'][number]
): tab is ReadyBrowserSurface {
  return tab.type === 'browser' && typeof tab.browserPageId === 'string' && tab.browserPageId !== ''
}

export function isReadyEditorTab(
  tab: RuntimeMobileSessionTabsResult['tabs'][number]
): tab is ReadyEditorSurface {
  return tab.type === 'markdown' || tab.type === 'file'
}

export function localEditorFileId(tab: ReadyEditorSurface): string {
  if (tab.type === 'markdown' && tab.mode === 'markdown-preview') {
    return `markdown-preview::${tab.sourceFilePath}`
  }
  return tab.filePath
}

export function editorSourceFileId(tab: ReadyEditorSurface): string | undefined {
  return tab.type === 'markdown' && tab.mode === 'markdown-preview' ? tab.sourceFilePath : undefined
}

export function isRuntimeTerminalTabForEnvironment(tab: TerminalTab, environmentId: string): boolean {
  if (!tab.ptyId) {
    return false
  }
  return getRemoteRuntimePtyEnvironmentId(tab.ptyId) === environmentId
}

export function isMirroredTerminalSurfaceId(tabId: string): boolean {
  return (
    tabId.startsWith(WEB_TERMINAL_SURFACE_TAB_PREFIX) ||
    tabId.includes(HOST_TERMINAL_SURFACE_SEPARATOR)
  )
}

export function chooseRemoteTerminalLayout(
  surfaces: readonly TerminalSurface[],
  ptyIdsByLeafId: Record<string, string>,
  existingLayout?: TerminalLayoutSnapshot,
  requestedActiveLeafId?: string
): TerminalLayoutSnapshot {
  const leafIds = surfaces.map((surface) => surface.leafId)
  const knownLeafIds = new Set(leafIds)
  const parentLayoutSource = surfaces.find((surface) => surface.parentLayout)
  const parentLayout = parentLayoutSource?.parentLayout
    ? sanitizeTerminalLayoutPaneTitlesForLabels(parentLayoutSource.parentLayout, [
        parentLayoutSource.title
      ])
    : undefined
  const activeLeafId =
    (requestedActiveLeafId && knownLeafIds.has(requestedActiveLeafId)
      ? requestedActiveLeafId
      : null) ??
    // Why: host title/status snapshots may still mark an agent pane active after this client selected a different split pane.
    (existingLayout?.activeLeafId && knownLeafIds.has(existingLayout.activeLeafId)
      ? existingLayout.activeLeafId
      : null) ??
    (parentLayout?.activeLeafId && knownLeafIds.has(parentLayout.activeLeafId)
      ? parentLayout.activeLeafId
      : null) ??
    surfaces.find((surface) => surface.isActive)?.leafId ??
    leafIds[0] ??
    null
  const expandedLeafId =
    requestedActiveLeafId &&
    (Boolean(existingLayout?.expandedLeafId) || Boolean(parentLayout?.expandedLeafId))
      ? requestedActiveLeafId
      : parentLayout?.expandedLeafId && knownLeafIds.has(parentLayout.expandedLeafId)
        ? parentLayout.expandedLeafId
        : null
  return {
    // Why: host parentLayout is authoritative for split direction; else keep the prior client tree, then degenerate — never re-guess a direction.
    root: resolveTerminalLayoutRoot({
      authoritativeRoot: parentLayout?.root,
      existingRoot: existingLayout?.root,
      leafIds,
      onSynthesize: (leafCount) =>
        console.warn(
          `[web-session-tabs-sync] synthesized layout for ${leafCount} leaves; no authoritative or prior tree covered them`
        )
    }),
    activeLeafId,
    expandedLeafId,
    ptyIdsByLeafId,
    // Why: surface.title is the tab/PTY label, not a pane title; restoring it as one renders a fake title bar. Only host layout titles are real pane titles.
    ...(parentLayout?.titlesByLeafId ? { titlesByLeafId: parentLayout.titlesByLeafId } : {})
  }
}

export function shouldReplaceTerminalTab(
  tab: TerminalTab,
  environmentId: string,
  nextRemotePtyIds: ReadonlySet<string>,
  nextMirroredTerminalIds: ReadonlySet<string>,
  exactProvisionalHandoffs: ReadonlySet<string>
): boolean {
  if (exactProvisionalHandoffs.has(tab.id)) {
    // Why: agent kind is not session identity; retire only the provisional tab
    // whose request or structured response identifies this exact host surface.
    return true
  }
  if (isMirroredTerminalSurfaceId(tab.id)) {
    // Why: host snapshots are authoritative for mirrored tabs; replace old mirrors even when the next surface still awaits a stream handle, else parity drifts.
    return true
  }
  if (tab.pendingActivationSpawn && tab.ptyId === null && nextRemotePtyIds.size > 0) {
    return true
  }
  if (!isRuntimeTerminalTabForEnvironment(tab, environmentId)) {
    return false
  }
  // Why: web-created remote tabs use local UUIDs until the host publishes their surface; only retire them once their PTY appears in the snapshot.
  return (
    tab.ptyId !== null &&
    (nextRemotePtyIds.has(tab.ptyId) ||
      nextMirroredTerminalIds.has(toWebTerminalSurfaceTabId(tab.id)))
  )
}

/** Constructs mirrored terminal tabs from the mobile session status payload, normalising Pi-compatible agent titles under launch ownership. */
export function buildMirroredTerminalTabs(
  snapshot: RuntimeMobileSessionTabsResult,
  environmentId: string,
  existingById: ReadonlyMap<string, TerminalTab>,
  existingLayoutsByTabId: Readonly<Record<string, TerminalLayoutSnapshot>>,
  sortOffset: number,
  now: number,
  focusTarget?: { parentTabId: string; leafId: string }
): MirroredTerminalTab[] {
  const groups = new Map<string, TerminalSurface[]>()
  for (const tab of snapshot.tabs.filter(isTerminalSurfaceTab)) {
    const group = groups.get(tab.parentTabId) ?? []
    group.push(tab)
    groups.set(tab.parentTabId, group)
  }

  return [...groups.entries()].map(([parentTabId, surfaces], index) => {
    const localTabId = toWebTerminalSurfaceTabId(parentTabId)
    const existingLayout = existingLayoutsByTabId[localTabId]
    const requestedActiveLeafId =
      focusTarget?.parentTabId === parentTabId ? focusTarget.leafId : undefined
    const activeSurface =
      (requestedActiveLeafId
        ? surfaces.find((surface) => surface.leafId === requestedActiveLeafId)
        : undefined) ??
      (existingLayout?.activeLeafId
        ? surfaces.find((surface) => surface.leafId === existingLayout.activeLeafId)
        : undefined) ??
      surfaces.find((surface) => surface.isActive) ??
      surfaces[0]!
    const ptyIdsByLeafId = Object.fromEntries(
      surfaces
        .filter((surface): surface is ReadyTerminalSurface => surface.status === 'ready')
        .map((surface) => [surface.leafId, toRemoteRuntimePtyId(surface.terminal, environmentId)])
    )
    const ptyIds = surfaces
      .map((surface) => ptyIdsByLeafId[surface.leafId]!)
      .filter((ptyId): ptyId is string => typeof ptyId === 'string' && ptyId.length > 0)
    const launchAgent =
      activeSurface.launchAgent ?? surfaces.find((surface) => surface.launchAgent)?.launchAgent
    const ownerAgent = resolvePaneAgentOwner({
      launchAgent,
      hookAgent: activeSurface.agentStatus?.agentType,
      siblingHookAgent: surfaces.find((surface) => surface.agentStatus?.agentType)?.agentStatus
        ?.agentType
    })
    const title = normalizeCompatibleAgentTitleForOwner(
      activeSurface.title.trim() || surfaces[0]?.title.trim() || 'Terminal',
      ownerAgent
    )
    const existing =
      existingById.get(localTabId) ??
      existingById.get(parentTabId) ??
      surfaces
        .map((surface) => existingById.get(toWebTerminalSurfaceTabId(surface.id)))
        .find((tab): tab is TerminalTab => Boolean(tab))
    const quickCommandLabel =
      activeSurface.quickCommandLabel?.trim() ||
      surfaces.find((surface) => surface.quickCommandLabel?.trim())?.quickCommandLabel?.trim() ||
      existing?.quickCommandLabel?.trim()
    // Why: startupCwd is host-owned launch metadata; once the host omits it, don't resurrect stale subdirectory intent.
    const startupCwd =
      activeSurface.startupCwd || surfaces.find((surface) => surface.startupCwd)?.startupCwd
    // Why: color/pin echo back through host snapshots, so prefer the client's own record and fall back to host only without a prior tab (avoids echo-window reverts).
    const hostColorSurface = surfaces.find((surface) => surface.color != null)
    const color = existing ? (existing.color ?? null) : (hostColorSurface?.color ?? null)
    const isPinned = existing
      ? existing.isPinned === true
      : surfaces.some((surface) => surface.isPinned)
    // Why: viewMode echoes back through host snapshots, so prefer the client's record during the echo window and adopt the host value only without a prior tab.
    const hostViewModeSurface = surfaces.find((surface) => surface.viewMode)
    const viewMode = existing ? existing.viewMode : hostViewModeSurface?.viewMode
    return {
      tab: {
        id: localTabId,
        ptyId: ptyIdsByLeafId[activeSurface.leafId] ?? null,
        worktreeId: snapshot.worktree,
        title,
        defaultTitle: existing?.defaultTitle ?? title,
        ...(quickCommandLabel ? { quickCommandLabel } : {}),
        ...(startupCwd ? { startupCwd } : {}),
        customTitle: existing?.customTitle ?? null,
        color,
        isPinned,
        ...(viewMode ? { viewMode } : {}),
        sortOrder: sortOffset + index,
        createdAt: existing?.createdAt ?? now + index,
        // Why: launchAgent is host-owned lifecycle metadata; once the host omits it, don't resurrect stale startup intent.
        ...(launchAgent ? { launchAgent } : {})
      },
      hostTabId: parentTabId,
      ptyIds,
      layout: chooseRemoteTerminalLayout(
        surfaces,
        ptyIdsByLeafId,
        existingLayout,
        requestedActiveLeafId
      )
    }
  })
}

export function toMirroredPaneKey(surface: TerminalSurface): string | null {
  if (!isTerminalLeafId(surface.leafId)) {
    return null
  }
  return makePaneKey(toWebTerminalSurfaceTabId(surface.parentTabId), surface.leafId)
}

/** Normalises and mirrors agent status updates from the host payload, preserving ownership metadata. */
export function remapHostAgentStatus(surface: TerminalSurface): AgentStatusEntry | null {
  if (!surface.agentStatus) {
    return null
  }
  const paneKey = toMirroredPaneKey(surface)
  if (!paneKey) {
    return null
  }
  const ownerAgent = resolvePaneAgentOwner({
    launchAgent: surface.launchAgent,
    hookAgent: surface.agentStatus.agentType
  })
  return {
    ...normalizeCompatibleAgentStatusEntryForOwner(surface.agentStatus, ownerAgent),
    paneKey,
    tabId: toWebTerminalSurfaceTabId(surface.parentTabId)
  }
}

export function isMirroredAgentPaneKeyForTabs(paneKey: string, tabIds: ReadonlySet<string>): boolean {
  const parsed = parsePaneKey(paneKey)
  return parsed !== null && tabIds.has(parsed.tabId)
}

/** Generates a state patch for mirrored agent statuses, merging host entries with client overrides. */
export function buildMirroredAgentStatusPatch(
  state: WebSessionTabsSyncState,
  currentTerminalTabs: readonly TerminalTab[],
  terminalSurfaceTabs: readonly TerminalSurface[],
  now: number
): Pick<WebSessionTabsSyncState, 'agentStatusByPaneKey' | 'agentStatusEpoch' | 'sortEpoch'> | null {
  const mirroredTabIds = new Set<string>()
  for (const tab of currentTerminalTabs) {
    if (isWebTerminalSurfaceTabId(tab.id)) {
      mirroredTabIds.add(tab.id)
    }
  }
  for (const surface of terminalSurfaceTabs) {
    mirroredTabIds.add(toWebTerminalSurfaceTabId(surface.parentTabId))
  }

  if (mirroredTabIds.size === 0) {
    return null
  }

  const nextByPaneKey = new Map<string, AgentStatusEntry>()
  for (const surface of terminalSurfaceTabs) {
    const entry = remapHostAgentStatus(surface)
    if (!entry) {
      continue
    }
    const existing = state.agentStatusByPaneKey[entry.paneKey]
    // Why: keep fresher OSC state while taking remapped ownership metadata from the authoritative host snapshot.
    const hostIdentityPredatesCurrentTurn =
      existing !== undefined &&
      entry.state === 'done' &&
      existing.state !== 'done' &&
      existing.stateStartedAt > entry.stateStartedAt
    const nextEntry =
      existing && existing.updatedAt > entry.updatedAt
        ? {
            ...normalizeCompatibleAgentStatusEntryForOwner(existing, entry.agentType),
            paneKey: entry.paneKey,
            worktreeId: entry.worktreeId ?? existing.worktreeId,
            tabId: entry.tabId,
            providerSession:
              existing.providerSession ??
              (hostIdentityPredatesCurrentTurn ? undefined : entry.providerSession)
          }
        : entry
    nextByPaneKey.set(entry.paneKey, nextEntry)
  }

  let nextAgentStatusByPaneKey = state.agentStatusByPaneKey
  let changed = false
  let aggregateRelevantChange = false
  let sortRelevantChange = false

  for (const paneKey of Object.keys(state.agentStatusByPaneKey)) {
    if (!isMirroredAgentPaneKeyForTabs(paneKey, mirroredTabIds)) {
      continue
    }
    if (nextByPaneKey.has(paneKey)) {
      continue
    }
    if (nextAgentStatusByPaneKey === state.agentStatusByPaneKey) {
      nextAgentStatusByPaneKey = { ...state.agentStatusByPaneKey }
    }
    delete nextAgentStatusByPaneKey[paneKey]
    changed = true
    aggregateRelevantChange = true
    sortRelevantChange = true
  }

  for (const [paneKey, entry] of nextByPaneKey) {
    const existing = nextAgentStatusByPaneKey[paneKey]
    if (agentStatusEntryEqual(existing, entry)) {
      continue
    }
    if (nextAgentStatusByPaneKey === state.agentStatusByPaneKey) {
      nextAgentStatusByPaneKey = { ...state.agentStatusByPaneKey }
    }
    nextAgentStatusByPaneKey[paneKey] = entry
    changed = true
    const entryAttributionChanged =
      existing?.worktreeId !== entry.worktreeId || existing?.tabId !== entry.tabId
    const entrySortRelevantChange =
      !existing ||
      existing.state !== entry.state ||
      !isAgentStatusFresh(existing, now) ||
      entryAttributionChanged ||
      isMirroredCommandCodeTurnBump(existing, entry)
    aggregateRelevantChange = aggregateRelevantChange || entrySortRelevantChange
    sortRelevantChange = sortRelevantChange || entrySortRelevantChange
  }

  if (!changed) {
    return null
  }

  return {
    agentStatusByPaneKey: nextAgentStatusByPaneKey,
    agentStatusEpoch: aggregateRelevantChange ? state.agentStatusEpoch + 1 : state.agentStatusEpoch,
    sortEpoch: sortRelevantChange ? state.sortEpoch + 1 : state.sortEpoch
  }
}

