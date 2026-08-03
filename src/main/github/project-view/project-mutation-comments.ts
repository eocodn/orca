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
  type GraphqlVars
} from './internals'
import { classifyProjectError, rateLimitedError } from './project-error-classification'
import type { GitHubAssignableUser, PRComment } from '../../../shared/types'
import type {
  AddIssueCommentBySlugArgs,
  DeleteIssueCommentBySlugArgs,
  GitHubProjectCommentMutationResult,
  GitHubProjectMutationResult,
  ListAssignableUsersBySlugArgs,
  ListAssignableUsersBySlugResult,
  ListIssueTypesBySlugArgs,
  ListIssueTypesBySlugResult,
  ListLabelsBySlugArgs,
  ListLabelsBySlugResult,
  UpdateIssueCommentBySlugArgs,
  UpdateIssueTypeBySlugArgs
} from '../../../shared/github-project-types'
import { githubHostExecOptions } from './project-mutation-fields'
type RawIssueCommentResponse = {
  id?: number
  user?: { login?: string; avatar_url?: string; type?: string } | null
  body?: string
  created_at?: string
  html_url?: string
}

function mapIssueComment(data: RawIssueCommentResponse, fallbackBody: string): PRComment {
  return {
    id: data.id ?? Date.now(),
    author: data.user?.login ?? 'You',
    authorAvatarUrl: data.user?.avatar_url ?? '',
    body: data.body ?? fallbackBody,
    createdAt: data.created_at ?? new Date().toISOString(),
    url: data.html_url ?? '',
    isBot: data.user?.type === 'Bot'
  }
}

async function addIssueCommentBySlug(
  args: AddIssueCommentBySlugArgs
): Promise<GitHubProjectCommentMutationResult> {
  const v = validateSlugArgs(args.owner, args.repo)
  if (!v.ok) {
    return v
  }
  const n = assertPositiveInt(args.number, 'number')
  if (!n.ok) {
    return { ok: false, error: n.error }
  }
  if (typeof args.body !== 'string' || !args.body.trim()) {
    return { ok: false, error: { type: 'validation_error', message: 'Comment body required.' } }
  }
  const r = await runRest<RawIssueCommentResponse>(
    [
      '-X',
      'POST',
      `repos/${args.owner}/${args.repo}/issues/${args.number}/comments`,
      '--raw-field',
      `body=${args.body}`
    ],
    undefined,
    'core',
    githubHostExecOptions(args)
  )
  if (!r.ok) {
    return { ok: false, error: r.error }
  }
  return { ok: true, comment: mapIssueComment(r.data, args.body) }
}

async function updateIssueCommentBySlug(
  args: UpdateIssueCommentBySlugArgs
): Promise<GitHubProjectMutationResult> {
  const v = validateSlugArgs(args.owner, args.repo)
  if (!v.ok) {
    return v
  }
  const n = assertPositiveInt(args.commentId, 'commentId')
  if (!n.ok) {
    return { ok: false, error: n.error }
  }
  if (typeof args.body !== 'string' || !args.body.trim()) {
    return { ok: false, error: { type: 'validation_error', message: 'Comment body required.' } }
  }
  const r = await runRest<unknown>(
    [
      '-X',
      'PATCH',
      `repos/${args.owner}/${args.repo}/issues/comments/${args.commentId}`,
      '--raw-field',
      `body=${args.body}`
    ],
    undefined,
    'core',
    githubHostExecOptions(args)
  )
  if (!r.ok) {
    return { ok: false, error: r.error }
  }
  return { ok: true }
}

async function deleteIssueCommentBySlug(
  args: DeleteIssueCommentBySlugArgs
): Promise<GitHubProjectMutationResult> {
  const v = validateSlugArgs(args.owner, args.repo)
  if (!v.ok) {
    return v
  }
  const n = assertPositiveInt(args.commentId, 'commentId')
  if (!n.ok) {
    return { ok: false, error: n.error }
  }
  const r = await runRest<unknown>(
    ['-X', 'DELETE', `repos/${args.owner}/${args.repo}/issues/comments/${args.commentId}`],
    undefined,
    'core',
    { expectEmpty: true, ...githubHostExecOptions(args) }
  )
  if (!r.ok) {
    return { ok: false, error: r.error }
  }
  return { ok: true }
}

