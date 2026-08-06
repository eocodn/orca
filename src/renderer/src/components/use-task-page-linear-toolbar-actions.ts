import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { AppState } from '@/store'
import type { LinearMode } from '@/components/task-page-localized-options'
import type { LinearProjectSummary, LinearTeam } from '../../../shared/types'

type LinearToolbarActionsProps = {
  availableTeams: LinearTeam[]
  linearMode: LinearMode
  selectedLinearProject: LinearProjectSummary | null
  linearSearchInput: string
  setNewLinearProjectName: Dispatch<SetStateAction<string>>
  setNewLinearProjectDescription: Dispatch<SetStateAction<string>>
  setNewLinearProjectContent: Dispatch<SetStateAction<string>>
  setNewLinearProjectTeamId: Dispatch<SetStateAction<string | null>>
  setNewLinearProjectLeadId: Dispatch<SetStateAction<string | null>>
  setNewLinearProjectMemberIds: Dispatch<SetStateAction<string[]>>
  setNewLinearProjectLabelIds: Dispatch<SetStateAction<string[]>>
  setNewLinearProjectPriority: Dispatch<SetStateAction<number>>
  setNewLinearProjectStartDate: Dispatch<SetStateAction<string>>
  setNewLinearProjectTargetDate: Dispatch<SetStateAction<string>>
  setNewLinearProjectOpen: Dispatch<SetStateAction<boolean>>
  setNewLinearIssueTitle: Dispatch<SetStateAction<string>>
  setNewLinearIssueBody: Dispatch<SetStateAction<string>>
  setNewLinearIssueTeamId: Dispatch<SetStateAction<string | null>>
  setNewLinearIssueProjectId: Dispatch<SetStateAction<string | null>>
  setNewLinearIssueOpen: Dispatch<SetStateAction<boolean>>
  setLinearSearchInput: Dispatch<SetStateAction<string>>
  setAppliedLinearSearch: Dispatch<SetStateAction<string>>
  setTaskResumeState: AppState['setTaskResumeState']
  setLinearRefreshNonce: Dispatch<SetStateAction<number>>
  setLinearTeamRefreshNonce: Dispatch<SetStateAction<number>>
}

export function useTaskPageLinearToolbarActions({
  availableTeams,
  linearMode,
  selectedLinearProject,
  linearSearchInput,
  setNewLinearProjectName,
  setNewLinearProjectDescription,
  setNewLinearProjectContent,
  setNewLinearProjectTeamId,
  setNewLinearProjectLeadId,
  setNewLinearProjectMemberIds,
  setNewLinearProjectLabelIds,
  setNewLinearProjectPriority,
  setNewLinearProjectStartDate,
  setNewLinearProjectTargetDate,
  setNewLinearProjectOpen,
  setNewLinearIssueTitle,
  setNewLinearIssueBody,
  setNewLinearIssueTeamId,
  setNewLinearIssueProjectId,
  setNewLinearIssueOpen,
  setLinearSearchInput,
  setAppliedLinearSearch,
  setTaskResumeState,
  setLinearRefreshNonce,
  setLinearTeamRefreshNonce
}: LinearToolbarActionsProps) {
  const handleCreateLinearItem = useCallback(() => {
    if (linearMode === 'projects' && !selectedLinearProject) {
      setNewLinearProjectName('')
      setNewLinearProjectDescription('')
      setNewLinearProjectContent('')
      setNewLinearProjectTeamId(availableTeams[0]?.id ?? null)
      setNewLinearProjectLeadId(null)
      setNewLinearProjectMemberIds([])
      setNewLinearProjectLabelIds([])
      setNewLinearProjectPriority(0)
      setNewLinearProjectStartDate('')
      setNewLinearProjectTargetDate('')
      setNewLinearProjectOpen(true)
      return
    }
    setNewLinearIssueTitle('')
    setNewLinearIssueBody('')
    const projectTeamId =
      selectedLinearProject?.teams?.[0]?.id ??
      availableTeams.find((team) => team.workspaceId === selectedLinearProject?.workspaceId)?.id
    setNewLinearIssueTeamId(projectTeamId ?? availableTeams[0]?.id ?? null)
    setNewLinearIssueProjectId(selectedLinearProject?.id ?? null)
    setNewLinearIssueOpen(true)
  }, [
    availableTeams,
    linearMode,
    selectedLinearProject,
    setNewLinearIssueBody,
    setNewLinearIssueOpen,
    setNewLinearIssueProjectId,
    setNewLinearIssueTeamId,
    setNewLinearIssueTitle,
    setNewLinearProjectContent,
    setNewLinearProjectDescription,
    setNewLinearProjectLabelIds,
    setNewLinearProjectLeadId,
    setNewLinearProjectName,
    setNewLinearProjectOpen,
    setNewLinearProjectPriority,
    setNewLinearProjectStartDate,
    setNewLinearProjectTargetDate,
    setNewLinearProjectTeamId,
    setNewLinearProjectMemberIds
  ])

  const submitLinearSearch = useCallback(() => {
    const trimmed = linearSearchInput.trim()
    setLinearSearchInput(trimmed)
    setAppliedLinearSearch(trimmed)
    setTaskResumeState({ linearQuery: trimmed, linearMode: 'issues' })
    setLinearRefreshNonce((n) => n + 1)
  }, [
    linearSearchInput,
    setAppliedLinearSearch,
    setLinearRefreshNonce,
    setLinearSearchInput,
    setTaskResumeState
  ])

  const clearLinearSearch = useCallback(() => {
    setLinearSearchInput('')
    setAppliedLinearSearch('')
    setTaskResumeState({ linearQuery: '', linearMode: 'issues' })
    setLinearRefreshNonce((n) => n + 1)
  }, [setAppliedLinearSearch, setLinearRefreshNonce, setLinearSearchInput, setTaskResumeState])

  const handleLinearAccessConnected = useCallback((): void => {
    setLinearTeamRefreshNonce((n) => n + 1)
    setLinearRefreshNonce((n) => n + 1)
  }, [setLinearRefreshNonce, setLinearTeamRefreshNonce])

  return {
    clearLinearSearch,
    handleCreateLinearItem,
    handleLinearAccessConnected,
    submitLinearSearch
  }
}
