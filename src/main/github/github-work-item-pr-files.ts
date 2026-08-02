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
import { PR_FILE_VIEWED_STATES_QUERY } from './github-work-item-timeline'
type RESTPRFile = {
  filename: string
  previous_filename?: string
  status: string
  additions: number
  deletions: number
  changes: number
  /** Raw patch text when available; absent for binary files or patches over GitHub's size cap. */
  patch?: string
}

function mapFileStatus(raw: string): GitHubPRFile['status'] {
  switch (raw) {
    case 'added':
      return 'added'
    case 'removed':
      return 'removed'
    case 'modified':
      return 'modified'
    case 'renamed':
      return 'renamed'
    case 'copied':
      return 'copied'
    case 'changed':
      return 'changed'
    case 'unchanged':
      return 'unchanged'
    default:
      return 'modified'
  }
}

// Why: REST doesn't flag binaries but omits `patch` for them; treat "changes but no patch" as binary so the diff tab shows a placeholder.
function isBinaryHint(file: RESTPRFile): boolean {
  if (file.status === 'removed' || file.status === 'added') {
    // Added/removed file with changes but no patch is almost always binary (images, oversized lockfiles).
    return file.patch === undefined && file.changes > 0
  }
  return file.patch === undefined && file.changes > 0
}

async function getPRMetadata(
  repoPath: string,
  prNumber: number,
  ownerRepo: GitHubApiRepository | null,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<{ body: string; headSha?: string; baseSha?: string }> {
  if (!ownerRepo) {
    // Why: a bare `gh pr view` can honor ambient GH_HOST/GH_REPO after hosted
    // repository resolution fails, returning metadata for the wrong PR.
    return { body: '' }
  }
  const ghOptions = {
    ...ghRepoExecOptions(githubRepoContext(repoPath, connectionId, localGitOptions)),
    ...githubHostExecOptions(ownerRepo)
  }
  if (repositoryRateLimitGuard(ownerRepo, 'core', ghOptions).blocked) {
    return { body: '' }
  }
  try {
    noteRepositoryRateLimitSpend(ownerRepo, 'core', 1, ghOptions)
    const { stdout } = await ghExecFileAsync(
      ['api', '--cache', '60s', `repos/${ownerRepo.owner}/${ownerRepo.repo}/pulls/${prNumber}`],
      ghOptions
    )
    const data = JSON.parse(stdout) as {
      body?: string | null
      head?: { sha?: string }
      base?: { sha?: string }
    }
    return {
      body: data.body ?? '',
      ...(data.head?.sha ? { headSha: data.head.sha } : {}),
      ...(data.base?.sha ? { baseSha: data.base.sha } : {})
    }
  } catch {
    return { body: '' }
  }
}

// Why: null = failed/blocked fetch (Files tab shows retry, not "No files changed."); [] = genuinely empty PR.
async function getPRFiles(
  repoPath: string,
  prNumber: number,
  ownerRepo: GitHubApiRepository | null,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<GitHubPRFile[] | null> {
  if (!ownerRepo) {
    return null
  }
  const ghOptions = {
    ...ghRepoExecOptions(githubRepoContext(repoPath, connectionId, localGitOptions)),
    ...githubHostExecOptions(ownerRepo)
  }
  try {
    const data: RESTPRFile[] = []
    for (let page = 1; data.length < MAX_PR_FILES; page += 1) {
      if (repositoryRateLimitGuard(ownerRepo, 'core', ghOptions).blocked) {
        return null
      }
      const pageSuffix = page === 1 ? '' : `&page=${page}`
      noteRepositoryRateLimitSpend(ownerRepo, 'core', 1, ghOptions)
      const { stdout } = await ghExecFileAsync(
        [
          'api',
          '--cache',
          '60s',
          `repos/${ownerRepo.owner}/${ownerRepo.repo}/pulls/${prNumber}/files?per_page=100${pageSuffix}`
        ],
        ghOptions
      )
      const pageData = JSON.parse(stdout) as RESTPRFile[]
      data.push(...pageData.slice(0, MAX_PR_FILES - data.length))
      if (pageData.length < 100) {
        break
      }
    }
    return data.map((file) => ({
      path: file.filename,
      oldPath: file.previous_filename,
      status: mapFileStatus(file.status),
      additions: file.additions,
      deletions: file.deletions,
      isBinary: isBinaryHint(file),
      reviewCommentLineNumbers: getPRReviewCommentLineNumbersFromPatch(file.patch)
    }))
  } catch {
    return null
  }
}

type PRFileViewedStatesResult = {
  pullRequestId: string
  viewedStates: Map<string, GitHubPRFileViewedState>
}

async function getPRFileViewedStates(
  repoPath: string,
  prNumber: number,
  ownerRepo: GitHubApiRepository | null,
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {}
): Promise<PRFileViewedStatesResult | null> {
  if (!ownerRepo) {
    return null
  }
  const ghOptions = {
    ...ghRepoExecOptions(githubRepoContext(repoPath, connectionId, localGitOptions)),
    ...githubHostExecOptions(ownerRepo)
  }
  if (repositoryRateLimitGuard(ownerRepo, 'graphql', ghOptions).blocked) {
    return null
  }
  const viewedStates = new Map<string, GitHubPRFileViewedState>()
  let pullRequestId: string | null = null
  let after: string | null = null

  try {
    for (let fetched = 0; fetched < MAX_PR_FILES; fetched += 100) {
      const args = [
        'api',
        'graphql',
        '-f',
        `query=${PR_FILE_VIEWED_STATES_QUERY}`,
        '-f',
        `owner=${ownerRepo.owner}`,
        '-f',
        `repo=${ownerRepo.repo}`,
        '-F',
        `number=${prNumber}`
      ]
      if (after) {
        args.push('-f', `after=${after}`)
      }
      noteRepositoryRateLimitSpend(ownerRepo, 'graphql', 1, ghOptions)
      const { stdout } = await ghExecFileAsync(args, ghOptions)
      const parsed = JSON.parse(stdout) as {
        data?: {
          repository?: {
            pullRequest?: {
              id?: string
              files?: {
                pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
                nodes?: {
                  path?: string | null
                  viewerViewedState?: GitHubPRFileViewedState | null
                }[]
              }
            } | null
          } | null
        }
        errors?: { message?: string }[]
      }
      if (parsed.errors && parsed.errors.length > 0) {
        return null
      }
      const pullRequest = parsed.data?.repository?.pullRequest
      if (!pullRequest?.id) {
        return null
      }
      pullRequestId = pullRequest.id
      for (const file of pullRequest.files?.nodes ?? []) {
        if (file.path && file.viewerViewedState) {
          viewedStates.set(file.path, file.viewerViewedState)
        }
      }
      if (!pullRequest.files?.pageInfo?.hasNextPage || !pullRequest.files.pageInfo.endCursor) {
        break
      }
      after = pullRequest.files.pageInfo.endCursor
    }
  } catch {
    return null
  }

  return pullRequestId ? { pullRequestId, viewedStates } : null
}

function mergePRFileViewedStates(
  files: GitHubPRFile[],
  viewedStates: PRFileViewedStatesResult | null
): GitHubPRFile[] {
  if (!viewedStates) {
    return files
  }
  return files.map((file) => ({
    ...file,
    viewerViewedState: viewedStates.viewedStates.get(file.path) ?? 'UNVIEWED'
  }))
}

export { mapFileStatus, isBinaryHint, getPRMetadata, getPRFiles, getPRFileViewedStates, mergePRFileViewedStates }
export { type RESTPRFile, type PRFileViewedStatesResult }

