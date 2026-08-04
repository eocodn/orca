import { randomUUID } from 'node:crypto'
import { createAgentScratchWorktreePathMatcher } from '../../shared/agent-scratch-worktrees'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../shared/execution-host'
import { getProjectHostSetupWorktreeMeta } from '../../shared/project-host-setup-projection'
import { isFolderRepo } from '../../shared/repo-kind'
import { projectResolvedWorktreeLineage } from '../../shared/resolved-worktree-lineage'
import type {
  CreateWorktreeResult,
  DetectedWorktree,
  DetectedWorktreeListResult,
  GitWorktreeInfo,
  Repo,
  Worktree
} from '../../shared/types'
import { applyMetadataFallbackVisibility,toDetectedWorktree } from '../../shared/worktree-ownership'
import type { Store } from '../persistence'
import { getSshGitProvider } from '../providers/ssh-git-dispatch'
import {
  listDetectedGitWorktrees,
  loggedWorktreeListFailures,
  rememberLocalWorktreeRoots,
  warnOnce
} from './worktree-ipc-creation'
import {
  getProjectHostSetupMetaUpdates,
  type CreateWorktreeArgsWithSystemProvenance
} from './worktree-ipc-foundation'

import {
  buildDetectedGitWorktrees,
  createSshWorktreeMetaIndex,
  getFolderWorkspaceInstanceId,
  isFolderWorkspaceIdForRepo,
  listDisconnectedSshWorktrees,
  listFolderWorkspaces,
  mergeFolderWorkspace,
  pruneLineageForMissingRepoWorktrees
} from './worktree-ipc-remote'
export {
  buildDetectedGitWorktrees,createSshWorktreeMetaIndex,getFolderWorkspaceInstanceId,
  getFolderWorkspaceInstanceIdentity,getFolderWorkspaceRootId,isFolderWorkspaceIdForRepo,listDisconnectedSshWorktrees,listFolderWorkspaces,mergeFolderWorkspace,pruneLineageForMissingRepoWorktrees,stampAndMergeVisibleDetectedWorktree,synthesizeSshGitWorktree,type SshWorktreeMetaCandidate,
  type SshWorktreeMetaIndex
} from './worktree-ipc-remote'

export function buildFolderDetectedWorktrees(store: Store, repo: Repo): DetectedWorktree[] {
  const settings = store.getSettings()
  return listFolderWorkspaces(store, repo).map((worktree) =>
    toDetectedWorktree({
      repo,
      worktree,
      meta: store.getWorktreeMeta(worktree.id),
      settings,
      knownOrcaLayouts: [],
      isLegacyRepoForVisibility: true
    })
  )
}

export function listVisibleFolderWorkspaces(store: Store, repo: Repo): Worktree[] {
  return buildFolderDetectedWorktrees(store, repo)
    .filter((worktree) => worktree.visible)
    .map((worktree) => {
      const meta = store.getWorktreeMeta(worktree.id)
      const ownershipUpdates = getProjectHostSetupMetaUpdates(store, repo, meta)
      const repairedMeta =
        meta && Object.keys(ownershipUpdates).length === 0
          ? meta
          : store.setWorktreeMeta(worktree.id, ownershipUpdates)
      return mergeFolderWorkspace(repo, worktree.id, repairedMeta)
    })
}

