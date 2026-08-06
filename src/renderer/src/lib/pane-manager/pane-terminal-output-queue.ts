import { recordRendererCrashBreadcrumb } from '@/lib/crash-breadcrumb-recorder'
import { attemptTerminalOutputAckCredit } from './pane-terminal-output-ack-credit'
import {
  containsCursorRestore,
  containsDrainableCursorRestore,
  containsFinalCursorPlacementBeforeSynchronizedEnd,
  SYNCHRONIZED_OUTPUT_END_SEQUENCE
} from './pane-terminal-output-cursor-control'
import {
  debugEnabled,
  debugState,
  recordQueueDebugPressure
} from './terminal-output-scheduler-queue-runtime-debug'
import { scheduleDrain } from './terminal-output-scheduler-queue-runtime-drain'
import {
  ALWAYS_REFRESH_FOREGROUND_SYNCHRONOUSLY,
  BACKGROUND_BACKLOG_WARNING,
  currentTerminalOutputBacklogCapChars,
  FOREGROUND_BACKLOG_WARNING,
  FOREGROUND_COALESCE_DELAY_MS,
  FOREGROUND_HOLD_SAFETY_DELAY_MS,
  LARGE_BACKLOG_CHARS,
  MAX_BACKGROUND_QUEUE_CHUNKS,
  queuedByTerminal,
  SYNC_FOREGROUND_FLUSH_CHARS,
  type QueueEntry,
  type TerminalOutputBeforeWrite,
  type TerminalOutputTarget,
  type WriteTerminalOutputOptions
} from './terminal-output-scheduler-queue-runtime-state'

export function createQueueEntry(
  terminal: TerminalOutputTarget,
  options: WriteTerminalOutputOptions
): QueueEntry {
  return {
    terminal,
    chunks: [],
    chunkIndex: 0,
    queuedChars: 0,
    onBackgroundBacklogDropped: options.onBackgroundBacklogDropped,
    backgroundBacklogDropped: false,
    highPriority: true,
    foregroundHold: false,
    foregroundHoldSafetyDelayMs: FOREGROUND_HOLD_SAFETY_DELAY_MS,
    foregroundCoalesce: false,
    foregroundCoalesceDelayMs: FOREGROUND_COALESCE_DELAY_MS,
    foregroundHoldSafetyTimer: null,
    foregroundCoalesceTimer: null
  }
}

export function clearForegroundHoldSafety(entry: QueueEntry): void {
  if (entry.foregroundHoldSafetyTimer === null) {
    return
  }
  clearTimeout(entry.foregroundHoldSafetyTimer)
  entry.foregroundHoldSafetyTimer = null
  entry.foregroundHoldSafetyDelayMs = FOREGROUND_HOLD_SAFETY_DELAY_MS
}

export function clearForegroundCoalesce(entry: QueueEntry): void {
  if (entry.foregroundCoalesceTimer !== null) {
    clearTimeout(entry.foregroundCoalesceTimer)
    entry.foregroundCoalesceTimer = null
  }
  entry.foregroundCoalesce = false
  entry.foregroundCoalesceDelayMs = FOREGROUND_COALESCE_DELAY_MS
}

export function scheduleForegroundHoldSafety(entry: QueueEntry): void {
  clearForegroundHoldSafety(entry)
  entry.foregroundHoldSafetyTimer = setTimeout(() => {
    entry.foregroundHoldSafetyTimer = null
    entry.foregroundHold = false
    clearForegroundCoalesce(entry)
    if (queuedByTerminal.has(entry.terminal)) {
      scheduleDrain(0)
    }
  }, entry.foregroundHoldSafetyDelayMs)
}

export function scheduleForegroundCoalesceRelease(
  entry: QueueEntry,
  options?: { rescheduleEarlier?: boolean }
): void {
  if (entry.foregroundCoalesceTimer !== null) {
    if (options?.rescheduleEarlier !== true) {
      entry.foregroundCoalesce = true
      return
    }
    clearTimeout(entry.foregroundCoalesceTimer)
    entry.foregroundCoalesceTimer = null
  }
  entry.foregroundCoalesce = true
  entry.foregroundCoalesceTimer = setTimeout(() => {
    entry.foregroundCoalesceTimer = null
    entry.foregroundCoalesce = false
    if (queuedByTerminal.has(entry.terminal)) {
      scheduleDrain(0)
    }
  }, entry.foregroundCoalesceDelayMs)
}

export function isEntryDrainable(entry: QueueEntry): boolean {
  return !entry.foregroundHold && !entry.foregroundCoalesce
}

export function previewQueuedData(entry: QueueEntry, limit: number): string {
  let data = ''
  for (let index = entry.chunkIndex; index < entry.chunks.length; index += 1) {
    const chunk = entry.chunks[index]
    const remaining = limit - data.length
    if (remaining <= 0) {
      break
    }
    data += chunk.data.slice(0, remaining)
  }
  return data
}

