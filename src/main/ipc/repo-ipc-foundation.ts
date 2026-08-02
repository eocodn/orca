import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { z } from 'zod'
import type { Store } from '../persistence'
import type {
  BaseRefSearchResult,
  Project,
  Repo,
  ProjectGroup,
  FolderWorkspace,
  ProjectGroupImportResult,
  ProjectUpdateArgs,
  ProjectHostSetupCreateArgs,
  ProjectHostSetupCreateResult,
  ProjectHostSetupDeleteArgs,
  ProjectHostSetupDeleteResult,
  ProjectHostSetupExistingFolderArgs,
  ProjectHostSetupResult,
  ProjectHostSetupUpdateArgs,
  ProjectHostSetupUpdateResult,
  NestedRepoScanResult,
  BaseRefDefaultResult,
  SparsePreset
} from '../../shared/types'
import type { FolderWorkspacePathStatusRequest } from '../../shared/folder-workspace-path-status'
import { isFolderRepo } from '../../shared/repo-kind'
import { DEFAULT_REPO_BADGE_COLOR } from '../../shared/constants'
import { normalizeRepoBadgeColor } from '../../shared/repo-badge-color'
import { sanitizeRepoIcon } from '../../shared/repo-icon'
import { normalizeRepoSourceControlAiOverrides } from '../../shared/source-control-ai'
import {
  isRuntimePathAbsolute,
  normalizeRuntimePathForComparison,
  relativePathInsideRoot
} from '../../shared/cross-platform-path'
import { isTuiAgent } from '../../shared/tui-agent-config'
import { TaskSourceContextSchema } from '../../shared/task-source-context-schema'
import { WorkspaceLinkedItemSchema } from '../../shared/workspace-linked-item-schema'
import { isWorkspaceLinkedItemSourceContextMatch } from '../../shared/workspace-linked-item-source-context'
import { invalidateAuthorizedRootsCache } from './filesystem-auth'
import type { ChildProcess } from 'node:child_process'
import { access, mkdir, readdir, rm } from 'node:fs/promises'
import { gitExecFileAsync, gitSpawn, nonInteractiveGitEnv } from '../git/runner'
import { isAbsolute, join, posix } from 'node:path'
import {
  cleanupClaimedCloneTarget,
  claimCloneTarget,
  deriveCloneRepoNameFromUrl,
  deriveValidatedClonePath,
  getClonePathComparisonKey
} from '../git/repo-clone-path'
import type { ClaimedCloneTarget } from '../git/repo-clone-path'
import { scanNestedRepos } from '../project-groups/nested-repo-discovery'
import {
  createNestedProjectGroupResolver,
  resolveNestedRepoSelection
} from '../project-groups/nested-repo-import'
import { createNestedRepoImportTargetResolver } from '../project-groups/nested-repo-import-target'
import {
  isGitRepo,
  getGitRepoRoot,
  getLinkedWorktreeMainRepoRoot,
  getRepoName,
  getBaseRefDefault,
  getRemoteCount,
  normalizeRefSearchQuery,
  parseAndFilterSearchRefDetails,
  parseRemoteCount,
  resolveDefaultBaseRefViaExec,
  buildSearchBaseRefsArgv,
  isForEachRefExcludeUnsupportedError,
  mergeBaseRefSearchResultGroups,
  searchBaseRefDetails
} from '../git/repo'
import { getSshGitProvider } from '../providers/ssh-git-dispatch'
import { getSshGitCapabilityCache } from '../git/git-capability-state'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import { getSshGitUsername, resolveLocalGitUsername } from '../git/git-username'
import { enrichRepoGitUsernames } from '../repo-git-username-enrichment'
import { getActiveMultiplexer } from './ssh'
import { normalizeSparseDirectories } from './sparse-checkout-directories'
import { track } from '../telemetry/client'
import { scheduleCurrentWorktreeBaseDirectoryWatcherSync } from './worktree-base-directory-watcher'
import { getCohortAtEmit } from '../telemetry/cohort-classifier'
import type { RepoMethod } from '../../shared/telemetry-events'
import type {
  HostRepoCatalogSnapshot,
  ListReposForExecutionHostArgs
} from '../../shared/host-repo-catalog-contract'
import { detectRepoIconAndUpstream } from '../repo-icon-autodetect'
import { enrichMissingRepoGitRemoteIdentities } from '../repo-git-remote-identity-enrichment'
import {
  getProjectHostSetupForRepo,
  getProjectIdForProviderIdentity
} from '../../shared/project-host-setup-projection'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  normalizeExecutionHostId,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../shared/execution-host'
import { joinRemotePath } from '../ssh/ssh-remote-platform'
import {
  assertFolderWorkspacePathUsable,
  getFolderWorkspacePathStatus,
  getFolderWorkspacePathStatusForPath
} from '../project-groups/folder-workspace-path-status'
import { getGitCloneFailureMessage } from '../../shared/git-clone-failure-message'
import { prepareLocalWorktreeRootForRepo } from '../worktree-root-preparation'
import { runWithGitReadCacheInvalidation } from '../git/status'
import { isAdmissibleDirectSshAuthority } from '../../shared/ssh-retained-payload-admission'
import { isCurrentSshProviderAuthority } from '../ssh/ssh-provider-authority'

