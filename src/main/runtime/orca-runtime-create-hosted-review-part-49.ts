import { type GitLabIssueUpdate, type GitLabMRInlineCommentInput, type GitLabProjectRef, type GitLabWorkItem, type MRListState, closeGitLabMR, createGitLabIssue, diagnoseGitLabAuthClient, getGitLabJobTrace, getGitLabRateLimit, addGitLabIssueComment, addGitLabMRInlineComment, addGitLabMRComment, listGitLabTodos, listGitLabIssues, listGitLabLabels, listGitLabMergeRequests, listGitLabWorkItems, mergeGitLabMR, reopenGitLabMR, resolveGitLabMRDiscussion, retryGitLabJob, updateGitLabMR, updateGitLabMRReviewers, updateGitLabIssue, getGitLabWorkItemDetails, normalizeGitLabIssueListArgs, normalizeGitLabMRListState, normalizeGitLabPositiveInteger, type GitLabIssueListState, type CreateHostedReviewInput, type CreateHostedReviewResult, createHostedReviewFromRepo } from './orca-runtime-symbols'
import { OrcaRuntimeReorderReposPart48 } from './orca-runtime-reorder-repos-part-48'

export class OrcaRuntimeCreateHostedReviewPart49 extends OrcaRuntimeReorderReposPart48 {
  async createHostedReview(
    args: CreateHostedReviewInput & { repoSelector: string; worktreeSelector?: string }
  ): Promise<CreateHostedReviewResult> {
    const { repo, repoPath } = await this.resolveHostedReviewTarget(args)
    const executionOptions = this.getHostedReviewExecutionOptions(repo)
    const input = {
      provider: args.provider,
      base: args.base,
      head: args.head,
      title: args.title,
      body: args.body,
      draft: args.draft,
      ...(args.useTemplate !== undefined ? { useTemplate: args.useTemplate } : {})
    }
    const result = executionOptions
      ? await createHostedReviewFromRepo(
          repoPath,
          input,
          repo.connectionId ?? null,
          executionOptions
        )
      : await createHostedReviewFromRepo(repoPath, input, repo.connectionId ?? null)
    if (result.ok && this.stats && !this.stats.hasCountedPR(result.url)) {
      this.stats.record({
        type: 'pr_created',
        at: Date.now(),
        repoId: repo.id,
        meta: { prNumber: result.number, prUrl: result.url }
      })
    }
    return result
  }
  async listGitLabRepoWorkItems(
    repoSelector: string,
    state?: MRListState,
    page?: number,
    perPage?: number,
    query?: string
  ): Promise<Awaited<ReturnType<typeof listGitLabWorkItems>>> {
    const repo = await this.resolveRepoSelector(repoSelector)
    return listGitLabWorkItems(
      repo.path,
      state ?? 'opened',
      page ?? 1,
      perPage ?? 20,
      repo.issueSourcePreference,
      query,
      repo.connectionId ?? null,
      ...this.getLocalGitExecutionOptionArgs(repo)
    )
  }
  async listGitLabRepoMRs(
    repoSelector: string,
    state?: MRListState,
    page?: number,
    perPage?: number,
    query?: string
  ): Promise<Awaited<ReturnType<typeof listGitLabMergeRequests>>> {
    const repo = await this.resolveRepoSelector(repoSelector)
    return listGitLabMergeRequests(
      repo.path,
      normalizeGitLabMRListState(state),
      normalizeGitLabPositiveInteger(page, 1, 10_000),
      normalizeGitLabPositiveInteger(perPage, 20, 100),
      repo.issueSourcePreference,
      query,
      repo.connectionId ?? null,
      ...this.getLocalGitExecutionOptionArgs(repo)
    )
  }
  async listGitLabRepoIssues(
    repoSelector: string,
    state?: GitLabIssueListState,
    assignee?: string,
    limit?: number
  ): Promise<{
    items: GitLabWorkItem[]
    error?: Awaited<ReturnType<typeof listGitLabIssues>>['error']
  }> {
    const repo = await this.resolveRepoSelector(repoSelector)
    const normalized = normalizeGitLabIssueListArgs({ state, assignee, limit })
    const result = await listGitLabIssues(
      repo.path,
      normalized.limit,
      repo.issueSourcePreference,
      normalized.state,
      normalized.assignee,
      repo.connectionId ?? null,
      ...this.getLocalGitExecutionOptionArgs(repo)
    )
    // Why: web runtime mirrors the desktop preload contract, where GitLab
    // issue rows share the GitLabWorkItem shape with MRs on TaskPage.
    const items: GitLabWorkItem[] = result.items.map((issue) => ({
      id: `gitlab-issue-${repo.id}-${issue.number}`,
      type: 'issue' as const,
      number: issue.number,
      title: issue.title,
      state: issue.state,
      url: issue.url,
      labels: issue.labels,
      updatedAt: issue.updatedAt ?? '',
      author: issue.author ?? null,
      repoId: repo.id
    }))
    return { items, ...(result.error ? { error: result.error } : {}) }
  }
  async listGitLabRepoTodos(
    repoSelector: string
  ): Promise<Awaited<ReturnType<typeof listGitLabTodos>>> {
    const repo = await this.resolveRepoSelector(repoSelector)
    return listGitLabTodos(
      repo.path,
      repo.connectionId ?? null,
      ...this.getLocalGitExecutionOptionArgs(repo)
    )
  }
  async diagnoseGitLabAuth(): Promise<Awaited<ReturnType<typeof diagnoseGitLabAuthClient>>> {
    return diagnoseGitLabAuthClient()
  }
  async getGitLabRateLimit(options?: {
    force?: boolean
    host?: string | null
  }): Promise<Awaited<ReturnType<typeof getGitLabRateLimit>>> {
    return getGitLabRateLimit(options)
  }
  async listGitLabRepoLabels(
    repoSelector: string
  ): Promise<Awaited<ReturnType<typeof listGitLabLabels>>> {
    const repo = await this.resolveRepoSelector(repoSelector)
    return listGitLabLabels(
      repo.path,
      repo.issueSourcePreference,
      repo.connectionId ?? null,
      ...this.getLocalGitExecutionOptionArgs(repo)
    )
  }
  async createGitLabRepoIssue(
    repoSelector: string,
    title: string,
    body: string
  ): Promise<Awaited<ReturnType<typeof createGitLabIssue>>> {
    const repo = await this.resolveRepoSelector(repoSelector)
    return createGitLabIssue(
      repo.path,
      title,
      body,
      repo.issueSourcePreference,
      repo.connectionId ?? null,
      ...this.getLocalGitExecutionOptionArgs(repo)
    )
  }
  async updateGitLabRepoIssue(
    repoSelector: string,
    number: number,
    updates: GitLabIssueUpdate,
    projectRef?: GitLabProjectRef | null
  ): Promise<Awaited<ReturnType<typeof updateGitLabIssue>>> {
    const repo = await this.resolveRepoSelector(repoSelector)
    return updateGitLabIssue(
      repo.path,
      number,
      updates,
      repo.issueSourcePreference,
      repo.connectionId ?? null,
      projectRef,
      ...this.getLocalGitExecutionOptionArgs(repo)
    )
  }
  async addGitLabRepoIssueComment(
    repoSelector: string,
    number: number,
    body: string,
    projectRef?: GitLabProjectRef | null
  ): Promise<Awaited<ReturnType<typeof addGitLabIssueComment>>> {
    const repo = await this.resolveRepoSelector(repoSelector)
    return addGitLabIssueComment(
      repo.path,
      number,
      body,
      repo.issueSourcePreference,
      repo.connectionId ?? null,
      projectRef,
      ...this.getLocalGitExecutionOptionArgs(repo)
    )
  }
  async addGitLabRepoMRComment(
    repoSelector: string,
    iid: number,
    body: string,
    projectRef?: GitLabProjectRef | null
  ): Promise<Awaited<ReturnType<typeof addGitLabMRComment>>> {
    const repo = await this.resolveRepoSelector(repoSelector)
    return addGitLabMRComment(
      repo.path,
      iid,
      body,
      repo.issueSourcePreference,
      repo.connectionId ?? null,
      projectRef,
      ...this.getLocalGitExecutionOptionArgs(repo)
    )
  }
  async addGitLabRepoMRInlineComment(
    repoSelector: string,
    iid: number,
    input: GitLabMRInlineCommentInput,
    projectRef?: GitLabProjectRef | null
  ): Promise<Awaited<ReturnType<typeof addGitLabMRInlineComment>>> {
    const repo = await this.resolveRepoSelector(repoSelector)
    return addGitLabMRInlineComment(
      repo.path,
      iid,
      input,
      repo.issueSourcePreference,
      repo.connectionId ?? null,
      projectRef,
      ...this.getLocalGitExecutionOptionArgs(repo)
    )
  }
  async resolveGitLabRepoMRDiscussion(
    repoSelector: string,
    iid: number,
    discussionId: string,
    resolved: boolean,
    projectRef?: GitLabProjectRef | null
  ): Promise<Awaited<ReturnType<typeof resolveGitLabMRDiscussion>>> {
    const repo = await this.resolveRepoSelector(repoSelector)
    return resolveGitLabMRDiscussion(
      repo.path,
      iid,
      discussionId,
      resolved,
      repo.issueSourcePreference,
      repo.connectionId ?? null,
      projectRef,
      ...this.getLocalGitExecutionOptionArgs(repo)
    )
  }
  async getGitLabRepoJobTrace(
    repoSelector: string,
    jobId: number,
    projectRef?: GitLabProjectRef | null
  ): Promise<Awaited<ReturnType<typeof getGitLabJobTrace>>> {
    const repo = await this.resolveRepoSelector(repoSelector)
    return getGitLabJobTrace(
      repo.path,
      jobId,
      repo.issueSourcePreference,
      repo.connectionId ?? null,
      projectRef,
      ...this.getLocalGitExecutionOptionArgs(repo)
    )
  }
  async retryGitLabRepoJob(
    repoSelector: string,
    jobId: number,
    projectRef?: GitLabProjectRef | null
  ): Promise<Awaited<ReturnType<typeof retryGitLabJob>>> {
    const repo = await this.resolveRepoSelector(repoSelector)
    return retryGitLabJob(
      repo.path,
      jobId,
      repo.issueSourcePreference,
      repo.connectionId ?? null,
      projectRef,
      ...this.getLocalGitExecutionOptionArgs(repo)
    )
  }
  async mergeGitLabRepoMR(
    repoSelector: string,
    iid: number,
    method?: 'merge' | 'squash' | 'rebase',
    projectRef?: GitLabProjectRef | null
  ): Promise<Awaited<ReturnType<typeof mergeGitLabMR>>> {
    const repo = await this.resolveRepoSelector(repoSelector)
    return mergeGitLabMR(
      repo.path,
      iid,
      method ?? 'merge',
      repo.issueSourcePreference,
      repo.connectionId ?? null,
      projectRef,
      ...this.getLocalGitExecutionOptionArgs(repo)
    )
  }
  async updateGitLabRepoMRState(
    repoSelector: string,
    iid: number,
    state: 'opened' | 'closed',
    projectRef?: GitLabProjectRef | null
  ): Promise<Awaited<ReturnType<typeof closeGitLabMR>>> {
    const repo = await this.resolveRepoSelector(repoSelector)
    return state === 'closed'
      ? closeGitLabMR(
          repo.path,
          iid,
          repo.issueSourcePreference,
          repo.connectionId ?? null,
          projectRef,
          ...this.getLocalGitExecutionOptionArgs(repo)
        )
      : reopenGitLabMR(
          repo.path,
          iid,
          repo.issueSourcePreference,
          repo.connectionId ?? null,
          projectRef,
          ...this.getLocalGitExecutionOptionArgs(repo)
        )
  }
  async updateGitLabRepoMR(
    repoSelector: string,
    iid: number,
    updates: { title?: string; body?: string; addLabels?: string[]; removeLabels?: string[] },
    projectRef?: GitLabProjectRef | null
  ): Promise<Awaited<ReturnType<typeof updateGitLabMR>>> {
    const repo = await this.resolveRepoSelector(repoSelector)
    return updateGitLabMR(
      repo.path,
      iid,
      updates,
      repo.issueSourcePreference,
      repo.connectionId ?? null,
      projectRef,
      ...this.getLocalGitExecutionOptionArgs(repo)
    )
  }
  async updateGitLabRepoMRReviewers(
    repoSelector: string,
    iid: number,
    reviewerIds: number[],
    projectRef?: GitLabProjectRef | null
  ): Promise<Awaited<ReturnType<typeof updateGitLabMRReviewers>>> {
    const repo = await this.resolveRepoSelector(repoSelector)
    return updateGitLabMRReviewers(
      repo.path,
      iid,
      reviewerIds,
      repo.issueSourcePreference,
      repo.connectionId ?? null,
      projectRef,
      ...this.getLocalGitExecutionOptionArgs(repo)
    )
  }
  async getGitLabRepoWorkItemDetails(
    repoSelector: string,
    iid: number,
    type: 'issue' | 'mr',
    projectRef?: GitLabProjectRef | null
  ): Promise<Awaited<ReturnType<typeof getGitLabWorkItemDetails>>> {
    const repo = await this.resolveRepoSelector(repoSelector)
    return getGitLabWorkItemDetails(
      repo.path,
      iid,
      type,
      repo.issueSourcePreference,
      repo.connectionId ?? null,
      projectRef,
      ...this.getLocalGitExecutionOptionArgs(repo)
    )
  }
}
