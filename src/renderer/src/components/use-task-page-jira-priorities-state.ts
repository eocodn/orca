import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { AppState } from '@/store'
import { jiraListPriorities } from '@/runtime/runtime-jira-client'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { JiraPriority } from '../../../shared/types'
import type { JiraIssueSortColumn, JiraPrioritiesBySite } from './jira-issue-sorter'

type TaskPageJiraPrioritiesStateProps = {
  jiraConnected: boolean
  jiraOrderBy: JiraIssueSortColumn
  jiraPrioritySiteIdsKey: string
  jiraTaskSourceContext: TaskSourceContext | null
  setJiraPrioritiesBySite: Dispatch<SetStateAction<JiraPrioritiesBySite>>
  settings: AppState['settings']
  taskSource: string
}

export function useTaskPageJiraPrioritiesState({
  jiraConnected,
  jiraOrderBy,
  jiraPrioritySiteIdsKey,
  jiraTaskSourceContext,
  setJiraPrioritiesBySite,
  settings,
  taskSource
}: TaskPageJiraPrioritiesStateProps): void {
  useEffect(() => {
    if (taskSource !== 'jira' || !jiraConnected || jiraOrderBy !== 'priority') {
      setJiraPrioritiesBySite((current) => (current.size === 0 ? current : new Map()))
      return
    }
    let cancelled = false
    const jiraPrioritySiteIds = JSON.parse(jiraPrioritySiteIdsKey) as string[]
    void Promise.all(
      jiraPrioritySiteIds.map(async (siteId) => {
        try {
          return [
            siteId,
            await jiraListPriorities(jiraTaskSourceContext ?? settings, siteId)
          ] as const
        } catch {
          return [siteId, [] as JiraPriority[]] as const
        }
      })
    ).then((prioritiesBySite) => {
      if (!cancelled) {
        setJiraPrioritiesBySite(new Map(prioritiesBySite))
      }
    })
    return () => {
      cancelled = true
    }
  }, [
    jiraConnected,
    jiraOrderBy,
    jiraPrioritySiteIdsKey,
    jiraTaskSourceContext,
    setJiraPrioritiesBySite,
    settings,
    taskSource
  ])
}
