import { useEffect, useRef, useState } from 'react'

import { getTaskPageRepoSourceContext } from './task-page-source-context'
import { useAppStore, type AppState } from '@/store'
import { sortWorkItemsByNumber } from '../../../shared/work-items'
import type { GitHubWorkItem, Repo } from '../../../shared/types'

type TaskPageGitHubPaginationStateProps = {
  appliedTaskSearch: string
  initialTaskQuery: string
  githubPerRepoPageLimit: number
  getCachedWorkItems: AppState['getCachedWorkItems']
  selectedRepos: Repo[]
  workItemsInvalidationNonce: number
}

export function useTaskPageGitHubPaginationState({
  appliedTaskSearch,
  initialTaskQuery,
  githubPerRepoPageLimit,
  getCachedWorkItems,
  selectedRepos,
  workItemsInvalidationNonce
}: TaskPageGitHubPaginationStateProps) {
  const paginationGenerationRef = useRef(0)
  const githubPageSize = githubPerRepoPageLimit * Math.max(1, selectedRepos.length)
  const [pages, setPages] = useState<(GitHubWorkItem[] | null)[]>(() => {
    const trimmed = initialTaskQuery.trim()
    const merged: GitHubWorkItem[] = []
    for (const repo of selectedRepos) {
      const cached = getCachedWorkItems(
        repo.id,
        githubPerRepoPageLimit,
        trimmed,
        repo.path,
        getTaskPageRepoSourceContext(repo, 'github')
      )
      if (cached) {
        merged.push(...cached)
      }
    }
    if (merged.length === 0) {
      return [[]]
    }
    return [sortWorkItemsByNumber(merged).slice(0, githubPageSize)]
  })
  const [currentPage, setCurrentPage] = useState(0)
  const [paginationLoading, setPaginationLoading] = useState(false)
  const [loadingTargetPage, setLoadingTargetPage] = useState<number | null>(null)
  const [countedTotalPages, setCountedTotalPages] = useState<number | null>(null)
  const fetchWorkItemsNextPage = useAppStore((state) => state.fetchWorkItemsNextPage)
  const countWorkItemsAcrossRepos = useAppStore((state) => state.countWorkItemsAcrossRepos)

  useEffect(() => {
    paginationGenerationRef.current += 1
    setPaginationLoading(false)
    setLoadingTargetPage(null)
  }, [selectedRepos, appliedTaskSearch, workItemsInvalidationNonce])

  return {
    countedTotalPages,
    currentPage,
    fetchWorkItemsNextPage,
    githubPageSize,
    loadingTargetPage,
    paginationGenerationRef,
    paginationLoading,
    pages,
    setCountedTotalPages,
    setCurrentPage,
    setLoadingTargetPage,
    setPages,
    setPaginationLoading,
    countWorkItemsAcrossRepos
  }
}
