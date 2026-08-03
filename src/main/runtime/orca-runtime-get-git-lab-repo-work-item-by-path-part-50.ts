import { type DetectedWorktree, type DetectedWorktreeListResult, type Repo, type Worktree, type GitLabProjectRef, getRepoExecutionHostId, type RuntimeWorktreeListResult, isFolderRepo, projectResolvedWorktreeLineage, applyMetadataFallbackVisibility, buildKnownOrcaWorkspaceLayouts, isLegacyRepoForExternalWorktreeVisibility, toDetectedWorktree, createAgentScratchWorktreePathMatcher, type AgentScratchWorktreePathMatcher, type WorkspacePortKillRequest, type WorkspacePortKillResult, type WorkspacePortProbe, type WorkspacePortScanResult, filterWorkspacePortProbes, killWorkspacePort, scanWorkspacePortProbes, RuntimeReviewQueryCommands, RuntimeReviewMutationCommands, getGitLabWorkItemByProjectRef, recordGitLabProjectRecent, mergeWorktree, stopMissingWorktreeTerminals, listRuntimeFolderWorkspaces, type RuntimeWorktreeScanResult } from './orca-runtime-symbols'
import { OrcaRuntimeCreateHostedReviewPart49 } from './orca-runtime-create-hosted-review-part-49'
import type { OrcaRuntimeService } from './orca-runtime'

export class OrcaRuntimeGetGitLabRepoWorkItemByPathPart50 extends OrcaRuntimeCreateHostedReviewPart49 {
  async getGitLabRepoWorkItemByPath(
    repoSelector: string,
    projectRef: GitLabProjectRef,
    iid: number,
    type: 'issue' | 'mr'
  ): Promise<Awaited<ReturnType<typeof getGitLabWorkItemByProjectRef>>> {
    const repo = await this.resolveRepoSelector(repoSelector)
    const result = await getGitLabWorkItemByProjectRef(
      repo.path,
      projectRef,
      iid,
      type,
      repo.connectionId ?? null,
      ...this.getLocalGitExecutionOptionArgs(repo)
    )
    // Why: remote pasted-URL lookups should update GitLab recents exactly
    // like the desktop IPC path, but only after a successful lookup.
    if (result && this.store?.updateSettings) {
      const store = this.store
      recordGitLabProjectRecent(
        {
          getSettings: () => store.getSettings(),
          updateSettings: (updates) => store.updateSettings?.(updates)
        },
        projectRef.host,
        projectRef.path
      )
    }
    return result
  }

  protected readonly reviewQueryCommands = new RuntimeReviewQueryCommands({
    resolveRepoSelector: (selector) => this.resolveRepoSelector(selector),
    getLocalGitExecutionOptionArgs: (repo) => this.getLocalGitExecutionOptionArgs(repo)
  })

  getRepoIssue: RuntimeReviewQueryCommands['getRepoIssue'] =
    this.reviewQueryCommands.getRepoIssue.bind(this.reviewQueryCommands)
  getRepoPRChecks: RuntimeReviewQueryCommands['getRepoPRChecks'] =
    this.reviewQueryCommands.getRepoPRChecks.bind(this.reviewQueryCommands)
  rerunRepoPRChecks: RuntimeReviewQueryCommands['rerunRepoPRChecks'] =
    this.reviewQueryCommands.rerunRepoPRChecks.bind(this.reviewQueryCommands)
  getRepoPRCheckDetails: RuntimeReviewQueryCommands['getRepoPRCheckDetails'] =
    this.reviewQueryCommands.getRepoPRCheckDetails.bind(this.reviewQueryCommands)
  getRepoPRComments: RuntimeReviewQueryCommands['getRepoPRComments'] =
    this.reviewQueryCommands.getRepoPRComments.bind(this.reviewQueryCommands)
  getRepoPRFileContents: RuntimeReviewQueryCommands['getRepoPRFileContents'] =
    this.reviewQueryCommands.getRepoPRFileContents.bind(this.reviewQueryCommands)
  resolveRepoReviewThread: RuntimeReviewQueryCommands['resolveRepoReviewThread'] =
    this.reviewQueryCommands.resolveRepoReviewThread.bind(this.reviewQueryCommands)
  setRepoPRFileViewed: RuntimeReviewQueryCommands['setRepoPRFileViewed'] =
    this.reviewQueryCommands.setRepoPRFileViewed.bind(this.reviewQueryCommands)

