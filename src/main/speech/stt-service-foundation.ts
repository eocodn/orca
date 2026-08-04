import type { Worker } from 'node:worker_threads'

export const START_DICTATION_TIMEOUT_MS = 60_000
const STOP_DICTATION_TIMEOUT_MS = 60_000
export const IDLE_WORKER_TEARDOWN_MS = 60 * 60 * 1000

export type SttEvent =
  | { type: 'ready' }
  | { type: 'partial'; text?: string }
  | { type: 'final'; text?: string }
  | { type: 'stopped' }
  | { type: 'error'; error?: string }

export type SttEventSink = (event: SttEvent) => void

type StopInFlight = {
  worker: Worker
  owner: string
  promise: Promise<void>
}

type StopOutcome = 'stopped' | 'error' | 'exit' | 'timeout'


export { STOP_DICTATION_TIMEOUT_MS,type StopInFlight,type StopOutcome }
