import { defineMethod, type RpcMethod } from "../core"
import {
  RepoSelector, WorkItemsList, IssuesList, WorkItem, WorkItemByOwnerRepo, WorkItemDetails, WorkItemsCount,
  RateLimit, PrForBranch, Issue, PullRequest, PullRequestChecks, PullRequestCheckDetails, RerunPullRequestChecks,
  PullRequestFileContents, PullRequestFileViewed, ReviewThread, UpdatePrTitle, UpdatePr, MergePr, SetPrAutoMerge,
  UpdatePrState, RequestPrReviewers, RemovePrReviewers, CreateIssue, UpdateIssue, IssueComment, PRReviewComment,
  PRReviewCommentReply
} from "./github-schemas"

export const GITHUB_REPO_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'github.repoSlug',
    params: RepoSelector,
    handler: async (params, { runtime }) => runtime.getRepoSlug(params.repo)
  }),
  defineMethod({
    name: 'github.repoUpstream',
    params: RepoSelector,
    handler: async (params, { runtime }) => runtime.getRepoUpstream(params.repo)
  }),
  defineMethod({
    name: 'github.rateLimit',
    params: RateLimit,
    handler: async (params, { runtime }) => runtime.getGitHubRateLimit(params)
  }),
  defineMethod({
    name: 'github.listWorkItems',
    params: WorkItemsList,
    handler: async (params, { runtime }) =>
      runtime.listRepoWorkItems(
        params.repo,
        params.limit,
        params.query,
        params.page,
        params.noCache
      )
  }),
  defineMethod({
    name: 'github.listIssues',
    params: IssuesList,
    handler: async (params, { runtime }) => runtime.listRepoIssues(params.repo, params.limit)
  }),
  defineMethod({
    name: 'github.countWorkItems',
    params: WorkItemsCount,
    handler: async (params, { runtime }) => runtime.countRepoWorkItems(params.repo, params.query)
  }),
  defineMethod({
    name: 'github.listLabels',
    params: RepoSelector,
    handler: async (params, { runtime }) => runtime.listRepoLabels(params.repo)
  }),
  defineMethod({
    name: 'github.listAssignableUsers',
    params: RepoSelector,
    handler: async (params, { runtime }) => runtime.listRepoAssignableUsers(params.repo)
  }),
  defineMethod({
    name: 'github.workItem',
    params: WorkItem,
    handler: async (params, { runtime }) =>
      runtime.getRepoWorkItem(params.repo, params.number, params.type)
  }),
  defineMethod({
    name: 'github.workItemByOwnerRepo',
    params: WorkItemByOwnerRepo,
    handler: async (params, { runtime }) =>
      runtime.getRepoWorkItemByOwnerRepo(
        params.repo,
        {
          owner: params.owner,
          repo: params.ownerRepo,
          ...(params.host ? { host: params.host } : {})
        },
        params.number,
        params.type
      )
  }),
  defineMethod({
    name: 'github.workItemDetails',
    params: WorkItemDetails,
    handler: async (params, { runtime }) =>
      runtime.getRepoWorkItemDetails(params.repo, params.number, params.type)
  }),
  defineMethod({
    name: 'github.prForBranch',
    params: PrForBranch,
    handler: async (params, { runtime }) =>
      runtime.getRepoPRForBranch(
        params.repo,
        params.branch,
        params.linkedPRNumber,
        params.fallbackPRNumber,
        params.acceptMergedFallbackPR,
        params.currentHeadOid
      )
  }),
  defineMethod({
    name: 'github.issue',
    params: Issue,
    handler: async (params, { runtime }) => runtime.getRepoIssue(params.repo, params.number)
  }),
  defineMethod({
    name: 'github.prChecks',
    params: PullRequestChecks,
    handler: async (params, { runtime }) =>
      runtime.getRepoPRChecks(params.repo, params.prNumber, params.headSha, params.prRepo ?? null, {
        noCache: params.noCache
      })
  }),
  defineMethod({
    name: 'github.prCheckDetails',
    params: PullRequestCheckDetails,
    handler: async (params, { runtime }) =>
      runtime.getRepoPRCheckDetails(params.repo, {
        checkRunId: params.checkRunId,
        workflowRunId: params.workflowRunId,
        checkName: params.checkName,
        url: params.url,
        prRepo: params.prRepo ?? null
      })
  }),
  defineMethod({
    name: 'github.rerunPRChecks',
    params: RerunPullRequestChecks,
    handler: async (params, { runtime }) =>
      runtime.rerunRepoPRChecks(params.repo, params.prNumber, {
        headSha: params.headSha,
        failedOnly: params.failedOnly,
        prRepo: params.prRepo ?? null
      })
  }),
  defineMethod({
    name: 'github.prComments',
    params: PullRequest,
    handler: async (params, { runtime }) =>
      runtime.getRepoPRComments(params.repo, params.prNumber, params.prRepo ?? null, {
        noCache: params.noCache
      })
  }),
  defineMethod({
    name: 'github.prFileContents',
    params: PullRequestFileContents,
    handler: async (params, { runtime }) =>
      runtime.getRepoPRFileContents(params.repo, {
        prNumber: params.prNumber,
        prRepo: params.prRepo ?? null,
        path: params.path,
        oldPath: params.oldPath,
        status: params.status,
        headSha: params.headSha,
        baseSha: params.baseSha
      })
  }),
  defineMethod({
    name: 'github.resolveReviewThread',
    params: ReviewThread,
    handler: async (params, { runtime }) =>
      runtime.resolveRepoReviewThread(
        params.repo,
        params.threadId,
        params.resolve,
        params.prRepo ?? null
      )
  }),
  defineMethod({
    name: 'github.setPRFileViewed',
    params: PullRequestFileViewed,
    handler: async (params, { runtime }) =>
      runtime.setRepoPRFileViewed(params.repo, {
        prRepo: params.prRepo ?? null,
        pullRequestId: params.pullRequestId,
        path: params.path,
        viewed: params.viewed
      })
  }),
  defineMethod({
    name: 'github.updatePRTitle',
    params: UpdatePrTitle,
    handler: async (params, { runtime }) =>
      runtime.updateRepoPRTitle(params.repo, params.prNumber, params.title, params.prRepo ?? null)
  }),
  defineMethod({
    name: 'github.updatePR',
    params: UpdatePr,
    handler: async (params, { runtime }) =>
      runtime.updateRepoPRDetails(
        params.repo,
        params.prNumber,
        params.updates,
        params.prRepo ?? null
      )
  }),
  defineMethod({
    name: 'github.mergePR',
    params: MergePr,
    handler: async (params, { runtime }) =>
      runtime.mergeRepoPR(params.repo, params.prNumber, params.method, params.prRepo ?? null)
  }),
  defineMethod({
    name: 'github.setPRAutoMerge',
    params: SetPrAutoMerge,
    handler: async (params, { runtime }) =>
      runtime.setRepoPRAutoMerge(
        params.repo,
        params.prNumber,
        params.enabled,
        params.method,
        params.prRepo ?? null
      )
  }),
  defineMethod({
    name: 'github.updatePRState',
    params: UpdatePrState,
    handler: async (params, { runtime }) =>
      runtime.updateRepoPRState(params.repo, params.prNumber, params.updates, params.prRepo ?? null)
  }),
  defineMethod({
    name: 'github.requestPRReviewers',
    params: RequestPrReviewers,
    handler: async (params, { runtime }) =>
      runtime.requestRepoPRReviewers(
        params.repo,
        params.prNumber,
        params.reviewers,
        params.prRepo ?? null
      )
  }),
  defineMethod({
    name: 'github.removePRReviewers',
    params: RemovePrReviewers,
    handler: async (params, { runtime }) =>
      runtime.removeRepoPRReviewers(
        params.repo,
        params.prNumber,
        params.reviewers,
        params.prRepo ?? null
      )
  }),
  defineMethod({
    name: 'github.createIssue',
    params: CreateIssue,
    handler: async (params, { runtime }) => {
      const fields =
        params.labels !== undefined || params.assignees !== undefined
          ? { labels: params.labels, assignees: params.assignees }
          : undefined
      return fields
        ? runtime.createRepoIssue(params.repo, params.title, params.body, fields)
        : runtime.createRepoIssue(params.repo, params.title, params.body)
    }
  }),
  defineMethod({
    name: 'github.updateIssue',
    params: UpdateIssue,
    handler: async (params, { runtime }) =>
      runtime.updateRepoIssue(params.repo, params.number, params.updates)
  }),
  defineMethod({
    name: 'github.addIssueComment',
    params: IssueComment,
    handler: async (params, { runtime }) =>
      runtime.addRepoIssueComment(params.repo, params.number, params.body, params.prRepo ?? null)
  }),
  defineMethod({
    name: 'github.addPRReviewComment',
    params: PRReviewComment,
    handler: async (params, { runtime }) =>
      runtime.addRepoPRReviewComment(params.repo, {
        prNumber: params.prNumber,
        prRepo: params.prRepo ?? null,
        commitId: params.commitId,
        path: params.path,
        line: params.line,
        startLine: params.startLine,
        body: params.body
      })
  }),
  defineMethod({
    name: 'github.addPRReviewCommentReply',
    params: PRReviewCommentReply,
    handler: async (params, { runtime }) =>
      runtime.addRepoPRReviewCommentReply(params.repo, {
        prNumber: params.prNumber,
        commentId: params.commentId,
        body: params.body,
        threadId: params.threadId,
        path: params.path,
        line: params.line,
        prRepo: params.prRepo ?? null
      })
  }),
]
