import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GitStatusResult } from '../../../../shared/types'
import type { WorkspaceSpaceWorktree } from '../../../../shared/workspace-space-types'
import { useAppStore } from '../../store'
import { getRepoMapFromState, getWorktreeMapFromState } from '../../store/selectors'
import { refreshGitStatusForWorktree } from '../right-sidebar/git-status-refresh'
import {
  filterWorkspaceSpaceRows,
  getLargestWorkspaceSpaceRowSize,
  getSelectedDeletableWorkspaceIds,
  getVisibleDeletableWorkspaceIds,
  getWorkspaceSpaceGitStatusRefreshCandidates,
  isWorkspaceSpaceRowReadyToDelete,
  pruneWorkspaceSpaceSelectedIds,
  resolveWorkspaceSpaceInspectedWorktreeId,
  resolveWorkspaceSpaceTreemapZoomWorktreeId,
  sortWorkspaceSpaceRows,
  type WorkspaceSpaceSortDirection,
  type WorkspaceSpaceSortKey
} from './workspace-space-presentation'
import {
  getWorkspaceDecisionDetails,
  type WorkspaceDecisionDetails
} from './workspace-space-manager-decision-model'
import type { WorkspaceGitRefreshState } from './workspace-space-manager-types'
import { getWorkspaceSpaceProgressLabel } from './workspace-space-format'

const GIT_STATUS_REFRESH_CONCURRENCY = 6

