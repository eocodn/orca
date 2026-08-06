import { useEffect } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

import { getTaskPresetQuery } from '../../../shared/task-view-preset-query'
import { normalizeGitHubTaskPreset } from './task-page-query-model'
import type { JiraPresetId, LinearMode } from './task-page-localized-options'
import type { TaskProvider } from '../../../shared/task-providers'
import { resolveVisibleTaskProvider } from '../../../shared/task-providers'
import type { TaskViewPresetId } from '../../../shared/types'

type PersistedTaskSettings = {
  defaultTaskSource?: TaskProvider
  defaultTaskViewPreset: TaskViewPresetId
}

type PersistedTaskResumeState = {
  githubMode?: 'items' | 'project'
  githubItemsPreset?: TaskViewPresetId | null
  githubItemsQuery?: string
  linearMode?: LinearMode
  linearQuery?: string
  jiraPreset?: JiraPresetId
  jiraQuery?: string
}

type PersistedContextHydrationProps = {
  persistedUIReady: boolean
  settings: PersistedTaskSettings | null
  pageTaskSource: TaskProvider | undefined
  visibleTaskProviders: readonly TaskProvider[]
  resolvedInitialSelection: ReadonlySet<string>
  taskResumeState: PersistedTaskResumeState | null | undefined
  taskResumeAppliedRef: MutableRefObject<boolean>
  setTaskResumeApplied: Dispatch<SetStateAction<boolean>>
  setTaskSource: Dispatch<SetStateAction<TaskProvider>>
  setRepoSelection: Dispatch<SetStateAction<ReadonlySet<string>>>
  setGithubMode: Dispatch<SetStateAction<'items' | 'project'>>
  setTaskSearchInput: Dispatch<SetStateAction<string>>
  setAppliedTaskSearch: Dispatch<SetStateAction<string>>
  setActiveTaskPreset: Dispatch<SetStateAction<TaskViewPresetId | null>>
  setLinearMode: Dispatch<SetStateAction<LinearMode>>
  setLinearSearchInput: Dispatch<SetStateAction<string>>
  setAppliedLinearSearch: Dispatch<SetStateAction<string>>
  setActiveJiraPreset: Dispatch<SetStateAction<JiraPresetId>>
  setJiraSearchInput: Dispatch<SetStateAction<string>>
  setAppliedJiraSearch: Dispatch<SetStateAction<string>>
}

export function useTaskPagePersistedContextHydration({
  persistedUIReady,
  settings,
  pageTaskSource,
  visibleTaskProviders,
  resolvedInitialSelection,
  taskResumeState,
  taskResumeAppliedRef,
  setTaskResumeApplied,
  setTaskSource,
  setRepoSelection,
  setGithubMode,
  setTaskSearchInput,
  setAppliedTaskSearch,
  setActiveTaskPreset,
  setLinearMode,
  setLinearSearchInput,
  setAppliedLinearSearch,
  setActiveJiraPreset,
  setJiraSearchInput,
  setAppliedJiraSearch
}: PersistedContextHydrationProps): void {
  useEffect(() => {
    if (taskResumeAppliedRef.current || !persistedUIReady || !settings) {
      return
    }

    setTaskSource(
      resolveVisibleTaskProvider(pageTaskSource ?? settings.defaultTaskSource, visibleTaskProviders)
    )
    setRepoSelection(resolvedInitialSelection)

    const nextGithubMode = taskResumeState?.githubMode ?? 'items'
    setGithubMode(nextGithubMode)

    const preset = taskResumeState?.githubItemsPreset
    if (preset === null) {
      const query = taskResumeState?.githubItemsQuery ?? ''
      setTaskSearchInput(query)
      setAppliedTaskSearch(query)
      setActiveTaskPreset(null)
    } else {
      const presetId = normalizeGitHubTaskPreset(preset ?? settings.defaultTaskViewPreset)
      const query = getTaskPresetQuery(presetId)
      setTaskSearchInput(query)
      setAppliedTaskSearch(query)
      setActiveTaskPreset(presetId)
    }

    const linearQuery = taskResumeState?.linearQuery ?? ''
    setLinearMode(taskResumeState?.linearMode ?? 'issues')
    setLinearSearchInput(linearQuery)
    setAppliedLinearSearch(linearQuery)

    const jiraPreset = taskResumeState?.jiraPreset ?? 'assigned'
    const jiraQuery = taskResumeState?.jiraQuery ?? ''
    setActiveJiraPreset(jiraPreset)
    setJiraSearchInput(jiraQuery)
    setAppliedJiraSearch(jiraQuery)

    // Why: settings/UI hydrate async; apply restored Tasks context once before local interactions take over.
    taskResumeAppliedRef.current = true
    setTaskResumeApplied(true)
  }, [
    pageTaskSource,
    persistedUIReady,
    resolvedInitialSelection,
    setActiveJiraPreset,
    setActiveTaskPreset,
    setAppliedJiraSearch,
    setAppliedLinearSearch,
    setAppliedTaskSearch,
    setGithubMode,
    setJiraSearchInput,
    setLinearMode,
    setLinearSearchInput,
    setRepoSelection,
    setTaskResumeApplied,
    setTaskSearchInput,
    setTaskSource,
    settings,
    taskResumeAppliedRef,
    taskResumeState,
    visibleTaskProviders
  ])
}
