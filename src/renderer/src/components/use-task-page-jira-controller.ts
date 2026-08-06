import { useState } from 'react'
import type { MutableRefObject } from 'react'

import type { JiraProject } from '../../../shared/types'
import type { TaskPageProviderContext } from './use-task-page-provider-context'
import type { TaskPageSourceSelection } from './use-task-page-source-selection'
import type { TaskPageStoreBindings } from './use-task-page-store-bindings'
import { useTaskPageJiraComposerState } from './use-task-page-jira-composer-state'
import { useTaskPageJiraDataLifecycle } from './use-task-page-jira-data-lifecycle'
import { useTaskPageJiraDetailState } from './use-task-page-jira-detail-state'
import { useTaskPageJiraListController } from './use-task-page-jira-list-controller'
import { useTaskPageJiraProjectListState } from './use-task-page-jira-project-list-state'
import { useTaskPageJiraToolbarActions } from './use-task-page-jira-toolbar-actions'

type Props = {
  store: TaskPageStoreBindings
  source: TaskPageSourceSelection
  provider: TaskPageProviderContext
  taskResumeApplied: boolean
  jiraSearchPersistReadyRef: MutableRefObject<boolean>
}

export function useTaskPageJiraController({
  store,
  source,
  provider,
  taskResumeApplied,
  jiraSearchPersistReadyRef
}: Props) {
  const [jiraConnectOpen, setJiraConnectOpen] = useState(false)
  const { settings, pageData, openTaskPage, setTaskResumeState } = store
  const { jiraConnected, selectedJiraSiteId, taskSource } = source
  const { jiraTaskSourceContext, jiraTaskSourceScopeKey } = provider
  const detail = useTaskPageJiraDetailState({ pageData, jiraTaskSourceContext, openTaskPage })
  const list = useTaskPageJiraListController({
    jiraConnected,
    selectedJiraSiteId,
    jiraTaskSourceContext,
    jiraTaskSourceScopeKey,
    settings,
    taskSource
  })
  const [availableJiraProjects, setAvailableJiraProjects] = useState<JiraProject[]>([])
  const [jiraProjectsLoading, setJiraProjectsLoading] = useState(false)
  useTaskPageJiraProjectListState({
    jiraConnected,
    jiraTaskSourceContext,
    selectedJiraSiteId,
    settings,
    setAvailableJiraProjects,
    setJiraProjectsLoading,
    taskResumeApplied,
    taskSource
  })
  const composer = useTaskPageJiraComposerState({
    availableJiraProjects,
    selectedJiraSiteId,
    settings,
    jiraConnected,
    jiraTaskSourceContext
  })
  useTaskPageJiraDataLifecycle({
    store,
    jira: list,
    taskResumeApplied,
    jiraSearchPersistReadyRef,
    jiraConnected,
    selectedJiraSiteId,
    jiraTaskSourceContext,
    jiraTaskSourceScopeKey,
    taskSource,
    selectedJiraIssueKey: detail.selectedJiraIssueKey,
    selectedJiraIssueFallback: detail.selectedJiraIssueFallback,
    setSelectedJiraIssueKey: detail.setSelectedJiraIssueKey,
    setSelectedJiraIssueFallback: detail.setSelectedJiraIssueFallback
  })
  const toolbar = useTaskPageJiraToolbarActions({
    jiraSearchInput: list.jiraSearchInput,
    setActiveJiraPreset: list.setActiveJiraPreset,
    setAppliedJiraSearch: list.setAppliedJiraSearch,
    setJiraRefreshNonce: list.setJiraRefreshNonce,
    setJiraSearchInput: list.setJiraSearchInput,
    setNewJiraIssueBody: composer.setNewJiraIssueBody,
    setNewJiraIssueOpen: composer.setNewJiraIssueOpen,
    setNewJiraIssueProjectCommandValue: composer.setNewJiraIssueProjectCommandValue,
    setNewJiraIssueProjectId: composer.setNewJiraIssueProjectId,
    setNewJiraIssueProjectQuery: composer.setNewJiraIssueProjectQuery,
    setNewJiraIssueTitle: composer.setNewJiraIssueTitle,
    setNewJiraIssueTypeId: composer.setNewJiraIssueTypeId,
    setTaskResumeState,
    sortedAvailableJiraProjects: composer.sortedAvailableJiraProjects
  })
  return {
    ...detail,
    ...list,
    ...composer,
    ...toolbar,
    availableJiraProjects,
    jiraProjectsLoading,
    jiraConnectOpen,
    setJiraConnectOpen
  }
}

export type TaskPageJiraController = ReturnType<typeof useTaskPageJiraController>
