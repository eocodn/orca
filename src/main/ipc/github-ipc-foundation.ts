// Hosted source-control IPC handlers.
import { ipcMain } from 'electron'
import { resolve } from 'node:path'
import type {
  Repo,
  GitHubCreateIssueFields,
  GitHubIssueUpdate,
  GitHubOwnerRepo,
  GitHubPullRequestStateUpdate,
  GitHubPRRefreshCandidate,
  GitHubPRRefreshEnqueueResult,
  GitHubPRRefreshReason,
  PRRefreshOutcome,
  GitHubPRFile
} from '../../shared/types'
import { getRepoExecutionHostId } from '../../shared/execution-host'
import type { TaskSourceContext } from '../../shared/task-source-context'
import type { Store } from '../persistence'
import type { StatsCollector } from '../stats/collector'
import {
  getPRForBranch,
  getIssue,
  getRepoSlug,
  getRepoUpstream,
  listIssues,
  listWorkItems,
  countWorkItems,
  getWorkItem,
  getWorkItemByOwnerRepo,
  createIssue,
  updateIssue,
  addIssueComment,
  listLabels,
  listAssignableUsers,
  getAuthenticatedViewer,
  getPRChecks,
  getPRCheckDetails,
  getPRComments,
  resolveReviewThread,
  setPRFileViewed,
  addPRReviewComment,
  addPRReviewCommentReply,
  updatePRTitle,
  mergePR,
  setPRAutoMerge,
  updatePRState,
  rerunPRChecks,
  requestPRReviewers,
  removePRReviewers,
  checkOrcaStarred,
  starOrca
} from '../github/client'
import type { GitHubPRBranchLookupOptions } from '../github/client'
import {
  clearVisiblePRRefreshWindow,
  enqueuePRRefresh,
  refreshPRNow,
  reportVisiblePRRefreshCandidates,
  setPRRefreshOutcomeObserver
} from '../github/pr-refresh-coordinator'
import { getWorkItemDetails, getPRFileContents } from '../github/work-item-details'
import { getRateLimit } from '../github/rate-limit'
import { diagnoseGhAuth } from '../github/auth-diagnose'
import {
  notePRRefreshValidationDenial,
  type PRRefreshValidationDenialReason
} from '../github/pr-refresh-validation-backoff'
import { getLocalProjectWorktreeGitOptions } from '../project-runtime-git-options'
import { dispatchWorkItem, type WorkItemArgs } from './github-work-item-args'
import {
  getProjectViewTable,
  listAccessibleProjects,
  resolveProjectRef,
  listProjectViews,
  getWorkItemDetailsBySlug,
  updateProjectItemFieldValue,
  clearProjectItemFieldValue,
  updateIssueBySlug,
  updatePullRequestBySlug,
  addIssueCommentBySlug,
  updateIssueCommentBySlug,
  deleteIssueCommentBySlug,
  listLabelsBySlug,
  listAssignableUsersBySlug,
  listIssueTypesBySlug,
  updateIssueTypeBySlug
} from '../github/project-view'
import type {
  AddIssueCommentBySlugArgs,
  ClearProjectItemFieldArgs,
  DeleteIssueCommentBySlugArgs,
  GetProjectViewTableArgs,
  ListAccessibleProjectsArgs,
  ListAssignableUsersBySlugArgs,
  ListIssueTypesBySlugArgs,
  ListLabelsBySlugArgs,
  ListProjectViewsArgs,
  ProjectWorkItemDetailsBySlugArgs,
  ResolveProjectRefArgs,
  UpdateIssueBySlugArgs,
  UpdateIssueCommentBySlugArgs,
  UpdateIssueTypeBySlugArgs,
  UpdateProjectItemFieldArgs,
  UpdatePullRequestBySlugArgs
} from '../../shared/github-project-types'
import { appStarSourceSchema } from '../../shared/gh-star-source'
import { track } from '../telemetry/client'
import { getCohortAtEmit } from '../telemetry/cohort-classifier'
import { sendToTrustedUIRenderer } from './ui'

export const prRefreshVisibilityCleanupRegistered = new Set<number>()

