import {
  clearForegroundCoalesce,
  clearForegroundHoldSafety,
  hasDrainableBacklog,
  hasHighPriorityBacklog,
  hasQueuedChunks,
  isEntryDrainable
} from './pane-terminal-output-queue'
import { recordQueueDebugPressure, debugEnabled, debugState, recordDrainWriteCount } from './terminal-output-scheduler-queue-runtime-debug'
import {
  BACKGROUND_DRAIN_INTERVAL_MS,
  DRAIN_TIME_BUDGET_MS,
  HIGH_PRIORITY_DRAIN_INTERVAL_MS,
  HIGH_PRIORITY_MAX_WRITES_PER_DRAIN,
  LARGE_BACKLOG_CHARS,
  MAX_WRITES_PER_DRAIN,
  queuedByTerminal,
  type QueueEntry
} from './terminal-output-scheduler-queue-runtime-state'
import { writeQueuedChunk } from './terminal-output-scheduler-queue-runtime-write'

let drainTimer: ReturnType<typeof setTimeout> | null = null
let drainTimerDelayMs: number | null = null
let drainImmediatePending = false
let drainImmediateGeneration = 0
let useMessageChannelDrain = typeof MessageChannel !== 'undefined' && !isVitestEnv()
let drainChannel: MessageChannel | null = null

function isVitestEnv(): boolean {
  return typeof process !== 'undefined' && process.env?.VITEST === 'true'
}

function getDrainChannel(): MessageChannel {
  if (drainChannel === null) {
    drainChannel = new MessageChannel()
    drainChannel.port1.onmessage = (event: MessageEvent) => {
      if (event.data !== drainImmediateGeneration || !drainImmediatePending) {
        return
      }
      drainImmediatePending = false
      drainQueuedOutput()
    }
  }
  return drainChannel
}

function cancelImmediateDrain(): void {
  drainImmediateGeneration++
  drainImmediatePending = false
}

export function setUseMessageChannelDrainForTesting(value: boolean | null): void {
  cancelImmediateDrain()
  useMessageChannelDrain = value ?? (typeof MessageChannel !== 'undefined' && !isVitestEnv())
}

export function scheduleDrain(delayMs: number): void {
  if (drainImmediatePending) {
    return
  }
  if (drainTimer !== null) {
    if (drainTimerDelayMs !== null && drainTimerDelayMs <= delayMs) {
      return
    }
    clearTimeout(drainTimer)
    drainTimer = null
    drainTimerDelayMs = null
  }
  if (queuedByTerminal.size === 0) {
    return
  }
  if (debugEnabled) {
    debugState.scheduledDrainCount++
  }
  if (delayMs === 0 && useMessageChannelDrain) {
    drainImmediatePending = true
    getDrainChannel().port2.postMessage(drainImmediateGeneration)
    return
  }
  drainTimer = setTimeout(drainQueuedOutput, delayMs)
  drainTimerDelayMs = delayMs
}

function takeNextDrainableEntry(): QueueEntry | null {
  let largeBacklogEntry: QueueEntry | null = null
  for (const entry of queuedByTerminal.values()) {
    if (!isEntryDrainable(entry)) {
      continue
    }
    if (entry.highPriority) {
      queuedByTerminal.delete(entry.terminal)
      return entry
    }
    if (!largeBacklogEntry && entry.queuedChars > LARGE_BACKLOG_CHARS) {
      largeBacklogEntry = entry
    }
  }
  if (largeBacklogEntry) {
    queuedByTerminal.delete(largeBacklogEntry.terminal)
    return largeBacklogEntry
  }
  for (const entry of queuedByTerminal.values()) {
    if (!isEntryDrainable(entry)) {
      continue
    }
    queuedByTerminal.delete(entry.terminal)
    return entry
  }
  return null
}

function getDrainNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function drainQueuedOutput(): void {
  drainTimer = null
  drainTimerDelayMs = null
  let writes = 0
  const startedAt = getDrainNow()
  const maxWrites = hasHighPriorityBacklog()
    ? HIGH_PRIORITY_MAX_WRITES_PER_DRAIN
    : MAX_WRITES_PER_DRAIN

  while (queuedByTerminal.size > 0 && writes < maxWrites) {
    const entry = takeNextDrainableEntry()
    if (!entry) {
      break
    }
    const writeKind = writeQueuedChunk(
      entry,
      entry.highPriority
        ? () => {
            try {
              if (queuedByTerminal.size > 0 && hasHighPriorityBacklog()) {
                scheduleDrain(0)
              }
            } catch {
              // Keep xterm's callback chain alive if scheduling observes a disposed renderer.
            }
          }
        : undefined
    )
    if (writeKind) {
      writes++
    }
    if (hasQueuedChunks(entry)) {
      queuedByTerminal.set(entry.terminal, entry)
    } else {
      entry.highPriority = false
      clearForegroundCoalesce(entry)
      clearForegroundHoldSafety(entry)
    }
    if (writes > 0 && getDrainNow() - startedAt >= DRAIN_TIME_BUDGET_MS) {
      break
    }
  }

  recordDrainWriteCount(writes)
  recordQueueDebugPressure()
  if (queuedByTerminal.size > 0 && hasDrainableBacklog()) {
    scheduleDrain(
      hasHighPriorityBacklog()
        ? useMessageChannelDrain
          ? 0
          : HIGH_PRIORITY_DRAIN_INTERVAL_MS
        : BACKGROUND_DRAIN_INTERVAL_MS
    )
  }
}

export { drainQueuedOutput }
