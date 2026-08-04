import type {
  IssueSourcePreference,
  MRComment
} from '../../shared/types'
import type { GitLabDiscussionResolveResult, GitLabMRInlineCommentInput } from '../../shared/gitlab-types'
import {
  acquire,
  classifyGlabError,
  getGlabKnownHosts,
  glabHostnameArgs,
  glabRepoExecOptions,
  glabExecFileAsync,
  release,
  resolveIssueSource,
  type LocalGitExecOptions,
  type ProjectRef
} from './gl-utils'

// Why: glab REST addresses projects by URL-encoded path; escapes slashes for nested groups.
import { encodedProject } from './gitlab-auth-project'
async function withProjectRef<T>(
  repoPath: string,
  preference: IssueSourcePreference | undefined,
  connectionId: string | null | undefined,
  explicitProjectRef: ProjectRef | null | undefined,
  fn: (projectRef: ProjectRef, repoFlag: string) => Promise<T>,
  fallback: T,
  localGitOptions: LocalGitExecOptions = {}
): Promise<T> {
  const projectRef =
    explicitProjectRef ??
    (
      await resolveIssueSource(
        repoPath,
        preference,
        await getGlabKnownHosts(connectionId, localGitOptions),
        connectionId,
        localGitOptions
      )
    ).source
  if (!projectRef) {
    return fallback
  }
  return fn(projectRef, projectRef.path)
}

async function closeMR(
  repoPath: string,
  iid: number,
  preference?: IssueSourcePreference,
  connectionId?: string | null,
  projectRef?: ProjectRef | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withProjectRef<{ ok: true } | { ok: false; error: string }>(
    repoPath,
    preference,
    connectionId,
    projectRef,
    async (projectRef, repoFlag) => {
      await acquire()
      try {
        await glabExecFileAsync(
          [
            'mr',
            'close',
            String(iid),
            '-R',
            repoFlag,
            ...glabHostnameArgs(projectRef, connectionId)
          ],
          glabRepoExecOptions(repoPath, connectionId, localGitOptions)
        )
        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Why: glab exits non-zero when the MR is already closed — treat as success.
        if (msg.toLowerCase().includes('already')) {
          return { ok: true }
        }
        return { ok: false, error: msg }
      } finally {
        release()
      }
    },
    { ok: false, error: 'Could not resolve GitLab project for this repository' },
    localGitOptions
  )
}

async function reopenMR(
  repoPath: string,
  iid: number,
  preference?: IssueSourcePreference,
  connectionId?: string | null,
  projectRef?: ProjectRef | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withProjectRef<{ ok: true } | { ok: false; error: string }>(
    repoPath,
    preference,
    connectionId,
    projectRef,
    async (projectRef, repoFlag) => {
      await acquire()
      try {
        await glabExecFileAsync(
          [
            'mr',
            'reopen',
            String(iid),
            '-R',
            repoFlag,
            ...glabHostnameArgs(projectRef, connectionId)
          ],
          glabRepoExecOptions(repoPath, connectionId, localGitOptions)
        )
        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.toLowerCase().includes('already')) {
          return { ok: true }
        }
        return { ok: false, error: msg }
      } finally {
        release()
      }
    },
    { ok: false, error: 'Could not resolve GitLab project for this repository' },
    localGitOptions
  )
}

async function mergeMR(
  repoPath: string,
  iid: number,
  method: 'merge' | 'squash' | 'rebase' = 'merge',
  preference?: IssueSourcePreference,
  connectionId?: string | null,
  projectRef?: ProjectRef | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withProjectRef<{ ok: true } | { ok: false; error: string }>(
    repoPath,
    preference,
    connectionId,
    projectRef,
    async (projectRef, repoFlag) => {
      await acquire()
      try {
        // Why: omitting both --squash and --rebase yields a regular merge commit.
        const methodFlag =
          method === 'squash' ? ['--squash'] : method === 'rebase' ? ['--rebase'] : []
        await glabExecFileAsync(
          [
            'mr',
            'merge',
            String(iid),
            '-R',
            repoFlag,
            '--yes',
            ...methodFlag,
            ...glabHostnameArgs(projectRef, connectionId)
          ],
          glabRepoExecOptions(repoPath, connectionId, localGitOptions)
        )
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      } finally {
        release()
      }
    },
    { ok: false, error: 'Could not resolve GitLab project for this repository' },
    localGitOptions
  )
}

