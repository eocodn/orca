import type { z } from 'zod'
import type { OrcaRuntimeService } from '../../orca-runtime'
import {
  TerminalStreamOpcode,
  encodeTerminalStreamJson
} from '../../../../shared/terminal-stream-protocol'
import type { TerminalReplyQuerySequence } from '../../../../shared/terminal-reply-query-scan'
import type { TerminalSubscribe } from './terminal-schemas'
import type {
  createTerminalOutputBatcher} from './terminal-stream-state';
import {
  getOutputAfterSnapshotSeq,
  isTerminalReadPayloadIncomplete,
  stripSnapshotBoundaryQuerySuffixes,
  trimPendingOutputCoveredBySnapshot,
  MOBILE_RENDERER_MOUNT_READY_TIMEOUT_MS,
  type TerminalOutputChunk
} from './terminal-stream-state'
import {
  serializeBudgetedMobileSnapshot,
  serializeStableMobileRendererSnapshot,
  sendMobileResizeRestream,
  sendSnapshotFrames
} from './terminal-snapshot-support'
import { updateViewportForClient } from './terminal-snapshot-support'

export type TerminalSubscribeBinaryState = {
  closed: boolean
  buffering: boolean
  pendingRemoteDesktopViewport: { cols: number; rows: number } | null
  lastResizeCols: number | undefined
  resizeGeneration: number
  pendingOutput: TerminalOutputChunk[]
  desktopClaimTail: Promise<boolean>
  pendingOutputBytes: number
  pendingOutputOverflowed: boolean
  pendingQuerySequences: TerminalReplyQuerySequence[]
  pendingQueryOverflowed: boolean
  unsubscribeResize: () => void
  unsubscribeFit: () => void
  abortRendererMountWait: () => void
  lateRendererReadyPromise: Promise<boolean> | null
  outputBatcher: ReturnType<typeof createTerminalOutputBatcher> | null
  registeredRemoteDesktopDriver: boolean
}

type TerminalSubscribeBinaryContext = {
  runtime: OrcaRuntimeService
  params: z.infer<typeof TerminalSubscribe>
  sendBinary?: (bytes: Uint8Array<ArrayBufferLike>) => boolean | void
  signal?: AbortSignal
  emit: (result: unknown) => void
  ptyId: string
  isMobile: boolean
  clientId?: string
  supportsDesktopViewportClaims: boolean
  missingHeadlessStateBeforeMobileFit: boolean
  serializerGenerationBeforeMobileFit: number
  rendererMountRequestedBeforePty: boolean
  state: TerminalSubscribeBinaryState
  streamId: number
  remoteDesktopSubscriptionKey: string
  sendFrame: (
    opcode: TerminalStreamOpcode,
    payload?: Uint8Array<ArrayBufferLike>,
    frameSeq?: number
  ) => void
  subscriptionId: string
  streamClosed: Promise<void>
}

