import { useEffect, useMemo, useRef, useState } from 'react'

import { getRepoBackedTaskEmptyState } from './task-page-empty-state'
import { isGitLabIssueFilter, isGitLabMRFilter } from './task-page-provider-guards'
import { getTaskPageRepoSourceContext } from './task-page-source-context'
import type { GitLabIssueFilter, GitLabTaskFilter } from './task-page-localized-options'
import type { GitLabTodo, GitLabWorkItem, Repo, TaskProvider } from '../../../shared/types'

type GitLabDataOptions = {
  selectedRepos: readonly Repo[]
  primaryRepo: Repo | null
  taskSource: TaskProvider
}

export function useTaskPageGitLabData({
  selectedRepos,
  primaryRepo,
  taskSource
}: GitLabDataOptions) {
  const [gitlabFilter, setGitlabFilter] = useState<GitLabTaskFilter | GitLabIssueFilter>('opened')
  const [gitlabItems, setGitlabItems] = useState<GitLabWorkItem[]>([])
  const [gitlabLoading, setGitlabLoading] = useState(false)
  const [gitlabError, setGitlabError] = useState<string | null>(null)
  const [gitlabRefreshNonce, setGitlabRefreshNonce] = useState(0)
  const [gitlabView, setGitlabView] = useState<'issues' | 'mrs' | 'todos'>('mrs')
  const [gitlabTodos, setGitlabTodos] = useState<GitLabTodo[]>([])
  const [gitlabTodosLoading, setGitlabTodosLoading] = useState(false)
  const gitlabEmptyState = useMemo(
    () =>
      getRepoBackedTaskEmptyState({
        provider: 'gitlab',
        selectedRepoCount: selectedRepos.length,
        gitlabView
      }),
    [gitlabView, selectedRepos.length]
  )

  const gitlabFilterIsValid =
    gitlabView === 'issues'
      ? isGitLabIssueFilter(gitlabFilter)
      : gitlabView === 'mrs'
        ? isGitLabMRFilter(gitlabFilter)
        : true
  const activeGitlabFilter = gitlabFilterIsValid ? gitlabFilter : 'opened'
  if (!gitlabFilterIsValid) {
    setGitlabFilter('opened')
  }

  const displayedGitLabItems = useMemo(() => {
    if (gitlabView === 'issues') {
      return gitlabItems.filter((item) => item.type === 'issue')
    }
    if (gitlabView === 'mrs') {
      return gitlabItems.filter((item) => item.type === 'mr')
    }
    return gitlabItems
  }, [gitlabItems, gitlabView])

  const selectedReposKey = useMemo(
    () =>
      selectedRepos
        .map(
          (repo) =>
            `${repo.id}|${repo.path}|${repo.connectionId ?? ''}|${repo.executionHostId ?? ''}`
        )
        .join(','),
    [selectedRepos]
  )
  const selectedReposRef = useRef(selectedRepos)
  selectedReposRef.current = selectedRepos

  useEffect(() => {
    if (taskSource !== 'gitlab' || gitlabView === 'todos') {
      return
    }
    const activeIssueFilter =
      gitlabView === 'issues' && isGitLabIssueFilter(activeGitlabFilter) ? activeGitlabFilter : null
    const activeMRFilter =
      gitlabView === 'mrs' && isGitLabMRFilter(activeGitlabFilter) ? activeGitlabFilter : null
    if (
      (gitlabView === 'issues' && !activeIssueFilter) ||
      (gitlabView === 'mrs' && !activeMRFilter)
    ) {
      return
    }
    const reposForFetch = selectedReposRef.current
    if (reposForFetch.length === 0) {
      setGitlabItems([])
      setGitlabLoading(false)
      setGitlabError(null)
      return
    }
    let stale = false
    setGitlabLoading(true)
    setGitlabError(null)

    const fetchItems =
      gitlabView === 'issues'
        ? (repo: Repo) => {
            const isAssignedToMe = activeIssueFilter === 'assigned-to-me'
            return window.api.gl
              .listIssues({
                repoPath: repo.path,
                repoId: repo.id,
                sourceContext: getTaskPageRepoSourceContext(repo, 'gitlab'),
                state: 'opened',
                assignee: isAssignedToMe ? '@me' : undefined,
                limit: 50
              })
              .then((result) => {
                const typed = result as {
                  items: GitLabWorkItem[]
                  error?: { type?: string; message: string }
                }
                const error = typed.error?.type === 'not_found' ? undefined : typed.error
                return { repoId: repo.id, items: typed.items, error }
              })
          }
        : (repo: Repo) =>
            window.api.gl
              .listMRs({
                repoPath: repo.path,
                repoId: repo.id,
                sourceContext: getTaskPageRepoSourceContext(repo, 'gitlab'),
                state: activeMRFilter ?? 'opened',
                page: 1,
                perPage: 50
              })
              .then((result) => {
                const typed = result as {
                  items: GitLabWorkItem[]
                  error?: { type?: string; message: string }
                }
                const error = typed.error?.type === 'not_found' ? undefined : typed.error
                return { repoId: repo.id, items: typed.items, error }
              })

    void Promise.allSettled(reposForFetch.map(fetchItems))
      .then((results) => {
        if (stale) {
          return
        }
        const merged: GitLabWorkItem[] = []
        const errors: string[] = []
        for (const result of results) {
          if (result.status !== 'fulfilled') {
            errors.push(
              result.reason instanceof Error ? result.reason.message : String(result.reason)
            )
            continue
          }
          for (const item of result.value.items) {
            merged.push({ ...item, repoId: result.value.repoId })
          }
          if (result.value.error) {
            errors.push(result.value.error.message)
          }
        }
        merged.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
        setGitlabItems(merged)
        if (errors.length > 0 && merged.length === 0) {
          setGitlabError(errors[0])
        }
      })
      .finally(() => {
        if (!stale) {
          setGitlabLoading(false)
        }
      })
    return () => {
      stale = true
    }
    // Why: selectedReposKey encodes the selected repo fields read by this effect without rerunning on parent array identity changes.
  }, [taskSource, gitlabView, activeGitlabFilter, gitlabRefreshNonce, selectedReposKey])

  useEffect(() => {
    if (taskSource !== 'gitlab' || gitlabView !== 'todos') {
      return
    }
    if (!primaryRepo?.path) {
      setGitlabTodos([])
      setGitlabTodosLoading(false)
      return
    }
    let stale = false
    setGitlabTodosLoading(true)
    void window.api.gl
      .todos({
        repoPath: primaryRepo.path,
        repoId: primaryRepo.id,
        sourceContext: getTaskPageRepoSourceContext(primaryRepo, 'gitlab')
      })
      .then((todos) => {
        if (!stale) {
          setGitlabTodos(todos as GitLabTodo[])
        }
      })
      .catch(() => {
        if (!stale) {
          setGitlabTodos([])
        }
      })
      .finally(() => {
        if (!stale) {
          setGitlabTodosLoading(false)
        }
      })
    return () => {
      stale = true
    }
  }, [taskSource, gitlabView, gitlabRefreshNonce, primaryRepo])

  return {
    activeGitlabFilter,
    displayedGitLabItems,
    gitlabEmptyState,
    gitlabError,
    gitlabFilter,
    gitlabItems,
    gitlabLoading,
    gitlabRefreshNonce,
    gitlabTodos,
    gitlabTodosLoading,
    gitlabView,
    setGitlabFilter,
    setGitlabItems,
    setGitlabRefreshNonce,
    setGitlabTodos,
    setGitlabTodosLoading,
    setGitlabView
  }
}
