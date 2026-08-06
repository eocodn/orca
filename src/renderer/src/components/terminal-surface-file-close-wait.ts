import { useAppStore } from '../store'

export function waitForTerminalFileClosed(fileId: string, timeoutMs: number): Promise<boolean> {
  if (!useAppStore.getState().openFiles.some((file) => file.id === fileId)) {
    return Promise.resolve(true)
  }
  return new Promise((resolve) => {
    let unsubscribe: (() => void) | null = null
    const timeoutId = window.setTimeout(() => {
      unsubscribe?.()
      resolve(false)
    }, timeoutMs)
    unsubscribe = useAppStore.subscribe((state) => {
      if (!state.openFiles.some((file) => file.id === fileId)) {
        window.clearTimeout(timeoutId)
        unsubscribe?.()
        resolve(true)
      }
    })
    if (!useAppStore.getState().openFiles.some((file) => file.id === fileId)) {
      window.clearTimeout(timeoutId)
      unsubscribe?.()
      resolve(true)
    }
  })
}