// Why: `method` is the IPC entry point the user took, not what they added (never path/URL/name); repos:create → 'folder_picker'.
// Why: `isGitRepo` is a non-identifying git-vs-folder signal from the caller's detection; pass undefined when unknown, never default false.
// Why: it replaced onboarding_completed.is_git_repo, which lost meaning once repo selection left onboarding (1.4.46).
export function emitRepoAdded(method: RepoMethod, alreadyExisted: boolean, isGitRepo?: boolean): void {
  // Why: re-adding an existing repo isn't a new activation; suppress so re-picking a folder doesn't inflate repo_added.
  if (alreadyExisted) {
    return
  }
  // Why: read cohort AFTER store.addRepo() so the just-added repo is counted (docs/onboarding-funnel-cohort-addendum.md §Read-vs-write ordering).
  const props = {
    method,
    ...(isGitRepo === undefined ? {} : { is_git_repo: isGitRepo }),
    ...getCohortAtEmit()
  }
  track('repo_added', props)
}

export function hasValidCatalogSshAuthority(
  args: ListReposForExecutionHostArgs
): args is Extract<ListReposForExecutionHostArgs, { expectedAuthority: unknown }> {
  if (!('expectedAuthority' in args)) {
    return false
  }
  return isAdmissibleDirectSshAuthority(args.expectedAuthority)
}

export function repoHostContradictsConnection(repo: Repo): boolean {
  if (!repo.executionHostId || !repo.connectionId) {
    return false
  }
  const explicitHost = parseExecutionHostId(repo.executionHostId)
  return explicitHost?.kind !== 'ssh' || explicitHost.targetId !== repo.connectionId
}

export function getConsistentRepoCatalogForHost(
  repos: readonly Repo[],
  host: NonNullable<ReturnType<typeof parseExecutionHostId>>
): Repo[] | null {
  const hasContradiction = repos.some(
    (repo) =>
      repoHostContradictsConnection(repo) &&
      (getRepoExecutionHostId(repo) === host.id ||
        (host.kind === 'ssh' && repo.connectionId === host.targetId))
  )
  return hasContradiction ? null : repos.filter((repo) => getRepoExecutionHostId(repo) === host.id)
}
export async function listReposForExecutionHost(
  store: Store,
  args: ListReposForExecutionHostArgs
): Promise<HostRepoCatalogSnapshot> {
  const parsedHost = parseExecutionHostId(args?.executionHostId)
  const rejected = (
    reason: Extract<HostRepoCatalogSnapshot, { authoritative: false }>['reason']
  ): HostRepoCatalogSnapshot => ({
    authoritative: false,
    executionHostId: args.executionHostId,
    reason
  })
  if (!parsedHost || parsedHost.kind === 'runtime') {
    return rejected('rejected')
  }
  if (parsedHost.kind === 'local') {
    if ('expectedAuthority' in args) {
      return rejected('rejected')
    }
    const repos = getConsistentRepoCatalogForHost(store.getRepos(), parsedHost)
    if (!repos) {
      return rejected('rejected')
    }
    return {
      authoritative: true,
      authority: { kind: 'local', executionHostId: LOCAL_EXECUTION_HOST_ID },
      repos: structuredClone(repos)
    }
  }
  if (
    !hasValidCatalogSshAuthority(args) ||
    args.expectedAuthority.targetId !== parsedHost.targetId
  ) {
    return rejected('rejected')
  }
  const authority = { ...args.expectedAuthority }
  if (!isCurrentSshProviderAuthority(authority)) {
    return rejected('stale')
  }
  const provider = getSshGitProvider(parsedHost.targetId)
  if (!provider) {
    return rejected('unavailable')
  }
  const matchingRepos = getConsistentRepoCatalogForHost(store.getRepos(), parsedHost)
  if (!matchingRepos) {
    return rejected('rejected')
  }
  const repos = structuredClone(matchingRepos)
  await Promise.resolve()
  if (
    getSshGitProvider(parsedHost.targetId) !== provider ||
    !isCurrentSshProviderAuthority(authority)
  ) {
    return rejected('stale')
  }
  return {
    authoritative: true,
    authority: {
      kind: 'direct-ssh',
      executionHostId: parsedHost.id,
      ...authority
    },
    repos
  }
}

export function buildProjectHostSetupResult(store: Store, repo: Repo): ProjectHostSetupResult {
  const setup = getProjectHostSetupForRepo(store.getProjectHostSetups(), repo)
  const project = store.getProjects().find((entry) => entry.id === setup.projectId)
  if (!project) {
    throw new Error(`Project setup was created without a project record: ${setup.projectId}`)
  }
  return { project, setup, repo }
}

