import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import {
  InvalidArgumentError,
  defineMethod,
  defineStreamingMethod,
  type RpcAnyMethod
} from '../core'
import { OptionalFiniteNumber, OptionalString, requiredString } from '../schemas'
import type { DriverState, OrcaRuntimeService } from '../../orca-runtime'
import {
  TerminalStreamOpcode,
  decodeTerminalStreamJson,
  decodeTerminalStreamText,
  encodeTerminalStreamFrame,
  encodeTerminalStreamJson,
  encodeTerminalStreamText,
  type TerminalStreamFrame
} from '../../../../shared/terminal-stream-protocol'
import {
  iterateTerminalOutputFrameChunks,
  sliceTerminalOutputSourceRanges,
  type TerminalOutputFrameChunk,
  type TerminalOutputMeta
} from '../terminal-output-frame-chunks'
import { TERMINAL_PANE_SPLIT_SOURCES } from '../../../../shared/feature-education-telemetry'
import type { TerminalOscLinkRange } from '../../../../shared/terminal-osc-link-ranges'
import {
  TERMINAL_INPUT_MAX_BYTES,
  TERMINAL_INPUT_TOO_LARGE_ERROR,
  isTerminalInputTooLargeWithYield
} from '../../../../shared/terminal-input'
import {
  measureTerminalStreamByteLength,
  terminalStreamByteLength,
  terminalStreamByteLengthExceeds
} from '../terminal-stream-byte-length'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import { isTerminalQueryReply } from '../../../../shared/terminal-query-reply'
import {
  EMPTY_TERMINAL_REPLY_QUERY_SCAN_STATE,
  scanTerminalReplyQuerySequences,
  type TerminalReplyQuerySequence,
  type TerminalReplyQueryScanState
} from '../../../../shared/terminal-reply-query-scan'
import {
  MOBILE_SNAPSHOT_BYTE_BUDGET,
  MOBILE_SUBSCRIBE_SCROLLBACK_ROWS
} from '../../scrollback-limits'
import { assertTerminalAgentSendable } from '../terminal-agent-send-guard'
import {
  navigationTargetsHost,
  resolveRuntimeNavigationTarget
} from '../../../../shared/runtime-navigation'
import {
  TERMINAL_MULTIPLEX_ACK_STREAM_INITIAL_WINDOW_BYTES,
  TERMINAL_MULTIPLEX_ACK_STREAM_MAX_WINDOW_BYTES,
  TERMINAL_MULTIPLEX_ACK_TOTAL_INITIAL_WINDOW_BYTES,
  TERMINAL_MULTIPLEX_ACK_TOTAL_MAX_WINDOW_BYTES,
  TERMINAL_MULTIPLEX_MAX_ACTIVE_STREAMS_PER_CONNECTION,
  TERMINAL_MULTIPLEX_MAX_PENDING_PTY_WAITS_PER_CONNECTION,
  TERMINAL_MULTIPLEX_PENDING_MAX_BYTES,
  TERMINAL_MULTIPLEX_STREAM_LIMIT_ERROR,
  TERMINAL_OUTPUT_BATCH_MAX_BYTES
} from '../../../../shared/terminal-multiplex-flow-control'
import { drainTerminalMultiplexRoundRobin } from '../terminal-multiplex-round-robin'
import type { TerminalSourceRangeLedger } from '../terminal-source-range-ledger'
import { TerminalSourceRangeRegistry } from '../terminal-source-range-registry'
import {
  sameTerminalOutputSourceIdentity,
  type TerminalOutputSourceRange
} from '../../../../shared/terminal-output-source-range'
import type { RemoteTerminalSourceRangeReplacementReservation } from '../../remote-terminal-source-range-consumer'
import {
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MIN_COLS,
  TERMINAL_MIN_ROWS
} from '../../../../shared/terminal-dimensions'

