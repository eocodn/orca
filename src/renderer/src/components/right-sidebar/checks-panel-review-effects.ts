import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { buildGitHubPRRefreshStateClearToken, getGitHubPRRefreshStateExpiryAt } from '@/store/slices/github'
import { recordChecksPanelPRRefreshBreadcrumb } from './checks-panel-pr-refresh-breadcrumb'
import { isChecksPanelHardRefreshErrorType } from './checks-panel-review-creation'
import type { ChecksPanelEffectKey } from './checks-panel-effect-types'
import type { PRRefreshErrorType } from '../../../../shared/types'
export function useChecksPanelReviewEffects<T extends Record<string, unknown>>(context: T & { [K in ChecksPanelEffectKey]: K extends keyof T ? T[K] : never }): void {
  const {
    activeWorktreeId,
    branch,
    expireGitHubPRRefreshState,
    isPanelVisible,
    panelContextKey,
    panelContextKeyRef,
    panelVisibleSinceRef,
    pr,
    prCacheKey,
    prNumber,
    prRefreshState,
    rawPRRefreshState,
    repo,
    setHardRefreshError,
    setPrRefreshStateNow,
  } = context
useEffect(() => {
  const expiryAt = getGitHubPRRefreshStateExpiryAt(rawPRRefreshState)
  if (!prCacheKey || expiryAt === null) {
    return
  }
  const timeout = window.setTimeout(
    () => {
      setPrRefreshStateNow(Date.now())
      const storeState = useAppStore.getState()
      const rawState = storeState.prRefreshStates[prCacheKey]
      const token = buildGitHubPRRefreshStateClearToken(
        rawState,
        storeState.prRefreshSequences,
        prCacheKey
      )
      if (!token) {
        return
      }
      // Why: time alone doesn't publish Zustand updates; this timeout clears abandoned refresh UI without treating expiry as no-PR evidence.
      recordChecksPanelPRRefreshBreadcrumb({
        event: 'stale_cleared',
        provider: 'github',
        repoId: repo?.id,
        worktreeId: activeWorktreeId,
        branch,
        prCacheKey,
        prNumber,
        prState: pr?.state,
        prChecksStatus: pr?.checksStatus,
        refreshState: rawState
      })
      storeState.expireGitHubPRRefreshState(prCacheKey, token)
    },
    Math.max(0, expiryAt - Date.now() + 1)
  )
  return () => window.clearTimeout(timeout)
}, [
  activeWorktreeId,
  branch,
  pr?.checksStatus,
  pr?.state,
  prCacheKey,
  prNumber,
  rawPRRefreshState,
  repo?.id
])

useEffect(() => {
  if (!isPanelVisible) {
    panelVisibleSinceRef.current = null
    return
  }
  panelVisibleSinceRef.current = Date.now()
}, [isPanelVisible, panelContextKey])

// Record the latest hard refresh error, kept sticky so a background auto-retry can't silently re-enable Create while lookup is impossible.
useEffect(() => {
  const errorType = prRefreshState?.status === 'error' ? prRefreshState.errorType : undefined
  if (!isChecksPanelHardRefreshErrorType(errorType)) {
    return
  }
  const observedAt = prRefreshState?.updatedAt ?? Date.now()
  const contextKey = panelContextKeyRef.current
  setHardRefreshError((prev) => {
    if (prev && prev.contextKey === contextKey && prev.observedAt >= observedAt) {
      return prev
    }
    return { observedAt, errorType: errorType as PRRefreshErrorType, contextKey }
  })
}, [prRefreshState])

}
