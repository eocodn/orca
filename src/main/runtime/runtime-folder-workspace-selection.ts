import { randomUUID } from 'node:crypto'
import type { Store } from '../persistence'
import { FOLDER_WORKSPACE_INSTANCE_SEPARATOR } from '../../shared/worktree-id'
import { DEFAULT_WORKSPACE_STATUS_ID } from '../../shared/workspace-statuses'
import type { Repo, Worktree, WorktreeMeta } from '../../shared/types'

export function getRuntimeFolderWorkspaceRootId(repo: Repo): string {
  return `${repo.id}::${repo.path}`
}

export function getRuntimeFolderWorkspaceInstanceId(repo: Repo, instanceId: string): string {
  return `${getRuntimeFolderWorkspaceRootId(repo)}${FOLDER_WORKSPACE_INSTANCE_SEPARATOR}${instanceId}`
}

export function getRuntimeFolderWorkspaceInstanceIdentity(repo: Repo, worktreeId: string): string {
  const prefix = `${getRuntimeFolderWorkspaceRootId(repo)}${FOLDER_WORKSPACE_INSTANCE_SEPARATOR}`
  return worktreeId.startsWith(prefix) ? worktreeId.slice(prefix.length) : randomUUID()
}

export function isRuntimeFolderWorkspaceIdForRepo(repo: Repo, worktreeId: string): boolean {
  const rootId = getRuntimeFolderWorkspaceRootId(repo)
  return (
    worktreeId === rootId ||
    worktreeId.startsWith(`${rootId}${FOLDER_WORKSPACE_INSTANCE_SEPARATOR}`)
  )
}

export function mergeRuntimeFolderWorkspace(
  repo: Repo,
  worktreeId: string,
  meta: WorktreeMeta
): Worktree {
  return {
    id: worktreeId,
    ...(meta.instanceId !== undefined ? { instanceId: meta.instanceId } : {}),
    repoId: repo.id,
    ...(meta.projectId !== undefined ? { projectId: meta.projectId } : {}),
    ...(meta.hostId !== undefined ? { hostId: meta.hostId } : {}),
    ...(meta.projectHostSetupId !== undefined
      ? { projectHostSetupId: meta.projectHostSetupId }
      : {}),
    path: repo.path,
    head: '',
    branch: '',
    isBare: false,
    isMainWorktree: worktreeId === getRuntimeFolderWorkspaceRootId(repo),
    displayName: meta.displayName || repo.displayName,
    comment: meta.comment || '',
    linkedIssue: meta.linkedIssue ?? null,
    linkedPR: meta.linkedPR ?? null,
    linkedLinearIssue: meta.linkedLinearIssue ?? null,
    linkedLinearIssueWorkspaceId: meta.linkedLinearIssueWorkspaceId ?? null,
    linkedLinearIssueOrganizationUrlKey: meta.linkedLinearIssueOrganizationUrlKey ?? null,
    linkedGitLabMR: meta.linkedGitLabMR ?? null,
    linkedGitLabIssue: meta.linkedGitLabIssue ?? null,
    linkedBitbucketPR: meta.linkedBitbucketPR ?? null,
    linkedAzureDevOpsPR: meta.linkedAzureDevOpsPR ?? null,
    linkedGiteaPR: meta.linkedGiteaPR ?? null,
    linkedWorkItem: meta.linkedWorkItem ?? null,
    linkedTaskSourceContext: meta.linkedTaskSourceContext ?? null,
    isArchived: meta.isArchived ?? false,
    isUnread: meta.isUnread ?? false,
    isPinned: meta.isPinned ?? false,
    sortOrder: meta.sortOrder ?? 0,
    ...(meta.manualOrder !== undefined ? { manualOrder: meta.manualOrder } : {}),
    lastActivityAt: meta.lastActivityAt ?? 0,
    ...(meta.createdAt !== undefined ? { createdAt: meta.createdAt } : {}),
    ...(meta.createdWithAgent !== undefined ? { createdWithAgent: meta.createdWithAgent } : {}),
    ...(meta.automationProvenance !== undefined
      ? { automationProvenance: meta.automationProvenance }
      : {}),
    ...(meta.cliProvenance !== undefined ? { cliProvenance: meta.cliProvenance } : {}),
    ...(meta.priorWorktreeIds !== undefined ? { priorWorktreeIds: meta.priorWorktreeIds } : {}),
    workspaceStatus: meta.workspaceStatus ?? DEFAULT_WORKSPACE_STATUS_ID,
    diffComments: meta.diffComments,
    mobileDiffReview: meta.mobileDiffReview
  }
}

export type RuntimeFolderWorkspaceStore = Pick<Store, 'getAllWorktreeMeta' | 'setWorktreeMeta'>

export function listRuntimeFolderWorkspaces(
  store: RuntimeFolderWorkspaceStore,
  repo: Repo
): Worktree[] {
  const rootId = getRuntimeFolderWorkspaceRootId(repo)
  const allMeta = store.getAllWorktreeMeta()
  const ids = Object.keys(allMeta).filter((worktreeId) =>
    isRuntimeFolderWorkspaceIdForRepo(repo, worktreeId)
  )
  if (!ids.includes(rootId)) {
    ids.unshift(rootId)
  } else {
    ids.sort((left, right) => (left === rootId ? -1 : right === rootId ? 1 : 0))
  }

  return ids.map((worktreeId) => {
    const existing = allMeta[worktreeId]
    const meta = existing?.instanceId
      ? existing
      : store.setWorktreeMeta(worktreeId, {
          instanceId: getRuntimeFolderWorkspaceInstanceIdentity(repo, worktreeId),
          ...(existing ? {} : { displayName: repo.displayName, lastActivityAt: Date.now() })
        })
    return mergeRuntimeFolderWorkspace(repo, worktreeId, meta)
  })
}
