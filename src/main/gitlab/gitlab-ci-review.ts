import type {
  ClassifiedError,
  GitLabAssignableUser,
  GitLabAuthDiagnostic,
  GitLabDiscussionResolveResult,
  GitLabJobTraceResult,
  GitLabPagedResult,
  GitLabPipelineJob,
  GitLabRateLimitSnapshot,
  GitLabMRInlineCommentInput,
  GitLabMRReviewersUpdateResult,
  GitLabRetryJobResult,
  GitLabTodo,
  GitLabViewer,
  GitLabWorkItem,
  GetGitLabRateLimitResult,
  IssueSourcePreference,
  ListMergeRequestsResult,
  MRComment,
  MRInfo,
  MRListState
} from '../../shared/types'
import { derivePipelineStatus, mapIssueToWorkItem, mapMRInfo, mapMRToWorkItem } from './mappers'
import {
  acquire,
  classifyGlabError,
  classifyListIssuesError,
  getGlabKnownHosts,
  getProjectRef,
  getProjectRefForRemote,
  glabHostnameArgs,
  glabRepoExecOptions,
  glabApiWithHeaders,
  glabExecFileAsync,
  parseGlabAuthStatusHosts,
  release,
  resolveIssueSource,
  type LocalGitExecOptions,
  type ProjectRef
} from './gl-utils'
import { rememberGlabKnownHosts } from './gitlab-known-host-probe'
import type { IssueListState } from './issues'
import {
  hasHostedReviewLocalGitOptions,
  getHostedReviewLocalGitOptions,
  type HostedReviewExecutionOptions
} from '../source-control/hosted-review-git-options'
import { shouldHideNonOpenReviewOnDefaultBranch } from '../source-control/repo-default-branch'

// Why: glab REST addresses projects by URL-encoded path; escapes slashes for nested groups.
import { encodedProject } from './gitlab-auth-project'
import { withProjectRef } from './gitlab-mutations'
function mapRetriedPipelineJob(
  data: {
    id?: number
    pipeline?: { id?: number | null } | null
    name?: string
    stage?: string
    status?: string
    web_url?: string
    duration?: number | null
  },
  fallbackJobId: number
): GitLabPipelineJob {
  return {
    id: data.id ?? fallbackJobId,
    ...(typeof data.pipeline?.id === 'number' ? { pipelineId: data.pipeline.id } : {}),
    name: data.name ?? '',
    stage: data.stage ?? '',
    status: data.status ?? '',
    webUrl: data.web_url ?? '',
    duration: typeof data.duration === 'number' ? data.duration : null
  }
}

function mapGitLabReviewer(raw: {
  id?: number
  username?: string | null
  name?: string | null
  avatar_url?: string | null
  state?: string | null
}): GitLabAssignableUser | null {
  if (!raw.username) {
    return null
  }
  return {
    ...(typeof raw.id === 'number' ? { id: raw.id } : {}),
    username: raw.username,
    name: raw.name ?? null,
    avatarUrl: raw.avatar_url ?? '',
    ...(raw.state !== undefined ? { state: raw.state } : {})
  }
}

async function updateMRReviewers(
  repoPath: string,
  iid: number,
  reviewerIds: number[],
  preference?: IssueSourcePreference,
  connectionId?: string | null,
  projectRef?: ProjectRef | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitLabMRReviewersUpdateResult> {
  return withProjectRef<GitLabMRReviewersUpdateResult>(
    repoPath,
    preference,
    connectionId,
    projectRef,
    async (projectRef) => {
      await acquire()
      try {
        const fields =
          reviewerIds.length > 0
            ? reviewerIds.flatMap((id) => ['-f', `reviewer_ids[]=${id}`])
            : ['-f', 'reviewer_ids=']
        const { stdout } = await glabExecFileAsync(
          [
            'api',
            ...glabHostnameArgs(projectRef, connectionId),
            '-X',
            'PUT',
            `projects/${encodedProject(projectRef.path)}/merge_requests/${iid}`,
            ...fields
          ],
          glabRepoExecOptions(repoPath, connectionId, localGitOptions)
        )
        const data = JSON.parse(stdout) as { reviewers?: Parameters<typeof mapGitLabReviewer>[0][] }
        return {
          ok: true,
          reviewers: (data.reviewers ?? [])
            .map(mapGitLabReviewer)
            .filter((u): u is GitLabAssignableUser => !!u)
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

async function getJobTrace(
  repoPath: string,
  jobId: number,
  preference?: IssueSourcePreference,
  connectionId?: string | null,
  projectRef?: ProjectRef | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitLabJobTraceResult> {
  return withProjectRef<GitLabJobTraceResult>(
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
            `projects/${encodedProject(projectRef.path)}/jobs/${jobId}/trace`
          ],
          glabRepoExecOptions(repoPath, connectionId, localGitOptions)
        )
        return { ok: true, trace: stdout }
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

async function retryJob(
  repoPath: string,
  jobId: number,
  preference?: IssueSourcePreference,
  connectionId?: string | null,
  projectRef?: ProjectRef | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitLabRetryJobResult> {
  return withProjectRef<GitLabRetryJobResult>(
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
            `projects/${encodedProject(projectRef.path)}/jobs/${jobId}/retry`
          ],
          glabRepoExecOptions(repoPath, connectionId, localGitOptions)
        )
        const trimmed = stdout.trim()
        return {
          ok: true,
          ...(trimmed ? { job: mapRetriedPipelineJob(JSON.parse(trimmed), jobId) } : {})
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

async function updateMR(
  repoPath: string,
  iid: number,
  updates: {
    title?: string
    body?: string
    addLabels?: string[]
    removeLabels?: string[]
  },
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
    async (projectRef) => {
      const fields: string[] = []
      const title = updates.title?.trim()
      if (updates.title !== undefined) {
        if (!title) {
          return { ok: false, error: 'Title is required' }
        }
        fields.push(`title=${title}`)
      }
      if (updates.body !== undefined) {
        fields.push(`description=${updates.body}`)
      }
      const addLabels = (updates.addLabels ?? []).filter((label) => label.trim().length > 0)
      const removeLabels = (updates.removeLabels ?? []).filter((label) => label.trim().length > 0)
      if (addLabels.length > 0) {
        fields.push(`add_labels=${addLabels.join(',')}`)
      }
      if (removeLabels.length > 0) {
        fields.push(`remove_labels=${removeLabels.join(',')}`)
      }
      if (fields.length === 0) {
        return { ok: true }
      }

      await acquire()
      try {
        await glabExecFileAsync(
          [
            'api',
            ...glabHostnameArgs(projectRef, connectionId),
            '-X',
            'PUT',
            `projects/${encodedProject(projectRef.path)}/merge_requests/${iid}`,
            ...fields.flatMap((field) => ['-f', field])
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

/** Re-export so callers don't need to know the gl-utils module split. */
export { _resetProjectRefCache } from './gl-utils'
export {
  addIssueComment,
  createIssue,
  getIssue,
  listAssignableUsers,
  listIssues,
  listLabels,
  updateIssue
} from './issues'

// Re-exported so paste-URL call sites don't import getProjectRefForRemote from gl-utils directly.
export { getProjectRefForRemote }

export { mapRetriedPipelineJob, mapGitLabReviewer, updateMRReviewers, getJobTrace, retryJob, updateMR }