import {
  TerminalMultiplexStream,
  TerminalOutputChunk,
  TerminalViewportClient,
  MobileInputFloorClaimHolder,
  createTerminalOutputBatcher,
  isTerminalInputLockedForClient,
  assertTerminalSendTextWithinLimit,
  resolveMobileFloorClientId,
  sendTerminalStreamInput,
  commitMobileInputFloorClaim,
  getTerminalSendGuardRefusedReason,
  isTerminalSendGuardNotWritable,
  assertTerminalSendExactPtyBinding,
  appendPendingMultiplexOutput,
  getOutputAfterSnapshotSeq,
  stripSnapshotBoundaryQuerySuffixes,
  appendAckPendingOutput,
  trimPendingOutputToBudget,
  trimPendingOutputCoveredBySnapshot,
  iterateTerminalStreamTextPayloads,
  isTerminalReadPayloadIncomplete,
  normalizeMultiplexSnapshotScrollbackRows,
  requestedSnapshotScrollbackCandidates,
  serializeBudgetedRequestedSnapshot,
  sendSnapshotFrames,
  serializeBudgetedMobileSnapshot,
  serializeStableMobileRendererSnapshot,
  sendMobileResizeRestream,
  updateViewportForClient
} from './terminal-stream-state'
import {
  TerminalMultiplex,
  TerminalHandle,
  TerminalSubscribe,
  TerminalUnsubscribe,
  TerminalUpdateViewport
} from './terminal-schemas'

