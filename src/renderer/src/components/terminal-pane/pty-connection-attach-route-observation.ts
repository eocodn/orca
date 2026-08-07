import { resolvePtyConnectionAttachCandidate } from './pty-connection-attach-candidate'

export type PtyConnectionAttachRouteObservationArgs = {
  paneId: string
  tabId: string
  restoredPtyId: string | null
  existingPtyId: string | null | undefined
  pendingSpawnKey: string
  hadExistingPaneTransportAtConnect: boolean
  hasSleepingAgentSession: boolean
  currentTabLivePtyIds: string[]
  runtimeEnvironmentId: string | null
  mountFollowsTerminalPark: boolean
  worktreeId: string
  legacyWorkerAutomaticResumeBlocked: boolean
  isRemoteRuntimePtyId: (ptyId: string) => boolean
  hasEagerBuffer: (ptyId: string) => boolean
  canRestorePairedParkedTerminal: (ptyId: string) => boolean
  isSessionOwnedByWorktree: (sessionId: string, worktreeId: string) => boolean
  isPtyClaimedBySibling: (ptyId: string) => boolean
  clearPanePtyLayoutBinding: (ptyId: string | null) => void
  clearTabPtyId: (tabId: string, ptyId: string) => void
  recordDiagnostic: (message: string) => void
}

export function preparePtyConnectionAttachRouteObservation({
  paneId,
  tabId,
  restoredPtyId,
  existingPtyId,
  pendingSpawnKey,
  hadExistingPaneTransportAtConnect,
  hasSleepingAgentSession,
  currentTabLivePtyIds,
  runtimeEnvironmentId,
  mountFollowsTerminalPark,
  worktreeId,
  legacyWorkerAutomaticResumeBlocked,
  isRemoteRuntimePtyId,
  hasEagerBuffer,
  canRestorePairedParkedTerminal,
  isSessionOwnedByWorktree,
  isPtyClaimedBySibling,
  clearPanePtyLayoutBinding,
  clearTabPtyId,
  recordDiagnostic
}: PtyConnectionAttachRouteObservationArgs): ReturnType<
  typeof resolvePtyConnectionAttachCandidate
> {
  const existingPtyClaimedBySibling = Boolean(existingPtyId && isPtyClaimedBySibling(existingPtyId))
  const candidate = resolvePtyConnectionAttachCandidate({
    restoredPtyId,
    existingPtyId,
    existingPtyClaimedBySibling,
    hadExistingPaneTransportAtConnect,
    hasSleepingAgentSession,
    currentTabLivePtyIds,
    runtimeEnvironmentId,
    mountFollowsTerminalPark,
    worktreeId,
    legacyWorkerAutomaticResumeBlocked,
    isRemoteRuntimePtyId,
    hasEagerBuffer,
    canRestorePairedParkedTerminal,
    isSessionOwnedByWorktree
  })

  if (candidate.sleptRemoteRuntimeSessionId) {
    clearPanePtyLayoutBinding(null)
    clearTabPtyId(tabId, candidate.sleptRemoteRuntimeSessionId)
  }
  recordDiagnostic(
    `pane=${paneId} tab=${tabId} restored=${restoredPtyId} existing=${existingPtyId} detached=${candidate.detachedRemoteLeafPtyId ?? candidate.detachedLivePtyId} reattach=${candidate.deferredReattachSessionId} hasTransport=${hadExistingPaneTransportAtConnect} pendingKey=${pendingSpawnKey}`
  )
  return candidate
}
