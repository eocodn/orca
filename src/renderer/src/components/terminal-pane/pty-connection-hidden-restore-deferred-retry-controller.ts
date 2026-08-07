import {
  HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MAX,
  HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MS
} from './pty-connection-runtime-state'

type HiddenRestoreDeferredRetryControllerOptions = {
  isDisposed: () => boolean
  isForeground: () => boolean
  isRestoreNeeded: () => boolean
  onRetry: () => void
  onExhausted: () => void
}

export function createPtyConnectionHiddenRestoreDeferredRetryController(
  options: HiddenRestoreDeferredRetryControllerOptions
) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let attempts = 0

  function clear(): void {
    if (timer === null) {
      return
    }
    clearTimeout(timer)
    timer = null
  }

  return {
    schedule(): void {
      if (options.isDisposed() || timer !== null || !options.isForeground()) {
        return
      }
      if (attempts >= HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MAX) {
        options.onExhausted()
        return
      }
      attempts += 1
      timer = setTimeout(() => {
        timer = null
        if (options.isDisposed() || !options.isRestoreNeeded()) {
          return
        }
        options.onRetry()
      }, HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MS)
    },
    clear,
    reset(): void {
      attempts = 0
      clear()
    },
    resetAttempts(): void {
      attempts = 0
    },
    dispose: clear
  }
}
