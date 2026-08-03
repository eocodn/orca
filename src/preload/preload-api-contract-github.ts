import type { GitHubRepoSelectorArgs } from './api-browser-emulator'
import type { CreateHostedReviewArgs, CreateHostedReviewResult } from './api-types-external'

import type { HostedReviewCreationEligibility, HostedReviewCreationEligibilityArgs, HostedReviewForBranchArgs, HostedReviewInfo, TaskSourceContext, GitHubAssignableUser, GitHubCreateIssueResult, GitHubPRFile, GitHubPRFileContents, GitHubPRReviewCommentInput, GitHubCommentResult, GitHubOwnerRepo, GitHubWorkItem, GitHubWorkItemDetails, GitHubViewer, ListWorkItemsResult, IssueInfo, GitHubIssueUpdate, GitHubPRRefreshCandidate, GitHubPRRefreshEnqueueResult, GitHubPRRefreshEvent, GitHubPRRefreshReason, GetRateLimitResult, PRCheckDetail, PRCheckRunDetails, PRComment, PRInfo, PRRefreshOutcome, AddIssueCommentBySlugArgs, ClearProjectItemFieldArgs, DeleteIssueCommentBySlugArgs, GetProjectViewTableArgs, GetProjectViewTableResult, GitHubProjectCommentMutationResult, GitHubProjectMutationResult, ListAccessibleProjectsArgs, ListAccessibleProjectsResult, ListAssignableUsersBySlugArgs, ListAssignableUsersBySlugResult, ListIssueTypesBySlugArgs, ListIssueTypesBySlugResult, ListLabelsBySlugArgs, ListLabelsBySlugResult, ListProjectViewsArgs, ListProjectViewsResult, ProjectWorkItemDetailsBySlugArgs, ProjectWorkItemDetailsBySlugResult, ResolveProjectRefArgs, ResolveProjectRefResult, UpdateIssueBySlugArgs, UpdateIssueCommentBySlugArgs, UpdateIssueTypeBySlugArgs, UpdatePullRequestBySlugArgs, UpdateProjectItemFieldArgs, GhAuthDiagnostic, AppStarSource } from './preload-api-contract-types';export type PreloadApiGithub = {
  gh: {
    viewer: () => Promise<GitHubViewer | null>
    repoSlug: (args: {
      repoPath: string
      repoId?: string
    }) => Promise<{ owner: string; repo: string; host?: string } | null>
    repoUpstream: (args: {
      repoPath: string
      repoId?: string
    }) => Promise<{ owner: string; repo: string; host?: string } | null>
    prForBranch: (args: {
      repoPath: string
      repoId?: string
      branch: string
      linkedPRNumber?: number | null
      fallbackPRNumber?: number | null
      acceptMergedFallbackPR?: boolean
      currentHeadOid?: string | null
    }) => Promise<PRInfo | null>
    refreshPRNow: (args: { candidate: GitHubPRRefreshCandidate }) => Promise<PRRefreshOutcome>
    enqueuePRRefresh: (args: {
      candidate: GitHubPRRefreshCandidate
      reason: GitHubPRRefreshReason
      priority?: number
    }) => Promise<GitHubPRRefreshEnqueueResult | false>
    reportVisiblePRRefreshCandidates: (args: {
      candidates: GitHubPRRefreshCandidate[]
      generation: number
    }) => Promise<boolean>
    onPRRefreshEvent: (callback: (event: GitHubPRRefreshEvent) => void) => () => void
    issue: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      number: number
    }) => Promise<IssueInfo | null>
    workItem: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      number: number
      type?: 'issue' | 'pr'
    }) => Promise<Omit<GitHubWorkItem, 'repoId'> | null>
    workItemByOwnerRepo: (args: {
      repoPath: string
      repoId?: string
      owner: string
      repo: string
      host?: string
      number: number
      type: 'issue' | 'pr'
    }) => Promise<Omit<GitHubWorkItem, 'repoId'> | null>
    workItemDetails: (
      args: GitHubRepoSelectorArgs & {
        number: number
        type?: 'issue' | 'pr'
      }
    ) => Promise<GitHubWorkItemDetails | null>
    notifyWorkItemMutated: (args: {
      repoPath: string
      repoId?: string
      type: 'issue' | 'pr'
      number: number
    }) => Promise<boolean>
    prFileContents: (
      args: GitHubRepoSelectorArgs & {
        prNumber: number
        prRepo?: GitHubOwnerRepo | null
        path: string
        oldPath?: string
        status: GitHubPRFile['status']
        headSha: string
        baseSha: string
      }
    ) => Promise<GitHubPRFileContents>
    listIssues: (args: {
      repoPath: string
      repoId?: string
      limit?: number
    }) => Promise<IssueInfo[]>
    createIssue: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      title: string
      body: string
      labels?: string[]
      assignees?: string[]
    }) => Promise<GitHubCreateIssueResult>
    countWorkItems: (args: { repoPath: string; repoId?: string; query?: string }) => Promise<number>
    listWorkItems: (args: {
      repoPath: string
      repoId?: string
      limit?: number
      query?: string
      page?: number
      noCache?: boolean
    }) => Promise<ListWorkItemsResult<Omit<GitHubWorkItem, 'repoId'>>>
    prChecks: (
      args: GitHubRepoSelectorArgs & {
        prNumber: number
        headSha?: string
        prRepo?: GitHubOwnerRepo | null
        noCache?: boolean
      }
    ) => Promise<PRCheckDetail[]>
    prCheckDetails: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      checkRunId?: number
      workflowRunId?: number
      checkName?: string
      url?: string | null
      prRepo?: GitHubOwnerRepo | null
    }) => Promise<PRCheckRunDetails | null>
    rerunPRChecks: (
      args: GitHubRepoSelectorArgs & {
        prNumber: number
        headSha?: string
        failedOnly?: boolean
        prRepo?: GitHubOwnerRepo | null
      }
    ) => Promise<{ ok: true; count: number } | { ok: false; error: string }>
    prComments: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      prNumber: number
      prRepo?: GitHubOwnerRepo | null
      noCache?: boolean
    }) => Promise<PRComment[]>
    resolveReviewThread: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
      threadId: string
      resolve: boolean
      prRepo?: GitHubOwnerRepo | null
    }) => Promise<boolean>
    setPRFileViewed: (
      args: GitHubRepoSelectorArgs & {
        prNumber: number
        prRepo?: GitHubOwnerRepo | null
        pullRequestId: string
        path: string
        viewed: boolean
      }
    ) => Promise<boolean>
    updatePRTitle: (args: {
      repoPath: string
      repoId?: string
      prNumber: number
      title: string
      prRepo?: GitHubOwnerRepo | null
    }) => Promise<boolean>
    mergePR: (
      args: GitHubRepoSelectorArgs & {
        prNumber: number
        method?: 'merge' | 'squash' | 'rebase'
        prRepo?: GitHubOwnerRepo | null
      }
    ) => Promise<{ ok: true } | { ok: false; error: string }>
    setPRAutoMerge: (
      args: GitHubRepoSelectorArgs & {
        prNumber: number
        enabled: boolean
        method?: 'merge' | 'squash' | 'rebase'
        prRepo?: GitHubOwnerRepo | null
      }
    ) => Promise<{ ok: true } | { ok: false; error: string }>
    updatePRState: (
      args: GitHubRepoSelectorArgs & {
        prNumber: number
        updates: { state: 'open' | 'closed' }
        prRepo?: GitHubOwnerRepo | null
      }
    ) => Promise<{ ok: true } | { ok: false; error: string }>
    requestPRReviewers: (
      args: GitHubRepoSelectorArgs & {
        prNumber: number
        reviewers: string[]
        prRepo?: GitHubOwnerRepo | null
      }
    ) => Promise<{ ok: true } | { ok: false; error: string }>
    removePRReviewers: (
      args: GitHubRepoSelectorArgs & {
        prNumber: number
        reviewers: string[]
        prRepo?: GitHubOwnerRepo | null
      }
    ) => Promise<{ ok: true } | { ok: false; error: string }>
    updateIssue: (
      args: GitHubRepoSelectorArgs & {
        number: number
        updates: GitHubIssueUpdate
      }
    ) => Promise<{ ok: true } | { ok: false; error: string }>
    addIssueComment: (
      args: GitHubRepoSelectorArgs & {
        number: number
        body: string
        /** Why: scopes the cross-window cache invalidation so a PR and issue sharing the same number don't evict each other. */
        type?: 'issue' | 'pr'
        prRepo?: GitHubOwnerRepo | null
      }
    ) => Promise<GitHubCommentResult>
    addPRReviewCommentReply: (
      args: GitHubRepoSelectorArgs & {
        prNumber: number
        commentId: number
        body: string
        threadId?: string
        path?: string
        line?: number
        prRepo?: GitHubOwnerRepo | null
      }
    ) => Promise<GitHubCommentResult>
    addPRReviewComment: (
      args: GitHubPRReviewCommentInput & {
        repoId?: string
        sourceContext?: TaskSourceContext | null
      }
    ) => Promise<GitHubCommentResult>
    listLabels: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
    }) => Promise<string[]>
    listAssignableUsers: (args: {
      repoPath: string
      repoId?: string
      sourceContext?: TaskSourceContext | null
    }) => Promise<GitHubAssignableUser[]>
    /** Subscribe to local-mutation broadcasts so the work-item-drawer cache can invalidate across windows. Returns an unsubscribe. */
    onWorkItemMutated: (
      callback: (payload: {
        repoPath: string
        repoId?: string
        type: 'issue' | 'pr'
        number: number
      }) => void
    ) => () => void
    checkOrcaStarred: () => Promise<boolean | null>
    starOrca: (source: AppStarSource) => Promise<boolean>
    /**
     * GitHub API rate-limit snapshot. Does NOT consume quota (the
     * `rate_limit` endpoint is exempt). Cached 30s server-side — pass
     * `force: true` to bust after a known-expensive op.
     */
    rateLimit: (args?: { force?: boolean }) => Promise<GetRateLimitResult>
    /** Explains scope_missing ProjectV2 failures — notably a shell `GITHUB_TOKEN` shadowing the keyring credential, where `gh auth refresh` is a no-op. */
    diagnoseAuth: (args?: { host?: string }) => Promise<GhAuthDiagnostic>
    // ── ProjectV2 (GitHub Projects) ─────────────────────────────────
    listAccessibleProjects: (
      args?: ListAccessibleProjectsArgs
    ) => Promise<ListAccessibleProjectsResult>
    resolveProjectRef: (args: ResolveProjectRefArgs) => Promise<ResolveProjectRefResult>
    listProjectViews: (args: ListProjectViewsArgs) => Promise<ListProjectViewsResult>
    getProjectViewTable: (args: GetProjectViewTableArgs) => Promise<GetProjectViewTableResult>
    projectWorkItemDetailsBySlug: (
      args: ProjectWorkItemDetailsBySlugArgs
    ) => Promise<ProjectWorkItemDetailsBySlugResult>
    updateProjectItemField: (
      args: UpdateProjectItemFieldArgs
    ) => Promise<GitHubProjectMutationResult>
    clearProjectItemField: (args: ClearProjectItemFieldArgs) => Promise<GitHubProjectMutationResult>
    updateIssueBySlug: (args: UpdateIssueBySlugArgs) => Promise<GitHubProjectMutationResult>
    updatePullRequestBySlug: (
      args: UpdatePullRequestBySlugArgs
    ) => Promise<GitHubProjectMutationResult>
    addIssueCommentBySlug: (
      args: AddIssueCommentBySlugArgs
    ) => Promise<GitHubProjectCommentMutationResult>
    updateIssueCommentBySlug: (
      args: UpdateIssueCommentBySlugArgs
    ) => Promise<GitHubProjectMutationResult>
    deleteIssueCommentBySlug: (
      args: DeleteIssueCommentBySlugArgs
    ) => Promise<GitHubProjectMutationResult>
    listLabelsBySlug: (args: ListLabelsBySlugArgs) => Promise<ListLabelsBySlugResult>
    listAssignableUsersBySlug: (
      args: ListAssignableUsersBySlugArgs
    ) => Promise<ListAssignableUsersBySlugResult>
    listIssueTypesBySlug: (args: ListIssueTypesBySlugArgs) => Promise<ListIssueTypesBySlugResult>
    updateIssueTypeBySlug: (args: UpdateIssueTypeBySlugArgs) => Promise<GitHubProjectMutationResult>
  }
  hostedReview: {
    forBranch: (args: HostedReviewForBranchArgs) => Promise<HostedReviewInfo | null>
    getCreationEligibility: (
      args: HostedReviewCreationEligibilityArgs
    ) => Promise<HostedReviewCreationEligibility>
    create: (args: CreateHostedReviewArgs) => Promise<CreateHostedReviewResult>
  }
  // ── GitLab — parallel to gh, MR/issue surface only in v1 ────────
  // Shapes mirror gh.* except where GitLab's API differs (MR states, host-qualified project path, `glab api -i` paging).
}
