import { useCallback } from 'react'
import { useAppStore } from '@/store'
import type React from 'react'
import type { GitHubWorkItem } from '../../../../shared/types'
import type { WorktreeCardRuntime } from './worktree-card-runtime-types'

export function useWorktreeCardReviewActions(
  worktree: { id: string; hostId?: string; automationProvenance?: unknown },
  repo: { id: string } | undefined,
  runtime: WorktreeCardRuntime
) {
  const openTaskPage = useAppStore((s) => s.openTaskPage)
  const updateWorktreeMeta = useAppStore((s) => s.updateWorktreeMeta)
  const handleOpenGitHubIssueInOrca = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      const issue = runtime.metadata.issueDisplay
      const issueUrl = issue && 'url' in issue ? issue.url : undefined
      if (!repo || !issue || !issueUrl) {
        return
      }
      const item: GitHubWorkItem = {
        id: issueUrl,
        type: 'issue',
        number: issue.number,
        title: issue.title,
        state: 'state' in issue ? (issue.state ?? 'open') : 'open',
        url: issueUrl,
        labels: 'labels' in issue ? (issue.labels ?? []) : [],
        updatedAt: new Date().toISOString(),
        author: null,
        repoId: repo.id
      }
      openTaskPage({ taskSource: 'github', preselectedRepoId: repo.id, openGitHubWorkItem: item })
    },
    [openTaskPage, repo, runtime.metadata.issueDisplay]
  )
  const handleOpenReviewInOrca = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      const review = runtime.metadata.prDisplay
      if (!repo || !review?.url || review.provider !== 'github') {
        return
      }
      const item: GitHubWorkItem = {
        id: review.url,
        type: 'pr',
        number: review.number,
        title: review.title,
        state: review.state ?? 'open',
        url: review.url,
        labels: [],
        updatedAt: 'updatedAt' in review ? review.updatedAt : new Date().toISOString(),
        author: null,
        headSha: 'headSha' in review ? review.headSha : undefined,
        repoId: repo.id
      }
      openTaskPage({ taskSource: 'github', preselectedRepoId: repo.id, openGitHubWorkItem: item })
    },
    [openTaskPage, repo, runtime.metadata.prDisplay]
  )
  const handleUnlinkReview = useCallback(() => {
    const provider = runtime.metadata.prDisplay?.provider
    const fields = {
      github: 'linkedPR',
      gitlab: 'linkedGitLabMR',
      bitbucket: 'linkedBitbucketPR',
      'azure-devops': 'linkedAzureDevOpsPR',
      gitea: 'linkedGiteaPR'
    } as const
    const field = provider ? fields[provider as keyof typeof fields] : undefined
    if (field) {
      void updateWorktreeMeta(worktree.id, { [field]: null })
    }
  }, [runtime.metadata.prDisplay?.provider, updateWorktreeMeta, worktree.id])
  const handleOpenLinearIssueInOrca = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      if (runtime.metadata.linearIssue) {
        openTaskPage({ taskSource: 'linear', openLinearIssue: runtime.metadata.linearIssue })
      }
    },
    [openTaskPage, runtime.metadata.linearIssue]
  )
  return {
    handleOpenGitHubIssueInOrca,
    handleOpenReviewInOrca,
    handleUnlinkReview,
    handleOpenLinearIssueInOrca
  }
}
