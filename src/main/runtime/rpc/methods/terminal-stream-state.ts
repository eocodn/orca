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

export const REQUESTED_SNAPSHOT_BYTE_BUDGET = 2 * 1024 * 1024
export const TERMINAL_OUTPUT_FLUSH_MS = 5
export const TERMINAL_QUERY_REPLAY_MAX_CHARS = 16 * 1024
// Why: bound initial subscribe latency; readiness after this deadline triggers an in-stream recovery snapshot.
export const MOBILE_RENDERER_MOUNT_READY_TIMEOUT_MS = 3_000
export let nextTerminalStreamId = 1

export type SnapshotFrameOptions = {
  kind: 'scrollback' | 'resized'
  cols: number
  rows: number
  data: string
  requestId?: number
  displayMode?: string
  reason?: string
  seq?: number
  cwd?: string | null
  truncated?: boolean
  truncatedByByteBudget?: boolean
  source?: 'headless' | 'renderer'
  oscLinks?: TerminalOscLinkRange[]
  pendingEscapeTailAnsi?: string
}

export type SerializedSnapshot = {
  data: string
  scrollbackAnsi?: string
  cols: number
  rows: number
  seq?: number
  cwd?: string | null
  source?: 'headless' | 'renderer'
  oscLinks?: TerminalOscLinkRange[]
  scrollbackRows: number
  truncatedByByteBudget: boolean
  pendingEscapeTailAnsi?: string
} | null

export type TerminalViewportClient = {
  id: string
  type?: 'mobile' | 'desktop'
}

export type TerminalMultiplexStream = {
  streamId: number
  terminal: string
  ptyId: string
  client: TerminalViewportClient | undefined
  isMobile: boolean
  ackOutput: boolean
  ackOutputSourceRanges: boolean
  streamGeneration: string
  sourceRangeLedger: TerminalSourceRangeLedger | null
  sourceRangeConsumerAttached: boolean
  sourceRangeReplacement: RemoteTerminalSourceRangeReplacementReservation | null
  ackInFlightBytes: number
  ackWindowBytes: number
  supportsOutputPause: boolean
  outputPaused: boolean
  supportsDesktopViewportClaims: boolean
  desktopClaimTail: Promise<boolean>
  // Whether THIS stream registered the width driver, so detach won't release a peer stream's floor.
  registeredRemoteDesktopDriver: boolean
  remoteDesktopSubscriptionKey: string
  pendingRemoteDesktopViewport: { cols: number; rows: number } | null
  buffering: boolean
  ackPendingOutput: TerminalOutputFrameChunk[]
  ackPendingOutputBytes: number
  ackPendingOutputOverflowed: boolean
  ackRecoverySnapshotInFlight: boolean
  pendingOutput: TerminalOutputChunk[]
  pendingOutputBytes: number
  pendingOutputOverflowed: boolean
  // Cols the mobile client last rewrapped to; re-stream full scrollback only when width actually changes.
  lastResizeCols: number | undefined
  resizeGeneration: number
  outputBatcher: ReturnType<typeof createTerminalOutputBatcher>
  unsubscribeData: () => void
  unsubscribeResize: () => void
  unsubscribeFit: () => void
  unsubscribeDriver: () => void
  unregisterBinaryHandler: () => void
  // Why: the runtime drops the exit-waiter only on real PTY exit; abort on detach so a never-exiting agent terminal doesn't leak the waiter.
  exitWaiterAbort: AbortController
}

export type TerminalOutputChunk = {
  data: string
  bytes: number
  meta?: TerminalOutputMeta
}

