import { useCallback, useEffect, useMemo } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import {
  LINEAR_ISSUE_LIST_MAX,
  clampLinearIssueListLimit
} from '../../../shared/linear-issue-read-limits'
import type {
  LinearCustomViewSummary,
  LinearIssue,
  LinearProjectSummary
} from '../../../shared/types'
import { getLinearIssuePageState } from './task-page-linear-list-model'

const LINEAR_ITEM_LIMIT = 36

type TaskPageLinearIssuePaginationStateProps = {
  activeLinearIssueCanRequestMore: boolean
  activeLinearIssueError: string | null
  activeLinearIssueLimit: number
  activeLinearIssueLoading: boolean
  activeLinearIssueLoadingTargetPage: number | null
  activeLinearIssuePage: number
  linearProjectTab: string
  loadedLinearIssues: LinearIssue[]
  selectedLinearCustomView: LinearCustomViewSummary | null
  selectedLinearProject: LinearProjectSummary | null
  setLinearCustomViewIssueLoadingTargetPage: Dispatch<SetStateAction<number | null>>
  setLinearCustomViewIssuePage: Dispatch<SetStateAction<number>>
  setLinearCustomViewIssueLimit: Dispatch<SetStateAction<number>>
  setLinearIssueLoadingTargetPage: Dispatch<SetStateAction<number | null>>
  setLinearIssuePage: Dispatch<SetStateAction<number>>
  setLinearIssueLimit: Dispatch<SetStateAction<number>>
  setLinearProjectIssueLoadingTargetPage: Dispatch<SetStateAction<number | null>>
  setLinearProjectIssuePage: Dispatch<SetStateAction<number>>
  setLinearProjectIssueLimit: Dispatch<SetStateAction<number>>
}

