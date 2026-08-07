type SettledCallback = () => void

export function createPtyConnectionHiddenRestoreTaskController() {
  let current: Promise<void> | null = null

  return {
    isInFlight(): boolean {
      return current !== null
    },
    track(task: Promise<void>, onSettled: SettledCallback): Promise<void> {
      let tracked: Promise<void>
      tracked = task.finally(() => {
        if (current === tracked) {
          current = null
        }
        onSettled()
      })
      current = tracked
      return tracked
    },
    abandon(): void {
      current = null
    }
  }
}
