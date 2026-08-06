import { useEffect } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { JiraIssue } from '../../../shared/types'
import type { TaskPageJiraListController } from './use-task-page-jira-list-controller'
import type { TaskPageStoreBindings } from './use-task-page-store-bindings'
import { useTaskPageJiraListDataState } from './use-task-page-jira-list-data-state'

const TASK_SEARCH_DEBOUNCE_MS = 300

type Props = {
  store: TaskPageStoreBindings
  jira: TaskPageJiraListController
  taskResumeApplied: boolean
  jiraSearchPersistReadyRef: MutableRefObject<boolean>
  jiraConnected: boolean
  selectedJiraSiteId: string
  jiraTaskSourceContext: TaskSourceContext | null
  jiraTaskSourceScopeKey: string
  taskSource: string
  selectedJiraIssueKey: string | null
  selectedJiraIssueFallback: JiraIssue | null
  setSelectedJiraIssueKey: Dispatch<SetStateAction<string | null>>
  setSelectedJiraIssueFallback: Dispatch<SetStateAction<JiraIssue | null>>
}

export function useTaskPageJiraDataLifecycle({
  store,
  jira,
  taskResumeApplied,
  jiraSearchPersistReadyRef,
  jiraConnected,
  selectedJiraSiteId,
  jiraTaskSourceContext,
  jiraTaskSourceScopeKey,
  taskSource,
  selectedJiraIssueKey,
  selectedJiraIssueFallback,
  setSelectedJiraIssueKey,
  setSelectedJiraIssueFallback
}: Props): void {
  const { setTaskResumeState, listJiraIssues, searchJiraIssues, settings } = store
  const {
    activeJiraPreset,
    appliedJiraSearch,
    jiraRefreshNonce,
    jiraSearchInput,
    displayedJiraIssues,
    setAppliedJiraSearch,
    setJiraError,
    setJiraErrorDetailsOpen,
    setJiraIssues,
    setJiraLoading,
    setJiraProjectStatusOrder
  } = jira

  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    const timeout = window.setTimeout(() => {
      setAppliedJiraSearch(jiraSearchInput)
    }, TASK_SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [jiraSearchInput, setAppliedJiraSearch, taskResumeApplied])

  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    if (!jiraSearchPersistReadyRef.current) {
      jiraSearchPersistReadyRef.current = true
      return
    }
    setTaskResumeState({ jiraQuery: appliedJiraSearch.trim() })
  }, [appliedJiraSearch, jiraSearchPersistReadyRef, setTaskResumeState, taskResumeApplied])

  useTaskPageJiraListDataState({
    activeJiraPreset,
    appliedJiraSearch,
    jiraConnected,
    jiraRefreshNonce,
    selectedJiraSiteId,
    jiraTaskSourceContext,
    jiraTaskSourceScopeKey,
    listJiraIssues,
    searchJiraIssues,
    settings,
    setJiraError,
    setJiraErrorDetailsOpen,
    setJiraIssues,
    setJiraLoading,
    setJiraProjectStatusOrder,
    taskResumeApplied,
    taskSource
  })

  useEffect(() => {
    if (!taskResumeApplied || taskSource !== 'jira') {
      return
    }
    if (!jiraConnected || displayedJiraIssues.length === 0) {
      if (selectedJiraIssueKey !== null) {
        setSelectedJiraIssueKey(null)
      }
      if (selectedJiraIssueFallback !== null) {
        setSelectedJiraIssueFallback(null)
      }
      return
    }
    if (
      selectedJiraIssueKey &&
      !displayedJiraIssues.some((issue) => issue.key === selectedJiraIssueKey)
    ) {
      setSelectedJiraIssueKey(null)
      setSelectedJiraIssueFallback(null)
    }
  }, [
    displayedJiraIssues,
    jiraConnected,
    selectedJiraIssueFallback,
    selectedJiraIssueKey,
    setSelectedJiraIssueFallback,
    setSelectedJiraIssueKey,
    taskResumeApplied,
    taskSource
  ])
}
