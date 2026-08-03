import { writeForegroundTerminalChunk } from './pane-terminal-foreground-render-settle'
import { runGuardedWriteCompletionStep } from './xterm-write-callback-guard'
import {
  armTerminalWriteStallWatch,
  cancelTerminalWriteStallWatch,
  failTerminalWriteStallWatch,
  isTerminalWritePipelineCertifiedDead,
  settleTerminalWriteStallWatch
} from './terminal-write-pipeline-health'
import { registerTerminalOutputAckCredits } from './pane-terminal-output-ack-credit'
import { removeTransientCursorShowSequences } from './pane-terminal-output-cursor-control'
import {
  clearForegroundCoalesce,
  clearForegroundHoldSafety,
  discardDetachedQueueEntry,
  fireQueuedAckCredits,
  takeQueuedChunk
} from './pane-terminal-output-queue'
import { discardTerminalOutput } from './terminal-output-scheduler-queue-runtime-recovery'
import {
  captureTerminalOutputClearGeneration,
  isCurrentTerminalOutputClearGeneration
} from './terminal-output-clear-generation'
import {
  BACKGROUND_CHUNK_CHARS,
  type QueueEntry,
  type TerminalOutputParsedCallback,
  type TerminalOutputTarget
} from './terminal-output-scheduler-queue-runtime-state'
import {
  debugEnabled,
  debugState,
  recordQueueDebugPressure
} from './terminal-output-scheduler-queue-runtime-debug'

export function writeBackgroundTerminalChunk(
  terminal: TerminalOutputTarget,
  data: string,
  onParsed?: TerminalOutputParsedCallback,
  onWriteFailure?: () => void
): boolean {
  const runOnParsed = onParsed
    ? (): void => runGuardedWriteCompletionStep('background-on-parsed', onParsed)
    : undefined
  const runOnWriteFailure = onWriteFailure
    ? (): void => runGuardedWriteCompletionStep('background-on-write-failure', onWriteFailure)
    : undefined
  try {
    if (!runOnParsed || terminal.write.length < 2) {
      terminal.write(data)
      runOnParsed?.()
      return true
    }
    terminal.write(data, runOnParsed)
    return true
  } catch {
    runOnWriteFailure?.()
    return false
  }
}

export function composeParsedCallback(
  terminal: TerminalOutputTarget,
  onParsed: TerminalOutputParsedCallback | undefined,
  ackCreditsParsed: (() => void) | undefined,
  pacer: (() => void) | undefined
): TerminalOutputParsedCallback {
  const clearGeneration = captureTerminalOutputClearGeneration(terminal)
  return () => {
    try {
      if (isCurrentTerminalOutputClearGeneration(terminal, clearGeneration)) {
        onParsed?.()
      }
    } finally {
      ackCreditsParsed?.()
      pacer?.()
      settleTerminalWriteStallWatch(terminal)
    }
  }
}

export function composeWriteFailureCallback(
  terminal: TerminalOutputTarget,
  ackCreditsParsed: (() => void) | undefined
): () => void {
  return () => {
    try {
      ackCreditsParsed?.()
    } finally {
      failTerminalWriteStallWatch(terminal)
    }
  }
}

export function writeQueuedChunk(
  entry: QueueEntry,
  pacer?: () => void
): 'foreground' | 'background' | null {
  if (isTerminalWritePipelineCertifiedDead(entry.terminal)) {
    discardDetachedQueueEntry(entry)
    discardTerminalOutput(entry.terminal)
    return null
  }
  const queuedWrite = takeQueuedChunk(entry, BACKGROUND_CHUNK_CHARS)
  if (!queuedWrite) {
    return null
  }
  const ackCreditsParsed = registerTerminalOutputAckCredits(entry.terminal, queuedWrite.ackCredits)
  armTerminalWriteStallWatch(entry.terminal, {
    onCertifiedDead: () => discardTerminalOutput(entry.terminal)
  })
  try {
    queuedWrite.beforeWrite?.(queuedWrite.data)
    const writeAccepted = queuedWrite.foreground
      ? writeForegroundTerminalChunk(
          entry.terminal,
          queuedWrite.stripTransientCursorShows
            ? removeTransientCursorShowSequences(queuedWrite.data)
            : queuedWrite.data,
          {
            forceViewportRefresh: queuedWrite.forceForegroundRefresh,
            followupViewportRefresh: queuedWrite.followupForegroundRefresh,
            shouldRefreshViewportSynchronously: queuedWrite.shouldRefreshForegroundSynchronously,
            onParsed: composeParsedCallback(
              entry.terminal,
              queuedWrite.onParsed,
              ackCreditsParsed,
              pacer
            ),
            onWriteFailure: composeWriteFailureCallback(entry.terminal, ackCreditsParsed)
          }
        )
      : writeBackgroundTerminalChunk(
          entry.terminal,
          queuedWrite.data,
          composeParsedCallback(entry.terminal, queuedWrite.onParsed, ackCreditsParsed, pacer),
          composeWriteFailureCallback(entry.terminal, ackCreditsParsed)
        )
    if (!writeAccepted) {
      fireQueuedAckCredits(entry)
      entry.chunks.length = 0
      entry.chunkIndex = 0
      entry.queuedChars = 0
      clearForegroundHoldSafety(entry)
      clearForegroundCoalesce(entry)
      recordQueueDebugPressure()
      return null
    }
  } catch {
    cancelTerminalWriteStallWatch(entry.terminal)
    ackCreditsParsed?.()
    fireQueuedAckCredits(entry)
    entry.chunks.length = 0
    entry.chunkIndex = 0
    entry.queuedChars = 0
    clearForegroundHoldSafety(entry)
    clearForegroundCoalesce(entry)
    recordQueueDebugPressure()
    return null
  }
  if (debugEnabled) {
    if (queuedWrite.foreground) {
      debugState.deferredForegroundWriteCount++
    } else {
      debugState.backgroundWriteCount++
    }
  }
  return queuedWrite.foreground ? 'foreground' : 'background'
}
