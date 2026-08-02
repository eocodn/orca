import {
  acquire,
  release,
  extractExecError,
  ghExecFileAsync,
  repositoryRateLimitGuard,
  noteRepositoryRateLimitSpend,
  runGraphql,
  runRest,
  validateSlugArgs,
  assertPositiveInt,
  projectHostAuthenticationError,
  projectGhExecOptions,
  type GraphqlVars
} from './internals'
import { classifyProjectError, rateLimitedError } from './project-error-classification'
import { githubProjectHost } from '../../../shared/github-project-identity'
import type { GitHubAssignableUser, GitHubWorkItemDetails, PRComment } from '../../../shared/types'
import type {
  AddIssueCommentBySlugArgs,
  ClearProjectItemFieldArgs,
  DeleteIssueCommentBySlugArgs,
  GitHubProjectCommentMutationResult,
  GitHubProjectFieldMutationValue,
  GitHubProjectMutationResult,
  ListAssignableUsersBySlugArgs,
  ListAssignableUsersBySlugResult,
  ListIssueTypesBySlugArgs,
  ListIssueTypesBySlugResult,
  ListLabelsBySlugArgs,
  ListLabelsBySlugResult,
  ProjectWorkItemDetailsBySlugArgs,
  ProjectWorkItemDetailsBySlugResult,
  UpdateIssueBySlugArgs,
  UpdateIssueCommentBySlugArgs,
  UpdateIssueTypeBySlugArgs,
  UpdatePullRequestBySlugArgs,
  UpdateProjectItemFieldArgs
} from '../../../shared/github-project-types'
import { githubHostExecOptions } from './project-mutation-fields'
type RawUser = { login?: string; name?: string | null; avatarUrl?: string | null }
type RawLabel = { name?: string; color?: string }
type RawWorkItemContent = {
  id?: string
  number?: number
  title?: string
  url?: string
  state?: string
  stateReason?: string | null
  isDraft?: boolean
  labels?: { nodes?: RawLabel[] }
  assignees?: { nodes?: RawUser[] }
}

