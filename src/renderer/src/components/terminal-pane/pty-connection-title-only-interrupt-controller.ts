import { AGENT_INTERRUPT_SETTLE_MS } from '../../../../shared/agent-interrupt-intent'

type PtyConnectionTitleOnlyInterruptControllerArgs = {
  hasAgentStatus: () => boolean
  readTitle: () => string | undefined
  isWorkingTitle: (title: string) => boolean
  clearWorkingTitle: () => void
}

export function createPtyConnectionTitleOnlyInterruptController({
  hasAgentStatus,
  readTitle,
  isWorkingTitle,
  clearWorkingTitle
}: PtyConnectionTitleOnlyInterruptControllerArgs) {
  let timer: ReturnType<typeof setTimeout> | null = null

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  return {
    observe(): void {
      if (hasAgentStatus()) {
        return
      }
      const baselineTitle = readTitle()
      if (!baselineTitle || !isWorkingTitle(baselineTitle)) {
        return
      }
      clear()
      timer = setTimeout(() => {
        timer = null
        if (hasAgentStatus()) {
          return
        }
        const currentTitle = readTitle()
        if (
          currentTitle !== undefined &&
          currentTitle === baselineTitle &&
          isWorkingTitle(currentTitle)
        ) {
          clearWorkingTitle()
        }
      }, AGENT_INTERRUPT_SETTLE_MS)
    },
    clear,
    dispose: clear
  }
}
