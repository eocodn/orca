import type { RepoKind } from './types-repository'

// ─── GitHub ──────────────────────────────────────────────────────────
export type PRState = 'open' | 'closed' | 'merged' | 'draft'
export type IssueState = 'open' | 'closed'
export type CheckStatus = 'pending' | 'success' | 'failure' | 'neutral'

export type PRMergeableState = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
export type PRReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED'

export type PRConflictSummary = {
  baseRef: string
  baseCommit: string
  commitsBehind: number
  files: string[]
  localMergeState?: 'clean'
}

// Why: host must survive renderer/RPC boundaries so Enterprise review actions
// cannot silently fall back to a same-named repository on github.com.
export type GitHubRepositoryIdentity = { owner: string; repo: string; host?: string }

export type GitHubPRMergeMethod = 'merge' | 'squash' | 'rebase'

export type GitHubPRMergeMethodSettings = {
  defaultMethod: GitHubPRMergeMethod
  allowedMethods: Record<GitHubPRMergeMethod, boolean>
}

export type PRInfo = {
  number: number
  title: string
  state: PRState
  url: string
  checksStatus: CheckStatus
  updatedAt: string
  mergeable: PRMergeableState
  reviewDecision?: PRReviewDecision | null
  autoMergeEnabled?: boolean
  autoMergeAllowed?: boolean | null
  mergeQueueRequired?: boolean | null
  mergeMethodSettings?: GitHubPRMergeMethodSettings
  mergeStateStatus?: string | null
  // Why: check-runs are keyed by the PR head commit, not the mutable branch name.
  // Keeping the head SHA in cached PR metadata lets the checks panel poll the
  // correct commit without re-querying GitHub or guessing from local branch refs.
  headSha?: string
  // Why: a merged branch-matched PR stays visible when the worktree head is one
  // of the PR's own commits (behind update-branch/web commits). Cache staleness
  // checks must honor that confirmation without re-querying GitHub.
  confirmedContainedHeadOid?: string
  // Why: the worktree HEAD OID this merged linked PR was confirmed to have
  // diverged from (a definite not-contained probe). Head-scoped, not a bare
  // boolean, so a PR-number-coalesced refresh broadcast cannot clear a sibling
  // worktree whose own head is still on the PR's line of work. Clearing a
  // durable linked PR requires this positive signal for that exact head, never
  // the mere absence of a containment confirmation after a rate-limit/error.
  headDivergedFromMergedPRAtOid?: string
  /** Target branch name for PR-created worktree compare-base repair. */
  baseRefName?: string
  /** PR head branch name. Lets linked-PR consumers detect that the worktree
   *  has switched to a different branch and the durable link is stale. */
  headRefName?: string
  prRepo?: GitHubRepositoryIdentity
  headRepo?: GitHubRepositoryIdentity
  conflictSummary?: PRConflictSummary
}

/**
 * Discriminates a classified GitHub PR-refresh failure. The renderer maps these
 * to stable, non-destructive empty-state copy; a `hard` subset (auth, permission,
 * repo_unavailable, gh_unavailable) means the existing-review lookup is currently
 * impossible and must hide the Create composer.
 */
export type PRRefreshErrorType =
  | 'rate_limited'
  | 'auth'
  | 'network'
  | 'permission'
  | 'repo_unavailable'
  | 'gh_unavailable'
  | 'server_error'
  | 'unknown'

// Backward-compatible name used by outage-copy consumers added on main.
export type PRRefreshUpstreamErrorType = PRRefreshErrorType

export type PRRefreshOutcome =
  | { kind: 'found'; pr: PRInfo; fetchedAt: number }
  | { kind: 'no-pr'; fetchedAt: number }
  | {
      kind: 'upstream-error'
      errorType: PRRefreshErrorType
      message: string
      fetchedAt: number
      // Unified retry schedule (see docs/reference/pr-panel-refresh-guidance.md).
      // `nextAutoRetryAt`: earliest time main expects to auto-retry this key.
      // `retryDisabledUntil`: earliest time a manual Retry / refreshPRNow is
      // accepted (rate-limit gates only, never ordinary network/auth backoff).
      nextAutoRetryAt?: number
      retryDisabledUntil?: number
    }

