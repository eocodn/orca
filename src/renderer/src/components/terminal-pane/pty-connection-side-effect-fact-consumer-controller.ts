export function createPtyConnectionSideEffectFactConsumerController() {
  let unsubscribe: (() => void) | null = null

  const clear = (): void => {
    unsubscribe?.()
    unsubscribe = null
  }

  return {
    replace(subscribe: () => () => void): void {
      clear()
      unsubscribe = subscribe()
    },
    clear
  }
}