// ─── Slug-addressed picker sources ────────────────────────────────────

async function listLabelsBySlug(
  args: ListLabelsBySlugArgs
): Promise<ListLabelsBySlugResult> {
  const v = validateSlugArgs(args.owner, args.repo)
  if (!v.ok) {
    return v
  }
  const authError = await projectHostAuthenticationError(args.host)
  if (authError) {
    return { ok: false, error: authError }
  }
  const guard = repositoryRateLimitGuard(args, 'core')
  if (guard.blocked) {
    return { ok: false, error: rateLimitedError(guard) }
  }
  await acquire()
  // Why: `--paginate` may fan out to multiple pages; we can only reasonably
  // estimate a 1-call spend up front. The next probe will reconcile.
  noteRepositoryRateLimitSpend(args, 'core')
  try {
    const { stdout } = await ghExecFileAsync(
      ['api', '--paginate', `repos/${args.owner}/${args.repo}/labels`, '--jq', '.[].name'],
      { encoding: 'utf-8', ...githubHostExecOptions(args) }
    )
    return {
      ok: true,
      labels: stdout
        .trim()
        .split('\n')
        .filter((l) => l.length > 0)
    }
  } catch (err) {
    const { stderr, stdout: maybeStdout } = extractExecError(err)
    return { ok: false, error: classifyProjectError(stderr, maybeStdout, args.host) }
  } finally {
    release()
  }
}

async function listAssignableUsersBySlug(
  args: ListAssignableUsersBySlugArgs
): Promise<ListAssignableUsersBySlugResult> {
  const v = validateSlugArgs(args.owner, args.repo)
  if (!v.ok) {
    return v
  }
  const authError = await projectHostAuthenticationError(args.host)
  if (authError) {
    return { ok: false, error: authError }
  }
  // Seed logins merge after the fetch so callers can include currently-visible
  // assignees even if the repo participant search is sparse.
  const result: GitHubAssignableUser[] = []
  const guard = repositoryRateLimitGuard(args, 'core')
  if (guard.blocked) {
    return { ok: false, error: rateLimitedError(guard) }
  }
  await acquire()
  noteRepositoryRateLimitSpend(args, 'core')
  try {
    const { stdout } = await ghExecFileAsync(
      [
        'api',
        '--paginate',
        `repos/${args.owner}/${args.repo}/assignees`,
        '--jq',
        '.[] | {login: .login, name: null, avatarUrl: .avatar_url}'
      ],
      { encoding: 'utf-8', ...githubHostExecOptions(args) }
    )
    for (const line of stdout
      .trim()
      .split('\n')
      .filter((l) => l.length > 0)) {
      try {
        const u = JSON.parse(line) as { login?: string; avatarUrl?: string; name?: string | null }
        if (typeof u.login === 'string') {
          result.push({ login: u.login, name: u.name ?? null, avatarUrl: u.avatarUrl ?? '' })
        }
      } catch {
        // skip malformed jq line
      }
    }
  } catch (err) {
    const { stderr } = extractExecError(err)
    return { ok: false, error: classifyProjectError(stderr, '', args.host) }
  } finally {
    release()
  }
  if (args.seedLogins) {
    const seen = new Set(result.map((u) => u.login))
    for (const login of args.seedLogins) {
      if (typeof login === 'string' && !seen.has(login)) {
        result.push({ login, name: null, avatarUrl: '' })
        seen.add(login)
      }
    }
  }
  return { ok: true, users: result }
}

