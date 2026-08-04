import type { z } from 'zod'
import type { RpcContext } from '../core'
import {
  TerminalStreamOpcode,
  decodeTerminalStreamJson,
  decodeTerminalStreamText,
  encodeTerminalStreamFrame,
  encodeTerminalStreamJson
} from '../../../../shared/terminal-stream-protocol'
import { iterateTerminalOutputFrameChunks } from '../terminal-output-frame-chunks'
import { measureTerminalStreamByteLength } from '../terminal-stream-byte-length'
import {
  EMPTY_TERMINAL_REPLY_QUERY_SCAN_STATE,
  scanTerminalReplyQuerySequences,
  type TerminalReplyQuerySequence,
  type TerminalReplyQueryScanState
} from '../../../../shared/terminal-reply-query-scan'
import { TERMINAL_MULTIPLEX_PENDING_MAX_BYTES } from '../../../../shared/terminal-multiplex-flow-control'
import {
  createTerminalOutputBatcher,
  isTerminalInputLockedForClient,
  sendTerminalStreamInput,
  trimPendingOutputToBudget,
  isTerminalReadPayloadIncomplete,
  allocateTerminalStreamId,
  TERMINAL_QUERY_REPLAY_MAX_CHARS,
  type TerminalOutputChunk
} from './terminal-stream-state'
import { serializeBudgetedMobileSnapshot, updateViewportForClient } from './terminal-snapshot-support'
import type { TerminalSubscribe } from './terminal-schemas'
import {
  continueTerminalSubscribeBinaryStream,
  type TerminalSubscribeBinaryState
} from './terminal-subscribe-binary-lifecycle'

