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
function localGitOptionArgs(options: LocalGitExecOptions = {}): [] | [LocalGitExecOptions] {
  return Object.keys(options).length > 0 ? [options] : []
}

function encodeGitHubContentPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

const PR_FILE_VIEWED_STATES_QUERY = `query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id
      files(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          path
          viewerViewedState
        }
      }
    }
  }
}`

const WORK_ITEM_PARTICIPANTS_QUERY = `query($owner: String!, $repo: String!, $number: Int!, $isPr: Boolean!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) @include(if: $isPr) {
      participants(first: 100) {
        nodes { login avatarUrl(size: 48) ... on User { name } }
      }
    }
    issue(number: $number) @skip(if: $isPr) {
      participants(first: 100) {
        nodes { login avatarUrl(size: 48) ... on User { name } }
      }
    }
  }
}`

// Why: one GraphQL round-trip replaces the 3 serial gh subprocesses (REST issue + comments + participants); falls back to the legacy path on failure.
const ISSUE_DETAILS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      body
      assignees(first: 50) { nodes { login avatarUrl(size: 48) ... on User { name } } }
      participants(first: 100) {
        nodes { login avatarUrl(size: 48) ... on User { name } }
      }
      comments(first: 100) {
        nodes {
          databaseId
          body
          createdAt
          url
          author {
            login
            avatarUrl(size: 48)
            ... on Bot { __typename }
          }
        }
      }
    }
  }
}`

export { localGitOptionArgs, encodeGitHubContentPath, PR_FILE_VIEWED_STATES_QUERY, WORK_ITEM_PARTICIPANTS_QUERY, ISSUE_DETAILS_QUERY }

