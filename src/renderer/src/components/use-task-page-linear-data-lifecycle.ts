import { useEffect } from 'react'
import type { MutableRefObject } from 'react'

import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { LinearWorkspaceSelection } from '../../../shared/types'
import type { TaskPageLinearCollectionController } from './use-task-page-linear-collection-controller'
import type { TaskPageLinearListModel } from './use-task-page-linear-list-model'
import type { TaskPageStoreBindings } from './use-task-page-store-bindings'
import { useTaskPageLinearCustomViewDataState } from './use-task-page-linear-custom-view-data-state'
import { useTaskPageLinearIssueListDataState } from './use-task-page-linear-issue-list-data-state'
import { useTaskPageLinearProjectDetailState } from './use-task-page-linear-project-detail-state'
import { useTaskPageLinearProjectIssuesState } from './use-task-page-linear-project-issues-state'
import { useTaskPageLinearProjectListDataState } from './use-task-page-linear-project-list-data-state'

const TASK_SEARCH_DEBOUNCE_MS = 300
const LINEAR_ITEM_LIMIT = 36

type Props = {
  store: TaskPageStoreBindings
  collection: TaskPageLinearCollectionController
  listModel: TaskPageLinearListModel
  taskResumeApplied: boolean
  linearSearchPersistReadyRef: MutableRefObject<boolean>
  linearConnected: boolean
  linearTaskSourceContext: TaskSourceContext | null
  linearListInvalidationVersionForSource: number
  selectedLinearWorkspaceId: LinearWorkspaceSelection
  taskSource: string
  selectedLinearIssueCanFloat: boolean
  selectedLinearIssueId: string | null
  clearSelectedLinearIssue: () => void
}