export type GitHubPRRefreshReason = 'visible' | 'active' | 'post-push' | 'manual' | 'swr'

export type GitHubPRRefreshEnqueueResult =
  | { kind: 'queued' }
  | { kind: 'skipped'; skippedReason: 'validation-denied' | 'validation-backoff' }
  | { kind: 'fallback' }

export type GitHubPRRefreshAlias = {
  cacheKey: string
  repoId?: string
  repoPath: string
  branch: string
  worktreeId?: string
  connectionId?: string | null
  executionHostId?: string | null
  linkedPRNumber?: number | null
  fallbackPRNumber?: number | null
  fallbackPRSource?: 'explicit' | 'pr-cache' | 'hosted-review' | null
  // Why: request-time worktree HEAD. Merged branch-matched PRs are only visible
  // for heads that belong to the PR, and refresh consumers need this snapshot to
  // clear a durable linked PR once main confirms the head diverged.
  currentHeadOid?: string | null
}

export type GitHubPRRefreshCandidate = GitHubPRRefreshAlias & {
  repoKind: RepoKind
  repoId: string
  isBare?: boolean
  isArchived?: boolean
  connectionId?: string | null
  executionHostId?: string | null
  connectionState?: 'connected' | 'disconnected' | 'unknown'
  cachedFetchedAt?: number | null
  cachedHasPR?: boolean | null
  cachedPRState?: PRState | null
  cachedChecksStatus?: CheckStatus | null
  cachedMergeable?: PRMergeableState | null
  cachedMergeStateStatus?: string | null
  localGitOptions?: { wslDistro?: string }
}

export type GitHubPRRefreshSkippedReason =
  | 'fresh'
  | 'not-git'
  | 'bare'
  | 'archived'
  | 'disconnected'
  | 'remote'
  | 'rate-limit'
  | 'capacity'

type GitHubPRRefreshEventBase = {
  sequence: number
  reason: GitHubPRRefreshReason
  aliases: GitHubPRRefreshAlias[]
  requestStartedAt?: number
}

export type GitHubPRRefreshEvent =
  | (GitHubPRRefreshEventBase & {
      outcome: PRRefreshOutcome
      status?: never
      pausedUntil?: never
      skippedReason?: never
    })
  | (GitHubPRRefreshEventBase & {
      status: 'queued' | 'in-flight'
      outcome?: never
      pausedUntil?: never
      skippedReason?: never
    })
  | (GitHubPRRefreshEventBase & {
      status: 'paused'
      pausedUntil: number
      skippedReason: 'rate-limit'
      outcome?: never
    })
  | (GitHubPRRefreshEventBase & {
      status: 'skipped'
      skippedReason: GitHubPRRefreshSkippedReason
      outcome?: never
      pausedUntil?: never
    })

export type PRCheckDetail = {
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion:
    | 'success'
    | 'failure'
    | 'cancelled'
    | 'timed_out'
    | 'neutral'
    | 'skipped'
    | 'pending'
    // Why: a check suite needing manual action (e.g. a workflow awaiting "Approve
    // and run") has no check run and is absent from statusCheckRollup, yet blocks
    // auto-merge (GitHub returns "unstable status"). Surface it as its own state.
    | 'action_required'
    | null
  url: string | null
  checkRunId?: number
  workflowRunId?: number
}

export type PRCheckAnnotation = {
  path: string | null
  startLine: number | null
  endLine: number | null
  annotationLevel: string | null
  title: string | null
  message: string
  rawDetails: string | null
}

export type PRCheckStep = {
  name: string
  status: string | null
  conclusion: string | null
  startedAt: string | null
  completedAt: string | null
}