export function coalescedQueuedDataNeedsCursorRestore(entry: QueueEntry): boolean {
  const data = previewQueuedData(entry, SYNC_FOREGROUND_FLUSH_CHARS)
  const synchronizedEndIndex = data.lastIndexOf(SYNCHRONIZED_OUTPUT_END_SEQUENCE)
  if (synchronizedEndIndex === -1) {
    return false
  }
  const synchronizedFrame = data.slice(
    0,
    synchronizedEndIndex + SYNCHRONIZED_OUTPUT_END_SEQUENCE.length
  )
  return (
    containsCursorRestore(synchronizedFrame) &&
    !containsFinalCursorPlacementBeforeSynchronizedEnd(synchronizedFrame) &&
    !containsDrainableCursorRestore(data)
  )
}

export {
  compactConsumedChunks,
  enqueueChunk,
  takeQueuedChunk
} from './pane-terminal-output-chunk-queue'

// Why: every discard path MUST fire these before clearing/replacing the queue — a dropped chunk still counts as consumed, or main's in-flight window shrinks permanently and the PTY wedges.
export function fireQueuedAckCredits(entry: QueueEntry): void {
  for (let index = entry.chunkIndex; index < entry.chunks.length; index += 1) {
    const ackCredit = entry.chunks[index].ackCredit
    if (ackCredit) {
      attemptTerminalOutputAckCredit(entry.terminal, ackCredit)
    }
  }
}

export function discardDetachedQueueEntry(entry: QueueEntry): void {
  fireQueuedAckCredits(entry)
  entry.chunks.length = 0
  entry.chunkIndex = 0
  entry.queuedChars = 0
  entry.highPriority = false
  clearForegroundHoldSafety(entry)
  clearForegroundCoalesce(entry)
}

export function queueCapExceeded(entry: QueueEntry): boolean {
  return (
    entry.queuedChars > currentTerminalOutputBacklogCapChars() ||
    entry.chunks.length - entry.chunkIndex > MAX_BACKGROUND_QUEUE_CHUNKS
  )
}

export function replaceBacklogWithWarning(
  entry: QueueEntry,
  warning: string = BACKGROUND_BACKLOG_WARNING
): void {
  const shouldNotify = !entry.backgroundBacklogDropped
  if (shouldNotify) {
    // Why: field visibility for cap tuning — drop frequency and size decide whether the cap is too small (issue #2836 / #7017).
    recordRendererCrashBreadcrumb('terminal_output_backlog_dropped', {
      foreground: warning === FOREGROUND_BACKLOG_WARNING,
      droppedChars: entry.queuedChars,
      capChars: currentTerminalOutputBacklogCapChars()
    })
  }
  let beforeWrite: TerminalOutputBeforeWrite | undefined
  for (let index = entry.chunks.length - 1; index >= entry.chunkIndex; index--) {
    if (entry.chunks[index]?.beforeWrite) {
      beforeWrite = entry.chunks[index].beforeWrite
      break
    }
  }
  clearForegroundHoldSafety(entry)
  fireQueuedAckCredits(entry)
  entry.chunks = [
    {
      data: warning,
      foreground: false,
      forceForegroundRefresh: false,
      followupForegroundRefresh: false,
      shouldRefreshForegroundSynchronously: ALWAYS_REFRESH_FOREGROUND_SYNCHRONOUSLY,
      stripTransientCursorShows: false,
      beforeWrite
    }
  ]
  entry.chunkIndex = 0
  entry.queuedChars = warning.length
  entry.backgroundBacklogDropped = true
  entry.highPriority = true
  entry.foregroundHold = false
  if (debugEnabled && shouldNotify) {
    debugState.droppedBacklogCount++
  }
  clearForegroundCoalesce(entry)
  recordQueueDebugPressure()
  if (shouldNotify) {
    entry.onBackgroundBacklogDropped?.()
  }
}

export function hasQueuedChunks(entry: QueueEntry): boolean {
  return entry.chunkIndex < entry.chunks.length
}

export function hasHighPriorityBacklog(): boolean {
  for (const entry of queuedByTerminal.values()) {
    if (
      isEntryDrainable(entry) &&
      (entry.highPriority || entry.queuedChars > LARGE_BACKLOG_CHARS)
    ) {
      return true
    }
  }
  return false
}

export function hasDrainableBacklog(): boolean {
  for (const entry of queuedByTerminal.values()) {
    if (isEntryDrainable(entry)) {
      return true
    }
  }
  return false
}

// Why no per-write scroll enforcement: xterm's BufferService.isUserScrolling owns live follow/pin; app-side enforcement is limited to structural ops xterm can't identify, like replay.
