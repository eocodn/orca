import type { RpcClient } from '../../../src/transport/rpc-client'
import type { WorkspaceAgentChoice } from '../../../src/tasks/workspace-agent-selection'
import type { GitHubProjectRef, GitHubProjectSettings, GitHubProjectSortDirection } from '../../../src/tasks/github-project-reference'
import type { LinearMobileIssue } from '../../../src/tasks/linear-mobile-issue-read'
import type { GitHubOwnerRepo, HostedReviewDecision, ProviderCheckSummary, TaskProvider, TuiAgent } from '../../../../src/shared/types'

export type RepoSummary = {
  id: string
  displayName: string
  path: string
  badgeColor?: string
  kind?: 'git' | 'folder'
  connectionId?: string | null
  issueSourcePreference?: IssueSourcePreference
}

export type IssueSourcePreference = 'upstream' | 'origin' | 'auto'

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
  branchName?: string
  baseRefName?: string
  isCrossRepository?: boolean
  additions?: number
  deletions?: number
  changedFiles?: number
  repoId: string
  repoName: string
  reviewDecision?: string | null
  reviewRequests?: GitHubAssignableUser[]
  latestReviews?: GitHubPRReviewSummary[]
  checksSummary?: ProviderCheckSummary
  mergeable?: GitHubPRMergeableState
  mergeStateStatus?: string | null
}
export type GitHubAssignableUser = {
  login: string
  name?: string | null
  avatarUrl?: string | null
}
export type GitHubPRReviewSummary = {
  login: string
  state?: string | null
  avatarUrl?: string | null
}
export type GitHubPRMergeableState = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'

export type GitHubPRReviewerRow = {
  login: string
  name?: string | null
  avatarUrl?: string | null
  stateLabel: string
}
export type GitHubRepoSources = {
  issues: GitHubOwnerRepo | null
  prs: GitHubOwnerRepo | null
  upstreamCandidate: GitHubOwnerRepo | null
}
export type TaskRuntimeStatus = {
  capabilities?: string[]
}

export type TasksSupportState =
  | { kind: 'unknown'; client: RpcClient | null }
  | { kind: 'supported'; client: RpcClient }
  | { kind: 'unsupported'; client: RpcClient }
export type GitLabWorkItem = {
  id: string
  type: 'issue' | 'mr'
  number: number
  title: string
  state: 'opened' | 'closed' | 'merged' | 'locked' | 'draft'
  url: string
  labels: string[]
  updatedAt: string
  author: string | null
  branchName?: string
  baseRefName?: string
  isCrossRepository?: boolean
  projectRef?: { host: string; path: string }
  checksSummary?: ProviderCheckSummary
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  reviewDecision?: HostedReviewDecision
  reviewerCount?: number
  repoId: string
  repoName: string
}

export type GitLabTodo = {
  id: number
  actionName: string
  targetType: string
  targetIid: number | null
  targetTitle: string
  targetUrl: string
  projectPath: string
  authorUsername: string
  updatedAt: string
  state: 'pending' | 'done'
}

export type GitPushTarget = {
  remoteName: string
  branchName: string
  remoteUrl?: string
}

export type SetupDecision = 'inherit' | 'run' | 'skip'
export type SetupRunPolicy = 'ask' | 'run-by-default' | 'skip-by-default'

export type RepoHooksResponse = {
  hooks: { scripts?: { setup?: string } } | null
  source: string | null
  setupRunPolicy?: SetupRunPolicy
  setupTrust?: {
    contentHash: string
    scriptContent: string
  }
}

export type LinearProject = {
  id: string
  name: string
  url?: string
  color?: string
}

export type LinearIssueChild = {
  id: string
  identifier: string
  title: string
  url: string
}

export type LinearIssue = LinearMobileIssue

export type LinearState = {
  id: string
  name: string
  type: string
  color?: string
}

export type LinearTeam = {
  id: string
  workspaceId?: string
  workspaceName?: string
  name: string
  key: string
}

export type DetailComment = {
  id: string | number
  author?: string
  authorAvatarUrl?: string
  user?: { displayName?: string }
  isBot?: boolean
  body: string
  createdAt?: string
  url?: string
  reactions?: Array<{
    content:
      | 'thumbs_up'
      | 'thumbs_down'
      | 'laugh'
      | 'confused'
      | 'heart'
      | 'hooray'
      | 'rocket'
      | 'eyes'
    count: number
  }>
  path?: string
  line?: number
  startLine?: number
  threadId?: string
  isResolved?: boolean
}