export type PRCheckJob = {
  id: number | null
  name: string
  status: string | null
  conclusion: string | null
  startedAt: string | null
  completedAt: string | null
  url: string | null
  logTail: string | null
  steps: PRCheckStep[]
}

export type PRCheckRunDetails = {
  name: string
  status: PRCheckDetail['status'] | string | null
  conclusion: PRCheckDetail['conclusion'] | string | null
  url: string | null
  detailsUrl: string | null
  startedAt: string | null
  completedAt: string | null
  title: string | null
  summary: string | null
  text: string | null
  annotations: PRCheckAnnotation[]
  jobs: PRCheckJob[]
}

export type GitHubRerunPRChecksResult = { ok: true; count: number } | { ok: false; error: string }

export type GitHubReactionContent =
  | '+1'
  | '-1'
  | 'laugh'
  | 'confused'
  | 'heart'
  | 'hooray'
  | 'rocket'
  | 'eyes'

export type GitHubReaction = {
  content: GitHubReactionContent
  count: number
}

export type PRComment = {
  id: number
  author: string
  authorAvatarUrl: string
  body: string
  createdAt: string
  url: string
  reactions?: GitHubReaction[]
  /** File path for inline review comments (absent for top-level conversation comments). */
  path?: string
  /** GraphQL node ID of the review thread — present only for inline review comments.
   *  Used to resolve/unresolve the thread via GitHub's GraphQL API. */
  threadId?: string
  /** Whether the review thread has been resolved. Only meaningful when threadId is set. */
  isResolved?: boolean
  /** True when GitHub no longer maps the thread to the current diff. */
  isOutdated?: boolean
  /** End line of the review annotation (1-based). */
  line?: number
  /** Start line of the review annotation range (1-based). Absent for single-line comments. */
  startLine?: number
  /** True when GitHub identifies the author as a bot (REST `user.type === 'Bot'` or
   *  GraphQL `__typename === 'Bot'`). Preferred over login-string heuristics because
   *  third-party review bots (e.g. qodo-ai-reviewer, coderabbitai) don't follow a
   *  predictable naming convention. Absent when the data source can't report it
   *  (non-GitHub fallbacks via `gh pr view`). */
  isBot?: boolean
}

export type GitHubIssueTimelineTarget = {
  type: 'issue' | 'pr'
  number: number
  title: string
  url: string
  repository?: string
}

export type GitHubIssueTimelineItem = {
  id: string
  event:
    | 'assigned'
    | 'unassigned'
    | 'mentioned'
    | 'cross-referenced'
    | 'closed'
    | 'reopened'
    | 'moved_columns_in_project'
  actor: string
  actorAvatarUrl: string
  createdAt: string
  assignee?: string
  source?: GitHubIssueTimelineTarget
  closer?: GitHubIssueTimelineTarget
  stateReason?: string | null
  previousColumnName?: string | null
  columnName?: string | null
  projectName?: string | null
}

export type GitHubCommentResult = { ok: true; comment: PRComment } | { ok: false; error: string }

export type IssueInfo = {
  number: number
  title: string
  state: IssueState
  url: string
  labels: string[]
}

export type GitHubViewer = {
  login: string
  email: string | null
}

export type GitHubAssignableUser = {
  login: string
  name: string | null
  avatarUrl: string
}

export type ProviderCheckSummary = {
  state: 'success' | 'failure' | 'pending' | 'neutral' | 'none'
  total: number
  passed: number
  failed: number
  pending: number
  neutral: number
}

export type GitHubPRReviewSummary = {
  login: string
  state?: string | null
  avatarUrl?: string | null
}

export type GitHubPRFileViewedState = 'DISMISSED' | 'VIEWED' | 'UNVIEWED'

