/* Coordinates hosted-review data with focused checks, comments, and actions sections. */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { prChecksCacheSuffix, prCommentsCacheSuffix } from '@/store/slices/github'
import { getGitHubPRCacheKey, getGitHubRepoCacheKey } from '@/store/slices/github-cache-key'
import { isFolderRepo } from '../../../../shared/repo-kind'
import type { PRInfo, PRCheckDetail } from '../../../../shared/types'
import { pickDefaultSourceControlAgent } from './SourceControl'
import { getHostedReviewCacheKey } from '@/store/slices/hosted-review'
import { type ChecksPanelReview, selectChecksPanelReview } from './checks-panel-review'
import { selectReviewCacheEntry } from './review-cache-entry-selection'
import {
  checksPanelAsyncResultKey,
  checksPanelHostedReviewAsyncResultKey,
  shouldCommitChecksPanelAsyncResult
} from './checks-panel-async-result-key'
import { resolveChecksPanelPRRefreshRequest } from './checks-panel-pr-refresh-request'
import { resolveChecksPanelReviewContext } from './checks-panel-runtime-review-context'
import { renderChecksPanel } from './checks-panel-runtime-render'
import { useChecksPanelRefresh } from './checks-panel-refresh-controller'
import { useChecksPanelReviewEffects } from './checks-panel-review-effects'
import { useChecksPanelRuntimeActions } from './checks-panel-runtime-actions'
import { useChecksPanelCommentFetch } from './checks-panel-comment-fetch'
import { useChecksPanelEntryRefresh } from './checks-panel-entry-refresh'
import { useChecksPanelRuntimePolling } from './checks-panel-runtime-polling'
import { useChecksPanelReviewRefresh } from './checks-panel-runtime-review-refresh'
import { useChecksPanelRuntimeDataEffects } from './checks-panel-runtime-data-effects'
import { useChecksPanelRuntimeGeneration } from './checks-panel-runtime-generation'
import { useChecksPanelRuntimeFoundation } from './checks-panel-runtime-foundation'

function isGitLabChecksPanelReview(
  review: ChecksPanelReview | null
): review is ChecksPanelReview & { provider: 'gitlab' } {
  return review?.provider === 'gitlab'
}

