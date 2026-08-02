import { KEEPALIVE_SEND_MS } from './relay-protocol'

export type PendingRequest = {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  beforeResolve?: (result: unknown) => void
  timer: ReturnType<typeof setTimeout>
  cleanup: () => void
}

export const REQUEST_TIMEOUT_MS = 30_000
export const MAX_ORDINARY_UNACKED_TIMESTAMPS = 4095
export const MAX_UNACKED_TIMESTAMPS = MAX_ORDINARY_UNACKED_TIMESTAMPS + 1
// Why: a tick gap far beyond the interval means the process was paused, not that the link is dead.
export const WAKE_GAP_MS = KEEPALIVE_SEND_MS * 3

export type SshMultiplexerDisposeReason = 'shutdown' | 'connection_lost'
