import { useCallback, useMemo } from 'react'

import { buildGitHubRepoUrl } from '@/lib/github-links'
import { getClientRuntime } from '@/runtime/client-runtime'
import type { Repo } from '../../../shared/types'
import type { TaskPageGitHubRepositoryState } from './use-task-page-github-repository-state'
import type { TaskPageGitHubSearchController } from './use-task-page-github-search-controller'
import { useTaskPageGitHubListDataState } from './use-task-page-github-list-data-state'
import { useTaskPageGitHubPageNavigationState } from './use-task-page-github-page-navigation-state'
import { useTaskPageGitHubPRChecksState } from './use-task-page-github-pr-checks-state'
import type { TaskPageStoreBindings } from './use-task-page-store-bindings'

const GITHUB_TASK_GRID_CLASS =
  'min-w-[790px] grid-cols-[72px_minmax(320px,1fr)_84px_100px_92px_122px]'
const GITHUB_PR_TASK_GRID_CLASS =
  'min-w-[1020px] grid-cols-[72px_minmax(360px,2fr)_132px_128px_132px_92px_158px]'

type Props = {
  store: TaskPageStoreBindings
  github: TaskPageGitHubSearchController
  repository: TaskPageGitHubRepositoryState
  selectedRepos: Repo[]
  repoMap: ReadonlyMap<string, Repo>
  taskSource: string
  taskResumeApplied: boolean
}

export function useTaskPageGitHubListModel({
  store,
  github,
  repository,
  selectedRepos,
  repoMap,
  taskSource,
  taskResumeApplied
}: Props) {
  const {
    fetchWorkItemsAcrossRepos,
    fetchPRChecks,
    getCachedWorkItems,
    workItemsInvalidationNonce
  } = store
  const {
    activeGithubTaskKind,
    appliedTaskSearch,
    githubMode,
    retryingSourceKeys,
    setRetryingSourceKeys,
    setTasksError,
    setTasksFiltering,
    setTasksLoading,
    setTasksRefreshing,
    setFailedCount,
    setGithubUnavailable,
    taskRefreshNonce
  } = github
  const {
    countedTotalPages,
    currentPage,
    fetchWorkItemsNextPage,
    githubPageSize,
    githubPerRepoPageLimit,
    loadingTargetPage,
    paginationGenerationRef,
    paginationLoading,
    pages,
    patchTaskPageWorkItemRows,
    perRepoSourceState,
    setCountedTotalPages,
    setCurrentPage,
    setLoadingTargetPage,
    setPages,
    setPaginationLoading,
    countWorkItemsAcrossRepos
  } = repository
  const selectedGitHubRepoExternalLink = useMemo(() => {
    if (selectedRepos.length !== 1) {
      return null
    }
    const [repo] = selectedRepos
    const sourceState = perRepoSourceState.find((state) => state.repoId === repo.id)
    const sources = sourceState?.sources
    const slug =
      activeGithubTaskKind === 'issues'
        ? (sources?.issues ?? sources?.prs)
        : (sources?.prs ?? sources?.issues)
    const url = buildGitHubRepoUrl(slug)
    return url ? { url, label: slug ? `${slug.owner}/${slug.repo}` : repo.displayName } : null
  }, [activeGithubTaskKind, perRepoSourceState, selectedRepos])
  const currentPageItems = useMemo(() => pages[currentPage] ?? [], [currentPage, pages])
  const filteredWorkItems = useMemo(
    () =>
      currentPageItems.filter((item) =>
        activeGithubTaskKind === 'prs' ? item.type === 'pr' : item.type === 'issue'
      ),
    [activeGithubTaskKind, currentPageItems]
  )
  const loadedGitHubAuthorLogins = useMemo(() => {
    const seen = new Set<string>()
    const logins: string[] = []
    for (const page of pages) {
      if (!page) {
        continue
      }
      for (const item of page) {
        if (
          !item.author ||
          (activeGithubTaskKind === 'prs' ? item.type !== 'pr' : item.type !== 'issue')
        ) {
          continue
        }
        const key = item.author.toLowerCase()
        if (!seen.has(key)) {
          seen.add(key)
          logins.push(item.author)
        }
      }
    }
    return logins
  }, [activeGithubTaskKind, pages])
  const primaryGithubFilterSlug = useMemo(() => {
    for (const state of perRepoSourceState) {
      const source = activeGithubTaskKind === 'prs' ? state.sources?.prs : state.sources?.issues
      if (source) {
        return source
      }
    }
    return null
  }, [activeGithubTaskKind, perRepoSourceState])
  const showPRManagementColumns = activeGithubTaskKind === 'prs'
  const githubTaskGridClass = showPRManagementColumns
    ? GITHUB_PR_TASK_GRID_CLASS
    : GITHUB_TASK_GRID_CLASS
  const showGitHubTaskSkeletons =
    github.tasksFiltering || (github.tasksLoading && filteredWorkItems.length === 0)
  const { ensurePRChecksLoaded } = useTaskPageGitHubPRChecksState({
    fetchPRChecks,
    filteredWorkItems,
    githubMode,
    patchTaskPageWorkItemRows,
    repoMap,
    showPRManagementColumns,
    taskSource
  })
  const { handleLoadNextPage, totalPages } = useTaskPageGitHubPageNavigationState({
    appliedTaskSearch,
    countedTotalPages,
    currentPage,
    fetchWorkItemsNextPage,
    githubPageSize,
    githubPerRepoPageLimit,
    paginationGenerationRef,
    paginationLoading,
    pages,
    selectedRepos,
    setCurrentPage,
    setLoadingTargetPage,
    setPages,
    setPaginationLoading
  })

  useTaskPageGitHubListDataState({
    appliedTaskSearch,
    countWorkItemsAcrossRepos,
    fetchWorkItemsAcrossRepos,
    getCachedWorkItems,
    githubMode,
    githubPageSize,
    githubPerRepoPageLimit,
    retryingSourceKeys,
    selectedRepos,
    setCountedTotalPages,
    setCurrentPage,
    setFailedCount,
    setGithubUnavailable,
    setPages,
    setRetryingSourceKeys,
    setTasksError,
    setTasksFiltering,
    setTasksLoading,
    setTasksRefreshing,
    taskRefreshNonce,
    taskResumeApplied,
    taskSource,
    workItemsInvalidationNonce
  })

  const openSelectedGithubRepo = useCallback(() => {
    if (selectedGitHubRepoExternalLink?.url) {
      void getClientRuntime().shell.openUrl(selectedGitHubRepoExternalLink.url)
    }
  }, [selectedGitHubRepoExternalLink])

  return {
    selectedGitHubRepoExternalLink,
    openSelectedGithubRepo,
    filteredWorkItems,
    loadedGitHubAuthorLogins,
    primaryGithubFilterSlug,
    showPRManagementColumns,
    githubTaskGridClass,
    showGitHubTaskSkeletons,
    ensurePRChecksLoaded,
    handleLoadNextPage,
    totalPages,
    loadingTargetPage,
    pages,
    currentPage,
    setCurrentPage
  }
}

export type TaskPageGitHubListModel = ReturnType<typeof useTaskPageGitHubListModel>
