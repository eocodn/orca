type ReplayPayloadMeta = {
  clearBeforeReplay?: boolean
  pendingEscapeTailAnsi?: string
}

type PendingReplayPayload = {
  data: string
  clearBeforeReplay: boolean
  ptyId: string | null
  generation: number
  streamGeneration: number
  pendingEscapeTailAnsi?: string
}

type PtyConnectionReattachReplayControllerArgs = {
  getPtyId: () => string | null
  getStreamGeneration: () => number
  isDisposed: () => boolean
  writeReplayDataAsync: (data: string) => Promise<void>
  rememberPayloadAgentSignal: (data: string, options: { fullScreenReplay: boolean }) => void
  scanReplayKeyboardModes: (data: string) => void
  buildReplayResetSequence: (data: string) => string
  sendFocusedReattachFocusInAfterReplay: (
    expectedPtyId: string | null,
    expectedStreamGeneration: number
  ) => void
  rebuildPaneWebgl: () => void
  beginLiveDataDeferral: (streamGeneration: number) => void
  finishLiveDataDeferral: (deliver: boolean, streamGeneration: number) => void
  runStructuralReplay: (
    operation: () => Promise<void>,
    shouldRestore: () => boolean
  ) => Promise<void>
}

export function createPtyConnectionReattachReplayController({
  getPtyId,
  getStreamGeneration,
  isDisposed,
  writeReplayDataAsync,
  rememberPayloadAgentSignal,
  scanReplayKeyboardModes,
  buildReplayResetSequence,
  sendFocusedReattachFocusInAfterReplay,
  rebuildPaneWebgl,
  beginLiveDataDeferral,
  finishLiveDataDeferral,
  runStructuralReplay
}: PtyConnectionReattachReplayControllerArgs) {
  let pendingPayload: PendingReplayPayload | null = null
  let payloadGeneration = 0
  let drainQueued = false
  let replayWriteQueue: Promise<void> = Promise.resolve()

  const isCurrentPayload = (payload: PendingReplayPayload): boolean =>
    !isDisposed() &&
    payload.generation === payloadGeneration &&
    payload.streamGeneration === getStreamGeneration() &&
    getPtyId() === payload.ptyId

  const drain = async (
    expectedPtyId: string | null,
    expectedStreamGeneration: number
  ): Promise<boolean> => {
    let appliedCurrentPayload = false
    while (pendingPayload !== null) {
      if (
        pendingPayload.ptyId !== expectedPtyId ||
        pendingPayload.streamGeneration !== expectedStreamGeneration
      ) {
        return false
      }
      if (getPtyId() !== expectedPtyId || getStreamGeneration() !== expectedStreamGeneration) {
        pendingPayload = null
        return false
      }
      const payload = pendingPayload
      pendingPayload = null
      if (!isCurrentPayload(payload)) {
        continue
      }
      // Why: relay replay can overlap pixels already painted before disconnect.
      if (payload.clearBeforeReplay) {
        await writeReplayDataAsync('\x1b[2J\x1b[3J\x1b[H')
        if (!isCurrentPayload(payload)) {
          continue
        }
      }
      if (payload.clearBeforeReplay || payload.data.length > 0) {
        // Why: an empty clearing frame still invalidates an older replay-derived agent signal.
        rememberPayloadAgentSignal(payload.data, {
          fullScreenReplay: payload.clearBeforeReplay
        })
      }
      // Why: relay reconnects can redeliver the same window, so replay scanning must use set semantics.
      scanReplayKeyboardModes(payload.data)
      await writeReplayDataAsync(payload.data)
      if (!isCurrentPayload(payload)) {
        continue
      }
      if (payload.clearBeforeReplay || payload.data.length > 0) {
        await writeReplayDataAsync(buildReplayResetSequence(payload.data))
        if (!isCurrentPayload(payload)) {
          continue
        }
        sendFocusedReattachFocusInAfterReplay(payload.ptyId, payload.streamGeneration)
      }
      if (payload.pendingEscapeTailAnsi) {
        // Why last: reset ESC bytes would otherwise abort the serialized dangling escape tail.
        await writeReplayDataAsync(payload.pendingEscapeTailAnsi)
      }
      if (!isCurrentPayload(payload)) {
        continue
      }
      rebuildPaneWebgl()
      appliedCurrentPayload = true
    }
    return appliedCurrentPayload
  }

  const scheduleDrain = (): void => {
    if (drainQueued) {
      return
    }
    const scheduledPtyId = pendingPayload?.ptyId ?? null
    const scheduledStreamGeneration = pendingPayload?.streamGeneration ?? getStreamGeneration()
    drainQueued = true
    // Why: newer live bytes must wait until the authoritative replay has parsed or its clear can erase them.
    beginLiveDataDeferral(scheduledStreamGeneration)
    let replayCompleted = false
    replayWriteQueue = replayWriteQueue
      .catch(() => undefined)
      .then(() =>
        runStructuralReplay(
          async () => {
            replayCompleted = await drain(scheduledPtyId, scheduledStreamGeneration)
          },
          () =>
            !isDisposed() &&
            getPtyId() === scheduledPtyId &&
            getStreamGeneration() === scheduledStreamGeneration
        )
      )
      .then(() => {
        replayCompleted &&= !isDisposed() && getPtyId() === scheduledPtyId
      })
      .finally(() => {
        drainQueued = false
        if (pendingPayload !== null) {
          // Why: the payload retains callback-time PTY identity; never retag it from current transport state.
          scheduleDrain()
        }
        finishLiveDataDeferral(replayCompleted, scheduledStreamGeneration)
      })
  }

  return {
    enqueue(
      data: string,
      meta: ReplayPayloadMeta = {},
      streamGeneration = getStreamGeneration()
    ): void {
      pendingPayload = {
        data,
        clearBeforeReplay: meta.clearBeforeReplay !== false,
        ptyId: getPtyId(),
        generation: (payloadGeneration += 1),
        streamGeneration,
        ...(meta.pendingEscapeTailAnsi ? { pendingEscapeTailAnsi: meta.pendingEscapeTailAnsi } : {})
      }
      scheduleDrain()
    },
    async whenIdle(): Promise<void> {
      while (true) {
        const observedQueue = replayWriteQueue
        await observedQueue
        if (observedQueue === replayWriteQueue) {
          return
        }
      }
    }
  }
}
