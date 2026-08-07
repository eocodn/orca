import React from 'react'
import { useAppStore } from '@/store'
import { getHostedReviewCacheKey } from '@/store/slices/hosted-review'
import { issueCacheKey as getIssueCacheKey } from '@/store/slices/github'
import { getGitHubPRCacheKey } from '@/store/slices/github-cache-key'
import { isFolderRepo } from '../../../../shared/repo-kind'
import type { HostedReviewInfo } from '../../../../shared/hosted-review'
import { hostedReviewInfoFromGitHubPRInfo } from '../../../../shared/hosted-review-github'
import type {
  IssueInfo,
  LinearIssue,
  Repo,
  Worktree,
  WorktreeCardProperty
} from '../../../../shared/types'
import type { WorktreeCardIssueDisplay } from './WorktreeCardMeta'
import {
  getWorktreeCardPrDisplay,
  isCachedMergedBranchPRCurrentForWorktree
} from './worktree-card-pr-display'
import {
  coerceWorktreeCardVisibleTitle,
  getWorktreeCardTitleDisplay
} from './worktree-card-title-display'
import { getWorktreeCardJiraIssueDisplay } from './worktree-card-jira-issue-display'
import { getWorktreeGitIdentityDisplay } from '@/lib/worktree-git-identity-display'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'

