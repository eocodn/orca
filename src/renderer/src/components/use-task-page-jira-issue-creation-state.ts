import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { toast } from 'sonner'

import { translate } from '@/i18n/i18n'
import { buildJiraCreateCustomFields } from './task-page-jira-create-model'
import {
  jiraCreateIssue,
  jiraGetIssue,
  type RuntimeJiraSettings
} from '@/runtime/runtime-jira-client'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { JiraCreateField, JiraIssue, JiraIssueType, JiraProject } from '../../../shared/types'

type TaskPageJiraIssueCreationStateProps = {
  hasMissingJiraCreateField: boolean
  jiraCreateFieldsLoading: boolean
  jiraTaskSourceContext: TaskSourceContext | null
  newJiraIssueBody: string
  newJiraIssueCustomFieldValues: Record<string, string>
  newJiraIssueSubmitting: boolean
  newJiraIssueTargetProject: JiraProject | null
  newJiraIssueTargetType: JiraIssueType | null
  newJiraIssueTitle: string
  providerRuntimeContextKey: string
  providerRuntimeContextKeyRef: { current: string }
  settings: RuntimeJiraSettings
  setJiraIssues: Dispatch<SetStateAction<JiraIssue[]>>
  setJiraRefreshNonce: Dispatch<SetStateAction<number>>
  setNewJiraIssueBody: Dispatch<SetStateAction<string>>
  setNewJiraIssueCustomFieldValues: Dispatch<SetStateAction<Record<string, string>>>
  setNewJiraIssueOpen: Dispatch<SetStateAction<boolean>>
  setNewJiraIssueSubmitting: Dispatch<SetStateAction<boolean>>
  setNewJiraIssueTitle: Dispatch<SetStateAction<string>>
  setSelectedJiraIssue: (issue: JiraIssue | null) => void
  visibleJiraCreateFields: JiraCreateField[]
}

export function useTaskPageJiraIssueCreationState({
  hasMissingJiraCreateField,
  jiraCreateFieldsLoading,
  jiraTaskSourceContext,
  newJiraIssueBody,
  newJiraIssueCustomFieldValues,
  newJiraIssueSubmitting,
  newJiraIssueTargetProject,
  newJiraIssueTargetType,
  newJiraIssueTitle,
  providerRuntimeContextKey,
  providerRuntimeContextKeyRef,
  settings,
  setJiraIssues,
  setJiraRefreshNonce,
  setNewJiraIssueBody,
  setNewJiraIssueCustomFieldValues,
  setNewJiraIssueOpen,
  setNewJiraIssueSubmitting,
  setNewJiraIssueTitle,
  setSelectedJiraIssue,
  visibleJiraCreateFields
}: TaskPageJiraIssueCreationStateProps) {
  return useCallback(async (): Promise<void> => {
    if (!newJiraIssueTargetProject || !newJiraIssueTargetType) {
      return
    }
    const title = newJiraIssueTitle.trim()
    if (!title || newJiraIssueSubmitting || hasMissingJiraCreateField || jiraCreateFieldsLoading) {
      return
    }
    const customFields = buildJiraCreateCustomFields(
      visibleJiraCreateFields,
      newJiraIssueCustomFieldValues
    )
    setNewJiraIssueSubmitting(true)
    const submitProviderRuntimeContextKey = providerRuntimeContextKey
    try {
      const result = await jiraCreateIssue(jiraTaskSourceContext ?? settings, {
        siteId: newJiraIssueTargetProject.siteId,
        projectId: newJiraIssueTargetProject.id,
        issueTypeId: newJiraIssueTargetType.id,
        title,
        description: newJiraIssueBody || undefined,
        customFields
      })
      if (submitProviderRuntimeContextKey !== providerRuntimeContextKeyRef.current) {
        return
      }
      if (!result.ok) {
        toast.error(
          result.error ||
            translate('auto.components.TaskPage.aec5feeb69', 'Failed to create Jira issue.')
        )
        return
      }
      toast.success(
        translate('auto.components.TaskPage.cb98f0350c', 'Created {{value0}}', {
          value0: result.key
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
      setNewJiraIssueOpen(false)
      setNewJiraIssueTitle('')
      setNewJiraIssueBody('')
      setNewJiraIssueCustomFieldValues({})
      setJiraRefreshNonce((n) => n + 1)

      void jiraGetIssue(
        jiraTaskSourceContext ?? settings,
        result.key,
        newJiraIssueTargetProject.siteId
      )
        .then((full) => {
          if (submitProviderRuntimeContextKey !== providerRuntimeContextKeyRef.current) {
            return
          }
          if (full) {
            // Why: list cache may still be fresh after create; insert the new row before selecting it.
            setJiraIssues((prev) => [full, ...prev.filter((issue) => issue.key !== full.key)])
            setSelectedJiraIssue(full)
          }
        })
        .catch(() => {})
    } finally {
      if (submitProviderRuntimeContextKey === providerRuntimeContextKeyRef.current) {
        setNewJiraIssueSubmitting(false)
      }
    }
  }, [
    hasMissingJiraCreateField,
    jiraCreateFieldsLoading,
    jiraTaskSourceContext,
    newJiraIssueBody,
    newJiraIssueCustomFieldValues,
    newJiraIssueSubmitting,
    newJiraIssueTargetProject,
    newJiraIssueTargetType,
    newJiraIssueTitle,
    providerRuntimeContextKey,
    providerRuntimeContextKeyRef,
    settings,
    setJiraIssues,
    setJiraRefreshNonce,
    setNewJiraIssueBody,
    setNewJiraIssueCustomFieldValues,
    setNewJiraIssueOpen,
    setNewJiraIssueSubmitting,
    setNewJiraIssueTitle,
    setSelectedJiraIssue,
    visibleJiraCreateFields
  ])
}
