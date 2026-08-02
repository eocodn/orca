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

export function registerGitHubProjectHandlers(store: Store, stats: StatsCollector): void {
  ipcMain.handle('gh:listAccessibleProjects', (_event, args?: ListAccessibleProjectsArgs) =>
      listAccessibleProjects(args)
    )

  ipcMain.handle('gh:resolveProjectRef', (_event, args: ResolveProjectRefArgs) =>
      resolveProjectRef(args)
    )

  ipcMain.handle('gh:listProjectViews', (_event, args: ListProjectViewsArgs) =>
      listProjectViews(args)
    )

  ipcMain.handle('gh:getProjectViewTable', (_event, args: GetProjectViewTableArgs) =>
      getProjectViewTable(args)
    )

  ipcMain.handle(
      'gh:projectWorkItemDetailsBySlug',
      (_event, args: ProjectWorkItemDetailsBySlugArgs) => getWorkItemDetailsBySlug(args)
    )

  ipcMain.handle('gh:updateProjectItemField', (_event, args: UpdateProjectItemFieldArgs) =>
      updateProjectItemFieldValue(args)
    )

  ipcMain.handle('gh:clearProjectItemField', (_event, args: ClearProjectItemFieldArgs) =>
      clearProjectItemFieldValue(args)
    )

  ipcMain.handle('gh:updateIssueBySlug', (_event, args: UpdateIssueBySlugArgs) =>
      updateIssueBySlug(args)
    )

  ipcMain.handle('gh:updatePullRequestBySlug', (_event, args: UpdatePullRequestBySlugArgs) =>
      updatePullRequestBySlug(args)
    )

  ipcMain.handle('gh:addIssueCommentBySlug', (_event, args: AddIssueCommentBySlugArgs) =>
      addIssueCommentBySlug(args)
    )

  ipcMain.handle('gh:updateIssueCommentBySlug', (_event, args: UpdateIssueCommentBySlugArgs) =>
      updateIssueCommentBySlug(args)
    )

  ipcMain.handle('gh:deleteIssueCommentBySlug', (_event, args: DeleteIssueCommentBySlugArgs) =>
      deleteIssueCommentBySlug(args)
    )

  ipcMain.handle('gh:listLabelsBySlug', (_event, args: ListLabelsBySlugArgs) =>
      listLabelsBySlug(args)
    )

  ipcMain.handle('gh:listAssignableUsersBySlug', (_event, args: ListAssignableUsersBySlugArgs) =>
      listAssignableUsersBySlug(args)
    )

  ipcMain.handle('gh:listIssueTypesBySlug', (_event, args: ListIssueTypesBySlugArgs) =>
      listIssueTypesBySlug(args)
    )

  ipcMain.handle('gh:updateIssueTypeBySlug', (_event, args: UpdateIssueTypeBySlugArgs) =>
      updateIssueTypeBySlug(args)
    )
  
    // Why: issue-source preference writes go through the generic `repos:update`
    // IPC (extended in this PR to accept `issueSourcePreference`). Routing
    // through the same channel keeps a single write path, guarantees the
    // `repos:changed` broadcast is emitted, and avoids two channels racing to
    // persist the same field with different validation and eviction semantics.
    // Reads piggyback on the `Repo` record already delivered by `repos:list`.
}
