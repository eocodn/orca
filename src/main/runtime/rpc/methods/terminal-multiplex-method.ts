import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { defineStreamingMethod, type RpcAnyMethod } from '../core'
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
  type TerminalOutputFrameChunk
} from '../terminal-output-frame-chunks'
import {
  TERMINAL_MULTIPLEX_ACK_STREAM_INITIAL_WINDOW_BYTES,
  TERMINAL_MULTIPLEX_ACK_STREAM_MAX_WINDOW_BYTES,
  TERMINAL_MULTIPLEX_ACK_TOTAL_INITIAL_WINDOW_BYTES,
  TERMINAL_MULTIPLEX_ACK_TOTAL_MAX_WINDOW_BYTES,
  TERMINAL_MULTIPLEX_MAX_ACTIVE_STREAMS_PER_CONNECTION,
  TERMINAL_MULTIPLEX_MAX_PENDING_PTY_WAITS_PER_CONNECTION,
  TERMINAL_MULTIPLEX_STREAM_LIMIT_ERROR
} from '../../../../shared/terminal-multiplex-flow-control'
import { drainTerminalMultiplexRoundRobin } from '../terminal-multiplex-round-robin'
import { TerminalSourceRangeRegistry } from '../terminal-source-range-registry'
import type { RemoteTerminalSourceRangeReplacementReservation } from '../../remote-terminal-source-range-consumer'
import {
  TerminalMultiplexStream,
  createTerminalOutputBatcher,
  isTerminalInputLockedForClient,
  sendTerminalStreamInput,
  appendPendingMultiplexOutput,
  getOutputAfterSnapshotSeq,
  appendAckPendingOutput} from './terminal-stream-state'
import {
  normalizeMultiplexSnapshotScrollbackRows,
  serializeBudgetedRequestedSnapshot,
  sendSnapshotFrames,
  serializeBudgetedMobileSnapshot,
  sendMobileResizeRestream
} from './terminal-snapshot-support'
import { updateViewportForClient } from './terminal-snapshot-support'
import {
  TerminalMultiplex,
  TerminalMultiplexLegacyAckFrame,
  TerminalMultiplexSnapshotRequestFrame,
  TerminalMultiplexSourceRangeAckFrame,
  TerminalMultiplexSubscribeFrame
} from './terminal-schemas'

