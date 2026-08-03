import type { GitHubRepositoryIdentity } from './types-github-review'

// ─── Linear ─────────────────────────────────────────────────────────
export type LinearViewer = {
  displayName: string
  email: string | null
  organizationId?: string
  organizationName: string
  organizationUrlKey?: string
}

export type LinearWorkspace = LinearViewer & {
  id: string
  organizationId: string
  isLegacy?: true
  credentialRevision?: number
}

export type LinearWorkspaceSelection = string | 'all'
export type LinearWorkspaceSelector = LinearWorkspaceSelection | undefined
export type LinearConcreteWorkspaceId = string

export type LinearWorkspaceError = {
  workspaceId: string
  workspaceName?: string
  type: 'auth' | 'rate_limited' | 'network' | 'unknown'
  message: string
}

export type LinearCollectionResult<T> = {
  items: T[]
  errors?: LinearWorkspaceError[]
  hasMore?: boolean
}

export type LinearConnectionStatus = {
  connected: boolean
  viewer: LinearViewer | null
  workspaces?: LinearWorkspace[]
  activeWorkspaceId?: string | null
  selectedWorkspaceId?: LinearWorkspaceSelection | null
  // Set when a stored token file exists but could not be decrypted, so the
  // UI can explain reads failing while the connection still looks saved.
  credentialError?: string
}

export type LinearIssue = {
  id: string
  workspaceId?: string
  workspaceName?: string
  identifier: string
  title: string
  branchName?: string
  description?: string
  url: string
  state: {
    name: string
    type: string
    color: string
  }
  team: {
    id: string
    name: string
    key: string
  }
  project?: LinearProjectSummary
  subIssues?: LinearIssueChildSummary[]
  labels: string[]
  labelIds: string[]
  assignee?: {
    id: string
    displayName: string
    avatarUrl?: string
  }
  estimate?: number | null
  priority: number
  dueDate?: string | null
  updatedAt: string
}

export type LinearProjectSummary = {
  id: string
  slugId?: string
  workspaceId?: string
  workspaceName?: string
  name: string
  url?: string
  color?: string
  icon?: string
  description?: string
  content?: string
  status?: LinearProjectStatusSummary
  health?: string | null
  priority?: number | null
  priorityLabel?: string | null
  lead?: LinearProjectMemberSummary
  members?: LinearProjectMemberSummary[]
  teams?: {
    id: string
    name: string
    key?: string
  }[]
  labels?: {
    id: string
    name: string
    color?: string
  }[]
  startDate?: string | null
  targetDate?: string | null
  createdAt?: string
  updatedAt?: string
  completedAt?: string | null
  canceledAt?: string | null
  startedAt?: string | null
  progress?: number | null
  scope?: number | null
  issueCount?: number
  completedIssueCount?: number
}

export type LinearProjectStatusSummary = {
  id: string
  name: string
  type?: string
  color?: string
}

export type LinearProjectMemberSummary = {
  id: string
  displayName: string
  avatarUrl?: string
}

export type LinearProjectMilestoneSummary = {
  id: string
  name: string
  status?: string
  targetDate?: string | null
  progress?: number | null
}

export type LinearProjectResourceSummary = {
  id: string
  title: string
  url: string
  type?: string
}

export type LinearProjectUpdateSummary = {
  id: string
  body?: string
  health?: string | null
  url?: string
  createdAt?: string
  updatedAt?: string
  user?: LinearProjectMemberSummary
}

export type LinearProjectDetail = LinearProjectSummary & {
  milestones?: LinearProjectMilestoneSummary[]
  resources?: LinearProjectResourceSummary[]
  latestUpdate?: LinearProjectUpdateSummary
}

export type LinearCustomViewModel = 'issue' | 'project'

