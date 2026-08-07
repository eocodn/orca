type Disposable = { dispose: () => void }

type PtyConnectionFreshSpawnFollowControllerArgs = {
  isDisposed: () => boolean
  markFollowOutput: () => void
  getScrollIntentKind: () => string
  deferGeometryMutation: (retry: () => void) => boolean
  scrollToBottom: () => void
  subscribeRender: (listener: () => void) => Disposable
  subscribeResize: (listener: () => void) => Disposable
}

export function createPtyConnectionFreshSpawnFollowController({
  isDisposed,
  markFollowOutput,
  getScrollIntentKind,
  deferGeometryMutation,
  scrollToBottom,
  subscribeRender,
  subscribeResize
}: PtyConnectionFreshSpawnFollowControllerArgs) {
  let retryDisposables: Disposable[] = []

  const cancel = (): void => {
    for (const disposable of retryDisposables) {
      disposable.dispose()
    }
    retryDisposables = []
  }

  const reset = (): void => {
    cancel()
    markFollowOutput()
    let complete = false

    const tryResetNativeFollow = (): void => {
      if (
        isDisposed() ||
        getScrollIntentKind() !== 'followOutput' ||
        deferGeometryMutation(tryResetNativeFollow)
      ) {
        return
      }
      try {
        scrollToBottom()
        complete = true
        cancel()
      } catch (error) {
        if (!(error instanceof TypeError && /dimensions/.test(error.message))) {
          cancel()
          throw error
        }
      }
    }

    tryResetNativeFollow()
    if (!complete) {
      // Why: detached xterm viewports become scrollable on their first render or resize.
      retryDisposables = [
        subscribeRender(tryResetNativeFollow),
        subscribeResize(tryResetNativeFollow)
      ]
    }
  }

  return { reset, cancel }
}