export function createFolderWorkspace(
  args: CreateWorktreeArgsWithSystemProvenance,
  repo: Repo,
  store: Store
): CreateWorktreeResult {
  const now = Date.now()
  const instanceId = randomUUID()
  const worktreeId = getFolderWorkspaceInstanceId(repo, instanceId)
  const meta = store.setWorktreeMeta(worktreeId, {
    instanceId,
    ...(store.getProjectHostSetups
      ? getProjectHostSetupWorktreeMeta(store.getProjectHostSetups(), repo)
      : {}),
    displayName: args.displayName || args.name,
    lastActivityAt: now,
    createdAt: now,
    orcaCreatedAt: now,
    orcaCreationSource: 'desktop',
    ...(args.cliProvenance ? { cliProvenance: args.cliProvenance } : {}),
    ...(args.createdWithAgent ? { createdWithAgent: args.createdWithAgent } : {}),
    ...(args.linkedIssue !== undefined ? { linkedIssue: args.linkedIssue } : {}),
    ...(args.linkedPR !== undefined ? { linkedPR: args.linkedPR } : {}),
    ...(args.linkedLinearIssue !== undefined ? { linkedLinearIssue: args.linkedLinearIssue } : {}),
    ...(args.linkedLinearIssueWorkspaceId !== undefined
      ? { linkedLinearIssueWorkspaceId: args.linkedLinearIssueWorkspaceId }
      : {}),
    ...(args.linkedLinearIssueOrganizationUrlKey !== undefined
      ? { linkedLinearIssueOrganizationUrlKey: args.linkedLinearIssueOrganizationUrlKey }
      : {}),
    ...(args.manualOrder !== undefined ? { manualOrder: args.manualOrder } : {}),
    ...(args.workspaceStatus !== undefined ? { workspaceStatus: args.workspaceStatus } : {}),
    ...(args.linkedGitLabIssue !== undefined ? { linkedGitLabIssue: args.linkedGitLabIssue } : {}),
    ...(args.linkedGitLabMR !== undefined ? { linkedGitLabMR: args.linkedGitLabMR } : {}),
    ...(args.linkedBitbucketPR !== undefined ? { linkedBitbucketPR: args.linkedBitbucketPR } : {}),
    ...(args.linkedAzureDevOpsPR !== undefined
      ? { linkedAzureDevOpsPR: args.linkedAzureDevOpsPR }
      : {}),
    ...(args.linkedGiteaPR !== undefined ? { linkedGiteaPR: args.linkedGiteaPR } : {}),
    ...(args.linkedWorkItem !== undefined ? { linkedWorkItem: args.linkedWorkItem } : {}),
    ...(args.linkedTaskSourceContext !== undefined
      ? { linkedTaskSourceContext: args.linkedTaskSourceContext }
      : {})
  })
  return { worktree: mergeFolderWorkspace(repo, worktreeId, meta) }
}

export function buildDisconnectedDetectedWorktrees(
  store: Store,
  repo: Repo,
  worktrees: Worktree[]
): DetectedWorktree[] {
  const settings = store.getSettings()
  const agentScratchWorktreePathMatcher = createAgentScratchWorktreePathMatcher([
    repo.path,
    ...worktrees.map((worktree) => worktree.path)
  ])
  const detected = worktrees.map((worktree) => {
    const meta = store.getWorktreeMeta(worktree.id)
    const detected = toDetectedWorktree({
      repo,
      worktree,
      meta,
      settings,
      knownOrcaLayouts: [],
      isLegacyRepoForVisibility: true,
      agentScratchWorktreePathMatcher
    })
    return applyMetadataFallbackVisibility(detected)
  })
  return projectResolvedWorktreeLineage(detected, store.getAllWorktreeLineage?.() ?? {})
}

export function hasConflictingStoredWorktreeOwner(
  store: Store,
  repo: Repo,
  worktreeIds: readonly string[]
): boolean {
  const expectedHostId = getRepoExecutionHostId(repo)
  const repoOwnerCount = store.getRepos().filter((candidate) => candidate.id === repo.id).length
  return worktreeIds.some((worktreeId) => {
    const meta = store.getWorktreeMeta(worktreeId)
    return !!meta && (meta.hostId ? meta.hostId !== expectedHostId : repoOwnerCount > 1)
  })
}

export type RepoOwnershipEvidence =
  | { status: 'owned'; hostId: ExecutionHostId }
  | { status: 'malformed' }
  | { status: 'contradictory' }

export function resolveRepoOwnershipEvidence(repo: Repo): RepoOwnershipEvidence {
  const hasExplicitHost = repo.executionHostId !== null && repo.executionHostId !== undefined
  const explicitHost = hasExplicitHost ? parseExecutionHostId(repo.executionHostId) : null
  if (hasExplicitHost && !explicitHost) {
    return { status: 'malformed' }
  }
  const hasConnection = repo.connectionId !== null && repo.connectionId !== undefined
  const connectionId = hasConnection ? repo.connectionId?.trim() : null
  if (hasConnection && !connectionId) {
    return { status: 'malformed' }
  }
  const connectionHostId = connectionId ? toSshExecutionHostId(connectionId) : null
  if (explicitHost && connectionHostId && explicitHost.id !== connectionHostId) {
    return { status: 'contradictory' }
  }
  return {
    status: 'owned',
    hostId: explicitHost?.id ?? connectionHostId ?? LOCAL_EXECUTION_HOST_ID
  }
}

export function findExactRepoOwner(
  store: Store,
  repoId: string,
  executionHostId?: ExecutionHostId
): Repo | undefined {
  const candidates = store.getRepos().filter((repo) => repo.id === repoId)
  const evidence = candidates.map(resolveRepoOwnershipEvidence)
  if (evidence.some((owner) => owner.status !== 'owned')) {
    return undefined
  }
  const matches = candidates.filter((_, index) => {
    const owner = evidence[index]
    return (
      owner?.status === 'owned' &&
      (executionHostId === undefined || owner.hostId === executionHostId)
    )
  })
  return matches.length === 1 ? matches[0] : undefined
}

