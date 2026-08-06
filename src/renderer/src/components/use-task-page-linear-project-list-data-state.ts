import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { AppState } from '@/store'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { LinearCollectionResult, LinearProjectSummary } from '../../../shared/types'

const LINEAR_ITEM_LIMIT = 36

type TaskPageLinearProjectListDataStateProps = {
  appliedLinearProjectSearch: string
  getCachedLinearProjects: AppState['getCachedLinearProjects']
  linearConnected: boolean
  linearMode: string
  linearRefreshNonce: number
  linearTaskSourceContext: TaskSourceContext | null
  listLinearProjectsFromStore: AppState['listLinearProjects']
  selectedLinearProject: LinearProjectSummary | null
  selectedLinearWorkspaceId: string | 'all'
  setLinearProjectsError: Dispatch<SetStateAction<string | null>>
  setLinearProjectsLoading: Dispatch<SetStateAction<boolean>>
  setLinearProjectsResult: Dispatch<SetStateAction<LinearCollectionResult<LinearProjectSummary>>>
  taskResumeApplied: boolean
  taskSource: string
}

export function useTaskPageLinearProjectListDataState({
  appliedLinearProjectSearch,
  getCachedLinearProjects,
  linearConnected,
  linearMode,
  linearRefreshNonce,
  linearTaskSourceContext,
  listLinearProjectsFromStore,
  selectedLinearProject,
  selectedLinearWorkspaceId,
  setLinearProjectsError,
  setLinearProjectsLoading,
  setLinearProjectsResult,
  taskResumeApplied,
  taskSource
}: TaskPageLinearProjectListDataStateProps): void {
  useEffect(() => {
    if (!taskResumeApplied || taskSource !== 'linear' || linearMode !== 'projects') {
      return
    }
    if (!linearConnected || selectedLinearProject) {
      return
    }

    let cancelled = false
    const query = appliedLinearProjectSearch.trim()
    const cached = getCachedLinearProjects(query || undefined, LINEAR_ITEM_LIMIT, undefined, {
      sourceContext: linearTaskSourceContext
    })
    if (cached) {
      setLinearProjectsResult(cached)
    }
    const force = linearRefreshNonce > 0
    setLinearProjectsLoading(force || cached === null)
    setLinearProjectsError(null)
    void listLinearProjectsFromStore(query || undefined, LINEAR_ITEM_LIMIT, undefined, {
      force,
      sourceContext: linearTaskSourceContext
    })
      .then((result) => {
        if (!cancelled) {
          setLinearProjectsResult(result)
          setLinearProjectsLoading(false)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLinearProjectsError(
            error instanceof Error ? error.message : 'Failed to load projects.'
          )
          setLinearProjectsLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [
    appliedLinearProjectSearch,
    getCachedLinearProjects,
    linearConnected,
    linearMode,
    linearRefreshNonce,
    linearTaskSourceContext,
    listLinearProjectsFromStore,
    selectedLinearProject,
    selectedLinearWorkspaceId,
    setLinearProjectsError,
    setLinearProjectsLoading,
    setLinearProjectsResult,
    taskResumeApplied,
    taskSource
  ])
}