export function useTaskPageLinearDataLifecycle({
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
  selectedLinearIssueCanFloat,
  selectedLinearIssueId,
  clearSelectedLinearIssue
}: Props): void {
  const {
    setTaskResumeState,
    getCachedLinearIssues,
    listLinearIssues,
    searchLinearIssues,
    getCachedLinearProjects,
    listLinearProjectsFromStore,
    fetchLinearProject,
    listLinearProjectIssues,
    getCachedLinearCustomViews,
    listLinearCustomViews,
    listLinearCustomViewIssues,
    listLinearCustomViewProjects
  } = store
  const {
    linearMode,
    linearIssueLimit,
    linearSearchInput,
    appliedLinearSearch,
    linearAttributeFilter,
    linearRefreshNonce,
    linearProjectSearchInput,
    appliedLinearProjectSearch,
    selectedLinearProject,
    linearProjectTab,
    linearProjectIssueLimit,
    selectedLinearCustomView,
    linearCustomViewIssueLimit,
    setAppliedLinearSearch,
    setLinearIssueLimit,
    setLinearIssuePage,
    setLinearIssueLoadingTargetPage,
    setLinearError,
    setLinearIssues,
    setLinearIssuesHasMore,
    setLinearLoading,
    setAppliedLinearProjectSearch,
    setLinearProjectsError,
    setLinearProjectsLoading,
    setLinearProjectsResult,
    setLinearProjectDetailError,
    setLinearProjectDetailLoading,
    setLinearProjectParentView,
    setSelectedLinearProject,
    setSelectedLinearProjectDetail,
    setLinearProjectIssuesError,
    setLinearProjectIssuesLoading,
    setLinearProjectIssuesResult,
    setLinearCustomViewContentsError,
    setLinearCustomViewContentsLoading,
    setLinearCustomViewIssuesResult,
    setLinearCustomViewProjectsResult,
    setLinearCustomViewsError,
    setLinearCustomViewsLoading,
    setLinearCustomViewsResult
  } = collection

  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    const timeout = window.setTimeout(() => {
      setAppliedLinearSearch(linearSearchInput)
    }, TASK_SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [linearSearchInput, setAppliedLinearSearch, taskResumeApplied])

  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    if (!linearSearchPersistReadyRef.current) {
      linearSearchPersistReadyRef.current = true
      return
    }
    setTaskResumeState({ linearQuery: appliedLinearSearch.trim() })
  }, [appliedLinearSearch, linearSearchPersistReadyRef, setTaskResumeState, taskResumeApplied])

  useEffect(() => {
    setLinearIssueLimit(LINEAR_ITEM_LIMIT)
    setLinearIssuePage(0)
    setLinearIssueLoadingTargetPage(null)
  }, [
    appliedLinearSearch,
    linearMode,
    selectedLinearCustomView?.id,
    selectedLinearProject?.id,
    selectedLinearWorkspaceId,
    setLinearIssueLimit,
    setLinearIssueLoadingTargetPage,
    setLinearIssuePage,
    taskSource
  ])

  useTaskPageLinearIssueListDataState({
    appliedLinearSearch,
    getCachedLinearIssues,
    linearAttributeFilter,
    linearConnected,
    linearIssueLimit,
    linearListInvalidationVersionForSource,
    linearMode,
    linearRefreshNonce,
    linearTaskSourceContext,
    listLinearIssues,
    searchLinearIssues,
    selectedLinearWorkspaceId,
    setLinearError,
    setLinearIssues,
    setLinearIssuesHasMore,
    setLinearLoading,
    taskResumeApplied,
    taskSource
  })

  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    const timeout = window.setTimeout(() => {
      setAppliedLinearProjectSearch(linearProjectSearchInput)
    }, TASK_SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [linearProjectSearchInput, setAppliedLinearProjectSearch, taskResumeApplied])

  useTaskPageLinearProjectListDataState({
    appliedLinearProjectSearch,
    getCachedLinearProjects,
    linearConnected,
    linearMode,
    linearRefreshNonce,
    linearTaskSourceContext,
    listLinearProjectsFromStore,
    selectedLinearProject,
    selectedLinearWorkspaceId,
    setLinearProjectsError,
    setLinearProjectsLoading,
    setLinearProjectsResult,
    taskResumeApplied,
    taskSource
  })
  useTaskPageLinearProjectDetailState({
    fetchLinearProject,
    linearRefreshNonce,
    linearTaskSourceContext,
    selectedLinearProject,
    setLinearProjectDetailError,
    setLinearProjectDetailLoading,
    setLinearProjectParentView,
    setLinearProjectsError,
    setSelectedLinearProject,
    setSelectedLinearProjectDetail,
    setTaskResumeState
  })
  useTaskPageLinearProjectIssuesState({
    linearProjectIssueLimit,
    linearProjectTab,
    linearRefreshNonce,
    linearTaskSourceContext,
    listLinearProjectIssues,
    selectedLinearProject,
    setLinearProjectIssuesError,
    setLinearProjectIssuesLoading,
    setLinearProjectIssuesResult
  })
  useTaskPageLinearCustomViewDataState({
    getCachedLinearCustomViews,
    linearConnected,
    linearCustomViewIssueLimit,
    linearMode,
    linearRefreshNonce,
    linearTaskSourceContext,
    listLinearCustomViewIssues,
    listLinearCustomViewProjects,
    listLinearCustomViews,
    selectedLinearCustomView,
    selectedLinearWorkspaceId,
    setLinearCustomViewContentsError,
    setLinearCustomViewContentsLoading,
    setLinearCustomViewIssuesResult,
    setLinearCustomViewProjectsResult,
    setLinearCustomViewsError,
    setLinearCustomViewsLoading,
    setLinearCustomViewsResult,
    taskResumeApplied,
    taskSource
  })

  useEffect(() => {
    if (!taskResumeApplied || taskSource !== 'linear') {
      return
    }
    if (!linearConnected) {
      clearSelectedLinearIssue()
      return
    }
    if (listModel.filteredLinearIssues.length === 0) {
      if (!selectedLinearIssueCanFloat) {
        clearSelectedLinearIssue()
      }
      return
    }
    if (
      selectedLinearIssueId &&
      !selectedLinearIssueCanFloat &&
      !listModel.filteredLinearIssues.some((issue) => issue.id === selectedLinearIssueId)
    ) {
      clearSelectedLinearIssue()
    }
  }, [
    clearSelectedLinearIssue,
    linearConnected,
    listModel.filteredLinearIssues,
    selectedLinearIssueCanFloat,
    selectedLinearIssueId,
    taskResumeApplied,
    taskSource
  ])
}
