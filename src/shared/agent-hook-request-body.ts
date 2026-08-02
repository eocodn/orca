import type { IncomingMessage } from 'node:http'
import { assertJsonTextStructureWithinLimits } from './json-text-structure-limit'

export const HOOK_REQUEST_MAX_BYTES = 1_000_000
export const HOOK_REQUEST_INITIAL_BUFFER_BYTES = 4 * 1024
export const AGENT_HOOK_JSON_STRUCTURE_LIMITS = {
  structuralTokens: 128 * 1024,
  nestingDepth: 64
} as const

export function parseAgentHookJson(content: string): unknown {
  assertJsonTextStructureWithinLimits(content, AGENT_HOOK_JSON_STRUCTURE_LIMITS)
  return JSON.parse(content) as unknown
}

/** Bound the warn-once Sets so a client varying `version`/`env` per request can't grow them unbounded. */
export const MAX_WARNED_KEYS = 32

/** Slowloris cap: drop requests that have not finished sending after 5 s. */
export const HOOK_REQUEST_SLOWLORIS_MS = 5_000

/** Why: old OpenCode plugin builds re-post the full accumulated reply on every streamed part (O(n²) bytes/turn); cap at ingest to bound per-event cost. */
export const OPENCODE_HOOK_TEXT_MAX_CHARS = 8_000

export function capOpenCodeHookText(text: string): string {
  return text.length > OPENCODE_HOOK_TEXT_MAX_CHARS
    ? text.slice(0, OPENCODE_HOOK_TEXT_MAX_CHARS)
    : text
}

/** Bound paneKey size (real keys are well under 200); caps per-pane caches against pathological input. Exported so non-HTTP ingest (`ingestRemote`) applies the same cap as defense-in-depth. */
export const MAX_PANE_KEY_LEN = 200

// ─── Body parsing ───────────────────────────────────────────────────

export function parseFormEncodedBody(body: string): Record<string, string> {
  const params = new URLSearchParams(body)
  const parsed: Record<string, string> = {}
  for (const [key, value] of params.entries()) {
    parsed[key] = value
  }
  return parsed
}

export function readRequestBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let retained = Buffer.alloc(0)
    let byteLength = 0
    let settled = false
    const cleanup = (): void => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      req.off('close', onClose)
      // Why: keep a neutral error sink so a late IncomingMessage error after cleanup can't become unhandled.
      req.on('error', ignoreSettledRequestError)
    }
    const settleResolve = (value: unknown): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(value)
    }
    const settleReject = (error: unknown): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(error)
    }
    const onData = (chunk: Buffer): void => {
      // Why: bound by bytes (not UTF-16 units) and stop accumulating after rejection so a client can't push memory past the cap.
      const nextByteLength = byteLength + chunk.length
      if (nextByteLength > HOOK_REQUEST_MAX_BYTES) {
        settleReject(new Error('payload too large'))
        req.destroy()
        return
      }
      if (retained.length < nextByteLength) {
        const nextCapacity = Math.min(
          HOOK_REQUEST_MAX_BYTES,
          Math.max(HOOK_REQUEST_INITIAL_BUFFER_BYTES, retained.length * 2, nextByteLength)
        )
        const next = Buffer.allocUnsafe(nextCapacity)
        retained.copy(next, 0, 0, byteLength)
        retained = next
      }
      chunk.copy(retained, byteLength)
      byteLength = nextByteLength
    }
    const onEnd = (): void => {
      try {
        const body = retained.toString('utf8', 0, byteLength)
        const contentType = req.headers['content-type'] ?? ''
        if (typeof contentType === 'string' && contentType.includes('application/json')) {
          settleResolve(body ? parseAgentHookJson(body) : {})
          return
        }
        if (
          typeof contentType === 'string' &&
          contentType.includes('application/x-www-form-urlencoded')
        ) {
          settleResolve(parseFormEncodedBody(body))
          return
        }
        // Why: managed scripts POST JSON, updated POSIX scripts form-encoded; default to JSON for unknown content types.
        settleResolve(body ? parseAgentHookJson(body) : {})
      } catch (error) {
        settleReject(error)
      }
    }
    const onError = (err: Error): void => {
      settleReject(err)
    }
    // Why: req.destroy() (slowloris timer) emits 'close' but not 'end'/'error'; without this the promise never settles and buffers leak.
    const onClose = (): void => {
      settleReject(new Error('aborted'))
    }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
    req.on('close', onClose)
  })
}

export function ignoreSettledRequestError(): void {}