export function useWorkspaceSpaceManagerScan() {
  const analysis = useAppStore((state) => state.workspaceSpaceAnalysis)
  const progress = useAppStore((state) => state.workspaceSpaceScanProgress)
  const scanError = useAppStore((state) => state.workspaceSpaceScanError)
  const isScanning = useAppStore((state) => state.workspaceSpaceScanning)
  const refreshWorkspaceSpace = useAppStore((state) => state.refreshWorkspaceSpace)
  const cancelWorkspaceSpaceScan = useAppStore((state) => state.cancelWorkspaceSpaceScan)
  const deleteStateByWorktreeId = useAppStore((state) => state.deleteStateByWorktreeId)
  const repoMap = useAppStore((state) => getRepoMapFromState(state))
  const worktreeMap = useAppStore((state) => getWorktreeMapFromState(state))
  const tabsByWorktree = useAppStore((state) => state.tabsByWorktree)
  const ptyIdsByTabId = useAppStore((state) => state.ptyIdsByTabId)
  const agentStatusByPaneKey = useAppStore((state) => state.agentStatusByPaneKey)
  const migrationUnsupportedByPtyId = useAppStore((state) => state.migrationUnsupportedByPtyId)
  const runtimePaneTitlesByTabId = useAppStore((state) => state.runtimePaneTitlesByTabId)
  const agentStatusEpoch = useAppStore((state) => state.agentStatusEpoch)
  const retainedAgentsByPaneKey = useAppStore((state) => state.retainedAgentsByPaneKey)
  const openFiles = useAppStore((state) => state.openFiles)
  const editorDrafts = useAppStore((state) => state.editorDrafts)
  const browserTabsByWorktree = useAppStore((state) => state.browserTabsByWorktree)
  const gitStatusByWorktree = useAppStore((state) => state.gitStatusByWorktree)
  const remoteStatusesByWorktree = useAppStore((state) => state.remoteStatusesByWorktree)
  const hostedReviewCache = useAppStore((state) => state.hostedReviewCache)
  const issueCache = useAppStore((state) => state.issueCache)
  const linearIssueCache = useAppStore((state) => state.linearIssueCache)
  const settings = useAppStore((state) => state.settings)
  const activeWorktreeId = useAppStore((state) => state.activeWorktreeId)
  const setGitStatus = useAppStore((state) => state.setGitStatus)
  const updateWorktreeGitIdentity = useAppStore((state) => state.updateWorktreeGitIdentity)
  const setUpstreamStatus = useAppStore((state) => state.setUpstreamStatus)
  const fetchUpstreamStatus = useAppStore((state) => state.fetchUpstreamStatus)
  const [query, setQuery] = useState('')
  const [onlyDeletable, setOnlyDeletable] = useState(false)
  const [sortKey, setSortKey] = useState<WorkspaceSpaceSortKey>('size')
  const [sortDirection, setSortDirection] = useState<WorkspaceSpaceSortDirection>('desc')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [inspectedWorktreeId, setInspectedWorktreeId] = useState<string | null>(null)
  const [treemapZoomWorktreeId, setTreemapZoomWorktreeId] = useState<string | null>(null)
  const [gitRefreshStateByWorktreeId, setGitRefreshStateByWorktreeId] = useState<
    Record<string, WorkspaceGitRefreshState>
  >({})
  const inFlightGitStatusRefreshes = useRef(new Set<string>())
  const sourceRows = useMemo(() => analysis?.worktrees ?? [], [analysis?.worktrees])

  const decisionDetailsByWorktreeId = useMemo(() => {
    void agentStatusEpoch
    const details = new Map<string, WorkspaceDecisionDetails>()
    const now = Date.now()
    for (const worktree of sourceRows) {
      details.set(
        worktree.worktreeId,
        getWorkspaceDecisionDetails(worktree, {
          repoMap,
          worktreeMap,
          tabsByWorktree,
          ptyIdsByTabId,
          agentStatusByPaneKey,
          migrationUnsupportedByPtyId,
          runtimePaneTitlesByTabId,
          retainedAgentsByPaneKey,
          openFiles,
          editorDrafts,
          browserTabsByWorktree,
          gitStatusByWorktree,
          remoteStatusesByWorktree,
          hostedReviewCache,
          issueCache,
          linearIssueCache,
          settings,
          activeWorktreeId,
          now
        })
      )
    }
    return details
  }, [
    activeWorktreeId,
    agentStatusByPaneKey,
    agentStatusEpoch,
    browserTabsByWorktree,
    editorDrafts,
    gitStatusByWorktree,
    hostedReviewCache,
    issueCache,
    linearIssueCache,
    migrationUnsupportedByPtyId,
    openFiles,
    ptyIdsByTabId,
    repoMap,
    remoteStatusesByWorktree,
    retainedAgentsByPaneKey,
    runtimePaneTitlesByTabId,
    settings,
    sourceRows,
    tabsByWorktree,
    worktreeMap
  ])

  const refreshWorkspaceGitStatus = useCallback(
    (worktree: WorkspaceSpaceWorktree): Promise<void> => {
      const currentState = useAppStore.getState()
      if (
        currentState.gitStatusByWorktree[worktree.worktreeId] !== undefined ||
        inFlightGitStatusRefreshes.current.has(worktree.worktreeId)
      ) {
        return Promise.resolve()
      }
      inFlightGitStatusRefreshes.current.add(worktree.worktreeId)
      setGitRefreshStateByWorktreeId((current) => ({
        ...current,
        [worktree.worktreeId]: { isRefreshing: true, error: null }
      }))
      return refreshGitStatusForWorktree({
        settings,
        worktreeId: worktree.worktreeId,
        worktreePath: worktree.path,
        connectionId: currentState.repos.find((repo) => repo.id === worktree.repoId)?.connectionId,
        deps: { setGitStatus, updateWorktreeGitIdentity, setUpstreamStatus, fetchUpstreamStatus }
      })
        .then(() => {
          if (useAppStore.getState().gitStatusByWorktree[worktree.worktreeId] === undefined) {
            setGitStatus(worktree.worktreeId, {
              conflictOperation: 'unknown',
              entries: [],
              ignoredPaths: []
            } as GitStatusResult)
          }
          setGitRefreshStateByWorktreeId((current) => ({
            ...current,
            [worktree.worktreeId]: { isRefreshing: false, error: null }
          }))
        })
        .catch((error: unknown) => {
          setGitRefreshStateByWorktreeId((current) => ({
            ...current,
            [worktree.worktreeId]: {
              isRefreshing: false,
              error: error instanceof Error ? error.message : String(error)
            }
          }))
        })
        .finally(() => inFlightGitStatusRefreshes.current.delete(worktree.worktreeId))
    },
    [fetchUpstreamStatus, setGitStatus, setUpstreamStatus, settings, updateWorktreeGitIdentity]
  )

  useEffect(() => {
    const candidates = getWorkspaceSpaceGitStatusRefreshCandidates(sourceRows)
    if (candidates.length === 0) {
      return
    }
    let cancelled = false
    let nextIndex = 0
    const runWorker = async (): Promise<void> => {
      while (!cancelled) {
        const worktree = candidates[nextIndex++]
        if (!worktree) {
          return
        }
        await refreshWorkspaceGitStatus(worktree)
      }
    }
    void Promise.all(
      Array.from({ length: Math.min(GIT_STATUS_REFRESH_CONCURRENCY, candidates.length) }, runWorker)
    )
    return () => {
      cancelled = true
    }
  }, [refreshWorkspaceGitStatus, sourceRows])

  const nextInspectedWorktreeId = resolveWorkspaceSpaceInspectedWorktreeId(
    sourceRows,
    inspectedWorktreeId
  )
  const nextSelectedIds = pruneWorkspaceSpaceSelectedIds(sourceRows, selectedIds)
  const nextTreemapZoomWorktreeId = resolveWorkspaceSpaceTreemapZoomWorktreeId(
    sourceRows,
    treemapZoomWorktreeId
  )
  if (inspectedWorktreeId !== nextInspectedWorktreeId) {
    setInspectedWorktreeId(nextInspectedWorktreeId)
  }
  if (nextSelectedIds !== selectedIds) {
    setSelectedIds(nextSelectedIds)
  }
  if (treemapZoomWorktreeId !== nextTreemapZoomWorktreeId) {
    setTreemapZoomWorktreeId(nextTreemapZoomWorktreeId)
  }

  const rows = useMemo(
    () =>
      sortWorkspaceSpaceRows(
        filterWorkspaceSpaceRows(sourceRows, query, onlyDeletable),
        sortKey,
        sortDirection
      ),
    [onlyDeletable, query, sortDirection, sortKey, sourceRows]
  )
  const isWorktreeDeleting = useCallback(
    (id: string) => deleteStateByWorktreeId[id]?.isDeleting ?? false,
    [deleteStateByWorktreeId]
  )
  const isWorktreeUnavailableForDelete = useCallback(
    (id: string) => {
      if (isWorktreeDeleting(id)) {
        return true
      }
      const worktree = sourceRows.find((row) => row.worktreeId === id)
      return (
        !worktree ||
        !isWorkspaceSpaceRowReadyToDelete(worktree, decisionDetailsByWorktreeId.get(id))
      )
    },
    [decisionDetailsByWorktreeId, isWorktreeDeleting, sourceRows]
  )
  const selectedDeletableIds = useMemo(
    () => getSelectedDeletableWorkspaceIds(rows, nextSelectedIds, isWorktreeUnavailableForDelete),
    [isWorktreeUnavailableForDelete, nextSelectedIds, rows]
  )
  const visibleDeletableIds = useMemo(
    () => getVisibleDeletableWorkspaceIds(rows, isWorktreeUnavailableForDelete),
    [isWorktreeUnavailableForDelete, rows]
  )
  const allVisibleSelected =
    visibleDeletableIds.length > 0 && visibleDeletableIds.every((id) => nextSelectedIds.has(id))
  const someVisibleSelected = visibleDeletableIds.some((id) => nextSelectedIds.has(id))

  return {
    analysis,
    progress,
    scanError,
    isScanning,
    refresh: () => void refreshWorkspaceSpace().catch(() => undefined),
    cancelScan: () => void cancelWorkspaceSpaceScan(),
    sourceRows,
    rows,
    repoMap,
    worktreeMap,
    tabsByWorktree,
    ptyIdsByTabId,
    agentStatusByPaneKey,
    migrationUnsupportedByPtyId,
    runtimePaneTitlesByTabId,
    retainedAgentsByPaneKey,
    openFiles,
    editorDrafts,
    browserTabsByWorktree,
    gitStatusByWorktree,
    remoteStatusesByWorktree,
    hostedReviewCache,
    issueCache,
    linearIssueCache,
    settings,
    activeWorktreeId,
    deleteStateByWorktreeId,
    decisionDetailsByWorktreeId,
    gitRefreshStateByWorktreeId,
    query,
    setQuery,
    onlyDeletable,
    setOnlyDeletable,
    sortKey,
    setSortKey,
    sortDirection,
    setSortDirection,
    inspectedWorktree:
      rows.find((row) => row.worktreeId === nextInspectedWorktreeId) ??
      rows.find((row) => row.status === 'ok') ??
      null,
    zoomedWorktree:
      sourceRows.find(
        (row) => row.worktreeId === nextTreemapZoomWorktreeId && row.status === 'ok'
      ) ?? null,
    setInspectedWorktreeId,
    setTreemapZoomWorktreeId,
    nextSelectedIds,
    setSelectedIds,
    selectedDeletableIds,
    selectedReclaimableBytes: rows
      .filter((row) => selectedDeletableIds.includes(row.worktreeId))
      .reduce((sum, row) => sum + row.reclaimableBytes, 0),
    visibleDeletableIds,
    allVisibleSelected,
    visibleSelectionState: allVisibleSelected
      ? true
      : someVisibleSelected
        ? ('mixed' as const)
        : false,
    maxSize: getLargestWorkspaceSpaceRowSize(rows),
    hasRows: sourceRows.length > 0,
    isInitialScan: isScanning && !analysis,
    repoErrors: analysis?.repos.filter((repo) => repo.error !== null) ?? [],
    progressLabel: getWorkspaceSpaceProgressLabel(progress)
  }
}
