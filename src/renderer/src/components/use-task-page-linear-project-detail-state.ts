import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { AppState } from '@/store'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type {
  LinearCustomViewSummary,
  LinearProjectDetail,
  LinearProjectSummary
} from '../../../shared/types'

type TaskPageLinearProjectDetailStateProps = {
  fetchLinearProject: AppState['fetchLinearProject']
  linearRefreshNonce: number
  linearTaskSourceContext: TaskSourceContext | null
  selectedLinearProject: LinearProjectSummary | null
  setLinearProjectDetailError: Dispatch<SetStateAction<string | null>>
  setLinearProjectDetailLoading: Dispatch<SetStateAction<boolean>>
  setLinearProjectParentView: Dispatch<SetStateAction<LinearCustomViewSummary | null>>
  setLinearProjectsError: Dispatch<SetStateAction<string | null>>
  setSelectedLinearProject: Dispatch<SetStateAction<LinearProjectSummary | null>>
  setSelectedLinearProjectDetail: Dispatch<SetStateAction<LinearProjectDetail | null>>
  setTaskResumeState: AppState['setTaskResumeState']
}

export function useTaskPageLinearProjectDetailState({
  fetchLinearProject,
  linearRefreshNonce,
  linearTaskSourceContext,
  selectedLinearProject,
  setLinearProjectDetailError,
  setLinearProjectDetailLoading,
  setLinearProjectParentView,
  setLinearProjectsError,
  setSelectedLinearProject,
  setSelectedLinearProjectDetail,
  setTaskResumeState
}: TaskPageLinearProjectDetailStateProps): void {
  useEffect(() => {
    if (!selectedLinearProject?.workspaceId) {
      setSelectedLinearProjectDetail(null)
      return
    }
    let cancelled = false
    setLinearProjectDetailLoading(true)
    setLinearProjectDetailError(null)
    void fetchLinearProject(selectedLinearProject.id, selectedLinearProject.workspaceId, {
      force: linearRefreshNonce > 0,
      sourceContext: linearTaskSourceContext
    })
      .then((project) => {
        if (!cancelled) {
          setSelectedLinearProjectDetail(project)
          setLinearProjectDetailLoading(false)
          if (!project) {
            setSelectedLinearProject(null)
            setLinearProjectParentView(null)
            setLinearProjectDetailError(null)
            setLinearProjectsError('Project was not found.')
            setTaskResumeState({ linearContext: undefined })
          }
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLinearProjectDetailError(
            error instanceof Error ? error.message : 'Failed to load project.'
          )
          setLinearProjectDetailLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [
    fetchLinearProject,
    linearRefreshNonce,
    linearTaskSourceContext,
    selectedLinearProject,
    setLinearProjectDetailError,
    setLinearProjectDetailLoading,
    setLinearProjectParentView,
    setLinearProjectsError,
    setSelectedLinearProject,
    setSelectedLinearProjectDetail,
    setTaskResumeState
  ])
}
