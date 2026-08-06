import type { MutableRefObject } from 'react'

import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { JiraIssue, LinearIssue } from '../../../shared/types'
import type { TaskPageGitHubNewIssueState } from './use-task-page-github-new-issue-state'
import type { TaskPageGitHubRepositoryState } from './use-task-page-github-repository-state'
import type { TaskPageGitHubSearchController } from './use-task-page-github-search-controller'
import type { TaskPageJiraComposerState } from './use-task-page-jira-composer-state'
import type { TaskPageJiraListController } from './use-task-page-jira-list-controller'
import type { TaskPageLinearCollectionController } from './use-task-page-linear-collection-controller'
import type { TaskPageLinearComposerState } from './use-task-page-linear-composer-state'
import type { TaskPageStoreBindings } from './use-task-page-store-bindings'
import { useTaskPageGitHubIssueCreationState } from './use-task-page-github-issue-creation-state'
import { useTaskPageJiraIssueCreationState } from './use-task-page-jira-issue-creation-state'
import { useTaskPageLinearIssueCreationState } from './use-task-page-linear-issue-creation-state'
import { useTaskPageLinearProjectCreationState } from './use-task-page-linear-project-creation-state'

type Props = {
  store: TaskPageStoreBindings
  github: TaskPageGitHubSearchController
  githubIssue: TaskPageGitHubNewIssueState
  githubRepository: TaskPageGitHubRepositoryState
  linearComposer: TaskPageLinearComposerState
  linearCollection: TaskPageLinearCollectionController
  jiraComposer: TaskPageJiraComposerState
  jiraList: TaskPageJiraListController
  linearTaskSourceContext: TaskSourceContext | null
  jiraTaskSourceContext: TaskSourceContext | null
  providerRuntimeContextKey: string
  providerRuntimeContextKeyRef: MutableRefObject<string>
  setSelectedLinearIssue: (
    issue: LinearIssue | null,
    options?: { allowOutsideList?: boolean }
  ) => void
  setSelectedJiraIssue: (issue: JiraIssue | null) => void
}

