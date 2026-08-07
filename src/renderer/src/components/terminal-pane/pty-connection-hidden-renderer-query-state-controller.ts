export function createPtyConnectionHiddenRendererQueryStateController() {
  let pending = ''
  let dirty = false

  return {
    getPending(): string {
      return pending
    },
    setPending(nextPending: string): void {
      pending = nextPending
    },
    takePending(): string {
      const current = pending
      pending = ''
      return current
    },
    isDirty(): boolean {
      return dirty
    },
    markDirty(): void {
      dirty = true
    },
    markClean(): void {
      dirty = false
    },
    reset(): void {
      pending = ''
      dirty = false
    }
  }
}
