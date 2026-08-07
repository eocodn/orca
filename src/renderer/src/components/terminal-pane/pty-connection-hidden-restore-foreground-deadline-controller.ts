import { HIDDEN_OUTPUT_RESTORE_FOREGROUND_TIMEOUT_MS } from './pty-connection-runtime-state'

type HiddenRestoreForegroundDeadlineControllerOptions = {
  isDisposed: () => boolean
  isForeground: () => boolean
  hasPending: () => boolean
  getRestorePtyId: () => string | null
  getCurrentPtyId: () => string | null
  getRestoreGeneration: () => number
  onDeadline: (ptyId: string) => void
}

export function createPtyConnectionHiddenRestoreForegroundDeadlineController(
  options: HiddenRestoreForegroundDeadlineControllerOptions
) {
  let timer: ReturnType<typeof setTimeout> | null = null

  function clear(): void {
    if (timer === null) {
      return
    }
    clearTimeout(timer)
    timer = null
  }

  return {
    arm(): void {
      if (
        options.isDisposed() ||
        timer !== null ||
        !options.isForeground() ||
        !options.hasPending()
      ) {
        return
      }
      const ptyId = options.getRestorePtyId()
      if (ptyId === null || options.getCurrentPtyId() !== ptyId) {
        return
      }
      const generation = options.getRestoreGeneration()
      timer = setTimeout(() => {
        timer = null
        if (
          options.isDisposed() ||
          options.getRestoreGeneration() !== generation ||
          options.getRestorePtyId() !== ptyId ||
          !options.isForeground()
        ) {
          return
        }
        options.onDeadline(ptyId)
      }, HIDDEN_OUTPUT_RESTORE_FOREGROUND_TIMEOUT_MS)
    },
    clear,
    dispose: clear
  }
}
