import type { AgentInterruptInputIntent } from '../../../../shared/agent-interrupt-intent'

type InputIntentArgs = {
  observeInterruptIntent: (intent: AgentInterruptInputIntent) => void
  observeTitleOnlyInterrupt: () => void
  markBracketedPasteInterrupted: () => void
  observeQuestionAnsweredInput: (data: string) => void
  flushInterruptPending: () => boolean | Promise<boolean>
}

export function createPtyConnectionInputIntent({
  observeInterruptIntent,
  observeTitleOnlyInterrupt,
  markBracketedPasteInterrupted,
  observeQuestionAnsweredInput,
  flushInterruptPending
}: InputIntentArgs) {
  let pendingIntent: AgentInterruptInputIntent | null = null
  let clearPendingIntentTimer: ReturnType<typeof setTimeout> | null = null
  let pendingWrite: Promise<void> | null = null

  const clearPendingIntent = (): void => {
    pendingIntent = null
    if (clearPendingIntentTimer !== null) {
      clearTimeout(clearPendingIntentTimer)
      clearPendingIntentTimer = null
    }
  }
  const setPendingIntent = (intent: AgentInterruptInputIntent): void => {
    clearPendingIntent()
    pendingIntent = intent
    clearPendingIntentTimer = setTimeout(clearPendingIntent, 0)
  }
  const inferExactIntent = (data: string): AgentInterruptInputIntent | null => {
    if (data === '\x03') {
      return 'ctrl-c'
    }
    if (data === '\x1b') {
      return 'plain-escape'
    }
    return null
  }
  const observeSentIntent = (data: string, intent = pendingIntent): void => {
    if (
      (intent === 'plain-escape' && data === '\x1b') ||
      (intent === 'ctrl-c' && data === '\x03')
    ) {
      observeInterruptIntent(intent)
      observeTitleOnlyInterrupt()
    }
  }
  const observeAcceptedInput = (
    data: string,
    intent: AgentInterruptInputIntent | null = null
  ): void => {
    if (intent === 'ctrl-c' || data === '\x03') {
      markBracketedPasteInterrupted()
    }
    observeQuestionAnsweredInput(data)
  }
  const setPendingWrite = (promise: Promise<void>): void => {
    pendingWrite = promise
    void promise.finally(() => {
      if (pendingWrite === promise) {
        pendingWrite = null
      }
    })
  }
  const flushPending = (): boolean | Promise<boolean> => {
    const write = pendingWrite
    return write ? write.then(flushInterruptPending) : flushInterruptPending()
  }

  return {
    clearPendingIntent,
    setPendingIntent,
    getPendingIntent: (): AgentInterruptInputIntent | null => pendingIntent,
    inferExactIntent,
    observeSentIntent,
    observeAcceptedInput,
    setPendingWrite,
    clearPendingWrite: (): void => {
      pendingWrite = null
    },
    flushPending
  }
}