  protected readonly reviewMutationCommands = new RuntimeReviewMutationCommands({
    resolveRepoSelector: (selector) => this.resolveRepoSelector(selector),
    getLocalGitExecutionOptionArgs: (repo) => this.getLocalGitExecutionOptionArgs(repo)
  })

  updateRepoPRTitle: RuntimeReviewMutationCommands['updateRepoPRTitle'] =
    this.reviewMutationCommands.updateRepoPRTitle.bind(this.reviewMutationCommands)
  updateRepoPRDetails: RuntimeReviewMutationCommands['updateRepoPRDetails'] =
    this.reviewMutationCommands.updateRepoPRDetails.bind(this.reviewMutationCommands)
  mergeRepoPR: RuntimeReviewMutationCommands['mergeRepoPR'] =
    this.reviewMutationCommands.mergeRepoPR.bind(this.reviewMutationCommands)
  setRepoPRAutoMerge: RuntimeReviewMutationCommands['setRepoPRAutoMerge'] =
    this.reviewMutationCommands.setRepoPRAutoMerge.bind(this.reviewMutationCommands)
  updateRepoPRState: RuntimeReviewMutationCommands['updateRepoPRState'] =
    this.reviewMutationCommands.updateRepoPRState.bind(this.reviewMutationCommands)
  requestRepoPRReviewers: RuntimeReviewMutationCommands['requestRepoPRReviewers'] =
    this.reviewMutationCommands.requestRepoPRReviewers.bind(this.reviewMutationCommands)
  removeRepoPRReviewers: RuntimeReviewMutationCommands['removeRepoPRReviewers'] =
    this.reviewMutationCommands.removeRepoPRReviewers.bind(this.reviewMutationCommands)
  createRepoIssue: RuntimeReviewMutationCommands['createRepoIssue'] =
    this.reviewMutationCommands.createRepoIssue.bind(this.reviewMutationCommands)
  updateRepoIssue: RuntimeReviewMutationCommands['updateRepoIssue'] =
    this.reviewMutationCommands.updateRepoIssue.bind(this.reviewMutationCommands)
  addRepoIssueComment: RuntimeReviewMutationCommands['addRepoIssueComment'] =
    this.reviewMutationCommands.addRepoIssueComment.bind(this.reviewMutationCommands)
  addRepoPRReviewComment: RuntimeReviewMutationCommands['addRepoPRReviewComment'] =
    this.reviewMutationCommands.addRepoPRReviewComment.bind(this.reviewMutationCommands)
  addRepoPRReviewCommentReply: RuntimeReviewMutationCommands['addRepoPRReviewCommentReply'] =
    this.reviewMutationCommands.addRepoPRReviewCommentReply.bind(this.reviewMutationCommands)
  async getRepoHooks(repoSelector: string) {
    return this.repoHookCommands.getRepoHooks(repoSelector)
  }
  async checkRepoHooks(repoSelector: string) {
    return this.repoHookCommands.checkRepoHooks(repoSelector)
  }
  async inspectRepoSetupScriptImports(repoSelector: string) {
    return this.repoHookCommands.inspectRepoSetupScriptImports(repoSelector)
  }
  async readRepoIssueCommand(repoSelector: string) {
    return this.repoHookCommands.readRepoIssueCommand(repoSelector)
  }
  async writeRepoIssueCommand(repoSelector: string, content: string): Promise<{ ok: true }> {
    return this.repoHookCommands.writeRepoIssueCommand(repoSelector, content)
  }
  async listManagedWorktrees(
    repoSelector?: string,
    limit = DEFAULT_WORKTREE_LIST_LIMIT
  ): Promise<RuntimeWorktreeListResult> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error('invalid_limit')
    }
    const resolved = await this.listResolvedWorktrees()
    const repoId = repoSelector ? (await this.resolveRepoSelector(repoSelector)).id : null
    const checkoutPathsByRepoId = new Map<string, string[]>()
    for (const worktree of resolved) {
      const checkoutPaths = checkoutPathsByRepoId.get(worktree.repoId) ?? []
      checkoutPaths.push(worktree.path)
      checkoutPathsByRepoId.set(worktree.repoId, checkoutPaths)
    }
    const agentScratchMatchersByRepoId = new Map(
      (this.store?.getRepos() ?? []).map((repo) => [
        repo.id,
        createAgentScratchWorktreePathMatcher([
          repo.path,
          ...(checkoutPathsByRepoId.get(repo.id) ?? [])
        ])
      ])
    )
    const worktrees = resolved.filter((worktree) => {
      if (repoId && worktree.repoId !== repoId) {
        return false
      }
      return this.isRuntimeWorktreeVisible(
        worktree,
        agentScratchMatchersByRepoId.get(worktree.repoId)
      )
    })
    return {
      worktrees: worktrees.slice(0, limit),
      totalCount: worktrees.length,
      truncated: worktrees.length > limit
    }
  }
  async listDetectedManagedWorktrees(
    repoSelector: string,
    connectionId?: string | null
  ): Promise<DetectedWorktreeListResult> {
    return this.listDetectedWorktreesForResolvedRepo(
      await this.resolveRepoSelectorForConnection(repoSelector, connectionId)
    )
  }
  protected async listDetectedWorktreesForResolvedRepo(
    repo: Repo
  ): Promise<DetectedWorktreeListResult> {
    const store = this.requireStore()
    if (isFolderRepo(repo)) {
      const worktrees = listRuntimeFolderWorkspaces(store, repo)
      const detected = worktrees.map((worktree) => this.toRuntimeDetectedWorktree(repo, worktree))
      return {
        repoId: repo.id,
        authoritative: true,
        source: 'git',
        worktrees: projectResolvedWorktreeLineage(detected, store.getAllWorktreeLineage?.() ?? {})
      }
    }
    let scan: RuntimeWorktreeScanResult
    try {
      scan = await this.listRepoWorktreesForResolution(repo)
    } catch {
      scan = { ok: false, worktrees: [] }
    }
    if (scan.ok) {
      this.pruneLineageForMissingRepoWorktrees(repo, scan.worktrees)
    }
    const agentScratchWorktreePathMatcher = createAgentScratchWorktreePathMatcher([
      repo.path,
      ...scan.worktrees.map((worktree) => worktree.path)
    ])
    const detected = scan.worktrees.map((gitWorktree) => {
      const worktreeId = `${repo.id}::${gitWorktree.path}`
      const meta = store.getWorktreeMeta(worktreeId)
      const worktree = {
        ...mergeWorktree(repo.id, gitWorktree, meta, repo.displayName),
        hostId: meta?.hostId ?? getRepoExecutionHostId(repo)
      }
      const detectedWorktree = this.toRuntimeDetectedWorktree(
        repo,
        worktree,
        agentScratchWorktreePathMatcher
      )
      if (scan.ok) {
        return detectedWorktree
      }
      return applyMetadataFallbackVisibility(detectedWorktree)
    })
    return {
      repoId: repo.id,
      authoritative: scan.ok,
      source: scan.ok ? 'git' : 'metadata-fallback',
      worktrees: projectResolvedWorktreeLineage(detected, store.getAllWorktreeLineage?.() ?? {})
    }
  }
  async teardownMissingManagedWorktreeTerminals(
    repoSelector: string,
    knownWorktreeIds: readonly string[],
    connectionId?: string | null
  ): Promise<{ stoppedWorktreeIds: string[] }> {
    const repo = await this.resolveRepoSelectorForConnection(repoSelector, connectionId)
    // Why: killing PTYs must be proven against the host right now — a cached scan
    // (30s TTL) can still list a directory git already dropped, and the renderer
    // purges its state either way, so a stale miss strands those processes for good.
    this.invalidateWorktreeScanCacheForRepo(repo.id)
    // Why: rescanning by `id:` would re-resolve the already-resolved repo, and a
    // duplicate id across hosts makes that second lookup throw selector_ambiguous
    // even though the caller's selector was unique — losing the sweep entirely.
    const detected = await this.listDetectedWorktreesForResolvedRepo(repo)
    if (!detected.authoritative) {
      return { stoppedWorktreeIds: [] }
    }
    return stopMissingWorktreeTerminals(
      repo,
      knownWorktreeIds,
      detected.worktrees.map((worktree) => worktree.id),
      {
        runtime: this as unknown as OrcaRuntimeService,
        getLocalProvider: () => this.getLocalProvider(),
        getSshProvider: (connectionId) => this.getSshProviderFn?.(connectionId),
        onPtyStopped: this.onPtyStopped ?? undefined
      }
    )
  }
  protected resolveRepoSelectorForConnection(
    repoSelector: string,
    connectionId?: string | null
  ): Promise<Repo> {
    if (connectionId === undefined) {
      return this.resolveRepoSelector(repoSelector)
    }
    // Why: an explicit connection identity only *narrows* the selector; it must not
    // change the grammar. Matching the selector as a bare repo id would make
    // `path:`/`name:` selectors resolve to repo_not_found on this path alone.
    const wanted = connectionId?.trim() || null
    const matches = this.selectReposBySelector(repoSelector).filter(
      (repo) => (repo.connectionId?.trim() || null) === wanted
    )
    if (matches.length !== 1) {
      throw new Error(matches.length > 1 ? 'selector_ambiguous' : 'repo_not_found')
    }
    return Promise.resolve(matches[0])
  }
  protected isRuntimeWorktreeVisible(
    worktree: Worktree,
    agentScratchWorktreePathMatcher?: AgentScratchWorktreePathMatcher
  ): boolean {
    const repo = this.store?.getRepo(worktree.repoId)
    if (!repo || !this.store) {
      return true
    }
    return this.toRuntimeDetectedWorktree(repo, worktree, agentScratchWorktreePathMatcher).visible
  }
  protected toRuntimeDetectedWorktree(
    repo: Repo,
    worktree: Worktree,
    agentScratchWorktreePathMatcher?: AgentScratchWorktreePathMatcher
  ): DetectedWorktree {
    const settings = this.store?.getSettings()
    if (!settings) {
      return {
        ...worktree,
        ownership: 'unknown-legacy',
        selectedCheckout: false,
        visible: true
      }
    }
    return toDetectedWorktree({
      repo,
      worktree,
      meta: this.store?.getWorktreeMeta(worktree.id),
      settings,
      knownOrcaLayouts: buildKnownOrcaWorkspaceLayouts(settings, repo),
      isLegacyRepoForVisibility: isLegacyRepoForExternalWorktreeVisibility(repo),
      agentScratchWorktreePathMatcher
    })
  }
  async showManagedWorktree(worktreeSelector: string) {
    return await this.resolveWorktreeSelector(worktreeSelector)
  }
  async scanWorkspacePorts(repoId?: string): Promise<WorkspacePortScanResult> {
    return scanWorkspacePortProbes(await this.getWorkspacePortProbes(repoId))
  }
  async killWorkspacePort(args: WorkspacePortKillRequest): Promise<WorkspacePortKillResult> {
    return killWorkspacePort(await this.getWorkspacePortProbes(args.repoId), args)
  }

  // Why: remote clients may invoke this over RPC, so the runtime derives
  // allowed worktree paths from its own store instead of trusting client paths.
  protected async getWorkspacePortProbes(repoId?: string): Promise<WorkspacePortProbe[]> {
    const reposById = new Map<string, Repo>(
      this.requireStore()
        .getRepos()
        .map((repo) => [repo.id, repo] as const)
    )
    return filterWorkspacePortProbes(
      (await this.listResolvedWorktrees()).map((worktree) => ({
        id: worktree.id,
        repoId: worktree.repoId,
        displayName: worktree.displayName,
        path: worktree.git.path,
        connectionId: reposById.get(worktree.repoId)?.connectionId ?? null
      })),
      repoId
    )
  }
  async sleepManagedWorktree(worktreeSelector: string): Promise<{ worktreeId: string }> {
    const worktree = await this.resolveWorktreeSelector(worktreeSelector)
    // Why: sleep is renderer-initiated on desktop (it tears down tab state
    // before killing PTYs). The notifier tells the renderer to run its own
    // sleep flow so all cleanup happens in the correct order.
    this.notifier?.sleepWorktree(worktree.id)
    return { worktreeId: worktree.id }
  }
}
import { DEFAULT_WORKTREE_LIST_LIMIT } from './orca-runtime-tail-constants'
