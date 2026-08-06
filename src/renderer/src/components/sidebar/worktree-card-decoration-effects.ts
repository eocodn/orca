import { useEffect } from 'react'
import type { Repo, Worktree } from '../../../../shared/types'
import { isMacAppDataPath } from '@/lib/passive-macos-app-data-access'
import { installWindowVisibilityInterval, isWindowVisible } from '@/lib/window-visibility-interval'
import { isWebClient, HOSTED_REVIEW_CARD_REFRESH_INTERVAL_MS } from './worktree-card-model'

type HostedReviewRefresh = (
  repoPath: string,
  branch: string,
  options: {
    repoId: string
    linkedGitHubPR: number | null
    fallbackGitHubPR?: number
    currentHeadOid: string | null
    linkedGitLabMR: number | null
    linkedBitbucketPR: number | null
    linkedAzureDevOpsPR: number | null
    linkedGiteaPR: number | null
    staleWhileRevalidate: boolean
  }
) => void | Promise<void>

export type WorktreeCardDecorationEffectsProps = {
  worktree: Worktree
  repo: Repo | undefined
  branch: string
  isFolder: boolean
  newCardStyle: boolean
  hoverDetailsOpen: boolean
  shouldRefreshHostedReview: boolean
  showIssue: boolean
  showLinearIssue: boolean
  hostedReviewCacheKey: string
  issueCacheKey: string
  cachedBranchFallbackGitHubPRNumber: number | null
  linkedGitLabMR: number | null
  linkedBitbucketPR: number | null
  linkedAzureDevOpsPR: number | null
  linkedGiteaPR: number | null
  fetchHostedReviewForBranch: HostedReviewRefresh
  fetchIssue: (
    repoPath: string,
    issueNumber: number,
    options: { repoId: string }
  ) => void | Promise<void>
  fetchLinearIssue: (issueId: string, scope: 'all') => void | Promise<void>
}

export function useWorktreeCardDecorationEffects({
  worktree,
  repo,
  branch,
  isFolder,
  newCardStyle,
  hoverDetailsOpen,
  shouldRefreshHostedReview,
  showIssue,
  showLinearIssue,
  hostedReviewCacheKey,
  issueCacheKey,
  cachedBranchFallbackGitHubPRNumber,
  linkedGitLabMR,
  linkedBitbucketPR,
  linkedAzureDevOpsPR,
  linkedGiteaPR,
  fetchHostedReviewForBranch,
  fetchIssue,
  fetchLinearIssue
}: WorktreeCardDecorationEffectsProps): void {
  useEffect(() => {
    if (
      isWebClient() ||
      !repo ||
      isFolder ||
      worktree.isBare ||
      !hostedReviewCacheKey ||
      !shouldRefreshHostedReview ||
      isMacAppDataPath(repo.path)
    ) {
      return
    }
    const refreshHostedReview = (): void => {
      void fetchHostedReviewForBranch(repo.path, branch, {
        repoId: repo.id,
        linkedGitHubPR: worktree.linkedPR ?? null,
        ...(cachedBranchFallbackGitHubPRNumber !== null
          ? { fallbackGitHubPR: cachedBranchFallbackGitHubPRNumber }
          : {}),
        currentHeadOid: worktree.head ?? null,
        linkedGitLabMR,
        linkedBitbucketPR,
        linkedAzureDevOpsPR,
        linkedGiteaPR,
        staleWhileRevalidate: true
      })
    }
    return installWindowVisibilityInterval({
      run: refreshHostedReview,
      intervalMs: HOSTED_REVIEW_CARD_REFRESH_INTERVAL_MS
    })
  }, [
    repo,
    isFolder,
    worktree.isBare,
    worktree.linkedPR,
    worktree.head,
    cachedBranchFallbackGitHubPRNumber,
    linkedGitLabMR,
    linkedBitbucketPR,
    linkedAzureDevOpsPR,
    linkedGiteaPR,
    fetchHostedReviewForBranch,
    branch,
    hostedReviewCacheKey,
    shouldRefreshHostedReview
  ])

  useEffect(() => {
    if (
      !newCardStyle ||
      !hoverDetailsOpen ||
      shouldRefreshHostedReview ||
      isWebClient() ||
      !repo ||
      isFolder ||
      worktree.isBare ||
      !hostedReviewCacheKey ||
      isMacAppDataPath(repo.path)
    ) {
      return
    }
    void fetchHostedReviewForBranch(repo.path, branch, {
      repoId: repo.id,
      linkedGitHubPR: worktree.linkedPR ?? null,
      ...(cachedBranchFallbackGitHubPRNumber !== null
        ? { fallbackGitHubPR: cachedBranchFallbackGitHubPRNumber }
        : {}),
      currentHeadOid: worktree.head ?? null,
      linkedGitLabMR,
      linkedBitbucketPR,
      linkedAzureDevOpsPR,
      linkedGiteaPR,
      staleWhileRevalidate: true
    })
  }, [
    hoverDetailsOpen,
    newCardStyle,
    shouldRefreshHostedReview,
    repo,
    isFolder,
    worktree.isBare,
    worktree.linkedPR,
    worktree.head,
    cachedBranchFallbackGitHubPRNumber,
    linkedGitLabMR,
    linkedBitbucketPR,
    linkedAzureDevOpsPR,
    linkedGiteaPR,
    fetchHostedReviewForBranch,
    branch,
    hostedReviewCacheKey
  ])

  useEffect(() => {
    if (
      isWebClient() ||
      !repo ||
      isFolder ||
      !worktree.linkedIssue ||
      !issueCacheKey ||
      !showIssue
    ) {
      return
    }
    return installWindowVisibilityInterval({
      run: () => void fetchIssue(repo.path, worktree.linkedIssue as number, { repoId: repo.id }),
      intervalMs: 5 * 60_000
    })
  }, [repo, isFolder, worktree.linkedIssue, fetchIssue, issueCacheKey, showIssue])

  useEffect(() => {
    if (
      !newCardStyle ||
      !hoverDetailsOpen ||
      showIssue ||
      isWebClient() ||
      !repo ||
      isFolder ||
      !worktree.linkedIssue ||
      !issueCacheKey
    ) {
      return
    }
    void fetchIssue(repo.path, worktree.linkedIssue, { repoId: repo.id })
  }, [
    newCardStyle,
    hoverDetailsOpen,
    showIssue,
    repo,
    isFolder,
    worktree.linkedIssue,
    fetchIssue,
    issueCacheKey
  ])

  useEffect(() => {
    if (!worktree.linkedLinearIssue || !showLinearIssue) {
      return
    }
    const refreshLinearIssueIfVisible = (): void => {
      if (!isWindowVisible()) {
        return
      }
      void fetchLinearIssue(worktree.linkedLinearIssue as string, 'all')
    }
    refreshLinearIssueIfVisible()
    window.addEventListener('focus', refreshLinearIssueIfVisible)
    document.addEventListener('visibilitychange', refreshLinearIssueIfVisible)
    return () => {
      window.removeEventListener('focus', refreshLinearIssueIfVisible)
      document.removeEventListener('visibilitychange', refreshLinearIssueIfVisible)
    }
  }, [worktree.linkedLinearIssue, fetchLinearIssue, showLinearIssue])

  useEffect(() => {
    if (!newCardStyle || !hoverDetailsOpen || showLinearIssue || !worktree.linkedLinearIssue) {
      return
    }
    void fetchLinearIssue(worktree.linkedLinearIssue, 'all')
  }, [
    newCardStyle,
    hoverDetailsOpen,
    showLinearIssue,
    worktree.linkedLinearIssue,
    fetchLinearIssue
  ])
}
