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

export function emitPinnedGroup(
  worktrees: Worktree[],
  repoMap: Map<string, Repo>,
  defaultHostId: ExecutionHostId,
  collapsedGroups: Set<string>,
  renderedNaturalAnchorRepoIds: ReadonlySet<string>,
  importedWorktreesByRepo: ReadonlyMap<string, definitions.ImportedWorktreesCardCandidate>,
  allowImportedFallback: boolean,
  result: definitions.Row[]
): void {
  const pinned = worktrees.filter((w) => w.isPinned)
  if (pinned.length === 0) {
    return
  }
  const hostWorktreeCounts = new Map<ExecutionHostId, number>()
  const hostWorktreeIds = new Map<ExecutionHostId, string[]>()
  const pinnedRepoOrder: string[] = []
  const seenPinnedRepoIds = new Set<string>()
  for (const worktree of pinned) {
    const hostId = getWorktreeExecutionHostId(worktree, repoMap.get(worktree.repoId), defaultHostId)
    hostWorktreeCounts.set(hostId, (hostWorktreeCounts.get(hostId) ?? 0) + 1)
    const hostIds = hostWorktreeIds.get(hostId) ?? []
    hostIds.push(worktree.id)
    hostWorktreeIds.set(hostId, hostIds)
    if (!seenPinnedRepoIds.has(worktree.repoId)) {
      pinnedRepoOrder.push(worktree.repoId)
      seenPinnedRepoIds.add(worktree.repoId)
    }
  }

  result.push({
    type: 'header',
    key: definitions.PINNED_GROUP_KEY,
    label: definitions.PINNED_GROUP_META.label,
    count: pinned.length,
    tone: definitions.PINNED_GROUP_META.tone,
    icon: definitions.PINNED_GROUP_META.icon,
    hostWorktreeCounts,
    hostWorktreeIds,
    worktreeIds: pinned.map((worktree) => worktree.id)
  })
  if (collapsedGroups.has(definitions.PINNED_GROUP_KEY)) {
    for (const repoId of pinnedRepoOrder) {
      const candidate = importedWorktreesByRepo.get(repoId)
      if (allowImportedFallback && candidate && !renderedNaturalAnchorRepoIds.has(repoId)) {
        result.push(buildImportedWorktreesCardRow(candidate, 'pinned-fallback'))
      }
    }
  } else {
    const lastPinnedIndexByRepoId = new Map<string, number>()
    pinned.forEach((worktree, index) => lastPinnedIndexByRepoId.set(worktree.repoId, index))
    for (const [index, worktree] of pinned.entries()) {
      result.push(
        buildWorktreeRow(worktree, repoMap, {
          rowKey: `${definitions.PINNED_GROUP_KEY}:${worktree.id}`,
          sectionKey: definitions.PINNED_GROUP_KEY,
          depth: 0,
          groupDepth: 0,
          lineageTrail: [],
          isLastLineageChild: false,
          lineageChildCount: 0,
          lineageCollapsed: false
        })
      )
      const candidate = importedWorktreesByRepo.get(worktree.repoId)
      if (
        allowImportedFallback &&
        candidate &&
        !renderedNaturalAnchorRepoIds.has(worktree.repoId) &&
        lastPinnedIndexByRepoId.get(worktree.repoId) === index
      ) {
        result.push(buildImportedWorktreesCardRow(candidate, 'pinned-fallback'))
      }
    }
  }
}

export function buildImportedWorktreesCardRow(
  candidate: definitions.ImportedWorktreesCardCandidate,
  placement: definitions.ImportedWorktreesCardRow['placement']
): definitions.ImportedWorktreesCardRow {
  return {
    type: 'imported-worktrees-card',
    key: `imported-worktrees-card:${placement}:${candidate.repo.id}`,
    repo: candidate.repo,
    hiddenWorktrees: candidate.hiddenWorktrees,
    placement
  }
}

