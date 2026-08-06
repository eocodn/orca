import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'

import { translate } from '@/i18n/i18n'
import type { AppState } from '@/store'
import type { LinearIssueAttributeFilter } from '../../../shared/linear-issue-attribute-filter'
import { emptyLinearIssueAttributeFilter } from '../../../shared/linear-issue-attribute-filter'
import type {
  LinearCollectionResult,
  LinearCustomViewSummary,
  LinearIssue,
  LinearProjectDetail,
  LinearProjectSummary
} from '../../../shared/types'
import type {
  LinearDisplayProperty,
  LinearGroupBy,
  LinearMode,
  LinearOrderBy,
  LinearViewMode
} from './task-page-localized-options'
import { DEFAULT_LINEAR_DISPLAY_PROPERTIES } from './task-page-linear-model'

const LINEAR_ITEM_LIMIT = 36

export type LinearProjectTab = 'overview' | 'issues'

type Props = {
  clearSelectedLinearIssue: () => void
  setTaskResumeState: AppState['setTaskResumeState']
}

export function useTaskPageLinearCollectionController({
  clearSelectedLinearIssue,
  setTaskResumeState
}: Props) {
  const [linearMode, setLinearMode] = useState<LinearMode>('issues')
  const [linearIssues, setLinearIssues] = useState<LinearIssue[]>([])
  const [linearIssueLimit, setLinearIssueLimit] = useState(LINEAR_ITEM_LIMIT)
  const [linearIssuePage, setLinearIssuePage] = useState(0)
  const [linearIssueLoadingTargetPage, setLinearIssueLoadingTargetPage] = useState<number | null>(
    null
  )
  const [linearIssuesHasMore, setLinearIssuesHasMore] = useState(false)
  const [linearLoading, setLinearLoading] = useState(false)
  const [linearError, setLinearError] = useState<string | null>(null)
  const [linearSearchInput, setLinearSearchInput] = useState('')
  const [appliedLinearSearch, setAppliedLinearSearch] = useState('')
  const [linearAttributeFilter, setLinearAttributeFilter] = useState<LinearIssueAttributeFilter>(
    () => emptyLinearIssueAttributeFilter()
  )
  const linearPrimaryTeamIdRef = useRef<string | null>(null)
  const previousLinearWorkspaceIdForFiltersRef = useRef<string | null | undefined>(undefined)
  const [linearViewMode, setLinearViewMode] = useState<LinearViewMode>('list')
  const [linearGroupBy, setLinearGroupBy] = useState<LinearGroupBy>('none')
  const [linearOrderBy, setLinearOrderBy] = useState<LinearOrderBy>('priority')
  const [linearDisplayProperties, setLinearDisplayProperties] = useState<
    ReadonlySet<LinearDisplayProperty>
  >(() => new Set(DEFAULT_LINEAR_DISPLAY_PROPERTIES))
  const [linearTeamPropertyTouched, setLinearTeamPropertyTouched] = useState(false)
  const [linearRefreshNonce, setLinearRefreshNonce] = useState(0)
  const [linearProjectSearchInput, setLinearProjectSearchInput] = useState('')
  const [appliedLinearProjectSearch, setAppliedLinearProjectSearch] = useState('')
  const [linearProjectsResult, setLinearProjectsResult] = useState<
    LinearCollectionResult<LinearProjectSummary>
  >({ items: [] })
  const [linearProjectsLoading, setLinearProjectsLoading] = useState(false)
  const [linearProjectsError, setLinearProjectsError] = useState<string | null>(null)
  const [selectedLinearProject, setSelectedLinearProject] = useState<LinearProjectSummary | null>(
    null
  )
  const [selectedLinearProjectDetail, setSelectedLinearProjectDetail] =
    useState<LinearProjectDetail | null>(null)
  const [linearProjectDetailLoading, setLinearProjectDetailLoading] = useState(false)
  const [linearProjectDetailError, setLinearProjectDetailError] = useState<string | null>(null)
  const [linearProjectTab, setLinearProjectTab] = useState<LinearProjectTab>('overview')
  const [linearProjectIssuesResult, setLinearProjectIssuesResult] = useState<
    LinearCollectionResult<LinearIssue>
  >({ items: [] })
  const [linearProjectIssueLimit, setLinearProjectIssueLimit] = useState(LINEAR_ITEM_LIMIT)
  const [linearProjectIssuePage, setLinearProjectIssuePage] = useState(0)
  const [linearProjectIssueLoadingTargetPage, setLinearProjectIssueLoadingTargetPage] = useState<
    number | null
  >(null)
  const [linearProjectIssuesLoading, setLinearProjectIssuesLoading] = useState(false)
  const [linearProjectIssuesError, setLinearProjectIssuesError] = useState<string | null>(null)
  const [linearCustomViewsResult, setLinearCustomViewsResult] = useState<
    LinearCollectionResult<LinearCustomViewSummary>
  >({ items: [] })
  const [linearCustomViewsLoading, setLinearCustomViewsLoading] = useState(false)
  const [linearCustomViewsError, setLinearCustomViewsError] = useState<string | null>(null)
  const [selectedLinearCustomView, setSelectedLinearCustomView] =
    useState<LinearCustomViewSummary | null>(null)
  const [linearProjectParentView, setLinearProjectParentView] =
    useState<LinearCustomViewSummary | null>(null)
  const [linearCustomViewIssuesResult, setLinearCustomViewIssuesResult] = useState<
    LinearCollectionResult<LinearIssue>
  >({ items: [] })
  const [linearCustomViewIssueLimit, setLinearCustomViewIssueLimit] = useState(LINEAR_ITEM_LIMIT)
  const [linearCustomViewIssuePage, setLinearCustomViewIssuePage] = useState(0)
  const [linearCustomViewIssueLoadingTargetPage, setLinearCustomViewIssueLoadingTargetPage] =
    useState<number | null>(null)
  const [linearCustomViewProjectsResult, setLinearCustomViewProjectsResult] = useState<
    LinearCollectionResult<LinearProjectSummary>
  >({ items: [] })
  const [linearCustomViewContentsLoading, setLinearCustomViewContentsLoading] = useState(false)
  const [linearCustomViewContentsError, setLinearCustomViewContentsError] = useState<string | null>(
    null
  )
  const linearContextResumeAttemptedRef = useRef(false)

  const patchScopedLinearIssue = useCallback((issueId: string, patch: Partial<LinearIssue>) => {
    const patchResult = (result: LinearCollectionResult<LinearIssue>) => ({
      ...result,
      items: result.items.map((item) => (item.id === issueId ? { ...item, ...patch } : item))
    })
    setLinearProjectIssuesResult(patchResult)
    setLinearCustomViewIssuesResult(patchResult)
  }, [])

  const resetIssueCollections = useCallback(() => {
    setLinearProjectIssuesResult({ items: [] })
    setLinearProjectIssueLimit(LINEAR_ITEM_LIMIT)
    setLinearProjectIssuePage(0)
    setLinearProjectIssueLoadingTargetPage(null)
    setLinearCustomViewIssuesResult({ items: [] })
    setLinearCustomViewIssueLimit(LINEAR_ITEM_LIMIT)
    setLinearCustomViewIssuePage(0)
    setLinearCustomViewIssueLoadingTargetPage(null)
  }, [])

  const selectLinearMode = useCallback(
    (mode: LinearMode) => {
      clearSelectedLinearIssue()
      setSelectedLinearProject(null)
      setSelectedLinearProjectDetail(null)
      setSelectedLinearCustomView(null)
      setLinearProjectParentView(null)
      resetIssueCollections()
      setLinearCustomViewProjectsResult({ items: [] })
      setLinearMode(mode)
      setTaskResumeState({ linearMode: mode, linearContext: undefined })
    },
    [clearSelectedLinearIssue, resetIssueCollections, setTaskResumeState]
  )

  const openLinearProjectContext = useCallback(
    (project: LinearProjectSummary, options?: { parentView?: LinearCustomViewSummary | null }) => {
      if (!project.workspaceId) {
        toast.error(
          translate(
            'auto.components.TaskPage.cba2a2b7fb',
            'Linear project is missing workspace context.'
          )
        )
        return
      }
      const parentView = options?.parentView ?? null
      clearSelectedLinearIssue()
      setLinearProjectParentView(parentView)
      if (parentView) {
        setSelectedLinearCustomView(parentView)
      } else {
        setSelectedLinearCustomView(null)
        setLinearCustomViewProjectsResult({ items: [] })
      }
      resetIssueCollections()
      setSelectedLinearProject(project)
      setLinearProjectTab('overview')
      setLinearMode('projects')
      setTaskResumeState({
        linearMode: 'projects',
        linearContext: { kind: 'project', id: project.id, workspaceId: project.workspaceId }
      })
    },
    [clearSelectedLinearIssue, resetIssueCollections, setTaskResumeState]
  )

  const openLinearCustomViewContext = useCallback(
    (view: LinearCustomViewSummary) => {
      if (!view.workspaceId) {
        toast.error(
          translate(
            'auto.components.TaskPage.669e419d65',
            'Linear view is missing workspace context.'
          )
        )
        return
      }
      clearSelectedLinearIssue()
      setSelectedLinearProject(null)
      setSelectedLinearProjectDetail(null)
      setLinearProjectParentView(null)
      resetIssueCollections()
      setLinearCustomViewProjectsResult({ items: [] })
      setSelectedLinearCustomView(view)
      setLinearMode('views')
      setTaskResumeState({
        linearMode: 'views',
        linearContext: {
          kind: 'view',
          id: view.id,
          workspaceId: view.workspaceId,
          model: view.model
        }
      })
    },
    [clearSelectedLinearIssue, resetIssueCollections, setTaskResumeState]
  )

  return {
    linearMode,
    setLinearMode,
    linearIssues,
    setLinearIssues,
    linearIssueLimit,
    setLinearIssueLimit,
    linearIssuePage,
    setLinearIssuePage,
    linearIssueLoadingTargetPage,
    setLinearIssueLoadingTargetPage,
    linearIssuesHasMore,
    setLinearIssuesHasMore,
    linearLoading,
    setLinearLoading,
    linearError,
    setLinearError,
    linearSearchInput,
    setLinearSearchInput,
    appliedLinearSearch,
    setAppliedLinearSearch,
    linearAttributeFilter,
    setLinearAttributeFilter,
    linearPrimaryTeamIdRef,
    previousLinearWorkspaceIdForFiltersRef,
    linearViewMode,
    setLinearViewMode,
    linearGroupBy,
    setLinearGroupBy,
    linearOrderBy,
    setLinearOrderBy,
    linearDisplayProperties,
    setLinearDisplayProperties,
    linearTeamPropertyTouched,
    setLinearTeamPropertyTouched,
    linearRefreshNonce,
    setLinearRefreshNonce,
    linearProjectSearchInput,
    setLinearProjectSearchInput,
    appliedLinearProjectSearch,
    setAppliedLinearProjectSearch,
    linearProjectsResult,
    setLinearProjectsResult,
    linearProjectsLoading,
    setLinearProjectsLoading,
    linearProjectsError,
    setLinearProjectsError,
    selectedLinearProject,
    setSelectedLinearProject,
    selectedLinearProjectDetail,
    setSelectedLinearProjectDetail,
    linearProjectDetailLoading,
    setLinearProjectDetailLoading,
    linearProjectDetailError,
    setLinearProjectDetailError,
    linearProjectTab,
    setLinearProjectTab,
    linearProjectIssuesResult,
    setLinearProjectIssuesResult,
    linearProjectIssueLimit,
    setLinearProjectIssueLimit,
    linearProjectIssuePage,
    setLinearProjectIssuePage,
    linearProjectIssueLoadingTargetPage,
    setLinearProjectIssueLoadingTargetPage,
    linearProjectIssuesLoading,
    setLinearProjectIssuesLoading,
    linearProjectIssuesError,
    setLinearProjectIssuesError,
    linearCustomViewsResult,
    setLinearCustomViewsResult,
    linearCustomViewsLoading,
    setLinearCustomViewsLoading,
    linearCustomViewsError,
    setLinearCustomViewsError,
    selectedLinearCustomView,
    setSelectedLinearCustomView,
    linearProjectParentView,
    setLinearProjectParentView,
    linearCustomViewIssuesResult,
    setLinearCustomViewIssuesResult,
    linearCustomViewIssueLimit,
    setLinearCustomViewIssueLimit,
    linearCustomViewIssuePage,
    setLinearCustomViewIssuePage,
    linearCustomViewIssueLoadingTargetPage,
    setLinearCustomViewIssueLoadingTargetPage,
    linearCustomViewProjectsResult,
    setLinearCustomViewProjectsResult,
    linearCustomViewContentsLoading,
    setLinearCustomViewContentsLoading,
    linearCustomViewContentsError,
    setLinearCustomViewContentsError,
    linearContextResumeAttemptedRef,
    patchScopedLinearIssue,
    selectLinearMode,
    openLinearProjectContext,
    openLinearCustomViewContext
  }
}

export type TaskPageLinearCollectionController = ReturnType<
  typeof useTaskPageLinearCollectionController
>
