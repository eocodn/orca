import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

import type { AppState } from '@/store'
import { stripRepoQualifiers } from '../../../shared/task-query'
import type { GitHubWorkItem, Repo } from '../../../shared/types'
import { getTaskPageRepoSourceContext } from './task-page-source-context'
import { taskPageToGitHubApiPage } from './task-page-work-item-pagination'

type TaskPageGitHubPageNavigationStateProps = {
  appliedTaskSearch: string
  countedTotalPages: number | null
  currentPage: number
  fetchWorkItemsNextPage: AppState['fetchWorkItemsNextPage']
  githubPageSize: number
  githubPerRepoPageLimit: number
  paginationGenerationRef: MutableRefObject<number>
  paginationLoading: boolean
  pages: (GitHubWorkItem[] | null)[]
  selectedRepos: Repo[]
  setCurrentPage: Dispatch<SetStateAction<number>>
  setLoadingTargetPage: Dispatch<SetStateAction<number | null>>
  setPages: Dispatch<SetStateAction<(GitHubWorkItem[] | null)[]>>
  setPaginationLoading: Dispatch<SetStateAction<boolean>>
}

export function useTaskPageGitHubPageNavigationState({
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
}: TaskPageGitHubPageNavigationStateProps) {
  let lastLoadedPageIndex = 0
  for (let index = 0; index < pages.length; index += 1) {
    if (pages[index] !== null) {
      lastLoadedPageIndex = index
    }
  }
  // Why: when counts fail, a full loaded page is enough evidence to expose one more page without faking empty results.
  const lastLoadedPageFull =
    (pages[lastLoadedPageIndex]?.length ?? 0) >= Math.max(1, githubPageSize)
  const fallbackTotalPages = lastLoadedPageFull
    ? Math.max(pages.length, lastLoadedPageIndex + 2)
    : Math.max(1, pages.length)
  const totalPages =
    countedTotalPages && countedTotalPages > 0
      ? Math.max(pages.length, countedTotalPages)
      : fallbackTotalPages

  // Why: load only the clicked page so a high-page jump doesn't exhaust GitHub's Search API rate bucket.
  const handleLoadNextPage = useCallback(
    async (targetPage?: number) => {
      if (paginationLoading || selectedRepos.length === 0) {
        return
      }
      const q = stripRepoQualifiers(appliedTaskSearch.trim())
      const repoArgs = selectedRepos.map((repo) => ({
        repoId: repo.id,
        path: repo.path,
        executionHostId: repo.executionHostId,
        sourceContext: getTaskPageRepoSourceContext(repo, 'github')
      }))
      const requestGeneration = paginationGenerationRef.current
      const target = targetPage ?? currentPage + 1
      setPaginationLoading(true)
      setLoadingTargetPage(target)
      try {
        const { items } = await fetchWorkItemsNextPage(
          repoArgs,
          githubPerRepoPageLimit,
          githubPageSize,
          q,
          taskPageToGitHubApiPage(target)
        )
        if (paginationGenerationRef.current !== requestGeneration || items.length === 0) {
          return
        }
        setPages((previous) => {
          const next = [...previous]
          while (next.length <= target) {
            next.push(null)
          }
          next[target] = items
          return next
        })
        setCurrentPage(target)
      } catch (error) {
        console.error('Failed to load next page:', error)
      } finally {
        if (paginationGenerationRef.current === requestGeneration) {
          setPaginationLoading(false)
          setLoadingTargetPage(null)
        }
      }
    },
    [
      appliedTaskSearch,
      currentPage,
      fetchWorkItemsNextPage,
      githubPageSize,
      githubPerRepoPageLimit,
      paginationGenerationRef,
      paginationLoading,
      selectedRepos,
      setCurrentPage,
      setLoadingTargetPage,
      setPages,
      setPaginationLoading
    ]
  )

  return { handleLoadNextPage, totalPages }
}
