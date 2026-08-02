import type {
  GitHubAssignableUser,
  GitHubPRFile,
  GitHubPRFileContents,
  GitHubPRFileViewedState,
  GitHubIssueTimelineItem,
  GitHubIssueTimelineTarget,
  GitHubWorkItem,
  GitHubWorkItemDetails,
  IssueSourcePreference,
  PRCheckDetail,
  PRComment
} from '../../shared/types'
import {
  ghExecFileAsync,
  acquire,
  release,
  ghRepoExecOptions,
  githubRepoContext,
  type LocalGitExecOptions
} from './gh-utils'
import { getWorkItem, getPRChecks, getPRComments } from './client'
import {
  getIssueGitHubApiRepository,
  githubHostExecOptions,
  resolveGitHubRepoExecution,
  type GitHubApiRepository
} from './github-api-repository'
import { noteRepositoryRateLimitSpend, repositoryRateLimitGuard } from './rate-limit'
import { getPRReviewCommentLineNumbersFromPatch } from './pr-review-comment-lines'
import { isMaxBufferOverflowError } from '../git/max-buffer-overflow'

// Why: cap total PR files so a massive PR can't starve the gh semaphore while paging (100/page).
const MAX_PR_FILES = 300
// Why: bound noisy issue timelines so one huge issue can't monopolize gh/API time.
const MAX_ISSUE_TIMELINE_ITEMS = 300
const GITHUB_REST_PAGE_SIZE = 100
// Why: raw-fetch buffer must exceed the renderer's large-diff threshold, else the UI shows an empty diff instead of the fallback.
const GITHUB_RAW_CONTENT_MAX_BUFFER_BYTES = 8 * 1024 * 1024
import { encodeGitHubContentPath } from './github-work-item-timeline'
async function fetchContentAtRef(args: {
  repoPath: string
  connectionId?: string | null
  localGitOptions?: LocalGitExecOptions
  ownerRepo: GitHubApiRepository
  path: string
  ref: string
}): Promise<{ content: string; isBinary: boolean; tooLarge?: boolean }> {
  const ghOptions = {
    ...ghRepoExecOptions(githubRepoContext(args.repoPath, args.connectionId, args.localGitOptions)),
    ...githubHostExecOptions(args.ownerRepo),
    maxBuffer: GITHUB_RAW_CONTENT_MAX_BUFFER_BYTES
  }
  if (repositoryRateLimitGuard(args.ownerRepo, 'core', ghOptions).blocked) {
    return { content: '', isBinary: false }
  }
  try {
    noteRepositoryRateLimitSpend(args.ownerRepo, 'core', 1, ghOptions)
    const { stdout } = await ghExecFileAsync(
      [
        'api',
        '--cache',
        '300s',
        '-H',
        'Accept: application/vnd.github.raw',
        `repos/${args.ownerRepo.owner}/${args.ownerRepo.repo}/contents/${encodeGitHubContentPath(args.path)}?ref=${encodeURIComponent(args.ref)}`
      ],
      ghOptions
    )
    // Heuristic: a NUL byte in the first 2KB means binary (execFile decodes as lossy utf-8).
    const sample = stdout.slice(0, 2048)
    if (sample.includes('\u0000')) {
      return { content: '', isBinary: true }
    }
    return { content: stdout, isBinary: false }
  } catch (error) {
    if (isMaxBufferOverflowError(error)) {
      return { content: '', isBinary: false, tooLarge: true }
    }
    return { content: '', isBinary: false }
  }
}

async function getPRFileContents(args: {
  repoPath: string
  connectionId?: string | null
  localGitOptions?: LocalGitExecOptions
  prRepo?: GitHubApiRepository | null
  prNumber: number
  path: string
  oldPath?: string
  status: GitHubPRFile['status']
  headSha: string
  baseSha: string
}): Promise<GitHubPRFileContents> {
  const { ownerRepo } = await resolveGitHubRepoExecution(
    args.repoPath,
    args.prRepo,
    args.connectionId,
    args.localGitOptions
  )
  if (!ownerRepo) {
    return {
      original: '',
      modified: '',
      originalIsBinary: false,
      modifiedIsBinary: false
    }
  }

  await acquire()
  try {
    // Why: added files have no base-ref original, removed files no head-ref modified; skip those to avoid spurious 404s.
    const needsOriginal = args.status !== 'added'
    const needsModified = args.status !== 'removed'
    const originalRef = args.baseSha
    const originalPath = args.oldPath ?? args.path

    const [original, modified] = await Promise.all([
      needsOriginal
        ? fetchContentAtRef({
            repoPath: args.repoPath,
            connectionId: args.connectionId,
            localGitOptions: args.localGitOptions,
            ownerRepo,
            path: originalPath,
            ref: originalRef
          })
        : Promise.resolve<{ content: string; isBinary: boolean; tooLarge?: boolean }>({
            content: '',
            isBinary: false
          }),
      needsModified
        ? fetchContentAtRef({
            repoPath: args.repoPath,
            connectionId: args.connectionId,
            localGitOptions: args.localGitOptions,
            ownerRepo,
            path: args.path,
            ref: args.headSha
          })
        : Promise.resolve<{ content: string; isBinary: boolean; tooLarge?: boolean }>({
            content: '',
            isBinary: false
          })
    ])

    return {
      original: original.content,
      modified: modified.content,
      originalIsBinary: original.isBinary,
      modifiedIsBinary: modified.isBinary,
      originalTooLarge: original.tooLarge,
      modifiedTooLarge: modified.tooLarge
    }
  } finally {
    release()
  }
}

export { fetchContentAtRef, getPRFileContents }

