import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { findTaskPageJiraIssue } from '@/components/task-page-jira-cache-selectors'
import { useAppStore, type AppState } from '@/store'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { JiraIssue } from '../../../shared/types'

type TaskPageJiraDetailStateProps = {
  pageData: AppState['taskPageData']
  jiraTaskSourceContext: TaskSourceContext | null
  openTaskPage: AppState['openTaskPage']
}

export function useTaskPageJiraDetailState({
  pageData,
  jiraTaskSourceContext,
  openTaskPage
}: TaskPageJiraDetailStateProps) {
  const [selectedJiraIssueKey, setSelectedJiraIssueKey] = useState<string | null>(null)
  const [selectedJiraIssueFallback, setSelectedJiraIssueFallback] = useState<JiraIssue | null>(null)
  const jiraCacheSnapshot = useAppStore(
    useShallow((state) => ({
      issueCache: state.jiraIssueCache,
      searchCache: state.jiraSearchCache
    }))
  )
  const cachedSelectedJiraIssue = findTaskPageJiraIssue(
    jiraCacheSnapshot.issueCache,
    jiraCacheSnapshot.searchCache,
    selectedJiraIssueKey,
    {
      sourceContext: jiraTaskSourceContext,
      siteId: selectedJiraIssueFallback?.siteId ?? pageData.openJiraIssue?.siteId ?? null
    }
  )
  const selectedJiraIssue = selectedJiraIssueKey
    ? (cachedSelectedJiraIssue ?? selectedJiraIssueFallback)
    : null
  const jiraDetailSourceContext = useMemo(() => {
    if (
      selectedJiraIssue &&
      pageData.openJiraSourceContext?.provider === 'jira' &&
      pageData.openJiraIssue?.key === selectedJiraIssue.key &&
      pageData.openJiraIssue.siteId === selectedJiraIssue.siteId
    ) {
      return pageData.openJiraSourceContext
    }
    return jiraTaskSourceContext
  }, [
    jiraTaskSourceContext,
    pageData.openJiraIssue,
    pageData.openJiraSourceContext,
    selectedJiraIssue
  ])

  const setSelectedJiraIssue = useCallback((issue: JiraIssue | null) => {
    setSelectedJiraIssueKey(issue?.key ?? null)
    setSelectedJiraIssueFallback(issue)
  }, [])

  useEffect(() => {
    setSelectedJiraIssue(pageData.openJiraIssue ?? null)
  }, [pageData.openJiraIssue, setSelectedJiraIssue])

  const openJiraDetailPage = useCallback(
    (issue: JiraIssue) => {
      openTaskPage(
        {
          taskSource: 'jira',
          openJiraIssue: issue,
          openJiraSourceContext: jiraTaskSourceContext
        },
        { recordTasksInteraction: false }
      )
    },
    [jiraTaskSourceContext, openTaskPage]
  )

  return {
    selectedJiraIssue,
    selectedJiraIssueFallback,
    selectedJiraIssueKey,
    setSelectedJiraIssue,
    setSelectedJiraIssueFallback,
    setSelectedJiraIssueKey,
    jiraDetailSourceContext,
    openJiraDetailPage
  }
}
