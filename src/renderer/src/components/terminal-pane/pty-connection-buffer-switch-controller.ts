type BufferSwitchDisposable = {
  dispose: () => void
}

type PtyConnectionBufferSwitchControllerArgs = {
  subscribe: (listener: () => void) => BufferSwitchDisposable | undefined
}

export function createPtyConnectionBufferSwitchController({
  subscribe
}: PtyConnectionBufferSwitchControllerArgs) {
  let count = 0
  let disposable = subscribe(() => {
    count += 1
  })

  return {
    getCount(): number {
      return count
    },
    dispose(): void {
      disposable?.dispose()
      disposable = undefined
    }
  }
}