export type LinearCustomViewSummary = {
  id: string
  workspaceId?: string
  workspaceName?: string
  name: string
  description?: string
  model: LinearCustomViewModel
  url?: string
  color?: string
  icon?: string
  shared?: boolean
  team?: {
    id: string
    name?: string
    key?: string
  }
  owner?: LinearProjectMemberSummary
  creator?: LinearProjectMemberSummary
  createdAt?: string
  updatedAt?: string
}

export type LinearIssueChildSummary = {
  id: string
  identifier: string
  title: string
  url: string
}

export type LinearComment = {
  id: string
  body: string
  createdAt: string
  user?: {
    displayName: string
    avatarUrl?: string
  }
}

// ─── Issue Mutations ────────────────────────────────────────────────

export type GitHubCreateIssueFields = {
  labels?: string[]
  assignees?: string[]
}

export type GitHubCreateIssueResult =
  | { ok: true; number: number; url: string; bodySaveWarning?: string }
  | { ok: false; error: string }

export type GitHubIssueCloseReason = 'completed' | 'not_planned' | 'duplicate'

export type GitHubIssueUpdate = {
  state?: 'open' | 'closed'
  stateReason?: GitHubIssueCloseReason
  duplicateOf?: number
  title?: string
  // Why: body writes use the REST issue endpoint instead of `gh issue edit`
  // because that command does not consistently cover every body-edit case the
  // dialog needs.
  body?: string
  addLabels?: string[]
  removeLabels?: string[]
  addAssignees?: string[]
  removeAssignees?: string[]
}

export type GitHubPullRequestStateUpdate = {
  state: 'open' | 'closed'
}

export type LinearIssueUpdate = {
  stateId?: string
  title?: string
  description?: string
  assigneeId?: string | null
  estimate?: number | null
  priority?: number
  dueDate?: string | null
  labelIds?: string[]
  projectId?: string | null
  parentId?: string | null
}

export type ClassifiedError = {
  type:
    | 'permission_denied'
    | 'not_found'
    | 'issues_disabled'
    | 'validation_error'
    | 'rate_limited'
    | 'network_error'
    | 'unknown'
  message: string
}

// Why: declared here as a shared shape so IPC return envelopes and renderer
// slices can reference the same structural type without importing from main.
// Aliased as `OwnerRepo` in `src/main/github/gh-utils.ts` so main call sites
// can continue using the short local name.
export type GitHubOwnerRepo = GitHubRepositoryIdentity

// Why: GitLab-specific types live in `./gitlab-types` so they can grow
// independently from the central types file (which is touched by every
// upstream feature). Re-exported here so existing call sites
// (`from '../shared/types'`) keep working without changes.
export type {
  GitLabAssignableUser,
  GitLabAuthDiagnostic,
  GitLabCommentResult,
  GitLabDiscussionResolveResult,
  GitLabIssueInfo,
  GitLabIssueState,
  GitLabIssueUpdate,
  GitLabJobTraceResult,
  GitLabRateLimitBucket,
  GitLabRateLimitSnapshot,
  GitLabMRApprovalRule,
  GitLabMRApprovalState,
  GitLabMRFile,
  GitLabMRInlineCommentInput,
  GitLabMRReviewersUpdateResult,
  GitLabMRUpdate,
  GitLabPagedResult,
  GitLabPipelineJob,
  GitLabProjectRef,
  GitLabProjectSettings,
  GitLabRetryJobResult,
  GitLabReaction,
  GitLabTodo,
  GitLabTodoTargetType,
  GitLabViewer,
  GitLabWorkItem,
  GitLabWorkItemDetails,
  GetGitLabRateLimitResult,
  ListMergeRequestsResult,
  MRCheckDetail,
  MRComment,
  MRInfo,
  MRListState,
  MRMergeableState,
  MRState
} from './gitlab-types'

