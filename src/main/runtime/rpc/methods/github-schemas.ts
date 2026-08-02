import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalFiniteNumber, OptionalString, requiredString } from '../schemas'

export const RepoSelector = z.object({
  repo: requiredString('Missing repo selector')
})

export const WorkItemsList = RepoSelector.extend({
  limit: OptionalFiniteNumber,
  query: OptionalString,
  page: z.number().int().positive().optional(),
  noCache: z.boolean().optional()
})

export const IssuesList = RepoSelector.extend({
  limit: OptionalFiniteNumber
})

export const WorkItem = RepoSelector.extend({
  number: z.number().int().positive(),
  type: z.enum(['issue', 'pr']).optional()
})

export const WorkItemByOwnerRepo = RepoSelector.extend({
  owner: requiredString('Missing owner'),
  ownerRepo: requiredString('Missing repo'),
  // Why: Enterprise host identity must survive RPC parsing; Zod strips
  // undeclared fields before the runtime can host-qualify gh requests.
  host: OptionalString,
  number: z.number().int().positive(),
  type: z.enum(['issue', 'pr'])
})

export const WorkItemDetails = WorkItem

export const WorkItemsCount = RepoSelector.extend({
  query: OptionalString
})

export const RateLimit = z.object({
  force: z.boolean().optional()
})

export const SlugRepo = z.object({
  owner: requiredString('Missing owner'),
  repo: requiredString('Missing repo'),
  // Why: Enterprise host identity must survive RPC parsing; Zod strips
  // undeclared fields before the runtime can host-qualify gh requests.
  host: OptionalString
})

export const SlugAssignableUsers = SlugRepo.extend({
  seedLogins: z.array(z.string()).optional()
})

export const PrForBranch = RepoSelector.extend({
  branch: requiredString('Missing branch'),
  linkedPRNumber: z.number().int().positive().nullable().optional(),
  fallbackPRNumber: z.number().int().positive().nullable().optional(),
  acceptMergedFallbackPR: z.boolean().optional(),
  currentHeadOid: z.string().nullable().optional()
})

export const Issue = RepoSelector.extend({
  number: z.number().int().positive()
})

export const PullRequest = RepoSelector.extend({
  prNumber: z.number().int().positive(),
  noCache: z.boolean().optional(),
  prRepo: SlugRepo.nullable().optional()
})

export const PullRequestChecks = PullRequest.extend({
  headSha: OptionalString
})

export const PullRequestCheckDetails = RepoSelector.extend({
  checkRunId: z.number().int().positive().optional(),
  workflowRunId: z.number().int().positive().optional(),
  checkName: OptionalString,
  url: OptionalString.nullable().optional(),
  prRepo: SlugRepo.nullable().optional()
})

export const RerunPullRequestChecks = PullRequest.extend({
  headSha: OptionalString,
  failedOnly: z.boolean().optional()
})

export const PullRequestFileContents = RepoSelector.extend({
  prNumber: z.number().int().positive(),
  prRepo: SlugRepo.nullable().optional(),
  path: requiredString('Missing file path'),
  oldPath: OptionalString,
  status: z.enum(['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged']),
  headSha: requiredString('Missing head SHA'),
  baseSha: requiredString('Missing base SHA')
})

export const PullRequestFileViewed = RepoSelector.extend({
  prRepo: SlugRepo.nullable().optional(),
  pullRequestId: requiredString('Missing pull request ID'),
  path: requiredString('Missing file path'),
  viewed: z.boolean()
})

export const ReviewThread = RepoSelector.extend({
  prRepo: SlugRepo.nullable().optional(),
  threadId: requiredString('Missing thread ID'),
  resolve: z.boolean()
})

export const UpdatePrTitle = RepoSelector.extend({
  prNumber: z.number().int().positive(),
  title: requiredString('Missing title'),
  prRepo: SlugRepo.nullable().optional()
})

export const UpdatePr = RepoSelector.extend({
  prNumber: z.number().int().positive(),
  updates: z.object({
    title: OptionalString,
    body: z.string().optional()
  }),
  prRepo: SlugRepo.nullable().optional()
})

export const MergePr = RepoSelector.extend({
  prNumber: z.number().int().positive(),
  method: z.enum(['merge', 'squash', 'rebase']).optional(),
  prRepo: SlugRepo.nullable().optional()
})

export const SetPrAutoMerge = RepoSelector.extend({
  prNumber: z.number().int().positive(),
  enabled: z.boolean(),
  method: z.enum(['merge', 'squash', 'rebase']).optional(),
  prRepo: SlugRepo.nullable().optional()
})

export const UpdatePrState = RepoSelector.extend({
  prNumber: z.number().int().positive(),
  prRepo: SlugRepo.nullable().optional(),
  updates: z.object({
    state: z.enum(['open', 'closed'])
  })
})

export const RequestPrReviewers = RepoSelector.extend({
  prNumber: z.number().int().positive(),
  prRepo: SlugRepo.nullable().optional(),
  reviewers: z.array(z.string()).min(1)
})

export const RemovePrReviewers = RepoSelector.extend({
  prNumber: z.number().int().positive(),
  prRepo: SlugRepo.nullable().optional(),
  reviewers: z.array(z.string()).min(1)
})

export const CreateIssue = RepoSelector.extend({
  title: requiredString('Missing title'),
  body: z.string(),
  labels: z.array(z.string()).optional(),
  assignees: z.array(z.string()).optional()
})