export type GitHubDetailFile = {
  path: string
  oldPath?: string
  status?: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged'
  additions?: number
  deletions?: number
  isBinary?: boolean
  viewerViewedState?: 'DISMISSED' | 'VIEWED' | 'UNVIEWED'
}

export type GitHubDetailCheck = {
  name: string
  status: string
  conclusion?: string | null
  url?: string | null
}

export type GitHubPRFileContents = {
  original: string
  modified: string
  originalIsBinary: boolean
  modifiedIsBinary: boolean
}

export type DetailPayload =
  | {
      provider: 'github'
      body: string
      comments: DetailComment[]
      labels: string[]
      assignees: string[]
      reviewDecision?: string | null
      reviewRequests: GitHubAssignableUser[]
      latestReviews: GitHubPRReviewSummary[]
      headSha?: string
      baseSha?: string
      pullRequestId?: string
      checks: GitHubDetailCheck[]
      files: GitHubDetailFile[]
    }
  | {
      provider: 'gitlab'
      body: string
      comments: DetailComment[]
      labels: string[]
      assignees: string[]
      pipelineJobs: Array<{
        id?: number
        name: string
        stage: string
        status: string
        webUrl?: string | null
        duration?: number | null
      }>
    }
  | {
      provider: 'linear'
      description: string
      comments: DetailComment[]
      labels: string[]
      assignee?: string
      project?: LinearProject
      children: LinearIssueChild[]
    }

export type GitHubTaskKind = 'issues' | 'prs'
export type GitHubMode = GitHubTaskKind | 'project'
export type GitHubPreset = 'issues' | 'my-issues' | 'prs' | 'my-prs' | 'review'
export type GitLabView = 'project' | 'todos'
export type GitLabFilter = 'opened' | 'merged' | 'closed' | 'all'
export type LinearFilter = 'assigned' | 'created' | 'all' | 'completed'
export type LinearViewMode = 'list' | 'board'
export type LinearGroupBy = 'none' | 'status' | 'assignee' | 'priority' | 'team'
export type LinearOrderBy = 'priority' | 'updated' | 'identifier'
export type LinearDisplayProperty = 'state' | 'priority' | 'assignee' | 'team' | 'labels' | 'updated'
export type TaskSort = 'updated' | 'repository'
export type DetailCommentGroup =
  | { kind: 'standalone'; comment: DetailComment }
  | { kind: 'thread'; threadId: string; root: DetailComment; replies: DetailComment[] }
export type TaskResumeState = {
  githubMode?: 'items' | 'project'
  githubItemsPreset?: GitHubPreset | 'all' | null
  githubItemsQuery?: string
  githubProjectHiddenFieldIdsByView?: Record<string, string[]>
  linearPreset?: LinearFilter
  linearQuery?: string
}
export type RuntimeTaskSettings = {
  defaultTuiAgent?: TuiAgent | 'blank' | null
  disabledTuiAgents?: TuiAgent[]
  agentCmdOverrides?: Record<string, string>
  defaultTaskSource?: TaskProvider
  defaultTaskViewPreset?: GitHubPreset | 'all'
  visibleTaskProviders?: TaskProvider[]
  defaultRepoSelection?: string[] | null
  defaultLinearTeamSelection?: string[] | null
  githubProjects?: GitHubProjectSettings
}

export type LinearWorkspace = {
  id: string
  organizationName?: string
  displayName?: string
}

export type LinearStatusResponse = {
  connected?: boolean
  workspaces?: LinearWorkspace[]
  selectedWorkspaceId?: string | 'all' | null
  activeWorkspaceId?: string | null
}

export type GitHubIssueType = {
  id: string
  name: string
  color: string | null
  description: string | null
}
export type GitHubProjectField =
  | {
      kind: 'field'
      id: string
      name: string
      dataType: string
    }
  | {
      kind: 'single-select'
      id: string
      name: string
      dataType: 'SINGLE_SELECT'
      options: Array<{ id: string; name: string; color: string }>
    }
  | {
      kind: 'iteration'
      id: string
      name: string
      dataType: 'ITERATION'
      iterations: Array<{
        id: string
        title: string
        startDate: string
        duration: number
        completed?: boolean
      }>
    }
export type GitHubProjectSort = {
  direction: GitHubProjectSortDirection
  field: GitHubProjectField
}
export type GitHubProjectFieldValue =
  | { kind: 'single-select'; fieldId: string; optionId: string; name: string; color: string }
  | {
      kind: 'iteration'
      fieldId: string
      iterationId: string
      title: string
      startDate: string
      duration: number
    }
  | { kind: 'text'; fieldId: string; text: string }
  | { kind: 'number'; fieldId: string; number: number }
  | { kind: 'date'; fieldId: string; date: string }
  | { kind: 'labels'; fieldId: string; labels: Array<{ name: string; color: string }> }
  | { kind: 'users'; fieldId: string; users: Array<{ login: string; name: string | null }> }
