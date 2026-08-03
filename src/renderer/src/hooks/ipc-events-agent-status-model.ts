import { useAppStore } from '../store'
import type { AppState } from '../store/types'
import { getWorktreeMapFromState, getRepoMapFromState } from '@/store/selectors'
import { resolveAgentPaneAuthorityKey } from '@/store/slices/agent-pane-authority'
import { parsePaneKey } from '../../../shared/stable-pane-id'
import { collectLeafIdsInOrder } from '@/components/terminal-pane/layout-serialization'
import type { AgentStatusIpcPayload, ParsedAgentStatusPayload } from '../../../shared/agent-status-types'
import { titleHasAgentName } from '../../../shared/agent-detection'
function isAgentStatusForRecentlyClosedTab(
  store: Pick<AppState, 'recentlyClosedAgentStatusTabIds' | 'recentlyRetiredAgentStatusPaneKeys'>,
  paneKey: string
): boolean {
  const ownerPaneKey = resolveAgentPaneAuthorityKey(paneKey)
  if (store.recentlyRetiredAgentStatusPaneKeys?.[ownerPaneKey] === true) {
    return true
  }
  const tabId = parsePaneKey(ownerPaneKey)?.tabId
  if (!tabId) {
    return false
  }
  return store.recentlyClosedAgentStatusTabIds[tabId] === true
}
function hasRuntimeBackedWorktreeAttribution(data: AgentStatusIpcPayload): boolean {
  return (
    (typeof data.terminalHandle === 'string' && data.terminalHandle.length > 0) ||
    data.orchestration !== undefined
  )
}

function applyResolvedAgentTerminalTitleToTab(
  store: ReturnType<typeof useAppStore.getState>,
  paneKey: string,
  previousTitle: string | undefined,
  nextTitle: string | undefined
): void {
  if (!nextTitle || nextTitle === previousTitle) {
    return
  }
  const parsed = parsePaneKey(paneKey)
  if (!parsed) {
    return
  }
  const layout = store.terminalLayoutsByTabId?.[parsed.tabId]
  if (layout?.root && layout.activeLeafId && layout.activeLeafId !== parsed.leafId) {
    return
  }
  // Why: hook completion can arrive while the pane transport is unmounted; keep the tab label synced to the resolved state title.
  store.updateTabTitle(parsed.tabId, nextTitle)
}

function resolvePaneKey(
  store: ReturnType<typeof useAppStore.getState>,
  paneKey: string
): {
  exists: boolean
  title: string | undefined
  identityTitle: string | undefined
  repoConnectionId: string | null
  repoConnectionResolved: boolean
  owningWorktreeId: string | undefined
} {
  const parsed = parsePaneKey(paneKey)
  if (!parsed) {
    return {
      exists: false,
      title: undefined,
      identityTitle: undefined,
      repoConnectionId: null,
      repoConnectionResolved: false,
      owningWorktreeId: undefined
    }
  }
  const { tabId, leafId } = parsed
  const layout = store.terminalLayoutsByTabId?.[tabId]
  let exists = false
  let tabTitle: string | undefined
  let unifiedTabLabel: string | undefined
  let owningWorktreeId: string | undefined
  for (const [worktreeId, tabs] of Object.entries(store.tabsByWorktree)) {
    for (const tab of tabs) {
      if (tab.id === tabId) {
        exists = true
        tabTitle = tab.title
        owningWorktreeId = worktreeId
        const visibleTab = (store.unifiedTabsByWorktree?.[worktreeId] ?? []).find(
          (entry) => entry.contentType === 'terminal' && entry.entityId === tabId
        )
        const rawVisibleLabel = visibleTab?.label?.trim()
        unifiedTabLabel =
          rawVisibleLabel && rawVisibleLabel.length > 0 ? rawVisibleLabel : undefined
        break
      }
    }
    if (exists) {
      break
    }
  }
  let repoConnectionId: string | null = null
  let repoConnectionResolved = false
  if (owningWorktreeId !== undefined) {
    const worktree = getWorktreeMapFromState(store).get(owningWorktreeId)
    if (worktree) {
      const repo = getRepoMapFromState(store).get(worktree.repoId)
      repoConnectionResolved = repo !== undefined
      repoConnectionId = repo?.connectionId ?? null
    }
  }
  if (!exists) {
    return {
      exists: false,
      title: undefined,
      identityTitle: undefined,
      repoConnectionId,
      repoConnectionResolved,
      owningWorktreeId
    }
  }
  const leafExists = layout?.root ? collectLeafIdsInOrder(layout.root).includes(leafId) : true
  if (!leafExists) {
    return {
      exists: false,
      title: undefined,
      identityTitle: undefined,
      repoConnectionId,
      repoConnectionResolved,
      owningWorktreeId
    }
  }
  const rawPaneTitle = layout?.titlesByLeafId?.[leafId]
  const paneTitle = rawPaneTitle && rawPaneTitle.length > 0 ? rawPaneTitle : undefined
  return {
    exists,
    title: paneTitle ?? tabTitle,
    identityTitle: paneTitle ?? unifiedTabLabel ?? tabTitle,
    repoConnectionId,
    repoConnectionResolved,
    owningWorktreeId
  }
}

function resolveWorktreeConnection(
  store: ReturnType<typeof useAppStore.getState>,
  worktreeId: string
): {
  worktreeExists: boolean
  repoConnectionId: string | null
  repoConnectionResolved: boolean
} {
  const worktree = getWorktreeMapFromState(store).get(worktreeId)
  if (!worktree) {
    return { worktreeExists: false, repoConnectionId: null, repoConnectionResolved: false }
  }
  const repo = getRepoMapFromState(store).get(worktree.repoId)
  return {
    worktreeExists: true,
    repoConnectionId: repo?.connectionId ?? null,
    repoConnectionResolved: repo !== undefined
  }
}

function resolveHookPayloadAgentType(
  payload: ParsedAgentStatusPayload,
  terminalTitle: string | undefined
): ParsedAgentStatusPayload {
  if (
    payload.agentType !== 'claude' ||
    !terminalTitle ||
    !titleHasAgentName(terminalTitle, 'openclaude')
  ) {
    return payload
  }
  return { ...payload, agentType: 'openclaude' }
}