export function buildNewExternalWorktreesInboxRow(
  candidate: definitions.NewExternalWorktreesInboxCandidate
): definitions.NewExternalWorktreesInboxRow {
  return {
    type: 'new-external-worktrees-inbox',
    key: `new-external-worktrees-inbox:${candidate.repo.id}`,
    repo: candidate.repo,
    inboxWorktrees: candidate.inboxWorktrees
  }
}

export function buildWorktreeRow(
  worktree: Worktree,
  repoMap: Map<string, Repo>,
  options: {
    rowKey: string
    sectionKey: string
    depth: number
    groupDepth: number
    lineageTrail: boolean[]
    isLastLineageChild: boolean
    lineageChildCount: number
    lineageCollapsed: boolean
    hostContextLabel?: string
  }
): definitions.WorktreeRow {
  return {
    type: 'item',
    rowKey: options.rowKey,
    sectionKey: options.sectionKey,
    worktree,
    repo: repoMap.get(worktree.repoId),
    depth: options.depth,
    groupDepth: options.groupDepth,
    lineageTrail: options.lineageTrail,
    isLastLineageChild: options.isLastLineageChild,
    lineageChildCount: options.lineageChildCount,
    ...(options.hostContextLabel ? { hostContextLabel: options.hostContextLabel } : {}),
    ...(options.lineageChildCount > 0 ? { lineageGroupKey: definitions.getLineageGroupKey(worktree.id) } : {}),
    ...(options.lineageChildCount > 0 ? { lineageCollapsed: options.lineageCollapsed } : {})
  }
}

export function appendWorktreeRows(
  result: definitions.Row[],
  worktrees: Worktree[],
  repoMap: Map<string, Repo>,
  lineageById: Record<string, WorktreeLineage>,
  worktreeMap: Map<string, Worktree>,
  options: {
    nestLineage: boolean
    collapsedGroups: Set<string>
    groupDepth: number
    sectionKey: string
    hostContextLabelByRepoId?: ReadonlyMap<string, string>
    hostContextLabelByWorktreeId?: ReadonlyMap<string, string>
    cyclicLineageIds: ReadonlySet<string>
  }
): void {
  const {
    nestLineage,
    collapsedGroups,
    groupDepth,
    sectionKey,
    hostContextLabelByRepoId,
    hostContextLabelByWorktreeId,
    cyclicLineageIds
  } = options
  if (!nestLineage) {
    for (const worktree of worktrees) {
      result.push(
        buildWorktreeRow(worktree, repoMap, {
          rowKey: `${sectionKey}:${worktree.id}`,
          sectionKey,
          depth: 0,
          groupDepth,
          lineageTrail: [],
          isLastLineageChild: false,
          lineageChildCount: 0,
          lineageCollapsed: false,
          hostContextLabel:
            hostContextLabelByWorktreeId?.get(worktree.id) ??
            hostContextLabelByRepoId?.get(worktree.repoId)
        })
      )
    }
    return
  }

  const visibleIds = new Set(worktrees.map((worktree) => worktree.id))
  const childrenByParentId = new Map<string, Worktree[]>()
  const childIds = new Set<string>()
  for (const worktree of worktrees) {
    const lineage = getLineageRenderInfo(worktree, lineageById, worktreeMap, cyclicLineageIds)
    if (lineage.state !== 'valid' || !visibleIds.has(lineage.parent.id)) {
      continue
    }
    childIds.add(worktree.id)
    const children = childrenByParentId.get(lineage.parent.id) ?? []
    children.push(worktree)
    childrenByParentId.set(lineage.parent.id, children)
  }

  const emitted = new Set<string>()
  const emit = (
    worktree: Worktree,
    depth: number,
    lineageTrail: boolean[],
    isLastChild: boolean
  ): void => {
    if (emitted.has(worktree.id)) {
      return
    }
    const children = childrenByParentId.get(worktree.id) ?? []
    const lineageGroupKey = definitions.getLineageGroupKey(worktree.id)
    const lineageCollapsed = collapsedGroups.has(lineageGroupKey)
    emitted.add(worktree.id)
    result.push(
      buildWorktreeRow(worktree, repoMap, {
        rowKey: `${sectionKey}:${worktree.id}`,
        sectionKey,
        depth,
        groupDepth,
        lineageTrail,
        isLastLineageChild: isLastChild,
        lineageChildCount: children.length,
        lineageCollapsed,
        hostContextLabel:
          hostContextLabelByWorktreeId?.get(worktree.id) ??
          hostContextLabelByRepoId?.get(worktree.repoId)
      })
    )
    if (lineageCollapsed) {
      return
    }
    children.forEach((child, index) => {
      emit(
        child,
        depth + 1,
        [...lineageTrail, index < children.length - 1],
        index === children.length - 1
      )
    })
  }

  const roots = worktrees.filter((worktree) => !childIds.has(worktree.id))
  for (const [index, worktree] of roots.entries()) {
    emit(worktree, 0, [], index === roots.length - 1)
  }
  if (roots.length === 0) {
    for (const worktree of worktrees) {
      if (!emitted.has(worktree.id)) {
        // Why: malformed cyclic lineage should not hide every participant.
        // Render any leftovers as roots rather than recursing forever.
        emit(worktree, 0, [], true)
      }
    }
  }
}

