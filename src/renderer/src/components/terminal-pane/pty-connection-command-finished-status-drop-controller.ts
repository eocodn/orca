export function createPtyConnectionCommandFinishedStatusDropController() {
  let pending: (() => void) | null = null

  const clear = (): void => {
    pending = null
  }

  return {
    handle(action: () => void, defer: boolean): void {
      if (defer) {
        pending = action
        return
      }
      pending = null
      action()
    },
    settle(): void {
      const action = pending
      pending = null
      action?.()
    },
    clear,
    dispose: clear
  }
}