export async function handleTerminalSubscribe(
  params: z.infer<typeof TerminalSubscribe>,
  { runtime, connectionId, sendBinary, registerBinaryStreamHandler, signal }: RpcContext,
  emit: (result: unknown) => void
): Promise<void> {
      let leaf = runtime.resolveLeafForHandle(params.terminal)
      const isMobile = params.client?.type === 'mobile'
      const serializerGenerationBeforeAnyMount = isMobile
        ? (runtime.getRendererTerminalSerializerGenerationForHandle?.(params.terminal) ?? 0)
        : 0
      let rendererMountRequestedBeforePty = false
      const useBinaryStream = params.capabilities?.terminalBinaryStream === 1 && Boolean(sendBinary)
      // Why: a closed stream must not allocate listeners, mobile-fit state, or a hidden renderer surface no client will consume.
      if (signal?.aborted) {
        return
      }

      // Why: the PTY spawns asynchronously after tab creation; wait for it so an early subscribe gets a live stream instead of a bare scrollback+end.
      if (!leaf?.ptyId && params.client) {
        // Why: a never-mounted tab has no graph leaf to await; mounting the exact tab attaches its PTY without activating the worktree.
        rendererMountRequestedBeforePty = runtime.requestRendererTerminalTabMount(params.terminal)
        try {
          const ptyId = await runtime.waitForLeafPtyId(params.terminal, 10_000, signal)
          leaf = { ptyId }
        } catch {
          if (signal?.aborted) {
            return
          }
          // PTY wait timed out — fall through to scrollback-only path below
        }
      }

      if (!leaf?.ptyId) {
        const read = await runtime.readTerminal(params.terminal)
        emit({
          type: 'subscribed',
          streamId: null,
          lines: read.tail,
          truncated: isTerminalReadPayloadIncomplete(read)
        })
        emit({ type: 'end' })
        return
      }

      if (isMobile && (!useBinaryStream || !sendBinary)) {
        throw new Error('binary_terminal_stream_required')
      }

      const ptyId = leaf.ptyId
      const clientId = params.client?.id
      const mobileInputLeaseOnly =
        isMobile && params.capabilities?.mobileInputLeaseOnly === 1 && Boolean(clientId)
      // Why: mount/PTY wait and phone-fit can each emit a redraw creating suffix-only state, so capture the pre-mount absence signal first.
      const missingHeadlessStateBeforeMobileFit =
        isMobile &&
        (rendererMountRequestedBeforePty || runtime.hasHeadlessTerminalState?.(ptyId) === false)
      const serializerGenerationBeforeMobileFit = missingHeadlessStateBeforeMobileFit
        ? rendererMountRequestedBeforePty
          ? serializerGenerationBeforeAnyMount
          : runtime.getRendererTerminalSerializerGeneration(ptyId)
        : 0
      const supportsDesktopViewportClaims = params.capabilities?.desktopViewportClaims === 1
      if (mobileInputLeaseOnly && clientId) {
        let closed = false
        let resolveStream = (): void => {}
        const streamClosed = new Promise<void>((resolve) => {
          resolveStream = resolve
        })
        const subscriptionId = `${params.terminal}:${clientId}`
        // Why: chat needs the input-floor ack without registering a view subscriber or transporting duplicate PTY output.
        runtime.registerSubscriptionCleanup(
          subscriptionId,
          () => {
            closed = true
            runtime.handleMobileUnsubscribe(ptyId, clientId)
            emit({ type: 'end' })
            resolveStream()
          },
          connectionId
        )
        void runtime
          .waitForTerminal(params.terminal, { condition: 'exit', signal })
          .then(() => runtime.cleanupSubscription(subscriptionId))
          .catch(() => runtime.cleanupSubscription(subscriptionId))
        try {
          // Why: a lease-only subscriber has no terminal view, so its cached viewport must never phone-fit the PTY.
          await runtime.handleMobileSubscribe(ptyId, clientId, undefined)
          if (closed || signal?.aborted) {
            // Why: a disconnect can win the awaited subscribe and resurrect mobile presence after cleanup already released it.
            runtime.handleMobileUnsubscribe(ptyId, clientId)
            if (!closed) {
              runtime.cleanupSubscription(subscriptionId)
            }
            return
          }
          emit({ type: 'subscribed', streamId: null, lines: [], truncated: false })
          await streamClosed
        } catch (error) {
          runtime.cleanupSubscription(subscriptionId)
          throw error
        }
        return
      }
      // Why: only unregister the width floor this subscription took (see the multiplex stream's registeredRemoteDesktopDriver note).
      let registeredRemoteDesktopDriver = false
      if (!useBinaryStream) {
        // Why: a hidden watcher and a visible pane can subscribe to one terminal, so key by client so neither stream evicts the other.
        const subscriptionId = clientId ? `${params.terminal}:${clientId}` : params.terminal
        const remoteDesktopSubscriptionKey = `json:${allocateTerminalStreamId()}`
        let closed = false
        let outputBatcher: ReturnType<typeof createTerminalOutputBatcher> | null = null
        let unsubscribeData = (): void => {}
        let unsubscribeFit = (): void => {}
        let resolveStream = (): void => {}
        const streamClosed = new Promise<void>((resolve) => {
          resolveStream = resolve
        })
        // Why: register before viewport/snapshot awaits so a socket close can't orphan the stream listeners or its remote-desktop width floor.
        runtime.registerSubscriptionCleanup(
          subscriptionId,
          () => {
            closed = true
            outputBatcher?.flush()
            outputBatcher?.dispose()
            unsubscribeData()
            unsubscribeFit()
            if (registeredRemoteDesktopDriver && clientId) {
              runtime.unregisterRemoteDesktopViewer(ptyId, remoteDesktopSubscriptionKey)
            }
            emit({ type: 'end' })
            resolveStream()
          },
          connectionId
        )
        try {
          if (clientId && params.client && params.viewport) {
            registeredRemoteDesktopDriver = true
            await updateViewportForClient(
              runtime,
              ptyId,
              remoteDesktopSubscriptionKey,
              params.client,
              params.viewport,
              'desktop',
              'register',
              !supportsDesktopViewportClaims
            )
          }
          if (closed || signal?.aborted) {
            runtime.cleanupSubscription(subscriptionId)
            return
          }
          const read = await runtime.readTerminal(params.terminal)
          const serialized = await serializeBudgetedMobileSnapshot(runtime, ptyId, false)
          if (closed || signal?.aborted) {
            runtime.cleanupSubscription(subscriptionId)
            return
          }
          const size = runtime.getTerminalSize(ptyId)
          const displayMode = runtime.getMobileDisplayMode(ptyId)
          const seq = runtime.getLayout(ptyId)?.seq
          emit({
            type: 'scrollback',
            lines: read.tail,
            truncated: isTerminalReadPayloadIncomplete(read),
            serialized: serialized?.data,
            oscLinks: serialized?.oscLinks,
            cwd: serialized?.cwd,
            cols: serialized?.cols ?? size?.cols,
            rows: serialized?.rows ?? size?.rows,
            displayMode,
            seq
          })
          outputBatcher = createTerminalOutputBatcher((chunk) => {
            emit({ type: 'data', chunk })
          })
          const unsubscribeStreamData = runtime.subscribeToTerminalData(ptyId, (data) => {
            outputBatcher?.push(data)
          })
          // Why: the legacy JSON stream can feed a live xterm view, so register as a view subscriber; worst case is a withheld model reply, safer than a double reply.
          const releaseViewSubscriber = runtime.registerRemoteTerminalViewSubscriber(ptyId)
          unsubscribeData = () => {
            releaseViewSubscriber()
            unsubscribeStreamData()
          }
          unsubscribeFit = runtime.subscribeToFitOverrideChanges(ptyId, (event) => {
            outputBatcher?.flush()
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
          // Why: bind the exit-waiter to the connection signal so socket close/error removes it instead of leaking until real exit.
          void runtime
            .waitForTerminal(params.terminal, { condition: 'exit', signal })
            .then(() => runtime.cleanupSubscription(subscriptionId))
            .catch(() => runtime.cleanupSubscription(subscriptionId))
          await streamClosed
        } catch (error) {
          runtime.cleanupSubscription(subscriptionId)
          throw error
        }
        return
      }

      const streamId = allocateTerminalStreamId()
      const remoteDesktopSubscriptionKey = `stream:${streamId}`
      let cursor = 0
      let closed = false
      let buffering = true
      let pendingRemoteDesktopViewport: { cols: number; rows: number } | null = null
      // Why: cols the mobile client last rewrapped to; gates the resize re-stream to fire only on an actual width change.
      let lastResizeCols: number | undefined
      let resizeGeneration = 0
      let pendingOutput: TerminalOutputChunk[] = []
      let desktopClaimTail: Promise<boolean> = Promise.resolve(true)
      let pendingOutputBytes = 0
      let pendingOutputOverflowed = false
      let pendingQueryScanState: TerminalReplyQueryScanState = EMPTY_TERMINAL_REPLY_QUERY_SCAN_STATE
      const pendingQuerySequences: TerminalReplyQuerySequence[] = []
      let pendingQueryChars = 0
      let pendingQueryOverflowed = false
      let unsubscribeData = (): void => {}
      let unsubscribeResize = (): void => {}
      let unsubscribeFit = (): void => {}
      let unregisterBinaryHandler = (): void => {}
      let abortRendererMountWait = (): void => {}
      let lateRendererReadyPromise: Promise<boolean> | null = null
      let outputBatcher: ReturnType<typeof createTerminalOutputBatcher> | null = null
      let resolveStream = (): void => {}
      const streamClosed = new Promise<void>((resolve) => {
        resolveStream = resolve
      })
      const state: TerminalSubscribeBinaryState = {
        get closed() { return closed }, set closed(value) { closed = value },
        get buffering() { return buffering }, set buffering(value) { buffering = value },
        get pendingRemoteDesktopViewport() { return pendingRemoteDesktopViewport },
        set pendingRemoteDesktopViewport(value) { pendingRemoteDesktopViewport = value },
        get lastResizeCols() { return lastResizeCols }, set lastResizeCols(value) { lastResizeCols = value },
        get resizeGeneration() { return resizeGeneration }, set resizeGeneration(value) { resizeGeneration = value },
        get pendingOutput() { return pendingOutput }, set pendingOutput(value) { pendingOutput = value },
        get desktopClaimTail() { return desktopClaimTail }, set desktopClaimTail(value) { desktopClaimTail = value },
        get pendingOutputBytes() { return pendingOutputBytes }, set pendingOutputBytes(value) { pendingOutputBytes = value },
        get pendingOutputOverflowed() { return pendingOutputOverflowed },
        set pendingOutputOverflowed(value) { pendingOutputOverflowed = value },
        get pendingQuerySequences() { return pendingQuerySequences },
        get pendingQueryOverflowed() { return pendingQueryOverflowed },
        set pendingQueryOverflowed(value) { pendingQueryOverflowed = value },
        get unsubscribeResize() { return unsubscribeResize }, set unsubscribeResize(value) { unsubscribeResize = value },
        get unsubscribeFit() { return unsubscribeFit }, set unsubscribeFit(value) { unsubscribeFit = value },
        get abortRendererMountWait() { return abortRendererMountWait },
        set abortRendererMountWait(value) { abortRendererMountWait = value },
        get lateRendererReadyPromise() { return lateRendererReadyPromise },
        set lateRendererReadyPromise(value) { lateRendererReadyPromise = value },
        get outputBatcher() { return outputBatcher }, set outputBatcher(value) { outputBatcher = value },
        get registeredRemoteDesktopDriver() { return registeredRemoteDesktopDriver },
        set registeredRemoteDesktopDriver(value) { registeredRemoteDesktopDriver = value }
      }
      // Why: register cleanup before any await so a mid-subscribe disconnect still removes mobile presence; client-scoped ids also allow parallel desktop subscribers.
      const subscriptionId = clientId ? `${params.terminal}:${clientId}` : params.terminal
      runtime.registerSubscriptionCleanup(
        subscriptionId,
        () => {
          state.outputBatcher?.flush()
          state.outputBatcher?.dispose()
          state.closed = true
          unsubscribeData()
          state.unsubscribeResize()
          state.unsubscribeFit()
          unregisterBinaryHandler()
          state.abortRendererMountWait()
          if (isMobile && clientId) {
            runtime.handleMobileUnsubscribe(ptyId, clientId)
          } else if (state.registeredRemoteDesktopDriver && clientId) {
            runtime.unregisterRemoteDesktopViewer(ptyId, remoteDesktopSubscriptionKey)
          }
          emit({ type: 'end' })
          resolveStream()
        },
        connectionId
      )
      // Why: bind the exit-waiter to the connection signal so socket close/error removes it instead of leaking until real exit.
      void runtime
        .waitForTerminal(params.terminal, { condition: 'exit', signal })
        .then(() => runtime.cleanupSubscription(subscriptionId))
        .catch(() => runtime.cleanupSubscription(subscriptionId))
      const sendFrame = (
        opcode: TerminalStreamOpcode,
        payload: Uint8Array<ArrayBufferLike> = new Uint8Array(),
        frameSeq = cursor++
      ): void => {
        if (closed || !sendBinary) {
          return
        }
        sendBinary(encodeTerminalStreamFrame({ opcode, streamId, seq: frameSeq, payload }))
      }
      outputBatcher = createTerminalOutputBatcher((data, meta) => {
        if (meta?.cwd !== undefined) {
          sendFrame(
            TerminalStreamOpcode.Metadata,
            encodeTerminalStreamJson({ cwd: meta.cwd }),
            meta.seq
          )
        }
        for (const chunk of iterateTerminalOutputFrameChunks(data, meta)) {
          sendFrame(chunk.opcode ?? TerminalStreamOpcode.Output, chunk.bytes, chunk.seq)
        }
      })
      unregisterBinaryHandler =
        registerBinaryStreamHandler?.(streamId, (frame) => {
          if (closed) {
            return
          }
          if (frame.opcode === TerminalStreamOpcode.Input) {
            const text = decodeTerminalStreamText(frame.payload)
            if (!text) {
              return
            }
            if (isTerminalInputLockedForClient(runtime, ptyId, params.client)) {
              return
            }
            void desktopClaimTail.then(async (claimed) => {
              if (!claimed || isTerminalInputLockedForClient(runtime, ptyId, params.client)) {
                return
              }
              await sendTerminalStreamInput(runtime, {
                terminal: params.terminal,
                text,
                client: params.client,
                isMobile
              })
            })
            return
          }
          if (frame.opcode === TerminalStreamOpcode.Resize && params.client) {
            const viewport = decodeTerminalStreamJson<{ cols?: unknown; rows?: unknown }>(
              frame.payload
            )
            if (
              !viewport ||
              typeof viewport.cols !== 'number' ||
              typeof viewport.rows !== 'number'
            ) {
              return
            }
            const cols = viewport.cols
            const rows = viewport.rows
            if (clientId) {
              registeredRemoteDesktopDriver = true
              if (buffering) {
                pendingRemoteDesktopViewport = { cols: viewport.cols, rows: viewport.rows }
                return
              }
            }
            desktopClaimTail = desktopClaimTail
              .then(async (priorClaimed) => {
                const result = await updateViewportForClient(
                  runtime,
                  ptyId,
                  remoteDesktopSubscriptionKey,
                  params.client!,
                  { cols, rows },
                  'desktop',
                  'register',
                  !supportsDesktopViewportClaims
                )
                return supportsDesktopViewportClaims
                  ? priorClaimed && result.applied
                  : result.applied
              })
              .catch(() => false)
            return
          }
          if (
            frame.opcode === TerminalStreamOpcode.ClaimViewport &&
            params.client &&
            clientId &&
            !isMobile
          ) {
            const viewport = decodeTerminalStreamJson<{ cols?: unknown; rows?: unknown }>(
              frame.payload
            )
            if (
              !viewport ||
              typeof viewport.cols !== 'number' ||
              typeof viewport.rows !== 'number'
            ) {
              return
            }
            const cols = viewport.cols
            const rows = viewport.rows
            registeredRemoteDesktopDriver = true
            desktopClaimTail = desktopClaimTail
              .then(
                () =>
                  runtime.updateRemoteDesktopViewer(
                    ptyId,
                    remoteDesktopSubscriptionKey,
                    clientId,
                    cols,
                    rows,
                    true
                  ),
                () =>
                  runtime.updateRemoteDesktopViewer(
                    ptyId,
                    remoteDesktopSubscriptionKey,
                    clientId,
                    cols,
                    rows,
                    true
                  )
              )
              .catch(() => false)
          }
        }) ?? (() => {})
      const unsubscribeStreamData = runtime.subscribeToTerminalData(ptyId, (data, meta) => {
        if (closed) {
          return
        }
        if (buffering) {
          const rawLength = meta?.rawLength
          if (
            typeof meta?.seq === 'number' &&
            typeof rawLength === 'number' &&
            rawLength === data.length
          ) {
            const scan = scanTerminalReplyQuerySequences(
              data,
              meta.seq - rawLength,
              pendingQueryScanState
            )
            pendingQueryScanState = scan.state
            for (const query of scan.queries) {
              if (pendingQueryChars + query.data.length > TERMINAL_QUERY_REPLAY_MAX_CHARS) {
                pendingQueryOverflowed = true
                break
              }
              pendingQuerySequences.push(query)
              pendingQueryChars += query.data.length
            }
          } else {
            pendingQueryScanState = EMPTY_TERMINAL_REPLY_QUERY_SCAN_STATE
          }
          const remainingBudget = Math.max(
            1,
            TERMINAL_MULTIPLEX_PENDING_MAX_BYTES - pendingOutputBytes
          )
          const measurement = measureTerminalStreamByteLength(data, {
            stopAfterBytes: remainingBudget
          })
          pendingOutput.push({ data, bytes: measurement.byteLength, meta })
          pendingOutputBytes += measurement.byteLength
          const trimmed = trimPendingOutputToBudget(pendingOutput, pendingOutputBytes)
          pendingOutputBytes = trimmed.bytes
          pendingOutputOverflowed ||= trimmed.overflowed
          return
        }
        outputBatcher?.push(data, meta)
      })
      // Why: capture live bytes before mobile-fit awaits; registering presence first would suppress main while no view held the query.
      const releaseViewSubscriber = runtime.registerRemoteTerminalViewSubscriber(ptyId)
      unsubscribeData = () => {
        releaseViewSubscriber()
        unsubscribeStreamData()
      }
      await continueTerminalSubscribeBinaryStream({
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
      })
      return
}
