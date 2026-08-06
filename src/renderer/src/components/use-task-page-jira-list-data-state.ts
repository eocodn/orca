import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { AppState } from '@/store'
import {
  getSingleJiraProjectScope,
  getTaskPageJiraStatusOrderScopeKey,
  loadTaskPageJiraProjectStatusOrder
} from '@/components/task-page-jira-status-order'
import {
  createTaskPageJiraLoadFailureState,
  type TaskPageJiraLoadError
} from '@/components/task-page-jira-load-state'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { JiraIssue, JiraProjectStatusOrder } from '../../../shared/types'
import type { JiraPresetId } from '@/components/task-page-localized-options'

const JIRA_ITEM_LIMIT = 50

type TaskPageJiraListDataStateProps = {
  activeJiraPreset: JiraPresetId
  appliedJiraSearch: string
  jiraConnected: boolean
  jiraRefreshNonce: number
  selectedJiraSiteId: string
  jiraTaskSourceContext: TaskSourceContext | null
  jiraTaskSourceScopeKey: string
  listJiraIssues: AppState['listJiraIssues']
  searchJiraIssues: AppState['searchJiraIssues']
  settings: AppState['settings']
  setJiraError: Dispatch<SetStateAction<TaskPageJiraLoadError | null>>
  setJiraErrorDetailsOpen: Dispatch<SetStateAction<boolean>>
  setJiraIssues: Dispatch<SetStateAction<JiraIssue[]>>
  setJiraLoading: Dispatch<SetStateAction<boolean>>
  setJiraProjectStatusOrder: Dispatch<
    SetStateAction<{ order: JiraProjectStatusOrder; scopeKey: string } | null>
  >
  taskResumeApplied: boolean
  taskSource: string
}

export function useTaskPageJiraListDataState({
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
}: TaskPageJiraListDataStateProps): void {
  useEffect(() => {
    if (!taskResumeApplied || taskSource !== 'jira' || !jiraConnected) {
      return
    }

    let cancelled = false
    setJiraLoading(true)
    setJiraError(null)
    setJiraErrorDetailsOpen(false)

    const trimmed = appliedJiraSearch.trim()
    const request =
      trimmed.length > 0
        ? searchJiraIssues(trimmed, JIRA_ITEM_LIMIT, { sourceContext: jiraTaskSourceContext })
        : listJiraIssues(activeJiraPreset, JIRA_ITEM_LIMIT, {
            sourceContext: jiraTaskSourceContext
          })

    void request
      .then((issues) => {
        if (cancelled) {
          return
        }
        setJiraIssues(issues)
        setJiraLoading(false)
        const projectScope = getSingleJiraProjectScope(issues)
        if (!projectScope) {
          return
        }
        const statusOrderScopeKey = getTaskPageJiraStatusOrderScopeKey(
          jiraTaskSourceScopeKey,
          projectScope
        )
        void loadTaskPageJiraProjectStatusOrder(
          jiraTaskSourceContext ?? settings,
          jiraTaskSourceScopeKey,
          projectScope
        ).then((order) => {
          if (!cancelled) {
            setJiraProjectStatusOrder({
              order,
              scopeKey: statusOrderScopeKey
            })
          }
        })
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        const failureState = createTaskPageJiraLoadFailureState(error)
        setJiraIssues(failureState.issues)
        setJiraError(failureState.error)
        setJiraLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [
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
  ])
}
