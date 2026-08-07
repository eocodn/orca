const ALTERNATE_SCREEN_REPAINT_COOLDOWN_MS = 100

type PtyConnectionAlternateScreenRepaintControllerArgs = {
  repaint: (ptyId: string) => void
}

export function createPtyConnectionAlternateScreenRepaintController({
  repaint
}: PtyConnectionAlternateScreenRepaintControllerArgs) {
  let timer: ReturnType<typeof setTimeout> | null = null

  const dispose = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  return {
    request(ptyId: string): void {
      if (timer !== null) {
        return
      }
      repaint(ptyId)
      timer = setTimeout(() => {
        timer = null
      }, ALTERNATE_SCREEN_REPAINT_COOLDOWN_MS)
    },
    dispose
  }
}
