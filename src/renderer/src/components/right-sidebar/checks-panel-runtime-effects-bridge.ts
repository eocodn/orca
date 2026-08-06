import type { PRCheckDetail, PRInfo } from '../../../../shared/types'
import type { useChecksPanelRuntimeFoundation } from './checks-panel-runtime-foundation'
import type { useChecksPanelRuntimeViewState } from './checks-panel-runtime-view-state'
import { useChecksPanelRuntimeDataEffects } from './checks-panel-runtime-data-effects'
import { useChecksPanelRuntimeReviewEffects } from './checks-panel-runtime-review-effects'
import { checksPanelAsyncResultKey } from './checks-panel-async-result-key'

type Foundation = ReturnType<typeof useChecksPanelRuntimeFoundation>
type ViewState = ReturnType<typeof useChecksPanelRuntimeViewState>

export function useChecksPanelRuntimeEffectsBridge(args: {
  foundation: Foundation
  viewState: ViewState
  isFolder: boolean
  isCurrentAsyncResult: (key: string) => boolean
  eligibilityHeadOidRef: { current: string | null }
}): {
  fetchChecks: (options?: { force?: boolean; prNumberOverride?: number | null }) => Promise<void>
  fetchGitLabDetails: (options?: {
    mrNumberOverride?: number | null
    headShaOverride?: string | null
    commitAsCurrent?: boolean
  }) => Promise<void>
  fetchComments: (options?: {
    force?: boolean
    prNumberOverride?: number | null
    prRepoOverride?: PRInfo['prRepo'] | null
  }) => Promise<void>
  handleLoadCheckDetails: (check: PRCheckDetail) => Promise<unknown>
  handleRefresh: () => Promise<void>
  handleEntryRefresh: (options: { refreshChecks: boolean; refreshComments: boolean }) => void
} {
  const f = args.foundation
  const v = args.viewState
  const data = useChecksPanelRuntimeDataEffects({
    git: {
      activeConnectionId: f.activeConnectionId,
      activeWorktreeId: f.activeWorktreeId,
      activeWorktreePath: f.activeWorktreePath,
      activeWorktreePushTarget: f.activeWorktreePushTarget,
      branch: f.branch,
      conflictSummaryRefreshKeyRef: f.conflictSummaryRefreshKeyRef,
      eligibilityHeadOidRef: args.eligibilityHeadOidRef,
      fallbackGitHubPRNumber: v.fallbackGitHubPRNumber,
      fetchPRForBranch: f.fetchPRForBranch,
      getHostedReviewCreationEligibility: f.getHostedReviewCreationEligibility,
      gitStatusInvalidation: f.gitStatusInvalidation,
      gitStatusReadyForPanelContext: v.gitStatusReadyForPanelContext,
      gitStatusSnapshotInFlightContextRef: f.gitStatusSnapshotInFlightContextRef,
      gitStatusSnapshotRerunContextRef: f.gitStatusSnapshotRerunContextRef,
      gitStatusSnapshotRetryTimerRef: f.gitStatusSnapshotRetryTimerRef,
      hasUncommittedChanges: v.hasUncommittedChanges,
      hostedReviewCreationRequestKey: v.hostedReviewCreationRequestKey,
      isFolder: args.isFolder,
      isPanelVisible: f.isPanelVisible,
      linkedAzureDevOpsPR: v.linkedAzureDevOpsPR,
      linkedBitbucketPR: v.linkedBitbucketPR,
      linkedGitLabMR: v.linkedGitLabMR,
      linkedGiteaPR: v.linkedGiteaPR,
      linkedPR: v.linkedPR,
      localExecutionScope: f.localExecutionScope,
      ownerSettings: f.ownerSettings,
      panelContextKey: f.panelContextKey,
      panelContextKeyRef: f.panelContextKeyRef,
      pr: v.pr,
      prCacheKey: v.prCacheKey,
      remoteStatus: v.remoteStatus,
      remoteStatusInvalidation: f.remoteStatusInvalidation,
      repo: f.repo,
      repoConnectionId: f.repoConnectionId,
      runtimeEnvironmentId: f.runtimeEnvironmentId,
      setConflictDetailsRefreshing: f.setConflictDetailsRefreshing,
      setGitStatusProbeErrorContextKey: f.setGitStatusProbeErrorContextKey,
      setGitStatusRefreshNonce: f.setGitStatusRefreshNonce,
      setGitStatusSnapshot: f.setGitStatusSnapshot,
      setHostedReviewCreationSnapshot: f.setHostedReviewCreationSnapshot,
      settings: f.settings,
      sshConnectionStatus: f.sshConnectionStatus,
      updateWorktreeGitIdentity: f.updateWorktreeGitIdentity
    },
    fetch: {
      activeGitLabReview: v.activeGitLabReview,
      asyncResultKeyRef: f.asyncResultKeyRef,
      branch: f.branch,
      fetchPRChecks: f.fetchPRChecks,
      hostedReviewCacheKey: v.hostedReviewCacheKey,
      isCurrentAsyncResult: args.isCurrentAsyncResult,
      pollIntervalRef: f.pollIntervalRef,
      pr: v.pr,
      prCacheKey: v.prCacheKey,
      prNumber: v.prNumber,
      prevChecksRef: f.prevChecksRef,
      repo: f.repo,
      setChecks: f.setChecks,
      setChecksLoading: f.setChecksLoading,
      setComments: f.setComments,
      setCommentsLoading: f.setCommentsLoading,
      settings: f.settings
    }
  }) as {
    fetchChecks: (options?: { force?: boolean; prNumberOverride?: number | null }) => Promise<void>
    fetchGitLabDetails: (options?: {
      mrNumberOverride?: number | null
      headShaOverride?: string | null
      commitAsCurrent?: boolean
    }) => Promise<void>
  }
  const review = useChecksPanelRuntimeReviewEffects({
    comments: {
      activeGitLabReview: v.activeGitLabReview,
      branch: f.branch,
      checksPanelAsyncResultKey,
      fetchPRCheckDetails: f.fetchPRCheckDetails,
      fetchPRComments: f.fetchPRComments,
      isCurrentAsyncResult: args.isCurrentAsyncResult,
      isPanelVisible: f.isPanelVisible,
      pr: v.pr,
      prCacheKey: v.prCacheKey,
      prNumber: v.prNumber,
      repo: f.repo,
      setComments: f.setComments,
      setCommentsLoading: f.setCommentsLoading
    },
    refresh: {
      activeConnectionId: f.activeConnectionId,
      activeGitLabReview: v.activeGitLabReview,
      activeWorktreeId: f.activeWorktreeId,
      activeWorktreePath: f.activeWorktreePath,
      activeWorktreePushTarget: f.activeWorktreePushTarget,
      asyncResultKeyRef: f.asyncResultKeyRef,
      branch: f.branch,
      expireGitHubPRRefreshState: f.expireGitHubPRRefreshState,
      fallbackGitHubPRNumber: v.fallbackGitHubPRNumber,
      fetchChecks: data.fetchChecks,
      fetchGitLabDetails: data.fetchGitLabDetails,
      fetchHostedReviewForBranch: f.fetchHostedReviewForBranch,
      fetchPRChecks: f.fetchPRChecks,
      fetchPRComments: f.fetchPRComments,
      fetchPRForBranch: f.fetchPRForBranch,
      hasUncommittedChanges: v.hasUncommittedChanges,
      isCurrentAsyncResult: args.isCurrentAsyncResult,
      isFolder: args.isFolder,
      isGitLabReviewContext: v.isGitLabReviewContext,
      linkedAzureDevOpsPR: v.linkedAzureDevOpsPR,
      linkedBitbucketPR: v.linkedBitbucketPR,
      linkedGitLabMR: v.linkedGitLabMR,
      linkedGiteaPR: v.linkedGiteaPR,
      linkedPR: v.linkedPR,
      ownerSettings: f.ownerSettings,
      panelContextKey: f.panelContextKey,
      panelContextKeyRef: f.panelContextKeyRef,
      pollIntervalRef: f.pollIntervalRef,
      pr: v.pr,
      prCacheKey: v.prCacheKey,
      prNumber: v.prNumber,
      prevChecksRef: f.prevChecksRef,
      rawPRRefreshState: v.rawPRRefreshState,
      refreshInFlightRef: f.refreshInFlightRef,
      refreshRequestKeyRef: f.refreshRequestKeyRef,
      remoteStatus: v.remoteStatus,
      repo: f.repo,
      settings: f.settings,
      updateWorktreeGitIdentity: f.updateWorktreeGitIdentity,
      setChecks: f.setChecks,
      setChecksLoading: f.setChecksLoading,
      setComments: f.setComments,
      setCommentsLoading: f.setCommentsLoading,
      setEligibilityRefreshNonce: f.setEligibilityRefreshNonce,
      setGitStatusSnapshot: f.setGitStatusSnapshot,
      setIsRefreshing: f.setIsRefreshing
    },
    entry: {
      activeGitLabReview: v.activeGitLabReview,
      activeWorktree: f.activeWorktree,
      activeWorktreeId: f.activeWorktreeId,
      branch: f.branch,
      checksFetchedAt: v.checksFetchedAt,
      commentsFetchedAt: v.commentsFetchedAt,
      enqueueGitHubPRRefresh: f.enqueueGitHubPRRefresh,
      fallbackGitHubPRNumber: v.fallbackGitHubPRNumber,
      fetchChecks: data.fetchChecks,
      fetchGitLabDetails: data.fetchGitLabDetails,
      fetchHostedReviewForBranch: f.fetchHostedReviewForBranch,
      hostedReviewCacheKey: v.hostedReviewCacheKey,
      isFolder: args.isFolder,
      isGitLabReviewContext: v.isGitLabReviewContext,
      isPanelVisible: f.isPanelVisible,
      linkedAzureDevOpsPR: v.linkedAzureDevOpsPR,
      linkedBitbucketPR: v.linkedBitbucketPR,
      linkedGitLabMR: v.linkedGitLabMR,
      linkedGiteaPR: v.linkedGiteaPR,
      linkedPR: v.linkedPR,
      prCacheKey: v.prCacheKey,
      prFetchedAt: v.prFetchedAt,
      prNumber: v.prNumber,
      pollIntervalRef: f.pollIntervalRef,
      prevChecksRef: f.prevChecksRef,
      repo: f.repo
    }
  })
  return { ...data, ...review }
}
