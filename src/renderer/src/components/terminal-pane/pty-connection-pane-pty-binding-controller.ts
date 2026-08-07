type PtyConnectionPanePtyBindingControllerArgs = {
  now: () => number
  isVisible: () => boolean
  setFitBinding: (ptyId: string) => void
  clearFitBinding: () => void
  reportVisibility: (ptyId: string, visible: boolean) => void
}

export function createPtyConnectionPanePtyBindingController({
  now,
  isVisible,
  setFitBinding,
  clearFitBinding,
  reportVisibility
}: PtyConnectionPanePtyBindingControllerArgs) {
  let ptyId: string | null = null
  let boundAt: number | null = null

  return {
    bind(nextPtyId: string): void {
      if (ptyId && ptyId !== nextPtyId) {
        reportVisibility(ptyId, false)
      }
      setFitBinding(nextPtyId)
      ptyId = nextPtyId
      reportVisibility(nextPtyId, isVisible())
      boundAt = now()
    },
    clear(): void {
      clearFitBinding()
      ptyId = null
      boundAt = null
    },
    getPtyId(): string | null {
      return ptyId
    },
    getBoundAt(): number | null {
      return boundAt
    }
  }
}