export function createTerminalOutputBatcher(onFlush: (data: string, meta?: TerminalOutputMeta) => void): {
  push: (data: string, meta?: TerminalOutputMeta) => void
  flush: () => void
  dispose: () => void
} {
  let chunks: string[] = []
  let bytes = 0
  let lastSeq: number | undefined
  let pendingCwd: string | undefined
  let pendingRawLength = 0
  let pendingSourceRanges: TerminalOutputSourceRange[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = (): void => {
    if (!timer) {
      return
    }
    clearTimeout(timer)
    timer = null
  }

  const flush = (): void => {
    clearTimer()
    if (chunks.length === 0 && pendingRawLength === 0) {
      return
    }
    const data = chunks.length === 1 ? chunks[0]! : chunks.join('')
    const meta =
      typeof lastSeq === 'number' || pendingCwd !== undefined || pendingSourceRanges.length > 0
        ? {
            ...(typeof lastSeq === 'number' ? { seq: lastSeq, rawLength: pendingRawLength } : {}),
            ...(pendingCwd !== undefined ? { cwd: pendingCwd } : {}),
            ...(pendingSourceRanges.length > 0
              ? { sourceRanges: Object.freeze(pendingSourceRanges.slice()) }
              : {})
          }
        : undefined
    chunks = []
    bytes = 0
    lastSeq = undefined
    pendingCwd = undefined
    pendingRawLength = 0
    pendingSourceRanges = []
    onFlush(data, meta)
  }

  return {
    push(data: string, meta?: TerminalOutputMeta): void {
      const rawLength = meta?.rawLength ?? data.length
      if (!data && rawLength === 0) {
        return
      }
      if (meta?.transformed || rawLength !== data.length) {
        flush()
        onFlush(data, { ...meta, rawLength, transformed: true })
        return
      }
      const nextSourceRanges = meta?.sourceRanges ?? []
      const lastSourceRange = pendingSourceRanges.at(-1)
      const firstNextSourceRange = nextSourceRanges[0]
      if (
        chunks.length > 0 &&
        (pendingSourceRanges.length > 0 !== nextSourceRanges.length > 0 ||
          (lastSourceRange &&
            firstNextSourceRange &&
            (!sameTerminalOutputSourceIdentity(lastSourceRange, firstNextSourceRange) ||
              lastSourceRange.displayEnd !== firstNextSourceRange.displayStart)))
      ) {
        flush()
      }
      if (meta?.cwd !== undefined) {
        flush()
        pendingCwd = meta.cwd
      }
      chunks.push(data)
      pendingRawLength += rawLength
      pendingSourceRanges.push(...nextSourceRanges)
      const remainingBudget = Math.max(1, TERMINAL_OUTPUT_BATCH_MAX_BYTES - bytes)
      const measurement = measureTerminalStreamByteLength(data, {
        stopAfterBytes: remainingBudget
      })
      bytes += measurement.byteLength
      if (typeof meta?.seq === 'number') {
        lastSeq = meta.seq
      }
      if (measurement.exceededLimit || bytes >= TERMINAL_OUTPUT_BATCH_MAX_BYTES) {
        flush()
        return
      }
      if (!timer) {
        // Why: coalesce stream output before it crosses the network; desktop subscribers share the same burst boundary.
        timer = setTimeout(flush, TERMINAL_OUTPUT_FLUSH_MS)
        if (typeof timer.unref === 'function') {
          timer.unref()
        }
      }
    },
    flush,
    dispose(): void {
      clearTimer()
      chunks = []
      bytes = 0
      pendingRawLength = 0
      pendingSourceRanges = []
    }
  }
}

export function isTerminalInputLockedForClient(
  runtime: OrcaRuntimeService,
  ptyId: string,
  client: TerminalViewportClient | undefined
): boolean {
  if (client?.type === 'mobile') {
    return false
  }
  // Why: pre-refactor mobile builds sent no client metadata, so treat a missing client as legacy mobile (unlocked).
  if (!client) {
    return false
  }
  return runtime.getDriver(ptyId).kind === 'mobile'
}

export async function assertTerminalSendTextWithinLimit(text: string | undefined): Promise<void> {
  if (!text) {
    return
  }
  // Why: sends can be paste-sized; validate outside Zod so large input yields before runtime dispatch.
  if (await isTerminalInputTooLargeWithYield(text, TERMINAL_INPUT_MAX_BYTES)) {
    throw new InvalidArgumentError(TERMINAL_INPUT_TOO_LARGE_ERROR)
  }
}

export function resolveMobileFloorClientId(
  driver: DriverState | null,
  client: TerminalViewportClient | undefined
): string | null {
  if (client?.type === 'mobile') {
    return client.id
  }
  if (!client && driver?.kind === 'mobile') {
    return driver.clientId
  }
  return null
}

export async function sendTerminalStreamInput(
  runtime: OrcaRuntimeService,
  args: {
    terminal: string
    text: string
    client: TerminalViewportClient | undefined
    isMobile: boolean
  }
): Promise<void> {
  const action = { text: args.text, enter: false, interrupt: false }
  const clientId = args.isMobile ? args.client?.id : undefined
  const floorClaim: MobileInputFloorClaimHolder = { current: null }
  try {
    if (!clientId) {
      await runtime.sendTerminal(args.terminal, action)
      return
    }
    const result = await runtime.sendTerminal(args.terminal, action, {
      reserveWrite: (writePtyId) => {
        const claim = runtime.beginMobileInputFloor(writePtyId, clientId)
        if (!claim) {
          throw new Error('mobile_input_floor_unavailable')
        }
        floorClaim.current = claim
      },
      afterWrite: () => commitMobileInputFloorClaim(floorClaim)
    })
    if (!result.accepted) {
      floorClaim.current?.rollback()
    }
  } catch {
    floorClaim.current?.rollback()
  }
}

export type MobileInputFloorClaimHolder = {
  current: ReturnType<OrcaRuntimeService['beginMobileInputFloor']>
}

export async function commitMobileInputFloorClaim(claim: MobileInputFloorClaimHolder): Promise<void> {
  const current = claim.current
  if (!current) {
    return
  }
  try {
    await current.commit()
  } finally {
    // Why: the runtime may yield before the next write, which then needs a fresh reservation if desktop reclaimed the floor.
    if (claim.current === current) {
      claim.current = null
    }
  }
}

export function getTerminalSendGuardRefusedReason(error: unknown): 'no-agent' | 'permission' | undefined {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('terminal_guard_permission')) {
    return 'permission'
  }
  if (message.includes('terminal_guard_no_agent')) {
    return 'no-agent'
  }
  return undefined
}

