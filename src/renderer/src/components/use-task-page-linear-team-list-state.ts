import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { AppState } from '@/store'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { LinearTeam, LinearWorkspaceSelection } from '../../../shared/types'

type TaskPageLinearTeamListStateProps = {
  getCachedLinearTeams: AppState['getCachedLinearTeams']
  linearConnected: boolean
  linearTeamRefreshNonce: number
  linearTaskSourceContext: TaskSourceContext | null
  listLinearTeams: AppState['listLinearTeams']
  selectedLinearWorkspaceId: LinearWorkspaceSelection
  setAvailableTeams: Dispatch<SetStateAction<LinearTeam[]>>
  taskResumeApplied: boolean
  taskSource: string
}

export function useTaskPageLinearTeamListState({
  getCachedLinearTeams,
  linearConnected,
  linearTeamRefreshNonce,
  linearTaskSourceContext,
  listLinearTeams,
  selectedLinearWorkspaceId,
  setAvailableTeams,
  taskResumeApplied,
  taskSource
}: TaskPageLinearTeamListStateProps): void {
  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    if (taskSource !== 'linear' || !linearConnected) {
      setAvailableTeams([])
      return
    }
    let cancelled = false
    const cachedTeams = getCachedLinearTeams(selectedLinearWorkspaceId, {
      sourceContext: linearTaskSourceContext
    })
    setAvailableTeams(cachedTeams ?? [])
    void listLinearTeams(selectedLinearWorkspaceId, { sourceContext: linearTaskSourceContext })
      .then((teams) => {
        if (!cancelled) {
          setAvailableTeams(teams)
        }
      })
      .catch(() => {
        if (!cancelled) {
          console.warn('[TaskPage] Failed to fetch Linear teams')
        }
      })
    return () => {
      cancelled = true
    }
  }, [
    getCachedLinearTeams,
    linearConnected,
    linearTaskSourceContext,
    linearTeamRefreshNonce,
    listLinearTeams,
    selectedLinearWorkspaceId,
    setAvailableTeams,
    taskResumeApplied,
    taskSource
  ])
}