export function getRepoHostLabel(
  repoId: string,
  repoMap: Map<string, Repo>,
  projectIndex: definitions.ProjectGroupingIndex | null,
  hostLabelById: ReadonlyMap<string, string> | undefined
): string | null {
  const setup = projectIndex?.setupByRepoId.get(repoId)
  if (setup) {
    return hostLabelById?.get(setup.hostId) ?? getExecutionHostLabel(setup.hostId)
  }
  const repo = repoMap.get(repoId)
  if (!repo) {
    return null
  }
  const hostId = getRepoExecutionHostId(repo)
  return hostLabelById?.get(hostId) ?? getExecutionHostLabel(hostId)
}

export function getMixedHostContextLabels(
  group: definitions.WorktreeGroupEntry,
  repoMap: Map<string, Repo>,
  projectIndex: definitions.ProjectGroupingIndex | null,
  hostLabelById: ReadonlyMap<string, string> | undefined
): Map<string, string> | undefined {
  const labelsByRepoId = new Map<string, string>()
  const uniqueLabels = new Set<string>()
  for (const repoId of group.repoIds) {
    const label = getRepoHostLabel(repoId, repoMap, projectIndex, hostLabelById)
    if (!label) {
      continue
    }
    labelsByRepoId.set(repoId, label)
    uniqueLabels.add(label)
  }
  return uniqueLabels.size > 1 ? labelsByRepoId : undefined
}

export function getMixedWorktreeHostContextLabels(
  worktrees: readonly Worktree[],
  repoMap: Map<string, Repo>,
  hostLabelById: ReadonlyMap<string, string> | undefined,
  defaultHostId: ExecutionHostId
): Map<string, string> | undefined {
  const labelsByWorktreeId = new Map<string, string>()
  const uniqueHostIds = new Set<ExecutionHostId>()
  for (const worktree of worktrees) {
    const hostId = getWorktreeExecutionHostId(worktree, repoMap.get(worktree.repoId), defaultHostId)
    uniqueHostIds.add(hostId)
    labelsByWorktreeId.set(worktree.id, hostLabelById?.get(hostId) ?? getExecutionHostLabel(hostId))
  }
  return uniqueHostIds.size > 1 ? labelsByWorktreeId : undefined
}

