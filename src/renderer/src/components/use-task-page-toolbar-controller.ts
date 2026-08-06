import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { toast } from 'sonner'

import { translate } from '@/i18n/i18n'
import { useAppStore, type AppState } from '@/store'
import type { Repo } from '../../../shared/types'
import type { GitHubAssignableUser } from '../../../shared/types'
import type { TaskProvider } from '../../../shared/task-providers'
import type { GitLabIssueFilter, GitLabTaskFilter } from './task-page-localized-options'
import { normalizeTaskRepoSelection } from './task-page-default-repo-selection'
import { resolveNewIssueOpenSeed } from './task-page-new-issue-draft'

type Props = {
  eligibleRepos: Repo[]
  taskPickerRepos: Repo[]
  selectedRepos: Repo[]
  setRepoSelection: Dispatch<SetStateAction<ReadonlySet<string>>>
  updateSettings: AppState['updateSettings']
  openTaskPage: AppState['openTaskPage']
  taskSourceManuallyChangedRef: MutableRefObject<boolean>
  setGitlabFilter: (filter: GitLabIssueFilter | GitLabTaskFilter) => void
  setGitlabRefreshNonce: Dispatch<SetStateAction<number>>
  setNewIssueTitle: Dispatch<SetStateAction<string>>
  setNewIssueBody: Dispatch<SetStateAction<string>>
  setNewIssueLabels: Dispatch<SetStateAction<string[]>>
  setNewIssueAssignees: Dispatch<SetStateAction<GitHubAssignableUser[]>>
  setNewIssueRepoId: Dispatch<SetStateAction<string | null>>
  setNewIssueOpen: Dispatch<SetStateAction<boolean>>
}

export function useTaskPageToolbarController({
  eligibleRepos,
  taskPickerRepos,
  selectedRepos,
  setRepoSelection,
  updateSettings,
  openTaskPage,
  taskSourceManuallyChangedRef,
  setGitlabFilter,
  setGitlabRefreshNonce,
  setNewIssueTitle,
  setNewIssueBody,
  setNewIssueLabels,
  setNewIssueAssignees,
  setNewIssueRepoId,
  setNewIssueOpen
}: Props) {
  const handleGitlabFilterChange = useCallback(
    (filter: GitLabIssueFilter | GitLabTaskFilter) => {
      setGitlabFilter(filter)
      setGitlabRefreshNonce((current) => current + 1)
    },
    [setGitlabFilter, setGitlabRefreshNonce]
  )
  const handleTaskRepoSelectionChange = useCallback(
    (next: ReadonlySet<string>) => {
      const normalized = normalizeTaskRepoSelection(eligibleRepos, next)
      setRepoSelection(normalized)
      void updateSettings({ defaultRepoSelection: [...normalized] }).catch(() => {
        toast.error(
          translate('auto.components.TaskPage.dfd72673e7', 'Failed to save project selection.')
        )
      })
    },
    [eligibleRepos, setRepoSelection, updateSettings]
  )
  const handleTaskSelectAll = useCallback(() => {
    setRepoSelection(new Set(taskPickerRepos.map((repo) => repo.id)))
    void updateSettings({ defaultRepoSelection: null }).catch(() => {
      toast.error(
        translate('auto.components.TaskPage.dfd72673e7', 'Failed to save project selection.')
      )
    })
  }, [setRepoSelection, taskPickerRepos, updateSettings])
  const handleCreateGithubIssueFromToolbar = useCallback(() => {
    const seed = resolveNewIssueOpenSeed({
      draft: useAppStore.getState().newIssueDraft,
      selectedRepoIds: selectedRepos.map((repo) => repo.id)
    })
    setNewIssueTitle(seed.title)
    setNewIssueBody(seed.body)
    setNewIssueLabels(seed.labels)
    setNewIssueAssignees(seed.assignees)
    setNewIssueRepoId(seed.repoId)
    setNewIssueOpen(true)
  }, [
    selectedRepos,
    setNewIssueAssignees,
    setNewIssueBody,
    setNewIssueLabels,
    setNewIssueOpen,
    setNewIssueRepoId,
    setNewIssueTitle
  ])
  const handleTaskSourceChange = useCallback(
    (nextSource: TaskProvider): void => {
      taskSourceManuallyChangedRef.current = true
      openTaskPage({ taskSource: nextSource }, { recordTasksInteraction: false })
      void updateSettings({ defaultTaskSource: nextSource }).catch(() => {
        toast.error(
          translate('auto.components.TaskPage.609532fae7', 'Failed to save default task source.')
        )
      })
    },
    [openTaskPage, taskSourceManuallyChangedRef, updateSettings]
  )

  return {
    handleGitlabFilterChange,
    handleTaskRepoSelectionChange,
    handleTaskSelectAll,
    handleCreateGithubIssueFromToolbar,
    handleTaskSourceChange
  }
}
