import type { PtyDataMeta } from './pty-dispatcher'

type E2ePtyDataInject = (data: string, meta?: PtyDataMeta) => void

type PtyConnectionE2eDataInjectionControllerArgs = {
  paneKey: string
  register: (paneKey: string, inject: E2ePtyDataInject) => () => void
}

export function createPtyConnectionE2eDataInjectionController({
  paneKey,
  register: registerInjection
}: PtyConnectionE2eDataInjectionControllerArgs) {
  let unregister: (() => void) | null = null

  return {
    register(inject: E2ePtyDataInject): void {
      unregister?.()
      unregister = registerInjection(paneKey, inject)
    },
    dispose(): void {
      unregister?.()
      unregister = null
    }
  }
}
