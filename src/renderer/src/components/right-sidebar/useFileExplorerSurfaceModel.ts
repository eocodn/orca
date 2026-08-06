import { useCallback, useEffect, useMemo } from 'react'
import { basename } from '@/lib/path'
import { useRuntimeFileListForWorktree } from '@/components/quick-open-file-list'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import type { Repo, RightSidebarExplorerView } from '../../../../shared/types'
import { getVisibleFileExplorerWorktreePath } from './file-explorer-reset'
import { isFileExplorerNameFilterQueryTooLarge } from './file-explorer-name-filter-projection'
import { useFileExplorerManualRefresh } from './useFileExplorerManualRefresh'
import { useFileExplorerTree } from './useFileExplorerTree'
import { useFileExplorerVisibleRowProjection } from './useFileExplorerVisibleRowProjection'

type SurfaceModelParams = {
  explorerView: RightSidebarExplorerView
  rightSidebarOpen: boolean
  worktreePath: string | null
  activeWorktreeId: string | null
  activeRuntimeEnvironmentId: string | null
  activeRepo: Repo | null
  expandedDirs: Record<string, Set<string>>
  nameFilterQuery: string
  nameFilterCollapsedPaths: Set<string>
  setNameFilterCollapsedPaths: React.Dispatch<React.SetStateAction<Set<string>>>
  showDotfiles: boolean
  collapseAllDirs: (worktreeId: string) => void
  toggleShowDotfilesForWorktree: (worktreeId: string) => void
}

export function useFileExplorerSurfaceModel({
  explorerView,
  rightSidebarOpen,
  worktreePath,
  activeWorktreeId,
  activeRuntimeEnvironmentId,
  activeRepo,
  expandedDirs,
  nameFilterQuery,
  nameFilterCollapsedPaths,
  setNameFilterCollapsedPaths,
  showDotfiles,
  collapseAllDirs,
  toggleShowDotfilesForWorktree
}: SurfaceModelParams) {
  const runtimeDownloadContext = useMemo(
    () =>
      activeRuntimeEnvironmentId && activeWorktreeId && worktreePath
        ? {
            settings: { activeRuntimeEnvironmentId },
            worktreeId: activeWorktreeId,
            worktreePath,
            connectionId: activeRepo?.connectionId ?? undefined
          }
        : null,
    [activeRepo?.connectionId, activeRuntimeEnvironmentId, activeWorktreeId, worktreePath]
  )
  const isFilesViewActive = explorerView === 'files'
  const visibleFilesWorktreePath = getVisibleFileExplorerWorktreePath({
    explorerView,
    rightSidebarOpen,
    worktreePath
  })
  const repoName = activeRepo?.displayName ?? (worktreePath ? basename(worktreePath) : '')
  const activeRepoSupportsGit = activeRepo ? isGitRepoKind(activeRepo) : false
  const expanded = useMemo(
    () =>
      activeWorktreeId ? (expandedDirs[activeWorktreeId] ?? new Set<string>()) : new Set<string>(),
    [activeWorktreeId, expandedDirs]
  )
  const tree = useFileExplorerTree(worktreePath, expanded, activeWorktreeId)
  const hasNameFilterQuery = nameFilterQuery.trim().length > 0
  const nameFilterQueryTooLarge = useMemo(
    () => isFileExplorerNameFilterQueryTooLarge(nameFilterQuery),
    [nameFilterQuery]
  )
  const hasNameFilter = isFilesViewActive && hasNameFilterQuery
  useEffect(() => {
    if (!hasNameFilter) {
      setNameFilterCollapsedPaths((current) => (current.size > 0 ? new Set() : current))
    }
  }, [hasNameFilter, setNameFilterCollapsedPaths])
  const nameFilterFiles = useRuntimeFileListForWorktree({
    enabled: hasNameFilter && !nameFilterQueryTooLarge,
    worktreeId: activeWorktreeId
  })
  const nameFilterSource = useMemo(
    () =>
      hasNameFilter
        ? {
            query: nameFilterQuery,
            operationOwner: nameFilterFiles.operationOwner,
            relativePaths: nameFilterQueryTooLarge
              ? []
              : nameFilterFiles.loading && nameFilterFiles.files.length === 0
                ? null
                : nameFilterFiles.files
          }
        : null,
    [
      hasNameFilter,
      nameFilterFiles.files,
      nameFilterFiles.loading,
      nameFilterFiles.operationOwner,
      nameFilterQuery,
      nameFilterQueryTooLarge
    ]
  )
  const projection = useFileExplorerVisibleRowProjection(
    activeWorktreeId,
    visibleFilesWorktreePath,
    tree.dirCache,
    expanded,
    activeRepoSupportsGit && isFilesViewActive,
    showDotfiles,
    nameFilterSource,
    setNameFilterCollapsedPaths,
    hasNameFilter ? nameFilterCollapsedPaths : null
  )
  const rowExpandedPaths = useMemo(
    () =>
      hasNameFilter
        ? projection.nameFilterExpandedPaths
        : projection.nameFilterExpandedPaths.size > 0
          ? new Set([...expanded, ...projection.nameFilterExpandedPaths])
          : expanded,
    [expanded, hasNameFilter, projection.nameFilterExpandedPaths]
  )
  const visibleRowCount = projection.rowProjection.getVisibleCount()
  const manualRefresh = useFileExplorerManualRefresh(tree.refreshTree)
  const canCollapseAll = isFilesViewActive && !hasNameFilter && expanded.size > 0
  const handleCollapseAll = useCallback(() => {
    if (activeWorktreeId && isFilesViewActive && !hasNameFilter) {
      collapseAllDirs(activeWorktreeId)
    }
  }, [activeWorktreeId, collapseAllDirs, hasNameFilter, isFilesViewActive])
  const handleToggleDotfiles = useCallback(() => {
    if (activeWorktreeId) {
      toggleShowDotfilesForWorktree(activeWorktreeId)
    }
  }, [activeWorktreeId, toggleShowDotfilesForWorktree])

  return {
    ...tree,
    ...projection,
    runtimeDownloadContext,
    isFilesViewActive,
    visibleFilesWorktreePath,
    repoName,
    activeRepoSupportsGit,
    expanded,
    hasNameFilter,
    nameFilterFiles,
    nameFilterSource,
    rowExpandedPaths,
    visibleRowCount,
    manualRefresh,
    canCollapseAll,
    handleCollapseAll,
    handleToggleDotfiles
  }
}
