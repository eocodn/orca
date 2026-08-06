import { useCallback } from 'react'
import { isMacPlatform } from '../terminal-pane/terminal-link-open-hints'
import { openChecksPanelHostedReviewUrl } from './checks-panel-hosted-review-click-routing'
import { refreshHostedReviewCard } from '@/store/slices/hosted-review'
import type { ChecksPanelLinkKey } from './checks-panel-link-types'
import type { HostedReviewProvider } from '../../../../shared/hosted-review'
export function useChecksPanelLinkActions<T extends Record<string, unknown>>(context: T & { [K in ChecksPanelLinkKey]: K extends keyof T ? T[K] : never }): Record<string, unknown> {
  const {
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
    pushBranch,
    repo,
    setGitStatusRefreshNonce,
    setIsPublishingBranch,
    setIsSyncingBranch,
    setRightSidebarOpen,
    setRightSidebarTab,
    syncBranch,
    updateWorktreeMeta,
  } = context
// Open hosted review in browser
const handleOpenPR = useCallback(
  (event: React.MouseEvent<HTMLButtonElement>) => {
    if (activeReview?.url) {
      // Why: route through openHttpLink so PR/MR links honor the "open links in app" setting; Shift+Cmd/Ctrl is the escape hatch.
      openChecksPanelHostedReviewUrl({
        url: activeReview.url,
        event: event.nativeEvent,
        isMac: isMacPlatform(),
        worktreeId: activeWorktreeId
      })
    }
  },
  [activeReview, activeWorktreeId]
)

const handleUnlinkPullRequest = useCallback(() => {
  if (!activeWorktreeId || activeReview?.provider !== 'github' || linkedPR === null) {
    return
  }
  void updateWorktreeMeta(activeWorktreeId, { linkedPR: null })
}, [activeReview?.provider, activeWorktreeId, linkedPR, updateWorktreeMeta])

const handleLinkAnotherPullRequest = useCallback(() => {
  if (!activeWorktreeId || !activeWorktree || activeReview?.provider !== 'github') {
    return
  }
  openModal('edit-meta', {
    worktreeId: activeWorktreeId,
    currentDisplayName: activeWorktree.displayName,
    currentIssue: activeWorktree.linkedIssue,
    currentPR: activeWorktree.linkedPR ?? activeReview.number,
    currentComment: activeWorktree.comment,
    focus: 'pr',
    afterSave: ({ updates }: { updates?: { linkedPR?: unknown } }) => {
      const nextLinkedPR = updates?.linkedPR
      if (typeof nextLinkedPR === 'number') {
        void refreshLinkedGitHubPullRequest(nextLinkedPR)
      }
    }
  })
}, [activeReview, activeWorktree, activeWorktreeId, openModal, refreshLinkedGitHubPullRequest])

const pushBeforeCreatePullRequest = useCallback(async (): Promise<boolean> => {
  if (!activeWorktreeId || !activeWorktree?.path) {
    return false
  }
  const connectionId = activeConnectionId ?? undefined
  try {
    await pushBranch(
      activeWorktreeId,
      activeWorktree.path,
      false,
      connectionId,
      activeWorktree.pushTarget,
      { runtimeTargetSettings: ownerSettings }
    )
    await fetchUpstreamStatus(activeWorktreeId, activeWorktree.path, connectionId, undefined, {
      runtimeTargetSettings: ownerSettings
    })
    return true
  } catch {
    return false
  }
}, [
  activeConnectionId,
  activeWorktree,
  activeWorktreeId,
  fetchUpstreamStatus,
  ownerSettings,
  pushBranch
])

const handlePublishBranch = useCallback(async (): Promise<void> => {
  if (
    !activeWorktreeId ||
    !activeWorktree?.path ||
    isPublishingBranch ||
    isRemoteOperationActive
  ) {
    return
  }
  const connectionId = activeConnectionId ?? undefined
  setIsPublishingBranch(true)
  try {
    await pushBranch(
      activeWorktreeId,
      activeWorktree.path,
      true,
      connectionId,
      activeWorktree.pushTarget,
      { runtimeTargetSettings: ownerSettings }
    )
    await fetchUpstreamStatus(
      activeWorktreeId,
      activeWorktree.path,
      connectionId,
      activeWorktree.pushTarget,
      { runtimeTargetSettings: ownerSettings }
    )
  } catch {
    // Store remote actions already surface the publish failure toast.
  } finally {
    // Why: publishing changes the upstream boundary the panel uses to decide between Publish, Create PR, and Push & Create PR.
    setGitStatusRefreshNonce((value) => value + 1)
    setIsPublishingBranch(false)
  }
}, [
  activeWorktree,
  activeWorktreeId,
  activeConnectionId,
  fetchUpstreamStatus,
  isPublishingBranch,
  isRemoteOperationActive,
  ownerSettings,
  pushBranch
])

// Sync via the same runtime-scoped operation and push target as Source Control so a `needs_sync` create blocker is actionable here.
const handleSyncBranch = useCallback(async (): Promise<void> => {
  if (!activeWorktreeId || !activeWorktree?.path || isSyncingBranch || isRemoteOperationActive) {
    return
  }
  const connectionId = activeConnectionId ?? undefined
  setIsSyncingBranch(true)
  try {
    await syncBranch(
      activeWorktreeId,
      activeWorktree.path,
      connectionId,
      activeWorktree.pushTarget,
      {
        runtimeTargetSettings: ownerSettings
      }
    )
    await fetchUpstreamStatus(
      activeWorktreeId,
      activeWorktree.path,
      connectionId,
      activeWorktree.pushTarget,
      { runtimeTargetSettings: ownerSettings }
    )
  } catch {
    // Store remote actions already surface the sync failure toast.
  } finally {
    // Why: syncing changes ahead/behind, which the panel uses to choose between Sync, Create PR, and Push & Create PR.
    setGitStatusRefreshNonce((value) => value + 1)
    setIsSyncingBranch(false)
  }
}, [
  activeWorktree,
  activeWorktreeId,
  activeConnectionId,
  fetchUpstreamStatus,
  isSyncingBranch,
  isRemoteOperationActive,
  ownerSettings,
  syncBranch
])

const handlePullRequestCreated = useCallback(
  async (result: {
    provider: HostedReviewProvider
    number: number
    url: string
  }): Promise<void> => {
    if (!repo || !branch) {
      return
    }
    setRightSidebarOpen(true)
    setRightSidebarTab('checks')
    try {
      if (activeWorktreeId && result.provider === 'github') {
        await updateWorktreeMeta(activeWorktreeId, { linkedPR: result.number })
      }
      if (activeWorktreeId && result.provider === 'gitlab') {
        await updateWorktreeMeta(activeWorktreeId, { linkedGitLabMR: result.number })
      }
      if (activeWorktreeId && result.provider === 'azure-devops') {
        await updateWorktreeMeta(activeWorktreeId, { linkedAzureDevOpsPR: result.number })
      }
      if (activeWorktreeId && result.provider === 'gitea') {
        await updateWorktreeMeta(activeWorktreeId, { linkedGiteaPR: result.number })
      }
      const linkedReviewNumbers = {
        linkedGitHubPR: result.provider === 'github' ? result.number : linkedPR,
        fallbackGitHubPR: fallbackGitHubPRNumber,
        linkedGitLabMR: result.provider === 'gitlab' ? result.number : linkedGitLabMR,
        linkedBitbucketPR,
        linkedAzureDevOpsPR:
          result.provider === 'azure-devops' ? result.number : linkedAzureDevOpsPR,
        linkedGiteaPR: result.provider === 'gitea' ? result.number : linkedGiteaPR
      }
      if (result.provider === 'gitlab') {
        const refreshedReview = await refreshHostedReviewCard(fetchHostedReviewForBranch, {
          repoPath: repo.path,
          repoId: repo.id,
          branch,
          ...linkedReviewNumbers
        })
        const refreshedGitLabReview =
          refreshedReview?.provider === 'gitlab' ? refreshedReview : null
        await fetchGitLabDetails({
          mrNumberOverride: result.number,
          headShaOverride: refreshedGitLabReview?.headSha,
          commitAsCurrent: true
        })
        return
      }
      if (result.provider !== 'github') {
        await refreshHostedReviewCard(fetchHostedReviewForBranch, {
          repoPath: repo.path,
          repoId: repo.id,
          branch,
          ...linkedReviewNumbers
        })
        return
      }
      await refreshLinkedGitHubPullRequest(result.number)
    } catch {
      // The success toast keeps the hosted URL available; Checks can be refreshed manually.
    }
  },
  [
    branch,
    fallbackGitHubPRNumber,
    fetchGitLabDetails,
    fetchHostedReviewForBranch,
    linkedAzureDevOpsPR,
    linkedBitbucketPR,
    linkedGiteaPR,
    linkedGitLabMR,
    linkedPR,
    refreshLinkedGitHubPullRequest,
    repo,
    setRightSidebarOpen,
    setRightSidebarTab,
    activeWorktreeId,
    updateWorktreeMeta
  ]
)

  return { handleOpenPR, handleUnlinkPullRequest, handleLinkAnotherPullRequest, pushBeforeCreatePullRequest, handlePublishBranch, handleSyncBranch, handlePullRequestCreated }
}