export async function continueTerminalSubscribeBinaryStream({
  runtime,
  params,
  sendBinary,
  signal,
  emit,
  ptyId,
  isMobile,
  clientId,
  supportsDesktopViewportClaims,
  missingHeadlessStateBeforeMobileFit,
  serializerGenerationBeforeMobileFit,
  rendererMountRequestedBeforePty,
  state,
  streamId,
  remoteDesktopSubscriptionKey,
  sendFrame,
  subscriptionId,
  streamClosed
}: TerminalSubscribeBinaryContext): Promise<void> {
  const outputBatcher = state.outputBatcher!
  try {
    // Server-side auto-fit: resize PTY to phone dims before serializing scrollback.
    if (isMobile && clientId) {
      await runtime.handleMobileSubscribe(ptyId, clientId, params.viewport)
    } else if (clientId && params.viewport) {
      // Legacy subscribe records geometry without taking ownership.
      state.registeredRemoteDesktopDriver = true
      state.pendingRemoteDesktopViewport = params.viewport
    }
    if (state.closed) {
      return
    }

    let read = await runtime.readTerminal(params.terminal)
    let serialized = await serializeBudgetedMobileSnapshot(runtime, ptyId, isMobile)
    if (state.closed) {
      return
    }
    // Missing model state signals a never-attached PTY; renderer snapshots prove attachment.
    const mountRequested =
      missingHeadlessStateBeforeMobileFit &&
      serialized?.source !== 'renderer' &&
      (rendererMountRequestedBeforePty || runtime.requestRendererTerminalTabMount(params.terminal))
    if (missingHeadlessStateBeforeMobileFit && mountRequested) {
      // Idle legacy PTYs need a bounded serializer settle before their screen is replayed.
      const mountWaitController = new AbortController()
      const abortMountWait = (): void => mountWaitController.abort()
      state.abortRendererMountWait = abortMountWait
      if (signal?.aborted) {
        abortMountWait()
      } else {
        signal?.addEventListener('abort', abortMountWait, { once: true })
      }
      const rendererReadyPromise = runtime
        .waitForRendererTerminalSerializer(
          ptyId,
          serializerGenerationBeforeMobileFit,
          undefined,
          mountWaitController.signal
        )
        .catch(() => false)
      const finishMountWait = (): void => {
        signal?.removeEventListener('abort', abortMountWait)
        if (state.abortRendererMountWait === abortMountWait) {
          state.abortRendererMountWait = () => {}
        }
      }
      void rendererReadyPromise.then(finishMountWait, finishMountWait)
      let deadlineTimer: ReturnType<typeof setTimeout> | null = null
      const initialDeadline = new Promise<boolean>((resolve) => {
        deadlineTimer = setTimeout(() => resolve(false), MOBILE_RENDERER_MOUNT_READY_TIMEOUT_MS)
        if (typeof deadlineTimer.unref === 'function') {
          deadlineTimer.unref()
        }
      })
      const rendererReady = await Promise.race([rendererReadyPromise, initialDeadline])
      if (deadlineTimer) {
        clearTimeout(deadlineTimer)
      }
      if (state.closed || signal?.aborted) {
        return
      }
      if (rendererReady) {
        read = await runtime.readTerminal(params.terminal)
        const stableRendererSnapshot = await serializeStableMobileRendererSnapshot(runtime, ptyId)
        if (state.closed) {
          return
        }
        if (stableRendererSnapshot?.data.length) {
          serialized = stableRendererSnapshot
          const trailingOutput = state.pendingOutput.flatMap((item) => {
            const output = getOutputAfterSnapshotSeq(item, stableRendererSnapshot.seq)
            const seq = item.meta?.seq
            return output && typeof seq === 'number' ? [{ data: output.data, seq }] : []
          })
          runtime.replaceHeadlessTerminalFromRendererSnapshotForRecovery(
            ptyId,
            stableRendererSnapshot,
            trailingOutput
          )
        }
      } else {
        // Continue observing so an idle PTY can self-heal after the bounded initial response.
        state.lateRendererReadyPromise = rendererReadyPromise
      }
    }

    let initialOutputOverflowed = false
    if (state.pendingOutputOverflowed) {
      state.pendingOutput.splice(0)
      state.pendingOutputBytes = 0
      state.pendingOutputOverflowed = false
      read = await runtime.readTerminal(params.terminal)
      serialized = await serializeBudgetedMobileSnapshot(runtime, ptyId, isMobile)
      if (state.closed) {
        return
      }
      if (state.pendingOutputOverflowed) {
        initialOutputOverflowed = true
        state.pendingOutput.splice(0)
        state.pendingOutputBytes = 0
        state.pendingOutputOverflowed = false
      }
    }
    const size = runtime.getTerminalSize(ptyId)
    const displayMode = runtime.getMobileDisplayMode(ptyId)
    // Layout seq is the mobile stale-event filter's high-water mark.
    const layoutSeq = runtime.getLayout(ptyId)?.seq
    const snapshotFrameSeq = serialized?.seq ?? layoutSeq
    let snapshotOutputSeq = serialized?.seq
    emit({
      type: 'subscribed',
      streamId,
      lines: read.tail,
      truncated: initialOutputOverflowed || (!sendBinary && isTerminalReadPayloadIncomplete(read)),
      cols: serialized?.cols ?? size?.cols,
      rows: serialized?.rows ?? size?.rows,
      displayMode,
      seq: layoutSeq
    })
    const snapshotStats = sendSnapshotFrames(sendFrame, {
      kind: 'scrollback',
      cols: serialized?.cols ?? size?.cols ?? 80,
      rows: serialized?.rows ?? size?.rows ?? 24,
      displayMode,
      seq: snapshotFrameSeq,
      cwd: serialized?.cwd,
      truncated: initialOutputOverflowed,
      truncatedByByteBudget: serialized?.truncatedByByteBudget,
      oscLinks: serialized?.oscLinks,
      data: serialized?.data ?? ''
    })
    console.log('[mobile-terminal-stream] snapshot', {
      terminal: params.terminal,
      streamId,
      kind: 'scrollback',
      bytes: snapshotStats.bytes,
      chunks: snapshotStats.chunks,
      scrollbackRows: serialized?.scrollbackRows,
      truncatedByByteBudget: serialized?.truncatedByByteBudget === true
    })
    // The client already rewrapped to these cols via the initial snapshot replay.
    state.lastResizeCols = serialized?.cols ?? size?.cols
    let recoveryAttempts = 0
    // A fresh model snapshot covers a bounded pre-subscribe overflow without replay gaps.
    while (state.pendingOutputOverflowed && recoveryAttempts < 2) {
      state.pendingOutputOverflowed = false
      recoveryAttempts += 1
      const recovery = await serializeBudgetedMobileSnapshot(runtime, ptyId, isMobile)
      if (state.closed) {
        return
      }
      if (!recovery || typeof recovery.seq !== 'number') {
        break
      }
      const recoveryStats = sendSnapshotFrames(sendFrame, {
        kind: 'resized',
        cols: recovery.cols,
        rows: recovery.rows,
        displayMode,
        reason: 'pending-output-overflow',
        source: recovery.source,
        truncated: false,
        truncatedByByteBudget: recovery.truncatedByByteBudget,
        data: recovery.data
      })
      console.log('[mobile-terminal-stream] recovery snapshot', {
        terminal: params.terminal,
        streamId,
        reason: 'pending-output-overflow',
        bytes: recoveryStats.bytes,
        chunks: recoveryStats.chunks,
        scrollbackRows: recovery.scrollbackRows,
        truncatedByByteBudget: recovery.truncatedByByteBudget === true
      })
      const trimmed = trimPendingOutputCoveredBySnapshot(state.pendingOutput, recovery.seq)
      state.pendingOutput = trimmed.chunks
      state.pendingOutputBytes = trimmed.bytes
      snapshotOutputSeq = recovery.seq
    }
    state.buffering = false
    const bufferedOutput = state.pendingOutput.splice(0)
    const queryReplayData = state.pendingQueryOverflowed
      ? ''
      : state.pendingQuerySequences
          .filter(
            (query) =>
              initialOutputOverflowed ||
              (typeof snapshotOutputSeq === 'number' && query.startSeq < snapshotOutputSeq)
          )
          .map((query) => query.data)
          .join('')
    if (queryReplayData) {
      // Snapshots omit control queries, so replay the query once after trimming live output.
      outputBatcher.push(queryReplayData)
    }
    if (!initialOutputOverflowed) {
      for (const item of bufferedOutput) {
        const uncovered = getOutputAfterSnapshotSeq(item, snapshotOutputSeq)
        let uncoveredData = uncovered?.data ?? null
        let uncoveredMeta = uncovered?.meta
        if (
          uncoveredData &&
          uncoveredData !== item.data &&
          typeof snapshotOutputSeq === 'number' &&
          typeof item.meta?.seq === 'number' &&
          typeof item.meta.rawLength === 'number'
        ) {
          if (item.meta.rawLength === item.data.length) {
            uncoveredMeta = { ...item.meta, rawLength: uncoveredData.length }
          }
          uncoveredData = stripSnapshotBoundaryQuerySuffixes(
            uncoveredData,
            snapshotOutputSeq,
            snapshotOutputSeq,
            state.pendingQuerySequences
          )
        }
        if (uncoveredData) {
          outputBatcher.push(uncoveredData, uncoveredMeta)
        }
      }
    }
    state.pendingOutputBytes = 0
    outputBatcher.flush()
    const lateRendererReady = state.lateRendererReadyPromise
    state.lateRendererReadyPromise = null
    if (lateRendererReady) {
      void lateRendererReady
        .then(async (rendererReady) => {
          if (!rendererReady || state.closed) {
            return
          }
          outputBatcher.flush()
          const recovery = await serializeStableMobileRendererSnapshot(runtime, ptyId)
          if (state.closed || !recovery?.data.length) {
            return
          }
          // Late recovery only resets mobile at an exact renderer high-water mark.
          if (recovery.seq !== runtime.getPtyOutputSequence(ptyId)) {
            return
          }
          runtime.replaceHeadlessTerminalFromRendererSnapshotForRecovery(ptyId, recovery)
          const recoveryStats = sendSnapshotFrames(sendFrame, {
            kind: 'resized',
            cols: recovery.cols,
            rows: recovery.rows,
            displayMode,
            reason: 'renderer-mount-ready',
            source: recovery.source,
            truncated: false,
            truncatedByByteBudget: recovery.truncatedByByteBudget,
            data: recovery.data
          })
          state.lastResizeCols = recovery.cols
          console.log('[mobile-terminal-stream] recovery snapshot', {
            terminal: params.terminal,
            streamId,
            reason: 'renderer-mount-ready',
            bytes: recoveryStats.bytes,
            chunks: recoveryStats.chunks,
            scrollbackRows: recovery.scrollbackRows,
            truncatedByByteBudget: recovery.truncatedByByteBudget === true
          })
        })
        .catch(() => {})
    }
    const sendResizedFrame = (event: {
      cols: number
      rows: number
      displayMode: string
      reason: string
      seq?: number
    }): void => {
      state.lastResizeCols = event.cols
      sendFrame(
        TerminalStreamOpcode.Resized,
        encodeTerminalStreamJson({
          cols: event.cols,
          rows: event.rows,
          displayMode: event.displayMode,
          reason: event.reason,
          seq: event.seq
        })
      )
    }
    state.unsubscribeResize = runtime.subscribeToTerminalResize(ptyId, (event) => {
      outputBatcher.flush()
      const eventGeneration = state.resizeGeneration + 1
      state.resizeGeneration = eventGeneration
      // Width changes require a full mobile re-serialize to rewrap hard-wrapped scrollback.
      const widthChanged = isMobile && event.cols !== state.lastResizeCols
      if (widthChanged) {
        state.lastResizeCols = event.cols
        void sendMobileResizeRestream(
          runtime,
          ptyId,
          sendFrame,
          event,
          () => !state.closed && state.resizeGeneration === eventGeneration
        )
          .then((restreamed) => {
            if (state.closed || state.resizeGeneration !== eventGeneration) {
              return
            }
            if (!restreamed) {
              sendResizedFrame(event)
            }
          })
          .catch(() => {
            if (state.closed || state.resizeGeneration !== eventGeneration) {
              return
            }
            sendResizedFrame(event)
          })
        return
      }
      sendResizedFrame(event)
    })

    // Install resize before draining the parked viewport because applyLayout emits synchronously.
    if (
      clientId &&
      params.client &&
      state.registeredRemoteDesktopDriver &&
      state.pendingRemoteDesktopViewport
    ) {
      const viewport = state.pendingRemoteDesktopViewport
      state.pendingRemoteDesktopViewport = null
      void updateViewportForClient(
        runtime,
        ptyId,
        remoteDesktopSubscriptionKey,
        params.client,
        viewport,
        'desktop',
        'register',
        !supportsDesktopViewportClaims
      ).catch(() => {})
    }

    state.unsubscribeFit = !isMobile
      ? runtime.subscribeToFitOverrideChanges(ptyId, (event) => {
          const mode =
            event.mode === 'mobile-fit'
              ? event.mode
              : (runtime.getRemoteDesktopFitHold?.(ptyId, remoteDesktopSubscriptionKey).mode ??
                'desktop-fit')
          emit({
            type: 'fit-override-changed',
            mode,
            cols: event.cols,
            rows: event.rows
          })
        })
      : () => {}
  } catch (error) {
    runtime.cleanupSubscription(subscriptionId)
    throw error
  }

  await streamClosed
}
