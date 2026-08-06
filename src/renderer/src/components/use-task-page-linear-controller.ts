import { useState } from 'react'
import type { MutableRefObject } from 'react'

import type { LinearTeam } from '../../../shared/types'
import type { TaskPageProviderContext } from './use-task-page-provider-context'
import type { TaskPageSourceSelection } from './use-task-page-source-selection'
import type { TaskPageStoreBindings } from './use-task-page-store-bindings'
import { useTaskPageLinearCollectionController } from './use-task-page-linear-collection-controller'
import { useTaskPageLinearComposerState } from './use-task-page-linear-composer-state'
import { useTaskPageLinearDataLifecycle } from './use-task-page-linear-data-lifecycle'
import { useTaskPageLinearDetailState } from './use-task-page-linear-detail-state'
import { useTaskPageLinearListModel } from './use-task-page-linear-list-model'
import { useTaskPageLinearPresentationController } from './use-task-page-linear-presentation-controller'
import { useTaskPageLinearResumeState } from './use-task-page-linear-resume-state'
import { useTaskPageLinearScopeController } from './use-task-page-linear-scope-controller'
import { useTaskPageLinearTeamListState } from './use-task-page-linear-team-list-state'
import { useTaskPageLinearToolbarActions } from './use-task-page-linear-toolbar-actions'

type Props = {
  store: TaskPageStoreBindings
  source: TaskPageSourceSelection
  provider: TaskPageProviderContext
  taskResumeApplied: boolean
  linearSearchPersistReadyRef: MutableRefObject<boolean>
}

