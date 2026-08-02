import type { ForegroundTerminalOutputTarget } from './pane-terminal-foreground-render-settle'
import {
  TERMINAL_OUTPUT_BACKLOG_MIN_CAP_CHARS,
  terminalOutputBacklogCapChars
} from '../../../../shared/terminal-scrollback-policy'

export type TerminalOutputTarget = ForegroundTerminalOutputTarget
export type TerminalOutputBeforeWrite = (data: string) => void
export type TerminalBacklogRecoveryRequest = () => boolean
export type TerminalOutputParsedCallback = () => void
export type ForegroundRefreshSyncResolver = () => boolean

export type WriteTerminalOutputOptions = {
  foreground: boolean
  beforeWrite?: TerminalOutputBeforeWrite
  onParsed?: TerminalOutputParsedCallback
  /** Parse-deferred delivery ACK; every consumed or discarded chunk must invoke it. */
  ackCredit?: () => void
  onBackgroundBacklogDropped?: () => void
  latencySensitive?: boolean
  forceForegroundRefresh?: boolean
  followupForegroundRefresh?: boolean
  shouldRefreshForegroundSynchronously?: ForegroundRefreshSyncResolver
  stripTransientCursorShows?: boolean
  coalesceForeground?: boolean
  holdForeground?: boolean
}

export type QueueChunk = {
  data: string
  foreground: boolean
  forceForegroundRefresh: boolean
  followupForegroundRefresh: boolean
  shouldRefreshForegroundSynchronously: ForegroundRefreshSyncResolver
  stripTransientCursorShows: boolean
  beforeWrite?: TerminalOutputBeforeWrite
  onParsed?: TerminalOutputParsedCallback
  ackCredit?: () => void
}

export type QueuedWrite = {
  data: string
  foreground: boolean
  forceForegroundRefresh: boolean
  followupForegroundRefresh: boolean
  shouldRefreshForegroundSynchronously: ForegroundRefreshSyncResolver
  stripTransientCursorShows: boolean
  beforeWrite?: TerminalOutputBeforeWrite
  onParsed?: TerminalOutputParsedCallback
  ackCredits: (() => void)[]
}

export type QueueEntry = {
  terminal: TerminalOutputTarget
  chunks: QueueChunk[]
  chunkIndex: number
  queuedChars: number
  onBackgroundBacklogDropped?: () => void
  backgroundBacklogDropped: boolean
  highPriority: boolean
  foregroundHold: boolean
  foregroundHoldSafetyDelayMs: number
  foregroundCoalesce: boolean
  foregroundCoalesceDelayMs: number
  foregroundHoldSafetyTimer: ReturnType<typeof setTimeout> | null
  foregroundCoalesceTimer: ReturnType<typeof setTimeout> | null
}

export const BACKGROUND_FLUSH_DELAY_MS = 50
export const BACKGROUND_DRAIN_INTERVAL_MS = 16
export const HIGH_PRIORITY_DRAIN_INTERVAL_MS = 4
export const BACKGROUND_CHUNK_CHARS = 16 * 1024
export const MAX_WRITES_PER_DRAIN = 2
// 8 x 16KB keeps the high-priority path near the parser's sustained throughput.
export const HIGH_PRIORITY_MAX_WRITES_PER_DRAIN = 8
export const DRAIN_TIME_BUDGET_MS = 8
export const LARGE_BACKLOG_CHARS = 512 * 1024
export const SYNC_FOREGROUND_FLUSH_CHARS = 256 * 1024
export const MAX_BACKGROUND_QUEUE_CHUNKS = 4096
export const PARSE_SETTLE_TIMEOUT_MS = 250
export const FOREGROUND_COALESCE_DELAY_MS = 1000
export const FOREGROUND_HOLD_SAFETY_DELAY_MS = 250
// A short fallback protects split synchronized frames without delaying typed-character redraws.
export const LATENCY_SENSITIVE_FOREGROUND_COALESCE_DELAY_MS = 16
export const LATENCY_SENSITIVE_FOREGROUND_HOLD_SAFETY_DELAY_MS = 32
export const BACKGROUND_BACKLOG_WARNING =
  '\x18\x1b[0m\r\n[Orca skipped hidden terminal output because the backlog grew too large.]\r\n'
export const FOREGROUND_BACKLOG_WARNING =
  '\x18\x1b[0m\r\n[Orca skipped a burst of terminal output because the backlog grew too large.]\r\n'
export const ALWAYS_REFRESH_FOREGROUND_SYNCHRONOUSLY = (): boolean => true

export const queuedByTerminal = new Map<TerminalOutputTarget, QueueEntry>()
export const backlogRecoveryByTerminal = new WeakMap<
  TerminalOutputTarget,
  TerminalBacklogRecoveryRequest
>()

let maxQueueChars = TERMINAL_OUTPUT_BACKLOG_MIN_CAP_CHARS

export function configureTerminalOutputBacklogCap(scrollbackRows: unknown): void {
  maxQueueChars = terminalOutputBacklogCapChars(scrollbackRows)
}

export function currentTerminalOutputBacklogCapChars(): number {
  return maxQueueChars
}
