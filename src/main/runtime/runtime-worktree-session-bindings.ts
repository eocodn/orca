import type { WorkspaceSessionState } from '../../shared/types'
import { makePaneKey } from '../../shared/stable-pane-id'
import { parsePtySessionId } from '../../shared/pty-session-id-format'
import { splitWorktreeId } from '../../shared/worktree-id'
import { runtimeWorktreeIdsEqual } from './runtime-worktree-summary-core'

export function resolveTerminalSessionWorktreeId(
  session: WorkspaceSessionState,
  targetWorktreeId: string
): string | null {
  const keyedWorktreeIds = new Set([
    ...Object.keys(session.tabsByWorktree),
    ...Object.keys(session.tabGroups ?? {}),
    ...Object.keys(session.tabGroupLayouts ?? {}),
    ...Object.keys(session.activeTabIdByWorktree ?? {}),
    ...Object.keys(session.activeGroupIdByWorktree ?? {})
  ])
  const matches = [...keyedWorktreeIds].filter((worktreeId) =>
    runtimeWorktreeIdsEqual(worktreeId, targetWorktreeId)
  )
  return matches.length > 1 ? null : (matches[0] ?? targetWorktreeId)
}

export function canonicalizeTerminalSessionWorktreeId(
  session: WorkspaceSessionState,
  sourceWorktreeId: string,
  targetWorktreeId: string
): void {
  if (sourceWorktreeId === targetWorktreeId) {
    return
  }
  const tabs = session.tabsByWorktree[sourceWorktreeId] ?? []
  delete session.tabsByWorktree[sourceWorktreeId]
  session.tabsByWorktree[targetWorktreeId] = tabs.map((tab) => ({
    ...tab,
    worktreeId: targetWorktreeId
  }))

  const groups = session.tabGroups?.[sourceWorktreeId]
  if (groups) {
    delete session.tabGroups![sourceWorktreeId]
    session.tabGroups![targetWorktreeId] = groups.map((group) => ({
      ...group,
      worktreeId: targetWorktreeId
    }))
  }
  for (const keyedState of [
    session.tabGroupLayouts,
    session.activeTabIdByWorktree,
    session.activeGroupIdByWorktree
  ]) {
    if (!keyedState || !Object.hasOwn(keyedState, sourceWorktreeId)) {
      continue
    }
    keyedState[targetWorktreeId] = keyedState[sourceWorktreeId] as never
    delete keyedState[sourceWorktreeId]
  }
}

export function inferWorktreeIdFromPtyId(ptyId: string): string | null {
  return parsePtySessionId(ptyId).worktreeId
}

export function indexPersistedPtyWorktreeBindings(
  session: WorkspaceSessionState | null | undefined
): ReadonlyMap<string, string> {
  const worktreeIdByPtyId = new Map<string, string>()
  const ambiguousPtyIds = new Set<string>()
  const bind = (ptyId: string | null | undefined, worktreeId: string): void => {
    if (!ptyId || ambiguousPtyIds.has(ptyId)) {
      return
    }
    const existingWorktreeId = worktreeIdByPtyId.get(ptyId)
    if (existingWorktreeId && existingWorktreeId !== worktreeId) {
      worktreeIdByPtyId.delete(ptyId)
      ambiguousPtyIds.add(ptyId)
      return
    }
    worktreeIdByPtyId.set(ptyId, worktreeId)
  }

  for (const [worktreeId, tabs] of Object.entries(session?.tabsByWorktree ?? {})) {
    for (const tab of tabs) {
      bind(tab.ptyId, worktreeId)
      bind(session?.remoteSessionIdsByTabId?.[tab.id], worktreeId)
      const layout = session?.terminalLayoutsByTabId[tab.id]
      for (const ptyId of Object.values(layout?.ptyIdsByLeafId ?? {})) {
        bind(ptyId, worktreeId)
      }
    }
  }
  return worktreeIdByPtyId
}

export type PersistedPtySurfaceBinding = {
  worktreeId: string
  tabId: string
  paneKey: string
  incarnationId: string
}

export function indexPersistedPtySurfaceBindings(
  session: WorkspaceSessionState | null | undefined
): ReadonlyMap<string, PersistedPtySurfaceBinding> {
  const bindingByPtyId = new Map<string, PersistedPtySurfaceBinding>()
  const ambiguousPtyIds = new Set<string>()
  for (const [worktreeId, tabs] of Object.entries(session?.tabsByWorktree ?? {})) {
    for (const tab of tabs) {
      for (const [leafId, ptyId] of Object.entries(
        session?.terminalLayoutsByTabId[tab.id]?.ptyIdsByLeafId ?? {}
      )) {
        if (!ptyId || ambiguousPtyIds.has(ptyId)) {
          continue
        }
        const paneKey = makePaneKey(tab.id, leafId)
        const incarnationId = session?.terminalPtyIncarnationsByPaneKey?.[paneKey]
        if (!incarnationId) {
          continue
        }
        const binding = { worktreeId, tabId: tab.id, paneKey, incarnationId }
        const existing = bindingByPtyId.get(ptyId)
        if (
          existing &&
          (existing.worktreeId !== worktreeId ||
            existing.paneKey !== paneKey ||
            existing.incarnationId !== incarnationId)
        ) {
          bindingByPtyId.delete(ptyId)
          ambiguousPtyIds.add(ptyId)
          continue
        }
        bindingByPtyId.set(ptyId, binding)
      }
    }
  }
  return bindingByPtyId
}

export function setsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) {
    return false
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false
    }
  }
  return true
}

export function parseRuntimeWorktreeId(
  worktreeId: string
): { repoId: string; worktreePath: string } | null {
  const parsed = splitWorktreeId(worktreeId)
  return parsed?.repoId && parsed.worktreePath ? parsed : null
}