export const TERMINAL_SUBSCRIBE_METHODS: RpcAnyMethod[] = [
  defineStreamingMethod({     name: 'terminal.subscribe',     params: TerminalSubscribe,
    handler: async (       params,       { runtime, connectionId, sendBinary, registerBinaryStreamHandler, signal },
      emit     ) => {       let leaf = runtime.resolveLeafForHandle(params.terminal)
      const isMobile = params.client?.type === 'mobile'       const serializerGenerationBeforeAnyMount = isMobile         ? (runtime.getRendererTerminalSerializerGenerationForHandle?.(params.terminal) ?? 0)
        : 0       let rendererMountRequestedBeforePty = false       const useBinaryStream = params.capabilities?.terminalBinaryStream === 1 && Boolean(sendBinary)
      /* Why: a closed stream must not allocate listeners, mobile-fit state, or a hidden renderer surface no client will consume. */       if (signal?.aborted) {         return
      }       /* Why: the PTY spawns asynchronously after tab creation; wait for it so an early subscribe gets a live stream instead of a bare scrollback+end. */       if (!leaf?.ptyId && params.client) {
        /* Why: a never-mounted tab has no graph leaf to await; mounting the exact tab attaches its PTY without activating the worktree. */         rendererMountRequestedBeforePty = runtime.requestRendererTerminalTabMount(params.terminal)         try {
          const ptyId = await runtime.waitForLeafPtyId(params.terminal, 10_000, signal)           leaf = { ptyId }         } catch {
          if (signal?.aborted) {             return           }
          /* PTY wait timed out — fall through to scrollback-only path below */         }       }
      if (!leaf?.ptyId) {         const read = await runtime.readTerminal(params.terminal)         emit({
          type: 'subscribed',           streamId: null,           lines: read.tail,
          truncated: isTerminalReadPayloadIncomplete(read)         })         emit({ type: 'end' })
        return       }       if (isMobile && (!useBinaryStream || !sendBinary)) {
        throw new Error('binary_terminal_stream_required')       }       const ptyId = leaf.ptyId
      const clientId = params.client?.id       const mobileInputLeaseOnly =         isMobile && params.capabilities?.mobileInputLeaseOnly === 1 && Boolean(clientId)
      /* Why: mount/PTY wait and phone-fit can each emit a redraw creating suffix-only state, so capture the pre-mount absence signal first. */       const missingHeadlessStateBeforeMobileFit =         isMobile &&
        (rendererMountRequestedBeforePty || runtime.hasHeadlessTerminalState?.(ptyId) === false)       const serializerGenerationBeforeMobileFit = missingHeadlessStateBeforeMobileFit         ? rendererMountRequestedBeforePty
          ? serializerGenerationBeforeAnyMount           : runtime.getRendererTerminalSerializerGeneration(ptyId)         : 0
      const supportsDesktopViewportClaims = params.capabilities?.desktopViewportClaims === 1       if (mobileInputLeaseOnly && clientId) {         let closed = false
        let resolveStream = (): void => {}         const streamClosed = new Promise<void>((resolve) => {           resolveStream = resolve
        })         const subscriptionId = `${params.terminal}:${clientId}`         /* Why: chat needs the input-floor ack without registering a view subscriber or transporting duplicate PTY output. */
        runtime.registerSubscriptionCleanup(           subscriptionId,           () => {
            closed = true             runtime.handleMobileUnsubscribe(ptyId, clientId)             emit({ type: 'end' })
            resolveStream()           },           connectionId
        )         void runtime           .waitForTerminal(params.terminal, { condition: 'exit', signal })
          .then(() => runtime.cleanupSubscription(subscriptionId))           .catch(() => runtime.cleanupSubscription(subscriptionId))         try {
          /* Why: a lease-only subscriber has no terminal view, so its cached viewport must never phone-fit the PTY. */           await runtime.handleMobileSubscribe(ptyId, clientId, undefined)           if (closed || signal?.aborted) {
            /* Why: a disconnect can win the awaited subscribe and resurrect mobile presence after cleanup already released it. */             runtime.handleMobileUnsubscribe(ptyId, clientId)             if (!closed) {
              runtime.cleanupSubscription(subscriptionId)             }             return
          }           emit({ type: 'subscribed', streamId: null, lines: [], truncated: false })           await streamClosed
        } catch (error) {           runtime.cleanupSubscription(subscriptionId)           throw error
        }         return       }
      /* Why: only unregister the width floor this subscription took (see the multiplex stream's registeredRemoteDesktopDriver note). */       let registeredRemoteDesktopDriver = false       if (!useBinaryStream) {
        /* Why: a hidden watcher and a visible pane can subscribe to one terminal, so key by client so neither stream evicts the other. */         const subscriptionId = clientId ? `${params.terminal}:${clientId}` : params.terminal         const remoteDesktopSubscriptionKey = `json:${nextTerminalStreamId++}`
        let closed = false         let outputBatcher: ReturnType<typeof createTerminalOutputBatcher> | null = null         let unsubscribeData = (): void => {}
        let unsubscribeFit = (): void => {}         let resolveStream = (): void => {}         const streamClosed = new Promise<void>((resolve) => {
          resolveStream = resolve         })         /* Why: register before viewport/snapshot awaits so a socket close can't orphan the stream listeners or its remote-desktop width floor. */
        runtime.registerSubscriptionCleanup(           subscriptionId,           () => {
            closed = true             outputBatcher?.flush()             outputBatcher?.dispose()
            unsubscribeData()             unsubscribeFit()             if (registeredRemoteDesktopDriver && clientId) {
              runtime.unregisterRemoteDesktopViewer(ptyId, remoteDesktopSubscriptionKey)             }             emit({ type: 'end' })
            resolveStream()           },           connectionId
        )         try {           if (clientId && params.client && params.viewport) {
            registeredRemoteDesktopDriver = true             await updateViewportForClient(               runtime,
              ptyId,               remoteDesktopSubscriptionKey,               params.client,
              params.viewport,               'desktop',               'register',
              !supportsDesktopViewportClaims             )           }
          if (closed || signal?.aborted) {             runtime.cleanupSubscription(subscriptionId)             return
          }           const read = await runtime.readTerminal(params.terminal)           const serialized = await serializeBudgetedMobileSnapshot(runtime, ptyId, false)
          if (closed || signal?.aborted) {             runtime.cleanupSubscription(subscriptionId)             return
          }           const size = runtime.getTerminalSize(ptyId)           const displayMode = runtime.getMobileDisplayMode(ptyId)
          const seq = runtime.getLayout(ptyId)?.seq           emit({             type: 'scrollback',
            lines: read.tail,             truncated: isTerminalReadPayloadIncomplete(read),             serialized: serialized?.data,
            oscLinks: serialized?.oscLinks,             cwd: serialized?.cwd,             cols: serialized?.cols ?? size?.cols,
            rows: serialized?.rows ?? size?.rows,             displayMode,             seq
          })           outputBatcher = createTerminalOutputBatcher((chunk) => {             emit({ type: 'data', chunk })
          })           const unsubscribeStreamData = runtime.subscribeToTerminalData(ptyId, (data) => {             outputBatcher?.push(data)
          })           /* Why: the legacy JSON stream can feed a live xterm view, so register as a view subscriber; worst case is a withheld model reply, safer than a double reply. */           const releaseViewSubscriber = runtime.registerRemoteTerminalViewSubscriber(ptyId)
          unsubscribeData = () => {             releaseViewSubscriber()             unsubscribeStreamData()
          }           unsubscribeFit = runtime.subscribeToFitOverrideChanges(ptyId, (event) => {             outputBatcher?.flush()
            const mode =               event.mode === 'mobile-fit'                 ? event.mode
                : (runtime.getRemoteDesktopFitHold?.(ptyId, remoteDesktopSubscriptionKey).mode ??                   'desktop-fit')             emit({
              type: 'fit-override-changed',               mode,               cols: event.cols,
              rows: event.rows             })           })
          /* Why: bind the exit-waiter to the connection signal so socket close/error removes it instead of leaking until real exit. */           void runtime             .waitForTerminal(params.terminal, { condition: 'exit', signal })
            .then(() => runtime.cleanupSubscription(subscriptionId))             .catch(() => runtime.cleanupSubscription(subscriptionId))           await streamClosed
        } catch (error) {           runtime.cleanupSubscription(subscriptionId)           throw error
        }         return       }
      const streamId = nextTerminalStreamId++       const remoteDesktopSubscriptionKey = `stream:${streamId}`       let cursor = 0
      let closed = false       let buffering = true       let pendingRemoteDesktopViewport: { cols: number; rows: number } | null = null
      /* Why: cols the mobile client last rewrapped to; gates the resize re-stream to fire only on an actual width change. */       let lastResizeCols: number | undefined       let resizeGeneration = 0
      let pendingOutput: TerminalOutputChunk[] = []       let desktopClaimTail: Promise<boolean> = Promise.resolve(true)       let pendingOutputBytes = 0
      let pendingOutputOverflowed = false       let pendingQueryScanState: TerminalReplyQueryScanState = EMPTY_TERMINAL_REPLY_QUERY_SCAN_STATE       const pendingQuerySequences: TerminalReplyQuerySequence[] = []
      let pendingQueryChars = 0       let pendingQueryOverflowed = false       let unsubscribeData = (): void => {}
      let unsubscribeResize = (): void => {}       let unsubscribeFit = (): void => {}       let unregisterBinaryHandler = (): void => {}
      let abortRendererMountWait = (): void => {}       let lateRendererReadyPromise: Promise<boolean> | null = null       let outputBatcher: ReturnType<typeof createTerminalOutputBatcher> | null = null
      let resolveStream = (): void => {}       const streamClosed = new Promise<void>((resolve) => {         resolveStream = resolve
      })       /* Why: register cleanup before any await so a mid-subscribe disconnect still removes mobile presence; client-scoped ids also allow parallel desktop subscribers. */       const subscriptionId = clientId ? `${params.terminal}:${clientId}` : params.terminal
      runtime.registerSubscriptionCleanup(         subscriptionId,         () => {
          outputBatcher?.flush()           outputBatcher?.dispose()           closed = true
          unsubscribeData()           unsubscribeResize()           unsubscribeFit()
          unregisterBinaryHandler()           abortRendererMountWait()           if (isMobile && clientId) {
            runtime.handleMobileUnsubscribe(ptyId, clientId)           } else if (registeredRemoteDesktopDriver && clientId) {             runtime.unregisterRemoteDesktopViewer(ptyId, remoteDesktopSubscriptionKey)
          }           emit({ type: 'end' })           resolveStream()
        },         connectionId       )
      /* Why: bind the exit-waiter to the connection signal so socket close/error removes it instead of leaking until real exit. */       void runtime         .waitForTerminal(params.terminal, { condition: 'exit', signal })
        .then(() => runtime.cleanupSubscription(subscriptionId))         .catch(() => runtime.cleanupSubscription(subscriptionId))       const sendFrame = (
        opcode: TerminalStreamOpcode,         payload: Uint8Array<ArrayBufferLike> = new Uint8Array(),         frameSeq = cursor++
      ): void => {         if (closed || !sendBinary) {           return
        }         sendBinary(encodeTerminalStreamFrame({ opcode, streamId, seq: frameSeq, payload }))       }
      outputBatcher = createTerminalOutputBatcher((data, meta) => {         if (meta?.cwd !== undefined) {           sendFrame(
            TerminalStreamOpcode.Metadata,             encodeTerminalStreamJson({ cwd: meta.cwd }),             meta.seq
          )         }         for (const chunk of iterateTerminalOutputFrameChunks(data, meta)) {
          sendFrame(chunk.opcode ?? TerminalStreamOpcode.Output, chunk.bytes, chunk.seq)         }       })
      unregisterBinaryHandler =         registerBinaryStreamHandler?.(streamId, (frame) => {           if (closed) {
            return           }           if (frame.opcode === TerminalStreamOpcode.Input) {
            const text = decodeTerminalStreamText(frame.payload)             if (!text) {               return
            }             if (isTerminalInputLockedForClient(runtime, ptyId, params.client)) {               return
            }             void desktopClaimTail.then(async (claimed) => {               if (!claimed || isTerminalInputLockedForClient(runtime, ptyId, params.client)) {
                return               }               await sendTerminalStreamInput(runtime, {
                terminal: params.terminal,                 text,                 client: params.client,
                isMobile               })             })
            return           }           if (frame.opcode === TerminalStreamOpcode.Resize && params.client) {
            const viewport = decodeTerminalStreamJson<{ cols?: unknown; rows?: unknown }>(               frame.payload             )
            if (               !viewport ||               typeof viewport.cols !== 'number' ||
              typeof viewport.rows !== 'number'             ) {               return
            }             const cols = viewport.cols             const rows = viewport.rows
            if (clientId) {               registeredRemoteDesktopDriver = true               if (buffering) {
                pendingRemoteDesktopViewport = { cols: viewport.cols, rows: viewport.rows }                 return               }
            }             desktopClaimTail = desktopClaimTail               .then(async (priorClaimed) => {
                const result = await updateViewportForClient(                   runtime,                   ptyId,
                  remoteDesktopSubscriptionKey,                   params.client!,                   { cols, rows },
                  'desktop',                   'register',                   !supportsDesktopViewportClaims
                )                 return supportsDesktopViewportClaims                   ? priorClaimed && result.applied
                  : result.applied               })               .catch(() => false)
            return           }           if (
            frame.opcode === TerminalStreamOpcode.ClaimViewport &&             params.client &&             clientId &&
            !isMobile           ) {             const viewport = decodeTerminalStreamJson<{ cols?: unknown; rows?: unknown }>(
              frame.payload             )             if (
              !viewport ||               typeof viewport.cols !== 'number' ||               typeof viewport.rows !== 'number'
            ) {               return             }
            const cols = viewport.cols             const rows = viewport.rows             registeredRemoteDesktopDriver = true
            desktopClaimTail = desktopClaimTail               .then(                 () =>
                  runtime.updateRemoteDesktopViewer(                     ptyId,                     remoteDesktopSubscriptionKey,
                    clientId,                     cols,                     rows,
                    true                   ),                 () =>
                  runtime.updateRemoteDesktopViewer(                     ptyId,                     remoteDesktopSubscriptionKey,
                    clientId,                     cols,                     rows,
                    true                   )               )
              .catch(() => false)           }         }) ?? (() => {})
      const unsubscribeStreamData = runtime.subscribeToTerminalData(ptyId, (data, meta) => {         if (closed) {           return
        }         if (buffering) {           const rawLength = meta?.rawLength
          if (             typeof meta?.seq === 'number' &&             typeof rawLength === 'number' &&
            rawLength === data.length           ) {             const scan = scanTerminalReplyQuerySequences(
              data,               meta.seq - rawLength,               pendingQueryScanState
            )             pendingQueryScanState = scan.state             for (const query of scan.queries) {
              if (pendingQueryChars + query.data.length > TERMINAL_QUERY_REPLAY_MAX_CHARS) {                 pendingQueryOverflowed = true                 break
              }               pendingQuerySequences.push(query)               pendingQueryChars += query.data.length
            }           } else {             pendingQueryScanState = EMPTY_TERMINAL_REPLY_QUERY_SCAN_STATE
          }           const remainingBudget = Math.max(             1,
            TERMINAL_MULTIPLEX_PENDING_MAX_BYTES - pendingOutputBytes           )           const measurement = measureTerminalStreamByteLength(data, {
            stopAfterBytes: remainingBudget           })           pendingOutput.push({ data, bytes: measurement.byteLength, meta })
          pendingOutputBytes += measurement.byteLength           const trimmed = trimPendingOutputToBudget(pendingOutput, pendingOutputBytes)           pendingOutputBytes = trimmed.bytes
          pendingOutputOverflowed ||= trimmed.overflowed           return         }
        outputBatcher?.push(data, meta)       })       /* Why: capture live bytes before mobile-fit awaits; registering presence first would suppress main while no view held the query. */
      const releaseViewSubscriber = runtime.registerRemoteTerminalViewSubscriber(ptyId)       unsubscribeData = () => {         releaseViewSubscriber()
        unsubscribeStreamData()       }       /* Server-side auto-fit: resize PTY to phone dims before serializing scrollback */
      try {         if (isMobile && clientId) {           await runtime.handleMobileSubscribe(ptyId, clientId, params.viewport)
        } else if (clientId && params.viewport) {           /* Why: legacy subscribe records geometry without taking ownership; only an explicit activity/claim frame may suppress the host. */           registeredRemoteDesktopDriver = true
          pendingRemoteDesktopViewport = params.viewport         }         if (closed) {
          return         }         let read = await runtime.readTerminal(params.terminal)
        let serialized = await serializeBudgetedMobileSnapshot(runtime, ptyId, isMobile)         if (closed) {           return
        }         /* Why: missing model state (not blank snapshot text) signals a never-attached PTY; a renderer-sourced snapshot already proves attachment, so skip the remount. */         const mountRequested =
          missingHeadlessStateBeforeMobileFit &&           serialized?.source !== 'renderer' &&           (rendererMountRequestedBeforePty ||
            runtime.requestRendererTerminalTabMount(params.terminal))         if (missingHeadlessStateBeforeMobileFit && mountRequested) {           /* Why: an idle legacy PTY emits no later byte, so wait for a settle proving this remount completed before replaying its screen. */
          const mountWaitController = new AbortController()           const abortMountWait = (): void => mountWaitController.abort()           abortRendererMountWait = abortMountWait
          if (signal?.aborted) {             abortMountWait()           } else {
            signal?.addEventListener('abort', abortMountWait, { once: true })           }           const rendererReadyPromise = runtime
            .waitForRendererTerminalSerializer(               ptyId,               serializerGenerationBeforeMobileFit,
              undefined,               mountWaitController.signal             )
            .catch(() => false)           const finishMountWait = (): void => {             signal?.removeEventListener('abort', abortMountWait)
            if (abortRendererMountWait === abortMountWait) {               abortRendererMountWait = () => {}             }
          }           void rendererReadyPromise.then(finishMountWait, finishMountWait)           let deadlineTimer: ReturnType<typeof setTimeout> | null = null
          const initialDeadline = new Promise<boolean>((resolve) => {             deadlineTimer = setTimeout(() => resolve(false), MOBILE_RENDERER_MOUNT_READY_TIMEOUT_MS)             if (typeof deadlineTimer.unref === 'function') {
              deadlineTimer.unref()             }           })
          const rendererReady = await Promise.race([rendererReadyPromise, initialDeadline])           if (deadlineTimer) {             clearTimeout(deadlineTimer)
          }           if (closed || signal?.aborted) {             return
          }           if (rendererReady) {             read = await runtime.readTerminal(params.terminal)
            const stableRendererSnapshot = await serializeStableMobileRendererSnapshot(               runtime,               ptyId
            )             if (closed) {               return
            }             if (stableRendererSnapshot?.data.length) {               serialized = stableRendererSnapshot
              const trailingOutput = pendingOutput.flatMap((item) => {                 const output = getOutputAfterSnapshotSeq(item, stableRendererSnapshot.seq)                 const seq = item.meta?.seq
                return output && typeof seq === 'number' ? [{ data: output.data, seq }] : []               })               runtime.replaceHeadlessTerminalFromRendererSnapshotForRecovery(
                ptyId,                 stableRendererSnapshot,                 trailingOutput
              )             }           } else {
            /* Why: a renderer can settle after the bounded initial response; keep observing so an idle PTY self-heals without bytes. */             lateRendererReadyPromise = rendererReadyPromise           }
        }         let initialOutputOverflowed = false         if (pendingOutputOverflowed) {
          pendingOutput.splice(0)           pendingOutputBytes = 0           pendingOutputOverflowed = false
          read = await runtime.readTerminal(params.terminal)           serialized = await serializeBudgetedMobileSnapshot(runtime, ptyId, isMobile)           if (closed) {
            return           }           if (pendingOutputOverflowed) {
            initialOutputOverflowed = true             pendingOutput.splice(0)             pendingOutputBytes = 0
            pendingOutputOverflowed = false           }         }
        const size = runtime.getTerminalSize(ptyId)         const displayMode = runtime.getMobileDisplayMode(ptyId)         /* Why: layout seq is the mobile stale-event filter's high-water mark (undefined pre-transition is fail-open). See docs/mobile-terminal-layout-state-machine.md. */
        const layoutSeq = runtime.getLayout(ptyId)?.seq         const snapshotFrameSeq = serialized?.seq ?? layoutSeq         /* Why: track the seq that actually covered the buffered chunks (recovery snapshots advance it) or an absorbed query gets zero replies. */
        let snapshotOutputSeq = serialized?.seq         emit({           type: 'subscribed',
          streamId,           lines: read.tail,           truncated:
            initialOutputOverflowed || (!sendBinary && isTerminalReadPayloadIncomplete(read)),           cols: serialized?.cols ?? size?.cols,           rows: serialized?.rows ?? size?.rows,
          displayMode,           seq: layoutSeq         })
        const snapshotStats = sendSnapshotFrames(sendFrame, {           kind: 'scrollback',           cols: serialized?.cols ?? size?.cols ?? 80,
          rows: serialized?.rows ?? size?.rows ?? 24,           displayMode,           seq: snapshotFrameSeq,
          cwd: serialized?.cwd,           truncated: initialOutputOverflowed,           truncatedByByteBudget: serialized?.truncatedByByteBudget,
          oscLinks: serialized?.oscLinks,           data: serialized?.data ?? ''         })
        console.log('[mobile-terminal-stream] snapshot', {           terminal: params.terminal,           streamId,
          kind: 'scrollback',           bytes: snapshotStats.bytes,           chunks: snapshotStats.chunks,
          scrollbackRows: serialized?.scrollbackRows,           truncatedByByteBudget: serialized?.truncatedByByteBudget === true         })
        /* Why: baseline for resize re-stream gating; the client already rewrapped to these cols via the initial snapshot replay. */         lastResizeCols = serialized?.cols ?? size?.cols         let recoveryAttempts = 0
        /* Why: if the bounded pre-subscribe tail overflowed, only a fresh model snapshot covers the dropped middle without replay gaps. */         while (pendingOutputOverflowed && recoveryAttempts < 2) {           pendingOutputOverflowed = false
          recoveryAttempts += 1           const recovery = await serializeBudgetedMobileSnapshot(runtime, ptyId, isMobile)           if (closed) {
            return           }           if (!recovery) {
            break           }           /* Why: without an output seq (renderer fallback) covered chunks can't be trimmed exactly, so keep the bounded replay over an unverifiable snapshot. */
          if (typeof recovery.seq !== 'number') {             break           }
          /* Why: clients drop a repeat scrollback snapshot but apply 'resized' inline; omit seq so output-byte seqs don't pollute the layout-seq filter. */           const recoveryStats = sendSnapshotFrames(sendFrame, {             kind: 'resized',
            cols: recovery.cols,             rows: recovery.rows,             displayMode,
            reason: 'pending-output-overflow',             source: recovery.source,             truncated: false,
            truncatedByByteBudget: recovery.truncatedByByteBudget,             data: recovery.data           })
          console.log('[mobile-terminal-stream] recovery snapshot', {             terminal: params.terminal,             streamId,
            reason: 'pending-output-overflow',             bytes: recoveryStats.bytes,             chunks: recoveryStats.chunks,
            scrollbackRows: recovery.scrollbackRows,             truncatedByByteBudget: recovery.truncatedByByteBudget === true           })
          const trimmed = trimPendingOutputCoveredBySnapshot(pendingOutput, recovery.seq)           pendingOutput = trimmed.chunks           pendingOutputBytes = trimmed.bytes
          snapshotOutputSeq = recovery.seq         }         buffering = false
        const bufferedOutput = pendingOutput.splice(0)         const queryReplayData = pendingQueryOverflowed           ? ''
          : pendingQuerySequences               .filter(                 (query) =>
                  initialOutputOverflowed ||                   (typeof snapshotOutputSeq === 'number' && query.startSeq < snapshotOutputSeq)               )
              .map((query) => query.data)               .join('')         if (queryReplayData) {
          /* Why: snapshots omit control queries but their seq trims the live chunk; replay the post-snapshot query so the mobile xterm answers once. */           outputBatcher.push(queryReplayData)         }
        if (!initialOutputOverflowed) {           for (const item of bufferedOutput) {             const uncovered = getOutputAfterSnapshotSeq(item, snapshotOutputSeq)
            let uncoveredData = uncovered?.data ?? null             let uncoveredMeta = uncovered?.meta             if (
              uncoveredData &&               uncoveredData !== item.data &&               typeof snapshotOutputSeq === 'number' &&
              typeof item.meta?.seq === 'number' &&               typeof item.meta.rawLength === 'number'             ) {
              if (item.meta.rawLength === item.data.length) {                 uncoveredMeta = { ...item.meta, rawLength: uncoveredData.length }               }
              uncoveredData = stripSnapshotBoundaryQuerySuffixes(                 uncoveredData,                 snapshotOutputSeq,
                snapshotOutputSeq,                 pendingQuerySequences               )
            }             if (uncoveredData) {               outputBatcher.push(uncoveredData, uncoveredMeta)
            }           }         }
        pendingOutputBytes = 0         outputBatcher.flush()         const lateRendererReady = lateRendererReadyPromise
        lateRendererReadyPromise = null         if (lateRendererReady) {           void lateRendererReady
            .then(async (rendererReady) => {               if (!rendererReady || closed) {                 return
              }               outputBatcher?.flush()               const recovery = await serializeStableMobileRendererSnapshot(runtime, ptyId)
              if (closed) {                 return               }
              if (!recovery?.data.length) {                 return               }
              /* Why: late recovery has no buffered-output gate, so only an exact renderer high-water may reset mobile without erasing live bytes. */               if (recovery.seq !== runtime.getPtyOutputSequence(ptyId)) {                 return
              }               runtime.replaceHeadlessTerminalFromRendererSnapshotForRecovery(ptyId, recovery)               /* Why: shipped mobile clients apply resized snapshots in place, so a blank xterm recovers without resubscribe. */
              const recoveryStats = sendSnapshotFrames(sendFrame, {                 kind: 'resized',                 cols: recovery.cols,
                rows: recovery.rows,                 displayMode,                 reason: 'renderer-mount-ready',
                source: recovery.source,                 truncated: false,                 truncatedByByteBudget: recovery.truncatedByByteBudget,
                data: recovery.data               })               lastResizeCols = recovery.cols
              console.log('[mobile-terminal-stream] recovery snapshot', {                 terminal: params.terminal,                 streamId,
                reason: 'renderer-mount-ready',                 bytes: recoveryStats.bytes,                 chunks: recoveryStats.chunks,
                scrollbackRows: recovery.scrollbackRows,                 truncatedByByteBudget: recovery.truncatedByByteBudget === true               })
            })             .catch(() => {})         }
        const sendResizedFrame = (event: {           cols: number           rows: number
          displayMode: string           reason: string           seq?: number
        }): void => {           lastResizeCols = event.cols           sendFrame(
            TerminalStreamOpcode.Resized,             encodeTerminalStreamJson({               cols: event.cols,
              rows: event.rows,               displayMode: event.displayMode,               reason: event.reason,
              seq: event.seq             })           )
        }         unsubscribeResize = runtime.subscribeToTerminalResize(ptyId, (event) => {           outputBatcher?.flush()
          const eventGeneration = resizeGeneration + 1           resizeGeneration = eventGeneration           /* Why: xterm only re-wraps soft-wrapped lines, so a width change needs a full re-serialize+replay to rewrap restored hard-wrapped scrollback. */
          const widthChanged = isMobile && event.cols !== lastResizeCols           if (widthChanged) {             lastResizeCols = event.cols
            void sendMobileResizeRestream(               runtime,               ptyId,
              sendFrame,               event,               () => !closed && resizeGeneration === eventGeneration
            )               .then((restreamed) => {                 if (closed || resizeGeneration !== eventGeneration) {
                  return                 }                 if (!restreamed) {
                  sendResizedFrame(event)                 }               })
              /* Why: on re-stream failure, still emit the geometry-only Resized frame so the client never misses the resize. */               .catch(() => {                 if (closed || resizeGeneration !== eventGeneration) {
                  return                 }                 sendResizedFrame(event)
              })             return           }
          sendResizedFrame(event)         })         /* Install the resize listener before draining the parked viewport, since applyLayout emits synchronously. */
        if (           clientId &&           params.client &&
          registeredRemoteDesktopDriver &&           pendingRemoteDesktopViewport         ) {
          const viewport = pendingRemoteDesktopViewport           pendingRemoteDesktopViewport = null           void updateViewportForClient(
            runtime,             ptyId,             remoteDesktopSubscriptionKey,
            params.client,             viewport,             'desktop',
            'register',             !supportsDesktopViewportClaims           ).catch(() => {})
        }         /* Legacy fit-override-changed for non-mobile (desktop) subscribers */         unsubscribeFit = !isMobile
          ? runtime.subscribeToFitOverrideChanges(ptyId, (event) => {               const mode =                 event.mode === 'mobile-fit'
                  ? event.mode                   : (runtime.getRemoteDesktopFitHold?.(ptyId, remoteDesktopSubscriptionKey).mode ??                     'desktop-fit')
              emit({                 type: 'fit-override-changed',                 mode,
                cols: event.cols,                 rows: event.rows               })
            })           : () => {}       } catch (error) {
        runtime.cleanupSubscription(subscriptionId)         throw error       }
      await streamClosed     }   }),
]
