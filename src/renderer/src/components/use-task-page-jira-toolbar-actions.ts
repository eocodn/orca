import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { AppState } from '@/store'
import type { JiraPresetId } from '@/components/task-page-localized-options'
import type { JiraProject } from '../../../shared/types'
import { getJiraProjectSelectionKey } from './task-page-jira-create-model'

type JiraToolbarActionsProps = {
  jiraSearchInput: string
  sortedAvailableJiraProjects: JiraProject[]
  setNewJiraIssueTitle: Dispatch<SetStateAction<string>>
  setNewJiraIssueBody: Dispatch<SetStateAction<string>>
  setNewJiraIssueProjectId: Dispatch<SetStateAction<string | null>>
  setNewJiraIssueProjectQuery: Dispatch<SetStateAction<string>>
  setNewJiraIssueProjectCommandValue: Dispatch<SetStateAction<string>>
  setNewJiraIssueTypeId: Dispatch<SetStateAction<string | null>>
  setNewJiraIssueOpen: Dispatch<SetStateAction<boolean>>
  setJiraSearchInput: Dispatch<SetStateAction<string>>
  setAppliedJiraSearch: Dispatch<SetStateAction<string>>
  setActiveJiraPreset: Dispatch<SetStateAction<JiraPresetId>>
  setTaskResumeState: AppState['setTaskResumeState']
  setJiraRefreshNonce: Dispatch<SetStateAction<number>>
}

export function useTaskPageJiraToolbarActions({
  jiraSearchInput,
  sortedAvailableJiraProjects,
  setNewJiraIssueTitle,
  setNewJiraIssueBody,
  setNewJiraIssueProjectId,
  setNewJiraIssueProjectQuery,
  setNewJiraIssueProjectCommandValue,
  setNewJiraIssueTypeId,
  setNewJiraIssueOpen,
  setJiraSearchInput,
  setAppliedJiraSearch,
  setActiveJiraPreset,
  setTaskResumeState,
  setJiraRefreshNonce
}: JiraToolbarActionsProps) {
  const selectJiraPreset = useCallback(
    (preset: JiraPresetId) => {
      setJiraSearchInput('')
      setAppliedJiraSearch('')
      setActiveJiraPreset(preset)
      setTaskResumeState({ jiraPreset: preset, jiraQuery: '' })
      setJiraRefreshNonce((n) => n + 1)
    },
    [
      setActiveJiraPreset,
      setAppliedJiraSearch,
      setJiraRefreshNonce,
      setJiraSearchInput,
      setTaskResumeState
    ]
  )

  const handleCreateJiraIssue = useCallback(() => {
    setNewJiraIssueTitle('')
    setNewJiraIssueBody('')
    setNewJiraIssueProjectId(
      sortedAvailableJiraProjects[0]
        ? getJiraProjectSelectionKey(sortedAvailableJiraProjects[0])
        : null
    )
    setNewJiraIssueProjectQuery('')
    setNewJiraIssueProjectCommandValue('')
    setNewJiraIssueTypeId(null)
    setNewJiraIssueOpen(true)
  }, [
    setNewJiraIssueBody,
    setNewJiraIssueOpen,
    setNewJiraIssueProjectCommandValue,
    setNewJiraIssueProjectId,
    setNewJiraIssueProjectQuery,
    setNewJiraIssueTitle,
    setNewJiraIssueTypeId,
    sortedAvailableJiraProjects
  ])

  const submitJiraSearch = useCallback(() => {
    const trimmed = jiraSearchInput.trim()
    setJiraSearchInput(trimmed)
    setAppliedJiraSearch(trimmed)
    setTaskResumeState({ jiraQuery: trimmed })
    setJiraRefreshNonce((n) => n + 1)
  }, [
    jiraSearchInput,
    setAppliedJiraSearch,
    setJiraRefreshNonce,
    setJiraSearchInput,
    setTaskResumeState
  ])

  const clearJiraSearch = useCallback(() => {
    setJiraSearchInput('')
    setAppliedJiraSearch('')
    setTaskResumeState({ jiraQuery: '' })
    setJiraRefreshNonce((n) => n + 1)
  }, [setAppliedJiraSearch, setJiraRefreshNonce, setJiraSearchInput, setTaskResumeState])

  return {
    clearJiraSearch,
    handleCreateJiraIssue,
    selectJiraPreset,
    submitJiraSearch
  }
}