export function isCapturedRepoCurrent(
  store: Store,
  repo: Repo,
  executionHostId?: ExecutionHostId
): boolean {
  const current = findExactRepoOwner(store, repo.id, executionHostId)
  return (
    current !== undefined &&
    current.path === repo.path &&
    (current.connectionId ?? null) === (repo.connectionId ?? null) &&
    (current.executionHostId ?? null) === (repo.executionHostId ?? null)
  )
}

export async function listDetectedWorktreesForCapturedRepo(
  store: Store,
  repo: Repo,
  isCurrent: () => boolean,
  capturedProvider = repo.connectionId ? getSshGitProvider(repo.connectionId) : undefined,
  providerAbort?: { signal: AbortSignal; status: () => 'canceled' | 'timed-out' }
): Promise<DetectedWorktreeListResult | { providerAbortStatus: 'canceled' | 'timed-out' } | null> {
  const abortedResult = () =>
    providerAbort?.signal.aborted
      ? ({ providerAbortStatus: providerAbort.status() } as const)
      : undefined
  const sshWorktreeMetaIndex = repo.connectionId
    ? createSshWorktreeMetaIndex(Object.entries(store.getAllWorktreeMeta()))
    : new Map()

  try {
    let gitWorktrees: GitWorktreeInfo[]
    let freshScan = true
    if (isFolderRepo(repo)) {
      if (!isCurrent()) {
        return null
      }
      const folderWorkspaceIds = Object.keys(store.getAllWorktreeMeta()).filter((worktreeId) =>
        isFolderWorkspaceIdForRepo(repo, worktreeId)
      )
      if (hasConflictingStoredWorktreeOwner(store, repo, folderWorkspaceIds)) {
        return {
          repoId: repo.id,
          authoritative: false,
          source: 'metadata-fallback',
          worktrees: []
        }
      }
      return {
        repoId: repo.id,
        authoritative: true,
        source: 'git',
        worktrees: projectResolvedWorktreeLineage(
          buildFolderDetectedWorktrees(store, repo),
          store.getAllWorktreeLineage?.() ?? {}
        )
      }
    }
    if (repo.connectionId) {
      if (!capturedProvider) {
        const aborted = abortedResult()
        if (aborted) {
          return aborted
        }
        if (!isCurrent()) {
          return null
        }
        const worktrees = listDisconnectedSshWorktrees(store, repo, sshWorktreeMetaIndex)
        return {
          repoId: repo.id,
          authoritative: false,
          source: 'metadata-fallback',
          worktrees: buildDisconnectedDetectedWorktrees(store, repo, worktrees)
        }
      }
      gitWorktrees = await capturedProvider.listWorktrees(repo.path, {
        signal: providerAbort?.signal
      })
    } else {
      const scan = await listDetectedGitWorktrees(store, repo)
      gitWorktrees = scan.gitWorktrees
      freshScan = scan.fresh
    }
    const aborted = abortedResult()
    if (aborted) {
      return aborted
    }
    if (!isCurrent()) {
      return null
    }
    const listedWorktreeIds = gitWorktrees.map((worktree) => `${repo.id}::${worktree.path}`)
    if (hasConflictingStoredWorktreeOwner(store, repo, listedWorktreeIds)) {
      return {
        repoId: repo.id,
        authoritative: false,
        source: 'metadata-fallback',
        worktrees: []
      }
    }
    if (freshScan) {
      rememberLocalWorktreeRoots(store, repo, gitWorktrees)
      pruneLineageForMissingRepoWorktrees(store, repo, gitWorktrees)
    }
    loggedWorktreeListFailures.delete(`${repo.id}:${repo.path}`)
    return {
      repoId: repo.id,
      authoritative: true,
      source: 'git',
      worktrees: buildDetectedGitWorktrees(store, repo, gitWorktrees)
    }
  } catch (err) {
    const aborted = abortedResult()
    if (aborted) {
      return aborted
    }
    if (!isCurrent()) {
      return null
    }
    warnOnce(
      loggedWorktreeListFailures,
      `${repo.id}:${repo.path}`,
      `[worktrees] failed to list detected worktrees for repo "${repo.displayName}" (${repo.id}) at ${repo.path}`,
      err
    )
    if (repo.connectionId) {
      const worktrees = listDisconnectedSshWorktrees(store, repo, sshWorktreeMetaIndex)
      return {
        repoId: repo.id,
        authoritative: false,
        source: 'metadata-fallback',
        worktrees: buildDisconnectedDetectedWorktrees(store, repo, worktrees)
      }
    }
    return { repoId: repo.id, authoritative: false, source: 'metadata-fallback', worktrees: [] }
  }
}