export type GitHubProjectFieldMutationValue =
  | { kind: 'text'; text: string }
  | { kind: 'number'; number: number }
  | { kind: 'date'; date: string }
  | { kind: 'single-select'; optionId: string }
  | { kind: 'iteration'; iterationId: string }
export type GitHubProjectRow = {
  id: string
  itemType: 'ISSUE' | 'PULL_REQUEST' | 'DRAFT_ISSUE' | 'REDACTED'
  content: {
    number: number | null
    title: string
    body: string | null
    url: string | null
    state: string | null
    stateReason?: string | null
    isDraft: boolean | null
    repository: string | null
    issueType?: GitHubIssueType | null
    labels: Array<{ name: string; color: string }>
    assignees: Array<{ login: string; name: string | null }>
    parentIssue?: { number: number; title: string; url: string } | null
  }
  fieldValuesByFieldId?: Record<string, GitHubProjectFieldValue>
  updatedAt: string
  position?: number
}
export type GitHubProjectTable = {
  project: GitHubProjectRef & {
    id: string
    title: string
    url: string
  }
  selectedView: {
    id: string
    number: number
    name: string
    filter: string
    layout: 'TABLE_LAYOUT' | 'BOARD_LAYOUT' | 'ROADMAP_LAYOUT'
    fields?: GitHubProjectField[]
    groupByFields?: GitHubProjectField[]
    sortByFields?: GitHubProjectSort[]
  }
  rows: GitHubProjectRow[]
  totalCount: number
  parentFieldDropped?: boolean
}

export type TaskItem =
  | {
      key: string
      provider: 'github'
      title: string
      subtitle: string
      status: string
      updatedAt: string
      source: GitHubWorkItem
    }
  | {
      key: string
      provider: 'gitlab'
      title: string
      subtitle: string
      status: string
      updatedAt: string
      source: GitLabWorkItem
    }
  | {
      key: string
      provider: 'gitlabTodo'
      title: string
      subtitle: string
      status: string
      updatedAt: string
      source: GitLabTodo
    }
  | {
      key: string
      provider: 'linear'
      title: string
      subtitle: string
      status: string
      updatedAt: string
      source: LinearIssue
    }

export type ActionableTaskItem = Exclude<TaskItem, { provider: 'gitlabTodo' }>
export type HostedReviewMergeMethod = 'merge' | 'squash' | 'rebase'
export type HostedReviewItem =
  | Extract<TaskItem, { provider: 'github' }>
  | Extract<TaskItem, { provider: 'gitlab' }>
export type PendingHostedMerge = {
  item: HostedReviewItem
  method: HostedReviewMergeMethod
}
export type PendingProjectGitHubMerge = {
  row: GitHubProjectRow
  method: HostedReviewMergeMethod
}
export type PendingHostedStateChange =
  | {
      source: 'task'
      item: Extract<TaskItem, { provider: 'github' }> | Extract<TaskItem, { provider: 'gitlab' }>
      nextState: 'open' | 'opened' | 'closed'
    }
  | {
      source: 'project'
      row: GitHubProjectRow
      nextState: 'open' | 'closed'
    }

export type SetupPrompt = {
  item: ActionableTaskItem
  repoIdOverride?: string
  agentOverride?: WorkspaceAgentChoice
  workspaceNameOverride?: string
  noteOverride?: string
  baseBranchOverride?: string
  branchNameOverride?: string
  sparseCheckoutOverride?: { directories: string[]; presetId?: string }
  repoName: string
  command: string
  source: string | null
}

export type WorkspaceCreateArgs = {
  item: ActionableTaskItem
  repoIdOverride?: string
  setupOverride?: Exclude<SetupDecision, 'inherit'>
  agentOverride?: WorkspaceAgentChoice
  workspaceNameOverride?: string
  noteOverride?: string
  baseBranchOverride?: string
  branchNameOverride?: string
  sparseCheckoutOverride?: { directories: string[]; presetId?: string }
}

export type OrcaYamlTrustPrompt = WorkspaceCreateArgs & {
  repoId: string
  repoName: string
  scriptContent: string
  contentHash: string
  previouslyApproved: boolean
}

export type WorkspaceCreateDraft = {
  item: ActionableTaskItem
  repoIdOverride?: string
}

export type WorkspaceSparseDraft = {