async function addMRComment(
  repoPath: string,
  iid: number,
  body: string,
  preference?: IssueSourcePreference,
  connectionId?: string | null,
  projectRef?: ProjectRef | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<{ ok: true; comment: MRComment } | { ok: false; error: string }> {
  return withProjectRef<{ ok: true; comment: MRComment } | { ok: false; error: string }>(
    repoPath,
    preference,
    connectionId,
    projectRef,
    async (projectRef) => {
      await acquire()
      try {
        const { stdout } = await glabExecFileAsync(
          [
            'api',
            ...glabHostnameArgs(projectRef, connectionId),
            '-X',
            'POST',
            `projects/${encodedProject(projectRef.path)}/merge_requests/${iid}/notes`,
            '-f',
            `body=${body}`
          ],
          glabRepoExecOptions(repoPath, connectionId, localGitOptions)
        )
        const data = JSON.parse(stdout) as {
          id?: number
          author?: { username?: string; avatar_url?: string; state?: string } | null
          body?: string
          created_at?: string
        }
        return {
          ok: true,
          comment: {
            id: data.id ?? Date.now(),
            author: data.author?.username ?? 'You',
            authorAvatarUrl: data.author?.avatar_url ?? '',
            body: data.body ?? body,
            createdAt: data.created_at ?? new Date().toISOString(),
            url: '',
            isBot: data.author?.state === 'bot'
          }
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      } finally {
        release()
      }
    },
    { ok: false, error: 'Could not resolve GitLab project for this repository' },
    localGitOptions
  )
}

async function addMRInlineComment(
  repoPath: string,
  iid: number,
  input: GitLabMRInlineCommentInput,
  preference?: IssueSourcePreference,
  connectionId?: string | null,
  projectRef?: ProjectRef | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<{ ok: true; comment: MRComment } | { ok: false; error: string }> {
  return withProjectRef<{ ok: true; comment: MRComment } | { ok: false; error: string }>(
    repoPath,
    preference,
    connectionId,
    projectRef,
    async (projectRef) => {
      const body = input.body.trim()
      if (!body) {
        return { ok: false, error: 'Comment body is required' }
      }
      await acquire()
      try {
        const oldPath = input.oldPath ?? input.path
        const { stdout } = await glabExecFileAsync(
          [
            'api',
            ...glabHostnameArgs(projectRef, connectionId),
            '-X',
            'POST',
            `projects/${encodedProject(projectRef.path)}/merge_requests/${iid}/discussions`,
            '-f',
            `body=${body}`,
            '-f',
            'position[position_type]=text',
            '-f',
            `position[base_sha]=${input.baseSha}`,
            '-f',
            `position[start_sha]=${input.startSha}`,
            '-f',
            `position[head_sha]=${input.headSha}`,
            '-f',
            `position[old_path]=${oldPath}`,
            '-f',
            `position[new_path]=${input.path}`,
            '-f',
            `position[new_line]=${input.line}`
          ],
          glabRepoExecOptions(repoPath, connectionId, localGitOptions)
        )
        const data = JSON.parse(stdout) as {
          id?: string
          notes?: {
            id?: number
            author?: { username?: string; avatar_url?: string; state?: string } | null
            body?: string
            created_at?: string
            position?: { new_path?: string; new_line?: number } | null
          }[]
        }
        const note = data.notes?.[0]
        return {
          ok: true,
          comment: {
            id: note?.id ?? Date.now(),
            author: note?.author?.username ?? 'You',
            authorAvatarUrl: note?.author?.avatar_url ?? '',
            body: note?.body ?? body,
            createdAt: note?.created_at ?? new Date().toISOString(),
            url: '',
            threadId: data.id,
            isResolved: false,
            isBot: note?.author?.state === 'bot',
            path: note?.position?.new_path ?? input.path,
            line: note?.position?.new_line ?? input.line
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, error: classifyGlabError(msg).message }
      } finally {
        release()
      }
    },
    { ok: false, error: 'Could not resolve GitLab project for this repository' },
    localGitOptions
  )
}

async function resolveMRDiscussion(
  repoPath: string,
  iid: number,
  discussionId: string,
  resolved: boolean,
  preference?: IssueSourcePreference,
  connectionId?: string | null,
  projectRef?: ProjectRef | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitLabDiscussionResolveResult> {
  return withProjectRef<GitLabDiscussionResolveResult>(
    repoPath,
    preference,
    connectionId,
    projectRef,
    async (projectRef) => {
      const trimmedDiscussionId = discussionId.trim()
      if (!trimmedDiscussionId) {
        return { ok: false, error: 'Discussion id is required' }
      }
      await acquire()
      try {
        // Why: GitLab resolves/reopens the whole discussion thread, not a single note.
        await glabExecFileAsync(
          [
            'api',
            ...glabHostnameArgs(projectRef, connectionId),
            '-X',
            'PUT',
            `projects/${encodedProject(projectRef.path)}/merge_requests/${iid}/discussions/${encodeURIComponent(trimmedDiscussionId)}`,
            '-f',
            `resolved=${resolved ? 'true' : 'false'}`
          ],
          glabRepoExecOptions(repoPath, connectionId, localGitOptions)
        )
        return { ok: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, error: classifyGlabError(msg).message }
      } finally {
        release()
      }
    },
    { ok: false, error: 'Could not resolve GitLab project for this repository' },
    localGitOptions
  )
}

export { withProjectRef, closeMR, reopenMR, mergeMR, addMRComment, addMRInlineComment, resolveMRDiscussion }