export const IssueUpdate = z.object({
  state: z.enum(['open', 'closed']).optional(),
  title: OptionalString,
  body: OptionalString,
  addLabels: z.array(z.string()).optional(),
  removeLabels: z.array(z.string()).optional(),
  addAssignees: z.array(z.string()).optional(),
  removeAssignees: z.array(z.string()).optional()
})

export const UpdateIssue = RepoSelector.extend({
  number: z.number().int().positive(),
  updates: IssueUpdate
})

export const IssueComment = RepoSelector.extend({
  number: z.number().int().positive(),
  body: requiredString('Comment body required'),
  type: z.enum(['issue', 'pr']).optional(),
  prRepo: SlugRepo.nullable().optional()
})

export const PRReviewComment = RepoSelector.extend({
  prNumber: z.number().int().positive(),
  prRepo: SlugRepo.nullable().optional(),
  commitId: requiredString('Missing PR head SHA'),
  path: requiredString('File path required'),
  line: z.number().int().positive(),
  startLine: z.number().int().positive().optional(),
  body: requiredString('Comment body required')
})

export const PRReviewCommentReply = RepoSelector.extend({
  prNumber: z.number().int().positive(),
  commentId: z.number().int().positive(),
  body: requiredString('Comment body required'),
  threadId: OptionalString,
  path: OptionalString,
  line: z.number().int().positive().optional(),
  prRepo: SlugRepo.nullable().optional()
})

export const ProjectOwnerType = z.enum(['organization', 'user'])

export const ProjectViewTable = z.object({
  owner: requiredString('Missing owner'),
  // Why: Enterprise host identity must survive RPC parsing; Zod strips
  // undeclared fields before the runtime can host-qualify gh requests.
  host: OptionalString,
  ownerType: ProjectOwnerType,
  projectNumber: z.number().int().positive(),
  viewId: OptionalString,
  viewNumber: z.number().int().positive().optional(),
  viewName: OptionalString,
  queryOverride: OptionalString
})

export const ProjectWorkItemDetailsBySlug = SlugRepo.extend({
  number: z.number().int().positive(),
  type: z.enum(['issue', 'pr'])
})

export const ProjectRef = z.object({
  input: requiredString('Missing project reference'),
  // Why: Enterprise host identity must survive RPC parsing; Zod strips
  // undeclared fields before the runtime can host-qualify gh requests.
  host: OptionalString
})

export const ProjectViews = z.object({
  owner: requiredString('Missing owner'),
  // Why: Enterprise host identity must survive RPC parsing; Zod strips
  // undeclared fields before the runtime can host-qualify gh requests.
  host: OptionalString,
  ownerType: ProjectOwnerType,
  projectNumber: z.number().int().positive()
})

export const ProjectItemField = z.object({
  projectId: requiredString('Missing project ID'),
  // Why: Enterprise host identity must survive RPC parsing; Zod strips
  // undeclared fields before the runtime can host-qualify gh requests.
  host: OptionalString,
  itemId: requiredString('Missing item ID'),
  fieldId: requiredString('Missing field ID'),
  value: z.any()
})

export const ClearProjectItemField = z.object({
  projectId: requiredString('Missing project ID'),
  // Why: Enterprise host identity must survive RPC parsing; Zod strips
  // undeclared fields before the runtime can host-qualify gh requests.
  host: OptionalString,
  itemId: requiredString('Missing item ID'),
  fieldId: requiredString('Missing field ID')
})

export const SlugIssueUpdate = z.object({
  owner: requiredString('Missing owner'),
  repo: requiredString('Missing repo'),
  // Why: Enterprise host identity must survive RPC parsing; Zod strips
  // undeclared fields before the runtime can host-qualify gh requests.
  host: OptionalString,
  number: z.number().int().positive(),
  updates: IssueUpdate
})

export const SlugPullRequestUpdate = z.object({
  owner: requiredString('Missing owner'),
  repo: requiredString('Missing repo'),
  // Why: Enterprise host identity must survive RPC parsing; Zod strips
  // undeclared fields before the runtime can host-qualify gh requests.
  host: OptionalString,
  number: z.number().int().positive(),
  updates: z.object({
    state: z.enum(['open', 'closed']).optional(),
    title: OptionalString,
    body: OptionalString
  })
})

export const SlugIssueTypeUpdate = z.object({
  owner: requiredString('Missing owner'),
  repo: requiredString('Missing repo'),
  // Why: Enterprise host identity must survive RPC parsing; Zod strips
  // undeclared fields before the runtime can host-qualify gh requests.
  host: OptionalString,
  number: z.number().int().positive(),
  issueTypeId: z.string().nullable()
})

export const SlugIssueComment = z.object({
  owner: requiredString('Missing owner'),
  repo: requiredString('Missing repo'),
  // Why: Enterprise host identity must survive RPC parsing; Zod strips
  // undeclared fields before the runtime can host-qualify gh requests.
  host: OptionalString,
  number: z.number().int().positive(),
  body: requiredString('Comment body required')
})

export const SlugIssueCommentEdit = z.object({
  owner: requiredString('Missing owner'),
  repo: requiredString('Missing repo'),
  // Why: Enterprise host identity must survive RPC parsing; Zod strips
  // undeclared fields before the runtime can host-qualify gh requests.
  host: OptionalString,
  commentId: z.number().int().positive(),
  body: requiredString('Comment body required')
})

export const SlugIssueCommentDelete = z.object({
  owner: requiredString('Missing owner'),
  repo: requiredString('Missing repo'),
  // Why: Enterprise host identity must survive RPC parsing; Zod strips
  // undeclared fields before the runtime can host-qualify gh requests.
  host: OptionalString,
  commentId: z.number().int().positive()
})