// Why: the app renderer owns the SWR cache; browser guests cannot consume this
// event. Skip the origin because it already updated its cache optimistically.
export function broadcastWorkItemMutated(
  payload: {
    repoPath: string
    repoId?: string
    type: 'issue' | 'pr'
    number: number
  },
  senderId?: number
): void {
  sendToTrustedUIRenderer('gh:workItemMutated', payload, senderId)
}

// Why: returns the full Repo object instead of just the path string so that
// callers have access to repo.id for stat tracking and other context.
export type RepoScopedArgs = {
  repoPath: string
  repoId?: string | null
  sourceContext?: TaskSourceContext | null
}

export type RegisteredRepoValidationResult =
  | { kind: 'ok'; repo: Repo }
  | { kind: 'denied'; reason: PRRefreshValidationDenialReason; message: string }

export function validateRegisteredRepo(
  args: string | RepoScopedArgs,
  store: Store,
  repos = store.getRepos()
): RegisteredRepoValidationResult {
  const repoPath = typeof args === 'string' ? args : args.repoPath
  const repoId = typeof args === 'string' ? undefined : args.repoId
  const resolvedRepoPath = resolve(repoPath)
  const repo = repos.find((r) => (repoId ? r.id === repoId : resolve(r.path) === resolvedRepoPath))
  if (!repo) {
    return {
      kind: 'denied',
      reason: 'unknown-repo',
      message: 'Access denied: unknown repository path'
    }
  }
  if (repoId && resolve(repo.path) !== resolvedRepoPath) {
    return {
      kind: 'denied',
      reason: 'repo-path-mismatch',
      message: 'Access denied: repository path does not match repo id'
    }
  }
  if (
    typeof args !== 'string' &&
    args.sourceContext?.provider === 'github' &&
    args.sourceContext.hostId !== getRepoExecutionHostId(repo)
  ) {
    return {
      kind: 'denied',
      reason: 'host-mismatch',
      message: 'Access denied: GitHub source host does not match repository host'
    }
  }
  return { kind: 'ok', repo }
}

export function assertRegisteredRepo(args: string | RepoScopedArgs, store: Store): Repo {
  const result = validateRegisteredRepo(args, store)
  if (result.kind === 'denied') {
    throw new Error(result.message)
  }
  return result.repo
}

export function repoConnectionId(repo: Repo): string | null {
  return repo.connectionId ?? null
}

export function localGitOptionArgs(store: Store, repo: Repo): [] | [{ wslDistro?: string }] {
  const localGitOptions = getLocalProjectWorktreeGitOptions(store, repo)
  return Object.keys(localGitOptions).length > 0 ? [localGitOptions] : []
}

export function applyRepoToPRRefreshCandidate(
  store: Store,
  repo: Repo,
  candidate: GitHubPRRefreshCandidate
): GitHubPRRefreshCandidate {
  const localGitOptions = localGitOptionArgs(store, repo)[0]
  const appliedCandidate = { ...candidate }
  delete appliedCandidate.localGitOptions
  delete appliedCandidate.connectionId
  delete appliedCandidate.executionHostId
  delete appliedCandidate.connectionState
  return {
    ...appliedCandidate,
    repoPath: repo.path,
    repoId: repo.id,
    ...(localGitOptions ? { localGitOptions } : {}),
    connectionId: repoConnectionId(repo),
    executionHostId: repo.executionHostId ?? null,
    connectionState: repo.connectionId ? 'connected' : 'unknown'
  }
}

export function validateAutomaticPRRefreshCandidate(
  candidate: GitHubPRRefreshCandidate,
  store: Store,
  repos = store.getRepos()
):
  | { kind: 'ok'; candidate: GitHubPRRefreshCandidate }
  | {
      kind: 'skipped'
      result: Extract<GitHubPRRefreshEnqueueResult, { kind: 'skipped' }>
    } {
  const result = validateRegisteredRepo(candidate, store, repos)
  if (result.kind === 'denied') {
    const skippedReason = notePRRefreshValidationDenial({
      repoId: candidate.repoId,
      repoPath: candidate.repoPath,
      reason: result.reason
    })
    return { kind: 'skipped', result: { kind: 'skipped', skippedReason } }
  }
  return { kind: 'ok', candidate: applyRepoToPRRefreshCandidate(store, result.repo, candidate) }
}

