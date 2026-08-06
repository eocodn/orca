import { useAppStore } from '@/store'
import { prChecksCacheSuffix, prCommentsCacheSuffix } from '@/store/slices/github'
import { getGitHubPRCacheKey, getGitHubRepoCacheKey } from '@/store/slices/github-cache-key'
import { getHostedReviewCacheKey } from '@/store/slices/hosted-review'
import type { PRInfo } from '../../../../shared/types'
import type { useChecksPanelRuntimeFoundation } from './checks-panel-runtime-foundation'
import type { useChecksPanelRuntimeState } from './checks-panel-runtime-state'
import { type ChecksPanelReview, selectChecksPanelReview } from './checks-panel-review'
import { selectReviewCacheEntry } from './review-cache-entry-selection'
import {
  buildChecksPanelHostedReviewCreationRequestKey,
  resolveChecksPanelReviewContext
} from './checks-panel-runtime-review-context'

type Foundation = ReturnType<typeof useChecksPanelRuntimeFoundation>
type RuntimeState = ReturnType<typeof useChecksPanelRuntimeState>

export type ChecksPanelRuntimeViewStateInput = Pick<
  Foundation,
  | 'activeWorktree'
  | 'activeWorktreeId'
  | 'activeWorktreePath'
  | 'branch'
  | 'gitStatusInvalidation'
  | 'remoteStatusInvalidation'
  | 'repo'
  | 'repoConnectionId'
  | 'runtimeEnvironmentId'
  | 'settings'
  | 'localExecutionScope'
  | 'panelContextKey'
  | 'refreshContextKeyRef'
  | 'refreshRequestKeyRef'
> &
  Pick<RuntimeState, 'gitStatusSnapshot' | 'hardRefreshError' | 'hostedReviewCreationSnapshot'> & {
    prRefreshStateNow: number
  }

function isGitLabChecksPanelReview(
  review: ChecksPanelReview | null
): review is ChecksPanelReview & { provider: 'gitlab' } {
  return review?.provider === 'gitlab'
}

export function useChecksPanelRuntimeViewState({
  activeWorktree,
  activeWorktreeId,
  activeWorktreePath,
  branch,
  gitStatusInvalidation,
  hardRefreshError,
  hostedReviewCreationSnapshot,
  localExecutionScope,
  panelContextKey,
  prRefreshStateNow,
  remoteStatusInvalidation,
  repo,
  repoConnectionId,
  runtimeEnvironmentId,
  settings,
  refreshContextKeyRef,
  refreshRequestKeyRef,
  gitStatusSnapshot
}: ChecksPanelRuntimeViewStateInput) {
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

  // Background PR refreshes replace the cache map; render only the active branch entry.
  const prCacheEntry = useAppStore((state) =>
    selectReviewCacheEntry(state.prCache, prCacheKey || null)
  )
  const pr: PRInfo | null = prCacheEntry?.data ?? null
  const prCachedHasPR = prCacheEntry ? prCacheEntry.data !== null : null
  const hostedReview = useAppStore((state) =>
    hostedReviewCacheKey ? (state.hostedReviewCache[hostedReviewCacheKey]?.data ?? null) : null
  )
  const linkedReviewNumber =
    activeWorktree?.linkedPR ??
    activeWorktree?.linkedGitLabMR ??
    activeWorktree?.linkedBitbucketPR ??
    activeWorktree?.linkedAzureDevOpsPR ??
    activeWorktree?.linkedGiteaPR ??
    null
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
  const prRefreshState = useAppStore((state) =>
    prCacheKey ? state.getEffectiveGitHubPRRefreshState(prCacheKey, prRefreshStateNow) : undefined
  )
  const rawPRRefreshState = useAppStore((state) =>
    prCacheKey ? state.prRefreshStates[prCacheKey] : undefined
  )
  const prNumber = pr?.number ?? null
  const prFetchedAt = useAppStore((state) =>
    prCacheKey ? state.prCache[prCacheKey]?.fetchedAt : undefined
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
  const checksFetchedAt = useAppStore((state) =>
    checksCacheKey ? state.checksCache[checksCacheKey]?.fetchedAt : undefined
  )
  const commentsFetchedAt = useAppStore((state) =>
    commentsCacheKey ? state.commentsCache[commentsCacheKey]?.fetchedAt : undefined
  )
  const hostedReviewCreationRequestKey = buildChecksPanelHostedReviewCreationRequestKey({
    repo,
    branch,
    worktreeId: activeWorktreeId,
    worktreePath: activeWorktreePath,
    runtimeEnvironmentId,
    repoConnectionId,
    snapshot: gitStatusSnapshot,
    panelContextKey,
    linkedPR,
    fallbackGitHubPRNumber,
    linkedGitLabMR,
    linkedBitbucketPR,
    linkedAzureDevOpsPR,
    linkedGiteaPR
  })
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
  return {
    activeConflictReview,
    activeGitLabReview,
    activeReview,
    checksCacheKey,
    checksFetchedAt,
    commentsCacheKey,
    commentsFetchedAt,
    fallbackGitHubPRNumber,
    foregroundReviewEvidenceKey: reviewContext.foregroundReviewEvidenceKey,
    hasNonGitHubLinkedReview: reviewContext.hasNonGitHubLinkedReview,
    hostedReview,
    hostedReviewCacheKey,
    hostedReviewCreationRequestKey,
    isGitHubReviewContext: reviewContext.isGitHubReviewContext,
    isGitLabReviewContext,
    linkedAzureDevOpsPR,
    linkedBitbucketPR,
    linkedGiteaPR,
    linkedGitLabMR,
    linkedPR,
    linkedReviewNumber,
    pr,
    prCacheEntry,
    prCacheKey,
    prCachedHasPR,
    prFetchedAt,
    prNumber,
    prRefreshState,
    rawPRRefreshState,
    refreshContextKey,
    refreshContextKeyRef,
    refreshRequestKeyRef,
    ...reviewContext
  }
}
