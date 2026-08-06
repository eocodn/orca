import { registerTerminalOutputAckCredits } from './pane-terminal-output-ack-credit'
import {
  containsDrainableCursorRestore,
  removeTransientCursorShowSequences
} from './pane-terminal-output-cursor-control'
import {
  clearForegroundCoalesce,
  clearForegroundHoldSafety,
  coalescedQueuedDataNeedsCursorRestore,
  createQueueEntry,
  enqueueChunk,
  queueCapExceeded,
  replaceBacklogWithWarning,
  scheduleForegroundCoalesceRelease,
  scheduleForegroundHoldSafety
} from './pane-terminal-output-queue'
import { writeForegroundTerminalChunk } from './pane-terminal-foreground-render-settle'
import { flushTerminalOutput } from './pane-terminal-output-flush'
import {
  debugEnabled,
  debugState,
  exposeDebugApi
} from './terminal-output-scheduler-queue-runtime-debug'
import { scheduleDrain } from './terminal-output-scheduler-queue-runtime-drain'
import { discardTerminalOutput } from './terminal-output-scheduler-queue-runtime-recovery'
import {
  ALWAYS_REFRESH_FOREGROUND_SYNCHRONOUSLY,
  BACKGROUND_FLUSH_DELAY_MS,
  FOREGROUND_BACKLOG_WARNING,
  FOREGROUND_HOLD_SAFETY_DELAY_MS,
  LATENCY_SENSITIVE_FOREGROUND_COALESCE_DELAY_MS,
  LATENCY_SENSITIVE_FOREGROUND_HOLD_SAFETY_DELAY_MS,
  LARGE_BACKLOG_CHARS,
  queuedByTerminal,
  SYNC_FOREGROUND_FLUSH_CHARS,
  type TerminalOutputTarget,
  type WriteTerminalOutputOptions
} from './terminal-output-scheduler-queue-runtime-state'
import {
  composeParsedCallback,
  composeWriteFailureCallback
} from './terminal-output-scheduler-queue-runtime-write'
import {
  armTerminalWriteStallWatch,
  cancelTerminalWriteStallWatch,
  isTerminalWritePipelineCertifiedDead
} from './terminal-write-pipeline-health'

