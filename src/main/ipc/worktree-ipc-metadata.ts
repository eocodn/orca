import type { Store } from '../persistence'
import { parseWorkspaceKey } from '../../shared/workspace-scope'
import { getProjectGroupSubtreeIds } from '../../shared/project-groups'
import { isPathInsideOrEqual } from '../../shared/cross-platform-path'
import type {
  Repo,
  WorktreeLineage,
  WorkspaceLineage,
  WorktreeMeta
} from '../../shared/types'
import {
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../shared/execution-host'
import type { DirectSshDetectedWorktreeRequest } from '../../shared/detected-worktree-provider-contract'
import type { ListDesktopLineageForHostArgs } from '../../shared/host-lineage-contract'
import { isAdmissibleDirectSshAuthority } from '../../shared/ssh-retained-payload-admission'
import { parseWorktreeId } from './worktree-logic'

import { buildFolderDetectedWorktrees,
  listVisibleFolderWorkspaces,
  createFolderWorkspace,
  buildDisconnectedDetectedWorktrees,
  hasConflictingStoredWorktreeOwner,
  type RepoOwnershipEvidence,
  resolveRepoOwnershipEvidence,
  findExactRepoOwner,
  isCapturedRepoCurrent,
  listDetectedWorktreesForCapturedRepo } from './worktree-ipc-local'
export { buildFolderDetectedWorktrees,
  listVisibleFolderWorkspaces,
  createFolderWorkspace,
  buildDisconnectedDetectedWorktrees,
  hasConflictingStoredWorktreeOwner,
  type RepoOwnershipEvidence,
  resolveRepoOwnershipEvidence,
  findExactRepoOwner,
  isCapturedRepoCurrent,
  listDetectedWorktreesForCapturedRepo } from './worktree-ipc-local'

export function hasValidDirectSshAuthority(
  args: DirectSshDetectedWorktreeRequest
): args is DirectSshDetectedWorktreeRequest {
  return isAdmissibleDirectSshAuthority(args.expectedAuthority)
}

export function hasValidLineageSshAuthority(
  args: ListDesktopLineageForHostArgs
): args is Extract<ListDesktopLineageForHostArgs, { expectedAuthority: unknown }> {
  if (!('expectedAuthority' in args)) {
    return false
  }
  return isAdmissibleDirectSshAuthority(args.expectedAuthority)
}

export type LineageOwner =
  | { status: 'owned'; hostId: ExecutionHostId }
  | { status: 'ambiguous' | 'contradictory' | 'runtime' }

export type LineageFolder = ReturnType<Store['getFolderWorkspaces']>[number]
export type LineageGroup = ReturnType<Store['getProjectGroups']>[number]

export type LineageResolutionContext = {
  store: Store
  repos: Repo[]
  groups: LineageGroup[]
  reposById: Map<string, Repo[]>
  foldersById: Map<string, LineageFolder[]>
  groupsById: Map<string, LineageGroup[]>
  groupSubtreeIdsByRoot: Map<string, Set<string>>
  worktreeOwners: Map<string, LineageOwner>
  folderOwners: Map<string, LineageOwner>
  workspaceOwners: Map<string, LineageOwner>
}

export function indexLineageEntriesById<T extends { id: string }>(
  entries: readonly T[]
): Map<string, T[]> {
  const index = new Map<string, T[]>()
  for (const entry of entries) {
    const matching = index.get(entry.id) ?? []
    matching.push(entry)
    index.set(entry.id, matching)
  }
  return index
}

export function createLineageResolutionContext(store: Store): LineageResolutionContext {
  const repos = store.getRepos()
  const folders = store.getFolderWorkspaces()
  const groups = store.getProjectGroups()
  return {
    store,
    repos,
    groups,
    reposById: indexLineageEntriesById(repos),
    foldersById: indexLineageEntriesById(folders),
    groupsById: indexLineageEntriesById(groups),
    groupSubtreeIdsByRoot: new Map(),
    worktreeOwners: new Map(),
    folderOwners: new Map(),
    workspaceOwners: new Map()
  }
}

export function resolveRepoLineageOwner(repo: Repo): LineageOwner {
  const owner = resolveRepoOwnershipEvidence(repo)
  if (owner.status === 'malformed') {
    return { status: 'ambiguous' }
  }
  if (owner.status === 'contradictory') {
    return { status: 'contradictory' }
  }
  return parseExecutionHostId(owner.hostId)?.kind === 'runtime' ? { status: 'runtime' } : owner
}

export function resolveWorktreeLineageOwner(
  context: LineageResolutionContext,
  worktreeId: string
): LineageOwner {
  const cached = context.worktreeOwners.get(worktreeId)
  if (cached) {
    return cached
  }
  const remember = (owner: LineageOwner): LineageOwner => {
    context.worktreeOwners.set(worktreeId, owner)
    return owner
  }
  let repoId: string
  try {
    repoId = parseWorktreeId(worktreeId).repoId
  } catch {
    return remember({ status: 'ambiguous' })
  }
  const repos = context.reposById.get(repoId) ?? []
  const meta = context.store.getWorktreeMeta(worktreeId)
  const runtimeOwnerEnvironmentId = (
    meta as (WorktreeMeta & { runtimeOwnerEnvironmentId?: string }) | undefined
  )?.runtimeOwnerEnvironmentId?.trim()
  if (runtimeOwnerEnvironmentId) {
    return remember({ status: 'runtime' })
  }
  if (meta?.hostId) {
    const explicitHost = parseExecutionHostId(meta.hostId)
    if (!explicitHost) {
      return remember({ status: 'ambiguous' })
    }
    if (explicitHost.kind === 'runtime') {
      return remember({ status: 'runtime' })
    }
    const matchingRepos = repos.filter((repo) => {
      const owner = resolveRepoLineageOwner(repo)
      return owner.status === 'owned' && owner.hostId === explicitHost.id
    })
    if (matchingRepos.length === 1) {
      return remember({ status: 'owned', hostId: explicitHost.id })
    }
    return remember(
      matchingRepos.length > 1
        ? { status: 'ambiguous' }
        : { status: repos.length > 0 ? 'contradictory' : 'ambiguous' }
    )
  }
  if (repos.length !== 1) {
    return remember({ status: 'ambiguous' })
  }
  return remember(resolveRepoLineageOwner(repos[0]))
}

export function getFolderLineageCandidateRepos(
  context: LineageResolutionContext,
  folder: LineageFolder
): Repo[] {
  let groupIds = context.groupSubtreeIdsByRoot.get(folder.projectGroupId)
  if (!groupIds) {
    groupIds = getProjectGroupSubtreeIds(context.groups, folder.projectGroupId)
    context.groupSubtreeIdsByRoot.set(folder.projectGroupId, groupIds)
  }
  const grouped = context.repos.filter(
    (repo) => typeof repo.projectGroupId === 'string' && groupIds.has(repo.projectGroupId)
  )
  const pathRepos = context.repos.filter(
    (repo) =>
      !(typeof repo.projectGroupId === 'string' && groupIds.has(repo.projectGroupId)) &&
      isPathInsideOrEqual(folder.folderPath, repo.path)
  )
  const group = context.groupsById.get(folder.projectGroupId)?.[0]
  const connectionId = folder.connectionId ?? group?.connectionId ?? null
  return connectionId
    ? [...grouped, ...pathRepos.filter((repo) => (repo.connectionId ?? null) === connectionId)]
    : grouped.length > 0
      ? [
          ...grouped,
          ...pathRepos.filter((repo) =>
            new Set(grouped.map((candidate) => candidate.connectionId ?? null)).has(
              repo.connectionId ?? null
            )
          )
        ]
      : pathRepos
}

export function resolveFolderLineageOwner(
  context: LineageResolutionContext,
  folderWorkspaceId: string
): LineageOwner {
  const cached = context.folderOwners.get(folderWorkspaceId)
  if (cached) {
    return cached
  }
  const remember = (owner: LineageOwner): LineageOwner => {
    context.folderOwners.set(folderWorkspaceId, owner)
    return owner
  }
  const folders = context.foldersById.get(folderWorkspaceId) ?? []
  if (folders.length !== 1) {
    return remember({ status: 'ambiguous' })
  }
  const folder = folders[0]
  const groups = context.groupsById.get(folder.projectGroupId) ?? []
  if (groups.length !== 1) {
    return remember({ status: 'ambiguous' })
  }
  const group = groups[0]
  const hosts = new Set<ExecutionHostId>()
  if (folder.connectionId) {
    hosts.add(`ssh:${encodeURIComponent(folder.connectionId)}`)
  }
  if (group.connectionId) {
    hosts.add(`ssh:${encodeURIComponent(group.connectionId)}`)
  }
  if (group.executionHostId) {
    const parsed = parseExecutionHostId(group.executionHostId)
    if (!parsed) {
      return remember({ status: 'ambiguous' })
    }
    hosts.add(parsed.id)
  }
  for (const repo of getFolderLineageCandidateRepos(context, folder)) {
    const owner = resolveRepoLineageOwner(repo)
    if (owner.status !== 'owned') {
      return remember(owner)
    }
    hosts.add(owner.hostId)
  }
  if (hosts.size > 1) {
    return remember({ status: 'contradictory' })
  }
  const hostId = [...hosts][0] ?? LOCAL_EXECUTION_HOST_ID
  return remember(
    parseExecutionHostId(hostId)?.kind === 'runtime'
      ? { status: 'runtime' }
      : { status: 'owned', hostId }
  )
}

export function resolveWorkspaceLineageOwner(
  context: LineageResolutionContext,
  workspaceKey: string
): LineageOwner {
  const cached = context.workspaceOwners.get(workspaceKey)
  if (cached) {
    return cached
  }
  const workspace = parseWorkspaceKey(workspaceKey)
  const owner = !workspace
    ? { status: 'ambiguous' as const }
    : workspace.type === 'worktree'
      ? resolveWorktreeLineageOwner(context, workspace.worktreeId)
      : resolveFolderLineageOwner(context, workspace.folderWorkspaceId)
  context.workspaceOwners.set(workspaceKey, owner)
  return owner
}

export function filterLineageForHost(
  store: Store,
  executionHostId: ExecutionHostId
): {
  worktreeLineageById: Record<string, WorktreeLineage>
  workspaceLineageByChildKey: Record<string, WorkspaceLineage>
} | null {
  const context = createLineageResolutionContext(store)
  const worktreeLineageById: Record<string, WorktreeLineage> = {}
  const workspaceLineageByChildKey: Record<string, WorkspaceLineage> = {}
  for (const [worktreeId, lineage] of Object.entries(store.getAllWorktreeLineage())) {
    const child = resolveWorktreeLineageOwner(context, worktreeId)
    const parent = resolveWorktreeLineageOwner(context, lineage.parentWorktreeId)
    if (child.status === 'ambiguous' || child.status === 'contradictory') {
      return null
    }
    if (parent.status === 'ambiguous' || parent.status === 'contradictory') {
      return null
    }
    if (
      child.status === 'owned' &&
      parent.status === 'owned' &&
      child.hostId === executionHostId &&
      parent.hostId === executionHostId
    ) {
      worktreeLineageById[worktreeId] = structuredClone(lineage)
    } else if (
      child.status === 'owned' &&
      parent.status === 'owned' &&
      child.hostId !== parent.hostId
    ) {
      return null
    }
  }
  for (const [childKey, lineage] of Object.entries(store.getAllWorkspaceLineage())) {
    const child = resolveWorkspaceLineageOwner(context, childKey)
    const parent = resolveWorkspaceLineageOwner(context, lineage.parentWorkspaceKey)
    if (child.status === 'ambiguous' || child.status === 'contradictory') {
      return null
    }
    if (parent.status === 'ambiguous' || parent.status === 'contradictory') {
      return null
    }
    if (
      child.status === 'owned' &&
      parent.status === 'owned' &&
      child.hostId === executionHostId &&
      parent.hostId === executionHostId
    ) {
      workspaceLineageByChildKey[childKey] = structuredClone(lineage)
    } else if (
      child.status === 'owned' &&
      parent.status === 'owned' &&
      child.hostId !== parent.hostId
    ) {
      return null
    }
  }
  return { worktreeLineageById, workspaceLineageByChildKey }
}
