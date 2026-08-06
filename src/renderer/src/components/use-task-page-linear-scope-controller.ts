import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { toast } from 'sonner'

import type { AppState } from '@/store'
import { translate } from '@/i18n/i18n'
import type {
  LinearCollectionResult,
  LinearCustomViewSummary,
  LinearIssue,
  LinearProjectDetail,
  LinearProjectSummary,
  LinearTeam,
  LinearWorkspaceSelection
} from '../../../shared/types'
import type { LinearMode } from '@/components/task-page-localized-options'

type LinearProjectTab = 'overview' | 'issues'

type LinearScopeControllerProps = {
  clearSelectedLinearIssue: () => void
  linearContextResumeAttemptedRef: MutableRefObject<boolean>
  linearMode: LinearMode
  selectedLinearWorkspaceId: LinearWorkspaceSelection
  selectLinearWorkspace: AppState['selectLinearWorkspace']
  checkLinearConnection: AppState['checkLinearConnection']
  listLinearTeams: AppState['listLinearTeams']
  updateSettings: AppState['updateSettings']
  setAvailableTeams: Dispatch<SetStateAction<LinearTeam[]>>
  setLinearTeamRefreshNonce: Dispatch<SetStateAction<number>>
  setLinearTeamSelection: Dispatch<SetStateAction<ReadonlySet<string>>>
  setTaskResumeState: AppState['setTaskResumeState']
  setSelectedLinearProject: Dispatch<SetStateAction<LinearProjectSummary | null>>
  setSelectedLinearProjectDetail: Dispatch<SetStateAction<LinearProjectDetail | null>>
  setSelectedLinearCustomView: Dispatch<SetStateAction<LinearCustomViewSummary | null>>
  setLinearProjectParentView: Dispatch<SetStateAction<LinearCustomViewSummary | null>>
  setLinearProjectTab: Dispatch<SetStateAction<LinearProjectTab>>
  setLinearProjectsResult: Dispatch<SetStateAction<LinearCollectionResult<LinearProjectSummary>>>
  setLinearCustomViewsResult: Dispatch<
    SetStateAction<LinearCollectionResult<LinearCustomViewSummary>>
  >
  setLinearProjectIssuesResult: Dispatch<SetStateAction<LinearCollectionResult<LinearIssue>>>
  setLinearCustomViewIssuesResult: Dispatch<SetStateAction<LinearCollectionResult<LinearIssue>>>
  setLinearCustomViewProjectsResult: Dispatch<
    SetStateAction<LinearCollectionResult<LinearProjectSummary>>
  >
  setLinearProjectDetailError: Dispatch<SetStateAction<string | null>>
  setLinearProjectsError: Dispatch<SetStateAction<string | null>>
  setLinearCustomViewsError: Dispatch<SetStateAction<string | null>>
  setLinearCustomViewContentsError: Dispatch<SetStateAction<string | null>>
  setLinearIssues: Dispatch<SetStateAction<LinearIssue[]>>
  setLinearError: Dispatch<SetStateAction<string | null>>
  setLinearLoading: Dispatch<SetStateAction<boolean>>
}

export function useTaskPageLinearScopeController({
  clearSelectedLinearIssue,
  linearContextResumeAttemptedRef,
  linearMode,
  selectedLinearWorkspaceId,
  selectLinearWorkspace,
  checkLinearConnection,
  listLinearTeams,
  updateSettings,
  setAvailableTeams,
  setLinearTeamRefreshNonce,
  setLinearTeamSelection,
  setTaskResumeState,
  setSelectedLinearProject,
  setSelectedLinearProjectDetail,
  setSelectedLinearCustomView,
  setLinearProjectParentView,
  setLinearProjectTab,
  setLinearProjectsResult,
  setLinearCustomViewsResult,
  setLinearProjectIssuesResult,
  setLinearCustomViewIssuesResult,
  setLinearCustomViewProjectsResult,
  setLinearProjectDetailError,
  setLinearProjectsError,
  setLinearCustomViewsError,
  setLinearCustomViewContentsError,
  setLinearIssues,
  setLinearError,
  setLinearLoading
}: LinearScopeControllerProps) {
  const handleLinearWorkspaceChange = useCallback(
    (workspaceId: LinearWorkspaceSelection): void => {
      clearSelectedLinearIssue()
      setSelectedLinearProject(null)
      setSelectedLinearProjectDetail(null)
      setSelectedLinearCustomView(null)
      setLinearProjectParentView(null)
      setLinearProjectTab('overview')
      setLinearProjectsResult({ items: [] })
      setLinearCustomViewsResult({ items: [] })
      setLinearProjectIssuesResult({ items: [] })
      setLinearCustomViewIssuesResult({ items: [] })
      setLinearCustomViewProjectsResult({ items: [] })
      setLinearProjectDetailError(null)
      setLinearProjectsError(null)
      setLinearCustomViewsError(null)
      setLinearCustomViewContentsError(null)
      setTaskResumeState({
        linearMode,
        linearContext: undefined
      })
      linearContextResumeAttemptedRef.current = false
      setLinearIssues([])
      setLinearError(null)
      setLinearLoading(true)
      void selectLinearWorkspace(workspaceId)
        .then(() => {
          setLinearTeamRefreshNonce((n) => n + 1)
        })
        .catch(() => {
          setLinearLoading(false)
          toast.error(
            translate('auto.components.TaskPage.d0d570b306', 'Failed to switch Linear workspace.')
          )
        })
    },
    [
      clearSelectedLinearIssue,
      linearContextResumeAttemptedRef,
      linearMode,
      selectLinearWorkspace,
      setLinearCustomViewContentsError,
      setLinearCustomViewIssuesResult,
      setLinearCustomViewProjectsResult,
      setLinearCustomViewsError,
      setLinearCustomViewsResult,
      setLinearError,
      setLinearIssues,
      setLinearLoading,
      setLinearProjectDetailError,
      setLinearProjectIssuesResult,
      setLinearProjectParentView,
      setLinearProjectTab,
      setLinearProjectsError,
      setLinearProjectsResult,
      setLinearTeamRefreshNonce,
      setSelectedLinearCustomView,
      setSelectedLinearProject,
      setSelectedLinearProjectDetail,
      setTaskResumeState
    ]
  )

  const handleLinearTeamSelectionChange = useCallback(
    (next: ReadonlySet<string>, persisted: string[] | null): void => {
      setLinearTeamSelection(new Set(next))
      void updateSettings({ defaultLinearTeamSelection: persisted }).catch(() => {
        toast.error(
          translate('auto.components.TaskPage.3f594861a5', 'Failed to save team selection.')
        )
      })
    },
    [setLinearTeamSelection, updateSettings]
  )

  const handleLinearScopeOpen = useCallback((): void => {
    void checkLinearConnection(true)
    void listLinearTeams(selectedLinearWorkspaceId, { force: true })
      .then((teams) => {
        setAvailableTeams(teams)
      })
      .catch(() => {
        console.warn('[TaskPage] Failed to refresh Linear teams')
      })
  }, [checkLinearConnection, listLinearTeams, selectedLinearWorkspaceId, setAvailableTeams])

  return {
    handleLinearScopeOpen,
    handleLinearTeamSelectionChange,
    handleLinearWorkspaceChange
  }
}
