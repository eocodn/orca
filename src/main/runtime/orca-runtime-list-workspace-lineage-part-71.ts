import {
  randomUUID,
  type GitWorktreeInfo,
  type Repo,
  type WorkspaceLineage,
  type WorkspaceKey,
  getRepoExecutionHostId,
  splitWorktreeIdForFilesystem,
  isFolderRepo,
  isPathInsideOrEqual,
  isWorkspaceKey,
  parseWorkspaceKey,
  worktreeWorkspaceKey,
  projectResolvedWorktreeLineage,
  getLocalProjectWorktreeGitOptionsForRuntime,
  resolveLocalProjectRuntimeForRepo,
  resolveLocalProjectRuntimesForRepos,
  type ProjectExecutionRuntimeResolution,
  listRepoWorktrees,
  type Store,
  mergeWorktree,
  areWorktreePathsEqual,
  getSshGitProvider,
  getSshGitProviderGeneration,
  resolveWorktreeScanCacheTtlMs,
  runtimePathsEqual,
  withTimeout,
  listRuntimeFolderWorkspaces,
  getAgentLaunchPlatformForRepo,
  type ResolvedWorktree,
  type RuntimeWorktreeScanResult,
  type ResolvedWorktreeSnapshot
} from './orca-runtime-symbols'
import { OrcaRuntimeResolveWorkspaceParentSelectorPart70 } from './orca-runtime-resolve-workspace-parent-selector-part-70'

export class OrcaRuntimeListWorkspaceLineagePart71 extends OrcaRuntimeResolveWorkspaceParentSelectorPart70 {
  async listWorkspaceLineage(): Promise<Record<WorkspaceKey, WorkspaceLineage>> {
    return this.store?.getAllWorkspaceLineage?.() ?? {}
  }

