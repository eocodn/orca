import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { AppState } from '@/store'
import { mergeLinearCollectionResults } from './task-page-linear-model'
import { clampLinearIssueListLimit } from '../../../shared/linear-issue-read-limits'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type {
  LinearCollectionResult,
  LinearCustomViewModel,
  LinearCustomViewSummary,
  LinearIssue,
  LinearProjectSummary
} from '../../../shared/types'

const LINEAR_CUSTOM_VIEW_MODELS = ['issue', 'project'] satisfies readonly LinearCustomViewModel[]
const LINEAR_ITEM_LIMIT = 36

type TaskPageLinearCustomViewDataStateProps = {
  getCachedLinearCustomViews: AppState['getCachedLinearCustomViews']
  linearConnected: boolean
  linearCustomViewIssueLimit: number
  linearMode: string
  linearRefreshNonce: number
  linearTaskSourceContext: TaskSourceContext | null
  listLinearCustomViewIssues: AppState['listLinearCustomViewIssues']
  listLinearCustomViewProjects: AppState['listLinearCustomViewProjects']
  listLinearCustomViews: AppState['listLinearCustomViews']
  selectedLinearCustomView: LinearCustomViewSummary | null
  selectedLinearWorkspaceId: string | 'all'
  setLinearCustomViewContentsError: Dispatch<SetStateAction<string | null>>
  setLinearCustomViewContentsLoading: Dispatch<SetStateAction<boolean>>
  setLinearCustomViewIssuesResult: Dispatch<SetStateAction<LinearCollectionResult<LinearIssue>>>
  setLinearCustomViewProjectsResult: Dispatch<
    SetStateAction<LinearCollectionResult<LinearProjectSummary>>
  >
  setLinearCustomViewsError: Dispatch<SetStateAction<string | null>>
  setLinearCustomViewsLoading: Dispatch<SetStateAction<boolean>>
  setLinearCustomViewsResult: Dispatch<
    SetStateAction<LinearCollectionResult<LinearCustomViewSummary>>
  >
  taskResumeApplied: boolean
  taskSource: string
}

export function useTaskPageLinearCustomViewDataState({
  getCachedLinearCustomViews,
  linearConnected,
  linearCustomViewIssueLimit,
  linearMode,
  linearRefreshNonce,
  linearTaskSourceContext,
  listLinearCustomViewIssues,
  listLinearCustomViewProjects,
  listLinearCustomViews,
  selectedLinearCustomView,
  selectedLinearWorkspaceId,
  setLinearCustomViewContentsError,
  setLinearCustomViewContentsLoading,
  setLinearCustomViewIssuesResult,
  setLinearCustomViewProjectsResult,
  setLinearCustomViewsError,
  setLinearCustomViewsLoading,
  setLinearCustomViewsResult,
  taskResumeApplied,
  taskSource
}: TaskPageLinearCustomViewDataStateProps): void {
  useEffect(() => {
    if (!taskResumeApplied || taskSource !== 'linear' || linearMode !== 'views') {
      return
    }
    if (!linearConnected || selectedLinearCustomView) {
      return
    }
    let cancelled = false
    const cachedResults = LINEAR_CUSTOM_VIEW_MODELS.map((model) =>
      getCachedLinearCustomViews(model, LINEAR_ITEM_LIMIT, undefined, {
        sourceContext: linearTaskSourceContext
      })
    )
    const allCached = cachedResults.every(
      (result): result is LinearCollectionResult<LinearCustomViewSummary> => result !== null
    )
    if (allCached) {
      setLinearCustomViewsResult(mergeLinearCollectionResults(cachedResults))
    }
    const force = linearRefreshNonce > 0
    setLinearCustomViewsLoading(force || !allCached)
    setLinearCustomViewsError(null)
    // Why: the Views tab already has a Model column, so list both models in one result.
    void Promise.all(
      LINEAR_CUSTOM_VIEW_MODELS.map((model) =>
        listLinearCustomViews(model, LINEAR_ITEM_LIMIT, undefined, {
          force,
          sourceContext: linearTaskSourceContext
        })
      )
    )
      .then((result) => {
        if (!cancelled) {
          setLinearCustomViewsResult(mergeLinearCollectionResults(result))
          setLinearCustomViewsLoading(false)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLinearCustomViewsError(
            error instanceof Error ? error.message : 'Failed to load views.'
          )
          setLinearCustomViewsLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [
    getCachedLinearCustomViews,
    linearConnected,
    linearMode,
    linearRefreshNonce,
    linearTaskSourceContext,
    listLinearCustomViews,
    selectedLinearCustomView,
    selectedLinearWorkspaceId,
    setLinearCustomViewsError,
    setLinearCustomViewsLoading,
    setLinearCustomViewsResult,
    taskResumeApplied,
    taskSource
  ])

  useEffect(() => {
    if (!selectedLinearCustomView?.workspaceId) {
      setLinearCustomViewIssuesResult({ items: [] })
      setLinearCustomViewProjectsResult({ items: [] })
      return
    }
    let cancelled = false
    setLinearCustomViewContentsLoading(true)
    setLinearCustomViewContentsError(null)
    const issueLimit = clampLinearIssueListLimit(linearCustomViewIssueLimit)
    const request =
      selectedLinearCustomView.model === 'issue'
        ? listLinearCustomViewIssues(
            selectedLinearCustomView.id,
            selectedLinearCustomView.workspaceId,
            issueLimit,
            { force: linearRefreshNonce > 0, sourceContext: linearTaskSourceContext }
          )
        : listLinearCustomViewProjects(
            selectedLinearCustomView.id,
            selectedLinearCustomView.workspaceId,
            LINEAR_ITEM_LIMIT,
            { force: linearRefreshNonce > 0, sourceContext: linearTaskSourceContext }
          )
    void request
      .then((result) => {
        if (cancelled) {
          return
        }
        if (selectedLinearCustomView.model === 'issue') {
          setLinearCustomViewIssuesResult(result as LinearCollectionResult<LinearIssue>)
        } else {
          setLinearCustomViewProjectsResult(result as LinearCollectionResult<LinearProjectSummary>)
        }
        setLinearCustomViewContentsLoading(false)
      })
      .catch((error) => {
        if (!cancelled) {
          setLinearCustomViewContentsError(
            error instanceof Error ? error.message : 'Failed to load view contents.'
          )
          setLinearCustomViewContentsLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [
    linearCustomViewIssueLimit,
    linearRefreshNonce,
    linearTaskSourceContext,
    listLinearCustomViewIssues,
    listLinearCustomViewProjects,
    selectedLinearCustomView,
    setLinearCustomViewContentsError,
    setLinearCustomViewContentsLoading,
    setLinearCustomViewIssuesResult,
    setLinearCustomViewProjectsResult
  ])
}
