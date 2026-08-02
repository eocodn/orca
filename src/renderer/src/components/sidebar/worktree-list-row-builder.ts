import { CircleX, FolderTree, List, Pin } from 'lucide-react'
import type React from 'react'
import type {
  DetectedWorktree,
  Project,
  ProjectHostSetup,
  FolderWorkspace,
  Repo,
  ProjectGroup,
  ProjectOrderBy,
  Worktree,
  WorktreeLineage,
  WorkspaceStatusDefinition
} from '../../../../shared/types'
import { branchName } from '../../lib/git-utils'
import {
  getWorkspaceStatus,
  getWorkspaceStatusFromGroupKey,
  getWorkspaceStatusGroupKey,
  getWorkspaceStatusVisualMeta
} from './workspace-status'
import {
  ConductorDoneIcon,
  ConductorProgressIcon,
  ConductorReviewIcon
} from './workspace-status-icons'
import {
  getEffectiveProjectGroupManualRank,
  UNGROUPED_PROJECT_GROUP_KEY
} from '../../../../shared/project-groups'
import { cloneDefaultWorkspaceStatuses } from '../../../../shared/workspace-statuses'
import type { AppState } from '../../store/types'
import { getGitHubPRCacheKey, getLegacyGitHubPRCacheKey } from '../../store/slices/github-cache-key'
import { getRepoDisplayLabelKey, getRepoDisplayLabelsByPath } from '@/lib/repo-display-labels'
import { translate } from '@/i18n/i18n'
import {
  getExecutionHostLabel,
  LOCAL_EXECUTION_HOST_ID,
  getRepoExecutionHostId,
  getWorktreeExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { parseWslUncPath } from '../../../../shared/wsl-paths'
import { isWindowsAbsolutePathLike } from '../../../../shared/cross-platform-path'
import {
  getCyclicProjectedWorktreeLineageIds,
  getLineageRenderInfo
} from './worktree-lineage-projection'

import * as definitions from './worktree-list-group-definitions'
import * as rowSupport from './worktree-list-row-support'

export function buildRows(
  groupBy: definitions.WorktreeGroupBy,
  worktrees: Worktree[],
  repoMap: Map<string, Repo>,
  prCache: Record<string, unknown> | null,
  collapsedGroups: Set<string>,
  repoOrder?: Map<string, number>,
  workspaceStatuses: readonly WorkspaceStatusDefinition[] = cloneDefaultWorkspaceStatuses(),
  projectOrderBy: ProjectOrderBy = 'manual',
  lineageById: Record<string, WorktreeLineage> = {},
  worktreeMap: Map<string, Worktree> = new Map(
    worktrees.map((worktree) => [worktree.id, worktree])
  ),
  nestLineage = false,
  settings?: AppState['settings'],
  projectGroups: readonly ProjectGroup[] = [],
  placeholderRepoIds: ReadonlySet<string> = new Set(),
  importedWorktreesByRepo: ReadonlyMap<string, definitions.ImportedWorktreesCardCandidate> = new Map(),
  newExternalWorktreesInboxByRepo: ReadonlyMap<
    string,
    definitions.NewExternalWorktreesInboxCandidate
  > = new Map(),
  pendingCreations: readonly definitions.PendingCreationRef[] = [],
  projectGrouping?: definitions.ProjectGroupingModel,
  folderWorkspaces: readonly FolderWorkspace[] = [],
  hostLabelById?: ReadonlyMap<string, string>,
  defaultHostId: ExecutionHostId = LOCAL_EXECUTION_HOST_ID,
  pinnedDisplayPolicy: definitions.PinnedWorktreeDisplayPolicy = definitions.getPinnedWorktreeDisplayPolicy(settings)
): definitions.Row[] {
  const result: definitions.Row[] = []
  const projectIndex = definitions.buildProjectGroupingIndex(projectGrouping)
  const cyclicLineageIds = nestLineage
    ? getCyclicProjectedWorktreeLineageIds(lineageById, worktreeMap)
    : new Set<string>()

  const pendingByRepo = new Map<string, definitions.PendingCreationRef[]>()
  for (const creation of pendingCreations) {
    const list = pendingByRepo.get(creation.repoId) ?? []
    list.push(creation)
    pendingByRepo.set(creation.repoId, list)
  }

  // Why: non-repo groupings have no repo section to nest an in-progress create
  // under, so surface them at the very top (where the old global strip sat)
  // rather than dropping them. Repo grouping nests them under their repo below.
  if (groupBy !== 'repo' && pendingCreations.length > 0) {
    for (const creation of pendingCreations) {
      result.push(definitions.buildPendingCreationRow(creation, repoMap))
    }
  }

  const naturalWorktrees =
    pinnedDisplayPolicy === 'duplicate-in-groups'
      ? worktrees
      : worktrees.filter((worktree) => !worktree.isPinned)
  const mixedWorktreeHostContextLabels = rowSupport.getMixedWorktreeHostContextLabels(
    naturalWorktrees,
    repoMap,
    hostLabelById,
    defaultHostId
  )
  const renderedNaturalAnchorRepoIds = rowSupport.getRenderedNaturalAnchorRepoIds({
    groupBy,
    worktrees: naturalWorktrees,
    repoMap,
    prCache,
    collapsedGroups,
    workspaceStatuses,
    settings,
    projectGrouping
  })
  rowSupport.emitPinnedGroup(
    worktrees,
    repoMap,
    defaultHostId,
    collapsedGroups,
    renderedNaturalAnchorRepoIds,
    importedWorktreesByRepo,
    groupBy !== 'repo',
    result
  )
  if (groupBy === 'none') {
    if (naturalWorktrees.length > 0) {
      result.push({
        type: 'header',
        key: definitions.ALL_GROUP_KEY,
        label: definitions.ALL_GROUP_META.label,
        count: naturalWorktrees.length,
        tone: definitions.ALL_GROUP_META.tone,
        icon: definitions.ALL_GROUP_META.icon,
        hostWorktreeCounts: rowSupport.getHostWorktreeCounts(naturalWorktrees, repoMap, defaultHostId),
        hostWorktreeIds: rowSupport.getHostWorktreeIds(naturalWorktrees, repoMap, defaultHostId),
        worktreeIds: naturalWorktrees.map((worktree) => worktree.id)
      })
      if (!collapsedGroups.has(definitions.ALL_GROUP_KEY)) {
        rowSupport.appendWorktreeRows(result, naturalWorktrees, repoMap, lineageById, worktreeMap, {
          nestLineage,
          collapsedGroups,
          groupDepth: 0,
          sectionKey: definitions.ALL_GROUP_KEY,
          hostContextLabelByWorktreeId: mixedWorktreeHostContextLabels,
          cyclicLineageIds
        })
      }
    }
    return result
  }

  const grouped = new Map<string, definitions.WorktreeGroupEntry>()
  for (const w of naturalWorktrees) {
    let key: string
    let label: string
    let repo: Repo | undefined
    if (groupBy === 'repo') {
      const grouping = definitions.getProjectGroupingForRepo(w.repoId, repoMap, projectIndex)
      key = grouping.key
      label = grouping.label
      repo = grouping.repo
    } else if (groupBy === 'workspace-status') {
      const workspaceStatus = getWorkspaceStatus(w, workspaceStatuses)
      key = getWorkspaceStatusGroupKey(workspaceStatus)
      label =
        workspaceStatuses.find((status) => status.id === workspaceStatus)?.label ?? workspaceStatus
    } else {
      const prGroup = definitions.getPRGroupKey(w, repoMap, prCache, settings)
      key = `pr:${prGroup}`
      label = definitions.PR_GROUP_META[prGroup].label
    }
    if (!grouped.has(key)) {
      grouped.set(key, { label, items: [], repo, repoIds: new Set() })
    }
    const group = grouped.get(key)!
    group.items.push(w)
    definitions.addRepoIdToGroup(group, w.repoId)
  }
  if (groupBy === 'repo') {
    for (const repoId of placeholderRepoIds) {
      const grouping = definitions.getProjectGroupingForRepo(repoId, repoMap, projectIndex)
      if (!grouping.repo) {
        continue
      }
      const key = grouping.key
      if (!grouped.has(key)) {
        // Why: repos can arrive before worktree scans, but stale IDs passed by
        // older snapshots must not render an "Unknown" project header.
        grouped.set(key, {
          label: grouping.label,
          items: [],
          repo: grouping.repo,
          repoIds: new Set([repoId])
        })
      } else {
        definitions.addRepoIdToGroup(grouped.get(key)!, repoId)
      }
    }
  }
  if (groupBy === 'repo') {
    for (const [repoId, candidate] of importedWorktreesByRepo) {
      const grouping = definitions.getProjectGroupingForRepo(repoId, repoMap, projectIndex)
      const key = grouping.key
      if (!grouped.has(key)) {
        grouped.set(key, {
          label: grouping.label,
          items: [],
          repo: grouping.repo ?? candidate.repo,
          repoIds: new Set([repoId])
        })
      } else if (grouped.has(key)) {
        definitions.addRepoIdToGroup(grouped.get(key)!, repoId)
      }
    }
  }
  if (groupBy === 'repo') {
    for (const [repoId, candidate] of newExternalWorktreesInboxByRepo) {
      const grouping = definitions.getProjectGroupingForRepo(repoId, repoMap, projectIndex)
      const key = grouping.key
      if (!grouped.has(key)) {
        // Why: the default policy removes pinned worktrees from natural groups,
        // but actionable inbox rows still need a project section to render in.
        grouped.set(key, {
          label: grouping.label,
          items: [],
          repo: grouping.repo ?? candidate.repo,
          repoIds: new Set([repoId])
        })
      } else if (grouped.has(key)) {
        definitions.addRepoIdToGroup(grouped.get(key)!, repoId)
      }
    }
  }
  if (groupBy === 'repo') {
    for (const repoId of pendingByRepo.keys()) {
      const grouping = definitions.getProjectGroupingForRepo(repoId, repoMap, projectIndex)
      const key = grouping.key
      if (!grouped.has(key)) {
        // Why: creating the first worktree in a repo leaves it with no group yet;
        // ensure one so the in-progress row nests under its repo instead of being
        // dropped.
        grouped.set(key, {
          label: grouping.label,
          items: [],
          repo: grouping.repo,
          repoIds: new Set([repoId])
        })
      } else {
        definitions.addRepoIdToGroup(grouped.get(key)!, repoId)
      }
    }
  }

  const orderedGroups: definitions.OrderedGroupEntry[] = []
  if (groupBy === 'pr-status') {
    for (const prGroup of definitions.PR_GROUP_ORDER) {
      const key = `pr:${prGroup}`
      const group = grouped.get(key)
      if (group) {
        orderedGroups.push([key, group])
      }
    }
  } else if (groupBy === 'workspace-status') {
    // Why: status grouping is opt-in while the board drawer remains the wider
    // all-lanes drag target; keep the sidebar compact by omitting empty lanes.
    for (const status of workspaceStatuses) {
      const key = getWorkspaceStatusGroupKey(status.id)
      const group = grouped.get(key)
      if (group) {
        orderedGroups.push([key, group])
      }
    }
  } else {
    for (const group of grouped.values()) {
      // Why: logical project headers can contain multiple host setup repos.
      // Use the repo that anchors manual order so drag and actions target the
      // same persisted order source the row sorter reads.
      group.repo = rowSupport.getManualOrderAnchorRepo(group, repoMap, repoOrder)
    }
    // Why: project header order is its own user choice (projectOrderBy),
    // decoupled from workspace sortBy. Manual uses the canonical repoOrder so
    // header drag has a stable source of truth; Recent follows activity.
    const entries = rowSupport.sortProjectEntries(Array.from(grouped.entries()), projectOrderBy, repoOrder)
    // Why: large imported repo sets can have one group per repo; spreading
    // those entries into push can exceed V8's argument limit.
    for (const entry of entries) {
      orderedGroups.push(entry)
    }
  }

  const appendOrderedGroups = (
    groupsToAppend: definitions.OrderedGroupEntry[],
    projectGroupDepth = 0
  ): void => {
    for (const [key, group] of groupsToAppend) {
      const isCollapsed = collapsedGroups.has(key)
      const repo = group.repo
      const header =
        groupBy === 'repo'
          ? {
              type: 'header' as const,
              key,
              label: group.label,
              count: group.items.length,
              tone: definitions.PROJECT_GROUP_META.tone,
              icon: definitions.PROJECT_GROUP_META.icon,
              repo,
              projectGroupDepth
            }
          : groupBy === 'workspace-status'
            ? (() => {
                const workspaceStatus =
                  getWorkspaceStatusFromGroupKey(key, workspaceStatuses) ??
                  workspaceStatuses[0]?.id ??
                  'in-progress'
                const definition = workspaceStatuses.find((status) => status.id === workspaceStatus)
                const meta = getWorkspaceStatusVisualMeta(definition ?? workspaceStatus)
                return {
                  type: 'header' as const,
                  key,
                  label: definition?.label ?? workspaceStatus,
                  count: group.items.length,
                  tone: meta.tone,
                  icon: meta.icon,
                  hostWorktreeCounts: rowSupport.getHostWorktreeCounts(group.items, repoMap, defaultHostId),
                  hostWorktreeIds: rowSupport.getHostWorktreeIds(group.items, repoMap, defaultHostId),
                  worktreeIds: group.items.map((worktree) => worktree.id)
                }
              })()
            : (() => {
                const prGroup = key.replace(/^pr:/, '') as definitions.PRGroupKey
                const meta = definitions.PR_GROUP_META[prGroup]
                return {
                  type: 'header' as const,
                  key,
                  label: meta.label,
                  count: group.items.length,
                  tone: meta.tone,
                  icon: meta.icon,
                  hostWorktreeCounts: rowSupport.getHostWorktreeCounts(group.items, repoMap, defaultHostId),
                  hostWorktreeIds: rowSupport.getHostWorktreeIds(group.items, repoMap, defaultHostId),
                  worktreeIds: group.items.map((worktree) => worktree.id)
                }
              })()

      result.push(header)
      if (!isCollapsed) {
        if (groupBy === 'repo') {
          const repoIds =
            group.repoIds.size > 0
              ? [...group.repoIds]
              : repo
                ? [repo.id]
                : key.startsWith('repo:')
                  ? [key.slice('repo:'.length)]
                  : []
          for (const repoId of repoIds) {
            const candidate = importedWorktreesByRepo.get(repoId)
            if (candidate) {
              result.push(rowSupport.buildImportedWorktreesCardRow(candidate, 'repo-group'))
            }
          }
          for (const repoId of repoIds) {
            const candidate = newExternalWorktreesInboxByRepo.get(repoId)
            if (candidate) {
              result.push(rowSupport.buildNewExternalWorktreesInboxRow(candidate))
            }
          }
          // Why: surface in-progress creates at the top of their own repo so the
          // new workspace appears where it will land, not flashed to the very top
          // of the sidebar.
          for (const repoId of repoIds) {
            for (const creation of pendingByRepo.get(repoId) ?? []) {
              result.push(definitions.buildPendingCreationRow(creation, repoMap))
            }
          }
        }
        const items = groupBy === 'repo' ? rowSupport.orderMainWorktreeFirst(group.items) : group.items
        const hostContextLabelByRepoId =
          groupBy === 'repo'
            ? rowSupport.getMixedHostContextLabels(group, repoMap, projectIndex, hostLabelById)
            : undefined
        const hostContextLabelByWorktreeId =
          groupBy === 'repo' ? undefined : mixedWorktreeHostContextLabels
        if (groupBy === 'repo') {
          rowSupport.appendWorktreeRows(result, items, repoMap, lineageById, worktreeMap, {
            nestLineage,
            collapsedGroups,
            groupDepth: projectGroupDepth,
            sectionKey: key,
            hostContextLabelByRepoId,
            hostContextLabelByWorktreeId,
            cyclicLineageIds
          })
        } else {
          rowSupport.appendWorktreeRows(result, items, repoMap, lineageById, worktreeMap, {
            nestLineage,
            collapsedGroups,
            groupDepth: projectGroupDepth,
            sectionKey: key,
            hostContextLabelByRepoId,
            hostContextLabelByWorktreeId,
            cyclicLineageIds
          })
        }
      }
    }
  }

  if (groupBy !== 'repo' || projectGroups.length === 0) {
    appendOrderedGroups(
      groupBy === 'repo' ? rowSupport.withRepoSectionDisplayLabels(orderedGroups) : orderedGroups
    )
    return result
  }

  const groupByProjectGroupId = new Map<string | null, definitions.OrderedGroupEntry[]>()
  for (const entry of orderedGroups) {
    const repo = entry[1].repo
    const projectGroupId = repo?.projectGroupId ?? null
    const list = groupByProjectGroupId.get(projectGroupId) ?? []
    list.push(entry)
    groupByProjectGroupId.set(projectGroupId, list)
  }

  const sortRepoEntriesWithinGroup = (entries: definitions.OrderedGroupEntry[]): definitions.OrderedGroupEntry[] => {
    if (projectOrderBy === 'recent') {
      return [...entries].sort((left, right) =>
        rowSupport.compareRecentRank(rowSupport.recentRankForEntry(left), rowSupport.recentRankForEntry(right))
      )
    }
    // Manual: within a Project Group, projects order by their per-group rank
    // (projectGroupOrder), falling back to global repoOrder when unset so drag
    // midpoint commits and the rendered order stay aligned.
    return [...entries].sort((left, right) => {
      const leftRank = getEffectiveProjectGroupManualRank(left[1].repo, repoOrder)
      const rightRank = getEffectiveProjectGroupManualRank(right[1].repo, repoOrder)
      return leftRank - rightRank
    })
  }

  const projectGroupsById = new Map(projectGroups.map((group) => [group.id, group]))
  const folderWorkspacesByProjectGroupId = new Map<string, FolderWorkspace[]>()
  for (const workspace of folderWorkspaces) {
    const group = projectGroupsById.get(workspace.projectGroupId)
    if (!group?.parentPath) {
      continue
    }
    const list = folderWorkspacesByProjectGroupId.get(workspace.projectGroupId) ?? []
    list.push(workspace)
    folderWorkspacesByProjectGroupId.set(workspace.projectGroupId, list)
  }
  for (const list of folderWorkspacesByProjectGroupId.values()) {
    list.sort((left, right) => {
      const leftOrder = left.manualOrder ?? left.sortOrder
      const rightOrder = right.manualOrder ?? right.sortOrder
      return rightOrder - leftOrder || left.name.localeCompare(right.name)
    })
  }
  const childGroupsByParentId = new Map<string | null, ProjectGroup[]>()
  for (const group of projectGroups) {
    const parentId =
      group.parentGroupId && projectGroupsById.has(group.parentGroupId) ? group.parentGroupId : null
    const children = childGroupsByParentId.get(parentId) ?? []
    children.push(group)
    childGroupsByParentId.set(parentId, children)
  }
  for (const groups of childGroupsByParentId.values()) {
    groups.sort(
      (left, right) => left.tabOrder - right.tabOrder || left.name.localeCompare(right.name)
    )
  }

  const getProjectGroupSubtreeCount = (groupId: string): number => {
    const directCount = groupByProjectGroupId.get(groupId)?.length ?? 0
    const folderWorkspaceCount = folderWorkspacesByProjectGroupId.get(groupId)?.length ?? 0
    const children = childGroupsByParentId.get(groupId) ?? []
    return children.reduce(
      (count, child) => count + getProjectGroupSubtreeCount(child.id),
      directCount + folderWorkspaceCount
    )
  }

  const appendProjectGroup = (projectGroup: ProjectGroup, depth: number): void => {
    const repoEntries = sortRepoEntriesWithinGroup(groupByProjectGroupId.get(projectGroup.id) ?? [])
    const childGroups = childGroupsByParentId.get(projectGroup.id) ?? []
    const key = definitions.getProjectGroupHeaderKey(projectGroup.id)
    result.push({
      type: 'header',
      key,
      label: projectGroup.name,
      count: getProjectGroupSubtreeCount(projectGroup.id),
      tone: definitions.PROJECT_GROUP_META.tone,
      icon: definitions.PROJECT_GROUP_META.icon,
      projectGroup,
      projectGroupDepth: depth
    })
    if (!collapsedGroups.has(key)) {
      for (const folderWorkspace of folderWorkspacesByProjectGroupId.get(projectGroup.id) ?? []) {
        result.push({
          type: 'folder-workspace',
          key: `folder-workspace:${folderWorkspace.id}`,
          folderWorkspace,
          projectGroup,
          depth: 0,
          groupDepth: depth + 1
        })
      }
      appendOrderedGroups(rowSupport.withRepoSectionDisplayLabels(repoEntries), depth + 1)
      for (const childGroup of childGroups) {
        appendProjectGroup(childGroup, depth + 1)
      }
    }
    groupByProjectGroupId.delete(projectGroup.id)
  }

  for (const projectGroup of childGroupsByParentId.get(null) ?? []) {
    appendProjectGroup(projectGroup, 0)
  }

  const remainingRepoEntries = [...(groupByProjectGroupId.get(null) ?? [])]
  for (const [projectGroupId, entries] of groupByProjectGroupId) {
    if (projectGroupId === null || projectGroupsById.has(projectGroupId)) {
      continue
    }
    // Why: startup can have repos from hosts whose project-group metadata was
    // not fetched yet; missing metadata must not make those repos disappear.
    remainingRepoEntries.push(...entries)
  }
  appendOrderedGroups(
    rowSupport.withRepoSectionDisplayLabels(sortRepoEntriesWithinGroup(remainingRepoEntries)),
    0
  )

  return result
}
