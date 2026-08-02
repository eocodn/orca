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
import { SnapshotFrameOptions, SerializedSnapshot, TerminalViewportClient, TerminalMultiplexStream, TerminalOutputChunk, REQUESTED_SNAPSHOT_BYTE_BUDGET, TERMINAL_OUTPUT_FLUSH_MS, TERMINAL_QUERY_REPLAY_MAX_CHARS, MOBILE_RENDERER_MOUNT_READY_TIMEOUT_MS, isTerminalReadPayloadIncomplete } from './terminal-stream-state'

export function normalizeMultiplexSnapshotScrollbackRows(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }
  return Math.max(0, Math.min(50_000, Math.floor(value)))
}

export function requestedSnapshotScrollbackCandidates(requestedRows: number | undefined): number[] {
  const candidates = [requestedRows ?? 0, 1000, 500, 250, 100, 25, 0]
    .filter((rows): rows is number => typeof rows === 'number')
    .map((rows) => Math.max(0, Math.min(50_000, Math.floor(rows))))
  return [...new Set(candidates)]
}

export async function serializeBudgetedRequestedSnapshot(
  runtime: OrcaRuntimeService,
  ptyId: string,
  scrollbackRows: number | undefined
): Promise<SerializedSnapshot> {
  const requestedRows = scrollbackRows ?? 0
  for (const rows of requestedSnapshotScrollbackCandidates(scrollbackRows)) {
    const serialized = await runtime.serializeAuthoritativeTerminalBuffer(ptyId, {
      scrollbackRows: rows
    })
    if (!serialized) {
      return null
    }
    const scrollbackAnsi =
      'scrollbackAnsi' in serialized && typeof serialized.scrollbackAnsi === 'string'
        ? serialized.scrollbackAnsi
        : ''
    const data = scrollbackAnsi + serialized.data
    const overByteBudget = terminalStreamByteLengthExceeds(data, REQUESTED_SNAPSHOT_BYTE_BUDGET)
    if (!overByteBudget || rows === 0) {
      return {
        ...serialized,
        data,
        scrollbackRows: rows,
        truncatedByByteBudget: rows < requestedRows || overByteBudget
      }
    }
  }
  return null
}

export function sendSnapshotFrames(
  sendFrame: (
    opcode: TerminalStreamOpcode,
    payload?: Uint8Array<ArrayBufferLike>
  ) => boolean | void,
  options: SnapshotFrameOptions
): { bytes: number; chunks: number; published: boolean } {
  if (
    sendFrame(
      TerminalStreamOpcode.SnapshotStart,
      encodeTerminalStreamJson({
        kind: options.kind,
        cols: options.cols,
        rows: options.rows,
        requestId: options.requestId,
        displayMode: options.displayMode,
        reason: options.reason,
        seq: options.seq,
        cwd: options.cwd,
        source: options.source,
        oscLinks: options.oscLinks,
        pendingEscapeTailAnsi: options.pendingEscapeTailAnsi,
        truncated: options.truncated === true,
        truncatedByByteBudget: options.truncatedByByteBudget === true
      })
    ) === false
  ) {
    return { bytes: 0, chunks: 0, published: false }
  }
  let chunks = 0
  let bytes = 0
  for (const chunk of iterateTerminalStreamTextPayloads(options.data)) {
    if (sendFrame(TerminalStreamOpcode.SnapshotChunk, chunk) === false) {
      return { bytes, chunks, published: false }
    }
    chunks++
    bytes += chunk.byteLength
  }
  const published = sendFrame(TerminalStreamOpcode.SnapshotEnd) !== false
  return { bytes, chunks, published }
}

export async function serializeBudgetedMobileSnapshot(
  runtime: OrcaRuntimeService,
  ptyId: string,
  isMobile: boolean
): Promise<SerializedSnapshot> {
  if (!isMobile) {
    const serialized = await runtime.serializeTerminalBuffer(ptyId, { scrollbackRows: 0 })
    return serialized
      ? {
          ...serialized,
          data: (serialized.scrollbackAnsi ?? '') + serialized.data,
          scrollbackRows: 0,
          truncatedByByteBudget: false
        }
      : null
  }
  const candidates = [MOBILE_SUBSCRIBE_SCROLLBACK_ROWS, 500, 250, 100, 25, 0]
  for (const rows of candidates) {
    const serialized = await runtime.serializeTerminalBuffer(ptyId, { scrollbackRows: rows })
    if (!serialized) {
      return null
    }
    const data = (serialized.scrollbackAnsi ?? '') + serialized.data
    const overByteBudget = terminalStreamByteLengthExceeds(data, MOBILE_SNAPSHOT_BYTE_BUDGET)
    if (!overByteBudget || rows === 0) {
      return {
        ...serialized,
        data,
        scrollbackRows: rows,
        truncatedByByteBudget: rows < MOBILE_SUBSCRIBE_SCROLLBACK_ROWS || overByteBudget
      }
    }
  }
  return null
}