async function getWorkItemDetailsBySlug(
  args: ProjectWorkItemDetailsBySlugArgs
): Promise<ProjectWorkItemDetailsBySlugResult> {
  const v = validateSlugArgs(args.owner, args.repo)
  if (!v.ok) {
    return v
  }
  const n = assertPositiveInt(args.number, 'number')
  if (!n.ok) {
    return { ok: false, error: n.error }
  }
  if (args.type !== 'issue' && args.type !== 'pr') {
    return { ok: false, error: { type: 'validation_error', message: 'Invalid type.' } }
  }

  // Single GraphQL round-trip to fetch the issue/PR summary + comments + labels + assignees.
  const contentFrag =
    args.type === 'issue'
      ? `
        issue(number:$num) {
          id number title url state stateReason updatedAt
          body
          author { login }
          labels(first:50) { nodes { name } }
          assignees(first:50) { nodes { login } }
          participants(first:50) { nodes { login name avatarUrl } }
          comments(first:100) {
            nodes {
              databaseId
              author { login avatarUrl __typename }
              body createdAt url
            }
          }
        }
      `
      : `
        pullRequest(number:$num) {
          id number title url state isDraft updatedAt headRefName baseRefName
          body
          author { login }
          labels(first:50) { nodes { name } }
          assignees(first:50) { nodes { login } }
          participants(first:50) { nodes { login name avatarUrl } }
          comments(first:100) {
            nodes {
              databaseId
              author { login avatarUrl __typename }
              body createdAt url
            }
          }
        }
      `
  const query = `
    query($owner:String!, $repo:String!, $num:Int!) {
      repository(owner:$owner, name:$repo) {
        ${contentFrag}
      }
    }
  `
  const res = await runGraphql<{
    repository?: {
      issue?:
        | (RawWorkItemContent & {
            updatedAt?: string
            body?: string
            author?: { login?: string } | null
            participants?: { nodes?: RawUser[] }
            comments?: {
              nodes?: ({
                databaseId?: number
                author?: { login?: string; avatarUrl?: string; __typename?: string } | null
                body?: string
                createdAt?: string
                url?: string
              } | null)[]
            }
          })
        | null
      pullRequest?:
        | (RawWorkItemContent & {
            updatedAt?: string
            body?: string
            headRefName?: string
            baseRefName?: string
            author?: { login?: string } | null
            participants?: { nodes?: RawUser[] }
            comments?: {
              nodes?: ({
                databaseId?: number
                author?: { login?: string; avatarUrl?: string; __typename?: string } | null
                body?: string
                createdAt?: string
                url?: string
              } | null)[]
            }
          })
        | null
    } | null
  }>(query, { owner: args.owner, repo: args.repo, num: args.number }, githubHostExecOptions(args))
  if (!res.ok) {
    return { ok: false, error: res.error }
  }
  const raw = args.type === 'issue' ? res.data.repository?.issue : res.data.repository?.pullRequest
  if (!raw) {
    return { ok: false, error: { type: 'not_found', message: 'Item not found.' } }
  }

  const labels = (raw.labels?.nodes ?? [])
    .map((l) => l?.name)
    .filter((n): n is string => typeof n === 'string')
  const assignees = (raw.assignees?.nodes ?? [])
    .map((a) => a?.login)
    .filter((l): l is string => typeof l === 'string')
  const comments: PRComment[] = []
  for (const c of raw.comments?.nodes ?? []) {
    if (!c || typeof c.body !== 'string') {
      continue
    }
    comments.push({
      id: typeof c.databaseId === 'number' ? c.databaseId : Date.now(),
      author: c.author?.login ?? '',
      authorAvatarUrl: c.author?.avatarUrl ?? '',
      body: c.body,
      createdAt: typeof c.createdAt === 'string' ? c.createdAt : '',
      url: typeof c.url === 'string' ? c.url : '',
      isBot: c.author?.__typename === 'Bot'
    })
  }
  const participants: GitHubAssignableUser[] = []
  for (const p of raw.participants?.nodes ?? []) {
    if (p && typeof p.login === 'string') {
      participants.push({ login: p.login, name: p.name ?? null, avatarUrl: p.avatarUrl ?? '' })
    }
  }

  const state: 'open' | 'closed' | 'merged' | 'draft' =
    args.type === 'pr'
      ? raw.isDraft
        ? 'draft'
        : raw.state === 'MERGED'
          ? 'merged'
          : raw.state === 'CLOSED'
            ? 'closed'
            : 'open'
      : raw.state === 'CLOSED'
        ? 'closed'
        : 'open'

  const details: GitHubWorkItemDetails = {
    item: {
      id: typeof raw.id === 'string' ? raw.id : '',
      type: args.type,
      number: typeof raw.number === 'number' ? raw.number : args.number,
      title: typeof raw.title === 'string' ? raw.title : '',
      state,
      url: typeof raw.url === 'string' ? raw.url : '',
      labels,
      updatedAt:
        typeof (raw as { updatedAt?: string }).updatedAt === 'string'
          ? (raw as { updatedAt: string }).updatedAt
          : '',
      author:
        typeof (raw as { author?: { login?: string } | null }).author?.login === 'string'
          ? ((raw as { author: { login: string } }).author.login as string)
          : null,
      branchName:
        args.type === 'pr' && typeof (raw as { headRefName?: string }).headRefName === 'string'
          ? ((raw as { headRefName: string }).headRefName as string)
          : undefined,
      baseRefName:
        args.type === 'pr' && typeof (raw as { baseRefName?: string }).baseRefName === 'string'
          ? ((raw as { baseRefName: string }).baseRefName as string)
          : undefined
    },
    body: typeof raw.body === 'string' ? raw.body : '',
    comments,
    participants,
    // Why: PR files/checks/review-thread tabs depend on a local repo path and
    // are out of Project-mode slug scope for v1. Omit them here; the dialog
    // branches on their absence and hides those tabs.
    assignees
  }
  return { ok: true, details }
}

export { getWorkItemDetailsBySlug }
export { type RawUser, type RawLabel, type RawWorkItemContent }

