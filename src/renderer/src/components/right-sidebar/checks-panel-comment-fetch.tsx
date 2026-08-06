import { useCallback, useEffect } from 'react'
import type { PRCheckDetail, PRInfo } from '../../../../shared/types'
import type { ChecksPanelCommentFetchKey } from './checks-panel-comment-fetch-types'

export function useChecksPanelCommentFetch<T extends Record<string, unknown>>(
  context: T & {
    [K in ChecksPanelCommentFetchKey]: K extends keyof T ? T[K] : never
  }
): Record<string, unknown> {
  const {
    activeGitLabReview,
    branch,
    checksPanelAsyncResultKey,
    fetchPRCheckDetails,
    fetchPRComments,
    isCurrentAsyncResult,
    isPanelVisible,
    pr,
    prCacheKey,
    prNumber,
    repo,
    setComments,
    setCommentsLoading
  } = context

  const fetchComments = useCallback(
    async ({
      force = false,
      prNumberOverride,
      prRepoOverride
    }: {
      force?: boolean
      prNumberOverride?: number | null
      prRepoOverride?: PRInfo['prRepo'] | null
    } = {}) => {
      const targetPRNumber = prNumberOverride ?? prNumber
      const targetPRRepo = prRepoOverride ?? pr?.prRepo
      if (!repo || !targetPRNumber) {
        return
      }
      setCommentsLoading(true)
      const requestKey = checksPanelAsyncResultKey(
        prCacheKey,
        branch,
        targetPRNumber,
        targetPRRepo,
        pr?.headSha
      )
      try {
        const result = await fetchPRComments(repo.path, targetPRNumber, {
          force,
          repoId: repo.id,
          prRepo: targetPRRepo
        })
        if (isCurrentAsyncResult(requestKey)) {
          setComments(result)
        }
      } catch (err) {
        if (isCurrentAsyncResult(requestKey)) {
          console.warn('Failed to fetch PR comments:', err)
          setComments([])
        }
      } finally {
        if (isCurrentAsyncResult(requestKey)) {
          setCommentsLoading(false)
        }
      }
    },
    [
      branch,
      checksPanelAsyncResultKey,
      fetchPRComments,
      isCurrentAsyncResult,
      pr?.headSha,
      pr?.prRepo,
      prCacheKey,
      prNumber,
      repo,
      setComments,
      setCommentsLoading
    ]
  )

  const handleLoadCheckDetails = useCallback(
    (check: PRCheckDetail) => {
      if (!repo) {
        return Promise.resolve(null)
      }
      return fetchPRCheckDetails(
        repo.path,
        {
          checkRunId: check.checkRunId,
          workflowRunId: check.workflowRunId,
          checkName: check.name,
          url: check.url,
          prRepo: pr?.prRepo ?? null
        },
        { repoId: repo.id }
      )
    },
    [fetchPRCheckDetails, pr?.prRepo, repo]
  )

  useEffect(() => {
    if (activeGitLabReview || !repo || !prNumber || !isPanelVisible) {
      if (!activeGitLabReview && (!repo || !prNumber || !isPanelVisible)) {
        setComments([])
      }
      return
    }
    let cancelled = false
    const requestKey = checksPanelAsyncResultKey(
      prCacheKey,
      branch,
      prNumber,
      pr?.prRepo,
      pr?.headSha
    )
    setCommentsLoading(true)
    void fetchPRComments(repo.path, prNumber, { repoId: repo.id, prRepo: pr?.prRepo }).then(
      (result) => {
        if (!cancelled && isCurrentAsyncResult(requestKey)) {
          setComments(result)
          setCommentsLoading(false)
        }
      },
      () => {
        if (!cancelled && isCurrentAsyncResult(requestKey)) {
          setComments([])
          setCommentsLoading(false)
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [
    activeGitLabReview,
    branch,
    checksPanelAsyncResultKey,
    fetchPRComments,
    isCurrentAsyncResult,
    isPanelVisible,
    pr?.headSha,
    pr?.prRepo,
    prCacheKey,
    prNumber,
    repo,
    setComments,
    setCommentsLoading
  ])

  useEffect(() => {
    if (activeGitLabReview || !repo || !prNumber || !isPanelVisible) {
      return undefined
    }
    return window.api.gh.onWorkItemMutated((payload) => {
      const sameRepo =
        payload.repoId != null ? payload.repoId === repo.id : payload.repoPath === repo.path
      if (!sameRepo || payload.type !== 'pr' || payload.number !== prNumber) {
        return
      }
      void fetchComments({ force: true })
    })
  }, [activeGitLabReview, fetchComments, isPanelVisible, prNumber, repo])

  return { fetchComments, handleLoadCheckDetails }
}
