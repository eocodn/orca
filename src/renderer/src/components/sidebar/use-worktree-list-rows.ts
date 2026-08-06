import { useMemo } from 'react'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import type { Worktree } from '../../../../shared/types'
import { addHostSectionRows, type HostSectionRow } from './host-section-rows'
import { orderHostSectionOptions } from './host-section-order'
import {
  buildRows,
  type Row,
  type WorktreeGroupBy,
  type ProjectGroupingModel
} from './worktree-list-groups'
import type { SidebarHostOption } from './sidebar-host-options'
import type { WorktreeListRowInputs } from './use-worktree-list-row-inputs'
import type { WorktreeListSource } from './use-worktree-list-source'

type WorktreeListRowsArgs = {
  groupBy: WorktreeGroupBy
  worktrees: readonly Worktree[]
  repoMap: WorktreeListSource['repoMap']
  prCache: WorktreeListSource['prCache']
  effectiveCollapsedGroups: ReadonlySet<string>
  workspaceStatuses: WorktreeListSource['workspaceStatuses']
  projectOrderBy: WorktreeListSource['projectOrderBy']
  worktreeLineageById: WorktreeListSource['worktreeLineageById']
  worktreeMap: WorktreeListSource['worktreeMap']
  settings: WorktreeListSource['settings']
  projectGrouping: ProjectGroupingModel
  pinnedDisplayPolicy: WorktreeListSource['pinnedDisplayPolicy']
  workspaceHostOrder: WorktreeListSource['workspaceHostOrder']
  workspaceHostScope: WorktreeListSource['workspaceHostScope']
  visibleWorkspaceHostIds: WorktreeListSource['visibleWorkspaceHostIds']
  hostDragActive: boolean
  rowInputs: WorktreeListRowInputs
}

export type WorktreeListRows = {
  rows: Row[]
  sectionRows: HostSectionRow[]
  orderedHostOptions: readonly SidebarHostOption[]
  renderedSidebarRowKeys: ReadonlySet<string>
}

export function useWorktreeListRows({
  groupBy,
  worktrees,
  repoMap,
  prCache,
  effectiveCollapsedGroups,
  workspaceStatuses,
  projectOrderBy,
  worktreeLineageById,
  worktreeMap,
  settings,
  projectGrouping,
  pinnedDisplayPolicy,
  workspaceHostOrder,
  workspaceHostScope,
  visibleWorkspaceHostIds,
  hostDragActive,
  rowInputs
}: WorktreeListRowsArgs): WorktreeListRows {
  const rows = useMemo(
    () =>
      buildRows(
        groupBy,
        worktrees,
        repoMap,
        prCache,
        effectiveCollapsedGroups,
        rowInputs.repoOrder,
        workspaceStatuses,
        projectOrderBy,
        worktreeLineageById,
        worktreeMap,
        true,
        settings,
        rowInputs.visibleProjectGroupsForRows,
        rowInputs.placeholderRepoIds,
        rowInputs.importedWorktreesByRepo,
        rowInputs.newExternalWorktreesInboxByRepo,
        rowInputs.pendingCreations,
        projectGrouping,
        rowInputs.visibleFolderWorkspacesForRows,
        rowInputs.hostLabelById,
        rowInputs.defaultHostId,
        pinnedDisplayPolicy
      ),
    [
      effectiveCollapsedGroups,
      groupBy,
      pinnedDisplayPolicy,
      prCache,
      projectGrouping,
      projectOrderBy,
      repoMap,
      rowInputs.hostLabelById,
      rowInputs.importedWorktreesByRepo,
      rowInputs.newExternalWorktreesInboxByRepo,
      rowInputs.pendingCreations,
      rowInputs.placeholderRepoIds,
      rowInputs.repoOrder,
      rowInputs.defaultHostId,
      rowInputs.visibleFolderWorkspacesForRows,
      rowInputs.visibleProjectGroupsForRows,
      settings,
      worktreeLineageById,
      worktreeMap,
      worktrees,
      workspaceStatuses
    ]
  )
  const orderedHostOptions = useMemo(
    () => orderHostSectionOptions(rowInputs.hostOptions, workspaceHostOrder),
    [rowInputs.hostOptions, workspaceHostOrder]
  )
  const sectionRows = useMemo(
    () =>
      addHostSectionRows({
        rows,
        hostOptions: orderedHostOptions,
        workspaceHostScope,
        visibleWorkspaceHostIds,
        defaultHostId: rowInputs.defaultHostId,
        collapsedHostKeys: effectiveCollapsedGroups,
        forceCollapseHosts: hostDragActive,
        preferProjectGrouping: true
      }),
    [
      effectiveCollapsedGroups,
      hostDragActive,
      orderedHostOptions,
      rowInputs.defaultHostId,
      rows,
      visibleWorkspaceHostIds,
      workspaceHostScope
    ]
  )
  const renderedSidebarRowKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const row of sectionRows) {
      if (row.type === 'header') {
        keys.add(row.key)
      } else if (row.type === 'item') {
        keys.add(row.rowKey)
      } else if (row.type === 'folder-workspace') {
        keys.add(folderWorkspaceKey(row.folderWorkspace.id))
      } else if (row.type === 'pending-creation') {
        keys.add(`pending:${row.creationId}`)
      } else if (
        row.type === 'imported-worktrees-card' ||
        row.type === 'new-external-worktrees-inbox'
      ) {
        keys.add(row.key)
      }
    }
    return keys
  }, [sectionRows])
  return { rows, sectionRows, orderedHostOptions, renderedSidebarRowKeys }
}