export function useTaskPageLinearIssuePaginationState({
  activeLinearIssueCanRequestMore,
  activeLinearIssueError,
  activeLinearIssueLimit,
  activeLinearIssueLoading,
  activeLinearIssueLoadingTargetPage,
  activeLinearIssuePage,
  linearProjectTab,
  loadedLinearIssues,
  selectedLinearCustomView,
  selectedLinearProject,
  setLinearCustomViewIssueLoadingTargetPage,
  setLinearCustomViewIssuePage,
  setLinearCustomViewIssueLimit,
  setLinearIssueLoadingTargetPage,
  setLinearIssuePage,
  setLinearIssueLimit,
  setLinearProjectIssueLoadingTargetPage,
  setLinearProjectIssuePage,
  setLinearProjectIssueLimit
}: TaskPageLinearIssuePaginationStateProps) {
  const linearIssuePageState = useMemo(
    () =>
      getLinearIssuePageState(
        loadedLinearIssues,
        activeLinearIssuePage,
        LINEAR_ITEM_LIMIT,
        activeLinearIssueCanRequestMore
      ),
    [activeLinearIssueCanRequestMore, activeLinearIssuePage, loadedLinearIssues]
  )
  const {
    loadedPages: loadedLinearIssuePages,
    totalPages: linearIssueTotalPages,
    visiblePage: visibleLinearIssuePage,
    issues: pagedLinearIssues
  } = linearIssuePageState
  const showLinearIssuePagination =
    loadedLinearIssues.length > 0 &&
    !activeLinearIssueError &&
    linearIssueTotalPages > 1 &&
    !(activeLinearIssueLoading && loadedLinearIssues.length === 0)

  const setActiveLinearIssuePage = useCallback(
    (page: number) => {
      if (selectedLinearProject && linearProjectTab === 'issues') {
        setLinearProjectIssuePage(page)
      } else if (selectedLinearCustomView?.model === 'issue') {
        setLinearCustomViewIssuePage(page)
      } else {
        setLinearIssuePage(page)
      }
    },
    [
      linearProjectTab,
      selectedLinearCustomView?.model,
      selectedLinearProject,
      setLinearCustomViewIssuePage,
      setLinearIssuePage,
      setLinearProjectIssuePage
    ]
  )

  const setActiveLinearIssueLoadingTargetPage = useCallback(
    (page: number | null) => {
      if (selectedLinearProject && linearProjectTab === 'issues') {
        setLinearProjectIssueLoadingTargetPage(page)
      } else if (selectedLinearCustomView?.model === 'issue') {
        setLinearCustomViewIssueLoadingTargetPage(page)
      } else {
        setLinearIssueLoadingTargetPage(page)
      }
    },
    [
      linearProjectTab,
      selectedLinearCustomView?.model,
      selectedLinearProject,
      setLinearCustomViewIssueLoadingTargetPage,
      setLinearIssueLoadingTargetPage,
      setLinearProjectIssueLoadingTargetPage
    ]
  )

  const ensureActiveLinearIssueLimit = useCallback(
    (targetLimit: number) => {
      const nextLimit = Math.min(clampLinearIssueListLimit(targetLimit), LINEAR_ISSUE_LIST_MAX)
      if (selectedLinearProject && linearProjectTab === 'issues') {
        setLinearProjectIssueLimit((limit) => Math.max(limit, nextLimit))
      } else if (selectedLinearCustomView?.model === 'issue') {
        setLinearCustomViewIssueLimit((limit) => Math.max(limit, nextLimit))
      } else {
        setLinearIssueLimit((limit) => Math.max(limit, nextLimit))
      }
    },
    [
      linearProjectTab,
      selectedLinearCustomView?.model,
      selectedLinearProject,
      setLinearCustomViewIssueLimit,
      setLinearIssueLimit,
      setLinearProjectIssueLimit
    ]
  )

  const handleLinearIssuePageChange = useCallback(
    (page: number) => {
      if (page < loadedLinearIssuePages) {
        setActiveLinearIssuePage(page)
        setActiveLinearIssueLoadingTargetPage(null)
        return
      }

      // Why: Linear reads are cached as an expanded prefix; a page jump expands it and commits once enough rows arrive.
      setActiveLinearIssueLoadingTargetPage(page)
      ensureActiveLinearIssueLimit((page + 1) * LINEAR_ITEM_LIMIT)
    },
    [
      ensureActiveLinearIssueLimit,
      loadedLinearIssuePages,
      setActiveLinearIssueLoadingTargetPage,
      setActiveLinearIssuePage
    ]
  )

  const showLinearEmptyFilteredLoadMore =
    loadedLinearIssues.length === 0 && !activeLinearIssueError && activeLinearIssueCanRequestMore
  const handleLinearEmptyFilteredLoadMore = useCallback(() => {
    setActiveLinearIssueLoadingTargetPage(null)
    ensureActiveLinearIssueLimit(activeLinearIssueLimit + LINEAR_ITEM_LIMIT)
  }, [activeLinearIssueLimit, ensureActiveLinearIssueLimit, setActiveLinearIssueLoadingTargetPage])

  useEffect(() => {
    if (activeLinearIssueLoading || activeLinearIssueLoadingTargetPage === null) {
      return
    }

    const maxLoadedPage = Math.max(0, loadedLinearIssuePages - 1)
    const targetPageLoaded = activeLinearIssueLoadingTargetPage <= maxLoadedPage
    const targetPageCannotLoad =
      !activeLinearIssueCanRequestMore || activeLinearIssueLimit >= LINEAR_ISSUE_LIST_MAX
    if (targetPageLoaded || targetPageCannotLoad) {
      setActiveLinearIssuePage(Math.min(activeLinearIssueLoadingTargetPage, maxLoadedPage))
      setActiveLinearIssueLoadingTargetPage(null)
      return
    }

    // Why: local filtering can leave the next page short, so keep expanding the prefix until the page exists or Linear is exhausted.
    ensureActiveLinearIssueLimit(activeLinearIssueLimit + LINEAR_ITEM_LIMIT)
  }, [
    activeLinearIssueCanRequestMore,
    activeLinearIssueLimit,
    activeLinearIssueLoading,
    activeLinearIssueLoadingTargetPage,
    ensureActiveLinearIssueLimit,
    loadedLinearIssuePages,
    setActiveLinearIssueLoadingTargetPage,
    setActiveLinearIssuePage
  ])

  useEffect(() => {
    if (
      activeLinearIssueLoadingTargetPage !== null ||
      activeLinearIssuePage <= visibleLinearIssuePage
    ) {
      return
    }
    setActiveLinearIssuePage(visibleLinearIssuePage)
  }, [
    activeLinearIssueLoadingTargetPage,
    activeLinearIssuePage,
    setActiveLinearIssuePage,
    visibleLinearIssuePage
  ])

  return {
    handleLinearEmptyFilteredLoadMore,
    handleLinearIssuePageChange,
    pagedLinearIssues,
    showLinearEmptyFilteredLoadMore,
    showLinearIssuePagination,
    visibleLinearIssuePage,
    linearIssueTotalPages
  }
}
