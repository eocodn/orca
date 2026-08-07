type PtyConnectionReattachFallbackControllerArgs = {
  sessionId: string
  isDisposed: () => boolean
  rejectRejectedWhenDisposed: boolean
  getTransportStreamGeneration: () => number
  isCurrentAuthority: (sessionId: string) => boolean
  rejectObsoleteAuthority: (sessionId: string) => boolean
  isRejectedSessionExpired: (error: unknown) => boolean
  clearBindings: () => void
  clearBindingsOnRejectedError: boolean
  startFreshColdRestore: () => void
  reportError: (message: string) => void
  warnRejected: (message: string) => void
  reportRejectedError: boolean
  warnRejectedError: boolean
}

export function createPtyConnectionReattachFallbackController({
  sessionId,
  isDisposed,
  rejectRejectedWhenDisposed,
  getTransportStreamGeneration,
  isCurrentAuthority,
  rejectObsoleteAuthority,
  isRejectedSessionExpired,
  clearBindings,
  clearBindingsOnRejectedError,
  startFreshColdRestore,
  reportError,
  warnRejected,
  reportRejectedError,
  warnRejectedError
}: PtyConnectionReattachFallbackControllerArgs) {
  const onTransportError = (message: string): void => {
    if (isCurrentAuthority(sessionId)) {
      reportError(message)
    }
  }

  const onExpired = (): void => {
    if (isDisposed() || rejectObsoleteAuthority(sessionId)) {
      return
    }
    clearBindings()
    startFreshColdRestore()
  }

  const onRejected = (error: unknown, generation: number): void => {
    if (rejectRejectedWhenDisposed && isDisposed()) {
      return
    }
    if (generation !== getTransportStreamGeneration()) {
      return
    }
    if (rejectObsoleteAuthority(sessionId)) {
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    if (warnRejectedError) {
      warnRejected(message)
    }
    const expired = isRejectedSessionExpired(error)
    if (clearBindingsOnRejectedError || expired) {
      clearBindings()
    }
    if (!expired && reportRejectedError) {
      reportError(message)
    }
    startFreshColdRestore()
  }

  return { onTransportError, onExpired, onRejected }
}
