import { flushTerminalOutput } from './pane-terminal-output-delivery'
import { discardForegroundRenderSettle } from './pane-terminal-foreground-render-settle'
import {
  discardInFlightTerminalOutputAckCredits,
  registerTerminalOutputAckCredits
} from './pane-terminal-output-ack-credit'
import {
  cancelTerminalWriteStallWatch,
  failTerminalWriteStallWatch,
  isTerminalWritePipelineCertifiedDead,
  recordTerminalParseProgress
} from './terminal-write-pipeline-health'
import { fireQueuedAckCredits } from './pane-terminal-output-queue'
import { exposeDebugApi, recordQueueDebugPressure } from './terminal-output-scheduler-queue-runtime-debug'
import {
  PARSE_SETTLE_TIMEOUT_MS,
  backlogRecoveryByTerminal,
  queuedByTerminal,
  type TerminalBacklogRecoveryRequest,
  type TerminalOutputTarget
} from './terminal-output-scheduler-queue-runtime-state'

export function requestRegisteredTerminalBacklogRecovery(terminal: TerminalOutputTarget): boolean {
  const requestRecovery = backlogRecoveryByTerminal.get(terminal)
  return requestRecovery ? requestRecovery() : false
}

export function requestTerminalBacklogRecovery(terminal: TerminalOutputTarget): void {
  exposeDebugApi()
  requestRegisteredTerminalBacklogRecovery(terminal)
}

export function registerTerminalBacklogRecovery(
  terminal: TerminalOutputTarget,
  requestRecovery: TerminalBacklogRecoveryRequest
): () => void {
  backlogRecoveryByTerminal.set(terminal, requestRecovery)
  return () => {
    if (backlogRecoveryByTerminal.get(terminal) === requestRecovery) {
      backlogRecoveryByTerminal.delete(terminal)
    }
  }
}

export function waitForTerminalOutputParsed(terminal: TerminalOutputTarget): Promise<void> {
  flushTerminalOutput(terminal)
  if (isTerminalWritePipelineCertifiedDead(terminal)) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (): void => {
      if (settled) {
        return
      }
      settled = true
      if (timer !== null) {
        clearTimeout(timer)
      }
      resolve()
    }
    const finishParsed = (): void => {
      recordTerminalParseProgress(terminal)
      finish()
    }
    timer = setTimeout(finish, PARSE_SETTLE_TIMEOUT_MS)
    try {
      terminal.write('', finishParsed)
    } catch {
      failTerminalWriteStallWatch(terminal)
      finish()
    }
  })
}

export function discardTerminalOutput(terminal: TerminalOutputTarget): void {
  exposeDebugApi()
  const entry = queuedByTerminal.get(terminal)
  if (entry) {
    fireQueuedAckCredits(entry)
  }
  discardInFlightTerminalOutputAckCredits(terminal)
  queuedByTerminal.delete(terminal)
  discardForegroundRenderSettle(terminal)
  cancelTerminalWriteStallWatch(terminal)
  recordQueueDebugPressure()
}

export { registerTerminalOutputAckCredits }
