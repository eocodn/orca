import { e2eConfig } from '@/lib/e2e-config'
import {
  queuedByTerminal,
  type QueueEntry,
  type TerminalOutputTarget
} from './terminal-output-scheduler-queue-runtime-state'

export const debugEnabled = e2eConfig.exposeStore

export type TerminalOutputSchedulerDebugSnapshot = {
  backgroundEnqueueCount: number
  deferredForegroundEnqueueCount: number
  foregroundWriteCount: number
  backgroundWriteCount: number
  deferredForegroundWriteCount: number
  flushWriteCount: number
  scheduledDrainCount: number
  queuedTerminalCount: number
  queuedChars: number
  peakQueuedTerminalCount: number
  peakQueuedChars: number
  peakQueuedCharsByTerminal: number
  droppedBacklogCount: number
  drainWrites: number[]
}

type TerminalOutputSchedulerDebugApi = {
  reset: () => void
  snapshot: () => TerminalOutputSchedulerDebugSnapshot
}

export const debugState: TerminalOutputSchedulerDebugSnapshot = {
  backgroundEnqueueCount: 0,
  deferredForegroundEnqueueCount: 0,
  foregroundWriteCount: 0,
  backgroundWriteCount: 0,
  deferredForegroundWriteCount: 0,
  flushWriteCount: 0,
  scheduledDrainCount: 0,
  queuedTerminalCount: 0,
  queuedChars: 0,
  peakQueuedTerminalCount: 0,
  peakQueuedChars: 0,
  peakQueuedCharsByTerminal: 0,
  droppedBacklogCount: 0,
  drainWrites: []
}

function resetDebugState(): void {
  debugState.backgroundEnqueueCount = 0
  debugState.deferredForegroundEnqueueCount = 0
  debugState.foregroundWriteCount = 0
  debugState.backgroundWriteCount = 0
  debugState.deferredForegroundWriteCount = 0
  debugState.flushWriteCount = 0
  debugState.scheduledDrainCount = 0
  debugState.queuedTerminalCount = 0
  debugState.queuedChars = 0
  debugState.peakQueuedTerminalCount = 0
  debugState.peakQueuedChars = 0
  debugState.peakQueuedCharsByTerminal = 0
  debugState.droppedBacklogCount = 0
  debugState.drainWrites = []
}

function readQueueDebugSnapshot(): {
  queuedTerminalCount: number
  queuedChars: number
  queuedCharsByTerminal: number
} {
  let queuedChars = 0
  let queuedCharsByTerminal = 0
  for (const entry of queuedByTerminal.values()) {
    queuedChars += entry.queuedChars
    queuedCharsByTerminal = Math.max(queuedCharsByTerminal, entry.queuedChars)
  }
  return {
    queuedTerminalCount: queuedByTerminal.size,
    queuedChars,
    queuedCharsByTerminal
  }
}

export function recordQueueDebugPressure(): void {
  if (!debugEnabled) {
    return
  }
  const current = readQueueDebugSnapshot()
  debugState.queuedTerminalCount = current.queuedTerminalCount
  debugState.queuedChars = current.queuedChars
  debugState.peakQueuedTerminalCount = Math.max(
    debugState.peakQueuedTerminalCount,
    current.queuedTerminalCount
  )
  debugState.peakQueuedChars = Math.max(debugState.peakQueuedChars, current.queuedChars)
  debugState.peakQueuedCharsByTerminal = Math.max(
    debugState.peakQueuedCharsByTerminal,
    current.queuedCharsByTerminal
  )
}

export function exposeDebugApi(): void {
  if (!debugEnabled || typeof window === 'undefined') {
    return
  }
  // The e2e surface proves shared-drain behavior without retaining diagnostics in production.
  const target = window as unknown as {
    __terminalOutputSchedulerDebug?: TerminalOutputSchedulerDebugApi
  }
  target.__terminalOutputSchedulerDebug ??= {
    reset: resetDebugState,
    snapshot: () => {
      recordQueueDebugPressure()
      return {
        ...debugState,
        drainWrites: [...debugState.drainWrites]
      }
    }
  }
}

export function recordDrainWriteCount(writes: number): void {
  if (debugEnabled && writes > 0) {
    debugState.drainWrites.push(writes)
  }
}

export function incrementDroppedBacklogCount(): void {
  if (debugEnabled) {
    debugState.droppedBacklogCount++
  }
}

export type { QueueEntry, TerminalOutputTarget }

exposeDebugApi()
