type PtyConnectionAttachCandidateArgs = {
  restoredPtyId: string | null
  existingPtyId: string | null | undefined
  existingPtyClaimedBySibling: boolean
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
}

export function resolvePtyConnectionAttachCandidate({
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
}: PtyConnectionAttachCandidateArgs) {
  const tabFallbackPtyId = existingPtyId && !existingPtyClaimedBySibling ? existingPtyId : null
  const restoredSessionId = restoredPtyId ?? null
  const sleptRemoteRuntimeSessionId =
    restoredSessionId && isRemoteRuntimePtyId(restoredSessionId) && hasSleepingAgentSession
      ? restoredSessionId
      : null
  const detachedLivePtyId =
    tabFallbackPtyId && !hadExistingPaneTransportAtConnect && !sleptRemoteRuntimeSessionId
      ? restoredSessionId
        ? restoredSessionId === tabFallbackPtyId
          ? restoredSessionId
          : null
        : tabFallbackPtyId
      : null
  const detachedRemoteLeafPtyId =
    restoredSessionId && isRemoteRuntimePtyId(restoredSessionId) && !hasSleepingAgentSession
      ? restoredSessionId
      : null
  const candidateReattachSessionId =
    restoredSessionId && restoredSessionId !== detachedLivePtyId
      ? restoredSessionId
      : detachedLivePtyId
  const runtimeHostPtyWakeHint =
    runtimeEnvironmentId &&
    candidateReattachSessionId &&
    !isRemoteRuntimePtyId(candidateReattachSessionId)
      ? candidateReattachSessionId
      : null
  const candidateHasEagerBuffer = Boolean(
    candidateReattachSessionId &&
    !isRemoteRuntimePtyId(candidateReattachSessionId) &&
    hasEagerBuffer(candidateReattachSessionId)
  )
  const eagerLivePtyId =
    candidateReattachSessionId &&
    candidateHasEagerBuffer &&
    currentTabLivePtyIds.includes(candidateReattachSessionId)
      ? candidateReattachSessionId
      : null
  const legacyAttachOnlyPtyId = legacyWorkerAutomaticResumeBlocked
    ? candidateReattachSessionId
    : null
  const pairedParkedReattachSessionId =
    mountFollowsTerminalPark &&
    candidateReattachSessionId &&
    isRemoteRuntimePtyId(candidateReattachSessionId) &&
    canRestorePairedParkedTerminal(candidateReattachSessionId)
      ? candidateReattachSessionId
      : null
  const deferredReattachSessionId = legacyAttachOnlyPtyId
    ? null
    : (runtimeHostPtyWakeHint ??
      pairedParkedReattachSessionId ??
      (candidateReattachSessionId &&
      !isRemoteRuntimePtyId(candidateReattachSessionId) &&
      !candidateHasEagerBuffer &&
      isSessionOwnedByWorktree(candidateReattachSessionId, worktreeId)
        ? candidateReattachSessionId
        : null))
  const attachPtyId =
    legacyAttachOnlyPtyId ?? detachedRemoteLeafPtyId ?? detachedLivePtyId ?? eagerLivePtyId

  return {
    tabFallbackPtyId,
    sleptRemoteRuntimeSessionId,
    detachedLivePtyId,
    detachedRemoteLeafPtyId,
    candidateReattachSessionId,
    runtimeHostPtyWakeHint,
    candidateHasEagerBuffer,
    eagerLivePtyId,
    legacyAttachOnlyPtyId,
    pairedParkedReattachSessionId,
    deferredReattachSessionId,
    attachPtyId,
    attachUsesEagerBuffer: attachPtyId !== null && attachPtyId === eagerLivePtyId
  }
}