export function useWorktreeCardMetadata({
  worktree,
  repo,
  settings,
  cardProps,
  projectGroups,
  newCardStyle
}: {
  worktree: Worktree
  repo: Repo | undefined
  settings: Parameters<typeof getHostedReviewCacheKey>[2]
  cardProps: readonly WorktreeCardProperty[]
  projectGroups: readonly unknown[]
  newCardStyle: boolean
}) {
  const gitIdentityDisplay = getWorktreeGitIdentityDisplay(worktree)
  const detachedHeadDisplay = gitIdentityDisplay?.kind === 'detached' ? gitIdentityDisplay : null
  const branch = gitIdentityDisplay?.kind === 'branch' ? gitIdentityDisplay.branchName : ''
  const workspaceScope = parseWorkspaceKey(worktree.id)
  const folderWorkspaceId =
    workspaceScope?.type === 'folder' ? workspaceScope.folderWorkspaceId : null
  const isFolder = repo ? isFolderRepo(repo) : folderWorkspaceId !== null
  // Why: project groups gate folder workspaces, so folder paths stay hidden from identity surfaces until that capability exists.
  const hasProjectGroups = projectGroups.length > 0
  const branchIdentityDisplay = !isFolder && branch.length > 0 ? branch : undefined
  const folderPathIdentityDisplay =
    isFolder && hasProjectGroups && worktree.path.trim().length > 0 ? worktree.path : undefined
  const identityDisplay = branchIdentityDisplay ?? folderPathIdentityDisplay
  const hasPathIdentityEnabled = cardProps.includes('branch')
  const showIdentityInNewCard = newCardStyle && hasPathIdentityEnabled && Boolean(identityDisplay)
  const folderMetaRowContent = newCardStyle
    ? hasPathIdentityEnabled && Boolean(folderPathIdentityDisplay)
    : isFolder
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
  const issueCacheKey =
    repo && worktree.linkedIssue
      ? getIssueCacheKey(
          repo.path,
          repo.id,
          worktree.linkedIssue,
          settings,
          repo.connectionId,
          repo.executionHostId,
          true
        )
      : ''
  // Why: use 'all' — the issue may belong to a different Linear workspace than the selected one.
  const linearIssueCacheKey = worktree.linkedLinearIssue ? `all::${worktree.linkedLinearIssue}` : ''

  // Subscribe to ONLY the specific cache entry, not entire review/issue caches.
  const hostedReviewEntry = useAppStore((s) =>
    hostedReviewCacheKey ? s.hostedReviewCache[hostedReviewCacheKey] : undefined
  )
  const prCacheEntry = useAppStore((s) => (prCacheKey ? s.prCache?.[prCacheKey] : undefined))
  const issueEntry = useAppStore((s) => (issueCacheKey ? s.issueCache[issueCacheKey] : undefined))
  const linearIssueEntry = useAppStore((s) =>
    linearIssueCacheKey ? s.linearIssueCache[linearIssueCacheKey] : undefined
  )
  const linearIssueFallbackEntry = useAppStore((s) =>
    worktree.linkedLinearIssue ? s.linearIssueCache[worktree.linkedLinearIssue] : undefined
  )

  const hostedReview: HostedReviewInfo | null | undefined =
    hostedReviewEntry !== undefined ? hostedReviewEntry.data : undefined
  const linkedGitHubPR = worktree.linkedPR ?? null
  const linkedGitLabMR = worktree.linkedGitLabMR ?? null
  const linkedBitbucketPR = worktree.linkedBitbucketPR ?? null
  const linkedAzureDevOpsPR = worktree.linkedAzureDevOpsPR ?? null
  const linkedGiteaPR = worktree.linkedGiteaPR ?? null
  const hasNonGitHubLinkedReview =
    linkedGitLabMR !== null ||
    linkedBitbucketPR !== null ||
    linkedAzureDevOpsPR !== null ||
    linkedGiteaPR !== null
  const hasLinkedReview =
    linkedGitHubPR !== null ||
    linkedGitLabMR !== null ||
    linkedBitbucketPR !== null ||
    linkedAzureDevOpsPR !== null ||
    linkedGiteaPR !== null
  // Why: a newer hosted-review miss trusts the merged-PR cache only when the stored head proves it still describes the current commit.
  const cachedBranchPR = prCacheEntry?.data
  const cachedBranchPRFetchedAt = prCacheEntry?.fetchedAt
  const cachedMergedBranchPRMatchesCurrentHead = isCachedMergedBranchPRCurrentForWorktree(
    cachedBranchPR,
    worktree
  )
  const cachedBranchFallbackGitHubPRNumber =
    linkedGitHubPR === null &&
    !hasNonGitHubLinkedReview &&
    cachedBranchPR?.number !== undefined &&
    (cachedBranchPR.state !== 'merged' || cachedMergedBranchPRMatchesCurrentHead)
      ? cachedBranchPR.number
      : null
  const cachedBranchPRCanDriveDisplay =
    cachedBranchPR?.state !== 'merged' || cachedMergedBranchPRMatchesCurrentHead
  const hostedReviewMatchesHeadMatchedCachedMergedPR =
    cachedMergedBranchPRMatchesCurrentHead &&
    cachedBranchPR !== null &&
    cachedBranchPR !== undefined &&
    hostedReview?.provider === 'github' &&
    hostedReview.number === cachedBranchPR.number
  const useCachedBranchReview =
    cachedBranchPR !== undefined &&
    cachedBranchPR !== null &&
    !hasNonGitHubLinkedReview &&
    cachedBranchPRCanDriveDisplay &&
    (hostedReview === undefined ||
      (cachedMergedBranchPRMatchesCurrentHead && !hostedReviewMatchesHeadMatchedCachedMergedPR) ||
      (hostedReview === null &&
        ((cachedBranchPRFetchedAt !== undefined &&
          cachedBranchPRFetchedAt > (hostedReviewEntry?.fetchedAt ?? 0)) ||
          cachedMergedBranchPRMatchesCurrentHead)))
  const cachedBranchReview = useCachedBranchReview
    ? hostedReviewInfoFromGitHubPRInfo(cachedBranchPR)
    : hostedReview
  // Why: branch provenance does not supersede the head-ownership gate for merged PRs.
  const branchLookupGitHubPRNumber =
    hostedReview?.provider === 'github' &&
    hostedReview.state === 'merged' &&
    !isCachedMergedBranchPRCurrentForWorktree(hostedReview, worktree)
      ? null
      : hostedReviewEntry?.branchLookupGitHubPRNumber
  const prDisplay = getWorktreeCardPrDisplay(
    cachedBranchReview,
    linkedGitHubPR,
    linkedGitLabMR,
    linkedBitbucketPR,
    linkedAzureDevOpsPR,
    linkedGiteaPR,
    {
      reviewHintKey:
        (useCachedBranchReview || cachedMergedBranchPRMatchesCurrentHead) && !hasLinkedReview
          ? ''
          : hostedReviewEntry?.linkedReviewHintKey,
      branchLookupGitHubPRNumber
    }
  )
  const issue: IssueInfo | null | undefined = worktree.linkedIssue
    ? issueEntry !== undefined
      ? issueEntry.data
      : undefined
    : null
  const issueDisplay: WorktreeCardIssueDisplay | null =
    issue ??
    (worktree.linkedIssue
      ? {
          number: worktree.linkedIssue,
          // Why: linked metadata persists immediately but GitHub details arrive async; show the link number so it doesn't look unlinked.
          title: issue === null ? 'Issue details unavailable' : 'Loading issue...'
        }
      : null)
  const linearStatus = useAppStore((s) => s.linearStatus)
  const linearIssue: LinearIssue | null | undefined = worktree.linkedLinearIssue
    ? (linearIssueEntry?.data ?? linearIssueFallbackEntry?.data)
    : null

  // Why: build a fallback Linear URL from org key + identifier while full issue data is still loading, so the link stays navigable.
  const linearOrgUrlKey = linearStatus?.viewer?.organizationUrlKey
  const linearWorkspaceUrlKeys = linearStatus?.workspaces?.map((ws) => ({
    id: ws.id,
    organizationUrlKey: ws.organizationUrlKey
  }))
  const linearIssueUrlFallback = React.useMemo(() => {
    if (!worktree.linkedLinearIssue || linearIssue?.url) {
      return undefined
    }

    // Try to get the orgUrlKey from the issue's workspace if we have workspaceId
    let orgUrlKey: string | undefined
    if (linearIssue?.workspaceId && linearWorkspaceUrlKeys) {
      const issueWorkspace = linearWorkspaceUrlKeys.find((ws) => ws.id === linearIssue.workspaceId)
      orgUrlKey = issueWorkspace?.organizationUrlKey
    }

    // Fall back to current viewer's org if no workspace match
    if (!orgUrlKey) {
      orgUrlKey = linearOrgUrlKey
    }

    if (!orgUrlKey) {
      return undefined
    }

    return `https://linear.app/${encodeURIComponent(orgUrlKey)}/issue/${encodeURIComponent(worktree.linkedLinearIssue)}`
  }, [
    worktree.linkedLinearIssue,
    linearIssue?.url,
    linearIssue?.workspaceId,
    linearOrgUrlKey,
    linearWorkspaceUrlKeys
  ])

  const linearIssueDisplay = worktree.linkedLinearIssue
    ? linearIssue
      ? {
          identifier: linearIssue.identifier,
          title: linearIssue.title,
          url: linearIssue.url,
          stateName: linearIssue.state?.name,
          labels: linearIssue.labels
        }
      : {
          identifier: worktree.linkedLinearIssue,
          title:
            linearIssueEntry || linearIssueFallbackEntry
              ? 'Linear issue details unavailable'
              : 'Loading Linear issue...',
          url: linearIssueUrlFallback
        }
    : null
  const jiraIssueDisplay = getWorktreeCardJiraIssueDisplay(worktree)
  const cardTitleDisplay = getWorktreeCardTitleDisplay({
    storedDisplayName: worktree.displayName,
    branchName: branch,
    linearIssueTitle: linearIssueDisplay?.title,
    jiraIssueTitle: jiraIssueDisplay?.title,
    issueTitle: issueDisplay?.title,
    reviewTitle: prDisplay?.title
  })
  const legacyCardTitleDisplay = coerceWorktreeCardVisibleTitle(worktree.displayName)
  const visibleCardTitle = newCardStyle ? cardTitleDisplay : legacyCardTitleDisplay
  return {
    gitIdentityDisplay,
    detachedHeadDisplay,
    branch,
    folderWorkspaceId,
    isFolder,
    branchIdentityDisplay,
    folderPathIdentityDisplay,
    identityDisplay,
    hasPathIdentityEnabled,
    showIdentityInNewCard,
    folderMetaRowContent,
    hostedReviewCacheKey,
    prCacheKey,
    issueCacheKey,
    linearIssueCacheKey,
    hostedReviewEntry,
    prCacheEntry,
    issueEntry,
    linearIssueEntry,
    linearIssueFallbackEntry,
    hostedReview,
    linkedGitHubPR,
    linkedGitLabMR,
    linkedBitbucketPR,
    linkedAzureDevOpsPR,
    linkedGiteaPR,
    hasNonGitHubLinkedReview,
    hasLinkedReview,
    cachedBranchPR,
    cachedBranchPRFetchedAt,
    cachedMergedBranchPRMatchesCurrentHead,
    cachedBranchFallbackGitHubPRNumber,
    cachedBranchPRCanDriveDisplay,
    hostedReviewMatchesHeadMatchedCachedMergedPR,
    useCachedBranchReview,
    cachedBranchReview,
    branchLookupGitHubPRNumber,
    prDisplay,
    issue,
    issueDisplay,
    linearStatus,
    linearIssue,
    linearIssueUrlFallback,
    linearIssueDisplay,
    jiraIssueDisplay,
    cardTitleDisplay,
    visibleCardTitle
  }
}
