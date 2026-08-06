import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { findTaskPageLinearIssue } from '@/components/task-page-linear-cache-selectors'
import { useAppStore, type AppState } from '@/store'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { LinearIssue } from '../../../shared/types'

type TaskPageLinearDetailStateProps = {
  pageData: AppState['taskPageData']
  linearTaskSourceContext: TaskSourceContext | null
  openTaskPage: AppState['openTaskPage']
}

export function useTaskPageLinearDetailState({
  pageData,
  linearTaskSourceContext,
  openTaskPage
}: TaskPageLinearDetailStateProps) {
  const [selectedLinearIssueId, setSelectedLinearIssueId] = useState<string | null>(null)
  const [selectedLinearIssueFallback, setSelectedLinearIssueFallback] =
    useState<LinearIssue | null>(null)
  const [selectedLinearIssueCanFloat, setSelectedLinearIssueCanFloat] = useState(false)

  const linearCacheSnapshot = useAppStore(
    useShallow((state) => ({
      issueCache: state.linearIssueCache,
      searchCache: state.linearSearchCache,
      listCache: state.linearListCache
    }))
  )
  const cachedSelectedLinearIssue = findTaskPageLinearIssue(
    linearCacheSnapshot.issueCache,
    linearCacheSnapshot.searchCache,
    linearCacheSnapshot.listCache,
    selectedLinearIssueId
  )
  const selectedLinearIssue = selectedLinearIssueId
    ? (cachedSelectedLinearIssue ?? selectedLinearIssueFallback)
    : null
  const linearDetailSourceContext = useMemo(() => {
    if (
      selectedLinearIssue &&
      pageData.openLinearSourceContext?.provider === 'linear' &&
      pageData.openLinearIssue?.id === selectedLinearIssue.id
    ) {
      return pageData.openLinearSourceContext
    }
    return linearTaskSourceContext
  }, [
    linearTaskSourceContext,
    pageData.openLinearIssue,
    pageData.openLinearSourceContext,
    selectedLinearIssue
  ])

  const setSelectedLinearIssue = useCallback(
    (issue: LinearIssue | null, options?: { allowOutsideList?: boolean }) => {
      setSelectedLinearIssueCanFloat(Boolean(issue && options?.allowOutsideList))
      setSelectedLinearIssueId(issue?.id ?? null)
      setSelectedLinearIssueFallback(issue)
    },
    []
  )

  const clearSelectedLinearIssue = useCallback(() => {
    setSelectedLinearIssueCanFloat(false)
    setSelectedLinearIssueId(null)
    setSelectedLinearIssueFallback(null)
  }, [])

  useEffect(() => {
    if (!pageData.openLinearIssue) {
      clearSelectedLinearIssue()
      return
    }
    setSelectedLinearIssue(pageData.openLinearIssue, { allowOutsideList: true })
  }, [clearSelectedLinearIssue, pageData.openLinearIssue, setSelectedLinearIssue])

  const openLinearDetailPage = useCallback(
    (issue: LinearIssue) => {
      openTaskPage(
        {
          taskSource: 'linear',
          openLinearIssue: issue,
          openLinearSourceContext: linearTaskSourceContext
        },
        { recordTasksInteraction: false }
      )
    },
    [linearTaskSourceContext, openTaskPage]
  )

  const openRelatedLinearIssue = useCallback(
    (issue: LinearIssue) => {
      openLinearDetailPage(issue)
    },
    [openLinearDetailPage]
  )

  return {
    selectedLinearIssue,
    selectedLinearIssueCanFloat,
    selectedLinearIssueId,
    setSelectedLinearIssue,
    setSelectedLinearIssueFallback,
    clearSelectedLinearIssue,
    linearDetailSourceContext,
    openLinearDetailPage,
    openRelatedLinearIssue
  }
}