export function getHostWorktreeCounts(
  worktrees: readonly Worktree[],
  repoMap: Map<string, Repo>,
  defaultHostId: ExecutionHostId
): Map<ExecutionHostId, number> | undefined {
  if (worktrees.length === 0) {
    return undefined
  }
  const counts = new Map<ExecutionHostId, number>()
  const seenWorktreeIds = new Set<string>()
  for (const worktree of worktrees) {
    if (seenWorktreeIds.has(worktree.id)) {
      continue
    }
    seenWorktreeIds.add(worktree.id)
    const hostId = getWorktreeExecutionHostId(worktree, repoMap.get(worktree.repoId), defaultHostId)
    counts.set(hostId, (counts.get(hostId) ?? 0) + 1)
  }
  return counts
}

export function getHostWorktreeIds(
  worktrees: readonly Worktree[],
  repoMap: Map<string, Repo>,
  defaultHostId: ExecutionHostId
): Map<ExecutionHostId, string[]> | undefined {
  if (worktrees.length === 0) {
    return undefined
  }
  const idsByHost = new Map<ExecutionHostId, string[]>()
  const seenWorktreeIds = new Set<string>()
  for (const worktree of worktrees) {
    if (seenWorktreeIds.has(worktree.id)) {
      continue
    }
    seenWorktreeIds.add(worktree.id)
    const hostId = getWorktreeExecutionHostId(worktree, repoMap.get(worktree.repoId), defaultHostId)
    const ids = idsByHost.get(hostId) ?? []
    ids.push(worktree.id)
    idsByHost.set(hostId, ids)
  }
  return idsByHost
}

export function getRenderedNaturalAnchorRepoIds({
  groupBy,
  worktrees,
  repoMap,
  prCache,
  collapsedGroups,
  workspaceStatuses,
  settings,
  projectGrouping
}: {
  groupBy: definitions.WorktreeGroupBy
  worktrees: readonly Worktree[]
  repoMap: Map<string, Repo>
  prCache: Record<string, unknown> | null
  collapsedGroups: ReadonlySet<string>
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
  settings?: AppState['settings']
  projectGrouping?: definitions.ProjectGroupingModel
}): Set<string> {
  const renderedRepoIds = new Set<string>()
  if (groupBy === 'none') {
    if (!collapsedGroups.has(definitions.ALL_GROUP_KEY)) {
      for (const worktree of worktrees) {
        renderedRepoIds.add(worktree.repoId)
      }
    }
    return renderedRepoIds
  }
  if (groupBy === 'repo') {
    for (const worktree of worktrees) {
      renderedRepoIds.add(worktree.repoId)
    }
    return renderedRepoIds
  }
  for (const worktree of worktrees) {
    const groupKey = getGroupKeyForWorktree(
      groupBy,
      worktree,
      repoMap,
      prCache,
      workspaceStatuses,
      settings,
      projectGrouping
    )
    if (groupKey && !collapsedGroups.has(groupKey)) {
      renderedRepoIds.add(worktree.repoId)
    }
  }
  return renderedRepoIds
}

export function orderMainWorktreeFirst(worktrees: Worktree[]): Worktree[] {
  const mainWorktrees = worktrees.filter((worktree) => worktree.isMainWorktree)
  if (mainWorktrees.length === 0) {
    return worktrees
  }
  // Why: project groups are scanned by repo; keep the repo's canonical
  // workspace anchored even when dynamic sorts rank a child workspace first.
  return [...mainWorktrees, ...worktrees.filter((worktree) => !worktree.isMainWorktree)]
}

export function withRepoSectionDisplayLabels(entries: readonly definitions.OrderedGroupEntry[]): definitions.OrderedGroupEntry[] {
  const repos = entries
    .map((entry) => entry[1].repo)
    .filter((repo): repo is Repo => repo !== undefined)
  if (repos.length < 2) {
    return [...entries]
  }
  const labelsByPath = getRepoDisplayLabelsByPath(repos)
  return entries.map(([key, group]) => [
    key,
    group.repo
      ? { ...group, label: labelsByPath.get(getRepoDisplayLabelKey(group.repo)) ?? group.label }
      : group
  ])
}

/**
 * Recent rank for a project header. `hasActivity` projects (at least one
 * visible worktree) always sort before fallback projects, regardless of the
 * numeric values — a placeholder's `addedAt` must never outrank real activity.
 * Within each tier, higher timestamps come first.
 */
