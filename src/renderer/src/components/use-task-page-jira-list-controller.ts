import { useCallback, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { useAppStore, type AppState } from '@/store'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { JiraIssue, JiraProjectStatusOrder } from '../../../shared/types'
import { findTaskPageJiraIssue } from './task-page-jira-cache-selectors'
import type { TaskPageJiraLoadError } from './task-page-jira-load-state'
import {
  getSingleJiraProjectScope,
  getTaskPageJiraStatusOrderScopeKey
} from './task-page-jira-status-order'
import {
  sortJiraIssues,
  type JiraIssueSortColumn,
  type JiraIssueSortDirection,
  type JiraPrioritiesBySite
} from './jira-issue-sorter'
import type { JiraPresetId } from './task-page-localized-options'
import { useTaskPageJiraPrioritiesState } from './use-task-page-jira-priorities-state'

type Props = {
  jiraConnected: boolean
  selectedJiraSiteId: string
  jiraTaskSourceContext: TaskSourceContext | null
  jiraTaskSourceScopeKey: string
  settings: AppState['settings']
  taskSource: string
}

export function useTaskPageJiraListController({
  jiraConnected,
  selectedJiraSiteId,
  jiraTaskSourceContext,
  jiraTaskSourceScopeKey,
  settings,
  taskSource
}: Props) {
  const [jiraIssues, setJiraIssues] = useState<JiraIssue[]>([])
  const [jiraLoading, setJiraLoading] = useState(false)
  const [jiraError, setJiraError] = useState<TaskPageJiraLoadError | null>(null)
  const [jiraErrorDetailsOpen, setJiraErrorDetailsOpen] = useState(false)
  const [jiraSearchInput, setJiraSearchInput] = useState('')
  const [appliedJiraSearch, setAppliedJiraSearch] = useState('')
  const [activeJiraPreset, setActiveJiraPreset] = useState<JiraPresetId>('assigned')
  const [jiraRefreshNonce, setJiraRefreshNonce] = useState(0)
  const [jiraProjectStatusOrder, setJiraProjectStatusOrder] = useState<{
    order: JiraProjectStatusOrder
    scopeKey: string
  } | null>(null)
  const [jiraOrderBy, setJiraOrderBy] = useState<JiraIssueSortColumn>('updated')
  const [jiraOrderDirection, setJiraOrderDirection] = useState<JiraIssueSortDirection>('desc')
  const [jiraPrioritiesBySite, setJiraPrioritiesBySite] = useState<JiraPrioritiesBySite>(
    () => new Map()
  )
  const jiraCacheSnapshot = useAppStore(
    useShallow((state) => ({
      issueCache: state.jiraIssueCache,
      searchCache: state.jiraSearchCache
    }))
  )
  const jiraPrioritySiteIdsKey = useMemo(() => {
    const siteIds =
      selectedJiraSiteId !== 'all'
        ? [selectedJiraSiteId]
        : jiraIssues.flatMap((issue) => (issue.siteId ? [issue.siteId] : []))
    return JSON.stringify([...new Set(siteIds)].sort())
  }, [jiraIssues, selectedJiraSiteId])

  useTaskPageJiraPrioritiesState({
    jiraConnected,
    jiraOrderBy,
    jiraPrioritySiteIdsKey,
    jiraTaskSourceContext,
    setJiraPrioritiesBySite,
    settings,
    taskSource
  })

  const handleJiraSort = useCallback(
    (column: JiraIssueSortColumn) => {
      if (jiraOrderBy === column) {
        setJiraOrderDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
        return
      }
      setJiraOrderBy(column)
      setJiraOrderDirection(column === 'updated' || column === 'status' ? 'desc' : 'asc')
    },
    [jiraOrderBy]
  )
  const displayedJiraIssues = useMemo(
    () =>
      jiraIssues.map(
        (issue) =>
          findTaskPageJiraIssue(
            jiraCacheSnapshot.issueCache,
            jiraCacheSnapshot.searchCache,
            issue.key,
            {
              sourceContext: jiraTaskSourceContext,
              siteId: issue.siteId
            }
          ) ?? issue
      ),
    [jiraCacheSnapshot, jiraIssues, jiraTaskSourceContext]
  )
  const displayedJiraProjectScope = useMemo(
    () => getSingleJiraProjectScope(displayedJiraIssues),
    [displayedJiraIssues]
  )
  const displayedJiraStatusOrderScopeKey = displayedJiraProjectScope
    ? getTaskPageJiraStatusOrderScopeKey(jiraTaskSourceScopeKey, displayedJiraProjectScope)
    : null
  const displayedJiraStatusOrder =
    jiraProjectStatusOrder && displayedJiraStatusOrderScopeKey === jiraProjectStatusOrder.scopeKey
      ? jiraProjectStatusOrder.order
      : null
  const sortedJiraIssues = useMemo(
    () =>
      sortJiraIssues(displayedJiraIssues, jiraOrderBy, jiraOrderDirection, jiraPrioritiesBySite),
    [displayedJiraIssues, jiraOrderBy, jiraOrderDirection, jiraPrioritiesBySite]
  )

  return {
    jiraIssues,
    setJiraIssues,
    jiraLoading,
    setJiraLoading,
    jiraError,
    setJiraError,
    jiraErrorDetailsOpen,
    setJiraErrorDetailsOpen,
    jiraSearchInput,
    setJiraSearchInput,
    appliedJiraSearch,
    setAppliedJiraSearch,
    activeJiraPreset,
    setActiveJiraPreset,
    jiraRefreshNonce,
    setJiraRefreshNonce,
    setJiraProjectStatusOrder,
    jiraOrderBy,
    jiraOrderDirection,
    handleJiraSort,
    displayedJiraIssues,
    displayedJiraStatusOrder,
    sortedJiraIssues
  }
}

export type TaskPageJiraListController = ReturnType<typeof useTaskPageJiraListController>
