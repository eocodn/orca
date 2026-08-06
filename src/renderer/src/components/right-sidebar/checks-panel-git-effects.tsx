import { useEffect } from 'react'
import { getRuntimeGitStatus, getRuntimeGitUpstreamStatus } from '@/runtime/runtime-git-client'
import { shouldCommitChecksPanelGitStatusSnapshot, shouldClearChecksPanelGitStatusSnapshot, shouldCoalesceChecksPanelGitStatusSnapshotRefresh } from './checks-panel-git-status-snapshot'
import type { ChecksPanelGitEffectsKey } from './checks-panel-git-effects-types'
function buildChecksPanelEligibilityGitFingerprint(input: { headOid: string | null; hasUncommittedChanges: boolean | undefined; hasUpstream: boolean | undefined; ahead: number | undefined; behind: number | undefined; base: string | null; runtimeEnvironmentId: string | null; repoConnectionId: string | null; localExecutionScope: string | null }): string {
  return JSON.stringify({ headOid: input.headOid ?? null, hasUncommittedChanges: input.hasUncommittedChanges ?? null, hasUpstream: input.hasUpstream ?? null, ahead: input.ahead ?? null, behind: input.behind ?? null, base: input.base ?? null, runtimeEnvironmentId: input.runtimeEnvironmentId ?? null, repoConnectionId: input.repoConnectionId ?? null, localExecutionScope: input.localExecutionScope ?? null })
}
export function useChecksPanelGitEffects<T extends Record<string, unknown>>(context: T & { [K in ChecksPanelGitEffectsKey]: K extends keyof T ? T[K] : never }): void {
  const {
    activeConnectionId,
    activeWorktreeId,
    activeWorktreePath,
    activeWorktreePushTarget,
    branch,
    conflictSummaryRefreshKeyRef,
    eligibilityHeadOidRef,
    fallbackGitHubPRNumber,
    fetchPRForBranch,
    getHostedReviewCreationEligibility,
    gitStatusInvalidation,
    gitStatusReadyForPanelContext,
    gitStatusSnapshotInFlightContextRef,
    gitStatusSnapshotRerunContextRef,
    gitStatusSnapshotRetryTimerRef,
    hasUncommittedChanges,
    hostedReviewCreationRequestKey,
    isFolder,
    isPanelVisible,
    linkedAzureDevOpsPR,
    linkedBitbucketPR,
    linkedGitLabMR,
    linkedGiteaPR,
    linkedPR,
    localExecutionScope,
    ownerSettings,
    panelContextKey,
    panelContextKeyRef,
    pr,
    prCacheKey,
    remoteStatus,
    remoteStatusInvalidation,
    repo,
    repoConnectionId,
    runtimeEnvironmentId,
    setConflictDetailsRefreshing,
    setGitStatusProbeErrorContextKey,
    setGitStatusRefreshNonce,
    setGitStatusSnapshot,
    setHostedReviewCreationSnapshot,
    sshConnectionStatus,
    updateWorktreeGitIdentity,
  } = context
useEffect(() => {
  if (
    !repo ||
    isFolder ||
    !branch ||
    !isPanelVisible ||
    !activeWorktreeId ||
    !activeWorktreePath ||
    (!runtimeEnvironmentId && repoConnectionId && sshConnectionStatus !== 'connected')
  ) {
    if (gitStatusSnapshotRetryTimerRef.current) {
      clearTimeout(gitStatusSnapshotRetryTimerRef.current)
      gitStatusSnapshotRetryTimerRef.current = null
    }
    // Why: hiding the panel or losing SSH should stop new work, not erase same-context Create PR eligibility that can still be retried.
    return
  }
  let stale = false
  const requestContextKey = panelContextKey
  const connectionId = activeConnectionId ?? undefined
  if (
    shouldCoalesceChecksPanelGitStatusSnapshotRefresh(
      gitStatusSnapshotInFlightContextRef.current,
      requestContextKey
    )
  ) {
    gitStatusSnapshotRerunContextRef.current = requestContextKey
    return () => {
      stale = true
    }
  }
  gitStatusSnapshotInFlightContextRef.current = requestContextKey
  // Why: global status maps are keyed only by worktree; use their changes as invalidation signals, then fetch a local snapshot.
  if (gitStatusSnapshotRetryTimerRef.current) {
    clearTimeout(gitStatusSnapshotRetryTimerRef.current)
    gitStatusSnapshotRetryTimerRef.current = null
  }
  setGitStatusSnapshot((snapshot) =>
    shouldClearChecksPanelGitStatusSnapshot(snapshot, requestContextKey) ? null : snapshot
  )
  const context = {
    settings: ownerSettings,
    worktreeId: activeWorktreeId,
    worktreePath: activeWorktreePath,
    connectionId
  }
  void (async () => {
    const status = await getRuntimeGitStatus(context)
    if (
      !stale &&
      shouldCommitChecksPanelGitStatusSnapshot(panelContextKeyRef.current, requestContextKey)
    ) {
      // Why: the Checks tab can be the only visible git surface; commit branch identity before branch-scoped upstream refresh can fail.
      updateWorktreeGitIdentity(activeWorktreeId, {
        head: status.head,
        branch: status.branch ?? (status.head ? null : undefined)
      })
    }
    let freshRemoteStatus = status.upstreamStatus
    if (activeWorktreePushTarget) {
      freshRemoteStatus = await getRuntimeGitUpstreamStatus(context, activeWorktreePushTarget)
    } else if (
      !freshRemoteStatus ||
      (freshRemoteStatus.ahead > 0 &&
        freshRemoteStatus.behind > 0 &&
        freshRemoteStatus.behindCommitsArePatchEquivalent === undefined)
    ) {
      freshRemoteStatus = await getRuntimeGitUpstreamStatus(context)
    }
    return { status, remoteStatus: freshRemoteStatus }
  })()
    .then(({ status, remoteStatus }) => {
      if (
        !stale &&
        shouldCommitChecksPanelGitStatusSnapshot(panelContextKeyRef.current, requestContextKey)
      ) {
        setGitStatusSnapshot({
          contextKey: requestContextKey,
          hasUncommittedChanges: status.entries.length > 0,
          remoteStatus,
          gitIdentity: {
            head: status.head,
            branch: status.branch ?? (status.head ? null : undefined)
          }
        })
        // A fresh probe succeeded, so this context is no longer in the "could not check branch status" state.
        setGitStatusProbeErrorContextKey((key) => (key === requestContextKey ? null : key))
      }
    })
    .catch((error) => {
      console.warn('[ChecksPanel] git status refresh before eligibility failed', error)
      if (!stale) {
        // Why: transient SSH/runtime flakes shouldn't hide an already-valid Create PR state for this branch; retry while visible.
        setGitStatusSnapshot((snapshot) =>
          shouldClearChecksPanelGitStatusSnapshot(snapshot, requestContextKey) ? null : snapshot
        )
        // Mark the probe failed so the empty state shows "Could not check branch status" instead of an indefinite "Checking branch status".
        if (
          shouldCommitChecksPanelGitStatusSnapshot(panelContextKeyRef.current, requestContextKey)
        ) {
          setGitStatusProbeErrorContextKey(requestContextKey)
        }
        gitStatusSnapshotRetryTimerRef.current = setTimeout(() => {
          gitStatusSnapshotRetryTimerRef.current = null
          if (
            shouldCommitChecksPanelGitStatusSnapshot(
              panelContextKeyRef.current,
              requestContextKey
            )
          ) {
            setGitStatusRefreshNonce((value) => value + 1)
          }
        }, GIT_STATUS_FAILURE_RETRY_MS)
      }
    })
    .finally(() => {
      if (gitStatusSnapshotInFlightContextRef.current === requestContextKey) {
        gitStatusSnapshotInFlightContextRef.current = null
      }
      if (gitStatusSnapshotRerunContextRef.current === requestContextKey) {
        gitStatusSnapshotRerunContextRef.current = null
        if (
          shouldCommitChecksPanelGitStatusSnapshot(panelContextKeyRef.current, requestContextKey)
        ) {
          setGitStatusRefreshNonce((value) => value + 1)
        }
      }
    })
  return () => {
    stale = true
    if (gitStatusSnapshotRetryTimerRef.current) {
      clearTimeout(gitStatusSnapshotRetryTimerRef.current)
      gitStatusSnapshotRetryTimerRef.current = null
    }
  }
}, [
  activeWorktreePushTarget,
  activeWorktreeId,
  activeWorktreePath,
  activeConnectionId,
  branch,
  gitStatusInvalidation,
  gitStatusRefreshNonce,
  isFolder,
  isPanelVisible,
  ownerSettings,
  panelContextKey,
  repo,
  repoConnectionId,
  remoteStatusInvalidation,
  runtimeEnvironmentId,
  sshConnectionStatus,
  updateWorktreeGitIdentity
])

useEffect(() => {
  if (!repo || isFolder || !branch) {
    setHostedReviewCreationSnapshot(null)
    return
  }
  if (!isPanelVisible || !gitStatusReadyForPanelContext) {
    return
  }
  let stale = false
  const requestContextKey = panelContextKey
  const requestStartedAt = Date.now()
  const requestGitFingerprint = buildChecksPanelEligibilityGitFingerprint({
    headOid: eligibilityHeadOidRef.current,
    hasUncommittedChanges,
    hasUpstream: remoteStatus?.hasUpstream,
    ahead: remoteStatus?.ahead,
    behind: remoteStatus?.behind,
    base: repo.worktreeBaseRef ?? null,
    runtimeEnvironmentId,
    repoConnectionId,
    localExecutionScope
  })
  void getHostedReviewCreationEligibility({
    repoPath: repo.path,
    repoId: repo.id,
    ...(activeWorktreePath ? { worktreePath: activeWorktreePath } : {}),
    branch,
    base: repo.worktreeBaseRef ?? null,
    hasUncommittedChanges,
    hasUpstream: remoteStatus?.hasUpstream,
    ahead: remoteStatus?.ahead,
    behind: remoteStatus?.behind,
    linkedGitHubPR: linkedPR,
    fallbackGitHubPR: fallbackGitHubPRNumber,
    linkedGitLabMR,
    linkedBitbucketPR,
    linkedAzureDevOpsPR,
    linkedGiteaPR
  })
    .then((result) => {
      if (!stale) {
        setHostedReviewCreationSnapshot({
          requestKey: hostedReviewCreationRequestKey,
          contextKey: requestContextKey,
          repoId: repo.id,
          worktreeId: activeWorktreeId,
          branch,
          requestStartedAt,
          completedAt: Date.now(),
          gitFingerprint: requestGitFingerprint,
          data: result
        })
      }
    })
    .catch(() => {
      // Why: a transient GitHub outage rethrows here; don't tear down the last confirmed snapshot so a clean composer survives the outage.
    })
  return () => {
    stale = true
  }
}, [
  panelContextKey,
  runtimeEnvironmentId,
  repoConnectionId,
  activeWorktreeId,
  activeWorktreePath,
  branch,
  getHostedReviewCreationEligibility,
  gitStatusReadyForPanelContext,
  hasUncommittedChanges,
  hostedReviewCreationRequestKey,
  eligibilityRefreshNonce,
  localExecutionScope,
  isFolder,
  isPanelVisible,
  linkedPR,
  fallbackGitHubPRNumber,
  linkedGitLabMR,
  linkedBitbucketPR,
  linkedAzureDevOpsPR,
  linkedGiteaPR,
  remoteStatus?.ahead,
  remoteStatus?.behind,
  remoteStatus?.hasUpstream,
  repo
])

useEffect(() => {
  if (
    !repo ||
    isFolder ||
    !branch ||
    !pr ||
    pr.mergeable !== 'CONFLICTING' ||
    !activeWorktreeId
  ) {
    conflictSummaryRefreshKeyRef.current = null
    setConflictDetailsRefreshing(false)
    return
  }

  const refreshKey = `${prCacheKey}::${branch}::${pr.number}`
  if (conflictSummaryRefreshKeyRef.current === refreshKey) {
    return
  }

  // Why: stale conflict metadata is visibly wrong here; force-refresh conflicting PRs once to avoid stale cached summaries.
  conflictSummaryRefreshKeyRef.current = refreshKey
  setConflictDetailsRefreshing(true)
  void fetchPRForBranch(repo.path, branch, {
    force: true,
    repoId: repo.id,
    worktreeId: activeWorktreeId ?? undefined,
    linkedPRNumber: linkedPR,
    fallbackPRNumber: fallbackGitHubPRNumber ?? pr.number
  }).finally(() => {
    // Why: fetchPRForBranch can rerun this effect; only the current key clears the spinner so stale requests don't race newer branches.
    if (conflictSummaryRefreshKeyRef.current === refreshKey) {
      setConflictDetailsRefreshing(false)
    }
  })
}, [
  repo,
  isFolder,
  branch,
  pr,
  prCacheKey,
  activeWorktreeId,
  linkedPR,
  fallbackGitHubPRNumber,
  fetchPRForBranch
])

// Fetch checks via cached store method
}
