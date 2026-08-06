import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { toast } from 'sonner'

import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  linearCreateIssue,
  linearGetIssue,
  type RuntimeLinearSettings
} from '@/runtime/runtime-linear-client'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { LinearIssue, LinearProjectSummary, LinearTeam } from '../../../shared/types'

type TaskPageLinearIssueCreationStateProps = {
  linearTaskSourceContext: TaskSourceContext | null
  newLinearIssueAssigneeId: string | null
  newLinearIssueBody: string
  newLinearIssueLabelIds: string[]
  newLinearIssuePriority: number
  newLinearIssueProjectId: string | null
  newLinearIssueStateId: string | null
  newLinearIssueSubmitting: boolean
  newLinearIssueTargetTeam: LinearTeam | null
  newLinearIssueTitle: string
  newLinearProjectSelected: LinearProjectSummary | null
  providerRuntimeContextKey: string
  providerRuntimeContextKeyRef: { current: string }
  settings: RuntimeLinearSettings
  setLinearRefreshNonce: Dispatch<SetStateAction<number>>
  setNewLinearIssueAssigneeId: Dispatch<SetStateAction<string | null>>
  setNewLinearIssueBody: Dispatch<SetStateAction<string>>
  setNewLinearIssueLabelIds: Dispatch<SetStateAction<string[]>>
  setNewLinearIssueOpen: Dispatch<SetStateAction<boolean>>
  setNewLinearIssuePriority: Dispatch<SetStateAction<number>>
  setNewLinearIssueProjectId: Dispatch<SetStateAction<string | null>>
  setNewLinearIssueStateId: Dispatch<SetStateAction<string | null>>
  setNewLinearIssueSubmitting: Dispatch<SetStateAction<boolean>>
  setNewLinearIssueTitle: Dispatch<SetStateAction<string>>
  setSelectedLinearIssue: (
    issue: LinearIssue | null,
    options?: { allowOutsideList?: boolean }
  ) => void
}

export function useTaskPageLinearIssueCreationState({
  linearTaskSourceContext,
  newLinearIssueAssigneeId,
  newLinearIssueBody,
  newLinearIssueLabelIds,
  newLinearIssuePriority,
  newLinearIssueProjectId,
  newLinearIssueStateId,
  newLinearIssueSubmitting,
  newLinearIssueTargetTeam,
  newLinearIssueTitle,
  newLinearProjectSelected,
  providerRuntimeContextKey,
  providerRuntimeContextKeyRef,
  settings,
  setLinearRefreshNonce,
  setNewLinearIssueAssigneeId,
  setNewLinearIssueBody,
  setNewLinearIssueLabelIds,
  setNewLinearIssueOpen,
  setNewLinearIssuePriority,
  setNewLinearIssueProjectId,
  setNewLinearIssueStateId,
  setNewLinearIssueSubmitting,
  setNewLinearIssueTitle,
  setSelectedLinearIssue
}: TaskPageLinearIssueCreationStateProps) {
  return useCallback(async (): Promise<void> => {
    if (!newLinearIssueTargetTeam) {
      return
    }
    const title = newLinearIssueTitle.trim()
    if (!title || newLinearIssueSubmitting) {
      return
    }
    if (
      newLinearProjectSelected &&
      newLinearIssueProjectId === newLinearProjectSelected.id &&
      newLinearIssueTargetTeam.workspaceId !== newLinearProjectSelected.workspaceId
    ) {
      toast.error(
        translate(
          'auto.components.TaskPage.1e1b2ad8f2',
          'Select a team from the project workspace before filing this issue.'
        )
      )
      return
    }
    setNewLinearIssueSubmitting(true)
    const submitProviderRuntimeContextKey = providerRuntimeContextKey
    try {
      const result = await linearCreateIssue(linearTaskSourceContext ?? settings, {
        teamId: newLinearIssueTargetTeam.id,
        title,
        description: newLinearIssueBody || undefined,
        workspaceId: newLinearIssueTargetTeam.workspaceId,
        stateId: newLinearIssueStateId || undefined,
        priority: newLinearIssuePriority,
        assigneeId: newLinearIssueAssigneeId || undefined,
        projectId: newLinearIssueProjectId || null,
        labelIds: newLinearIssueLabelIds.length > 0 ? newLinearIssueLabelIds : undefined
      })
      if (submitProviderRuntimeContextKey !== providerRuntimeContextKeyRef.current) {
        return
      }
      if (!result.ok) {
        toast.error(
          result.error ||
            translate('auto.components.TaskPage.7437e340b4', 'Failed to create issue.')
        )
        return
      }
      toast.success(
        translate('auto.components.TaskPage.cb98f0350c', 'Created {{value0}}', {
          value0: result.identifier
        }),
        {
          action: result.url
            ? {
                label: translate('auto.components.TaskPage.9c57663908', 'View'),
                onClick: () => window.open(result.url, '_blank')
              }
            : undefined
        }
      )
      setNewLinearIssueOpen(false)
      setNewLinearIssueTitle('')
      setNewLinearIssueBody('')
      setNewLinearIssueStateId(null)
      setNewLinearIssueAssigneeId(null)
      setNewLinearIssuePriority(0)
      setNewLinearIssueProjectId(null)
      setNewLinearIssueLabelIds([])
      setLinearRefreshNonce((n) => n + 1)
      useAppStore.getState().recordFeatureInteraction('linear-tasks')

      // Why: auto-select the new issue so the user sees exactly what was filed.
      void linearGetIssue(
        linearTaskSourceContext ?? settings,
        result.id,
        newLinearIssueTargetTeam.workspaceId
      )
        .then((full) => {
          if (submitProviderRuntimeContextKey !== providerRuntimeContextKeyRef.current) {
            return
          }
          if (full) {
            setSelectedLinearIssue(full, { allowOutsideList: true })
          }
        })
        .catch(() => {})
    } finally {
      if (submitProviderRuntimeContextKey === providerRuntimeContextKeyRef.current) {
        setNewLinearIssueSubmitting(false)
      }
    }
  }, [
    linearTaskSourceContext,
    newLinearIssueAssigneeId,
    newLinearIssueBody,
    newLinearIssueLabelIds,
    newLinearIssuePriority,
    newLinearIssueProjectId,
    newLinearIssueStateId,
    newLinearIssueSubmitting,
    newLinearIssueTargetTeam,
    newLinearIssueTitle,
    newLinearProjectSelected,
    providerRuntimeContextKey,
    providerRuntimeContextKeyRef,
    settings,
    setLinearRefreshNonce,
    setNewLinearIssueAssigneeId,
    setNewLinearIssueBody,
    setNewLinearIssueLabelIds,
    setNewLinearIssueOpen,
    setNewLinearIssuePriority,
    setNewLinearIssueProjectId,
    setNewLinearIssueStateId,
    setNewLinearIssueSubmitting,
    setNewLinearIssueTitle,
    setSelectedLinearIssue
  ])
}
