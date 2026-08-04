import { randomUUID } from 'node:crypto'
import { isPathInsideOrEqual } from '../shared/cross-platform-path'
import { getProjectGroupSubtreeIds } from '../shared/project-groups'
import type { PersistedState,ProjectGroup,Repo,WorkspaceSessionState,WorktreeMeta } from '../shared/types'
import { DEFAULT_WORKSPACE_STATUS_ID } from '../shared/workspace-statuses'
import { cloneWorkspaceSessionState,deleteOwnerKeyedSessionFields,deleteScannedSessionFieldsForOwners } from './persistence-state-ssh'
import { collectTerminalScrollbackSnapshotRefs,deleteTerminalScrollbackSnapshotSync,type TerminalScrollbackSnapshotStorage } from './terminal-scrollback-snapshots'

export {
  cloneWorkspaceSessionState,createMinimalPersistedTerminalTab,deleteOwnerKeyedSessionFields,
  deleteScannedSessionFieldsForOwners,isRepoBackedProjectHostSetup,legacyPaneKeyAliasEntriesEqual,makeProjectHostSetupId,mergeLegacyPaneKeyAliasEntries,mergeProjectHostSetupCompatibilityState,migrationUnsupportedEntriesEqual,
  projectHostSetupCompatibilityStateEqual,registerPersistedPaneKeyAlias
} from './persistence-state-ssh'

export function removeWorkspaceSessionOwner(
  session: WorkspaceSessionState | undefined,
  ownerKey: string,
  options: { advanceTerminalTopologyRevision?: boolean } = {}
): WorkspaceSessionState | undefined {
  if (!session) {
    return session
  }
  const next = cloneWorkspaceSessionState(session)
  const removedTabIds = new Set<string>()
  deleteOwnerKeyedSessionFields(next, ownerKey, removedTabIds, options)
  deleteScannedSessionFieldsForOwners(next, removedTabIds, (worktreeId) => worktreeId === ownerKey)
  return next
}

// Batch variant of removeWorkspaceSessionOwner: prunes every owner in `ownerKeys`
// with a single structuredClone and a single scan of each collection, instead of
// one clone+scan per owner. Project removal can touch many worktrees across many
// host partitions, so the per-owner clones added up to O(worktrees × hosts).
export function removeWorkspaceSessionOwners(
  session: WorkspaceSessionState | undefined,
  ownerKeys: ReadonlySet<string>
): WorkspaceSessionState | undefined {
  if (!session || ownerKeys.size === 0) {
    return session
  }
  const next = cloneWorkspaceSessionState(session)
  const removedTabIds = new Set<string>()
  for (const ownerKey of ownerKeys) {
    deleteOwnerKeyedSessionFields(next, ownerKey, removedTabIds)
  }
  deleteScannedSessionFieldsForOwners(next, removedTabIds, (worktreeId) =>
    ownerKeys.has(worktreeId)
  )
  return next
}

export function inferFolderScopeConnectionIdForMigration(args: {
  folderPath: string
  projectGroupId: string
  projectGroups: readonly ProjectGroup[]
  repos: readonly Repo[]
}): string | null {
  const groupIds = getProjectGroupSubtreeIds(args.projectGroups, args.projectGroupId)
  const groupRepos = args.repos.filter(
    (repo) => typeof repo.projectGroupId === 'string' && groupIds.has(repo.projectGroupId)
  )
  const candidateRepos =
    groupRepos.length > 0
      ? groupRepos
      : args.repos.filter((repo) => isPathInsideOrEqual(args.folderPath, repo.path))
  if (candidateRepos.length === 0) {
    return null
  }
  let hasLocalRepo = false
  const connectionIds = new Set<string>()
  for (const repo of candidateRepos) {
    if (repo.connectionId) {
      connectionIds.add(repo.connectionId)
    } else {
      hasLocalRepo = true
    }
  }
  if (hasLocalRepo || connectionIds.size !== 1) {
    return null
  }
  return [...connectionIds][0]
}

export function backfillFolderScopeConnectionIds(state: PersistedState): {
  state: PersistedState
  changed: boolean
} {
  const groups = state.projectGroups ?? []
  const repos = state.repos ?? []
  let changed = false
  const projectGroups = groups.map((group) => {
    if (group.connectionId || !group.parentPath) {
      return group
    }
    const connectionId = inferFolderScopeConnectionIdForMigration({
      folderPath: group.parentPath,
      projectGroupId: group.id,
      projectGroups: groups,
      repos
    })
    if (!connectionId) {
      return group
    }
    changed = true
    return { ...group, connectionId }
  })
  const groupsById = new Map(projectGroups.map((group) => [group.id, group]))
  const folderWorkspaces = (state.folderWorkspaces ?? []).map((workspace) => {
    if (workspace.connectionId) {
      return workspace
    }
    const groupConnectionId = groupsById.get(workspace.projectGroupId)?.connectionId ?? null
    const connectionId =
      groupConnectionId ??
      inferFolderScopeConnectionIdForMigration({
        folderPath: workspace.folderPath,
        projectGroupId: workspace.projectGroupId,
        projectGroups,
        repos
      })
    if (!connectionId) {
      return workspace
    }
    changed = true
    return { ...workspace, connectionId }
  })
  return {
    changed,
    state: changed ? { ...state, projectGroups, folderWorkspaces } : state
  }
}

export function deleteRemovedTerminalScrollbackSnapshots(
  prior: WorkspaceSessionState | undefined,
  next: WorkspaceSessionState,
  storage?: TerminalScrollbackSnapshotStorage
): void {
  if (!prior) {
    return
  }
  const nextRefs = collectTerminalScrollbackSnapshotRefs(next)
  for (const ref of collectTerminalScrollbackSnapshotRefs(prior)) {
    if (!nextRefs.has(ref)) {
      deleteTerminalScrollbackSnapshotSync(ref, storage)
    }
  }
}

export type StoreOptions = {
  dataFile?: string
}



export function getDefaultWorktreeMeta(): WorktreeMeta {
  return {
    instanceId: randomUUID(),
    displayName: '',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    linkedBitbucketPR: null,
    linkedAzureDevOpsPR: null,
    linkedGiteaPR: null,
    linkedWorkItem: null,
    linkedTaskSourceContext: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: Date.now(),
    lastActivityAt: 0,
    workspaceStatus: DEFAULT_WORKSPACE_STATUS_ID
  }
}
