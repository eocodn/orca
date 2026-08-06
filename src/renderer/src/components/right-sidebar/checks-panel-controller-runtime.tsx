/* Coordinates hosted-review data with focused checks, comments, and actions sections. */
import React, { useCallback, useEffect, useRef } from 'react'
import { isFolderRepo } from '../../../../shared/repo-kind'
import {
  checksPanelAsyncResultKey,
  checksPanelHostedReviewAsyncResultKey,
  shouldCommitChecksPanelAsyncResult
} from './checks-panel-async-result-key'
import { resolveChecksPanelPRRefreshRequest } from './checks-panel-pr-refresh-request'
import { useChecksPanelRuntimeViewState } from './checks-panel-runtime-view-state'
import { useChecksPanelReviewEffects } from './checks-panel-review-effects'
import { useChecksPanelRuntimeActionBridgeFromSources } from './checks-panel-runtime-action-bridge'
import { renderChecksPanelRuntime } from './checks-panel-runtime-render-bridge'
import { useChecksPanelRuntimePolling } from './checks-panel-runtime-polling'
import { useChecksPanelReviewRefresh } from './checks-panel-runtime-review-refresh'
import { useChecksPanelRuntimeGeneration } from './checks-panel-runtime-generation'
import { useChecksPanelRuntimeEffectsBridge } from './checks-panel-runtime-effects-bridge'
import { useChecksPanelRuntimeFoundation } from './checks-panel-runtime-foundation'
import { useChecksPanelRuntimeContextReset } from './checks-panel-runtime-context-reset'

