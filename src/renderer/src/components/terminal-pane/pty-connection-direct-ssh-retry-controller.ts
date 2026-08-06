import { useAppStore } from '@/store'
import type { DirectSshPaneRetryAttempt } from '@/store/slices/direct-ssh-terminal-recovery'
import { directSshAuthoritiesEqual } from '@/store/slices/direct-ssh-terminal-authority-ledger'
import { parseAppSshPtyId } from '../../../../shared/ssh-pty-id'
import { DIRECT_SSH_PANE_RETRY_SETTLEMENT_TIMEOUT_MS } from './pty-connection-runtime-state'

export type DirectSshRetryLease = Pick<
  DirectSshPaneRetryAttempt,
  'attemptId' | 'authority' | 'tabGeneration'
>

type DirectSshRetryControllerArgs = {
  cacheKey: string
  connectionId: string | null
  worktreeId: string
  tabId: string
  tabGeneration: number
  isDisposed: () => boolean
}

export function createPtyConnectionDirectSshRetryController({
  cacheKey,
  connectionId,
  worktreeId,
  tabId,
  tabGeneration,
  isDisposed
}: DirectSshRetryControllerArgs) {
  const state = useAppStore.getState()
  const pendingAttempt = state.directSshPaneRetryByTabId?.[tabId]
  const liveBinding = state.directSshLivePtyBindingByTabId?.[tabId]
  const directSshRetryAttempt: DirectSshRetryLease | undefined =
    pendingAttempt?.authority.targetId === connectionId &&
    pendingAttempt.tabGeneration === tabGeneration
      ? pendingAttempt
      : liveBinding?.authority.targetId === connectionId &&
          liveBinding.tabGeneration === tabGeneration
        ? liveBinding
        : undefined
  const pendingSpawnKey = directSshRetryAttempt
    ? JSON.stringify([cacheKey, directSshRetryAttempt.attemptId])
    : cacheKey
  let capturedPtyAccepted = false
  let settlementCancelled = false
  const settlementTimers = new Set<ReturnType<typeof setTimeout>>()
  const timedPromises = new WeakSet<object>()

  const capturedDirectSshRetryLeaseMatches = (): boolean => {
    if (!directSshRetryAttempt) {
      return true
    }
    const currentState = useAppStore.getState()
    const currentConnection = currentState.sshConnectionStates.get(
      directSshRetryAttempt.authority.targetId
    )
    const currentTab = (currentState.tabsByWorktree[worktreeId] ?? []).find(
      (candidate) => candidate.id === tabId
    )
    if (
      currentConnection?.providerEpoch !== directSshRetryAttempt.authority.providerEpoch ||
      currentConnection.connectionGeneration !==
        directSshRetryAttempt.authority.connectionGeneration ||
      (currentTab?.generation ?? 0) !== directSshRetryAttempt.tabGeneration
    ) {
      return false
    }
    const currentPendingAttempt = currentState.directSshPaneRetryByTabId?.[tabId]
    const pendingMatches =
      currentPendingAttempt?.attemptId === directSshRetryAttempt.attemptId &&
      directSshAuthoritiesEqual(currentPendingAttempt.authority, directSshRetryAttempt.authority) &&
      currentPendingAttempt.tabGeneration === directSshRetryAttempt.tabGeneration
    const currentLiveBinding = currentState.directSshLivePtyBindingByTabId?.[tabId]
    const liveBindingMatchesAttempt =
      currentLiveBinding?.attemptId === directSshRetryAttempt.attemptId &&
      directSshAuthoritiesEqual(currentLiveBinding.authority, directSshRetryAttempt.authority) &&
      currentLiveBinding.tabGeneration === directSshRetryAttempt.tabGeneration
    return pendingMatches || liveBindingMatchesAttempt
  }

  const capturedDirectSshRetryStateMatches = (ptyId: string): boolean => {
    if (!directSshRetryAttempt) {
      return true
    }
    const currentConnection = useAppStore
      .getState()
      .sshConnectionStates.get(directSshRetryAttempt.authority.targetId)
    return (
      parseAppSshPtyId(ptyId)?.connectionId === directSshRetryAttempt.authority.targetId &&
      currentConnection?.status === 'connected' &&
      capturedDirectSshRetryLeaseMatches()
    )
  }

  const claimCapturedDirectSshRetryPty = (ptyId: string): boolean => {
    if (!capturedDirectSshRetryStateMatches(ptyId)) {
      return false
    }
    capturedPtyAccepted = directSshRetryAttempt !== undefined
    return true
  }

  const canAdoptCapturedDirectSshRetryPty = (ptyId: string): boolean => {
    const canAdopt = capturedDirectSshRetryStateMatches(ptyId)
    if (canAdopt && directSshRetryAttempt) {
      capturedPtyAccepted = true
    }
    return canAdopt
  }

  const settleDirectSshPaneRetryAttempt = (
    attempt: DirectSshRetryLease | undefined,
    status: 'failed' | 'timed-out'
  ): void => {
    if (!attempt) {
      return
    }
    useAppStore.getState().settleDirectSshPaneRetry?.({
      status,
      tabId,
      attemptId: attempt.attemptId,
      authority: attempt.authority,
      tabGeneration: attempt.tabGeneration
    })
  }

  const armDirectSshPaneRetryTimeout = (
    promise: Promise<unknown>,
    attempt: DirectSshRetryLease | undefined
  ): void => {
    if (!attempt || isDisposed() || timedPromises.has(promise)) {
      return
    }
    timedPromises.add(promise)
    const timer = setTimeout(() => {
      settlementTimers.delete(timer)
      if (settlementCancelled) {
        return
      }
      settleDirectSshPaneRetryAttempt(attempt, 'timed-out')
    }, DIRECT_SSH_PANE_RETRY_SETTLEMENT_TIMEOUT_MS)
    settlementTimers.add(timer)
    void promise
      .finally(() => {
        settlementTimers.delete(timer)
        clearTimeout(timer)
      })
      .catch(() => {})
  }

  const dispose = (): void => {
    settlementCancelled = true
    for (const timer of settlementTimers) {
      clearTimeout(timer)
    }
    settlementTimers.clear()
  }

  return {
    directSshRetryAttempt,
    pendingSpawnKey,
    hasCapturedDirectSshRetryPtyAccepted: () => capturedPtyAccepted,
    capturedDirectSshRetryLeaseMatches,
    capturedDirectSshRetryStateMatches,
    claimCapturedDirectSshRetryPty,
    canAdoptCapturedDirectSshRetryPty,
    settleDirectSshPaneRetryAttempt,
    armDirectSshPaneRetryTimeout,
    dispose
  }
}
