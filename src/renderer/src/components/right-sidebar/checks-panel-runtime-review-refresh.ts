import { useCallback } from 'react'
import type { ChecksPanelReview } from './checks-panel-review'
import { refreshHostedReviewCard } from '@/store/slices/hosted-review'
import type { AppState } from '@/store'

type GitLabReview = ChecksPanelReview & { provider: 'gitlab' }

export function useChecksPanelReviewRefresh(args: {
  activeGitLabReview: GitLabReview | null
  activeReview: ChecksPanelReview | null
  activeWorktreeId: string | null
  branch: string
  fallbackGitHubPRNumber: number | null
  fetchGitLabDetails: (options?: {
    mrNumberOverride?: number | null
    headShaOverride?: string | null
    commitAsCurrent?: boolean
  }) => Promise<void>
  fetchHostedReviewForBranch: AppState['fetchHostedReviewForBranch']
  fetchPRForBranch: AppState['fetchPRForBranch']
  linkedAzureDevOpsPR: number | null
  linkedBitbucketPR: number | null
  linkedGiteaPR: number | null
  linkedGitLabMR: number | null
  linkedPR: number | null
  repo: { id: string; path: string } | null
}): () => Promise<void> {
  const {
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
  } = args
  return useCallback(async () => {
    if (!repo || !branch) {
      return
    }
    if (activeReview?.provider === 'gitlab') {
      const refreshedReview = await refreshHostedReviewCard(fetchHostedReviewForBranch, {
        repoPath: repo.path,
        repoId: repo.id,
        branch,
        linkedGitHubPR: linkedPR,
        fallbackGitHubPR: fallbackGitHubPRNumber,
        linkedGitLabMR,
        linkedBitbucketPR,
        linkedAzureDevOpsPR,
        linkedGiteaPR
      })
      const refreshedGitLabReview =
        refreshedReview?.provider === 'gitlab' ? refreshedReview : activeGitLabReview
      if (refreshedGitLabReview) {
        await fetchGitLabDetails({
          mrNumberOverride: refreshedGitLabReview.number,
          headShaOverride: refreshedGitLabReview.headSha,
          commitAsCurrent: true
        })
      }
      return
    }
    const refreshedPR = await fetchPRForBranch(repo.path, branch, {
      force: true,
      repoId: repo.id,
      worktreeId: activeWorktreeId ?? undefined,
      linkedPRNumber: linkedPR,
      fallbackPRNumber: fallbackGitHubPRNumber
    })
    await refreshHostedReviewCard(fetchHostedReviewForBranch, {
      repoPath: repo.path,
      repoId: repo.id,
      branch,
      linkedGitHubPR: linkedPR,
      fallbackGitHubPR: refreshedPR?.number ?? fallbackGitHubPRNumber,
      linkedGitLabMR,
      linkedBitbucketPR,
      linkedAzureDevOpsPR,
      linkedGiteaPR
    })
  }, [
    activeGitLabReview,
    activeReview?.provider,
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
  ])
}
