import { SHIFT_ENTER_RECONFIRM_IDLE_MS } from './pty-connection-runtime-state'

type PtyConnectionDroidReconfirmationControllerArgs = {
  reconfirm: () => void
}

export function createPtyConnectionDroidReconfirmationController({
  reconfirm
}: PtyConnectionDroidReconfirmationControllerArgs) {
  let timer: ReturnType<typeof setTimeout> | null = null

  const dispose = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  return {
    request(): void {
      dispose()
      // Why: confirm only after a rapid Shift+Enter multiline burst goes idle.
      timer = setTimeout(() => {
        timer = null
        reconfirm()
      }, SHIFT_ENTER_RECONFIRM_IDLE_MS)
    },
    dispose
  }
}
