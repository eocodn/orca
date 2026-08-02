// Concrete surface implementation for WorkspaceSpaceManagerPanel.tsx
   breakdown, and table pieces share one scan state and should evolve as one resource-manager surface. */
/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: the relative time clock advances from a wall-clock interval, which is an external timer rather than render-derived state. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  Circle,
  ExternalLink,
  FileWarning,
  GitBranch,
  GitPullRequest,
  HardDrive,
  Loader2,
  Minus,
  RefreshCw,
  Search,
  Server,
  Terminal,
  Trash2,
  ZoomIn,
  ZoomOut,
  X
} from 'lucide-react'
import type {
  AgentStatusEntry,
  MigrationUnsupportedPtyEntry
} from '../../../../shared/agent-status-types'
import type { GitStatusResult, Repo, TerminalTab, Worktree } from '../../../../shared/types'
import type {
  WorkspaceSpaceItem,
  WorkspaceSpaceWorktree
} from '../../../../shared/workspace-space-types'
import { cn } from '@/lib/utils'
import { installWindowVisibilityInterval } from '@/lib/window-visibility-interval'
import { toast } from 'sonner'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { useAppStore } from '../../store'
import { getRepoMapFromState, getWorktreeMapFromState } from '../../store/selectors'
import { getHostedReviewCacheKey } from '../../store/slices/hosted-review'
import { issueCacheKey as getIssueCacheKey } from '../../store/slices/github'
import { refreshGitStatusForWorktree } from '../right-sidebar/git-status-refresh'
import { runWorktreeBatchDelete } from '../sidebar/delete-worktree-flow'
import { prepareActiveWorktreeFocusAfterDelete } from '../sidebar/active-worktree-focus-after-delete'
import { branchDisplayName } from '../sidebar/WorktreeCardHelpers'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '../ui/context-menu'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../ui/hover-card'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import {
  formatBytes,
  formatCompactCount,
  getWorkspaceSpaceBranchLabel,
  getWorkspaceSpaceProgressLabel,
  getWorkspaceSpaceScanDateTimeLabel,
  getWorkspaceSpaceScanTimeLabel,
  getWorkspaceSpaceStatusLabel
} from './workspace-space-format'
import { buildTreemapLayout, type TreemapRect } from './workspace-space-layout'
import {
  filterWorkspaceSpaceRows,
  countWorkspaceSpaceActiveAgents,
  getLargestWorkspaceSpaceItemSize,
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
import { translate } from '@/i18n/i18n'
import type { WorktreeForceDeleteReason } from '../../../../shared/worktree-removal'

const TREEMAP_FILLS = [
  'color-mix(in srgb, var(--chart-2) 34%, var(--card))',
  'color-mix(in srgb, var(--foreground) 20%, var(--card))',
  'color-mix(in srgb, var(--chart-4) 28%, var(--card))',
  'color-mix(in srgb, var(--primary) 24%, var(--card))',
  'color-mix(in srgb, var(--chart-1) 38%, var(--card))'
]
const GIT_STATUS_REFRESH_CONCURRENCY = 6

type WorkspaceSpaceDeleteState = {
  isDeleting: boolean
  error: string | null
  canForceDelete: boolean
  forceDeleteReason: WorktreeForceDeleteReason | null
}

type WorkspaceGitRefreshState = {
  isRefreshing: boolean
  error: string | null
}

export { getWorkspaceDecisionDetails } from './workspace-space-manager-decision-model'
export type { WorkspaceDecisionDetails } from './workspace-space-manager-decision-model'
import { getWorkspaceDecisionDetails } from './workspace-space-manager-decision-model'
import type { WorkspaceDecisionDetails } from './workspace-space-manager-decision-model'
import {
  BreakdownList,
  BreakdownRow,
  CheckButton,
  DecisionLine,
  Metric,
  SizeBar,
  SortIndicator,
  StatusBadge,
  UpdatedMetric,
  WorkspaceDecisionHoverCard,
  WorkspaceRow,
  WorkspaceTreemap
} from './workspace-space-manager-rows'
import { WorkspaceSpaceManagerView } from './workspace-space-manager-view'
export function WorkspaceSpaceManagerPanel(): React.JSX.Element {
  const analysis = useAppStore((state) => state.workspaceSpaceAnalysis)
  const progress = useAppStore((state) => state.workspaceSpaceScanProgress)
  const scanError = useAppStore((state) => state.workspaceSpaceScanError)
  const isScanning = useAppStore((state) => state.workspaceSpaceScanning)
  const refreshWorkspaceSpace = useAppStore((state) => state.refreshWorkspaceSpace)
  const cancelWorkspaceSpaceScan = useAppStore((state) => state.cancelWorkspaceSpaceScan)
  const removeWorkspaceSpaceWorktrees = useAppStore((state) => state.removeWorkspaceSpaceWorktrees)
  const removeWorktree = useAppStore((state) => state.removeWorktree)
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
  const inFlightGitStatusRefreshes = useRef<Set<string>>(new Set())

  const refresh = useCallback((): void => {
    void refreshWorkspaceSpace().catch(() => {
      /* scanError is stored by the slice */
    })
  }, [refreshWorkspaceSpace])

  const cancelScan = useCallback((): void => {
    void cancelWorkspaceSpaceScan()
  }, [cancelWorkspaceSpaceScan])

  const sourceRows = useMemo(() => analysis?.worktrees ?? [], [analysis?.worktrees])
  const decisionDetailsByWorktreeId = useMemo(() => {
    // Why: active-agent freshness is time-based. The epoch bumps when fresh
    // hook entries cross the stale boundary so delete readiness recomputes.
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
    agentStatusEpoch,
    agentStatusByPaneKey,
    browserTabsByWorktree,
    editorDrafts,
    gitStatusByWorktree,
    hostedReviewCache,
    issueCache,
    linearIssueCache,
    openFiles,
    ptyIdsByTabId,
    repoMap,
    remoteStatusesByWorktree,
    retainedAgentsByPaneKey,
    migrationUnsupportedByPtyId,
    runtimePaneTitlesByTabId,
    settings,
    sourceRows,
    tabsByWorktree,
    worktreeMap
  ])
  const isWorktreeDeleting = useCallback(
    (worktreeId: string): boolean => deleteStateByWorktreeId[worktreeId]?.isDeleting ?? false,
    [deleteStateByWorktreeId]
  )
  const refreshWorkspaceGitStatus = useCallback(
    (worktree: WorkspaceSpaceWorktree): Promise<void> => {
      const currentState = useAppStore.getState()
      if (currentState.gitStatusByWorktree[worktree.worktreeId] !== undefined) {
        return Promise.resolve()
      }
      if (inFlightGitStatusRefreshes.current.has(worktree.worktreeId)) {
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
        connectionId:
          currentState.repos.find((repo) => repo.id === worktree.repoId)?.connectionId ?? undefined,
        deps: {
          setGitStatus,
          updateWorktreeGitIdentity,
          setUpstreamStatus,
          fetchUpstreamStatus
        }
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
        .finally(() => {
          inFlightGitStatusRefreshes.current.delete(worktree.worktreeId)
        })
    },
    [fetchUpstreamStatus, setGitStatus, setUpstreamStatus, settings, updateWorktreeGitIdentity]
  )
  const isWorktreeUnavailableForDelete = useCallback(
    (worktreeId: string): boolean => {
      if (isWorktreeDeleting(worktreeId)) {
        return true
      }
      const worktree = sourceRows.find((row) => row.worktreeId === worktreeId)
      return (
        !worktree ||
        !isWorkspaceSpaceRowReadyToDelete(worktree, decisionDetailsByWorktreeId.get(worktreeId))
      )
    },
    [decisionDetailsByWorktreeId, isWorktreeDeleting, sourceRows]
  )

  const rows = useMemo(
    () =>
      sortWorkspaceSpaceRows(
        filterWorkspaceSpaceRows(sourceRows, query, onlyDeletable),
        sortKey,
        sortDirection
      ),
    [onlyDeletable, query, sortDirection, sortKey, sourceRows]
  )

  const nextInspectedWorktreeId = resolveWorkspaceSpaceInspectedWorktreeId(
    sourceRows,
    inspectedWorktreeId
  )
  const nextSelectedIds = pruneWorkspaceSpaceSelectedIds(sourceRows, selectedIds)
  const nextTreemapZoomWorktreeId = resolveWorkspaceSpaceTreemapZoomWorktreeId(
    sourceRows,
    treemapZoomWorktreeId
  )
  // Why: these ids are local UI state derived from the latest scan rows. Repair
  // them before commit so stale selections cannot flash after a scan changes.
  if (inspectedWorktreeId !== nextInspectedWorktreeId) {
    setInspectedWorktreeId(nextInspectedWorktreeId)
  }
  if (nextSelectedIds !== selectedIds) {
    setSelectedIds(nextSelectedIds)
  }
  if (treemapZoomWorktreeId !== nextTreemapZoomWorktreeId) {
    setTreemapZoomWorktreeId(nextTreemapZoomWorktreeId)
  }

  useEffect(() => {
    const candidates = getWorkspaceSpaceGitStatusRefreshCandidates(sourceRows)
    if (candidates.length === 0) {
      return
    }

    let cancelled = false
    let nextIndex = 0
    const runWorker = async (): Promise<void> => {
      while (!cancelled) {
        const worktree = candidates[nextIndex]
        nextIndex += 1
        if (!worktree) {
          return
        }
        await refreshWorkspaceGitStatus(worktree)
      }
    }
    const workerCount = Math.min(GIT_STATUS_REFRESH_CONCURRENCY, candidates.length)
    void Promise.all(Array.from({ length: workerCount }, () => runWorker()))

    return () => {
      cancelled = true
    }
  }, [refreshWorkspaceGitStatus, sourceRows])

  const inspectedWorktree =
    rows.find((row) => row.worktreeId === nextInspectedWorktreeId) ??
    rows.find((row) => row.status === 'ok') ??
    null
  const zoomedWorktree =
    sourceRows.find((row) => row.worktreeId === nextTreemapZoomWorktreeId && row.status === 'ok') ??
    null
  const maxSize = getLargestWorkspaceSpaceRowSize(rows)
  const selectedDeletableIds = useMemo(
    () => getSelectedDeletableWorkspaceIds(rows, nextSelectedIds, isWorktreeUnavailableForDelete),
    [isWorktreeUnavailableForDelete, nextSelectedIds, rows]
  )
  const selectedDeletableIdSet = useMemo(
    () => new Set(selectedDeletableIds),
    [selectedDeletableIds]
  )
  const visibleDeletableIds = useMemo(
    () => getVisibleDeletableWorkspaceIds(rows, isWorktreeUnavailableForDelete),
    [isWorktreeUnavailableForDelete, rows]
  )
  const allVisibleSelected =
    visibleDeletableIds.length > 0 && visibleDeletableIds.every((id) => nextSelectedIds.has(id))
  const someVisibleSelected = visibleDeletableIds.some((id) => nextSelectedIds.has(id))
  const visibleSelectionState = allVisibleSelected ? true : someVisibleSelected ? 'mixed' : false
  const isInitialScan = isScanning && !analysis
  const hasRows = sourceRows.length > 0
  const progressLabel = getWorkspaceSpaceProgressLabel(progress)
  const repoErrors = analysis?.repos.filter((repo) => repo.error !== null) ?? []
  const selectedReclaimableBytes = useMemo(
    () =>
      rows
        .filter((row) => selectedDeletableIdSet.has(row.worktreeId))
        .reduce((sum, row) => sum + row.reclaimableBytes, 0),
    [rows, selectedDeletableIdSet]
  )

  const toggleSort = (key: WorkspaceSpaceSortKey): void => {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDirection(key === 'name' || key === 'repo' ? 'asc' : 'desc')
  }

  const selectSortKey = (key: WorkspaceSpaceSortKey): void => {
    setSortKey(key)
    setSortDirection(key === 'name' || key === 'repo' ? 'asc' : 'desc')
  }

  const toggleSelection = (worktreeId: string): void => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(worktreeId)) {
        next.delete(worktreeId)
      } else {
        next.add(worktreeId)
      }
      return next
    })
  }

  const toggleVisibleSelection = (): void => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allVisibleSelected) {
        for (const id of visibleDeletableIds) {
          next.delete(id)
        }
      } else {
        for (const id of visibleDeletableIds) {
          next.add(id)
        }
      }
      return next
    })
  }

  const handleDeletedWorktrees = useCallback(
    (deletedIds: readonly string[]): void => {
      if (deletedIds.length === 0) {
        return
      }
      removeWorkspaceSpaceWorktrees(deletedIds)
      setInspectedWorktreeId((current) =>
        current && deletedIds.includes(current) ? null : current
      )
      setTreemapZoomWorktreeId((current) =>
        current && deletedIds.includes(current) ? null : current
      )
      setSelectedIds((current) => {
        const next = new Set(current)
        for (const id of deletedIds) {
          next.delete(id)
        }
        return next
      })
      toast.success(
        deletedIds.length === 1
          ? translate(
              'auto.components.status.bar.WorkspaceSpaceManagerPanel.9afc97f9a3',
              'Workspace deleted'
            )
          : translate(
              'auto.components.status.bar.WorkspaceSpaceManagerPanel.eee5240810',
              'Workspaces deleted'
            ),
        {
          description: translate(
            'auto.components.status.bar.WorkspaceSpaceManagerPanel.63efebe0e6',
            '{{value0}} {{value1}} removed from Space.',
            {
              value0: deletedIds.length,
              value1: deletedIds.length === 1 ? 'workspace' : 'workspaces'
            }
          )
        }
      )
    },
    [removeWorkspaceSpaceWorktrees]
  )

  const deleteWorktrees = useCallback(
    (worktreeIds: readonly string[]): void => {
      if (worktreeIds.length === 0) {
        return
      }
      runWorktreeBatchDelete(worktreeIds, {
        forceConfirm: true,
        onDeleted: handleDeletedWorktrees
      })
    },
    [handleDeletedWorktrees]
  )

  const forceDeleteWorktree = useCallback(
    (worktree: WorkspaceSpaceWorktree): void => {
      // Why: Space keeps normal deletes non-force so uncommitted work is not
      // discarded silently; a failed row gets this explicit recovery path.
      const commitFocus = prepareActiveWorktreeFocusAfterDelete(worktree.worktreeId)
      void removeWorktree(worktree.worktreeId, true)
        .then((result) => {
          if (!result.ok) {
            toast.error(
              translate(
                'auto.components.status.bar.WorkspaceSpaceManagerPanel.2965415393',
                'Force delete failed'
              ),
              {
                description: result.error
              }
            )
            return
          }
          commitFocus()
          handleDeletedWorktrees([worktree.worktreeId])
        })
        .catch((error: unknown) => {
          toast.error(
            translate(
              'auto.components.status.bar.WorkspaceSpaceManagerPanel.2965415393',
              'Force delete failed'
            ),
            {
              description: error instanceof Error ? error.message : String(error)
            }
          )
        })
    },
    [handleDeletedWorktrees, removeWorktree]
  )

  const deleteSelected = (): void => {
    if (selectedDeletableIds.length === 0) {
      return
    }
    deleteWorktrees(selectedDeletableIds)
  }

  return <WorkspaceSpaceManagerView {...{
    analysis, isScanning, progressLabel, progress, cancelScan, refresh, scanError, repoErrors,
    hasRows, isInitialScan, sourceRows, inspectedWorktree, zoomedWorktree, setInspectedWorktreeId,
    setTreemapZoomWorktreeId, selectedDeletableIds, selectedReclaimableBytes, setSelectedIds,
    deleteSelected, query, setQuery, sortKey, selectSortKey, onlyDeletable, setOnlyDeletable,
    toggleVisibleSelection, visibleDeletableIds, allVisibleSelected, visibleSelectionState,
    toggleSort, sortDirection, rows, maxSize, nextSelectedIds, decisionDetailsByWorktreeId,
    repoMap, worktreeMap, tabsByWorktree, ptyIdsByTabId, agentStatusByPaneKey,
    migrationUnsupportedByPtyId, runtimePaneTitlesByTabId, retainedAgentsByPaneKey, openFiles,
    editorDrafts, browserTabsByWorktree, gitStatusByWorktree, remoteStatusesByWorktree,
    hostedReviewCache, issueCache, linearIssueCache, settings, activeWorktreeId,
    gitRefreshStateByWorktreeId, deleteStateByWorktreeId, toggleSelection,
    activateAndRevealWorktree, deleteWorktrees, forceDeleteWorktree
  } />
}
