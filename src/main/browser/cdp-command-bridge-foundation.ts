import type {
  BrowserConsoleEntry,
  BrowserInterceptedRequest,
  BrowserNetworkEntry
} from '../../shared/runtime-types'
import type { SnapshotResult } from './snapshot-engine'

const CAPTURE_LOG_LIMIT = 1000

export class BrowserError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

type TabState = {
  navigationId: string | null
  snapshotResult: SnapshotResult | null
  debuggerAttached: boolean
  debuggerDetachListener: (() => void) | null
  debuggerMessageListener: ((_event: unknown, method: string, params: unknown) => void) | null
  iframeSessions: Map<string, string>
  // Why: capture state is per-tab so one tab's console/network events don't pollute another's buffer.
  capturing: boolean
  consoleLog: BrowserConsoleEntry[]
  networkLog: BrowserNetworkEntry[]
  // Why: interception state lets the agent selectively continue or block individual requests.
  intercepting: boolean
  interceptPatterns: string[]
  pausedRequests: Map<string, BrowserInterceptedRequest>
  // Why: maps CDP requestId → networkLog entry so loadingFinished attributes size to the right overlapping response.
  networkRequestMap: Map<string, BrowserNetworkEntry>
}

type QueuedCommand = {
  execute: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

export { CAPTURE_LOG_LIMIT, type QueuedCommand, type TabState }
