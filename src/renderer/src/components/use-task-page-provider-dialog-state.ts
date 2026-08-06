import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useShallow } from 'zustand/react/shallow'

import type { ItemDialogTab } from '@/components/GitHubItemDialog'
import {
  findTaskPageDialogWorkItem,
  selectTaskPageWorkItemsCacheEntries
} from '@/components/task-page-cache-selectors'
import { getTaskPageRepoCacheInput, getTaskPageRepoSourceContext } from './task-page-source-context'
import { useAppStore, type AppState } from '@/store'
import { stripRepoQualifiers } from '../../../shared/task-query'
import type {
  GitHubAssignableUser,
  GitHubWorkItem,
  GitLabWorkItem,
  Repo
} from '../../../shared/types'

type TaskPageProviderDialogStateProps = {
  appliedTaskSearch: string
  githubPerRepoPageLimit: number
  pageData: AppState['taskPageData']
  primaryRepo: Repo | null
  selectedRepos: Repo[]
  repoMap: ReadonlyMap<string, Repo>
  openTaskPage: AppState['openTaskPage']
  setGithubMode: (mode: 'items' | 'project') => void
  setPages: Dispatch<SetStateAction<(GitHubWorkItem[] | null)[]>>
}

export function useTaskPageProviderDialogState({
  appliedTaskSearch,
  githubPerRepoPageLimit,
  pageData,
  primaryRepo,
  selectedRepos,
  repoMap,
  openTaskPage,
  setGithubMode,
  setPages
}: TaskPageProviderDialogStateProps) {
  const githubTaskDrawerWorkItem = useAppStore((state) => state.githubTaskDrawerWorkItem)
  const setGithubTaskDrawerWorkItem = useAppStore((state) => state.setGithubTaskDrawerWorkItem)
  const [dialogInitialTab, setDialogInitialTab] = useState<ItemDialogTab>('conversation')
  const [gitlabDialogItem, setGitlabDialogItem] = useState<GitLabWorkItem | null>(null)
  const dialogWorkItemKey = githubTaskDrawerWorkItem
    ? { id: githubTaskDrawerWorkItem.id, repoId: githubTaskDrawerWorkItem.repoId }
    : null

  const appliedWorkItemsCacheQuery = useMemo(
    () => stripRepoQualifiers(appliedTaskSearch.trim()),
    [appliedTaskSearch]
  )
  const selectedWorkItemsCacheEntries = useAppStore(
    useShallow((state) =>
      selectTaskPageWorkItemsCacheEntries(
        state.workItemsCache,
        selectedRepos.map(getTaskPageRepoCacheInput),
        githubPerRepoPageLimit,
        appliedWorkItemsCacheQuery
      )
    )
  )
  const cachedDialogWorkItem = useAppStore((state) =>
    findTaskPageDialogWorkItem(state.workItemsCache, dialogWorkItemKey)
  )
  const dialogWorkItem = dialogWorkItemKey
    ? (cachedDialogWorkItem ?? githubTaskDrawerWorkItem)
    : null
  const dialogRepoPath = dialogWorkItem ? (repoMap.get(dialogWorkItem.repoId)?.path ?? null) : null
  const dialogSourceContext = useMemo(() => {
    if (!dialogWorkItem) {
      return null
    }
    if (
      pageData.openGitHubSourceContext?.provider === 'github' &&
      pageData.openGitHubWorkItem?.id === dialogWorkItem.id &&
      pageData.openGitHubWorkItem.repoId === dialogWorkItem.repoId
    ) {
      return pageData.openGitHubSourceContext
    }
    return getTaskPageRepoSourceContext(repoMap.get(dialogWorkItem.repoId), 'github')
  }, [dialogWorkItem, pageData.openGitHubSourceContext, pageData.openGitHubWorkItem, repoMap])
  const gitlabDialogRepo = useMemo(
    () =>
      gitlabDialogItem
        ? (selectedRepos.find((repo) => repo.id === gitlabDialogItem.repoId) ?? primaryRepo)
        : null,
    [gitlabDialogItem, primaryRepo, selectedRepos]
  )
  const gitlabDialogSourceContext = useMemo(() => {
    if (!gitlabDialogItem) {
      return null
    }
    if (
      pageData.openGitLabSourceContext?.provider === 'gitlab' &&
      pageData.openGitLabWorkItem?.id === gitlabDialogItem.id &&
      pageData.openGitLabWorkItem.repoId === gitlabDialogItem.repoId
    ) {
      return pageData.openGitLabSourceContext
    }
    return getTaskPageRepoSourceContext(gitlabDialogRepo, 'gitlab', gitlabDialogItem.projectRef)
  }, [
    gitlabDialogItem,
    gitlabDialogRepo,
    pageData.openGitLabSourceContext,
    pageData.openGitLabWorkItem
  ])

  const setDialogWorkItem = useCallback(
    (item: GitHubWorkItem | null, initialTab: ItemDialogTab = 'conversation') => {
      setDialogInitialTab(item ? initialTab : 'conversation')
      setGithubTaskDrawerWorkItem(item)
    },
    [setGithubTaskDrawerWorkItem]
  )

  useEffect(() => {
    if (!pageData.openGitHubWorkItem) {
      setDialogWorkItem(null)
      return
    }
    setGithubMode('items')
    setDialogWorkItem(pageData.openGitHubWorkItem, pageData.openGitHubInitialTab)
  }, [pageData.openGitHubInitialTab, pageData.openGitHubWorkItem, setDialogWorkItem, setGithubMode])

  useEffect(() => {
    setGitlabDialogItem(pageData.openGitLabWorkItem ?? null)
  }, [pageData.openGitLabWorkItem])

  const openGitHubDetailPage = useCallback(
    (item: GitHubWorkItem, initialTab: ItemDialogTab = 'conversation') => {
      openTaskPage(
        {
          taskSource: 'github',
          preselectedRepoId: item.repoId,
          openGitHubWorkItem: item,
          openGitHubSourceContext: getTaskPageRepoSourceContext(repoMap.get(item.repoId), 'github'),
          openGitHubInitialTab: initialTab
        },
        { recordTasksInteraction: false }
      )
    },
    [openTaskPage, repoMap]
  )

  const openGitLabDetailPage = useCallback(
    (item: GitLabWorkItem) => {
      openTaskPage(
        {
          taskSource: 'gitlab',
          preselectedRepoId: item.repoId,
          openGitLabWorkItem: item,
          openGitLabSourceContext: getTaskPageRepoSourceContext(
            repoMap.get(item.repoId),
            'gitlab',
            item.projectRef
          )
        },
        { recordTasksInteraction: false }
      )
    },
    [openTaskPage, repoMap]
  )

  const patchTaskPageWorkItemRows = useCallback(
    (
      itemKey: { id: string; repoId: string },
      patch: Partial<GitHubWorkItem>,
      shouldPatch?: (item: GitHubWorkItem) => boolean
    ): void => {
      setPages((current) => {
        let changed = false
        const nextPages = current.map((page) => {
          if (!page) {
            return page
          }
          let pageChanged = false
          const nextPage = page.map((item) => {
            if (item.id !== itemKey.id || item.repoId !== itemKey.repoId) {
              return item
            }
            if (shouldPatch && !shouldPatch(item)) {
              return item
            }
            pageChanged = true
            changed = true
            return { ...item, ...patch }
          })
          return pageChanged ? nextPage : page
        })
        return changed ? nextPages : current
      })
    },
    [setPages]
  )
  const handleDialogReviewRequestsChange = useCallback(
    (itemKey: { id: string; repoId: string }, reviewRequests: GitHubAssignableUser[]): void => {
      patchTaskPageWorkItemRows(itemKey, { reviewRequests })
    },
    [patchTaskPageWorkItemRows]
  )

  return {
    dialogInitialTab,
    dialogRepoPath,
    dialogSourceContext,
    dialogWorkItem,
    gitlabDialogItem,
    gitlabDialogRepo,
    gitlabDialogSourceContext,
    handleDialogReviewRequestsChange,
    openGitHubDetailPage,
    openGitLabDetailPage,
    patchTaskPageWorkItemRows,
    selectedWorkItemsCacheEntries,
    setDialogWorkItem
  }
}
