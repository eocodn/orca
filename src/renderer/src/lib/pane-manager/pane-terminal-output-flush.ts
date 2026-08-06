import { registerTerminalOutputAckCredits } from './pane-terminal-output-ack-credit'
import { removeTransientCursorShowSequences } from './pane-terminal-output-cursor-control'
import {
  clearForegroundCoalesce,
  clearForegroundHoldSafety,
  discardDetachedQueueEntry,
  fireQueuedAckCredits,
  hasQueuedChunks,
  isEntryDrainable,
  takeQueuedChunk
} from './pane-terminal-output-queue'
import { writeForegroundTerminalChunk } from './pane-terminal-foreground-render-settle'
import {
  debugEnabled,
  debugState,
  exposeDebugApi,
  recordQueueDebugPressure
} from './terminal-output-scheduler-queue-runtime-debug'
import { scheduleDrain } from './terminal-output-scheduler-queue-runtime-drain'
import {
  discardTerminalOutput,
  requestRegisteredTerminalBacklogRecovery
} from './terminal-output-scheduler-queue-runtime-recovery'
import {
  BACKGROUND_CHUNK_CHARS,
  queuedByTerminal,
  type TerminalOutputTarget
} from './terminal-output-scheduler-queue-runtime-state'
import {
  composeParsedCallback,
  composeWriteFailureCallback,
  writeBackgroundTerminalChunk
} from './terminal-output-scheduler-queue-runtime-write'
import {
  armTerminalWriteStallWatch,
  cancelTerminalWriteStallWatch,
  isTerminalWritePipelineCertifiedDead
} from './terminal-write-pipeline-health'

export function flushTerminalOutput(
  terminal: TerminalOutputTarget,
  options?: { maxChars?: number }
): void {
  exposeDebugApi()
  const entry = queuedByTerminal.get(terminal)
  if (!entry) {
    return
  }
  queuedByTerminal.delete(terminal)
  if (isTerminalWritePipelineCertifiedDead(terminal)) {
    discardDetachedQueueEntry(entry)
    discardTerminalOutput(terminal)
    return
  }
  if (!isEntryDrainable(entry)) {
    queuedByTerminal.set(terminal, entry)
    return
  }
  if (entry.backgroundBacklogDropped && requestRegisteredTerminalBacklogRecovery(terminal)) {
    fireQueuedAckCredits(entry)
    entry.chunks.length = 0
    entry.chunkIndex = 0
    entry.queuedChars = 0
    entry.highPriority = false
    clearForegroundHoldSafety(entry)
    clearForegroundCoalesce(entry)
    recordQueueDebugPressure()
    return
  }

  let flushedChars = 0
  let queuedWrite = takeQueuedChunk(entry, BACKGROUND_CHUNK_CHARS)
  while (queuedWrite) {
    flushedChars += queuedWrite.data.length
    if (debugEnabled) {
      debugState.flushWriteCount++
    }
    const ackCreditsParsed = registerTerminalOutputAckCredits(terminal, queuedWrite.ackCredits)
    armTerminalWriteStallWatch(terminal, {
      onCertifiedDead: () => discardTerminalOutput(terminal)
    })
    try {
      queuedWrite.beforeWrite?.(queuedWrite.data)
      const writeAccepted = queuedWrite.foreground
        ? writeForegroundTerminalChunk(
            terminal,
            queuedWrite.stripTransientCursorShows
              ? removeTransientCursorShowSequences(queuedWrite.data)
              : queuedWrite.data,
            {
              forceViewportRefresh: queuedWrite.forceForegroundRefresh,
              followupViewportRefresh: queuedWrite.followupForegroundRefresh,
              shouldRefreshViewportSynchronously: queuedWrite.shouldRefreshForegroundSynchronously,
              onParsed: composeParsedCallback(
                terminal,
                queuedWrite.onParsed,
                ackCreditsParsed,
                undefined
              ),
              onWriteFailure: composeWriteFailureCallback(terminal, ackCreditsParsed)
            }
          )
        : writeBackgroundTerminalChunk(
            terminal,
            queuedWrite.data,
            composeParsedCallback(terminal, queuedWrite.onParsed, ackCreditsParsed, undefined),
            composeWriteFailureCallback(terminal, ackCreditsParsed)
          )
      if (!writeAccepted) {
        fireQueuedAckCredits(entry)
        clearForegroundHoldSafety(entry)
        clearForegroundCoalesce(entry)
        recordQueueDebugPressure()
        return
      }
    } catch {
      // Why: pre-write hooks/setup failed before xterm owned these bytes; cancel the watch, but consumed + abandoned chunks still credit delivery.
      cancelTerminalWriteStallWatch(terminal)
      ackCreditsParsed?.()
      fireQueuedAckCredits(entry)
      clearForegroundHoldSafety(entry)
      clearForegroundCoalesce(entry)
      recordQueueDebugPressure()
      return
    }
    if (options?.maxChars !== undefined && flushedChars >= options.maxChars) {
      break
    }
    queuedWrite = takeQueuedChunk(entry, BACKGROUND_CHUNK_CHARS)
  }
  if (hasQueuedChunks(entry)) {
    entry.highPriority = true
    queuedByTerminal.set(terminal, entry)
    scheduleDrain(0)
  } else {
    entry.highPriority = false
    clearForegroundCoalesce(entry)
    clearForegroundHoldSafety(entry)
  }
  recordQueueDebugPressure()
}
