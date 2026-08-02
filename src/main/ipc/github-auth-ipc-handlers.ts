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

export function registerGitHubAuthHandlers(store: Store, stats: StatsCollector): void {
  ipcMain.handle('gh:viewer', () => getAuthenticatedViewer())

  ipcMain.handle('gh:checkOrcaStarred', () => checkOrcaStarred())

  ipcMain.handle('gh:starOrca', async (_event, source: unknown) => {
      const sourceParse = appStarSourceSchema.safeParse(source)
      const starred = await starOrca()
      if (starred && sourceParse.success) {
        // Why: this main-owned event bypasses renderer telemetry IPC, so cohort
        // context must be attached here on the successful star path.
        track('app_starred_orca', {
          source: sourceParse.data,
          ...getCohortAtEmit()
        })
      }
      return starred
    })
  
    // Why: `rate_limit` is exempt from GitHub's rate-limit accounting, so
    // polling is cheap. A 30s in-process cache still avoids the gh subprocess
    // cost on every render — see getRateLimit for the ttl rationale. Force
    // parameter lets the renderer bust the cache after a known-expensive op
    // (e.g. post-ProjectPicker discovery) without waiting out the ttl.

  ipcMain.handle('gh:rateLimit', (_event, args?: { force?: boolean }) =>
      getRateLimit(args?.force ? { force: true } : undefined)
    )

  ipcMain.handle('gh:diagnoseAuth', (_event, args?: { host?: string }) =>
      diagnoseGhAuth(args?.host)
    )
  
    // ── GitHub ProjectV2 view handlers ─────────────────────────────────
    // Why: registered unconditionally so enabling the experimental flag at
    // runtime takes effect without a restart. The renderer gates entry points.
    // Handlers never throw across IPC — every failure mode resolves through the
    // GitHubProjectViewError envelope.
}