export type {
  JiraAuthType,
  JiraComment,
  JiraConnectArgs,
  JiraConnectionStatus,
  JiraCreateField,
  JiraCreateFieldAllowedValue,
  JiraCreateIssueArgs,
  JiraCreateIssueResult,
  JiraIssue,
  JiraIssueFilter,
  JiraIssueType,
  JiraIssueUpdate,
  JiraMutationResult,
  JiraPriority,
  JiraProject,
  JiraProjectStatusOrder,
  JiraSite,
  JiraSiteSelection,
  JiraStatus,
  JiraTransition,
  JiraUser,
  JiraViewer
} from './jira-types'

/**
 * GitHub API rate-limit buckets surfaced in the TaskPage header so users can
 * see remaining budget before they hit the wall. `core` = REST (5000/hr),
 * `search` = Search API (30/min — hit by countWorkItems), `graphql` =
 * GraphQL (5000 points/hr — hit by project-view + discovery). All three are
 * the buckets this app actually stresses; other buckets (e.g. code_search)
 * are not surfaced because we don't touch them.
 */
export type GitHubRateLimitBucket = {
  remaining: number
  limit: number
  /** Unix epoch seconds when the window resets. */
  resetAt: number
}

export type GitHubRateLimitSnapshot = {
  core: GitHubRateLimitBucket
  search: GitHubRateLimitBucket
  graphql: GitHubRateLimitBucket
  /** Unix epoch ms the snapshot was produced (for "fetched Xs ago" copy). */
  fetchedAt: number
}

export type GetRateLimitResult =
  | { ok: true; snapshot: GitHubRateLimitSnapshot }
  | { ok: false; error: string }

/**
 * Envelope for `gh:listWorkItems`. Carries resolved issue/PR sources so the
 * renderer can render the "Issues from owner/repo" indicator without an
 * extra IPC round-trip, and per-source classified errors so the UI can show
 * a retryable banner when (e.g.) a private upstream 403s.
 *
 * Why piggyback instead of adding `gh:resolveWorkItemSources`: the renderer
 * already round-trips this endpoint on every Tasks refresh, and the source
 * data is a 2-field-per-side metadata add — cheaper than another IPC call.
 *
 * Invariant: `items` always contains whatever succeeded; `errors.issues` indicates
 * the issues-side fetch failed, but any PR-side items that succeeded are still
 * present in `items`. Consumers should render `items` alongside the error banner.
 */
export type ListWorkItemsResult<T> = {
  items: T[]
  sources: {
    issues: GitHubOwnerRepo | null
    prs: GitHubOwnerRepo | null
    /** Raw `origin` remote resolved for this repo, independent of the
     *  user's preference. Required-nullable so the renderer can compare raw
     *  remote candidates without inferring origin from the effective PR
     *  source. */
    originCandidate: GitHubOwnerRepo | null
    /** Raw `upstream` remote resolved for this repo, independent of the
     *  user's preference. Present so the renderer's issue-source selector
     *  can always decide whether to render (upstream exists & differs from
     *  origin) and show both slugs in its tooltips, even when the user has
     *  picked 'origin' and `sources.issues` has collapsed onto origin. */
    upstreamCandidate: GitHubOwnerRepo | null
  }
  errors?: {
    issues?: ClassifiedError
  }
  /** True when the user's per-repo preference was `'upstream'` but no upstream
   *  remote is configured, so the resolver fell back to origin. Renderer uses
   *  this to surface a one-time-per-session toast. Omitted when absent so
   *  existing consumers and test fixtures don't care about it.
   *  Typed as `?: true` (not `?: boolean`) to encode the invariant "present
   *  iff fell-back" — an explicit `false` write would be a bug, so make it a
   *  compile error. */
  issueSourceFellBack?: true
}

export type LinearWorkflowState = {
  id: string
  name: string
  type: string
  color: string
  position: number
}

export type LinearLabel = {
  id: string
  name: string
  color: string
}

export type LinearMember = {
  id: string
  displayName: string
  name?: string
  email?: string
  avatarUrl?: string
}

export type LinearTeam = {
  id: string
  workspaceId?: string
  workspaceName?: string
  name: string
  key: string
  url?: string
}
