import { useMemo } from 'react'
import type { MemorySnapshot } from '../../../../shared/types'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../../../shared/execution-host'
import { isFolderRepo } from '../../../../shared/repo-kind'
import { isWorkspaceOldForCleanup } from '../../../../shared/workspace-cleanup'
import { useAppStore } from '../../store'
import { mergeSnapshotAndSessions } from './mergeSnapshotAndSessions'
import type { UnifiedProjectGroup } from './resource-usage-merge-types'
import {
  getResourceUsageAllWorktrees,
  getResourceUsageBrowserTabsByWorktree,
  getResourceUsageDeferredSshSessionIdsByTabId,
  getResourceUsagePtyIdsByTabId,
  getResourceUsageRepos,
  getResourceUsageRuntimePaneTitlesByTabId,
  getResourceUsageTabsByWorktree,
  getResourceUsageTerminalLayoutsByTabId
} from './resource-usage-open-slices'
import {
  countUnboundDaemonSessions,
  type ResourceSessionBindingInputs
} from './resource-session-bindings'
import { useResourceSessionInventory } from './use-resource-session-inventory'
import { formatMemory } from './resource-usage-metrics'

export type ResourceUsageStatusInventory = {
  snapshot: MemorySnapshot | null
  memorySnapshotError: string | null
  fetchSnapshot: () => Promise<void>
  workspaceSessionReady: boolean
  sessionInventory: ReturnType<typeof useResourceSessionInventory>['sessionInventory']
  sessions: ReturnType<typeof useResourceSessionInventory>['sessionInventory']['sessions']
  sessionsError: boolean
  refreshSessions: ReturnType<typeof useResourceSessionInventory>['refreshSessions']
  clearSessionsError: ReturnType<typeof useResourceSessionInventory>['clearSessionsError']
  removeSession: ReturnType<typeof useResourceSessionInventory>['removeSession']
  removeSessions: ReturnType<typeof useResourceSessionInventory>['removeSessions']
  runtimePaneTitlesByTabId: ReturnType<typeof getResourceUsageRuntimePaneTitlesByTabId>
  repos: ReturnType<typeof getResourceUsageRepos>
  allWorktrees: ReturnType<typeof getResourceUsageAllWorktrees>
  tabsByWorktree: ReturnType<typeof getResourceUsageTabsByWorktree>
  browserTabsByWorktree: ReturnType<typeof getResourceUsageBrowserTabsByWorktree>
  resourceSessionBindings: ResourceSessionBindingInputs
  unifiedRepos: UnifiedProjectGroup[]
  orphanCount: number
  oldWorkspaceCount: number
  totalCpu: number
  totalMemory: number
  memBadgeLabel: string
  daemonUnreachable: boolean
  sessionsOnlyError: boolean
}

