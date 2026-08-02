import type {
  GitHubCreateIssueFields,
  GitHubIssueUpdate,
  GitHubOwnerRepo,
  GitHubPRReviewCommentInput,
  GitHubPullRequestStateUpdate,
  Repo
} from '../../shared/types'
import {
  addIssueComment,
  addPRReviewComment,
  addPRReviewCommentReply,
  createIssue,
  mergePR,
  removePRReviewers,
  requestPRReviewers,
  setPRAutoMerge,
  updateIssue,
  updatePRDetails,
  updatePRState,
  updatePRTitle
} from '../github/client'

export type ReviewMutationHost = {
  resolveRepoSelector(selector: string): Promise<Repo>
  getLocalGitExecutionOptionArgs(repo: Repo): [] | [{ wslDistro?: string }]
}

export class RuntimeReviewMutationCommands {
  constructor(private readonly host: ReviewMutationHost) {}

  async updateRepoPRTitle(
    repoSelector: string,
    prNumber: number,
    title: string,
    prRepo?: GitHubOwnerRepo | null
  ): Promise<Awaited<ReturnType<typeof updatePRTitle>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return updatePRTitle(
      repo.path,
      prNumber,
      title,
      repo.connectionId ?? null,
      prRepo ?? null,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
  }

  async updateRepoPRDetails(
    repoSelector: string,
    prNumber: number,
    updates: { title?: string; body?: string },
    prRepo?: GitHubOwnerRepo | null
  ): Promise<Awaited<ReturnType<typeof updatePRDetails>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return updatePRDetails(
      repo.path,
      prNumber,
      updates,
      repo.connectionId ?? null,
      prRepo ?? null,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
  }

  async mergeRepoPR(
    repoSelector: string,
    prNumber: number,
    method?: 'merge' | 'squash' | 'rebase',
    prRepo?: GitHubOwnerRepo | null
  ): Promise<Awaited<ReturnType<typeof mergePR>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return mergePR(
      repo.path,
      prNumber,
      method,
      repo.connectionId ?? null,
      prRepo ?? null,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
  }

  async setRepoPRAutoMerge(
    repoSelector: string,
    prNumber: number,
    enabled: boolean,
    method?: 'merge' | 'squash' | 'rebase',
    prRepo?: GitHubOwnerRepo | null
  ): Promise<Awaited<ReturnType<typeof setPRAutoMerge>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return setPRAutoMerge(
      repo.path,
      prNumber,
      enabled,
      method,
      repo.connectionId ?? null,
      prRepo ?? null,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
  }

  async updateRepoPRState(
    repoSelector: string,
    prNumber: number,
    updates: GitHubPullRequestStateUpdate,
    prRepo?: GitHubOwnerRepo | null
  ): Promise<Awaited<ReturnType<typeof updatePRState>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return updatePRState(
      repo.path,
      prNumber,
      updates,
      repo.connectionId ?? null,
      prRepo ?? null,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
  }

  async requestRepoPRReviewers(
    repoSelector: string,
    prNumber: number,
    reviewers: string[],
    prRepo?: GitHubOwnerRepo | null
  ): Promise<Awaited<ReturnType<typeof requestPRReviewers>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return requestPRReviewers(
      repo.path,
      prNumber,
      reviewers,
      repo.connectionId ?? null,
      prRepo ?? null,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
  }

  async removeRepoPRReviewers(
    repoSelector: string,
    prNumber: number,
    reviewers: string[],
    prRepo?: GitHubOwnerRepo | null
  ): Promise<Awaited<ReturnType<typeof removePRReviewers>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return removePRReviewers(
      repo.path,
      prNumber,
      reviewers,
      repo.connectionId ?? null,
      prRepo ?? null,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
  }

  async createRepoIssue(
    repoSelector: string,
    title: string,
    body: string,
    fields?: GitHubCreateIssueFields
  ): Promise<Awaited<ReturnType<typeof createIssue>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return createIssue(
      repo.path,
      title,
      body,
      repo.issueSourcePreference,
      repo.connectionId ?? null,
      fields,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
  }

  async updateRepoIssue(
    repoSelector: string,
    number: number,
    updates: GitHubIssueUpdate
  ): Promise<Awaited<ReturnType<typeof updateIssue>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return updateIssue(
      repo.path,
      number,
      updates,
      repo.connectionId ?? null,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
  }

  async addRepoIssueComment(
    repoSelector: string,
    number: number,
    body: string,
    prRepo?: GitHubOwnerRepo | null
  ): Promise<Awaited<ReturnType<typeof addIssueComment>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return addIssueComment(
      repo.path,
      number,
      body,
      repo.connectionId ?? null,
      prRepo ?? null,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
  }

  async addRepoPRReviewComment(
    repoSelector: string,
    args: Omit<GitHubPRReviewCommentInput, 'repoPath'>
  ): Promise<Awaited<ReturnType<typeof addPRReviewComment>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return addPRReviewComment({
      repoPath: repo.path,
      connectionId: repo.connectionId ?? null,
      localGitOptions: this.host.getLocalGitExecutionOptionArgs(repo)[0],
      ...args
    })
  }

  async addRepoPRReviewCommentReply(
    repoSelector: string,
    args: {
      prNumber: number
      commentId: number
      body: string
      threadId?: string
      path?: string
      line?: number
      prRepo?: GitHubOwnerRepo | null
    }
  ): Promise<Awaited<ReturnType<typeof addPRReviewCommentReply>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return addPRReviewCommentReply(
      repo.path,
      args.prNumber,
      args.commentId,
      args.body,
      args.threadId,
      args.path,
      args.line,
      repo.connectionId ?? null,
      args.prRepo ?? null,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
  }
}