export function writeTerminalOutput(
  terminal: TerminalOutputTarget,
  data: string,
  options: WriteTerminalOutputOptions
): void {
  exposeDebugApi()
  // Why: recovery may be budget-delayed while PTY output keeps flowing; main owns the authoritative buffer, so credit delivery without waking dead xterm.
  if (isTerminalWritePipelineCertifiedDead(terminal)) {
    options.ackCredit?.()
    return
  }
  if (!data) {
    // Why: an empty write still consumed its delivery — credit or main's in-flight window leaks.
    options.ackCredit?.()
    return
  }

  if (options.foreground) {
    const entry = queuedByTerminal.get(terminal)
    if (entry?.highPriority || options.coalesceForeground || options.holdForeground) {
      const queued = entry ?? createQueueEntry(terminal, options)
      queued.onBackgroundBacklogDropped = options.onBackgroundBacklogDropped
      queued.highPriority = true
      queuedByTerminal.set(terminal, queued)
      enqueueChunk(queued, data, {
        foreground: true,
        forceForegroundRefresh: options.forceForegroundRefresh,
        followupForegroundRefresh: options.followupForegroundRefresh,
        shouldRefreshForegroundSynchronously: options.shouldRefreshForegroundSynchronously,
        stripTransientCursorShows: options.stripTransientCursorShows,
        beforeWrite: options.beforeWrite,
        onParsed: options.onParsed,
        ackCredit: options.ackCredit
      })
      if (debugEnabled) {
        debugState.foregroundWriteCount++
        debugState.deferredForegroundEnqueueCount++
      }
      // Why: a visible pane's queue was previously uncapped — a flood the drain couldn't keep up with ballooned renderer memory without bound.
      if (queueCapExceeded(queued)) {
        replaceBacklogWithWarning(queued, FOREGROUND_BACKLOG_WARNING)
        scheduleDrain(0)
        return
      }
      if (options.holdForeground) {
        // Why: synchronized-output start/body chunks contain transient cursor moves; holding them prevents Chromium from rasterizing those states.
        if (options.latencySensitive === true) {
          // Why: Codex composer redraws can split the end marker from the input-triggered frame; keep cursor protection without a human-visible fallback delay on typed chars.
          queued.foregroundHoldSafetyDelayMs = Math.min(
            queued.foregroundHoldSafetyDelayMs,
            LATENCY_SENSITIVE_FOREGROUND_HOLD_SAFETY_DELAY_MS
          )
        } else if (!queued.foregroundHold) {
          queued.foregroundHoldSafetyDelayMs = FOREGROUND_HOLD_SAFETY_DELAY_MS
        }
        queued.foregroundHold = true
        clearForegroundCoalesce(queued)
        scheduleForegroundHoldSafety(queued)
        return
      }
      if (options.coalesceForeground || queued.foregroundCoalesce) {
        queued.foregroundHold = false
        clearForegroundHoldSafety(queued)
        const shouldShortenCoalesceForLatencySensitiveForeground = options.latencySensitive === true
        if (shouldShortenCoalesceForLatencySensitiveForeground) {
          // Why: user input echo must not inherit the normal synchronized-frame restore fallback; wait briefly for the restore, then paint.
          queued.foregroundCoalesceDelayMs = Math.min(
            queued.foregroundCoalesceDelayMs,
            LATENCY_SENSITIVE_FOREGROUND_COALESCE_DELAY_MS
          )
        }
        const shouldDrainForLatencySensitiveForeground =
          shouldShortenCoalesceForLatencySensitiveForeground &&
          !coalescedQueuedDataNeedsCursorRestore(queued)
        if (containsDrainableCursorRestore(data) || shouldDrainForLatencySensitiveForeground) {
          clearForegroundCoalesce(queued)
          scheduleDrain(0)
          return
        }
        // Why: the PTY transport can split TUI synchronized-output end markers from the cursor-restoring bytes; wait for the restore, with the timer as bounded fallback.
        scheduleForegroundCoalesceRelease(queued, {
          rescheduleEarlier: shouldShortenCoalesceForLatencySensitiveForeground
        })
        return
      }
      queued.foregroundHold = false
      clearForegroundCoalesce(queued)
      clearForegroundHoldSafety(queued)
      scheduleDrain(0)
      return
    }
    if (entry && entry.queuedChars > SYNC_FOREGROUND_FLUSH_CHARS) {
      entry.highPriority = true
      enqueueChunk(entry, data, {
        foreground: true,
        forceForegroundRefresh: options.forceForegroundRefresh,
        followupForegroundRefresh: options.followupForegroundRefresh,
        shouldRefreshForegroundSynchronously: options.shouldRefreshForegroundSynchronously,
        stripTransientCursorShows: options.stripTransientCursorShows,
        beforeWrite: options.beforeWrite,
        onParsed: options.onParsed,
        ackCredit: options.ackCredit
      })
      if (debugEnabled) {
        debugState.foregroundWriteCount++
        debugState.deferredForegroundEnqueueCount++
      }
      if (queueCapExceeded(entry)) {
        replaceBacklogWithWarning(entry, FOREGROUND_BACKLOG_WARNING)
      }
      // Why: returning from a hidden window can have megabytes queued — keep byte order but drain async so the first foreground frame isn't pinned behind the whole backlog.
      scheduleDrain(0)
      return
    }
    if (options.latencySensitive === false) {
      let queued = entry
      if (!queued) {
        queued = createQueueEntry(terminal, options)
        queuedByTerminal.set(terminal, queued)
      } else {
        queued.onBackgroundBacklogDropped = options.onBackgroundBacklogDropped
        queued.highPriority = true
      }
      enqueueChunk(queued, data, {
        foreground: true,
        forceForegroundRefresh: options.forceForegroundRefresh,
        followupForegroundRefresh: options.followupForegroundRefresh,
        shouldRefreshForegroundSynchronously: options.shouldRefreshForegroundSynchronously,
        stripTransientCursorShows: options.stripTransientCursorShows,
        beforeWrite: options.beforeWrite,
        onParsed: options.onParsed,
        ackCredit: options.ackCredit
      })
      if (debugEnabled) {
        debugState.foregroundWriteCount++
        debugState.deferredForegroundEnqueueCount++
      }
      if (queueCapExceeded(queued)) {
        replaceBacklogWithWarning(queued, FOREGROUND_BACKLOG_WARNING)
      }
      // Why: visible command floods are throughput work, not keystroke echo — queue behind a zero-delay drain so one IPC callback can't pin the renderer while input/paint wait.
      scheduleDrain(0)
      return
    }
    flushTerminalOutput(terminal)
    if (debugEnabled) {
      debugState.foregroundWriteCount++
    }
    const ackCreditsParsed = registerTerminalOutputAckCredits(
      terminal,
      options.ackCredit ? [options.ackCredit] : []
    )
    armTerminalWriteStallWatch(terminal, {
      onCertifiedDead: () => discardTerminalOutput(terminal)
    })
    try {
      options.beforeWrite?.(data)
      writeForegroundTerminalChunk(
        terminal,
        options.stripTransientCursorShows ? removeTransientCursorShowSequences(data) : data,
        {
          forceViewportRefresh: options.forceForegroundRefresh === true,
          followupViewportRefresh: options.followupForegroundRefresh === true,
          shouldRefreshViewportSynchronously:
            options.shouldRefreshForegroundSynchronously ?? ALWAYS_REFRESH_FOREGROUND_SYNCHRONOUSLY,
          onParsed: composeParsedCallback(terminal, options.onParsed, ackCreditsParsed, undefined),
          onWriteFailure: composeWriteFailureCallback(terminal, ackCreditsParsed)
        }
      )
    } catch (error) {
      // Why: beforeWrite can throw before xterm owns the callback, so consume the delivery here (xterm write throws are caught by the foreground writer).
      ackCreditsParsed?.()
      cancelTerminalWriteStallWatch(terminal)
      throw error
    }
    return
  }

  let entry = queuedByTerminal.get(terminal)
  if (!entry) {
    entry = createQueueEntry(terminal, options)
    entry.highPriority = false
    queuedByTerminal.set(terminal, entry)
  } else {
    entry.onBackgroundBacklogDropped = options.onBackgroundBacklogDropped
  }
  enqueueChunk(entry, data, {
    beforeWrite: options.beforeWrite,
    onParsed: options.onParsed,
    ackCredit: options.ackCredit
  })
  if (queueCapExceeded(entry)) {
    replaceBacklogWithWarning(entry)
  }
  if (debugEnabled) {
    debugState.backgroundEnqueueCount++
  }
  // Why: letting every non-focused pane call xterm.write immediately spawns a WriteBuffer timer per pane, starving the focused terminal on the shared renderer thread.
  scheduleDrain(
    entry.highPriority || entry.queuedChars > LARGE_BACKLOG_CHARS ? 0 : BACKGROUND_FLUSH_DELAY_MS
  )
}

export { flushTerminalOutput }
