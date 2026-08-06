import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { toast } from 'sonner'

import { translate } from '@/i18n/i18n'
import { linearCreateProject, type RuntimeLinearSettings } from '@/runtime/runtime-linear-client'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type {
  LinearCollectionResult,
  LinearProjectDetail,
  LinearProjectSummary,
  LinearTeam
} from '../../../shared/types'

type TaskPageLinearProjectCreationStateProps = {
  linearTaskSourceContext: TaskSourceContext | null
  newLinearProjectContent: string
  newLinearProjectDescription: string
  newLinearProjectLabelIds: string[]
  newLinearProjectLeadId: string | null
  newLinearProjectMemberIds: string[]
  newLinearProjectName: string
  newLinearProjectPriority: number
  newLinearProjectStartDate: string
  newLinearProjectSubmitting: boolean
  newLinearProjectTargetDate: string
  newLinearProjectTargetTeam: LinearTeam | null
  openLinearProjectContext: (project: LinearProjectSummary) => void
  settings: RuntimeLinearSettings
  setAppliedLinearProjectSearch: Dispatch<SetStateAction<string>>
  setLinearProjectSearchInput: Dispatch<SetStateAction<string>>
  setLinearProjectsResult: Dispatch<SetStateAction<LinearCollectionResult<LinearProjectSummary>>>
  setLinearRefreshNonce: Dispatch<SetStateAction<number>>
  setNewLinearProjectContent: Dispatch<SetStateAction<string>>
  setNewLinearProjectDescription: Dispatch<SetStateAction<string>>
  setNewLinearProjectLabelIds: Dispatch<SetStateAction<string[]>>
  setNewLinearProjectLeadId: Dispatch<SetStateAction<string | null>>
  setNewLinearProjectMemberIds: Dispatch<SetStateAction<string[]>>
  setNewLinearProjectName: Dispatch<SetStateAction<string>>
  setNewLinearProjectOpen: Dispatch<SetStateAction<boolean>>
  setNewLinearProjectPriority: Dispatch<SetStateAction<number>>
  setNewLinearProjectStartDate: Dispatch<SetStateAction<string>>
  setNewLinearProjectSubmitting: Dispatch<SetStateAction<boolean>>
  setNewLinearProjectTargetDate: Dispatch<SetStateAction<string>>
  setSelectedLinearProjectDetail: Dispatch<SetStateAction<LinearProjectDetail | null>>
}

export function useTaskPageLinearProjectCreationState({
  linearTaskSourceContext,
  newLinearProjectContent,
  newLinearProjectDescription,
  newLinearProjectLabelIds,
  newLinearProjectLeadId,
  newLinearProjectMemberIds,
  newLinearProjectName,
  newLinearProjectPriority,
  newLinearProjectStartDate,
  newLinearProjectSubmitting,
  newLinearProjectTargetDate,
  newLinearProjectTargetTeam,
  openLinearProjectContext,
  settings,
  setAppliedLinearProjectSearch,
  setLinearProjectSearchInput,
  setLinearProjectsResult,
  setLinearRefreshNonce,
  setNewLinearProjectContent,
  setNewLinearProjectDescription,
  setNewLinearProjectLabelIds,
  setNewLinearProjectLeadId,
  setNewLinearProjectMemberIds,
  setNewLinearProjectName,
  setNewLinearProjectOpen,
  setNewLinearProjectPriority,
  setNewLinearProjectStartDate,
  setNewLinearProjectSubmitting,
  setNewLinearProjectTargetDate,
  setSelectedLinearProjectDetail
}: TaskPageLinearProjectCreationStateProps) {
  return useCallback(async (): Promise<void> => {
    if (!newLinearProjectTargetTeam) {
      return
    }
    const name = newLinearProjectName.trim()
    if (!name || newLinearProjectSubmitting) {
      return
    }
    setNewLinearProjectSubmitting(true)
    try {
      const result = await linearCreateProject(linearTaskSourceContext ?? settings, {
        name,
        description: newLinearProjectDescription.trim() || undefined,
        content: newLinearProjectContent.trim() || undefined,
        teamIds: [newLinearProjectTargetTeam.id],
        workspaceId: newLinearProjectTargetTeam.workspaceId,
        leadId: newLinearProjectLeadId || undefined,
        memberIds: newLinearProjectMemberIds.length > 0 ? newLinearProjectMemberIds : undefined,
        labelIds: newLinearProjectLabelIds.length > 0 ? newLinearProjectLabelIds : undefined,
        priority: newLinearProjectPriority,
        startDate: newLinearProjectStartDate || undefined,
        targetDate: newLinearProjectTargetDate || undefined
      })
      if (!result.ok) {
        toast.error(
          result.error ||
            translate('auto.components.TaskPage.3ca9b424a3', 'Failed to create project.')
        )
        return
      }
      toast.success(
        translate('auto.components.TaskPage.cb98f0350c', 'Created {{value0}}', {
          value0: result.project.name
        }),
        {
          action: result.project.url
            ? {
                label: translate('auto.components.TaskPage.9c57663908', 'View'),
                onClick: () => window.open(result.project.url, '_blank')
              }
            : undefined
        }
      )
      setNewLinearProjectOpen(false)
      setNewLinearProjectName('')
      setNewLinearProjectDescription('')
      setNewLinearProjectContent('')
      setNewLinearProjectLeadId(null)
      setNewLinearProjectMemberIds([])
      setNewLinearProjectLabelIds([])
      setNewLinearProjectPriority(0)
      setNewLinearProjectStartDate('')
      setNewLinearProjectTargetDate('')
      setAppliedLinearProjectSearch('')
      setLinearProjectSearchInput('')
      setLinearProjectsResult((current) => ({
        ...current,
        items: [result.project, ...current.items.filter((item) => item.id !== result.project.id)]
      }))
      setSelectedLinearProjectDetail(result.project)
      openLinearProjectContext(result.project)
      setLinearRefreshNonce((n) => n + 1)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate('auto.components.TaskPage.3ca9b424a3', 'Failed to create project.')
      )
    } finally {
      setNewLinearProjectSubmitting(false)
    }
  }, [
    linearTaskSourceContext,
    newLinearProjectContent,
    newLinearProjectDescription,
    newLinearProjectLabelIds,
    newLinearProjectLeadId,
    newLinearProjectMemberIds,
    newLinearProjectName,
    newLinearProjectPriority,
    newLinearProjectStartDate,
    newLinearProjectSubmitting,
    newLinearProjectTargetDate,
    newLinearProjectTargetTeam,
    openLinearProjectContext,
    settings,
    setAppliedLinearProjectSearch,
    setLinearProjectSearchInput,
    setLinearProjectsResult,
    setLinearRefreshNonce,
    setNewLinearProjectContent,
    setNewLinearProjectDescription,
    setNewLinearProjectLabelIds,
    setNewLinearProjectLeadId,
    setNewLinearProjectMemberIds,
    setNewLinearProjectName,
    setNewLinearProjectOpen,
    setNewLinearProjectPriority,
    setNewLinearProjectStartDate,
    setNewLinearProjectSubmitting,
    setNewLinearProjectTargetDate,
    setSelectedLinearProjectDetail
  ])
}