export default function ChecksPanel(): React.JSX.Element {
  // Why: the sidebar stays mounted when closed (perf); gate polling on visibility so we don't fetch checks/comments or poll cwd while hidden.
  const {
    rightSidebarOpen,
    rightSidebarTab,
    isPanelVisible,
    defaultActiveWorktree,
    activeWorktree,
    activeWorktreeId,
    repo,
    activeConnectionId,
    settings,
    updateSettings,
    updateRepo,
    fetchPRForBranch,
    fetchHostedReviewForBranch,
    expireGitHubPRRefreshState,
    getHostedReviewCreationEligibility,
    createHostedReview,
    enqueueGitHubPRRefresh,
    conflictOperation,
    gitStatusInvalidation,
    remoteStatusInvalidation,
    isRemoteOperationActive,
    pushBranch,
    syncBranch,
    fetchUpstreamStatus,
    setRightSidebarOpen,
    setRightSidebarTab,
    updateWorktreeMeta,
    updateWorktreeGitIdentity,
    openModal,
    fetchPRChecks,
    fetchPRCheckDetails,
    fetchPRComments,
    addPRConversationComment,
    addPRReviewCommentReply,
    resolveReviewThread,
    detectedAgentIds,
    remoteDetectedAgentIds,
    checks,
    setChecks,
    checksLoading,
    setChecksLoading,
    setComments,
    commentsLoading,
    setCommentsLoading,
    commentsRef,
    commentsSelectionClearRequest,
    setCommentsSelectionClearRequest,
    commentsSelectionClearTokenRef,
    emptyRefreshing,
    setEmptyRefreshing,
    isRefreshing,
    setIsRefreshing,
    refreshInFlightRef,
    conflictDetailsRefreshing,
    setConflictDetailsRefreshing,
    createPrInFlightRef,
    isCreatingPr,
    setIsCreatingPr,
    createPrError,
    setCreatePrError,
    isPublishingBranch,
    setIsPublishingBranch,
    isSyncingBranch,
    setIsSyncingBranch,
    isFixingChecksWithAI,
    setIsFixingChecksWithAI,
    agentComposerState,
    setAgentComposerState,
    hostedReviewCreationSnapshot,
    setHostedReviewCreationSnapshot,
    hardRefreshError,
    setHardRefreshError,
    gitStatusSnapshot,
    setGitStatusSnapshot,
    gitStatusProbeErrorContextKey,
    setGitStatusProbeErrorContextKey,
    gitStatusRefreshNonce,
    setGitStatusRefreshNonce,
    eligibilityRefreshNonce,
    setEligibilityRefreshNonce,
    editingTitle,
    setEditingTitle,
    titleDraft,
    setTitleDraft,
    titleSaving,
    setTitleSaving,
    titleInputRef,
    titleInputFocusTimerRef,
    pollIntervalRef,
    mountedRef,
    confirm,
    prevChecksRef,
    conflictSummaryRefreshKeyRef,
    panelVisibleSinceRef,
    foregroundedUnrenderedReviewKeyRef,
    isResolvingConflictsWithAI,
    prGenerationRecords,
    allocatePullRequestGenerationRequestId,
    setPullRequestGenerationRecord,
    updatePullRequestGenerationRecord,
    asyncResultKeyRef,
    refreshRequestKeyRef,
    refreshContextKeyRef,
    gitStatusSnapshotInFlightContextRef,
    gitStatusSnapshotRerunContextRef,
    gitStatusSnapshotRetryTimerRef,
    gitIdentityDisplay,
    detachedHeadDisplay,
    branch,
    activeWorktreePath,
    activeWorktreePushTarget,
    activeSourceControlLaunchPlatform,
    runtimeEnvironmentId,
    ownerSettings,
    repoConnectionId,
    localExecutionScope,
    sshConnectionStatus,
    panelContextKey,
    panelContextKeyRef,
    saveLaunchActionDefault
  } = useChecksPanelRuntimeFoundation()
  const clearTitleInputFocusTimer = useCallback((): void => {
    if (titleInputFocusTimerRef.current !== null) {
      clearTimeout(titleInputFocusTimerRef.current)
      titleInputFocusTimerRef.current = null
    }
  }, [titleInputFocusTimerRef])

  const setChecksPanelContentRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === null) {
        clearTitleInputFocusTimer()
      }
    },
    [clearTitleInputFocusTimer]
  )

  // Why: no key={worktreeId} remount (caused an IPC storm on Windows); reset branch-specific state during render (not useEffect) so it lands on the same paint.
  const [prevPanelContextKey, setPrevPanelContextKey] = useState(panelContextKey)
  const [prRefreshStateNow, setPrRefreshStateNow] = useState(() => Date.now())
  if (panelContextKey !== prevPanelContextKey) {
    setPrevPanelContextKey(panelContextKey)
    setEditingTitle(false)
    setTitleDraft('')
    setTitleSaving(false)
    clearTitleInputFocusTimer()
    setChecks([])
    setChecksLoading(false)
    setComments([])
    setCommentsLoading(false)
    setIsRefreshing(false)
    setEmptyRefreshing(false)
    setConflictDetailsRefreshing(false)
    setPrRefreshStateNow(Date.now())
    createPrInFlightRef.current = null
    setIsCreatingPr(false)
    setCreatePrError(null)
    setIsPublishingBranch(false)
    setAgentComposerState(null)
    setHostedReviewCreationSnapshot(null)
    setHardRefreshError(null)
    setGitStatusSnapshot(null)
    setGitStatusProbeErrorContextKey(null)
    setGitStatusRefreshNonce((value) => value + 1)
    pollIntervalRef.current = 30_000
    prevChecksRef.current = ''
    conflictSummaryRefreshKeyRef.current = null
    refreshInFlightRef.current = false
    refreshRequestKeyRef.current = null
    if (gitStatusSnapshotRetryTimerRef.current) {
      clearTimeout(gitStatusSnapshotRetryTimerRef.current)
      gitStatusSnapshotRetryTimerRef.current = null
    }
  }

  const isFolder = repo ? isFolderRepo(repo) : false
  const prCacheKey =
    repo && branch
      ? getGitHubPRCacheKey(
          repo.path,
          repo.id,
          branch,
          settings,
          repo.connectionId,
          repo.executionHostId,
          true
        )
      : ''
  const hostedReviewCacheKey =
    repo && branch
      ? getHostedReviewCacheKey(
          repo.path,
          branch,
          settings,
          repo.id,
          repo.connectionId,
          repo.executionHostId,
          true
        )
      : ''
  const refreshContextKey = `${activeWorktreeId ?? ''}::${prCacheKey}::${branch}`
  if (refreshContextKey !== refreshContextKeyRef.current) {
    refreshContextKeyRef.current = refreshContextKey
    refreshRequestKeyRef.current = null
  }
  // Why: background PR refreshes replace the cache map; Checks only renders the entry for the active repo and branch.
  const prCacheEntry = useAppStore((s) => selectReviewCacheEntry(s.prCache, prCacheKey || null))
  const pr: PRInfo | null = prCacheEntry?.data ?? null
  const prCachedHasPR = prCacheEntry ? prCacheEntry.data !== null : null
  const hostedReview = useAppStore((s) =>
    hostedReviewCacheKey ? (s.hostedReviewCache[hostedReviewCacheKey]?.data ?? null) : null
  )
  const linkedReviewNumber =
    activeWorktree?.linkedPR ??
    activeWorktree?.linkedGitLabMR ??
    activeWorktree?.linkedBitbucketPR ??
    activeWorktree?.linkedAzureDevOpsPR ??
    activeWorktree?.linkedGiteaPR ??
    null
  // Why: branch lookup is lossy for fork/deleted-head PRs; reuse a known PR number from metadata or cache whenever we have one.
  const linkedPR = activeWorktree?.linkedPR ?? null
  const fallbackGitHubPRNumber = linkedPR == null ? (pr?.number ?? null) : null
  const linkedGitLabMR = activeWorktree?.linkedGitLabMR ?? null
  const linkedBitbucketPR = activeWorktree?.linkedBitbucketPR ?? null
  const linkedAzureDevOpsPR = activeWorktree?.linkedAzureDevOpsPR ?? null
  const linkedGiteaPR = activeWorktree?.linkedGiteaPR ?? null
  const activeReview: ChecksPanelReview | null = selectChecksPanelReview({
    hostedReview,
    pr,
    linkedGitLabMR,
    linkedBitbucketPR,
    linkedAzureDevOpsPR,
    linkedGiteaPR
  })
  const activeGitLabReview = isGitLabChecksPanelReview(activeReview) ? activeReview : null
  const isGitLabReviewContext = Boolean(activeGitLabReview || linkedGitLabMR !== null)
  const activeConflictReview = activeReview?.mergeable === 'CONFLICTING' ? activeReview : null
  const prRefreshState = useAppStore((s) =>
    prCacheKey ? s.getEffectiveGitHubPRRefreshState(prCacheKey, prRefreshStateNow) : undefined
  )
  const rawPRRefreshState = useAppStore((s) =>
    prCacheKey ? s.prRefreshStates[prCacheKey] : undefined
  )
  const prNumber = pr?.number ?? null

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
  // Why: select only timestamps, not whole cache records, so the entry-refresh effect doesn't re-run on every cache mutation. See docs/refresh-on-checks-tab.md.
  const prFetchedAt = useAppStore((s) =>
    prCacheKey ? s.prCache[prCacheKey]?.fetchedAt : undefined
  )
  const checksCacheKey =
    repo && prNumber
      ? getGitHubRepoCacheKey(
          repo.path,
          repo.id,
          prChecksCacheSuffix(prNumber, pr?.prRepo),
          settings,
          repo.connectionId,
          repo.executionHostId,
          true
        )
      : ''
  const commentsCacheKey =
    repo && prNumber
      ? getGitHubRepoCacheKey(
          repo.path,
          repo.id,
          prCommentsCacheSuffix(prNumber, pr?.prRepo),
          settings,
          repo.connectionId,
          repo.executionHostId,
          true
        )
      : ''
  const checksFetchedAt = useAppStore((s) =>
    checksCacheKey ? s.checksCache[checksCacheKey]?.fetchedAt : undefined
  )
  const commentsFetchedAt = useAppStore((s) =>
    commentsCacheKey ? s.commentsCache[commentsCacheKey]?.fetchedAt : undefined
  )

  const hostedReviewCreationRequestKey =
    repo && branch
      ? JSON.stringify({
          repoId: repo.id,
          repoPath: repo.path,
          worktreeId: activeWorktreeId ?? null,
          worktreePath: activeWorktreePath,
          runtimeEnvironmentId,
          connectionId: repoConnectionId,
          branch,
          base: repo.worktreeBaseRef ?? null,
          hasUncommittedChanges:
            gitStatusSnapshot?.contextKey === panelContextKey
              ? gitStatusSnapshot.hasUncommittedChanges
              : null,
          hasUpstream:
            gitStatusSnapshot?.contextKey === panelContextKey
              ? (gitStatusSnapshot.remoteStatus?.hasUpstream ?? null)
              : null,
          ahead:
            gitStatusSnapshot?.contextKey === panelContextKey
              ? (gitStatusSnapshot.remoteStatus?.ahead ?? null)
              : null,
          behind:
            gitStatusSnapshot?.contextKey === panelContextKey
              ? (gitStatusSnapshot.remoteStatus?.behind ?? null)
              : null,
          linkedGitHubPR: linkedPR,
          fallbackGitHubPR: fallbackGitHubPRNumber,
          linkedGitLabMR,
          linkedBitbucketPR,
          linkedAzureDevOpsPR,
          linkedGiteaPR
        })
      : ''
  const reviewContext = resolveChecksPanelReviewContext({
    activeWorktree,
    gitStatusInvalidation,
    gitStatusSnapshot,
    hardRefreshError,
    hostedReview,
    hostedReviewCreationSnapshot,
    isGitHubReviewContextHint: true,
    linkedReviewNumber,
    localExecutionScope,
    panelContextKey,
    repo,
    repoConnectionId,
    runtimeEnvironmentId,
    settingsRequestKey: hostedReviewCreationRequestKey,
    pr,
    prCachedHasPR,
    eligibilityReviewLookupOutcome: hostedReviewCreationSnapshot?.data?.reviewLookupOutcome ?? null,
    remoteStatusInvalidation
  })
  const {
    gitStatusInputs,
    gitStatusReadyForPanelContext,
    hasUncommittedChanges,
    remoteStatus,
    eligibilityHeadOid,
    eligibilityGitFingerprint,
    publishActionGitStatusInputs,
    publishActionHasUncommittedChanges,
    publishActionRemoteStatus,
    hostedReviewCreation,
    hostedReviewCreateProvider,
    hostedReviewCreateCopy,
    hasNonGitHubLinkedReview,
    isGitHubReviewContext,
    prCachedHasPRForContext,
    checksPanelReviewLookup,
    checksPanelReviewLookupResult,
    hasUnrenderedReviewEvidence,
    unrenderedReviewEvidenceIdentity,
    unrenderedReviewEvidenceProvider,
    foregroundReviewEvidenceKey,
    hardErrorObservedAt,
    confirmedReadinessInput,
    confirmedReadiness,
    checksPanelHasHardRefreshError
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
  }
  const {
    handleGeneratePullRequestFields,
    handleGeneratePullRequestFieldsForActive,
    handleCancelGeneratePullRequestFields,
    handlePullRequestGenerationSeedRestored,
    handlePrBaseChange,
    handlePrTitleChange,
    prAiGenerationEnabled,
    prBase,
    setPrBase,
    prTitle,
    setPrTitle,
    prBody,
    setPrBody,
    prDraft,
    setPrDraft,
    prBaseQuery,
    setPrBaseQuery,
    prBaseResults,
    setPrBaseResults,
    prBaseSearchError,
    prGenerating,
    prGenerateError,
    prGenerateDisabled,
    prGenerateDisabledReason,
    applyGeneratedPullRequestFields,
    pullRequestFieldsInitialized,
    activePullRequestGenerationKey,
    activePullRequestGenerationRecordCandidate,
    activePullRequestGenerationRecord,
    activePullRequestGenerationSeedRestoreKey,
    createPrPushFirst
  } = generation
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
    isGitHubReviewContext,
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

  const { fetchChecks, fetchGitLabDetails } = useChecksPanelRuntimeDataEffects({
    git: {
      activeConnectionId,
      activeWorktreeId,
      activeWorktreePath,
      activeWorktreePushTarget,
      branch,
      conflictSummaryRefreshKeyRef,
      eligibilityHeadOidRef,
      fallbackGitHubPRNumber,
      fetchPRForBranch,
      getHostedReviewCreationEligibility,
      gitStatusInvalidation,
      gitStatusReadyForPanelContext,
      gitStatusSnapshotInFlightContextRef,
      gitStatusSnapshotRerunContextRef,
      gitStatusSnapshotRetryTimerRef,
      hasUncommittedChanges,
      hostedReviewCreationRequestKey,
      isFolder,
      isPanelVisible,
      linkedAzureDevOpsPR,
      linkedBitbucketPR,
      linkedGitLabMR,
      linkedGiteaPR,
      linkedPR,
      localExecutionScope,
      ownerSettings,
      panelContextKey,
      panelContextKeyRef,
      pr,
      prCacheKey,
      remoteStatus,
      remoteStatusInvalidation,
      repo,
      repoConnectionId,
      runtimeEnvironmentId,
      setConflictDetailsRefreshing,
      setGitStatusProbeErrorContextKey,
      setGitStatusRefreshNonce,
      setGitStatusSnapshot,
      setHostedReviewCreationSnapshot,
      settings,
      sshConnectionStatus,
      updateWorktreeGitIdentity
    },
    fetch: {
      activeGitLabReview,
      asyncResultKeyRef,
      branch,
      fetchPRChecks,
      hostedReviewCacheKey,
      isCurrentAsyncResult,
      pollIntervalRef,
      pr,
      prCacheKey,
      prNumber,
      prevChecksRef,
      repo,
      setChecks,
      setChecksLoading,
      setComments,
      setCommentsLoading,
      settings
    }
  }) as {
    fetchChecks: (options?: { force?: boolean; prNumberOverride?: number | null }) => Promise<void>
    fetchGitLabDetails: (options?: {
      mrNumberOverride?: number | null
      headShaOverride?: string | null
      commitAsCurrent?: boolean
    }) => Promise<void>
  }
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

  const { fetchComments, handleLoadCheckDetails } = useChecksPanelCommentFetch({
    activeGitLabReview,
    branch,
    checksPanelAsyncResultKey,
    fetchPRCheckDetails,
    fetchPRComments,
    isCurrentAsyncResult,
    isPanelVisible,
    pr,
    prCacheKey,
    prNumber,
    repo,
    setComments,
    setCommentsLoading
  }) as {
    fetchComments: (options?: {
      force?: boolean
      prNumberOverride?: number | null
      prRepoOverride?: PRInfo['prRepo'] | null
    }) => Promise<void>
    handleLoadCheckDetails: (check: PRCheckDetail) => Promise<unknown>
  }

  const handleRefresh = useChecksPanelRefresh({
    activeConnectionId,
    activeGitLabReview,
    activeWorktreeId,
    activeWorktreePath,
    activeWorktreePushTarget,
    asyncResultKeyRef,
    branch,
    expireGitHubPRRefreshState,
    fallbackGitHubPRNumber,
    fetchChecks,
    fetchGitLabDetails,
    fetchHostedReviewForBranch,
    fetchPRChecks,
    fetchPRComments,
    fetchPRForBranch,
    hasUncommittedChanges,
    isCurrentAsyncResult,
    isFolder,
    isGitLabReviewContext,
    linkedAzureDevOpsPR,
    linkedBitbucketPR,
    linkedGitLabMR,
    linkedGiteaPR,
    linkedPR,
    ownerSettings,
    panelContextKey,
    panelContextKeyRef,
    pollIntervalRef,
    pr,
    prCacheKey,
    prNumber,
    prevChecksRef,
    rawPRRefreshState,
    refreshInFlightRef,
    refreshRequestKeyRef,
    remoteStatus,
    repo,
    settings,
    updateWorktreeGitIdentity,
    setChecks,
    setChecksLoading,
    setComments,
    setCommentsLoading,
    setEligibilityRefreshNonce,
    setGitStatusSnapshot,
    setIsRefreshing
  }) as () => Promise<void>
  const { handleEntryRefresh } = useChecksPanelEntryRefresh({
    activeGitLabReview,
    activeWorktree,
    activeWorktreeId,
    branch,
    checksFetchedAt,
    commentsFetchedAt,
    enqueueGitHubPRRefresh,
    fallbackGitHubPRNumber,
    fetchChecks,
    fetchGitLabDetails,
    fetchHostedReviewForBranch,
    fetchComments,
    hostedReviewCacheKey,
    isFolder,
    isGitLabReviewContext,
    isPanelVisible,
    linkedAzureDevOpsPR,
    linkedBitbucketPR,
    linkedGitLabMR,
    linkedGiteaPR,
    linkedPR,
    prCacheKey,
    prFetchedAt,
    prNumber,
    pollIntervalRef,
    prevChecksRef,
    repo
  }) as {
    handleEntryRefresh: (options: { refreshChecks: boolean; refreshComments: boolean }) => void
  }

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

  const detectedAgentsForAI =
    typeof activeConnectionId === 'string' ? remoteDetectedAgentIds : detectedAgentIds
  const noEnabledAgentKnown =
    detectedAgentsForAI != null &&
    pickDefaultSourceControlAgent(
      settings?.defaultTuiAgent,
      detectedAgentsForAI,
      settings?.disabledTuiAgents
    ) == null
  const aiActionDisabledReason = !activeWorktreeId
    ? 'Select a workspace before launching an AI action.'
    : noEnabledAgentKnown
      ? 'No enabled AI agents. Configure agents in Settings.'
      : undefined
  const resolveCommentsWithAIDisabledReason = commentsLoading
    ? 'Comments are still loading.'
    : aiActionDisabledReason
      ? aiActionDisabledReason
      : !activeReview
        ? 'Open a PR or MR before launching an AI action.'
        : !repo
          ? 'Select a repository before launching an AI action.'
          : activeReview.provider === 'github' && !prNumber
            ? 'Open a GitHub PR before resolving comments.'
            : activeReview.provider === 'gitlab' && !activeGitLabReview
              ? 'Open a GitLab MR before resolving comments.'
              : undefined

  const runtimeActions = useChecksPanelRuntimeActions({
    comments: {
      activeConnectionId,
      activeGitLabReview,
      activeReview,
      activeWorktreeId,
      addPRConversationComment,
      addPRReviewCommentReply,
      branch,
      clearTitleInputFocusTimer,
      confirm,
      detectedAgentIds,
      isCurrentAsyncResult,
      mountedRef,
      pr,
      prCacheKey,
      prNumber,
      refreshHostedReviewAfterMutation,
      remoteDetectedAgentIds,
      repo,
      resolveReviewThread,
      setAgentComposerState,
      setComments,
      setEditingTitle,
      setTitleDraft,
      setTitleSaving,
      settings,
      sourceControlAiActionsVisible,
      titleInputFocusTimerRef,
      titleInputRef
    },
    ai: {
      activeConflictReview,
      activeReview,
      activeWorktreeId,
      activeWorktreePath,
      asyncResultKeyRef,
      branch,
      commentsRef,
      commentsSelectionClearTokenRef,
      fetchComments,
      fetchGitLabDetails,
      fetchHostedReviewForBranch,
      fetchPRCheckDetails,
      fetchPRChecks,
      fetchPRComments,
      fetchPRForBranch,
      isCurrentAsyncResult,
      linkedAzureDevOpsPR,
      linkedBitbucketPR,
      linkedGitLabMR,
      linkedGiteaPR,
      panelContextKey,
      panelContextKeyRef,
      pr,
      prCacheKey,
      repo,
      resolveCommentsWithAIDisabledReason,
      setAgentComposerState,
      setChecks,
      setChecksLoading,
      setComments,
      setCommentsLoading,
      setCommentsSelectionClearRequest,
      sourceControlAiActionsVisible,
      stateRequestKey
    },
    fixChecks: {
      activeReview,
      activeWorktreeId,
      checks,
      fetchPRCheckDetails,
      isCurrentAsyncResult,
      isFixingChecksWithAI,
      pr,
      repo,
      sourceControlAiActionsVisible,
      stateRequestKey,
      setIsFixingChecksWithAI
    },
    links: {
      activeConnectionId,
      activeReview,
      activeWorktreeId,
      branch,
      fallbackGitHubPRNumber,
      fetchHostedReviewForBranch,
      fetchUpstreamStatus,
      isRemoteOperationActive,
      linkedAzureDevOpsPR,
      linkedBitbucketPR,
      linkedGitLabMR,
      linkedGiteaPR,
      linkedPR,
      openModal,
      ownerSettings,
      pr,
      pushBranch,
      repo,
      setGitStatusRefreshNonce,
      setIsPublishingBranch,
      setIsSyncingBranch,
      setRightSidebarOpen,
      setRightSidebarTab,
      syncBranch,
      updateWorktreeMeta
    },
    create: {
      activePullRequestGenerationKey,
      activeWorktreeId,
      activeWorktreePath,
      branch,
      createComposerOpen,
      createHostedReview,
      createPrInFlightRef,
      createPrPushFirst,
      hostedReviewCreateCopy,
      hostedReviewCreateProvider,
      hostedReviewCreation,
      panelContextKey,
      panelContextKeyRef,
      prCreationDefaults,
      repo,
      setCreatePrError,
      setGitStatusRefreshNonce,
      setIsCreatingPr,
      updatePullRequestGenerationRecord
    }
  })
  const {
    handleStartEdit,
    handleCancelEdit,
    handleSaveTitle,
    handleTitleKeyDown,
    handleResolve,
    handleAddPRComment,
    handleEditComment,
    handleDeleteComment,
    handleReplyToComment,
    handleResolveConflictsWithAI,
    handleResolveCommentsWithAI,
    handleFixChecksWithAI,
    handleOpenPR,
    handleUnlinkPullRequest,
    handleLinkAnotherPullRequest,
    pushBeforeCreatePullRequest,
    handlePublishBranch,
    handleSyncBranch,
    handlePullRequestCreated,
    handleCreatePullRequest
  } = runtimeActions
  return renderChecksPanel({
    activeConflictReview,
    activeConnectionId,
    activeGitLabReview,
    activePullRequestGenerationKey,
    activePullRequestGenerationRecord,
    activePullRequestGenerationRecordCandidate,
    activePullRequestGenerationSeedRestoreKey,
    activeReview,
    activeSourceControlLaunchPlatform,
    activeWorktreeId,
    activeWorktreePath,
    activeWorktreePushTarget,
    addPRConversationComment,
    addPRReviewCommentReply,
    aiActionDisabledReason,
    allocatePullRequestGenerationRequestId,
    asyncResultKeyRef,
    branch,
    canTargetPRComments,
    checksCacheKey,
    checksFetchedAt,
    checksPanelHasHardRefreshError,
    checksPanelReviewLookup,
    checksPanelReviewLookupResult,
    clearSentCommentSelection,
    clearTitleInputFocusTimer,
    commentsCacheKey,
    commentsDisabledReason,
    commentsFetchedAt,
    commentsRef,
    commentsSelectionClearTokenRef,
    confirm,
    confirmedReadiness,
    confirmedReadinessInput,
    conflictOperation,
    conflictSummaryRefreshKeyRef,
    createComposerOpen,
    createHostedReview,
    createPrInFlightRef,
    createPrPushFirst,
    defaultActiveWorktree,
    detachedHeadDisplay,
    detectedAgentIds,
    detectedAgentsForAI,
    eligibilityGitFingerprint,
    eligibilityHeadOid,
    eligibilityHeadOidRef,
    enqueueGitHubPRRefresh,
    entryKey,
    expireGitHubPRRefreshState,
    fallbackGitHubPRNumber,
    fetchChecks,
    fetchComments,
    fetchGitLabDetails,
    fetchHostedReviewForBranch,
    fetchPRCheckDetails,
    fetchPRChecks,
    fetchPRComments,
    fetchPRForBranch,
    fetchUpstreamStatus,
    foregroundReviewEvidenceKey,
    foregroundedUnrenderedReviewKeyRef,
    getHostedReviewCreationEligibility,
    gitIdentityDisplay,
    gitStatusInputs,
    gitStatusInvalidation,
    gitStatusReadyForPanelContext,
    gitStatusSnapshotInFlightContextRef,
    gitStatusSnapshotRerunContextRef,
    gitStatusSnapshotRetryTimerRef,
    handleAddPRComment,
    handleBranchChangedByPullRequestGeneration,
    handleCancelEdit,
    handleCancelGeneratePullRequestFieldsForActive,
    handleCreatePullRequest,
    handleDeleteComment,
    handleEditComment,
    handleEntryRefresh,
    handleFixChecksWithAI,
    handleGeneratePullRequestFieldsForActive,
    handleLinkAnotherPullRequest,
    handleLoadCheckDetails,
    handleOpenPR,
    handlePrBaseChange,
    handlePrTitleChange,
    handlePublishBranch,
    handlePullRequestCreated,
    handlePullRequestGenerationSeedRestored,
    handleRefresh,
    handleReplyToComment,
    handleResolve,
    handleResolveCommentsWithAI,
    handleResolveConflictsWithAI,
    handleSaveTitle,
    handleStartEdit,
    handleSyncBranch,
    handleTitleKeyDown,
    handleUnlinkPullRequest,
    hardErrorObservedAt,
    hasNonGitHubLinkedReview,
    hasUncommittedChanges,
    hasUnrenderedReviewEvidence,
    hostedReview,
    hostedReviewCacheKey,
    hostedReviewCreateCopy,
    hostedReviewCreateProvider,
    hostedReviewCreation,
    hostedReviewCreationRequestKey,
    isCurrentAsyncResult,
    isFolder,
    isGitHubReviewContext,
    isGitLabReviewContext,
    isPanelVisible,
    isRemoteOperationActive,
    isResolvingConflictsWithAI,
    lastEntryKeyRef,
    linkedAzureDevOpsPR,
    linkedBitbucketPR,
    linkedGitLabMR,
    linkedGiteaPR,
    linkedPR,
    linkedReviewNumber,
    localExecutionScope,
    mountedRef,
    noEnabledAgentKnown,
    openModal,
    ownerSettings,
    panelContextKey,
    panelContextKeyRef,
    panelVisibleSinceRef,
    pollIntervalRef,
    pr,
    prCacheEntry,
    prCacheKey,
    prCachedHasPR,
    prCachedHasPRForContext,
    prCreationDefaults,
    prFetchedAt,
    prGenerationRecords,
    prNumber,
    prRefreshState,
    prevChecksRef,
    publishActionGitStatusInputs,
    publishActionHasUncommittedChanges,
    publishActionRemoteStatus,
    pushBeforeCreatePullRequest,
    pushBranch,
    rawPRRefreshState,
    refreshCommentsAfterBulkResolve,
    refreshContextKey,
    refreshContextKeyRef,
    refreshHostedReviewAfterMutation,
    refreshInFlightRef,
    refreshLinkedGitHubPullRequest,
    refreshRequestKeyRef,
    remoteDetectedAgentIds,
    remoteStatus,
    remoteStatusInvalidation,
    repo,
    repoConnectionId,
    resolveCommentsWithAIDisabledReason,
    resolveReviewThread,
    resolveSelectedThreadsAfterLaunch,
    rightSidebarOpen,
    rightSidebarTab,
    runtimeEnvironmentId,
    saveLaunchActionDefault,
    setChecksPanelContentRef,
    setPullRequestGenerationRecord,
    setRightSidebarOpen,
    setRightSidebarTab,
    settings,
    sourceControlAiActionsVisible,
    sshConnectionStatus,
    stateRequestKey,
    syncBranch,
    titleInputFocusTimerRef,
    titleInputRef,
    unrenderedReviewEvidenceIdentity,
    unrenderedReviewEvidenceProvider,
    updatePullRequestGenerationRecord,
    updateRepo,
    updateSettings,
    updateWorktreeGitIdentity,
    updateWorktreeMeta,
    checksLoading,
    commentsLoading,
    commentsSelectionClearRequest,
    emptyRefreshing,
    isRefreshing,
    conflictDetailsRefreshing,
    createPrError,
    gitStatusProbeErrorContextKey,
    gitStatusRefreshNonce,
    eligibilityRefreshNonce,
    editingTitle,
    titleDraft,
    titleSaving,
    prAiGenerationEnabled,
    setPrBody,
    setPrDraft,
    prBaseQuery,
    setPrBaseQuery,
    prBaseResults,
    setPrBaseResults,
    prBaseSearchError,
    prGenerateError,
    prGenerateDisabled,
    prGenerateDisabledReason,
    pullRequestFieldsInitialized,
    handleGeneratePullRequestFields,
    handleCancelGeneratePullRequestFields,
    isPublishingBranch,
    isSyncingBranch,
    prBase,
    prTitle,
    prBody,
    prDraft,
    prGenerating,
    isCreatingPr,
    setPrBase,
    setPrTitle,
    applyGeneratedPullRequestFields
  })
}
