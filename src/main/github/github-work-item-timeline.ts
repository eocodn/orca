import type { LocalGitExecOptions } from './gh-utils'

// Why: cap total PR files so a massive PR can't starve the gh semaphore while paging (100/page).

// Why: bound noisy issue timelines so one huge issue can't monopolize gh/API time.


// Why: raw-fetch buffer must exceed the renderer's large-diff threshold, else the UI shows an empty diff instead of the fallback.

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
