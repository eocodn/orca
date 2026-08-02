import type { GitHubOwnerRepo, ListWorkItemsResult, Repo } from '../../shared/types'
import {
  countWorkItems,
  getWorkItem,
  getWorkItemByOwnerRepo,
  listAssignableUsers,
  listIssues as listGitHubIssues,
  listLabels,
  listWorkItems,
  getPRForBranchOutcome,
  type GitHubPRBranchLookupOptions,
  type MainWorkItem
} from '../github/client'
import { getWorkItemDetails } from '../github/work-item-details'
import { getRateLimit } from '../github/rate-limit'

export type RepoWorkItemHost = {
  resolveRepoSelector(selector: string): Promise<Repo>
  getLocalGitExecutionOptionArgs(repo: Repo): [] | [{ wslDistro?: string }]
  getHostedReviewExecutionOptions(
    repo: Repo
  ): { localGitExecOptions: { wslDistro?: string } } | undefined
}

export class RuntimeRepoWorkItemCommands {
  constructor(private readonly host: RepoWorkItemHost) {}

  async listRepoWorkItems(
    repoSelector: string,
    limit?: number,
    query?: string,
    page?: number,
    noCache?: boolean
  ): Promise<ListWorkItemsResult<MainWorkItem>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return listWorkItems(
      repo.path,
      limit,
      query,
      page,
      repo.issueSourcePreference,
      repo.connectionId ?? null,
      noCache,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
  }

  async listRepoIssues(
    repoSelector: string,
    limit?: number
  ): Promise<Awaited<ReturnType<typeof listGitHubIssues>>['items']> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    const result = await listGitHubIssues(
      repo.path,
      limit,
      repo.issueSourcePreference,
      repo.connectionId ?? null,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
    return result.items
  }

  async getRepoWorkItem(
    repoSelector: string,
    number: number,
    type?: 'issue' | 'pr'
  ): Promise<Awaited<ReturnType<typeof getWorkItem>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return getWorkItem(
      repo.path,
      number,
      type,
      repo.connectionId ?? null,
      this.host.getLocalGitExecutionOptionArgs(repo)[0] ?? {},
      repo.issueSourcePreference
    )
  }

  async getRepoWorkItemByOwnerRepo(
    repoSelector: string,
    ownerRepo: GitHubOwnerRepo,
    number: number,
    type: 'issue' | 'pr'
  ): Promise<Awaited<ReturnType<typeof getWorkItemByOwnerRepo>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return getWorkItemByOwnerRepo(
      repo.path,
      ownerRepo,
      number,
      type,
      repo.connectionId ?? null,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
  }

  async getRepoWorkItemDetails(
    repoSelector: string,
    number: number,
    type?: 'issue' | 'pr'
  ): Promise<Awaited<ReturnType<typeof getWorkItemDetails>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return getWorkItemDetails(
      repo.path,
      number,
      type,
      repo.connectionId ?? null,
      this.host.getLocalGitExecutionOptionArgs(repo)[0] ?? {},
      repo.issueSourcePreference
    )
  }

  async countRepoWorkItems(repoSelector: string, query?: string): Promise<number> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return countWorkItems(
      repo.path,
      query,
      repo.issueSourcePreference,
      repo.connectionId ?? null,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
  }

  async listRepoLabels(repoSelector: string): Promise<Awaited<ReturnType<typeof listLabels>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return listLabels(
      repo.path,
      repo.issueSourcePreference,
      repo.connectionId ?? null,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
  }

  async listRepoAssignableUsers(
    repoSelector: string
  ): Promise<Awaited<ReturnType<typeof listAssignableUsers>>> {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    return listAssignableUsers(
      repo.path,
      repo.issueSourcePreference,
      repo.connectionId ?? null,
      ...this.host.getLocalGitExecutionOptionArgs(repo)
    )
  }

  getGitHubRateLimit(options?: {
    force?: boolean
  }): Promise<Awaited<ReturnType<typeof getRateLimit>>> {
    return getRateLimit(options)
  }

  async getRepoPRForBranch(
    repoSelector: string,
    branch: string,
    linkedPRNumber?: number | null,
    fallbackPRNumber?: number | null,
    acceptMergedFallbackPR?: boolean,
    currentHeadOid?: string | null
  ) {
    const repo = await this.host.resolveRepoSelector(repoSelector)
    const options: GitHubPRBranchLookupOptions =
      this.host.getHostedReviewExecutionOptions(repo) ?? {}
    if (acceptMergedFallbackPR === true) {
      options.acceptMergedFallbackPR = true
    }
    if (typeof currentHeadOid === 'string' && currentHeadOid.trim().length > 0) {
      options.currentHeadOid = currentHeadOid.trim()
    }
    const lookupOptionArgs: [] | [GitHubPRBranchLookupOptions] =
      Object.keys(options).length > 0 ? [options] : []
    return getPRForBranchOutcome(
      repo.path,
      branch,
      linkedPRNumber ?? null,
      repo.connectionId ?? null,
      linkedPRNumber == null ? (fallbackPRNumber ?? null) : null,
      ...lookupOptionArgs
    )
  }
}
