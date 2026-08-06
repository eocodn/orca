import { useCallback, useEffect, useMemo } from 'react'
import type React from 'react'
import type { Repo, ProjectGroup, ProjectOrderBy } from '../../../../shared/types'
import type { HostSectionRow, HostHeaderRow } from './host-section-rows'
import type { Row } from './worktree-list-groups'
import { getSidebarOrderedRepoHeaderIdsByBucket } from './project-header-drop'
import { getSidebarOrderedProjectGroupHeaderIdsByBucket } from './project-group-header-drop'
import { useHostHeaderDrag } from './host-header-drag'
import { useRepoHeaderDrag } from './project-header-drag'
import { useProjectGroupHeaderDrag } from './project-group-header-drag'
import type { ExecutionHostId } from '../../../../shared/execution-host'

export type WorktreeListHeaderDragArgs = {
  rows: readonly HostSectionRow[]
  projectGroups: readonly ProjectGroup[]
  allRepoIds: readonly string[]
  repoMap: Map<string, Repo>
  groupBy: string
  projectOrderBy: ProjectOrderBy
  onReorderHostSections: (orderedHostIds: ExecutionHostId[]) => void
  onHostDragActiveChange: (active: boolean) => void
  reorderRepos: (orderedIds: string[]) => void
  moveProjectToGroup: (
    repoId: string,
    projectGroupId: string | null,
    order?: number
  ) => Promise<unknown> | void
  updateProjectGroup: (groupId: string, patch: { tabOrder: number }) => Promise<unknown> | void
  scrollRef: React.RefObject<HTMLDivElement | null>
  suppressMeasurementAdjustmentUntilRef: React.MutableRefObject<number>
  directScrollInputUntilRef: React.MutableRefObject<number>
}

export function useWorktreeListHeaderDrag(args: WorktreeListHeaderDragArgs) {
  const {
    rows,
    projectGroups,
    allRepoIds,
    repoMap,
    groupBy,
    projectOrderBy,
    onReorderHostSections,
    onHostDragActiveChange,
    reorderRepos,
    moveProjectToGroup,
    updateProjectGroup,
    scrollRef,
    suppressMeasurementAdjustmentUntilRef,
    directScrollInputUntilRef
  } = args
  const hasProjectGroups = projectGroups.length > 0
  const canReorderRepoHeaders = groupBy === 'repo' && projectOrderBy === 'manual'
  const canReorderProjectGroupHeaders = groupBy === 'repo' && hasProjectGroups
  const orderedHostIds = useMemo(
    () =>
      rows
        .filter((row): row is HostHeaderRow => row.type === 'host-header')
        .map((row) => row.hostId),
    [rows]
  )
  const hostDrag = useHostHeaderDrag({
    orderedHostIds,
    onCommit: onReorderHostSections,
    getScrollContainer: () => scrollRef.current
  })
  useEffect(() => {
    onHostDragActiveChange(hostDrag.state.draggingHostId !== null)
  }, [hostDrag.state.draggingHostId, onHostDragActiveChange])
  useEffect(() => () => onHostDragActiveChange(false), [onHostDragActiveChange])

  const projectGroupById = useMemo(
    () => new Map(projectGroups.map((group) => [group.id, group])),
    [projectGroups]
  )
  const sidebarRepoHeaderIdsByBucket = useMemo(
    () =>
      getSidebarOrderedRepoHeaderIdsByBucket(
        rows.filter((row): row is Row => row.type !== 'host-header')
      ),
    [rows]
  )
  const sidebarProjectGroupHeaderIdsByBucket = useMemo(
    () =>
      getSidebarOrderedProjectGroupHeaderIdsByBucket(
        rows.filter((row): row is Row => row.type !== 'host-header'),
        projectGroupById
      ),
    [projectGroupById, rows]
  )
  const repoHeaderIndexByRepoId = useMemo(() => {
    const map = new Map<string, number>()
    for (const repoIds of sidebarRepoHeaderIdsByBucket.values()) {
      repoIds.forEach((repoId, index) => map.set(repoId, index))
    }
    return map
  }, [sidebarRepoHeaderIdsByBucket])
  const repoHeaderBucketByRepoId = useMemo(() => {
    const map = new Map<string, string>()
    for (const [bucket, repoIds] of sidebarRepoHeaderIdsByBucket) {
      for (const repoId of repoIds) {
        map.set(repoId, bucket)
      }
    }
    return map
  }, [sidebarRepoHeaderIdsByBucket])
  const projectGroupHeaderIndexByGroupId = useMemo(() => {
    const map = new Map<string, number>()
    for (const groupIds of sidebarProjectGroupHeaderIdsByBucket.values()) {
      groupIds.forEach((groupId, index) => map.set(groupId, index))
    }
    return map
  }, [sidebarProjectGroupHeaderIdsByBucket])
  const projectGroupHeaderBucketByGroupId = useMemo(() => {
    const map = new Map<string, string>()
    for (const [bucket, groupIds] of sidebarProjectGroupHeaderIdsByBucket) {
      for (const groupId of groupIds) {
        map.set(groupId, bucket)
      }
    }
    return map
  }, [sidebarProjectGroupHeaderIdsByBucket])
  const commitRepoReorder = useCallback(
    (orderedIds: string[]) => {
      const suppressUntil = window.performance.now() + 500
      suppressMeasurementAdjustmentUntilRef.current = suppressUntil
      directScrollInputUntilRef.current = suppressUntil
      reorderRepos(orderedIds)
    },
    [directScrollInputUntilRef, reorderRepos, suppressMeasurementAdjustmentUntilRef]
  )
  const commitProjectGroupOrder = useCallback(
    (repoId: string, projectGroupId: string | null, order: number) => {
      void moveProjectToGroup(repoId, projectGroupId, order)
    },
    [moveProjectToGroup]
  )
  const commitProjectGroupHeaderOrder = useCallback(
    (groupId: string, tabOrder: number) => {
      if (!Number.isFinite(tabOrder)) {
        return
      }
      const suppressUntil = window.performance.now() + 500
      suppressMeasurementAdjustmentUntilRef.current = suppressUntil
      directScrollInputUntilRef.current = suppressUntil
      void updateProjectGroup(groupId, { tabOrder })
    },
    [directScrollInputUntilRef, suppressMeasurementAdjustmentUntilRef, updateProjectGroup]
  )
  const repoDrag = useRepoHeaderDrag({
    orderedRepoIds: [...allRepoIds],
    sidebarRepoHeaderIdsByBucket,
    repoById: repoMap,
    usesProjectGroupOrdering: hasProjectGroups,
    onCommitRepoOrder: commitRepoReorder,
    onCommitProjectGroupOrder: commitProjectGroupOrder,
    getScrollContainer: () => scrollRef.current
  })
  const projectGroupDrag = useProjectGroupHeaderDrag({
    sidebarProjectGroupHeaderIdsByBucket,
    projectGroupById,
    onCommitProjectGroupTabOrder: commitProjectGroupHeaderOrder,
    getScrollContainer: () => scrollRef.current
  })
  return {
    canReorderRepoHeaders,
    canReorderProjectGroupHeaders,
    orderedHostIds,
    hostDrag,
    sidebarRepoHeaderIdsByBucket,
    sidebarProjectGroupHeaderIdsByBucket,
    repoHeaderIndexByRepoId,
    repoHeaderBucketByRepoId,
    projectGroupHeaderIndexByGroupId,
    projectGroupHeaderBucketByGroupId,
    repoDrag,
    projectGroupDrag
  }
}
