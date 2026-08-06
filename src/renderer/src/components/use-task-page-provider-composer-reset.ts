import { useEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { LinearProjectSummary } from '../../../shared/types'

type Props = {
  providerRuntimeContextKey: string
  newLinearIssueOpen: boolean
  setNewLinearIssueOpen: Dispatch<SetStateAction<boolean>>
  setNewLinearIssueTitle: Dispatch<SetStateAction<string>>
  setNewLinearIssueBody: Dispatch<SetStateAction<string>>
  setNewLinearIssueTeamId: Dispatch<SetStateAction<string | null>>
  setNewLinearIssueStateId: Dispatch<SetStateAction<string | null>>
  setNewLinearIssueAssigneeId: Dispatch<SetStateAction<string | null>>
  setNewLinearIssuePriority: Dispatch<SetStateAction<number>>
  setNewLinearIssueProjectId: Dispatch<SetStateAction<string | null>>
  setNewLinearIssueLabelIds: Dispatch<SetStateAction<string[]>>
  setNewLinearIssueProjects: Dispatch<SetStateAction<LinearProjectSummary[]>>
  setNewLinearIssueProjectsLoading: Dispatch<SetStateAction<boolean>>
  setNewLinearIssueSubmitting: Dispatch<SetStateAction<boolean>>
  newJiraIssueOpen: boolean
  resetNewJiraIssue: () => void
}

export function useTaskPageProviderComposerReset({
  providerRuntimeContextKey,
  newLinearIssueOpen,
  setNewLinearIssueOpen,
  setNewLinearIssueTitle,
  setNewLinearIssueBody,
  setNewLinearIssueTeamId,
  setNewLinearIssueStateId,
  setNewLinearIssueAssigneeId,
  setNewLinearIssuePriority,
  setNewLinearIssueProjectId,
  setNewLinearIssueLabelIds,
  setNewLinearIssueProjects,
  setNewLinearIssueProjectsLoading,
  setNewLinearIssueSubmitting,
  newJiraIssueOpen,
  resetNewJiraIssue
}: Props): void {
  const previousProviderRuntimeContextKeyRef = useRef(providerRuntimeContextKey)

  useEffect(() => {
    if (previousProviderRuntimeContextKeyRef.current === providerRuntimeContextKey) {
      return
    }
    previousProviderRuntimeContextKeyRef.current = providerRuntimeContextKey
    if (newLinearIssueOpen) {
      setNewLinearIssueOpen(false)
      setNewLinearIssueTitle('')
      setNewLinearIssueBody('')
      setNewLinearIssueTeamId(null)
      setNewLinearIssueStateId(null)
      setNewLinearIssueAssigneeId(null)
      setNewLinearIssuePriority(0)
      setNewLinearIssueProjectId(null)
      setNewLinearIssueLabelIds([])
      setNewLinearIssueProjects([])
      setNewLinearIssueProjectsLoading(false)
      setNewLinearIssueSubmitting(false)
    }
    if (newJiraIssueOpen) {
      resetNewJiraIssue()
    }
  }, [
    newJiraIssueOpen,
    newLinearIssueOpen,
    providerRuntimeContextKey,
    resetNewJiraIssue,
    setNewLinearIssueAssigneeId,
    setNewLinearIssueBody,
    setNewLinearIssueLabelIds,
    setNewLinearIssueOpen,
    setNewLinearIssuePriority,
    setNewLinearIssueProjectId,
    setNewLinearIssueProjects,
    setNewLinearIssueProjectsLoading,
    setNewLinearIssueStateId,
    setNewLinearIssueSubmitting,
    setNewLinearIssueTeamId,
    setNewLinearIssueTitle
  ])
}
