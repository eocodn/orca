import { randomUUID } from 'node:crypto'
import { DEFAULT_REPO_BADGE_COLOR } from '../../shared/constants'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId
} from '../../shared/execution-host'
import type {
  HostRepoCatalogSnapshot,
  ListReposForExecutionHostArgs
} from '../../shared/host-repo-catalog-contract'
import {
  getProjectHostSetupForRepo,
  getProjectIdForProviderIdentity
} from '../../shared/project-host-setup-projection'
import { isFolderRepo } from '../../shared/repo-kind'
import { isAdmissibleDirectSshAuthority } from '../../shared/ssh-retained-payload-admission'
import type {
  ProjectHostSetupExistingFolderArgs,
  ProjectHostSetupResult,
  Repo
} from '../../shared/types'
import { getGitRepoRoot, getLinkedWorktreeMainRepoRoot, getRepoName, isGitRepo } from '../git/repo'
import type { Store } from '../persistence'
import { getSshGitProvider } from '../providers/ssh-git-dispatch'
import { detectRepoIconAndUpstream } from '../repo-icon-autodetect'
import { isCurrentSshProviderAuthority } from '../ssh/ssh-provider-authority'
import { prepareLocalWorktreeRootForRepo } from '../worktree-root-preparation'

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