  // Why: one selector grammar, so connection-scoped resolution can narrow the same
  // candidate set instead of reimplementing (and diverging from) the matching rules.
  protected selectReposBySelector(selector: string): Repo[] {
    const repos = this.store?.getRepos() ?? []
    if (selector.startsWith('id:')) {
      return repos.filter((repo) => repo.id === selector.slice(3))
    }
    if (selector.startsWith('path:')) {
      return repos.filter((repo) => runtimePathsEqual(repo.path, selector.slice(5)))
    }
    if (selector.startsWith('name:')) {
      return repos.filter((repo) => repo.displayName === selector.slice(5))
    }
    return repos.filter(
      (repo) =>
        repo.id === selector ||
        runtimePathsEqual(repo.path, selector) ||
        repo.displayName === selector
    )
  }
  protected async resolveRepoSelector(selector: string): Promise<Repo> {
    if (!this.store) {
      throw new Error('repo_not_found')
    }
    const candidates = this.selectReposBySelector(selector)

    if (candidates.length === 1) {
      return candidates[0]
    }
    if (candidates.length > 1) {
      throw new Error('selector_ambiguous')
    }
    throw new Error('repo_not_found')
  }
  protected requireStore(): Store {
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }
    return this.store as unknown as Store
  }
  protected buildResolvedWorktreeFromId(worktreeId: string): ResolvedWorktree | null {
    const parsed = splitWorktreeIdForFilesystem(worktreeId)
    if (!parsed?.repoId || !parsed.worktreePath) {
      return null
    }
    const repo = this.store?.getRepos().find((entry) => entry.id === parsed.repoId)
    const git = {
      path: parsed.worktreePath,
      head: '',
      branch: '',
      isBare: false,
      isMainWorktree: repo ? areWorktreePathsEqual(parsed.worktreePath, repo.path) : false
    }
    const meta = this.store?.getWorktreeMeta(worktreeId)
    const merged = {
      ...mergeWorktree(parsed.repoId, git, meta, repo?.displayName),
      ...(repo ? { hostId: meta?.hostId ?? getRepoExecutionHostId(repo) } : {})
    }
    return {
      ...merged,
      id: worktreeId,
      parentWorktreeId: null,
      childWorktreeIds: [],
      lineage: null,
      git,
      displayName: merged.displayName,
      comment: merged.comment
    }
  }
  protected listKnownResolvedWorktreesForExplicitTarget(
    targetWorktreeId: string,
    targetWorktree: ResolvedWorktree | null
  ): ResolvedWorktree[] {
    if (!this.store || !targetWorktree) {
      return []
    }
    const target = splitWorktreeIdForFilesystem(targetWorktreeId)
    if (!target?.repoId || !target.worktreePath) {
      return []
    }
    const worktreeIds = new Set(
      Object.keys(this.store.getAllWorktreeMeta()).filter((worktreeId) => {
        const parsed = splitWorktreeIdForFilesystem(worktreeId)
        return (
          parsed?.repoId === target.repoId &&
          Boolean(parsed.worktreePath) &&
          (isPathInsideOrEqual(target.worktreePath, parsed.worktreePath) ||
            isPathInsideOrEqual(parsed.worktreePath, target.worktreePath))
        )
      })
    )
    worktreeIds.add(targetWorktreeId)

    const resolved: ResolvedWorktree[] = []
    for (const worktreeId of worktreeIds) {
      const worktree =
        worktreeId === targetWorktreeId
          ? targetWorktree
          : this.buildResolvedWorktreeFromId(worktreeId)
      if (worktree) {
        resolved.push(worktree)
      }
    }
    return resolved
  }
  protected async listResolvedWorktrees(): Promise<ResolvedWorktree[]> {
    return (await this.listResolvedWorktreeSnapshot()).worktrees
  }
  protected async listResolvedWorktreeSnapshot(): Promise<ResolvedWorktreeSnapshot> {
    if (!this.store) {
      return { worktrees: [], platformByRepoId: new Map() }
    }
    const now = Date.now()
    if (
      this.worktreeResolutionState.resolvedCache &&
      this.worktreeResolutionState.resolvedCache.expiresAt > now
    ) {
      return this.worktreeResolutionState.resolvedCache
    }
    const generation = this.worktreeResolutionState.resolvedGeneration
    if (this.worktreeResolutionState.resolvedInFlight?.generation === generation) {
      return this.worktreeResolutionState.resolvedInFlight.promise
    }

    const promise = this.computeResolvedWorktrees(generation)
    this.worktreeResolutionState.resolvedInFlight = { generation, promise }
    try {
      return await promise
    } finally {
      if (this.worktreeResolutionState.resolvedInFlight?.promise === promise) {
        this.worktreeResolutionState.resolvedInFlight = null
      }
    }
  }
  protected async computeResolvedWorktrees(generation: number): Promise<ResolvedWorktreeSnapshot> {
    if (!this.store) {
      return { worktrees: [], platformByRepoId: new Map() }
    }
    const now = Date.now()
    const metaById = this.store.getAllWorktreeMeta() ?? {}
    const repos = this.store.getRepos()
    const projectRuntimeByRepoId = resolveLocalProjectRuntimesForRepos(this.requireStore(), repos)
    const platformByRepoId = new Map(
      repos.map((repo) => [
        repo.id,
        getAgentLaunchPlatformForRepo(repo, projectRuntimeByRepoId.get(repo.id))
      ])
    )
    const perRepoWorktrees = await Promise.all(
      repos.map(async (repo) => {
        if (isFolderRepo(repo)) {
          return listRuntimeFolderWorkspaces(this.requireStore(), repo).map((worktree) => ({
            ...worktree,
            hostId: worktree.hostId ?? getRepoExecutionHostId(repo),
            parentWorktreeId: null,
            childWorktreeIds: [],
            lineage: null,
            git: {
              path: worktree.path,
              head: worktree.head,
              branch: worktree.branch,
              isBare: worktree.isBare,
              isMainWorktree: worktree.isMainWorktree
            },
            displayName: worktree.displayName,
            comment: worktree.comment
          }))
        }
        // Why: mobile startup shares this path, so a slow repo scan degrades one repo's metadata instead of blocking all session loading.
        const scan = await withTimeout(
          this.listRepoWorktreesForResolution(repo, projectRuntimeByRepoId),
          RESOLVED_WORKTREE_REPO_TIMEOUT_MS,
          { ok: false, worktrees: [] }
        )
        const gitWorktrees = scan.worktrees
        if (scan.ok) {
          this.pruneLineageForMissingRepoWorktrees(repo, gitWorktrees)
        }
        return gitWorktrees.map((gitWorktree) => {
          const worktreeId = `${repo.id}::${gitWorktree.path}`
          // Why: lineage validation needs a durable instance ID even when the runtime sees a workspace before renderer discovery-stamp.
          const existingMeta = metaById[worktreeId]
          const meta =
            existingMeta && existingMeta.instanceId
              ? existingMeta
              : this.store?.setWorktreeMeta(worktreeId, {})
          const merged = {
            ...mergeWorktree(repo.id, gitWorktree, meta, repo.displayName),
            hostId: existingMeta?.hostId ?? meta?.hostId ?? getRepoExecutionHostId(repo)
          }
          return {
            ...merged,
            parentWorktreeId: null,
            childWorktreeIds: [],
            lineage: null,
            git: {
              path: gitWorktree.path,
              head: gitWorktree.head,
              branch: gitWorktree.branch,
              isBare: gitWorktree.isBare,
              isMainWorktree: gitWorktree.isMainWorktree
            },
            displayName: merged.displayName,
            comment: merged.comment
          }
        })
      })
    )
    const worktrees = projectResolvedWorktreeLineage(
      perRepoWorktrees.flat(),
      this.store?.getAllWorktreeLineage?.() ?? {}
    )
    // Why: short TTL avoids shelling out on every frequent poll while still catching worktree changes made outside Orca.
    if (generation === this.worktreeResolutionState.resolvedGeneration) {
      this.worktreeResolutionState.resolvedCache = {
        worktrees,
        platformByRepoId,
        expiresAt: now + RESOLVED_WORKTREE_CACHE_TTL_MS
      }
    }
    return { worktrees, platformByRepoId }
  }
  protected pruneLineageForMissingRepoWorktrees(repo: Repo, gitWorktrees: GitWorktreeInfo[]): void {
    const store = this.store
    if (
      !store ||
      typeof store.getAllWorktreeLineage !== 'function' ||
      typeof store.removeWorktreeLineage !== 'function'
    ) {
      return
    }
    const liveIds = new Set(gitWorktrees.map((worktree) => `${repo.id}::${worktree.path}`))
    const repoPrefix = `${repo.id}::`
    for (const childWorkspaceKey of Object.keys(store.getAllWorkspaceLineage?.() ?? {})) {
      const childScope = parseWorkspaceKey(childWorkspaceKey)
      if (
        childScope?.type === 'worktree' &&
        childScope.worktreeId.startsWith(repoPrefix) &&
        !liveIds.has(childScope.worktreeId)
      ) {
        if (isWorkspaceKey(childWorkspaceKey)) {
          store.removeWorkspaceLineage?.(childWorkspaceKey)
        }
      }
    }
    for (const [childId, lineage] of Object.entries(store.getAllWorktreeLineage())) {
      if (childId.startsWith(repoPrefix) && !liveIds.has(childId)) {
        // Why: once a scan proves the child gone, purge stale lineage so it can't survive into a same-path replacement checkout.
        store.removeWorktreeLineage(childId)
        store.removeWorkspaceLineage?.(worktreeWorkspaceKey(childId))
      }
      if (
        lineage.parentWorktreeId.startsWith(repoPrefix) &&
        !liveIds.has(lineage.parentWorktreeId)
      ) {
        const parentMeta = store.getWorktreeMeta(lineage.parentWorktreeId)
        if (!parentMeta || parentMeta.instanceId === lineage.parentWorktreeInstanceId) {
          // Why: a missing parent path needs one fresh identity so same-path replacement checkouts can't validate old lineage.
          store.setWorktreeMeta(lineage.parentWorktreeId, { instanceId: randomUUID() })
        }
      }
    }
  }
  protected async listRepoWorktreesForResolution(
    repo: Repo,
    projectRuntimeByRepoId?: ReadonlyMap<string, ProjectExecutionRuntimeResolution>
  ): Promise<RuntimeWorktreeScanResult> {
    const now = Date.now()
    const generation = this.worktreeResolutionState.scanGenerations.get(repo.id) ?? 0
    const projectRuntime = projectRuntimeByRepoId
      ? projectRuntimeByRepoId.get(repo.id)
      : !repo.connectionId
        ? resolveLocalProjectRuntimeForRepo(this.requireStore(), repo)
        : undefined
    const runtimeKey = projectRuntime
      ? projectRuntime.status === 'resolved'
        ? projectRuntime.runtime.cacheKey
        : projectRuntime.repair.cacheKey
      : repo.connectionId
        ? `ssh:${repo.connectionId}:${getSshGitProviderGeneration(repo.connectionId)}`
        : 'local:default'
    const cached = this.worktreeResolutionState.scanCache.get(repo.id)
    if (
      cached?.generation === generation &&
      cached.runtimeKey === runtimeKey &&
      cached.expiresAt > now
    ) {
      return cached.result
    }
    const inFlight = this.worktreeResolutionState.scanInFlight.get(repo.id)
    if (inFlight?.generation === generation && inFlight.runtimeKey === runtimeKey) {
      return inFlight.promise
    }
    const promise = this.listRepoWorktreesForResolutionUncached(repo, projectRuntime)
    this.worktreeResolutionState.scanInFlight.set(repo.id, { generation, runtimeKey, promise })
    try {
      const result = await promise
      if (
        result.ok &&
        generation === (this.worktreeResolutionState.scanGenerations.get(repo.id) ?? 0) &&
        this.worktreeResolutionState.scanInFlight.get(repo.id)?.promise === promise
      ) {
        this.worktreeResolutionState.scanCache.set(repo.id, {
          generation,
          runtimeKey,
          result,
          expiresAt: Date.now() + resolveWorktreeScanCacheTtlMs(repo)
        })
      }
      return result
    } finally {
      if (this.worktreeResolutionState.scanInFlight.get(repo.id)?.promise === promise) {
        this.worktreeResolutionState.scanInFlight.delete(repo.id)
      }
    }
  }
  protected async listRepoWorktreesForResolutionUncached(
    repo: Repo,
    projectRuntime: ProjectExecutionRuntimeResolution | undefined
  ): Promise<RuntimeWorktreeScanResult> {
    if (!repo.connectionId) {
      return {
        ok: true,
        worktrees: await listRepoWorktrees(
          repo,
          getLocalProjectWorktreeGitOptionsForRuntime(repo, projectRuntime)
        )
      }
    }
    const provider = getSshGitProvider(repo.connectionId)
    if (!provider) {
      return { ok: false, worktrees: this.listStoredSshWorktreesForResolution(repo) }
    }
    try {
      return { ok: true, worktrees: await provider.listWorktrees(repo.path) }
    } catch {
      return { ok: false, worktrees: this.listStoredSshWorktreesForResolution(repo) }
    }
  }
}
import {
  RESOLVED_WORKTREE_CACHE_TTL_MS,
  RESOLVED_WORKTREE_REPO_TIMEOUT_MS
} from './orca-runtime-tail-constants'
