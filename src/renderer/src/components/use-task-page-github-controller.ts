import type { MutableRefObject } from 'react'

import type { TaskPageSourceSelection } from './use-task-page-source-selection'
import type { TaskPageStoreBindings } from './use-task-page-store-bindings'
import { useTaskPageGitHubListModel } from './use-task-page-github-list-model'
import { useTaskPageGitHubNewIssueState } from './use-task-page-github-new-issue-state'
import { useTaskPageGitHubRepositoryState } from './use-task-page-github-repository-state'
import { useTaskPageGitHubSearchController } from './use-task-page-github-search-controller'

type Props = {
  store: TaskPageStoreBindings
  source: TaskPageSourceSelection
  taskResumeApplied: boolean
  githubSearchPersistReadyRef: MutableRefObject<boolean>
}

export function useTaskPageGitHubController({
  store,
  source,
  taskResumeApplied,
  githubSearchPersistReadyRef
}: Props) {
  const search = useTaskPageGitHubSearchController({
    initialTaskQuery: source.initialTaskQuery,
    defaultTaskViewPreset: source.defaultTaskViewPreset,
    taskResumeApplied,
    githubSearchPersistReadyRef,
    setTaskResumeState: store.setTaskResumeState,
    updateSettings: store.updateSettings
  })
  const repository = useTaskPageGitHubRepositoryState({
    store,
    github: search,
    selectedRepos: source.selectedRepos,
    primaryRepo: source.primaryRepo,
    repoMap: store.repoMap,
    taskSource: source.taskSource,
    initialTaskQuery: source.initialTaskQuery
  })
  const list = useTaskPageGitHubListModel({
    store,
    github: search,
    repository,
    selectedRepos: source.selectedRepos,
    repoMap: store.repoMap,
    taskSource: source.taskSource,
    taskResumeApplied
  })
  const issue = useTaskPageGitHubNewIssueState({
    selectedRepos: source.selectedRepos,
    repos: store.repos,
    settings: store.settings
  })

  return {
    ...search,
    ...repository,
    ...list,
    ...issue,
    search,
    repository,
    list,
    issue
  }
}

export type TaskPageGitHubController = ReturnType<typeof useTaskPageGitHubController>
