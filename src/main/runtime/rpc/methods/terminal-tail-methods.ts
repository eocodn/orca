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
  TerminalMultiplex,
  TerminalHandle,
  TerminalSubscribe,
  TerminalUnsubscribe,
  TerminalUpdateViewport,
  TerminalSetAutoRestoreFit
} from './terminal-schemas'

export const TERMINAL_TAIL_METHODS: RpcAnyMethod[] = [
  defineMethod({
    name: 'terminal.unsubscribe',
    params: TerminalUnsubscribe,
    handler: async (params, { runtime }) => {
      // Why: older builds send a bare-handle subscriptionId, so also try the reconstructed `${terminal}:${clientId}` composite key.
      runtime.cleanupSubscription(params.subscriptionId)
      if (params.client && !params.subscriptionId.includes(':')) {
        runtime.cleanupSubscription(`${params.subscriptionId}:${params.client.id}`)
      }
      return { unsubscribed: true }
    }
  }),
  defineMethod({
    name: 'terminal.getAutoRestoreFit',
    params: z.object({}),
    handler: async (_params, { runtime }) => ({
      ms: runtime.getMobileAutoRestoreFitMs()
    })
  }),
  defineMethod({
    name: 'terminal.setAutoRestoreFit',
    params: TerminalSetAutoRestoreFit,
    handler: async (params, { runtime }) => ({
      ms: runtime.setMobileAutoRestoreFitMs(params.ms)
    })
  })
]