export type RecentRank = { hasActivity: boolean; ts: number }

export function recentRankForEntry(entry: definitions.OrderedGroupEntry): RecentRank {
  let max = Number.NEGATIVE_INFINITY
  for (const worktree of entry[1].items) {
    if (worktree.lastActivityAt > max) {
      max = worktree.lastActivityAt
    }
  }
  if (max !== Number.NEGATIVE_INFINITY) {
    // Why: Recent must be timestamp-based, not encounter order — the incoming
    // array is no longer pre-sorted by recency once decoupled from sortBy.
    return { hasActivity: true, ts: max }
  }
  const addedAt = entry[1].repo?.addedAt
  return {
    hasActivity: false,
    ts: typeof addedAt === 'number' ? addedAt : Number.NEGATIVE_INFINITY
  }
}

export function compareRecentRank(a: RecentRank, b: RecentRank): number {
  if (a.hasActivity !== b.hasActivity) {
    return a.hasActivity ? -1 : 1
  }
  return b.ts - a.ts
}

export function manualRankForEntry(
  entry: definitions.OrderedGroupEntry,
  repoOrder: Map<string, number> | undefined
): number {
  const key = entry[0]
  const repoIds =
    entry[1].repoIds.size > 0
      ? [...entry[1].repoIds]
      : [key.startsWith('repo:') ? key.slice('repo:'.length) : key]
  let rank = Number.POSITIVE_INFINITY
  for (const repoId of repoIds) {
    const repoRank = repoOrder?.get(repoId)
    if (repoRank !== undefined && repoRank < rank) {
      rank = repoRank
    }
  }
  return rank
}

export function getManualOrderAnchorRepo(
  group: definitions.WorktreeGroupEntry,
  repoMap: Map<string, Repo>,
  repoOrder: Map<string, number> | undefined
): Repo | undefined {
  let anchor = group.repo
  let anchorRank = anchor ? (repoOrder?.get(anchor.id) ?? Number.POSITIVE_INFINITY) : undefined
  for (const repoId of group.repoIds) {
    const repo = repoMap.get(repoId)
    if (!repo) {
      continue
    }
    const rank = repoOrder?.get(repoId) ?? Number.POSITIVE_INFINITY
    if (!anchor || rank < (anchorRank ?? Number.POSITIVE_INFINITY)) {
      anchor = repo
      anchorRank = rank
    }
  }
  return anchor
}

/**
 * Order project header entries by the user's project-order preference. Manual
 * follows the canonical repoOrder; Recent follows each project's most recent
 * visible workspace activity (descending), with empty/imported-only projects
 * sorting after active ones, then by manual rank, then label.
 */
export function sortProjectEntries(
  entries: definitions.OrderedGroupEntry[],
  projectOrderBy: ProjectOrderBy,
  repoOrder: Map<string, number> | undefined
): definitions.OrderedGroupEntry[] {
  if (projectOrderBy === 'recent') {
    return [...entries].sort((a, b) => {
      const byRecent = compareRecentRank(recentRankForEntry(a), recentRankForEntry(b))
      if (byRecent !== 0) {
        return byRecent
      }
      const ma = manualRankForEntry(a, repoOrder)
      const mb = manualRankForEntry(b, repoOrder)
      if (ma !== mb) {
        return ma - mb
      }
      return a[1].label.localeCompare(b[1].label)
    })
  }
  if (!repoOrder) {
    return entries
  }
  return [...entries].sort((a, b) => {
    const ra = manualRankForEntry(a, repoOrder)
    const rb = manualRankForEntry(b, repoOrder)
    if (ra !== rb) {
      return ra - rb
    }
    return a[1].label.localeCompare(b[1].label)
  })
}

/**
 * Build the flat row list consumed by the virtualizer.
 * Extracted here to keep WorktreeList.tsx under the line-count lint limit.
 */
