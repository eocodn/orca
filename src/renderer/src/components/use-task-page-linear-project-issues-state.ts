import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { AppState } from '@/store'
import { clampLinearIssueListLimit } from '../../../shared/linear-issue-read-limits'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type {
  LinearCollectionResult,
  LinearIssue,
  LinearProjectSummary
} from '../../../shared/types'

type TaskPageLinearProjectIssuesStateProps = {
  linearProjectIssueLimit: number
  linearProjectTab: 'overview' | 'issues'
  linearRefreshNonce: number
  linearTaskSourceContext: TaskSourceContext | null
  listLinearProjectIssues: AppState['listLinearProjectIssues']
  selectedLinearProject: LinearProjectSummary | null
  setLinearProjectIssuesError: Dispatch<SetStateAction<string | null>>
  setLinearProjectIssuesLoading: Dispatch<SetStateAction<boolean>>
  setLinearProjectIssuesResult: Dispatch<SetStateAction<LinearCollectionResult<LinearIssue>>>
}

export function useTaskPageLinearProjectIssuesState({
  linearProjectIssueLimit,
  linearProjectTab,
  linearRefreshNonce,
  linearTaskSourceContext,
  listLinearProjectIssues,
  selectedLinearProject,
  setLinearProjectIssuesError,
  setLinearProjectIssuesLoading,
  setLinearProjectIssuesResult
}: TaskPageLinearProjectIssuesStateProps): void {
  useEffect(() => {
    if (!selectedLinearProject?.workspaceId || linearProjectTab !== 'issues') {
      return
    }
    let cancelled = false
    setLinearProjectIssuesLoading(true)
    setLinearProjectIssuesError(null)
    const effectiveLimit = clampLinearIssueListLimit(linearProjectIssueLimit)
    void listLinearProjectIssues(
      selectedLinearProject.id,
      selectedLinearProject.workspaceId,
      effectiveLimit,
      { force: linearRefreshNonce > 0, sourceContext: linearTaskSourceContext }
    )
      .then((result) => {
        if (!cancelled) {
          setLinearProjectIssuesResult(result)
          setLinearProjectIssuesLoading(false)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLinearProjectIssuesError(
            error instanceof Error ? error.message : 'Failed to load project issues.'
          )
          setLinearProjectIssuesLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [
    linearProjectIssueLimit,
    linearProjectTab,
    linearRefreshNonce,
    linearTaskSourceContext,
    listLinearProjectIssues,
    selectedLinearProject,
    setLinearProjectIssuesError,
    setLinearProjectIssuesLoading,
    setLinearProjectIssuesResult
  ])
}