export function isTerminalSendGuardNotWritable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('terminal_guard_not_writable')
}

export function assertTerminalSendExactPtyBinding(
  runtime: OrcaRuntimeService,
  handle: string,
  expectedPtyId: string | undefined
): void {
  try {
    if (expectedPtyId && runtime.resolveLiveLeafForHandle(handle)?.ptyId === expectedPtyId) {
      return
    }
  } catch {
    // Fall through to the stable guarded-send result below.
  }
  throw new Error('terminal_guard_not_writable')
}

export function appendPendingMultiplexOutput(
  stream: TerminalMultiplexStream,
  data: string,
  meta?: TerminalOutputMeta
): void {
  const remainingBudget = Math.max(
    1,
    TERMINAL_MULTIPLEX_PENDING_MAX_BYTES - stream.pendingOutputBytes
  )
  const measurement = measureTerminalStreamByteLength(data, {
    stopAfterBytes: remainingBudget
  })
  stream.pendingOutput.push({ data, bytes: measurement.byteLength, meta })
  stream.pendingOutputBytes += measurement.byteLength
  const trimmed = trimPendingOutputToBudget(stream.pendingOutput, stream.pendingOutputBytes)
  stream.pendingOutputBytes = trimmed.bytes
  stream.pendingOutputOverflowed ||= trimmed.overflowed
}

export function getOutputAfterSnapshotSeq(
  chunk: TerminalOutputChunk,
  snapshotSeq: number | undefined
): TerminalOutputChunk | null {
  if (
    typeof snapshotSeq !== 'number' ||
    typeof chunk.meta?.seq !== 'number' ||
    typeof chunk.meta.rawLength !== 'number'
  ) {
    return chunk
  }
  if (chunk.meta.seq <= snapshotSeq) {
    return null
  }
  const chunkStartSeq = chunk.meta.seq - chunk.meta.rawLength
  if (chunkStartSeq >= snapshotSeq) {
    return chunk
  }
  if (chunk.meta.transformed) {
    return null
  }
  const offset = snapshotSeq - chunkStartSeq
  return {
    data: chunk.data.slice(offset),
    bytes: chunk.bytes,
    meta: {
      ...chunk.meta,
      rawLength: chunk.meta.rawLength - offset,
      sourceRanges: sliceTerminalOutputSourceRanges(
        chunk.meta.sourceRanges,
        offset,
        chunk.data.length
      )
    }
  }
}