export function useTaskPageLinearController({
  store,
  source,
  provider,
  taskResumeApplied,
  linearSearchPersistReadyRef
}: Props) {
  const [linearConnectOpen, setLinearConnectOpen] = useState(false)
  const {
    settings,
    taskResumeState,
    setTaskResumeState,
    pageData,
    openTaskPage,
    selectLinearWorkspace,
    invalidateLinearIssueLists,
    getCachedLinearTeams,
    listLinearTeams,
    fetchLinearProject,
    fetchLinearCustomView,
    patchLinearIssue,
    checkLinearConnection,
    updateSettings
  } = store
  const { linearConnected, selectedLinearWorkspaceId, taskSource } = source
  const { linearTaskSourceContext, linearListInvalidationVersionForSource } = provider
  const detail = useTaskPageLinearDetailState({ pageData, linearTaskSourceContext, openTaskPage })
  const collection = useTaskPageLinearCollectionController({
    clearSelectedLinearIssue: detail.clearSelectedLinearIssue,
    setTaskResumeState
  })
  useTaskPageLinearResumeState({
    fetchLinearCustomView,
    fetchLinearProject,
    linearConnected,
    linearContextResumeAttemptedRef: collection.linearContextResumeAttemptedRef,
    linearTaskSourceContext,
    setLinearCustomViewsError: collection.setLinearCustomViewsError,
    setLinearCustomViewsLoading: collection.setLinearCustomViewsLoading,
    setLinearMode: collection.setLinearMode,
    setLinearProjectParentView: collection.setLinearProjectParentView,
    setLinearProjectsError: collection.setLinearProjectsError,
    setSelectedLinearCustomView: collection.setSelectedLinearCustomView,
    setSelectedLinearProject: collection.setSelectedLinearProject,
    setSelectedLinearProjectDetail: collection.setSelectedLinearProjectDetail,
    setTaskResumeState,
    taskResumeApplied,
    taskResumeState,
    taskSource
  })
  const [availableTeams, setAvailableTeams] = useState<LinearTeam[]>([])
  const [linearTeamRefreshNonce, setLinearTeamRefreshNonce] = useState(0)
  useTaskPageLinearTeamListState({
    getCachedLinearTeams,
    linearConnected,
    linearTeamRefreshNonce,
    linearTaskSourceContext,
    listLinearTeams,
    selectedLinearWorkspaceId,
    setAvailableTeams,
    taskResumeApplied,
    taskSource
  })
  const listModel = useTaskPageLinearListModel({
    collection,
    availableTeams,
    defaultLinearTeamSelection: settings?.defaultLinearTeamSelection,
    selectedLinearWorkspaceId,
    linearCredentialError: store.linearStatus.credentialError
  })
  const presentation = useTaskPageLinearPresentationController({
    filteredLinearIssues: listModel.filteredLinearIssues,
    pagedLinearIssues: listModel.pagedLinearIssues,
    linearTeamSelectionSize: listModel.linearTeamSelection.size,
    linearGroupBy: collection.linearGroupBy,
    linearOrderBy: collection.linearOrderBy,
    linearDisplayProperties: collection.linearDisplayProperties,
    linearTeamPropertyTouched: collection.linearTeamPropertyTouched,
    setLinearDisplayProperties: collection.setLinearDisplayProperties,
    setLinearTeamPropertyTouched: collection.setLinearTeamPropertyTouched,
    linearTaskSourceContext,
    settings,
    patchLinearIssue,
    invalidateLinearIssueLists,
    patchScopedLinearIssue: collection.patchScopedLinearIssue,
    setSelectedLinearIssueFallback: detail.setSelectedLinearIssueFallback
  })
  const composer = useTaskPageLinearComposerState({
    availableTeams,
    settings,
    linearConnected,
    selectedLinearWorkspaceId,
    selectedLinearProject: collection.selectedLinearProject,
    linearTaskSourceContext
  })
  useTaskPageLinearDataLifecycle({
    store,
    collection,
    listModel,
    taskResumeApplied,
    linearSearchPersistReadyRef,
    linearConnected,
    linearTaskSourceContext,
    linearListInvalidationVersionForSource,
    selectedLinearWorkspaceId,
    taskSource,
    selectedLinearIssueCanFloat: detail.selectedLinearIssueCanFloat,
    selectedLinearIssueId: detail.selectedLinearIssueId,
    clearSelectedLinearIssue: detail.clearSelectedLinearIssue
  })
  const scope = useTaskPageLinearScopeController({
    checkLinearConnection,
    clearSelectedLinearIssue: detail.clearSelectedLinearIssue,
    linearContextResumeAttemptedRef: collection.linearContextResumeAttemptedRef,
    linearMode: collection.linearMode,
    listLinearTeams,
    selectedLinearWorkspaceId,
    selectLinearWorkspace,
    setAvailableTeams,
    setLinearCustomViewContentsError: collection.setLinearCustomViewContentsError,
    setLinearCustomViewIssuesResult: collection.setLinearCustomViewIssuesResult,
    setLinearCustomViewProjectsResult: collection.setLinearCustomViewProjectsResult,
    setLinearCustomViewsError: collection.setLinearCustomViewsError,
    setLinearCustomViewsResult: collection.setLinearCustomViewsResult,
    setLinearError: collection.setLinearError,
    setLinearIssues: collection.setLinearIssues,
    setLinearLoading: collection.setLinearLoading,
    setLinearProjectDetailError: collection.setLinearProjectDetailError,
    setLinearProjectIssuesResult: collection.setLinearProjectIssuesResult,
    setLinearProjectParentView: collection.setLinearProjectParentView,
    setLinearProjectTab: collection.setLinearProjectTab,
    setLinearProjectsError: collection.setLinearProjectsError,
    setLinearProjectsResult: collection.setLinearProjectsResult,
    setLinearTeamRefreshNonce,
    setLinearTeamSelection: listModel.setLinearTeamSelection,
    setSelectedLinearCustomView: collection.setSelectedLinearCustomView,
    setSelectedLinearProject: collection.setSelectedLinearProject,
    setSelectedLinearProjectDetail: collection.setSelectedLinearProjectDetail,
    setTaskResumeState,
    updateSettings
  })
  const toolbar = useTaskPageLinearToolbarActions({
    availableTeams,
    linearMode: collection.linearMode,
    linearSearchInput: collection.linearSearchInput,
    selectedLinearProject: collection.selectedLinearProject,
    setAppliedLinearSearch: collection.setAppliedLinearSearch,
    setLinearRefreshNonce: collection.setLinearRefreshNonce,
    setLinearSearchInput: collection.setLinearSearchInput,
    setLinearTeamRefreshNonce,
    setNewLinearIssueBody: composer.setNewLinearIssueBody,
    setNewLinearIssueOpen: composer.setNewLinearIssueOpen,
    setNewLinearIssueProjectId: composer.setNewLinearIssueProjectId,
    setNewLinearIssueTeamId: composer.setNewLinearIssueTeamId,
    setNewLinearIssueTitle: composer.setNewLinearIssueTitle,
    setNewLinearProjectContent: composer.setNewLinearProjectContent,
    setNewLinearProjectDescription: composer.setNewLinearProjectDescription,
    setNewLinearProjectLabelIds: composer.setNewLinearProjectLabelIds,
    setNewLinearProjectLeadId: composer.setNewLinearProjectLeadId,
    setNewLinearProjectMemberIds: composer.setNewLinearProjectMemberIds,
    setNewLinearProjectName: composer.setNewLinearProjectName,
    setNewLinearProjectOpen: composer.setNewLinearProjectOpen,
    setNewLinearProjectPriority: composer.setNewLinearProjectPriority,
    setNewLinearProjectStartDate: composer.setNewLinearProjectStartDate,
    setNewLinearProjectTargetDate: composer.setNewLinearProjectTargetDate,
    setNewLinearProjectTeamId: composer.setNewLinearProjectTeamId,
    setTaskResumeState
  })
  return {
    ...detail,
    ...collection,
    ...listModel,
    ...presentation,
    ...composer,
    ...scope,
    ...toolbar,
    availableTeams,
    linearConnectOpen,
    setLinearConnectOpen,
    linearTeamRefreshNonce,
    setLinearTeamRefreshNonce
  }
}

export type TaskPageLinearController = ReturnType<typeof useTaskPageLinearController>
