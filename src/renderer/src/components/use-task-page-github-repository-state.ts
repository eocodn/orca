import { useCallback, useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'

import { translate } from '@/i18n/i18n'
import { CROSS_REPO_DISPLAY_LIMIT, PER_REPO_FETCH_LIMIT } from '@/lib/new-workspace'
import type { Repo } from '../../../shared/types'
import {
  buildTaskPageRepoSourceState,
  reconcileTaskPagePagesWithWorkItemsCache,
  selectTaskPageUnresolvedSourceRepos,
  type TaskPageRepoSourceState
} from './task-page-cache-selectors'
import { getRepoBackedTaskEmptyState } from './task-page-empty-state'
import { getTaskPagePerRepoLimit } from './task-page-work-item-pagination'
import type { TaskPageGitHubSearchController } from './use-task-page-github-search-controller'
import { useTaskPageGitHubPaginationState } from './use-task-page-github-pagination-state'
import { useTaskPageProviderDialogState } from './use-task-page-provider-dialog-state'
import type { TaskPageStoreBindings } from './use-task-page-store-bindings'

type Props = {
  store: TaskPageStoreBindings
  github: TaskPageGitHubSearchController
  selectedRepos: Repo[]
  primaryRepo: Repo | null
  repoMap: ReadonlyMap<string, Repo>
  taskSource: string
  initialTaskQuery: string
}

export function useTaskPageGitHubRepositoryState({
  store,
  github,
  selectedRepos,
  primaryRepo,
  repoMap,
  taskSource,
  initialTaskQuery
}: Props) {
  const { pageData, openTaskPage, getCachedWorkItems, workItemsInvalidationNonce } = store
  const {
    appliedTaskSearch,
    githubMode,
    setGithubMode,
    setTaskRefreshNonce,
    setRetryingSourceKeys
  } = github
  const githubEmptyState = useMemo(
    () =>
      getRepoBackedTaskEmptyState({
        provider: 'github',
        selectedRepoCount: selectedRepos.length
      }),
    [selectedRepos.length]
  )
  const githubPerRepoPageLimit = getTaskPagePerRepoLimit(
    selectedRepos.length,
    PER_REPO_FETCH_LIMIT,
    CROSS_REPO_DISPLAY_LIMIT
  )
  const pagination = useTaskPageGitHubPaginationState({
    appliedTaskSearch,
    initialTaskQuery,
    githubPerRepoPageLimit,
    getCachedWorkItems,
    selectedRepos,
    workItemsInvalidationNonce
  })
  const { setPages } = pagination
  const dialog = useTaskPageProviderDialogState({
    appliedTaskSearch,
    githubPerRepoPageLimit,
    pageData,
    primaryRepo,
    repoMap,
    selectedRepos,
    openTaskPage,
    setGithubMode,
    setPages
  })
  const perRepoSourceState = useMemo<TaskPageRepoSourceState[]>(
    () => buildTaskPageRepoSourceState(selectedRepos, dialog.selectedWorkItemsCacheEntries),
    [dialog.selectedWorkItemsCacheEntries, selectedRepos]
  )
  const unresolvedSourceRepos = useMemo(
    () => selectTaskPageUnresolvedSourceRepos(selectedRepos, perRepoSourceState),
    [perRepoSourceState, selectedRepos]
  )

  useEffect(() => {
    if (taskSource !== 'github' || githubMode !== 'items') {
      return
    }
    setPages((current) =>
      reconcileTaskPagePagesWithWorkItemsCache(current, dialog.selectedWorkItemsCacheEntries)
    )
  }, [dialog.selectedWorkItemsCacheEntries, githubMode, setPages, taskSource])

  const fellBackToastedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (taskSource !== 'github') {
      return
    }
    for (const [index, repo] of selectedRepos.entries()) {
      const entry = dialog.selectedWorkItemsCacheEntries[index]
      if (!entry?.issueSourceFellBack || fellBackToastedRef.current.has(repo.id)) {
        continue
      }
      const prSlug = entry.sources?.prs
        ? `${entry.sources.prs.owner}/${entry.sources.prs.repo}`
        : repo.displayName
      toast.message(
        translate(
          'auto.components.TaskPage.f4374519ae',
          'Your preferred issue source (upstream) is no longer configured for {{value0}}. Using origin.',
          { value0: prSlug }
        )
      )
      fellBackToastedRef.current.add(repo.id)
    }
  }, [dialog.selectedWorkItemsCacheEntries, selectedRepos, taskSource])

  const handleRetryIssuesFetch = useCallback(
    (sourceKey: string) => {
      const source = perRepoSourceState.find((state) => state.sourceKey === sourceKey)
      if (!source) {
        return
      }
      setRetryingSourceKeys((current) => new Set(current).add(source.sourceKey))
      setTaskRefreshNonce((current) => current + 1)
    },
    [perRepoSourceState, setRetryingSourceKeys, setTaskRefreshNonce]
  )

  return {
    githubEmptyState,
    githubPerRepoPageLimit,
    perRepoSourceState,
    unresolvedSourceRepos,
    handleRetryIssuesFetch,
    ...pagination,
    ...dialog
  }
}

export type TaskPageGitHubRepositoryState = ReturnType<typeof useTaskPageGitHubRepositoryState>
