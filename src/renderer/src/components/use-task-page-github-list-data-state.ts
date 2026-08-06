import { useEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { AppState } from '@/store'
import { getTaskPageRepoSourceContext } from './task-page-source-context'
import { stripRepoQualifiers } from '../../../shared/task-query'
import {
  deriveTaskPageGitHubWorkItemsFetchOptions,
  reconcileTaskPagePagesAfterLandingRefresh,
  shouldResetTaskPagePaginationAfterLandingRefresh,
  shouldReplaceTaskPageItemsAfterRefresh
} from '@/components/task-page-cache-selectors'
import { sortWorkItemsByNumber } from '../../../shared/work-items'
import type { GitHubWorkItem, Repo } from '../../../shared/types'

type TaskPageGitHubListDataStateProps = {
  appliedTaskSearch: string
  countWorkItemsAcrossRepos: AppState['countWorkItemsAcrossRepos']
  fetchWorkItemsAcrossRepos: AppState['fetchWorkItemsAcrossRepos']
  getCachedWorkItems: AppState['getCachedWorkItems']
  githubMode: string
  githubPageSize: number
  githubPerRepoPageLimit: number
  selectedRepos: Repo[]
  setCountedTotalPages: Dispatch<SetStateAction<number | null>>
  setCurrentPage: Dispatch<SetStateAction<number>>
  setFailedCount: Dispatch<SetStateAction<number>>
  setGithubUnavailable: Dispatch<SetStateAction<boolean>>
  setPages: Dispatch<SetStateAction<(GitHubWorkItem[] | null)[]>>
  setRetryingSourceKeys: Dispatch<SetStateAction<ReadonlySet<string>>>
  setTasksError: Dispatch<SetStateAction<string | null>>
  setTasksFiltering: Dispatch<SetStateAction<boolean>>
  setTasksLoading: Dispatch<SetStateAction<boolean>>
  setTasksRefreshing: Dispatch<SetStateAction<boolean>>
  taskRefreshNonce: number
  taskResumeApplied: boolean
  taskSource: string
  workItemsInvalidationNonce: number
  retryingSourceKeys: ReadonlySet<string>
}

export function useTaskPageGitHubListDataState({
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
}: TaskPageGitHubListDataStateProps): void {
  const lastFetchedNonceRef = useRef(-1)
  const lastFetchedInvalidationNonceRef = useRef(0)
  const landingGitHubRefreshKeysRef = useRef<ReadonlySet<string>>(new Set())

  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    if (taskSource !== 'github' || githubMode !== 'items') {
      setRetryingSourceKeys(new Set())
      setTasksRefreshing(false)
      setTasksFiltering(false)
      return
    }
    if (selectedRepos.length === 0) {
      setRetryingSourceKeys(new Set())
      setTasksRefreshing(false)
      setTasksFiltering(false)
      return
    }

    const query = stripRepoQualifiers(appliedTaskSearch.trim())
    let cancelled = false
    const preMerged: GitHubWorkItem[] = []
    let anyUncached = false
    let anyRepoCached = false
    for (const repo of selectedRepos) {
      const cached = getCachedWorkItems(
        repo.id,
        githubPerRepoPageLimit,
        query,
        repo.path,
        getTaskPageRepoSourceContext(repo, 'github')
      )
      if (cached === null) {
        anyUncached = true
      } else {
        anyRepoCached = true
        preMerged.push(...cached)
      }
    }
    const page0 =
      preMerged.length > 0 ? sortWorkItemsByNumber(preMerged).slice(0, githubPageSize) : []
    setPages([page0])
    setCurrentPage(0)
    setCountedTotalPages(null)
    setTasksError(null)
    setFailedCount(0)
    setGithubUnavailable(false)
    setTasksLoading(anyUncached)

    const forceRefresh = taskRefreshNonce !== lastFetchedNonceRef.current
    lastFetchedNonceRef.current = taskRefreshNonce
    const preferenceInvalidated =
      workItemsInvalidationNonce !== lastFetchedInvalidationNonceRef.current
    lastFetchedInvalidationNonceRef.current = workItemsInvalidationNonce
    const forcedFetch = (forceRefresh && taskRefreshNonce > 0) || preferenceInvalidated
    const repoArgs = selectedRepos.map((repo) => ({
      repoId: repo.id,
      path: repo.path,
      executionHostId: repo.executionHostId,
      sourceContext: getTaskPageRepoSourceContext(repo, 'github')
    }))
    const landingRefreshKey = `${repoArgs.map((repo) => `${repo.repoId}:${repo.path}`).join('|')}::${query}`
    const shouldProbeOnLanding =
      !forcedFetch && anyRepoCached && !landingGitHubRefreshKeysRef.current.has(landingRefreshKey)
    if (shouldProbeOnLanding) {
      landingGitHubRefreshKeysRef.current = new Set([
        ...landingGitHubRefreshKeysRef.current,
        landingRefreshKey
      ])
    }
    setTasksRefreshing(forcedFetch)

    const dispatchedRetrySourceKeys = retryingSourceKeys
    void fetchWorkItemsAcrossRepos(repoArgs, githubPerRepoPageLimit, githubPageSize, query, {
      ...deriveTaskPageGitHubWorkItemsFetchOptions(forcedFetch, shouldProbeOnLanding)
    })
      .then(({ items, failedCount: failed, githubUnavailable: unavailable }) => {
        clearRetryingSourceKeys(dispatchedRetrySourceKeys, setRetryingSourceKeys)
        if (cancelled) {
          return
        }
        if (shouldProbeOnLanding) {
          const replaceFirstPage = shouldReplaceTaskPageItemsAfterRefresh(page0, items)
          const resetPagination = shouldResetTaskPagePaginationAfterLandingRefresh(page0, items)
          setPages((current) => reconcileTaskPagePagesAfterLandingRefresh(current, items))
          if (replaceFirstPage || resetPagination) {
            setCurrentPage(0)
          }
        } else {
          setPages([items])
          setCurrentPage(0)
        }
        setFailedCount(failed)
        setGithubUnavailable(unavailable)
        setTasksLoading(false)
        setTasksRefreshing(false)
        setTasksFiltering(false)
      })
      .catch((error) => {
        clearRetryingSourceKeys(dispatchedRetrySourceKeys, setRetryingSourceKeys)
        if (cancelled) {
          return
        }
        setTasksError(error instanceof Error ? error.message : 'Failed to load GitHub work.')
        setFailedCount(0)
        setGithubUnavailable(false)
        setTasksLoading(false)
        setTasksRefreshing(false)
        setTasksFiltering(false)
      })

    void countWorkItemsAcrossRepos(
      selectedRepos.map((repo) => ({
        repoId: repo.id,
        path: repo.path,
        executionHostId: repo.executionHostId,
        sourceContext: getTaskPageRepoSourceContext(repo, 'github')
      })),
      query,
      githubPerRepoPageLimit
    ).then(({ totalPages: countedPages }) => {
      if (!cancelled) {
        setCountedTotalPages(countedPages)
      }
    })

    return () => {
      cancelled = true
    }
    // Why: store selectors are stable; invalidation nonce remains an explicit fetch boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedRepos,
    appliedTaskSearch,
    taskRefreshNonce,
    taskSource,
    githubMode,
    workItemsInvalidationNonce,
    taskResumeApplied
  ])
}

function clearRetryingSourceKeys(
  dispatchedRetrySourceKeys: ReadonlySet<string>,
  setRetryingSourceKeys: Dispatch<SetStateAction<ReadonlySet<string>>>
): void {
  setRetryingSourceKeys((previous) => {
    if (dispatchedRetrySourceKeys.size === 0) {
      return previous
    }
    const next = new Set(previous)
    for (const key of dispatchedRetrySourceKeys) {
      next.delete(key)
    }
    return next
  })
}
