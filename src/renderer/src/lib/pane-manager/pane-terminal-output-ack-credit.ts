import { runGuardedWriteCompletionStep } from './xterm-write-callback-guard'

type TerminalOutputAckTarget = object
type TerminalOutputAckCredit = () => void

const inFlightAckCompletions = new WeakMap<TerminalOutputAckTarget, Set<() => void>>()
// A shared ACK scope would quarantine every credit after five failures.
const ackCreditScopesByTerminal = new WeakMap<
  TerminalOutputAckTarget,
  WeakMap<TerminalOutputAckCredit, object>
>()

function getAckCreditScope(
  terminal: TerminalOutputAckTarget,
  credit: TerminalOutputAckCredit
): object {
  let scopes = ackCreditScopesByTerminal.get(terminal)
  if (!scopes) {
    scopes = new WeakMap()
    ackCreditScopesByTerminal.set(terminal, scopes)
  }
  let scope = scopes.get(credit)
  if (!scope) {
    scope = {}
    scopes.set(credit, scope)
  }
  return scope
}

export function attemptTerminalOutputAckCredit(
  terminal: TerminalOutputAckTarget,
  credit: TerminalOutputAckCredit
): void {
  runGuardedWriteCompletionStep(
    'terminal-output-ack-credit',
    credit,
    getAckCreditScope(terminal, credit)
  )
}

/** Tracks credits after submission to xterm so pane disposal can treat its
 * unparsed write buffer as discarded instead of leaking main's ACK window. */
export function registerTerminalOutputAckCredits(
  terminal: TerminalOutputAckTarget,
  credits: readonly (() => void)[]
): (() => void) | undefined {
  if (credits.length === 0) {
    return undefined
  }
  let completions = inFlightAckCompletions.get(terminal)
  if (!completions) {
    completions = new Set()
    inFlightAckCompletions.set(terminal, completions)
  }
  let completed = false
  const complete = (): void => {
    if (completed) {
      return
    }
    completed = true
    completions?.delete(complete)
    if (completions?.size === 0) {
      inFlightAckCompletions.delete(terminal)
    }
    for (const credit of credits) {
      attemptTerminalOutputAckCredit(terminal, credit)
    }
  }
  completions.add(complete)
  return complete
}

export function discardInFlightTerminalOutputAckCredits(terminal: TerminalOutputAckTarget): void {
  const completions = inFlightAckCompletions.get(terminal)
  if (!completions) {
    return
  }
  for (const complete of completions) {
    complete()
  }
}