export function alignRepoWithRequestedProject(
  store: Store,
  repo: Repo,
  projectId: string,
  setupMethod: ProjectHostSetupExistingFolderArgs['setupMethod'] = 'imported-existing-folder',
  requestedProviderIdentity?: ProjectHostSetupExistingFolderArgs['projectProviderIdentity']
): ProjectHostSetupResult {
  let setup = getProjectHostSetupForRepo(store.getProjectHostSetups(), repo)
  if (setup.projectId !== projectId) {
    const project = store.getProjects().find((entry) => entry.id === projectId)
    // Why: the selected project can exist only on the source host, so its structured identity travels with the request.
    const identity = project?.providerIdentity ?? requestedProviderIdentity
    if (!identity || getProjectIdForProviderIdentity(identity) !== projectId) {
      throw new Error('Imported folder does not match the selected project identity.')
    }
    // Why: stamp the selected project's provider identity when the folder lacks upstream, so projection can merge it.
    const updated = store.updateRepo(repo.id, {
      upstream: {
        owner: identity.owner,
        repo: identity.repo,
        ...(identity.host ? { host: identity.host } : {})
      }
    })
    if (!updated) {
      throw new Error(`Project setup repo disappeared before it could be linked: ${repo.id}`)
    }
    repo = updated
    setup = getProjectHostSetupForRepo(store.getProjectHostSetups(), repo)
  }
  const updated = store.updateRepo(repo.id, { projectHostSetupMethod: setupMethod })
  if (!updated) {
    throw new Error(
      `Project setup repo disappeared before setup metadata could be linked: ${repo.id}`
    )
  }
  repo = updated
  return buildProjectHostSetupResult(store, repo)
}

export async function addLocalRepoFromPath(
  store: Store,
  path: string,
  kind: 'git' | 'folder' = 'git'
): Promise<{ repo: Repo; alreadyExisted: boolean } | { error: string }> {
  const repoKind = kind === 'folder' ? 'folder' : 'git'
  if (repoKind === 'git' && !isGitRepo(path)) {
    return { error: `Not a valid git repository: ${path}` }
  }

  const resolvedPath = repoKind === 'git' ? getGitRepoRoot(path) : path
  const pathKey = normalizeRuntimePathForComparison(path)
  const existing = store
    .getRepos()
    .find((repo) => !repo.connectionId && normalizeRuntimePathForComparison(repo.path) === pathKey)
  if (existing) {
    return { repo: existing, alreadyExisted: true }
  }

  const resolvedPathKey = normalizeRuntimePathForComparison(resolvedPath)
  if (resolvedPathKey !== pathKey) {
    const existingAfterRootResolve = store
      .getRepos()
      .find(
        (repo) =>
          !repo.connectionId && normalizeRuntimePathForComparison(repo.path) === resolvedPathKey
      )
    if (existingAfterRootResolve) {
      return { repo: existingAfterRootResolve, alreadyExisted: true }
    }
  }

  // Why: a linked worktree reports itself as its own toplevel, so the path checks above can't see that
  // it belongs to an already-tracked repo. Adding it anyway yields a second "ready" host setup on the
  // same project and host — a duplicate run-target row that resolves to a transient worktree path.
  if (repoKind === 'git') {
    const mainRepoRoot = getLinkedWorktreeMainRepoRoot(resolvedPath)
    if (mainRepoRoot) {
      const mainRepoKey = normalizeRuntimePathForComparison(mainRepoRoot)
      // Why !isFolderRepo: only a git-kind main checkout projects onto the same project as its
      // worktree, so matching a folder record would suppress the add without deduping anything.
      const trackedMainRepo = store
        .getRepos()
        .find(
          (repo) =>
            !repo.connectionId &&
            !isFolderRepo(repo) &&
            normalizeRuntimePathForComparison(repo.path) === mainRepoKey
        )
      if (trackedMainRepo) {
        return { repo: trackedMainRepo, alreadyExisted: true }
      }
    }
  }

  const detected = await detectRepoIconAndUpstream({ repoPath: resolvedPath, kind: repoKind })
  const repo: Repo = {
    id: randomUUID(),
    path: resolvedPath,
    displayName: getRepoName(resolvedPath),
    badgeColor: DEFAULT_REPO_BADGE_COLOR,
    ...detected,
    addedAt: Date.now(),
    kind: repoKind,
    ...(repoKind === 'git'
      ? {
          externalWorktreeVisibility: 'hide' as const,
          externalWorktreeVisibilityLegacy: false,
          // Why: new Add Project imports are explicit ready host setups; 'legacy-repo' is reserved for older records/projection.
          projectHostSetupMethod: 'imported-existing-folder' as const
        }
      : {})
  }

  store.addRepo(repo)
  await prepareLocalWorktreeRootForRepo(store, repo)
  return { repo, alreadyExisted: false }
}