export async function serializeStableMobileRendererSnapshot(
  runtime: OrcaRuntimeService,
  ptyId: string
): Promise<SerializedSnapshot> {
  const candidates = [MOBILE_SUBSCRIBE_SCROLLBACK_ROWS, 500, 250, 100, 25, 0]
  let candidateIndex = 0
  for (let attempt = 0; attempt < candidates.length; attempt += 1) {
    // Why: advance toward zero scrollback each retry so the final attempt always has a bounded payload.
    candidateIndex = Math.max(candidateIndex, attempt)
    const rows = candidates[candidateIndex]
    const outputSequenceBefore = runtime.getPtyOutputSequence(ptyId)
    const serialized = await runtime.serializeRendererTerminalBuffer(ptyId, {
      scrollbackRows: rows
    })
    const outputSequenceAfter = runtime.getPtyOutputSequence(ptyId)
    if (outputSequenceBefore !== outputSequenceAfter) {
      continue
    }
    if (!serialized) {
      return null
    }
    const overByteBudget = terminalStreamByteLengthExceeds(
      serialized.data,
      MOBILE_SNAPSHOT_BYTE_BUDGET
    )
    if (!overByteBudget || rows === 0) {
      return {
        ...serialized,
        scrollbackRows: rows,
        truncatedByByteBudget: rows < MOBILE_SUBSCRIBE_SCROLLBACK_ROWS || overByteBudget
      }
    }
    candidateIndex += 1
  }
  return null
}

// Why: mobile xterm can't rewrap the HARD newlines baked into a restored snapshot, so a real reflow re-serializes and replays the FULL buffer at the new cols.
export async function sendMobileResizeRestream(
  runtime: OrcaRuntimeService,
  ptyId: string,
  sendFrame: (opcode: TerminalStreamOpcode, payload?: Uint8Array<ArrayBufferLike>) => void,
  event: { cols: number; rows: number; displayMode: string; reason: string; seq?: number },
  shouldSend?: () => boolean
): Promise<boolean> {
  // Why: only a true geometry reflow rewraps scrollback; a dimensionless mode-change would re-send the whole buffer for nothing.
  if (event.reason !== 'apply-layout' || runtime.isTerminalAlternateScreen(ptyId)) {
    return false
  }
  const serialized = await serializeBudgetedMobileSnapshot(runtime, ptyId, true)
  if (!serialized) {
    return false
  }
  if (shouldSend && !shouldSend()) {
    return true
  }
  sendSnapshotFrames(sendFrame, {
    kind: 'resized',
    cols: serialized.cols,
    rows: serialized.rows,
    displayMode: event.displayMode,
    reason: event.reason,
    seq: event.seq ?? serialized.seq,
    source: serialized.source,
    cwd: serialized.cwd,
    oscLinks: serialized.oscLinks,
    truncated: false,
    truncatedByByteBudget: serialized.truncatedByByteBudget,
    data: serialized.data
  })
  return true
}

export async function updateViewportForClient(
  runtime: OrcaRuntimeService,
  ptyId: string,
  subscriptionKey: string,
  client: TerminalViewportClient,
  viewport: { cols: number; rows: number },
  defaultType: 'mobile' | 'desktop',
  // Why: the one-shot RPC has no disconnect hook, so 'refresh' only updates a stream-owned floor; stream paths that own cleanup 'register'.
  registration: 'register' | 'refresh' = 'register',
  claim = false
): Promise<{ updated: boolean; applied: boolean }> {
  const type = client.type ?? defaultType
  if (type === 'mobile') {
    return runtime.updateMobileViewport(ptyId, client.id, viewport)
  }
  // Why: stream attachment observes geometry without taking control; a later claim frame makes it authoritative.
  const updated =
    registration === 'refresh'
      ? await runtime.refreshRemoteDesktopViewer(
          ptyId,
          client.id,
          viewport.cols,
          viewport.rows,
          claim
        )
      : await runtime.updateRemoteDesktopViewer(
          ptyId,
          subscriptionKey,
          client.id,
          viewport.cols,
          viewport.rows,
          claim
        )
  return { updated, applied: updated }
}