export type GitHubWorkItem = {
  id: string
  type: 'issue' | 'pr'
  number: number
  title: string
  state: 'open' | 'closed' | 'merged' | 'draft'
  url: string
  labels: string[]
  updatedAt: string
  author: string | null
  // Why: GHE user logins don't exist on github.com, so the github.com/{login}.png
  // fallback 404s. Carry the API-provided avatar_url so github.com + Enterprise
  // both render; absent on the gh-pr-view path (gh omits avatar), then the UI
  // falls back to the login URL and finally an initials placeholder. See #8784.
  authorAvatarUrl?: string
  branchName?: string
  baseRefName?: string
  // Why: PR checks are keyed by head commit; carrying this lets task rows use
  // the cached check-runs endpoint instead of one `gh pr checks` call per row.
  headSha?: string
  prRepo?: GitHubRepositoryIdentity
  additions?: number
  deletions?: number
  changedFiles?: number
  reviewDecision?: PRReviewDecision | null
  reviewRequests?: GitHubAssignableUser[]
  latestReviews?: GitHubPRReviewSummary[]
  assignees?: GitHubAssignableUser[]
  checksSummary?: ProviderCheckSummary
  mergeable?: PRMergeableState
  autoMergeEnabled?: boolean
  autoMergeAllowed?: boolean | null
  mergeQueueRequired?: boolean | null
  mergeMethodSettings?: GitHubPRMergeMethodSettings
  mergeStateStatus?: string | null
  maintainerCanModify?: boolean
  // Why: true when a PR's head lives on a fork (headRepositoryOwner !== selected repo owner).
  // The Start-from picker passes this to resolvePrBase so fork heads use
  // refs/pull/<N>/head for creation and a separate PR-head push target.
  isCrossRepository?: boolean
  /** Why: required because the cross-repo view merges items from every selected
   *  repo — the table row's repo pill and the "open in browser" fallback need
   *  to know which repo an item came from. Stamped by the renderer fetcher
   *  (`fetchWorkItems`) and by optimistic stubs on the new-issue path. */
  repoId: string
}

export type GitHubPRFile = {
  path: string
  oldPath?: string
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged'
  additions: number
  deletions: number
  /** GitHub marks files above its diff size limit as binary-like; we skip content fetches for these. */
  isBinary: boolean
  /** Modified-side line numbers that GitHub accepts for inline review comments. */
  reviewCommentLineNumbers?: number[]
  /** GitHub's per-viewer review state. DISMISSED means new changes arrived after the file was viewed. */
  viewerViewedState?: GitHubPRFileViewedState
}

export type GitHubPRFileContents = {
  original: string
  modified: string
  originalIsBinary: boolean
  modifiedIsBinary: boolean
  originalTooLarge?: boolean
  modifiedTooLarge?: boolean
}

export type GitHubPRReviewCommentInput = {
  repoPath: string
  prRepo?: GitHubRepositoryIdentity | null
  prNumber: number
  commitId: string
  path: string
  line: number
  startLine?: number
  body: string
}

export type GitHubWorkItemDetails = {
  // Why: main-process doesn't know Orca's Repo.id, so this inner item omits
  // repoId. The renderer stamps it when routing the details through the store.
  item: Omit<GitHubWorkItem, 'repoId'>
  body: string
  comments: PRComment[]
  /** Issue-only provider activity such as assignment, references, project moves, and state changes. */
  timelineItems?: GitHubIssueTimelineItem[]
  /** Only set for PRs. Head/base SHAs used by the Files tab to fetch per-file content. */
  headSha?: string
  baseSha?: string
  /** GraphQL node ID required by GitHub's file-viewed mutations. Only set for PRs. */
  pullRequestId?: string
  checks?: PRCheckDetail[]
  files?: GitHubPRFile[]
  /** Only set for PRs. True when the file fetch failed (rate limit, auth,
   *  unresolved remote) rather than the PR genuinely having no changed files. */
  filesUnavailable?: boolean
  participants?: GitHubAssignableUser[]
  /** Logins of current assignees. Only set for issues. */
  assignees?: string[]
}