// Why: Issue Types are a repo-level taxonomy (Bug/Feature/Task/etc) only
// available on repos opted into typed-issues. Empty list (or schema_drift on
// older GitHub deployments) is the legitimate "this repo doesn't use issue
// types" signal — callers should treat it as "no editor".
async function listIssueTypesBySlug(
  args: ListIssueTypesBySlugArgs
): Promise<ListIssueTypesBySlugResult> {
  const v = validateSlugArgs(args.owner, args.repo)
  if (!v.ok) {
    return v
  }
  const query = `
    query($owner:String!, $repo:String!) {
      repository(owner:$owner, name:$repo) {
        issueTypes(first:50) {
          nodes { id name color description }
        }
      }
    }
  `
  const res = await runGraphql<{
    repository?: {
      issueTypes?: {
        nodes?: ({
          id?: string
          name?: string
          color?: string | null
          description?: string | null
        } | null)[]
      } | null
    } | null
  }>(query, { owner: args.owner, repo: args.repo }, githubHostExecOptions(args))
  if (!res.ok) {
    // Why: repos without issue types respond with a GraphQL error claiming the
    // `issueTypes` field is unknown. Map that to an empty list so the UI shows
    // "no editor" instead of an angry banner.
    if (res.error.type === 'schema_drift' || res.error.type === 'validation_error') {
      return { ok: true, types: [] }
    }
    return { ok: false, error: res.error }
  }
  const nodes = res.data.repository?.issueTypes?.nodes ?? []
  const types = nodes
    .filter(
      (n): n is NonNullable<typeof n> =>
        n !== null && typeof n.id === 'string' && typeof n.name === 'string'
    )
    .map((n) => ({
      id: n.id as string,
      name: n.name as string,
      color: typeof n.color === 'string' ? n.color : null,
      description: typeof n.description === 'string' ? n.description : null
    }))
  return { ok: true, types }
}

async function updateIssueTypeBySlug(
  args: UpdateIssueTypeBySlugArgs
): Promise<GitHubProjectMutationResult> {
  const v = validateSlugArgs(args.owner, args.repo)
  if (!v.ok) {
    return v
  }
  const n = assertPositiveInt(args.number, 'number')
  if (!n.ok) {
    return { ok: false, error: n.error }
  }
  // Why: `updateIssueIssueType` is the dedicated mutation; passing null for
  // `issueTypeId` clears the type. We resolve the issue id via a lightweight
  // GraphQL lookup because the REST endpoint doesn't accept issue types.
  const lookup = await runGraphql<{
    repository?: { issue?: { id?: string } | null } | null
  }>(
    `query($owner:String!, $repo:String!, $num:Int!) {
       repository(owner:$owner, name:$repo) { issue(number:$num) { id } }
     }`,
    { owner: args.owner, repo: args.repo, num: args.number },
    githubHostExecOptions(args)
  )
  if (!lookup.ok) {
    return { ok: false, error: lookup.error }
  }
  const issueId = lookup.data.repository?.issue?.id
  if (!issueId) {
    return { ok: false, error: { type: 'not_found', message: 'Issue not found.' } }
  }
  // Why: build the mutation conditionally so a null clear doesn't have to
  // smuggle a null GraphQL variable through `gh api graphql -f`. The
  // mutation accepts a literal `null` in the input object directly.
  const query = args.issueTypeId
    ? `
        mutation($issueId:ID!, $issueTypeId:ID!) {
          updateIssueIssueType(input: { issueId: $issueId, issueTypeId: $issueTypeId }) {
            issue { id }
          }
        }
      `
    : `
        mutation($issueId:ID!) {
          updateIssueIssueType(input: { issueId: $issueId, issueTypeId: null }) {
            issue { id }
          }
        }
      `
  const vars: GraphqlVars = args.issueTypeId
    ? { issueId, issueTypeId: args.issueTypeId }
    : { issueId }
  const res = await runGraphql<unknown>(query, vars, githubHostExecOptions(args))
  if (!res.ok) {
    return { ok: false, error: res.error }
  }
  return { ok: true }
}

// ─── Slug-addressed work-item details ─────────────────────────────────

export { mapIssueComment, addIssueCommentBySlug, updateIssueCommentBySlug, deleteIssueCommentBySlug, listLabelsBySlug, listAssignableUsersBySlug, listIssueTypesBySlug, updateIssueTypeBySlug }
export { type RawIssueCommentResponse }

