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

import { prRefreshVisibilityCleanupRegistered, broadcastWorkItemMutated, RepoScopedArgs, RegisteredRepoValidationResult, validateRegisteredRepo, assertRegisteredRepo, repoConnectionId, localGitOptionArgs, applyRepoToPRRefreshCandidate, validateAutomaticPRRefreshCandidate } from './github-ipc-foundation'

export function registerGitHubReviewQueryHandlers(store: Store, stats: StatsCollector): void {

  ipcMain.handle(
      'gh:prChecks',
      (
        _event,
        args: {
          repoPath: string
          repoId?: string | null
          sourceContext?: TaskSourceContext | null
          prNumber: number
          headSha?: string
          prRepo?: GitHubOwnerRepo | null
          noCache?: boolean
        }
      ) => {
        const repo = assertRegisteredRepo(args, store)
        return getPRChecks(
          repo.path,
          args.prNumber,
          args.headSha,
          args.prRepo ?? null,
          {
            noCache: args.noCache
          },
          repoConnectionId(repo),
          ...localGitOptionArgs(store, repo)
        )
      }
    )

  ipcMain.handle(
      'gh:prCheckDetails',
      (
        _event,
        args: {
          repoPath: string
          repoId?: string | null
          sourceContext?: TaskSourceContext | null
          checkRunId?: number
          workflowRunId?: number
          checkName?: string
          url?: string | null
          prRepo?: GitHubOwnerRepo | null
        }
      ) => {
        const repo = assertRegisteredRepo(args, store)
        return getPRCheckDetails(
          repo.path,
          {
            checkRunId: args.checkRunId,
            workflowRunId: args.workflowRunId,
            checkName: args.checkName,
            url: args.url,
            prRepo: args.prRepo ?? null
          },
          repoConnectionId(repo),
          ...localGitOptionArgs(store, repo)
        )
      }
    )

  ipcMain.handle(
      'gh:prComments',
      (
        _event,
        args: {
          repoPath: string
          repoId?: string | null
          sourceContext?: TaskSourceContext | null
          prNumber: number
          prRepo?: GitHubOwnerRepo | null
          noCache?: boolean
        }
      ) => {
        const repo = assertRegisteredRepo(args, store)
        return getPRComments(
          repo.path,
          args.prNumber,
          { noCache: args.noCache, prRepo: args.prRepo ?? null },
          repoConnectionId(repo),
          ...localGitOptionArgs(store, repo)
        )
      }
    )

  ipcMain.handle(
      'gh:resolveReviewThread',
      async (
        _event,
        args: {
          repoPath: string
          repoId?: string | null
          sourceContext?: TaskSourceContext | null
          threadId: string
          resolve: boolean
          prRepo?: GitHubOwnerRepo | null
        }
      ) => {
        const repo = assertRegisteredRepo(args, store)
        // Why: thread resolve doesn't carry the PR number, so we cannot target
        // a specific cache entry. The renderer cache stores per-(repo, type, number)
        // entries — emitting a path-wide invalidation here would require a new
        // event shape; instead, the drawer's existing thread-resolve UI updates
        // its local state immediately and the next reopen pays one fresh fetch.
        return resolveReviewThread(
          repo.path,
          args.threadId,
          args.resolve,
          repoConnectionId(repo),
          args.prRepo ?? null,
          ...localGitOptionArgs(store, repo)
        )
      }
    )


}