/** Collects the open-only store slices and derives the Resource Manager rows. */
export function useResourceUsageStatusInventory(open: boolean): ResourceUsageStatusInventory {
  const snapshot = useAppStore((state) => state.memorySnapshot)
  const memorySnapshotError = useAppStore((state) => state.memorySnapshotError)
  const fetchSnapshot = useAppStore((state) => state.fetchMemorySnapshot)
  const workspaceSessionReady = useAppStore((state) => state.workspaceSessionReady)
  const sessionInventoryState = useResourceSessionInventory(workspaceSessionReady)
  const {
    sessionInventory,
    sessionsError,
    refreshSessions,
    clearSessionsError,
    removeSession,
    removeSessions
  } = sessionInventoryState
  const sessions = sessionInventory.sessions
  const runtimePaneTitlesByTabId = useAppStore((state) =>
    getResourceUsageRuntimePaneTitlesByTabId(state, open)
  )
  const repos = useAppStore((state) => getResourceUsageRepos(state, open))
  const allWorktrees = useAppStore((state) => getResourceUsageAllWorktrees(state, open))
  const tabsByWorktree = useAppStore((state) => getResourceUsageTabsByWorktree(state, open))
  const browserTabsByWorktree = useAppStore((state) =>
    getResourceUsageBrowserTabsByWorktree(state, open)
  )
  const ptyIdsByTabId = useAppStore((state) => getResourceUsagePtyIdsByTabId(state, open))
  const terminalLayoutsByTabId = useAppStore((state) =>
    getResourceUsageTerminalLayoutsByTabId(state, open)
  )
  const deferredSshSessionIdsByTabId = useAppStore((state) =>
    getResourceUsageDeferredSshSessionIdsByTabId(state, open)
  )
  const resourceSessionBindings = useMemo<ResourceSessionBindingInputs>(
    () => ({
      ptyIdsByTabId,
      tabsByWorktree,
      terminalLayoutsByTabId,
      deferredSshSessionIdsByTabId,
      workspaceSessionReady
    }),
    [
      deferredSshSessionIdsByTabId,
      ptyIdsByTabId,
      tabsByWorktree,
      terminalLayoutsByTabId,
      workspaceSessionReady
    ]
  )
  const repoDisplayNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const repo of repos) {
      const displayName = repo.displayName?.trim()
      if (displayName) {
        map.set(repo.id, displayName)
      }
    }
    return map
  }, [repos])
  const repoConnectionIdById = useMemo(
    () => new Map(repos.map((repo) => [repo.id, repo.connectionId ?? null])),
    [repos]
  )
  const repoRuntimeScopedById = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const repo of repos) {
      map.set(repo.id, parseExecutionHostId(getRepoExecutionHostId(repo))?.kind === 'runtime')
    }
    return map
  }, [repos])
  const repoById = useMemo(() => new Map(repos.map((repo) => [repo.id, repo])), [repos])
  const worktreeById = useMemo(
    () => new Map(allWorktrees.map((worktree) => [worktree.id, worktree])),
    [allWorktrees]
  )
  const unifiedRepos = useMemo(
    () =>
      open
        ? mergeSnapshotAndSessions(snapshot, sessions, {
            ...resourceSessionBindings,
            runtimePaneTitlesByTabId,
            repoDisplayNameById,
            repoConnectionIdById,
            repoRuntimeScopedById,
            browserTabsByWorktree,
            worktreeById
          })
        : [],
    [
      browserTabsByWorktree,
      open,
      repoConnectionIdById,
      repoDisplayNameById,
      repoRuntimeScopedById,
      resourceSessionBindings,
      runtimePaneTitlesByTabId,
      sessions,
      snapshot,
      worktreeById
    ]
  )
  const orphanCount = useMemo(
    () =>
      open && workspaceSessionReady
        ? countUnboundDaemonSessions(sessions, resourceSessionBindings)
        : 0,
    [open, resourceSessionBindings, sessions, workspaceSessionReady]
  )
  const oldWorkspaceCount = useMemo(() => {
    const now = Date.now()
    return allWorktrees.reduce((count, worktree) => {
      const repo = repoById.get(worktree.repoId)
      if (!repo || isFolderRepo(repo) || worktree.isMainWorktree) {
        return count
      }
      return count + (isWorkspaceOldForCleanup(worktree, now) ? 1 : 0)
    }, 0)
  }, [allWorktrees, repoById])
  const totalMemory = snapshot?.totalMemory ?? 0
  const totalCpu = snapshot?.totalCpu ?? 0
  const memBadgeLabel = snapshot ? formatMemory(totalMemory) : '—'
  const daemonUnreachable = Boolean(
    sessionsError && (memorySnapshotError !== null || snapshot === null)
  )
  const sessionsOnlyError = Boolean(sessionsError && memorySnapshotError === null)
  return {
    snapshot,
    memorySnapshotError,
    fetchSnapshot,
    workspaceSessionReady,
    sessionInventory,
    sessions,
    sessionsError,
    refreshSessions,
    clearSessionsError,
    removeSession,
    removeSessions,
    runtimePaneTitlesByTabId,
    repos,
    allWorktrees,
    tabsByWorktree,
    browserTabsByWorktree,
    resourceSessionBindings,
    unifiedRepos,
    orphanCount,
    oldWorkspaceCount,
    totalCpu,
    totalMemory,
    memBadgeLabel,
    daemonUnreachable,
    sessionsOnlyError
  }
}
