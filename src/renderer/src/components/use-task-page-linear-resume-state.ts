import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { AppState } from '@/store'
import type { LinearMode } from '@/components/task-page-localized-options'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type {
  LinearCustomViewSummary,
  LinearProjectDetail,
  LinearProjectSummary
} from '../../../shared/types'

type TaskPageLinearResumeStateProps = {
  fetchLinearCustomView: AppState['fetchLinearCustomView']
  fetchLinearProject: AppState['fetchLinearProject']
  linearConnected: boolean
  linearContextResumeAttemptedRef: { current: boolean }
  linearTaskSourceContext: TaskSourceContext | null
  setLinearCustomViewsError: Dispatch<SetStateAction<string | null>>
  setLinearCustomViewsLoading: Dispatch<SetStateAction<boolean>>
  setLinearMode: Dispatch<SetStateAction<LinearMode>>
  setLinearProjectParentView: Dispatch<SetStateAction<LinearCustomViewSummary | null>>
  setLinearProjectsError: Dispatch<SetStateAction<string | null>>
  setSelectedLinearCustomView: Dispatch<SetStateAction<LinearCustomViewSummary | null>>
  setSelectedLinearProject: Dispatch<SetStateAction<LinearProjectSummary | null>>
  setSelectedLinearProjectDetail: Dispatch<SetStateAction<LinearProjectDetail | null>>
  setTaskResumeState: AppState['setTaskResumeState']
  taskResumeApplied: boolean
  taskResumeState: AppState['taskResumeState']
  taskSource: string
}

export function useTaskPageLinearResumeState({
  fetchLinearCustomView,
  fetchLinearProject,
  linearConnected,
  linearContextResumeAttemptedRef,
  linearTaskSourceContext,
  setLinearCustomViewsError,
  setLinearCustomViewsLoading,
  setLinearMode,
  setLinearProjectParentView,
  setLinearProjectsError,
  setSelectedLinearCustomView,
  setSelectedLinearProject,
  setSelectedLinearProjectDetail,
  setTaskResumeState,
  taskResumeApplied,
  taskResumeState,
  taskSource
}: TaskPageLinearResumeStateProps): void {
  useEffect(() => {
    const context = taskResumeState?.linearContext
    if (
      linearContextResumeAttemptedRef.current ||
      !taskResumeApplied ||
      taskSource !== 'linear' ||
      !linearConnected ||
      !context
    ) {
      return
    }
    linearContextResumeAttemptedRef.current = true
    let cancelled = false

    if (context.kind === 'project') {
      void fetchLinearProject(context.id, context.workspaceId, {
        force: true,
        sourceContext: linearTaskSourceContext
      })
        .then((project) => {
          if (cancelled) {
            return
          }
          if (!project) {
            setSelectedLinearProject(null)
            setSelectedLinearProjectDetail(null)
            setLinearProjectParentView(null)
            setLinearProjectsError('Saved Linear project was not found.')
            setTaskResumeState({ linearContext: undefined })
            return
          }
          setSelectedLinearProject(project)
          setSelectedLinearProjectDetail(project)
          setLinearMode('projects')
        })
        .catch(() => {
          if (!cancelled) {
            setSelectedLinearProject(null)
            setSelectedLinearProjectDetail(null)
            setLinearProjectParentView(null)
            setLinearProjectsError('Failed to restore saved Linear project.')
            setTaskResumeState({ linearContext: undefined })
          }
        })
      return () => {
        cancelled = true
      }
    }

    if (context.kind === 'view' && context.model) {
      setLinearMode('views')
      setLinearCustomViewsLoading(true)
      setLinearCustomViewsError(null)
      void fetchLinearCustomView(context.id, context.workspaceId, context.model, {
        force: true,
        sourceContext: linearTaskSourceContext
      })
        .then((restoredView) => {
          if (cancelled) {
            return
          }
          setLinearCustomViewsLoading(false)
          if (!restoredView) {
            setSelectedLinearCustomView(null)
            setLinearCustomViewsError('Saved Linear view was not found.')
            setTaskResumeState({ linearContext: undefined })
            return
          }
          setSelectedLinearCustomView(restoredView)
        })
        .catch(() => {
          if (!cancelled) {
            setSelectedLinearCustomView(null)
            setLinearCustomViewsLoading(false)
            setLinearCustomViewsError('Failed to restore saved Linear view.')
            setTaskResumeState({ linearContext: undefined })
          }
        })
      return () => {
        cancelled = true
      }
    }
    return undefined
  }, [
    fetchLinearCustomView,
    fetchLinearProject,
    linearConnected,
    linearContextResumeAttemptedRef,
    linearTaskSourceContext,
    setLinearCustomViewsError,
    setLinearCustomViewsLoading,
    setLinearMode,
    setLinearProjectParentView,
    setLinearProjectsError,
    setSelectedLinearCustomView,
    setSelectedLinearProject,
    setSelectedLinearProjectDetail,
    setTaskResumeState,
    taskResumeApplied,
    taskResumeState?.linearContext,
    taskSource
  ])
}