export default function ChecksPanel(): React.JSX.Element {
  // Why: the sidebar stays mounted when closed (perf); gate polling on visibility so we don't fetch checks/comments or poll cwd while hidden.
  const foundation = useChecksPanelRuntimeFoundation()
  const {
    isPanelVisible,
    activeWorktree,
    activeWorktreeId,
    repo,
    settings,
    fetchPRForBranch,
    fetchHostedReviewForBranch,
    expireGitHubPRRefreshState,
    enqueueGitHubPRRefresh,
    gitStatusInvalidation,
    remoteStatusInvalidation,
    fetchUpstreamStatus,
    setChecks,
    setCreatePrError,
    agentComposerState,
    setAgentComposerState,
    hostedReviewCreationSnapshot,
    hardRefreshError,
    setHardRefreshError,
    gitStatusSnapshot,
    setGitStatusRefreshNonce,
    pollIntervalRef,
    prevChecksRef,
    panelVisibleSinceRef,
    foregroundedUnrenderedReviewKeyRef,
    prGenerationRecords,
    allocatePullRequestGenerationRequestId,
    setPullRequestGenerationRecord,
    updatePullRequestGenerationRecord,
    asyncResultKeyRef,
    refreshRequestKeyRef,
    refreshContextKeyRef,
    gitStatusSnapshotInFlightContextRef,
    gitStatusSnapshotRerunContextRef,
    branch,
    activeWorktreePath,
    runtimeEnvironmentId,
    ownerSettings,
    repoConnectionId,
    localExecutionScope,
    panelContextKey,
    panelContextKeyRef
  } = foundation
  const {
    clearTitleInputFocusTimer,
    setChecksPanelContentRef,
    prRefreshStateNow,
    setPrRefreshStateNow
  } = useChecksPanelRuntimeContextReset(foundation)

  const isFolder = repo ? isFolderRepo(repo) : false
  const viewState = useChecksPanelRuntimeViewState({
    activeWorktree,
    activeWorktreeId,
    activeWorktreePath,
    branch,
    gitStatusInvalidation,
    gitStatusSnapshot,
    hardRefreshError,
    hostedReviewCreationSnapshot,
    localExecutionScope,
    panelContextKey,
    prRefreshStateNow,
    refreshContextKeyRef,
    refreshRequestKeyRef,
    remoteStatusInvalidation,
    repo,
    repoConnectionId,
    runtimeEnvironmentId,
    settings
  })
  const {
    activeGitLabReview,
    activeReview,
    checksFetchedAt: _checksFetchedAt,
    commentsFetchedAt: _commentsFetchedAt,
    fallbackGitHubPRNumber,
    foregroundReviewEvidenceKey,
    hostedReviewCacheKey,
    hostedReviewCreation,
    hostedReviewCreateProvider,
    hostedReviewCreationRequestKey: _hostedReviewCreationRequestKey,
    isGitHubReviewContext: _isGitHubReviewContext,
    isGitLabReviewContext: _isGitLabReviewContext,
    linkedAzureDevOpsPR,
    linkedBitbucketPR,
    linkedGiteaPR,
    linkedGitLabMR,
    linkedPR,
    pr,
    prCacheKey,
    prCachedHasPR,
    prFetchedAt,
    prNumber,
    prRefreshState,
    rawPRRefreshState,
    ...reviewContext
  } = viewState

  useChecksPanelReviewEffects({
    activeWorktreeId,
    branch,
    expireGitHubPRRefreshState,
    isPanelVisible,
    panelContextKey,
    panelContextKeyRef,
    panelVisibleSinceRef,
    pr,
    prCacheKey,
    prNumber,
    prRefreshState,
    rawPRRefreshState,
    repo,
    setHardRefreshError,
    setPrRefreshStateNow
  })
  const {
    gitStatusReadyForPanelContext: _gitStatusReadyForPanelContext,
    hasUncommittedChanges: _hasUncommittedChanges,
    remoteStatus: _remoteStatus,
    eligibilityHeadOid,
    confirmedReadiness,
    checksPanelHasHardRefreshError: _checksPanelHasHardRefreshError
  } = reviewContext
  const eligibilityHeadOidRef = useRef(eligibilityHeadOid)
  eligibilityHeadOidRef.current = eligibilityHeadOid
  const generation = useChecksPanelRuntimeGeneration({
    generation: {
      activeReview,
      activeWorktreeId,
      activeWorktreePath,
      allocatePullRequestGenerationRequestId,
      branch,
      confirmedReadiness,
      fetchUpstreamStatus,
      hostedReviewCreateProvider,
      hostedReviewCreation,
      isFolder,
      ownerSettings,
      pr,
      prGenerationRecords,
      repo,
      setCreatePrError,
      setPullRequestGenerationRecord,
      settings,
      updatePullRequestGenerationRecord
    },
    worktreeId: activeWorktreeId,
    worktreePath: activeWorktreePath,
    repoId: repo?.id,
    branch,
    records: prGenerationRecords
  }) as {
    handleGeneratePullRequestFields: () => Promise<void>
    handleGeneratePullRequestFieldsForActive: (...args: never[]) => void
    handleCancelGeneratePullRequestFields: () => void
    handlePullRequestGenerationSeedRestored: () => void
    handlePrBaseChange: (value: string) => void
    handlePrTitleChange: (value: string) => void
    prAiGenerationEnabled: boolean
    prBase: string
    setPrBase: (value: string) => void
    prTitle: string
    setPrTitle: (value: string) => void
    prBody: string
    setPrBody: (value: string) => void
    prDraft: boolean
    setPrDraft: (value: boolean) => void
    prBaseQuery: string
    setPrBaseQuery: (value: string) => void
    prBaseResults: unknown[]
    setPrBaseResults: (value: unknown[]) => void
    prBaseSearchError: string | null
    prGenerating: boolean
    prGenerateError: string | null
    prGenerateDisabled: boolean
    prGenerateDisabledReason: string | null
    applyGeneratedPullRequestFields: (...args: never[]) => void
    pullRequestFieldsInitialized: boolean
    activePullRequestGenerationKey: string | null
    activePullRequestGenerationRecordCandidate: unknown
    activePullRequestGenerationRecord: unknown
    activePullRequestGenerationSeedRestoreKey: string | null
    createPrPushFirst: boolean
    handleBranchChangedByPullRequestGeneration: (...args: never[]) => void
    prCreationDefaults: unknown
    sourceControlAiActionsVisible: boolean
    createComposerOpen: boolean
  }
  const stateRequestKey =
    repo && branch
      ? activeGitLabReview
        ? checksPanelHostedReviewAsyncResultKey(
            hostedReviewCacheKey,
            branch,
            activeGitLabReview.provider,
            activeGitLabReview.number,
            activeGitLabReview.headSha
          )
        : checksPanelAsyncResultKey(prCacheKey, branch, prNumber, pr?.prRepo, pr?.headSha)
      : ''
  asyncResultKeyRef.current = stateRequestKey

  const isCurrentAsyncResult = useCallback(
    (requestKey: string) =>
      shouldCommitChecksPanelAsyncResult(asyncResultKeyRef.current, requestKey),
    [asyncResultKeyRef]
  )
  useEffect(() => {
    if (
      agentComposerState?.commentResolution &&
      agentComposerState.commentResolution.reviewContextKey !== stateRequestKey
    ) {
      setAgentComposerState(null)
    }
  }, [agentComposerState?.commentResolution, setAgentComposerState, stateRequestKey])

  useEffect(() => {
    if (foregroundReviewEvidenceKey === null || !isPanelVisible) {
      foregroundedUnrenderedReviewKeyRef.current = null
    }
    if (isPanelVisible && repo && !isFolder && branch) {
      void fetchHostedReviewForBranch(repo.path, branch, {
        repoId: repo.id,
        linkedGitHubPR: linkedPR,
        fallbackGitHubPR: fallbackGitHubPRNumber,
        currentHeadOid: activeWorktree?.head ?? null,
        linkedGitLabMR,
        linkedBitbucketPR,
        linkedAzureDevOpsPR,
        linkedGiteaPR,
        staleWhileRevalidate: true
      })
      // Why: the gh-based refresh coordinator is GitHub-only; running it elsewhere gave a spurious gh_unavailable error hiding a valid composer.
      if (activeWorktreeId && isGitHubReviewContext) {
        const refreshRequest = resolveChecksPanelPRRefreshRequest({
          cachedHasPR: prCachedHasPR,
          cachedFetchedAt: prFetchedAt ?? null,
          panelVisibleSince: panelVisibleSinceRef.current,
          hasUnrenderedReviewEvidence: foregroundReviewEvidenceKey !== null,
          hasRequestedForegroundRefresh:
            foregroundReviewEvidenceKey !== null &&
            foregroundedUnrenderedReviewKeyRef.current === foregroundReviewEvidenceKey
        })
        if (refreshRequest.reason === 'active' && foregroundReviewEvidenceKey !== null) {
          foregroundedUnrenderedReviewKeyRef.current = foregroundReviewEvidenceKey
        }
        enqueueGitHubPRRefresh(activeWorktreeId, refreshRequest.reason, refreshRequest.priority)
      }
    }
  }, [
    activeWorktreeId,
    branch,
    enqueueGitHubPRRefresh,
    fallbackGitHubPRNumber,
    fetchHostedReviewForBranch,
    foregroundReviewEvidenceKey,
    isFolder,
    isPanelVisible,
    activeWorktree?.head,
    linkedAzureDevOpsPR,
    linkedBitbucketPR,
    linkedGiteaPR,
    linkedGitLabMR,
    linkedPR,
    prCachedHasPR,
    prFetchedAt,
    foregroundedUnrenderedReviewKeyRef,
    panelVisibleSinceRef,
    repo
  ])

  const runtimeEffects = useChecksPanelRuntimeEffectsBridge({
    foundation,
    viewState,
    isFolder,
    isCurrentAsyncResult,
    eligibilityHeadOidRef
  })
  const { fetchChecks, fetchGitLabDetails, fetchComments } = runtimeEffects
  useChecksPanelRuntimePolling({
    activeGitLabReview,
    fetchChecks,
    fetchGitLabDetails,
    gitStatusSnapshotInFlightContextRef,
    gitStatusSnapshotRerunContextRef,
    isPanelVisible,
    panelContextKeyRef,
    pollIntervalRef,
    prevChecksRef,
    prNumber,
    runtimeEnvironmentId,
    repoConnectionId,
    setGitStatusRefreshNonce,
    setChecks
  })
  const runtimeReviewEffects = runtimeEffects

  const refreshHostedReviewAfterMutation = useChecksPanelReviewRefresh({
    activeGitLabReview,
    activeReview,
    activeWorktreeId,
    branch,
    fallbackGitHubPRNumber,
    fetchGitLabDetails,
    fetchHostedReviewForBranch,
    fetchPRForBranch,
    linkedAzureDevOpsPR,
    linkedBitbucketPR,
    linkedGiteaPR,
    linkedGitLabMR,
    linkedPR,
    repo
  })

  const runtimeActions = useChecksPanelRuntimeActionBridgeFromSources({
    foundation,
    viewState,
    generation,
    effects: { fetchComments, fetchGitLabDetails },
    refreshHostedReviewAfterMutation,
    clearTitleInputFocusTimer,
    stateRequestKey,
    isCurrentAsyncResult
  })
  return renderChecksPanelRuntime({
    foundation,
    viewState,
    generation,
    effects: runtimeReviewEffects,
    actions: runtimeActions,
    overrides: {
      eligibilityHeadOidRef,
      isCurrentAsyncResult,
      isFolder,
      refreshHostedReviewAfterMutation,
      stateRequestKey,
      setChecksPanelContentRef
    }
  })
}