export const TERMINAL_MULTIPLEX_METHODS: RpcAnyMethod[] = [
  defineStreamingMethod({     name: 'terminal.multiplex',     params: TerminalMultiplex,     handler: async ( _params, { runtime, connectionId, sendBinary, registerBinaryStreamHandler, signal },       emit     ) => { if (!sendBinary || !registerBinaryStreamHandler || !connectionId) {  throw new Error('binary_terminal_stream_required') } let closed = false
      let cursor = 0
const streams = new Map<number, TerminalMultiplexStream>()
const sourceRangeRegistry = new TerminalSourceRangeRegistry()
      const pendingPtyWaitControllers = new Map<number, Set<AbortController>>()
let ackTotalInFlightBytes = 0
let ackTotalWindowBytes = TERMINAL_MULTIPLEX_ACK_TOTAL_INITIAL_WINDOW_BYTES
      let ackFlushCursorStreamId: number | null = null
let resolveMultiplex = (): void => {}
const multiplexClosed = new Promise<void>((resolve) => {  resolveMultiplex = resolve })
const sendFrame = (  streamId: number, opcode: TerminalStreamOpcode, payload: Uint8Array<ArrayBufferLike> = new Uint8Array(),  seq?: number, onRejected?: () => void ): boolean => {  if (closed) { onRejected?.()
return false  } /* Why: a seq-less Output chunk must carry sentinel 0, not the control-frame cursor, or it poisons the client's frame-drop tracker. */ const resolvedSeq =  typeof seq === 'number' ? seq : opcode === TerminalStreamOpcode.Output ? 0 : cursor++
let sent: boolean | void
try {  sent = sendBinary( encodeTerminalStreamFrame({ opcode, streamId, seq: resolvedSeq, payload }) )  } catch { onRejected?.()
closeMultiplex()
 return false } if (sent === false) {  onRejected?.()
/* Why: false means the transport discarded this frame; reconnect is the only available retry boundary with an authoritative snapshot. */ closeMultiplex()
 return false } return true       }
const sendStreamError = (streamId: number, message: string): void => { sendFrame(streamId, TerminalStreamOpcode.Error, encodeTerminalStreamText(message))
 emit({ type: 'error', streamId, message }) }
const sendResizedFrame = (  stream: TerminalMultiplexStream, event: { cols: number; rows: number; displayMode: string; reason: string; seq?: number } ): void => {  stream.lastResizeCols = event.cols
sendFrame( stream.streamId,  TerminalStreamOpcode.Resized, encodeTerminalStreamJson({ cols: event.cols,  rows: event.rows, displayMode: event.displayMode, reason: event.reason,  seq: event.seq }) )       }
const canSendAckGatedOutput = (stream: TerminalMultiplexStream, bytes: number): boolean => { if (!stream.ackOutput) {  return true } return (  stream.ackInFlightBytes + bytes <= stream.ackWindowBytes && ackTotalInFlightBytes + bytes <= ackTotalWindowBytes && (!stream.ackOutputSourceRanges || stream.sourceRangeLedger?.canAccept(bytes) === true)  ) }
const sendAckGatedOutput = (  stream: TerminalMultiplexStream, chunk: TerminalOutputFrameChunk ): boolean => {  const prepared = stream.ackOutputSourceRanges ? stream.sourceRangeLedger?.prepareAccept( chunk.bytes.byteLength,  chunk.displayLength, chunk.sourceRanges ?? [], chunk.seq  ) : undefined
if (stream.ackOutputSourceRanges && prepared?.status !== 'ready') {  if (prepared?.status !== 'capacity') { detachStream(stream.streamId, true) }  return false } const admission = prepared?.status === 'ready' ? prepared.admission : undefined
 const sent = sendFrame( stream.streamId, chunk.opcode ?? TerminalStreamOpcode.Output,  chunk.bytes, chunk.seq, admission?.rollback  )
if (!sent) { return false  } if (admission && !admission.commit()) { detachStream(stream.streamId, true)
 return false } if (stream.ackOutput) {  stream.ackInFlightBytes += chunk.bytes.byteLength
ackTotalInFlightBytes += chunk.bytes.byteLength }  return true }
const queueOrSendOutput = (  stream: TerminalMultiplexStream, chunk: TerminalOutputFrameChunk ): void => {  if (closed || streams.get(stream.streamId) !== stream || stream.outputPaused) { return }  if ( stream.ackPendingOutputOverflowed || stream.ackPendingOutput.length > 0 ||  !canSendAckGatedOutput(stream, chunk.bytes.byteLength) ) { appendAckPendingOutput(stream, chunk)
 return } sendAckGatedOutput(stream, chunk)       }
const sendAckRecoverySnapshot = async (stream: TerminalMultiplexStream): Promise<void> => { if (  closed || streams.get(stream.streamId) !== stream || stream.outputPaused ||  stream.ackRecoverySnapshotInFlight ) { return  } stream.ackRecoverySnapshotInFlight = true
let replacement: RemoteTerminalSourceRangeReplacementReservation | null = null
 try { const serialized = await serializeBudgetedRequestedSnapshot(runtime, stream.ptyId, 0)
if (closed || streams.get(stream.streamId) !== stream || stream.outputPaused) {  return } if (!serialized) {  throw new Error('Remote terminal recovery snapshot unavailable.') } if (  stream.ackOutputSourceRanges && (serialized.source === undefined || typeof serialized.seq !== 'number') ) {  throw new Error('Remote terminal recovery snapshot source identity unavailable.') } if (  stream.ackOutputSourceRanges && serialized.source !== undefined && typeof serialized.seq === 'number'  ) { replacement = runtime.reserveRemoteTerminalSourceRangeReplacement( {  ptyId: stream.ptyId, consumerId: stream.remoteDesktopSubscriptionKey, streamGeneration: stream.streamGeneration  }, serialized.seq, 'ack-pending-overflow'  )
stream.sourceRangeReplacement = replacement }  const displayMode = runtime.getMobileDisplayMode(stream.ptyId)
const publication = sendSnapshotFrames( (opcode, payload) =>  !closed && streams.get(stream.streamId) === stream && sendFrame(stream.streamId, opcode, payload),  { kind: 'scrollback', cols: serialized.cols,  rows: serialized.rows, displayMode, reason: 'ack-pending-overflow',  seq: serialized.seq, source: serialized.source, truncatedByByteBudget: serialized.truncatedByByteBudget,  data: serialized.data } )
 if (!publication.published) { throw new Error('Remote terminal recovery snapshot was not published.') }  if (closed || streams.get(stream.streamId) !== stream) { throw new Error('Remote terminal recovery snapshot stream detached.') }  const localReplacement = replacement ? typeof serialized.seq === 'number' ? stream.sourceRangeLedger?.planSourceRangeReplacement(serialized.seq)  : null : null
if (replacement && !localReplacement) {  throw new Error('Remote terminal recovery source ledger replacement unavailable.') } if (  replacement && (!serialized.source || typeof serialized.seq !== 'number' ||  !runtime.commitRemoteTerminalSourceRangeReplacement(replacement, { source: serialized.source, seq: serialized.seq  })) ) { throw new Error('Remote terminal recovery snapshot replacement was not accepted.')  } localReplacement?.commit()
stream.sourceRangeReplacement = null
 replacement = null
if (typeof serialized.seq === 'number') { const snapshotSeq = serialized.seq
 const retained = stream.ackPendingOutput.filter( (chunk) => !(typeof chunk.seq === 'number' && chunk.seq <= snapshotSeq) )
 stream.ackPendingOutput = retained
stream.ackPendingOutputBytes = retained.reduce( (total, chunk) => total + chunk.bytes.byteLength,  0 ) }  stream.ackPendingOutputOverflowed = false } catch (error) { if (replacement) {  if (stream.sourceRangeReplacement === replacement) { stream.sourceRangeReplacement = null
runtime.rollbackRemoteTerminalSourceRangeReplacement(  replacement, 'ack-pending-overflow-unpublished' )  } replacement = null }  if (closed || streams.get(stream.streamId) !== stream) { return }  sendStreamError( stream.streamId, error instanceof Error ? error.message : 'Remote terminal recovery snapshot failed.'  )
detachStream(stream.streamId, true) } finally {  if (streams.get(stream.streamId) === stream) { stream.ackRecoverySnapshotInFlight = false
flushAllAckPendingOutput()  } } }
      const flushAckPendingOutput = ( stream: TerminalMultiplexStream, maxChunks = Number.POSITIVE_INFINITY       ): number => { if (stream.outputPaused) { return 0  } if (stream.ackPendingOutputOverflowed) { void sendAckRecoverySnapshot(stream)
 return 0 } let flushed = 0
 while ( flushed < stream.ackPendingOutput.length && flushed < maxChunks &&  canSendAckGatedOutput(stream, stream.ackPendingOutput[flushed]!.bytes.byteLength) ) { if (!sendAckGatedOutput(stream, stream.ackPendingOutput[flushed]!)) {  return flushed } flushed += 1  } if (flushed > 0) { stream.ackPendingOutput.splice(0, flushed)
 stream.ackPendingOutputBytes = stream.ackPendingOutput.reduce( (total, pending) => total + pending.bytes.byteLength, 0  ) } return flushed       }
const flushAllAckPendingOutput = (): void => { const ordered = Array.from(streams.values())
 ackFlushCursorStreamId = drainTerminalMultiplexRoundRobin({ streams: ordered, cursorStreamId: ackFlushCursorStreamId,  canContinue: () => !closed, drainOne: (stream) => { if (streams.get(stream.streamId) !== stream) {  return false } if (flushAckPendingOutput(stream, 1) > 0) {  return true } return false  } }) }
      const acknowledgeOutput = (stream: TerminalMultiplexStream, bytes: number): void => { if (!stream.ackOutput || bytes <= 0) { return  } const acknowledged = Math.min(stream.ackInFlightBytes, bytes)
stream.ackWindowBytes = Math.min(  TERMINAL_MULTIPLEX_ACK_STREAM_MAX_WINDOW_BYTES, stream.ackWindowBytes + acknowledged )
 ackTotalWindowBytes = Math.min( TERMINAL_MULTIPLEX_ACK_TOTAL_MAX_WINDOW_BYTES, ackTotalWindowBytes + acknowledged  )
stream.ackInFlightBytes -= acknowledged
ackTotalInFlightBytes = Math.max(0, ackTotalInFlightBytes - acknowledged)
 flushAllAckPendingOutput() }
const acknowledgeSourceRanges = (  stream: TerminalMultiplexStream, streamGeneration: string, ackedEndByte: number       ): void => { if (!stream.ackOutputSourceRanges) { return  } const result = stream.sourceRangeLedger?.acknowledge(streamGeneration, ackedEndByte)
if (!result) {  return } if (result.status !== 'accepted') {  return } if (result.settled.length > 0) {  runtime.settleRemoteTerminalSourceRanges( { ptyId: stream.ptyId,  consumerId: stream.remoteDesktopSubscriptionKey, streamGeneration: stream.streamGeneration },  result.settled ) }  acknowledgeOutput(stream, result.acknowledgedBytes) }
const detachSourceRangeConsumer = (stream: TerminalMultiplexStream, reason: string): void => {  if (!stream.sourceRangeConsumerAttached) { return }  stream.sourceRangeConsumerAttached = false
const ledger = stream.sourceRangeLedger
stream.sourceRangeLedger = null
 if (!ledger) { return }  const identity = { ptyId: stream.ptyId, consumerId: stream.remoteDesktopSubscriptionKey,  streamGeneration: stream.streamGeneration }
const transfer = ledger.beginTransfer()
 const ranges = transfer.frames.flatMap((frame) => frame.sourceRanges)
try { runtime.cancelRemoteTerminalSourceRanges(identity, ranges, reason)  } finally { transfer.commit() }       }
const detachStream = ( streamId: number,  emitEnd: boolean, releaseRemoteDesktopDriver = true ): void => {  const stream = streams.get(streamId)
if (!stream) { return  } const replacement = stream.sourceRangeReplacement
stream.sourceRangeReplacement = null
 if (replacement) { runtime.rollbackRemoteTerminalSourceRangeReplacement( replacement,  'stream-detached-replacement-aborted' ) }  stream.outputBatcher.flush()
stream.outputBatcher.dispose()
detachSourceRangeConsumer(stream, 'stream-detached')
 ackTotalInFlightBytes = Math.max(0, ackTotalInFlightBytes - stream.ackInFlightBytes)
stream.ackInFlightBytes = 0
stream.ackPendingOutput = []
 stream.ackPendingOutputBytes = 0
stream.ackPendingOutputOverflowed = false
stream.ackRecoverySnapshotInFlight = false
 stream.unsubscribeData()
stream.unsubscribeResize()
stream.unsubscribeFit()
 stream.unsubscribeDriver()
stream.unregisterBinaryHandler()
streams.delete(streamId)
 flushAllAckPendingOutput()
/* Why: release the runtime exit-waiter for this slot (see the field's note); delete before abort so its .catch no-ops instead of re-detaching. */ stream.exitWaiterAbort.abort()
 if (stream.isMobile && stream.client?.id) { runtime.handleMobileUnsubscribe(stream.ptyId, stream.client.id) } else if (  releaseRemoteDesktopDriver && stream.registeredRemoteDesktopDriver && stream.client?.id  ) { /* Why: release the width floor only if THIS stream took it, so a passive stream can't release a peer's floor. */ runtime.unregisterRemoteDesktopViewer(stream.ptyId, stream.remoteDesktopSubscriptionKey)  } if (emitEnd) { emit({ type: 'end', streamId })  } }
const cancelPendingPtyWaits = (streamId: number): void => {  const controllers = pendingPtyWaitControllers.get(streamId)
if (!controllers) { return  } pendingPtyWaitControllers.delete(streamId)
for (const controller of controllers) {  controller.abort() } }
      const cancelAllPendingPtyWaits = (): void => { for (const streamId of Array.from(pendingPtyWaitControllers.keys())) { cancelPendingPtyWaits(streamId)  } }
const closeMultiplex = (): void => {  if (closed) { return }  closed = true
signal?.removeEventListener('abort', cancelAllPendingPtyWaits)
cancelAllPendingPtyWaits()
 const remoteDesktopKeysByPty = new Map<string, string[]>()
for (const streamId of Array.from(streams.keys())) { const stream = streams.get(streamId)
 if (stream?.registeredRemoteDesktopDriver && !stream.isMobile && stream.client?.id) { const keys = remoteDesktopKeysByPty.get(stream.ptyId) ?? []
keys.push(stream.remoteDesktopSubscriptionKey)
 remoteDesktopKeysByPty.set(stream.ptyId, keys) } detachStream(streamId, false, false)  } /* Why: one connection can own many panes on the same PTY; remove floors together so close scans each registry once. */ for (const [ptyId, subscriptionKeys] of remoteDesktopKeysByPty) {  void runtime.unregisterRemoteDesktopViewers(ptyId, subscriptionKeys) } unregisterControlHandler()
 resolveMultiplex() }
const handleSlotFrame = (  stream: TerminalMultiplexStream, frame: TerminalStreamFrame ): void => {  if (closed || streams.get(stream.streamId) !== stream) { return }  if (frame.opcode === TerminalStreamOpcode.Unsubscribe) { cancelPendingPtyWaits(stream.streamId)
detachStream(stream.streamId, false)
 return } if (frame.opcode === TerminalStreamOpcode.Ack) {  const payload = decodeTerminalStreamJson<unknown>(frame.payload) ?? {}
if (stream.ackOutputSourceRanges) { const parsed = TerminalMultiplexSourceRangeAckFrame.safeParse(payload)
 if (parsed.success) { acknowledgeSourceRanges( stream,  parsed.data.streamGeneration, parsed.data.ackedEndByte )  } } else { const parsed = TerminalMultiplexLegacyAckFrame.safeParse(payload)
 if (parsed.success) { acknowledgeOutput(stream, parsed.data.bytes) }  } return }  if (frame.opcode === TerminalStreamOpcode.Input) { const text = decodeTerminalStreamText(frame.payload)
if (!text) {  return } if (isTerminalInputLockedForClient(runtime, stream.ptyId, stream.client)) {  return } /* Mobile already has the higher-priority floor, so a rejected desktop claim must not suppress later phone input. */  const inputClaimTail = stream.isMobile ? Promise.resolve(true) : stream.desktopClaimTail
void inputClaimTail.then((claimed) => { if (!claimed || isTerminalInputLockedForClient(runtime, stream.ptyId, stream.client)) {  return } return sendTerminalStreamInput(runtime, {  terminal: stream.terminal, text, client: stream.client,  isMobile: stream.isMobile }) })
 return } if (frame.opcode === TerminalStreamOpcode.SetOutputPaused && stream.supportsOutputPause) {  const payload = decodeTerminalStreamJson<{ paused?: unknown }>(frame.payload)
if (typeof payload?.paused !== 'boolean' || stream.outputPaused === payload.paused) { return  } stream.outputPaused = payload.paused
if (stream.outputPaused) {  stream.outputBatcher.flush()
stream.ackPendingOutput = []
stream.ackPendingOutputBytes = 0
 stream.ackPendingOutputOverflowed = false } return  } if (frame.opcode === TerminalStreamOpcode.Resize && stream.client) { const viewport = decodeTerminalStreamJson<{ cols?: unknown; rows?: unknown }>(  frame.payload )
if (!viewport || typeof viewport.cols !== 'number' || typeof viewport.rows !== 'number') {  return } const cols = viewport.cols
 const rows = viewport.rows
/* Why: resize registers stream-scoped geometry so detach can release it; older clients lack explicit claims. */ if (!stream.isMobile && stream.client?.id) {  stream.registeredRemoteDesktopDriver = true
if (stream.buffering) { stream.pendingRemoteDesktopViewport = { cols: viewport.cols, rows: viewport.rows }
 return } }  stream.desktopClaimTail = stream.desktopClaimTail .then(async (priorClaimed) => { const result = await updateViewportForClient(  runtime, stream.ptyId, stream.remoteDesktopSubscriptionKey,  stream.client!, { cols, rows }, stream.isMobile ? 'mobile' : 'desktop',  'register', !stream.supportsDesktopViewportClaims )
 return stream.supportsDesktopViewportClaims ? priorClaimed && result.applied : result.applied  }) .catch(() => false)
return  } if ( frame.opcode === TerminalStreamOpcode.ClaimViewport &&  stream.client && !stream.isMobile ) {  const viewport = decodeTerminalStreamJson<{ cols?: unknown; rows?: unknown }>( frame.payload )
 if (!viewport || typeof viewport.cols !== 'number' || typeof viewport.rows !== 'number') { return }  const cols = viewport.cols
const rows = viewport.rows
stream.registeredRemoteDesktopDriver = true
 stream.desktopClaimTail = stream.desktopClaimTail .then( () =>  runtime.updateRemoteDesktopViewer( stream.ptyId, stream.remoteDesktopSubscriptionKey,  stream.client!.id, cols, rows,  true ), () =>  runtime.updateRemoteDesktopViewer( stream.ptyId, stream.remoteDesktopSubscriptionKey,  stream.client!.id, cols, rows,  true ) )  .catch(() => false)
return }  if (frame.opcode === TerminalStreamOpcode.SnapshotRequest) { const payload = TerminalMultiplexSnapshotRequestFrame.safeParse( decodeTerminalStreamJson<unknown>(frame.payload) ?? {}  )
void sendRequestedSnapshot(stream, payload.success ? payload.data : {}) }       }
const sendRequestedSnapshot = async ( stream: TerminalMultiplexStream,  request: z.infer<typeof TerminalMultiplexSnapshotRequestFrame> ): Promise<void> => { if (closed || streams.get(stream.streamId) !== stream) {  return } stream.outputBatcher.flush()
 stream.pendingOutputOverflowed = false
stream.buffering = true
const requestId = request.requestId
 let sentSnapshotOutputSeq: number | undefined
try { const scrollbackRows = normalizeMultiplexSnapshotScrollbackRows(request.scrollbackRows)
 let serialized = await serializeBudgetedRequestedSnapshot( runtime, stream.ptyId,  scrollbackRows )
if (closed || streams.get(stream.streamId) !== stream) {  return } let size = runtime.getTerminalSize(stream.ptyId)
 let displayMode = runtime.getMobileDisplayMode(stream.ptyId)
if (stream.pendingOutputOverflowed) { /* Why: the overflowed tail is newer than the first snapshot, so retry for a current image instead of null. */  stream.pendingOutput.splice(0)
stream.pendingOutputBytes = 0
stream.pendingOutputOverflowed = false
 serialized = await serializeBudgetedRequestedSnapshot( runtime, stream.ptyId,  scrollbackRows )
if (closed || streams.get(stream.streamId) !== stream) {  return } size = runtime.getTerminalSize(stream.ptyId)
 displayMode = runtime.getMobileDisplayMode(stream.ptyId)
if (stream.pendingOutputOverflowed) { sendSnapshotFrames((opcode, payload) => sendFrame(stream.streamId, opcode, payload), {  kind: 'scrollback', cols: size?.cols ?? 80, rows: size?.rows ?? 24,  requestId, displayMode, truncated: true,  truncatedByByteBudget: false, data: '' })
 return } }  sentSnapshotOutputSeq = serialized?.seq
sendSnapshotFrames((opcode, payload) => sendFrame(stream.streamId, opcode, payload), { kind: 'scrollback',  cols: serialized?.cols ?? size?.cols ?? 80, rows: serialized?.rows ?? size?.rows ?? 24, requestId,  displayMode, seq: serialized?.seq, cwd: serialized?.cwd,  source: serialized?.source, oscLinks: serialized?.oscLinks, pendingEscapeTailAnsi: serialized?.pendingEscapeTailAnsi,  truncated: false, truncatedByByteBudget: serialized?.truncatedByByteBudget, data: serialized?.data ?? ''  }) } catch (error) { sendStreamError(  stream.streamId, error instanceof Error ? error.message : 'Remote terminal snapshot failed.' )  } finally { if (streams.get(stream.streamId) === stream) { const shouldFlushPendingOutput = !stream.pendingOutputOverflowed
 stream.buffering = false
const pendingOutput = stream.pendingOutput.splice(0)
if (shouldFlushPendingOutput) {  for (const chunk of pendingOutput) { /* Why: an untagged reply resets the client to the snapshot's */ /* high-water, so covered bytes would render twice; tagged */  /* snapshots feed a side consumer and the live view still */ /* needs every buffered chunk. */ const uncovered =  typeof requestId === 'number' ? chunk : getOutputAfterSnapshotSeq(chunk, sentSnapshotOutputSeq)
 if (uncovered) { stream.outputBatcher.push(uncovered.data, uncovered.meta) }  } } stream.pendingOutputBytes = 0
 stream.pendingOutputOverflowed = false
stream.outputBatcher.flush()
/* Why: a resize parked during snapshot buffering must be applied now, or it is dropped until the viewer's next resize. */  if ( !stream.isMobile && stream.client?.id &&  stream.registeredRemoteDesktopDriver && stream.pendingRemoteDesktopViewport ) {  const viewport = stream.pendingRemoteDesktopViewport
stream.pendingRemoteDesktopViewport = null
void updateViewportForClient(  runtime, stream.ptyId, stream.remoteDesktopSubscriptionKey,  stream.client, viewport, 'desktop',  'register', !stream.supportsDesktopViewportClaims ).catch(() => {})  } } }       }
const handleSubscribeFrame = async (payload: Uint8Array<ArrayBufferLike>): Promise<void> => { const raw = decodeTerminalStreamJson<unknown>(payload)
 const parsed = TerminalMultiplexSubscribeFrame.safeParse(raw)
if (!parsed.success) { return  } const request = parsed.data
detachStream(request.streamId, false)
 cancelPendingPtyWaits(request.streamId)
const isMobile = request.client?.type === 'mobile'
let leaf: { ptyId: string | null } | null
 try { /* Why: binding the stream to whatever PTY now occupies a stale handle's pane would mirror the wrong terminal (#7718). */ leaf = runtime.resolveLiveLeafForHandle(request.terminal)  } catch { sendStreamError(request.streamId, 'terminal_handle_stale')
emit({ type: 'end', streamId: request.streamId })
 return } if (!leaf?.ptyId && request.client) {  if ( pendingPtyWaitControllers.size >= TERMINAL_MULTIPLEX_MAX_PENDING_PTY_WAITS_PER_CONNECTION  ) { sendStreamError(request.streamId, TERMINAL_MULTIPLEX_STREAM_LIMIT_ERROR)
emit({ type: 'end', streamId: request.streamId })
 return } /* Why: a never-mounted tab has no graph leaf to await; mounting the exact tab attaches its PTY without activating the worktree. */  runtime.requestRendererTerminalTabMount(request.terminal)
const waitController = new AbortController()
const pendingControllers = pendingPtyWaitControllers.get(request.streamId) ?? new Set()
 pendingControllers.add(waitController)
pendingPtyWaitControllers.set(request.streamId, pendingControllers)
if (signal?.aborted) {  waitController.abort() } /* Why: the live slot handler does not exist until the PTY attaches; retain cancellation ownership while the pane is still pending. */  const unregisterPendingHandler = registerBinaryStreamHandler( request.streamId, (frame) => {  if (frame.opcode === TerminalStreamOpcode.Unsubscribe) { cancelPendingPtyWaits(request.streamId)
detachStream(request.streamId, false)  } } )
 try { const ptyId = await runtime.waitForLeafPtyId( request.terminal,  10_000, waitController.signal )
 leaf = { ptyId } } catch { if (closed || signal?.aborted || waitController.signal.aborted) {  return } /* Fall through to the explicit no_connected_pty error below. */  } finally { const currentControllers = pendingPtyWaitControllers.get(request.streamId)
currentControllers?.delete(waitController)
 if (currentControllers?.size === 0) { pendingPtyWaitControllers.delete(request.streamId) }  unregisterPendingHandler() } }  if (!leaf?.ptyId) { sendStreamError(request.streamId, 'no_connected_pty')
emit({ type: 'end', streamId: request.streamId })
 return } if (closed) {  return } /* Why: a competing subscribe may own this streamId after the PTY await; detach it so an orphaned view subscriber can't silence the model responder (terminal-query-authority.md). */  detachStream(request.streamId, false)
if (streams.size >= TERMINAL_MULTIPLEX_MAX_ACTIVE_STREAMS_PER_CONNECTION) { sendStreamError(request.streamId, TERMINAL_MULTIPLEX_STREAM_LIMIT_ERROR)
 emit({ type: 'end', streamId: request.streamId })
return }  const ptyId = leaf.ptyId
const remoteDesktopSubscriptionKey = `multiplex:${connectionId}:${request.streamId}`
const streamGeneration = randomUUID()
 const requestedSourceRangeConsumer = request.capabilities?.ackOutput === 1 && request.capabilities?.ackOutputSourceRanges === 1
const sourceRangeLedger = requestedSourceRangeConsumer  ? sourceRangeRegistry.open(streamGeneration) : null
const sourceRangeConsumerAttached =  sourceRangeLedger !== null && runtime.attachRemoteTerminalSourceRangeConsumer({ ptyId,  consumerId: remoteDesktopSubscriptionKey, streamGeneration })
 if (!sourceRangeConsumerAttached) { sourceRangeLedger?.close() }  const stream: TerminalMultiplexStream = { streamId: request.streamId, terminal: request.terminal,  ptyId, client: request.client, isMobile,  ackOutput: request.capabilities?.ackOutput === 1, ackOutputSourceRanges: sourceRangeConsumerAttached, streamGeneration,  sourceRangeLedger: sourceRangeConsumerAttached ? sourceRangeLedger : null, sourceRangeConsumerAttached, sourceRangeReplacement: null,  ackInFlightBytes: 0, ackWindowBytes: TERMINAL_MULTIPLEX_ACK_STREAM_INITIAL_WINDOW_BYTES, supportsOutputPause: request.capabilities?.outputPause === 1,  outputPaused: false, supportsDesktopViewportClaims: request.capabilities?.desktopViewportClaims === 1, desktopClaimTail: Promise.resolve(true),  registeredRemoteDesktopDriver: false, /* Why: streamId is client-local, so key the width floor by connectionId or two connections sharing stream 1 for one PTY clobber each other's floor. */ remoteDesktopSubscriptionKey,  pendingRemoteDesktopViewport: null, buffering: true, ackPendingOutput: [],  ackPendingOutputBytes: 0, ackPendingOutputOverflowed: false, ackRecoverySnapshotInFlight: false,  pendingOutput: [], pendingOutputBytes: 0, pendingOutputOverflowed: false,  lastResizeCols: undefined, resizeGeneration: 0, outputBatcher: createTerminalOutputBatcher((data, meta) => {  if (meta?.cwd !== undefined) { sendFrame( request.streamId,  TerminalStreamOpcode.Metadata, encodeTerminalStreamJson({ cwd: meta.cwd }), meta.seq  ) } for (const chunk of iterateTerminalOutputFrameChunks(data, meta)) {  queueOrSendOutput(stream, chunk) } }),  unsubscribeData: () => {}, unsubscribeResize: () => {}, unsubscribeFit: () => {},  unsubscribeDriver: () => {}, unregisterBinaryHandler: () => {}, exitWaiterAbort: new AbortController()  }
streams.set(request.streamId, stream)
stream.unregisterBinaryHandler = registerBinaryStreamHandler(request.streamId, (frame) =>  handleSlotFrame(stream, frame) )
try {  const unsubscribeStreamData = runtime.subscribeToTerminalData(ptyId, (data, meta) => { if (closed || streams.get(request.streamId) !== stream) { return  } if (stream.outputPaused) { return  } if (stream.buffering) { appendPendingMultiplexOutput(stream, data, meta)
 return } stream.outputBatcher.push(data, meta)  })
/* Why: a multiplexed stream feeds a remote xterm view with query authority, so the main model responder yields while attached (terminal-query-authority.md). */ const releaseViewSubscriber = runtime.registerRemoteTerminalViewSubscriber(ptyId)
 stream.unsubscribeData = () => { releaseViewSubscriber()
unsubscribeStreamData()  }
if (isMobile && request.client?.id) { await runtime.handleMobileSubscribe(ptyId, request.client.id, request.viewport)  } else if (request.client?.id && request.viewport) { /* Why: subscribe records this stream's geometry and cleanup key but doesn't claim ownership; activity frames claim later. */ stream.registeredRemoteDesktopDriver = true
 stream.pendingRemoteDesktopViewport = request.viewport } if (  !isMobile && request.client?.id && stream.registeredRemoteDesktopDriver &&  stream.pendingRemoteDesktopViewport ) { const viewport = stream.pendingRemoteDesktopViewport
 stream.pendingRemoteDesktopViewport = null
await updateViewportForClient( runtime,  ptyId, stream.remoteDesktopSubscriptionKey, request.client,  viewport, 'desktop', 'register',  !stream.supportsDesktopViewportClaims ) }  if (closed || streams.get(request.streamId) !== stream) { return }  let read = await runtime.readTerminal(request.terminal)
let serialized = await serializeBudgetedMobileSnapshot(runtime, ptyId, isMobile)
if (closed || streams.get(request.streamId) !== stream) {  return } let initialOutputOverflowed = false
 if (stream.pendingOutputOverflowed) { stream.pendingOutput.splice(0)
stream.pendingOutputBytes = 0
 stream.pendingOutputOverflowed = false
read = await runtime.readTerminal(request.terminal)
serialized = await serializeBudgetedMobileSnapshot(runtime, ptyId, isMobile)
 if (closed || streams.get(request.streamId) !== stream) { return }  if (stream.pendingOutputOverflowed) { initialOutputOverflowed = true
stream.pendingOutput.splice(0)
 stream.pendingOutputBytes = 0
stream.pendingOutputOverflowed = false }  } const size = runtime.getTerminalSize(ptyId)
const displayMode = runtime.getMobileDisplayMode(ptyId)
 const layoutSeq = runtime.getLayout(ptyId)?.seq
const snapshotFrameSeq = serialized?.seq ?? layoutSeq
const snapshotOutputSeq = serialized?.seq
 emit({ type: 'subscribed', streamId: request.streamId,  terminal: request.terminal, cols: serialized?.cols ?? size?.cols, rows: serialized?.rows ?? size?.rows,  displayMode, seq: layoutSeq, ...((stream.ackOutputSourceRanges || stream.supportsOutputPause) && {  capabilities: { ...(stream.ackOutputSourceRanges ? { ackOutputSourceRanges: 1 as const } : {}), ...(stream.supportsOutputPause ? { outputPause: 1 as const } : {})  } }), ...(stream.ackOutputSourceRanges ? { streamGeneration: stream.streamGeneration } : {}),  /* Why: retained-tail truncation loses history, not the authoritative latest-screen fallback. */ truncated: initialOutputOverflowed })
 stream.sourceRangeReplacement = stream.ackOutputSourceRanges && serialized?.source !== undefined &&  typeof serialized.seq === 'number' ? runtime.reserveRemoteTerminalSourceRangeReplacement( {  ptyId, consumerId: stream.remoteDesktopSubscriptionKey, streamGeneration: stream.streamGeneration  }, serialized.seq, 'initial-snapshot'  ) : null
const snapshotPublication = sendSnapshotFrames(  (opcode, payload) => sendFrame(request.streamId, opcode, payload), { kind: 'scrollback',  cols: serialized?.cols ?? size?.cols ?? 80, rows: serialized?.rows ?? size?.rows ?? 24, displayMode,  seq: snapshotFrameSeq, cwd: serialized?.cwd, truncated: initialOutputOverflowed,  truncatedByByteBudget: serialized?.truncatedByByteBudget, source: serialized?.source, oscLinks: serialized?.oscLinks,  pendingEscapeTailAnsi: serialized?.pendingEscapeTailAnsi, data: serialized?.data ?? (read.tail.length > 0 ? `${read.tail.join('\r\n')}\r\n` : '')  } )
const replacement = stream.sourceRangeReplacement
 stream.sourceRangeReplacement = null
if (replacement) { const committed =  snapshotPublication.published && serialized?.source !== undefined && typeof serialized.seq === 'number' &&  runtime.commitRemoteTerminalSourceRangeReplacement(replacement, { source: serialized.source, seq: serialized.seq  })
if (!committed) { runtime.rollbackRemoteTerminalSourceRangeReplacement(  replacement, 'initial-snapshot-unpublished' )  } } /* Why: baseline for resize re-stream gating; the client already rewrapped to these cols via the initial snapshot replay. */  stream.lastResizeCols = serialized?.cols ?? size?.cols
stream.buffering = false
const pendingOutput = stream.pendingOutput.splice(0)
 if (!initialOutputOverflowed) { for (const chunk of pendingOutput) { const uncovered = getOutputAfterSnapshotSeq(chunk, snapshotOutputSeq)
 if (uncovered) { stream.outputBatcher.push(uncovered.data, uncovered.meta) }  } } stream.pendingOutputBytes = 0
 stream.pendingOutputOverflowed = false
stream.outputBatcher.flush()
if (!isMobile) {  stream.unsubscribeFit = runtime.subscribeToFitOverrideChanges(ptyId, (event) => { const mode = event.mode === 'mobile-fit'  ? event.mode : (runtime.getRemoteDesktopFitHold?.(ptyId, stream.remoteDesktopSubscriptionKey) .mode ?? 'desktop-fit')
 emit({ type: 'fit-override-changed', streamId: request.streamId,  mode, cols: event.cols, rows: event.rows  }) })
stream.unsubscribeDriver = runtime.subscribeToDriverChanges(ptyId, (driver) => {  emit({ type: 'driver-changed', streamId: request.streamId,  driver }) })
 const fitOverride = runtime.getTerminalFitOverride(ptyId)
const desktopHold = runtime.getRemoteDesktopFitHold?.( ptyId,  stream.remoteDesktopSubscriptionKey ) ?? { mode: 'desktop-fit' as const, cols: size?.cols ?? 0, rows: size?.rows ?? 0 }
emit({  type: 'fit-override-changed', streamId: request.streamId, mode: fitOverride?.mode ?? desktopHold.mode,  cols: fitOverride?.cols ?? desktopHold.cols, rows: fitOverride?.rows ?? desktopHold.rows })
 emit({ type: 'driver-changed', streamId: request.streamId,  driver: runtime.getDriver(ptyId) }) }  stream.unsubscribeResize = runtime.subscribeToTerminalResize(ptyId, (event) => { stream.outputBatcher.flush()
const resizeGeneration = stream.resizeGeneration + 1
 stream.resizeGeneration = resizeGeneration
const widthChanged = stream.isMobile && event.cols !== stream.lastResizeCols
if (widthChanged) {  stream.lastResizeCols = event.cols
/* Why: re-serialize+replay the full scrollback at the new cols so restored hard-wrapped lines rewrap; live output resumes after the snapshot lands. */ void sendMobileResizeRestream(  runtime, ptyId, (opcode, payload) => sendFrame(request.streamId, opcode, payload),  event, () => !closed &&  streams.get(request.streamId) === stream && stream.resizeGeneration === resizeGeneration )  .then((restreamed) => { if ( closed ||  streams.get(request.streamId) !== stream || stream.resizeGeneration !== resizeGeneration ) {  return } if (!restreamed) {  sendResizedFrame(stream, event) } })  /* Why: on re-stream failure, still emit the geometry-only Resized frame so the client never misses the resize. */ .catch(() => { if (  closed || streams.get(request.streamId) !== stream || stream.resizeGeneration !== resizeGeneration  ) { return }  sendResizedFrame(stream, event) })
return  } sendResizedFrame(stream, event) })
 /* Install the resize listener before draining the parked viewport, since applyLayout emits synchronously. */ if ( !stream.isMobile &&  stream.client?.id && stream.registeredRemoteDesktopDriver && stream.pendingRemoteDesktopViewport  ) { const viewport = stream.pendingRemoteDesktopViewport
stream.pendingRemoteDesktopViewport = null
 void updateViewportForClient( runtime, ptyId,  stream.remoteDesktopSubscriptionKey, stream.client, viewport,  'desktop', 'register', !stream.supportsDesktopViewportClaims  ).catch(() => {}) } void runtime  .waitForTerminal(request.terminal, { condition: 'exit', signal: stream.exitWaiterAbort.signal  }) .then(() => { if (streams.get(request.streamId) === stream) {  detachStream(request.streamId, true) } })  .catch(() => { if (streams.get(request.streamId) === stream) { detachStream(request.streamId, true)  } }) } catch (error) {  /* Why the ownership check: a newer subscribe may already own this streamId; tearing down the slot here would kill the successor's live registrations. */ if (streams.get(request.streamId) !== stream) { return  } detachStream(request.streamId, false)
sendStreamError(request.streamId, error instanceof Error ? error.message : String(error))
 emit({ type: 'end', streamId: request.streamId }) } }
      const unregisterControlHandler = registerBinaryStreamHandler(0, (frame) => { if (frame.opcode === TerminalStreamOpcode.Subscribe) { void handleSubscribeFrame(frame.payload)  } })
signal?.addEventListener('abort', cancelAllPendingPtyWaits, { once: true })
      runtime.registerSubscriptionCleanup( `terminal-multiplex:${connectionId}`, closeMultiplex,  connectionId )
emit({ type: 'ready' })
      await multiplexClosed     }   }),   /* terminal.subscribe: streams live terminal output over WebSocket; mobile clients pass client+viewport for server-side auto-fit. */ ]
