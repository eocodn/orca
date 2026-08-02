import type { GitHubOwnerRepo, GitHubPRFile, Repo } from '../../shared/types'
import {
  getIssue,
  getPRCheckDetails,
  getPRChecks,
  getPRComments,
  rerunPRChecks,
  resolveReviewThread,
  setPRFileViewed
} from '../github/client'
import { getPRFileContents } from '../github/work-item-details'

export type ReviewQueryHost = {
  resolveRepoSelector(selector: string): Promise<Repo>
  getLocalGitExecutionOptionArgs(repo: Repo): [] | [{ wslDistro?: string }]
}

export class RuntimeReviewQueryCommands {
  constructor(private readonly host: ReviewQueryHost) {}

  async getRepoIssue(
    repoSelector: string,
    number: number
  ): Promise<Awaited<ReturnType<typeof getIssue>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return getIssue(
      repo.path,
      number,
      repo.connectionId ?? null,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
  }

  async getRepoPRChecks(
    repoSelector: string,
    prNumber: number,
    headSha?: string,
    prRepo?: GitHubOwnerRepo | null,
    options?: { noCache?: boolean }
  ): Promise<Awaited<ReturnType<typeof getPRChecks>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return getPRChecks(
      repo.path,
      prNumber,
      headSha,
      prRepo ?? null,
      options,
      repo.connectionId ?? null,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
  }

  async rerunRepoPRChecks(
    repoSelector: string,
    prNumber: number,
    options?: {
      headSha?: string
      failedOnly?: boolean
      prRepo?: GitHubOwnerRepo | null
    }
  ): Promise<Awaited<ReturnType<typeof rerunPRChecks>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return rerunPRChecks(
      repo.path,
      prNumber,
      options,
      repo.connectionId ?? null,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
  }

  async getRepoPRCheckDetails(
    repoSelector: string,
    args: {
      checkRunId?: number
      workflowRunId?: number
      checkName?: string
      url?: string | null
      prRepo?: GitHubOwnerRepo | null
    }
  ): Promise<Awaited<ReturnType<typeof getPRCheckDetails>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return getPRCheckDetails(
      repo.path,
      { ...args, prRepo: args.prRepo ?? null },
      repo.connectionId ?? null,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
  }

  async getRepoPRComments(
    repoSelector: string,
    prNumber: number,
    prRepo?: GitHubOwnerRepo | null,
    options?: { noCache?: boolean }
  ): Promise<Awaited<ReturnType<typeof getPRComments>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return getPRComments(
      repo.path,
      prNumber,
      { ...options, prRepo: prRepo ?? null },
      repo.connectionId ?? null,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
  }

  async getRepoPRFileContents(
    repoSelector: string,
    args: {
      prNumber: number
      prRepo?: GitHubOwnerRepo | null
      path: string
      oldPath?: string
      status: GitHubPRFile['status']
      headSha: string
      baseSha: string
    }
  ): Promise<Awaited<ReturnType<typeof getPRFileContents>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return getPRFileContents({
      repoPath: repo.path,
      connectionId: repo.connectionId ?? null,
      localGitOptions: this.host.getLocalGitExecutionOptionArgs(repo)[0],
      ...args
    })
  }

  async resolveRepoReviewThread(
    repoSelector: string,
    threadId: string,
    resolve: boolean,
    prRepo?: GitHubOwnerRepo | null
  ): Promise<Awaited<ReturnType<typeof resolveReviewThread>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return resolveReviewThread(
      repo.path,
      threadId,
      resolve,
      repo.connectionId ?? null,
      prRepo ?? null,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
  }

  async setRepoPRFileViewed(
    repoSelector: string,
    args: {
      prRepo?: GitHubOwnerRepo | null
      pullRequestId: string
      path: string
      viewed: boolean
    }
  ): Promise<Awaited<ReturnType<typeof setPRFileViewed>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return setPRFileViewed({
      repoPath: repo.path,
      connectionId: repo.connectionId ?? null,
      localGitOptions: this.host.getLocalGitExecutionOptionArgs(repo)[0],
      ...args
    })
  }
}
