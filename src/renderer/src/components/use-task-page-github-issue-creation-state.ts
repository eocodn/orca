import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { toast } from 'sonner'

import { translate } from '@/i18n/i18n'
import { callRuntimeRpc, type RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import type { AppState } from '@/store'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { GitHubAssignableUser, GitHubWorkItem, Repo } from '../../../shared/types'

type TaskPageGitHubIssueCreationStateProps = {
  clearNewIssueDraft: AppState['clearNewIssueDraft']
  newIssueAssignees: GitHubAssignableUser[]
  newIssueBody: string
  newIssueLabels: string[]
  newIssueRuntimeTarget: RuntimeClientTarget | null
  newIssueSourceContext: TaskSourceContext | null
  newIssueSubmitting: boolean
  newIssueTargetRepo: Repo | null
  newIssueTitle: string
  openGitHubDetailPage: (item: GitHubWorkItem) => void
  setDialogWorkItem: (item: GitHubWorkItem | null) => void
  setNewIssueAssignees: Dispatch<SetStateAction<GitHubAssignableUser[]>>
  setNewIssueBody: Dispatch<SetStateAction<string>>
  setNewIssueDraft: AppState['setNewIssueDraft']
  setNewIssueLabels: Dispatch<SetStateAction<string[]>>
  setNewIssueOpen: Dispatch<SetStateAction<boolean>>
  setNewIssueSubmitting: Dispatch<SetStateAction<boolean>>
  setNewIssueTitle: Dispatch<SetStateAction<string>>
  setTaskRefreshNonce: Dispatch<SetStateAction<number>>
}

export function useTaskPageGitHubIssueCreationState({
  clearNewIssueDraft,
  newIssueAssignees,
  newIssueBody,
  newIssueLabels,
  newIssueRuntimeTarget,
  newIssueSourceContext,
  newIssueSubmitting,
  newIssueTargetRepo,
  newIssueTitle,
  openGitHubDetailPage,
  setDialogWorkItem,
  setNewIssueAssignees,
  setNewIssueBody,
  setNewIssueDraft,
  setNewIssueLabels,
  setNewIssueOpen,
  setNewIssueSubmitting,
  setNewIssueTitle,
  setTaskRefreshNonce
}: TaskPageGitHubIssueCreationStateProps) {
  return useCallback(async (): Promise<void> => {
    if (!newIssueTargetRepo) {
      return
    }
    const title = newIssueTitle.trim()
    if (!title || newIssueSubmitting) {
      return
    }
    setNewIssueSubmitting(true)
    try {
      const result = newIssueRuntimeTarget
        ? await callRuntimeRpc<Awaited<ReturnType<typeof window.api.gh.createIssue>>>(
            newIssueRuntimeTarget,
            'github.createIssue',
            {
              repo:
                newIssueSourceContext?.provider === 'github'
                  ? (newIssueSourceContext.repoId ?? newIssueTargetRepo.id)
                  : newIssueTargetRepo.id,
              title,
              body: newIssueBody,
              labels: newIssueLabels,
              assignees: newIssueAssignees.map((assignee) => assignee.login)
            },
            { timeoutMs: 65_000 }
          )
        : await window.api.gh.createIssue({
            repoPath: newIssueTargetRepo.path,
            repoId: newIssueTargetRepo.id,
            sourceContext: newIssueSourceContext,
            title,
            body: newIssueBody,
            labels: newIssueLabels,
            assignees: newIssueAssignees.map((assignee) => assignee.login)
          })
      if (!result.ok) {
        toast.error(
          result.error ||
            translate('auto.components.TaskPage.7437e340b4', 'Failed to create issue.')
        )
        return
      }
      const createdIssueToast = translate(
        'auto.components.TaskPage.3f9604efc7',
        'Opened issue #{{value0}}',
        { value0: result.number }
      )
      const createdIssueToastOptions = {
        action: result.url
          ? {
              label: translate('auto.components.TaskPage.9c57663908', 'View'),
              onClick: () => window.open(result.url, '_blank')
            }
          : undefined
      }
      if (result.bodySaveWarning) {
        toast.warning(createdIssueToast, {
          ...createdIssueToastOptions,
          description: result.bodySaveWarning
        })
      } else {
        toast.success(createdIssueToast, createdIssueToastOptions)
      }
      setNewIssueOpen(false)
      if (result.bodySaveWarning) {
        // Why: preserve the body for recovery but clear the title so reopening cannot repeat the create.
        setNewIssueTitle('')
        setNewIssueDraft({ title: '' })
      } else {
        setNewIssueTitle('')
        setNewIssueBody('')
        setNewIssueLabels([])
        setNewIssueAssignees([])
        clearNewIssueDraft()
      }
      // Why: refresh the list so the created issue is visible immediately.
      setTaskRefreshNonce((current) => current + 1)

      const stub: GitHubWorkItem = {
        id: `issue:${String(result.number)}`,
        repoId: newIssueTargetRepo.id,
        type: 'issue',
        number: result.number,
        title,
        state: 'open',
        url: result.url,
        labels: newIssueLabels,
        assignees: newIssueAssignees,
        updatedAt: new Date().toISOString(),
        author: null
      }
      openGitHubDetailPage(stub)
      const stubRepoId = newIssueTargetRepo.id
      const fullIssuePromise = newIssueRuntimeTarget
        ? callRuntimeRpc<Awaited<ReturnType<typeof window.api.gh.workItem>>>(
            newIssueRuntimeTarget,
            'github.workItem',
            {
              repo:
                newIssueSourceContext?.provider === 'github'
                  ? (newIssueSourceContext.repoId ?? newIssueTargetRepo.id)
                  : newIssueTargetRepo.id,
              number: result.number,
              type: 'issue'
            },
            { timeoutMs: 30_000 }
          )
        : window.api.gh.workItem({
            repoPath: newIssueTargetRepo.path,
            repoId: newIssueTargetRepo.id,
            sourceContext: newIssueSourceContext,
            number: result.number,
            type: 'issue'
          })
      void fullIssuePromise
        .then((full) => {
          if (full) {
            const withRepoId = { ...full, repoId: stubRepoId } as unknown as GitHubWorkItem
            setDialogWorkItem(withRepoId)
          }
        })
        .catch(() => {})
    } finally {
      setNewIssueSubmitting(false)
    }
  }, [
    clearNewIssueDraft,
    newIssueAssignees,
    newIssueBody,
    newIssueLabels,
    newIssueRuntimeTarget,
    newIssueSourceContext,
    newIssueSubmitting,
    newIssueTargetRepo,
    newIssueTitle,
    openGitHubDetailPage,
    setDialogWorkItem,
    setNewIssueAssignees,
    setNewIssueBody,
    setNewIssueDraft,
    setNewIssueLabels,
    setNewIssueOpen,
    setNewIssueSubmitting,
    setNewIssueTitle,
    setTaskRefreshNonce
  ])
}