export function stripSnapshotBoundaryQuerySuffixes(
  data: string,
  dataStartSeq: number,
  snapshotSeq: number,
  queries: TerminalReplyQuerySequence[]
): string {
  let output = ''
  let offset = 0
  for (const query of queries) {
    if (query.startSeq >= snapshotSeq || query.endSeq <= snapshotSeq) {
      continue
    }
    const removeStart = Math.max(0, query.startSeq - dataStartSeq)
    const removeEnd = Math.min(data.length, query.endSeq - dataStartSeq)
    if (removeEnd <= offset || removeStart >= data.length) {
      continue
    }
    output += data.slice(offset, removeStart)
    offset = removeEnd
  }
  return output + data.slice(offset)
}

export function appendAckPendingOutput(
  stream: TerminalMultiplexStream,
  chunk: TerminalOutputFrameChunk
): void {
  stream.ackPendingOutput.push(chunk)
  stream.ackPendingOutputBytes += chunk.bytes.byteLength
  let omittedChunkCount = 0
  while (
    stream.ackPendingOutputBytes > TERMINAL_MULTIPLEX_PENDING_MAX_BYTES &&
    omittedChunkCount < stream.ackPendingOutput.length
  ) {
    stream.ackPendingOutputBytes -= stream.ackPendingOutput[omittedChunkCount]!.bytes.byteLength
    omittedChunkCount += 1
  }
  if (omittedChunkCount > 0) {
    stream.ackPendingOutput.splice(0, omittedChunkCount)
    stream.ackPendingOutputOverflowed = true
  }
}

export function trimPendingOutputToBudget(
  pendingOutput: TerminalOutputChunk[],
  pendingOutputBytes: number
): { bytes: number; overflowed: boolean } {
  let omittedChunkCount = 0
  while (
    pendingOutputBytes > TERMINAL_MULTIPLEX_PENDING_MAX_BYTES &&
    omittedChunkCount < pendingOutput.length
  ) {
    const chunk = pendingOutput[omittedChunkCount]
    pendingOutputBytes -= chunk.bytes
    omittedChunkCount += 1
  }
  if (omittedChunkCount > 0) {
    pendingOutput.splice(0, omittedChunkCount)
  }
  return { bytes: pendingOutputBytes, overflowed: omittedChunkCount > 0 }
}

export function trimPendingOutputCoveredBySnapshot(
  pendingOutput: TerminalOutputChunk[],
  snapshotSeq: number | undefined
): { chunks: TerminalOutputChunk[]; bytes: number } {
  if (typeof snapshotSeq !== 'number') {
    return {
      chunks: pendingOutput,
      bytes: pendingOutput.reduce((sum, chunk) => sum + chunk.bytes, 0)
    }
  }
  const chunks: TerminalOutputChunk[] = []
  let bytes = 0
  for (const chunk of pendingOutput) {
    const chunkSeq = chunk.meta?.seq
    const rawLength = chunk.meta?.rawLength ?? chunk.data.length
    if (typeof chunkSeq !== 'number' || rawLength !== chunk.data.length) {
      chunks.push(chunk)
      bytes += chunk.bytes
      continue
    }
    const startSeq = chunkSeq - rawLength
    if (snapshotSeq >= chunkSeq) {
      continue
    }
    if (snapshotSeq <= startSeq) {
      chunks.push(chunk)
      bytes += chunk.bytes
      continue
    }
    const data = chunk.data.slice(snapshotSeq - startSeq)
    const slicedBytes = terminalStreamByteLength(data)
    chunks.push({ data, bytes: slicedBytes, meta: undefined })
    bytes += slicedBytes
  }
  return { chunks, bytes }
}

export function* iterateTerminalStreamTextPayloads(data: string): Generator<Uint8Array<ArrayBufferLike>> {
  if (!data) {
    return
  }
  for (const chunk of iterateTerminalOutputFrameChunks(data)) {
    yield chunk.bytes
  }
}

export function isTerminalReadPayloadIncomplete(read: { truncated: boolean; limited?: boolean }): boolean {
  // Why: a limited preview is an incomplete payload even when the retained buffer wasn't truncated.
  return read.truncated || read.limited === true
}
