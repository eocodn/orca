import type {
  GitHubWorkItem,
  GitHubWorkItemDetails,
  IssueSourcePreference
} from '../../shared/types'
import {
  acquire,
  release,
  type LocalGitExecOptions
} from './gh-utils'
import { getWorkItem, getPRComments } from './client'
import {
  getIssueGitHubApiRepository,
  resolveGitHubRepoExecution
} from './github-api-repository'

// Why: cap total PR files so a massive PR can't starve the gh semaphore while paging (100/page).

// Why: bound noisy issue timelines so one huge issue can't monopolize gh/API time.


// Why: raw-fetch buffer must exceed the renderer's large-diff threshold, else the UI shows an empty diff instead of the fallback.

import { localGitOptionArgs } from './github-work-item-timeline'
import { getIssueDetailsViaGraphQL } from './github-work-item-graphql'
import { getPRMetadata, getPRFiles, getPRFileViewedStates, mergePRFileViewedStates } from './github-work-item-pr-files'
import { getIssueBodyAndComments, getWorkItemParticipants, enrichItemDisplayAvatars, getMentionParticipants, getPRChecksForDetails } from './github-work-item-enrichment'
async function withWorkItemDetailsPermit<T>(operation: () => Promise<T>): Promise<T> {
  await acquire()
  try {
    return await operation()
  } finally {
    release()
  }
}

async function getWorkItemDetails(
  repoPath: string,
  number: number,
  type?: 'issue' | 'pr',
  connectionId?: string | null,
  localGitOptions: LocalGitExecOptions = {},
  preference?: IssueSourcePreference
): Promise<GitHubWorkItemDetails | null> {
  const item: Omit<GitHubWorkItem, 'repoId'> | null = await getWorkItem(
    repoPath,
    number,
    type,
    connectionId,
    localGitOptions,
    preference
  )
  if (!item) {
    return null
  }

  const resolvedRepository =
    item.type === 'issue'
      ? await getIssueGitHubApiRepository(repoPath, connectionId, localGitOptions)
      : (await resolveGitHubRepoExecution(repoPath, item.prRepo, connectionId, localGitOptions))
          .ownerRepo

  if (item.type === 'issue') {
    return withWorkItemDetailsPermit(async () => {
      // Why: one GraphQL trip returns all issue details; fall back to the legacy fan-out on failure.
      const collapsed = await getIssueDetailsViaGraphQL(
        repoPath,
        item.number,
        resolvedRepository,
        connectionId,
        localGitOptions
      )
      if (collapsed) {
        return {
          // Include assigneeUsers: non-participating assignees are absent from participants and keep a blank avatar (GHE).
          item: enrichItemDisplayAvatars(item, [
            ...collapsed.participants,
            ...collapsed.assigneeUsers
          ]),
          body: collapsed.body,
          comments: collapsed.comments,
          assignees: collapsed.assignees,
          participants: collapsed.participants,
          timelineItems: collapsed.timelineItems
        }
      }
      // Fallback: fetch body/comments and participants in parallel.
      const [{ body, comments, assignees, timelineItems }, participants] = await Promise.all([
        getIssueBodyAndComments(
          repoPath,
          item.number,
          resolvedRepository,
          connectionId,
          localGitOptions
        ),
        getWorkItemParticipants(repoPath, item, resolvedRepository, connectionId, localGitOptions)
      ])
      const mentionParticipants = await getMentionParticipants(
        repoPath,
        item,
        comments,
        participants,
        resolvedRepository,
        connectionId,
        localGitOptions
      )
      return {
        item: enrichItemDisplayAvatars(item, mentionParticipants),
        body,
        comments,
        assignees,
        participants: mentionParticipants,
        timelineItems
      }
    })
  }

  // Why: getPRComments and getPRChecks own their semaphore permits. Keeping an
  // outer permit while awaiting either can deadlock four concurrent detail loads.
  const [[metadata, files, viewedStates, participants], comments] = await Promise.all([
    Promise.all([
      withWorkItemDetailsPermit(() =>
        getPRMetadata(repoPath, item.number, resolvedRepository, connectionId, localGitOptions)
      ),
      withWorkItemDetailsPermit(() =>
        getPRFiles(repoPath, item.number, resolvedRepository, connectionId, localGitOptions)
      ),
      withWorkItemDetailsPermit(() =>
        getPRFileViewedStates(
          repoPath,
          item.number,
          resolvedRepository,
          connectionId,
          localGitOptions
        )
      ),
      withWorkItemDetailsPermit(() =>
        getWorkItemParticipants(repoPath, item, resolvedRepository, connectionId, localGitOptions)
      )
    ]),
    resolvedRepository
      ? getPRComments(
          repoPath,
          item.number,
          { prRepo: resolvedRepository },
          connectionId,
          ...localGitOptionArgs(localGitOptions)
        )
      : Promise.resolve([])
  ])

  // Why: mention hydration spawns gh directly while checks owns a permit; bound them without nesting.
  const [mentionParticipants, checks] = await Promise.all([
    withWorkItemDetailsPermit(() =>
      getMentionParticipants(
        repoPath,
        item,
        comments,
        participants,
        resolvedRepository,
        connectionId,
        localGitOptions
      )
    ),
    getPRChecksForDetails(
      repoPath,
      item.number,
      metadata.headSha,
      resolvedRepository,
      connectionId,
      localGitOptions
    )
  ])

  return {
    item: enrichItemDisplayAvatars(
      resolvedRepository ? { ...item, prRepo: resolvedRepository } : item,
      mentionParticipants
    ),
    body: metadata.body,
    comments,
    headSha: metadata.headSha,
    baseSha: metadata.baseSha,
    pullRequestId: viewedStates?.pullRequestId,
    checks,
    // Why: null (failed fetch) vs empty PR — Files tab shows retry, not "No files changed."
    files: files === null ? undefined : mergePRFileViewedStates(files, viewedStates),
    filesUnavailable: files === null,
    participants: mentionParticipants
  }
}

// Why: Monaco DiffViewer needs original/modified text (not patches); --cache bounds rate-limit spend on rapid file-expands.

export { withWorkItemDetailsPermit, getWorkItemDetails }
