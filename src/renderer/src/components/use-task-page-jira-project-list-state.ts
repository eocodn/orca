import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { AppState } from '@/store'
import { jiraListProjects } from '@/runtime/runtime-jira-client'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { JiraProject } from '../../../shared/types'

type TaskPageJiraProjectListStateProps = {
  jiraConnected: boolean
  jiraTaskSourceContext: TaskSourceContext | null
  selectedJiraSiteId: string
  settings: AppState['settings']
  setAvailableJiraProjects: Dispatch<SetStateAction<JiraProject[]>>
  setJiraProjectsLoading: Dispatch<SetStateAction<boolean>>
  taskResumeApplied: boolean
  taskSource: string
}

export function useTaskPageJiraProjectListState({
  jiraConnected,
  jiraTaskSourceContext,
  selectedJiraSiteId,
  settings,
  setAvailableJiraProjects,
  setJiraProjectsLoading,
  taskResumeApplied,
  taskSource
}: TaskPageJiraProjectListStateProps): void {
  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    if (taskSource !== 'jira' || !jiraConnected) {
      setAvailableJiraProjects([])
      setJiraProjectsLoading(false)
      return
    }
    let cancelled = false
    setAvailableJiraProjects([])
    setJiraProjectsLoading(true)
    void jiraListProjects(jiraTaskSourceContext ?? settings, selectedJiraSiteId)
      .then((projects) => {
        if (!cancelled) {
          setAvailableJiraProjects(projects)
        }
      })
      .catch(() => {
        if (!cancelled) {
          console.warn('[TaskPage] Failed to fetch Jira projects')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setJiraProjectsLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [
    settings,
    taskSource,
    jiraConnected,
    selectedJiraSiteId,
    taskResumeApplied,
    jiraTaskSourceContext,
    setAvailableJiraProjects,
    setJiraProjectsLoading
  ])
}
