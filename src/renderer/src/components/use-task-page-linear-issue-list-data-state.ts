import { useEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { AppState } from '@/store'
import { reconcileTaskPageLinearIssuesAfterLandingRefresh } from '@/components/task-page-cache-selectors'
import {
  buildLinearIssueListReadArgs,
  buildLinearIssueListRequestSignature,
  shouldForceLinearIssueListRead
} from '@/components/task-page-linear-issue-request'
import {
  emptyLinearIssueAttributeFilter,
  linearIssueAttributeFilterSignature,
  type LinearIssueAttributeFilter
} from '../../../shared/linear-issue-attribute-filter'
import {
  clampLinearIssueListLimit,
  LINEAR_ISSUE_LIST_MAX
} from '../../../shared/linear-issue-read-limits'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { LinearCollectionResult, LinearIssue } from '../../../shared/types'

const LINEAR_ITEM_LIMIT = 36

type TaskPageLinearIssueListDataStateProps = {
  appliedLinearSearch: string
  getCachedLinearIssues: AppState['getCachedLinearIssues']
  linearAttributeFilter: LinearIssueAttributeFilter
  linearConnected: boolean
  linearIssueLimit: number
  linearListInvalidationVersionForSource: number
  linearMode: string
  linearRefreshNonce: number
  linearTaskSourceContext: TaskSourceContext | null
  listLinearIssues: AppState['listLinearIssues']
  searchLinearIssues: AppState['searchLinearIssues']
  selectedLinearWorkspaceId: string | 'all'
  setLinearError: Dispatch<SetStateAction<string | null>>
  setLinearIssues: Dispatch<SetStateAction<LinearIssue[]>>
  setLinearIssuesHasMore: Dispatch<SetStateAction<boolean>>
  setLinearLoading: Dispatch<SetStateAction<boolean>>
  taskResumeApplied: boolean
  taskSource: string
}

export function useTaskPageLinearIssueListDataState({
  appliedLinearSearch,
  getCachedLinearIssues,
  linearAttributeFilter,
  linearConnected,
  linearIssueLimit,
  linearListInvalidationVersionForSource,
  linearMode,
  linearRefreshNonce,
  linearTaskSourceContext,
  listLinearIssues,
  searchLinearIssues,
  selectedLinearWorkspaceId,
  setLinearError,
  setLinearIssues,
  setLinearIssuesHasMore,
  setLinearLoading,
  taskResumeApplied,
  taskSource
}: TaskPageLinearIssueListDataStateProps): void {
  const linearAttributeFilterSignatureRef = useRef(
    linearIssueAttributeFilterSignature(emptyLinearIssueAttributeFilter())
  )
  const lastLinearRequestRef = useRef<{ nonce: number; signature: string } | null>(null)
  const landingLinearRefreshKeysRef = useRef<ReadonlySet<string>>(new Set())

  useEffect(() => {
    if (!taskResumeApplied || taskSource !== 'linear' || linearMode !== 'issues') {
      return
    }
    if (!linearConnected) {
      return
    }

    let cancelled = false
    setLinearError(null)

    const trimmed = appliedLinearSearch.trim()
    const effectiveLinearIssueLimit = clampLinearIssueListLimit(linearIssueLimit)
    const searchActive = trimmed.length > 0
    const listReadArgs = buildLinearIssueListReadArgs({
      filter: 'all',
      limit: effectiveLinearIssueLimit,
      attributeFilter: linearAttributeFilter,
      searchActive,
      allowAttributeFilter: selectedLinearWorkspaceId !== 'all'
    })
    const readArgs = searchActive
      ? ({ kind: 'search', query: trimmed, limit: LINEAR_ITEM_LIMIT } as const)
      : listReadArgs
    const cachedResult = getCachedLinearIssues(readArgs, { sourceContext: linearTaskSourceContext })
    if (readArgs.kind === 'search') {
      setLinearIssuesHasMore(false)
      if (cachedResult) {
        setLinearIssues(cachedResult as LinearIssue[])
      }
    } else if (cachedResult) {
      const collection = cachedResult as LinearCollectionResult<LinearIssue>
      setLinearIssues(collection.items)
      setLinearIssuesHasMore(
        Boolean(collection.hasMore) && effectiveLinearIssueLimit < LINEAR_ISSUE_LIST_MAX
      )
    }

    const nextFilterSignature = linearIssueAttributeFilterSignature(linearAttributeFilter)
    const previousFilterSignature = linearAttributeFilterSignatureRef.current
    linearAttributeFilterSignatureRef.current = nextFilterSignature
    const filterForce = shouldForceLinearIssueListRead({
      previousFilterSignature,
      nextFilterSignature,
      refreshForced: false
    })

    const requestSignature = buildLinearIssueListRequestSignature({
      sourceContext: linearTaskSourceContext,
      workspaceId: selectedLinearWorkspaceId,
      filter: 'all',
      limit: effectiveLinearIssueLimit,
      attributeFilter: linearAttributeFilter,
      searchQuery: searchActive ? trimmed : undefined
    })
    const previousRequest = lastLinearRequestRef.current
    const forceRefresh =
      filterForce ||
      (linearRefreshNonce > 0 &&
        previousRequest?.nonce !== linearRefreshNonce &&
        previousRequest?.signature === requestSignature)
    lastLinearRequestRef.current = { nonce: linearRefreshNonce, signature: requestSignature }
    const shouldProbeOnLanding =
      !forceRefresh &&
      cachedResult !== null &&
      !landingLinearRefreshKeysRef.current.has(requestSignature)
    if (shouldProbeOnLanding) {
      landingLinearRefreshKeysRef.current = new Set([
        ...landingLinearRefreshKeysRef.current,
        requestSignature
      ])
    }

    // Why: keep cached rows visible on navigation; only explicit refresh or a true cache miss shows the blocking loading state.
    setLinearLoading(forceRefresh || cachedResult === null)

    const request =
      readArgs.kind === 'search'
        ? searchLinearIssues(readArgs.query, LINEAR_ITEM_LIMIT, {
            force: forceRefresh || shouldProbeOnLanding,
            sourceContext: linearTaskSourceContext
          })
        : listLinearIssues(listReadArgs, {
            force: forceRefresh || shouldProbeOnLanding,
            sourceContext: linearTaskSourceContext
          })

    void request
      .then((result) => {
        if (
          cancelled ||
          lastLinearRequestRef.current?.signature !== requestSignature ||
          lastLinearRequestRef.current?.nonce !== linearRefreshNonce
        ) {
          return
        }
        if (readArgs.kind === 'search') {
          const issues = result as LinearIssue[]
          setLinearIssuesHasMore(false)
          if (shouldProbeOnLanding) {
            setLinearIssues((current) =>
              reconcileTaskPageLinearIssuesAfterLandingRefresh(current, issues)
            )
          } else {
            setLinearIssues(issues)
          }
        } else {
          const collection = result as LinearCollectionResult<LinearIssue>
          setLinearIssuesHasMore(
            Boolean(collection.hasMore) && effectiveLinearIssueLimit < LINEAR_ISSUE_LIST_MAX
          )
          setLinearIssues((current) =>
            shouldProbeOnLanding
              ? reconcileTaskPageLinearIssuesAfterLandingRefresh(current, collection.items)
              : collection.items
          )
        }
        setLinearLoading(false)
      })
      .catch((error) => {
        if (
          cancelled ||
          lastLinearRequestRef.current?.signature !== requestSignature ||
          lastLinearRequestRef.current?.nonce !== linearRefreshNonce
        ) {
          return
        }
        setLinearError(error instanceof Error ? error.message : 'Failed to load Linear issues.')
        setLinearLoading(false)
      })

    return () => {
      cancelled = true
    }
    // Why: selectors are stable; adding them would re-run the effect on unrelated store updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    taskSource,
    linearMode,
    linearConnected,
    selectedLinearWorkspaceId,
    appliedLinearSearch,
    linearIssueLimit,
    linearRefreshNonce,
    linearAttributeFilter,
    linearListInvalidationVersionForSource,
    taskResumeApplied,
    getCachedLinearIssues,
    linearTaskSourceContext
  ])
}
