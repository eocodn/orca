import { type BaseRefSearchResult, type GitHubOwnerRepo, type Repo, type RuntimeRepoSearchRefs, isFolderRepo, isWindowsAbsolutePathLike, isWslUncPath, RuntimeRepoWorkItemCommands, getRepoSlug, getRepoUpstream, type HostedReviewCreationEligibility, type HostedReviewCreationEligibilityArgs, type HostedReviewInfo, getHostedReviewForBranchFromRepo, getHostedReviewCreationEligibilityFromRepo, getLocalProjectWorktreeGitOptions, resolveLocalProjectRuntimeForRepo, getBaseRefDefault, searchBaseRefDetails, getRemoteCount, normalizeRefSearchQuery, parseAndFilterSearchRefDetails, parseRemoteCount, resolveDefaultBaseRefViaExec, buildSearchBaseRefsArgv, isForEachRefExcludeUnsupportedError, mergeBaseRefSearchResultGroups, getSshGitCapabilityCache, getSshGitProvider, githubAvatarIcon, getAgentLaunchPlatformForRepo, type TerminalWorkspaceLaunchScope } from './orca-runtime-symbols'
import { OrcaRuntimeCreateRepoPart47 } from './orca-runtime-create-repo-part-47'

export class OrcaRuntimeReorderReposPart48 extends OrcaRuntimeCreateRepoPart47 {
  reorderRepos(orderedIds: string[]): { status: 'applied' | 'rejected' } {
    if (!this.store?.reorderRepos) {
      throw new Error('runtime_unavailable')
    }
    // Why: remote clients can race repo add/remove on the server just like
    // local drag-reorder can race another window. Let the store validate the
    // full permutation and signal a resync-worthy rejection.
    const applied = this.store.reorderRepos(orderedIds)
    if (!applied) {
      return { status: 'rejected' }
    }
    this.invalidateResolvedWorktreeCache()
    this.notifyReposChanged()
    return { status: 'applied' }
  }
  async searchRepoRefs(
    repoSelector: string,
    query: string,
    limit = DEFAULT_REPO_SEARCH_REFS_LIMIT
  ): Promise<RuntimeRepoSearchRefs> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error('invalid_limit')
    }
    const repo = await this.resolveRepoSelector(repoSelector)
    if (isFolderRepo(repo)) {
      return {
        refs: [],
        truncated: false
      }
    }
    const refDetails = repo.connectionId
      ? await this.searchRemoteRepoRefs(repo, query, limit + 1)
      : await searchBaseRefDetails(repo.path, query, limit + 1)
    return {
      refs: refDetails.slice(0, limit).map((entry) => entry.refName),
      refDetails: refDetails.slice(0, limit),
      truncated: refDetails.length > limit
    }
  }
  async getRepoBaseRefDefault(
    repoSelector: string
  ): Promise<{ defaultBaseRef: string | null; remoteCount: number }> {
    const repo = await this.resolveRepoSelector(repoSelector)
    if (isFolderRepo(repo)) {
      return { defaultBaseRef: null, remoteCount: 0 }
    }
    if (repo.connectionId) {
      return this.getRemoteRepoBaseRefDefault(repo)
    }
    const [defaultBaseRef, remoteCount] = await Promise.all([
      getBaseRefDefault(repo.path),
      getRemoteCount(repo.path)
    ])
    return { defaultBaseRef, remoteCount }
  }
  protected async getRemoteRepoBaseRefDefault(
    repo: Repo
  ): Promise<{ defaultBaseRef: string | null; remoteCount: number }> {
    const provider = repo.connectionId ? getSshGitProvider(repo.connectionId) : null
    if (!provider) {
      return { defaultBaseRef: null, remoteCount: 0 }
    }
    const [defaultBaseRef, remoteCount] = await Promise.all([
      resolveDefaultBaseRefViaExec(async (argv) => {
        try {
          return await provider.exec(argv, repo.path)
        } catch (err) {
          if (argv[0] === 'symbolic-ref') {
            console.warn('[runtime:repo.baseRefDefault] SSH symbolic-ref failed', {
              path: repo.path,
              err
            })
          }
          throw err
        }
      }),
      provider
        .exec(['remote'], repo.path)
        .then((result) => parseRemoteCount(result.stdout))
        .catch((err) => {
          console.warn('[runtime:repo.baseRefDefault] SSH git remote count failed', {
            path: repo.path,
            err
          })
          return 0
        })
    ])
    return { defaultBaseRef, remoteCount }
  }
  protected async searchRemoteRepoRefs(
    repo: Repo,
    query: string,
    limit: number
  ): Promise<BaseRefSearchResult[]> {
    const provider = repo.connectionId ? getSshGitProvider(repo.connectionId) : null
    if (!provider) {
      return []
    }
    const normalizedQuery = normalizeRefSearchQuery(query)
    try {
      const remotesResult = await provider.exec(['remote'], repo.path).catch(() => ({ stdout: '' }))
      const remotes = remotesResult.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      const capabilities = getSshGitCapabilityCache(provider)
      const runSearch = async (patternGroup?: 'segmented' | 'branchRoot'): Promise<string> => {
        return capabilities.runWithFallback(
          'for-each-ref-exclude',
          async () =>
            (
              await provider.exec(
                buildSearchBaseRefsArgv(normalizedQuery, limit, {
                  remoteNames: remotes,
                  patternGroup
                }),
                repo.path
              )
            ).stdout,
          async () =>
            (
              await provider.exec(
                buildSearchBaseRefsArgv(normalizedQuery, limit, {
                  excludeRemoteHead: false,
                  remoteNames: remotes,
                  patternGroup
                }),
                repo.path
              )
            ).stdout,
          isForEachRefExcludeUnsupportedError
        )
      }
      const searchTokens = normalizedQuery.split('/').filter((token) => token.length > 0)
      if (searchTokens.length > 1) {
        const results = await Promise.all([runSearch('segmented'), runSearch('branchRoot')])
        return mergeBaseRefSearchResultGroups(
          results.map((stdout) => parseAndFilterSearchRefDetails(stdout, limit, remotes)),
          limit
        )
      }
      return parseAndFilterSearchRefDetails(await runSearch(), limit, remotes)
    } catch (err) {
      console.warn('[runtime:repo.searchRefs] SSH for-each-ref failed', {
        path: repo.path,
        err
      })
      return []
    }
  }
  protected async resolveHostedReviewTarget(args: {
    repoSelector: string
    worktreeSelector?: string
  }): Promise<{ repo: Repo; repoPath: string }> {
    const repo = await this.resolveRepoSelector(args.repoSelector)
    if (!args.worktreeSelector) {
      return { repo, repoPath: repo.path }
    }

    const worktree = await this.resolveWorktreeSelector(args.worktreeSelector)
    if (worktree.repoId !== repo.id) {
      throw new Error('Access denied: worktree does not belong to repository')
    }
    return { repo, repoPath: worktree.path }
  }
  protected getHostedReviewExecutionOptions(
    repo: Repo
  ): { localGitExecOptions: { wslDistro?: string } } | undefined {
    const localGitOptions = this.getLocalGitExecutionOptionArgs(repo)[0] ?? {}
    return Object.keys(localGitOptions).length > 0
      ? { localGitExecOptions: localGitOptions }
      : undefined
  }
  protected getLocalGitExecutionOptionArgs(repo: Repo): [] | [{ wslDistro?: string }] {
    const localGitOptions = getLocalProjectWorktreeGitOptions(this.requireStore(), repo)
    return Object.keys(localGitOptions).length > 0 ? [localGitOptions] : []
  }
  protected getAgentLaunchPlatformForRepo(repo: Repo): NodeJS.Platform {
    const projectRuntime = repo.connectionId
      ? undefined
      : resolveLocalProjectRuntimeForRepo(this.requireStore(), repo)
    return getAgentLaunchPlatformForRepo(repo, projectRuntime)
  }
  protected getAgentLaunchPlatformForWorkspace(scope: TerminalWorkspaceLaunchScope): NodeJS.Platform {
    if (scope.repo) {
      return this.getAgentLaunchPlatformForRepo(scope.repo)
    }
    if (scope.connectionId) {
      return isWindowsAbsolutePathLike(scope.path) ? 'win32' : 'linux'
    }
    return isWslUncPath(scope.path) ? 'linux' : process.platform
  }
  async getRepoSlug(repoSelector: string): Promise<GitHubOwnerRepo | null> {
    const repo = await this.resolveRepoSelector(repoSelector)
    const options = this.getHostedReviewExecutionOptions(repo)
    return options
      ? getRepoSlug(repo.path, repo.connectionId ?? null, options)
      : getRepoSlug(repo.path, repo.connectionId ?? null)
  }
  async getRepoUpstream(repoSelector: string): Promise<GitHubOwnerRepo | null> {
    const repo = await this.resolveRepoSelector(repoSelector)
    const options = this.getHostedReviewExecutionOptions(repo)
    return options
      ? getRepoUpstream(repo.path, repo.connectionId ?? null, options)
      : getRepoUpstream(repo.path, repo.connectionId ?? null)
  }

  // Why: repos added before fork detection existed have no stored `upstream`, so
  // their avatar/badge would never self-correct. Resolve it once at startup for
  // local git repos; SSH repos resolve lazily when their settings open (their
  // connection may not be up yet). Sequential to respect the gh rate limit;
  // failures leave `upstream` unset so the next launch retries.
  protected async backfillForkUpstreams(): Promise<void> {
    try {
      const store = this.requireStore()
      let changed = false
      for (const repo of store.getRepos()) {
        if (repo.upstream !== undefined || repo.kind === 'folder' || repo.connectionId) {
          continue
        }
        let upstream: GitHubOwnerRepo | null
        try {
          upstream = await getRepoUpstream(repo.path, null)
        } catch {
          continue
        }
        const updates: Partial<Repo> = { upstream: upstream ?? null }
        // Only migrate the auto-detected origin avatar; never touch a chosen icon.
        if (upstream && repo.repoIcon?.type === 'image' && repo.repoIcon.source === 'github') {
          updates.repoIcon = githubAvatarIcon(upstream)
        }
        store.updateRepo(repo.id, updates)
        changed = true
      }
      if (changed) {
        this.notifyReposChanged()
      }
    } catch {
      // Best-effort startup backfill; never disrupt launch.
    }
  }

  protected readonly repoWorkItemCommands = new RuntimeRepoWorkItemCommands({
    resolveRepoSelector: (selector) => this.resolveRepoSelector(selector),
    getLocalGitExecutionOptionArgs: (repo) => this.getLocalGitExecutionOptionArgs(repo),
    getHostedReviewExecutionOptions: (repo) => this.getHostedReviewExecutionOptions(repo)
  })

  listRepoWorkItems: RuntimeRepoWorkItemCommands['listRepoWorkItems'] =
    this.repoWorkItemCommands.listRepoWorkItems.bind(this.repoWorkItemCommands)
  listRepoIssues: RuntimeRepoWorkItemCommands['listRepoIssues'] =
    this.repoWorkItemCommands.listRepoIssues.bind(this.repoWorkItemCommands)
  getRepoWorkItem: RuntimeRepoWorkItemCommands['getRepoWorkItem'] =
    this.repoWorkItemCommands.getRepoWorkItem.bind(this.repoWorkItemCommands)
  getRepoWorkItemByOwnerRepo: RuntimeRepoWorkItemCommands['getRepoWorkItemByOwnerRepo'] =
    this.repoWorkItemCommands.getRepoWorkItemByOwnerRepo.bind(this.repoWorkItemCommands)
  getRepoWorkItemDetails: RuntimeRepoWorkItemCommands['getRepoWorkItemDetails'] =
    this.repoWorkItemCommands.getRepoWorkItemDetails.bind(this.repoWorkItemCommands)
  countRepoWorkItems: RuntimeRepoWorkItemCommands['countRepoWorkItems'] =
    this.repoWorkItemCommands.countRepoWorkItems.bind(this.repoWorkItemCommands)
  listRepoLabels: RuntimeRepoWorkItemCommands['listRepoLabels'] =
    this.repoWorkItemCommands.listRepoLabels.bind(this.repoWorkItemCommands)
  listRepoAssignableUsers: RuntimeRepoWorkItemCommands['listRepoAssignableUsers'] =
    this.repoWorkItemCommands.listRepoAssignableUsers.bind(this.repoWorkItemCommands)
  getGitHubRateLimit: RuntimeRepoWorkItemCommands['getGitHubRateLimit'] =
    this.repoWorkItemCommands.getGitHubRateLimit.bind(this.repoWorkItemCommands)
  getRepoPRForBranch: RuntimeRepoWorkItemCommands['getRepoPRForBranch'] =
    this.repoWorkItemCommands.getRepoPRForBranch.bind(this.repoWorkItemCommands)
  async getHostedReviewForBranch(args: {
    repoSelector: string
    branch: string
    currentHeadOid?: string | null
    linkedGitHubPR?: number | null
    fallbackGitHubPR?: number | null
    linkedGitLabMR?: number | null
    linkedBitbucketPR?: number | null
    linkedAzureDevOpsPR?: number | null
    linkedGiteaPR?: number | null
  }): Promise<HostedReviewInfo | null> {
    const repo = await this.resolveRepoSelector(args.repoSelector)
    const executionOptions = this.getHostedReviewExecutionOptions(repo)
    const review = await getHostedReviewForBranchFromRepo({
      repoPath: repo.path,
      connectionId: repo.connectionId ?? null,
      branch: args.branch,
      currentHeadOid: args.currentHeadOid ?? null,
      linkedGitHubPR: args.linkedGitHubPR ?? null,
      fallbackGitHubPR: args.linkedGitHubPR == null ? (args.fallbackGitHubPR ?? null) : null,
      linkedGitLabMR: args.linkedGitLabMR ?? null,
      linkedBitbucketPR: args.linkedBitbucketPR ?? null,
      linkedAzureDevOpsPR: args.linkedAzureDevOpsPR ?? null,
      linkedGiteaPR: args.linkedGiteaPR ?? null,
      ...executionOptions
    })
    if (review?.provider === 'github' && this.stats && !this.stats.hasCountedPR(review.url)) {
      this.stats.record({
        type: 'pr_created',
        at: Date.now(),
        repoId: repo.id,
        meta: { prNumber: review.number, prUrl: review.url }
      })
    }
    return review
  }
  async getHostedReviewCreationEligibility(
    args: Omit<HostedReviewCreationEligibilityArgs, 'repoPath'> & {
      repoSelector: string
      worktreeSelector?: string
    }
  ): Promise<HostedReviewCreationEligibility> {
    const { repo, repoPath } = await this.resolveHostedReviewTarget(args)
    const executionOptions = this.getHostedReviewExecutionOptions(repo)
    return getHostedReviewCreationEligibilityFromRepo({
      repoPath,
      connectionId: repo.connectionId ?? null,
      branch: args.branch,
      base: args.base ?? null,
      hasUncommittedChanges: args.hasUncommittedChanges,
      hasUpstream: args.hasUpstream,
      ahead: args.ahead,
      behind: args.behind,
      linkedGitHubPR: args.linkedGitHubPR ?? null,
      fallbackGitHubPR: args.linkedGitHubPR == null ? (args.fallbackGitHubPR ?? null) : null,
      linkedGitLabMR: args.linkedGitLabMR ?? null,
      linkedBitbucketPR: args.linkedBitbucketPR ?? null,
      linkedAzureDevOpsPR: args.linkedAzureDevOpsPR ?? null,
      linkedGiteaPR: args.linkedGiteaPR ?? null,
      ...executionOptions
    })
  }
}
import { DEFAULT_REPO_SEARCH_REFS_LIMIT } from './orca-runtime-tail-constants'