export function useTaskPageCreationActions({
  store,
  github,
  githubIssue,
  githubRepository,
  linearComposer,
  linearCollection,
  jiraComposer,
  jiraList,
  linearTaskSourceContext,
  jiraTaskSourceContext,
  providerRuntimeContextKey,
  providerRuntimeContextKeyRef,
  setSelectedLinearIssue,
  setSelectedJiraIssue
}: Props) {
  const handleCreateNewIssue = useTaskPageGitHubIssueCreationState({
    clearNewIssueDraft: githubIssue.clearNewIssueDraft,
    newIssueAssignees: githubIssue.newIssueAssignees,
    newIssueBody: githubIssue.newIssueBody,
    newIssueLabels: githubIssue.newIssueLabels,
    newIssueRuntimeTarget: githubIssue.newIssueRuntimeTarget,
    newIssueSourceContext: githubIssue.newIssueSourceContext,
    newIssueSubmitting: githubIssue.newIssueSubmitting,
    newIssueTargetRepo: githubIssue.newIssueTargetRepo,
    newIssueTitle: githubIssue.newIssueTitle,
    openGitHubDetailPage: githubRepository.openGitHubDetailPage,
    setDialogWorkItem: githubRepository.setDialogWorkItem,
    setNewIssueAssignees: githubIssue.setNewIssueAssignees,
    setNewIssueBody: githubIssue.setNewIssueBody,
    setNewIssueDraft: githubIssue.setNewIssueDraft,
    setNewIssueLabels: githubIssue.setNewIssueLabels,
    setNewIssueOpen: githubIssue.setNewIssueOpen,
    setNewIssueSubmitting: githubIssue.setNewIssueSubmitting,
    setNewIssueTitle: githubIssue.setNewIssueTitle,
    setTaskRefreshNonce: github.setTaskRefreshNonce
  })
  const handleCreateNewLinearProject = useTaskPageLinearProjectCreationState({
    linearTaskSourceContext,
    newLinearProjectContent: linearComposer.newLinearProjectContent,
    newLinearProjectDescription: linearComposer.newLinearProjectDescription,
    newLinearProjectLabelIds: linearComposer.newLinearProjectLabelIds,
    newLinearProjectLeadId: linearComposer.newLinearProjectLeadId,
    newLinearProjectMemberIds: linearComposer.newLinearProjectMemberIds,
    newLinearProjectName: linearComposer.newLinearProjectName,
    newLinearProjectPriority: linearComposer.newLinearProjectPriority,
    newLinearProjectStartDate: linearComposer.newLinearProjectStartDate,
    newLinearProjectSubmitting: linearComposer.newLinearProjectSubmitting,
    newLinearProjectTargetDate: linearComposer.newLinearProjectTargetDate,
    newLinearProjectTargetTeam: linearComposer.newLinearProjectTargetTeam,
    openLinearProjectContext: linearCollection.openLinearProjectContext,
    settings: store.settings,
    setAppliedLinearProjectSearch: linearCollection.setAppliedLinearProjectSearch,
    setLinearProjectSearchInput: linearCollection.setLinearProjectSearchInput,
    setLinearProjectsResult: linearCollection.setLinearProjectsResult,
    setLinearRefreshNonce: linearCollection.setLinearRefreshNonce,
    setNewLinearProjectContent: linearComposer.setNewLinearProjectContent,
    setNewLinearProjectDescription: linearComposer.setNewLinearProjectDescription,
    setNewLinearProjectLabelIds: linearComposer.setNewLinearProjectLabelIds,
    setNewLinearProjectLeadId: linearComposer.setNewLinearProjectLeadId,
    setNewLinearProjectMemberIds: linearComposer.setNewLinearProjectMemberIds,
    setNewLinearProjectName: linearComposer.setNewLinearProjectName,
    setNewLinearProjectOpen: linearComposer.setNewLinearProjectOpen,
    setNewLinearProjectPriority: linearComposer.setNewLinearProjectPriority,
    setNewLinearProjectStartDate: linearComposer.setNewLinearProjectStartDate,
    setNewLinearProjectSubmitting: linearComposer.setNewLinearProjectSubmitting,
    setNewLinearProjectTargetDate: linearComposer.setNewLinearProjectTargetDate,
    setSelectedLinearProjectDetail: linearCollection.setSelectedLinearProjectDetail
  })
  const handleCreateNewLinearIssue = useTaskPageLinearIssueCreationState({
    linearTaskSourceContext,
    newLinearIssueAssigneeId: linearComposer.newLinearIssueAssigneeId,
    newLinearIssueBody: linearComposer.newLinearIssueBody,
    newLinearIssueLabelIds: linearComposer.newLinearIssueLabelIds,
    newLinearIssuePriority: linearComposer.newLinearIssuePriority,
    newLinearIssueProjectId: linearComposer.newLinearIssueProjectId,
    newLinearIssueStateId: linearComposer.newLinearIssueStateId,
    newLinearIssueSubmitting: linearComposer.newLinearIssueSubmitting,
    newLinearIssueTargetTeam: linearComposer.newLinearIssueTargetTeam,
    newLinearIssueTitle: linearComposer.newLinearIssueTitle,
    newLinearProjectSelected: linearCollection.selectedLinearProject,
    providerRuntimeContextKey,
    providerRuntimeContextKeyRef,
    settings: store.settings,
    setLinearRefreshNonce: linearCollection.setLinearRefreshNonce,
    setNewLinearIssueAssigneeId: linearComposer.setNewLinearIssueAssigneeId,
    setNewLinearIssueBody: linearComposer.setNewLinearIssueBody,
    setNewLinearIssueLabelIds: linearComposer.setNewLinearIssueLabelIds,
    setNewLinearIssueOpen: linearComposer.setNewLinearIssueOpen,
    setNewLinearIssuePriority: linearComposer.setNewLinearIssuePriority,
    setNewLinearIssueProjectId: linearComposer.setNewLinearIssueProjectId,
    setNewLinearIssueStateId: linearComposer.setNewLinearIssueStateId,
    setNewLinearIssueSubmitting: linearComposer.setNewLinearIssueSubmitting,
    setNewLinearIssueTitle: linearComposer.setNewLinearIssueTitle,
    setSelectedLinearIssue
  })
  const handleCreateNewJiraIssue = useTaskPageJiraIssueCreationState({
    hasMissingJiraCreateField: jiraComposer.hasMissingJiraCreateField,
    jiraCreateFieldsLoading: jiraComposer.jiraCreateFieldsLoading,
    jiraTaskSourceContext,
    newJiraIssueBody: jiraComposer.newJiraIssueBody,
    newJiraIssueCustomFieldValues: jiraComposer.newJiraIssueCustomFieldValues,
    newJiraIssueSubmitting: jiraComposer.newJiraIssueSubmitting,
    newJiraIssueTargetProject: jiraComposer.newJiraIssueTargetProject,
    newJiraIssueTargetType: jiraComposer.newJiraIssueTargetType,
    newJiraIssueTitle: jiraComposer.newJiraIssueTitle,
    providerRuntimeContextKey,
    providerRuntimeContextKeyRef,
    settings: store.settings,
    setJiraIssues: jiraList.setJiraIssues,
    setJiraRefreshNonce: jiraList.setJiraRefreshNonce,
    setNewJiraIssueBody: jiraComposer.setNewJiraIssueBody,
    setNewJiraIssueCustomFieldValues: jiraComposer.setNewJiraIssueCustomFieldValues,
    setNewJiraIssueOpen: jiraComposer.setNewJiraIssueOpen,
    setNewJiraIssueSubmitting: jiraComposer.setNewJiraIssueSubmitting,
    setNewJiraIssueTitle: jiraComposer.setNewJiraIssueTitle,
    setSelectedJiraIssue,
    visibleJiraCreateFields: jiraComposer.visibleJiraCreateFields
  })

  return {
    handleCreateNewIssue,
    handleCreateNewLinearProject,
    handleCreateNewLinearIssue,
    handleCreateNewJiraIssue
  }
}
