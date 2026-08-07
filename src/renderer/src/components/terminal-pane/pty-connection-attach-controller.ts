import { isRemoteRuntimePtyId } from './pty-connection-routing-policy'
import type { PtyTransport } from './pty-transport'

type CapturedTransportOutputCallbacks = {
  generation: number
  callbacks: Parameters<PtyTransport['attach']>[0]['callbacks']
}

type ActivePanePtyBindingOptions = {
  updateTabPtyId?: 'always' | 'if-missing'
  sampleVisibleForegroundAgent?: boolean
}

type PtyConnectionAttachControllerArgs = {
  transport: PtyTransport
  cols: number
  rows: number
  clearPaneMode2031State: () => void
  clearHiddenOutputRestoreState: () => void
  captureTransportOutputCallbacks: (
    onError: (message: string) => void
  ) => CapturedTransportOutputCallbacks
  reportError: (message: string) => void
  bindActivePanePty: (ptyId: string, options: ActivePanePtyBindingOptions) => void
  registerPaneSerializerFor: (ptyId: string) => void
}

export function createPtyConnectionAttachController({
  transport,
  cols,
  rows,
  clearPaneMode2031State,
  clearHiddenOutputRestoreState,
  captureTransportOutputCallbacks,
  reportError,
  bindActivePanePty,
  registerPaneSerializerFor
}: PtyConnectionAttachControllerArgs) {
  const attach = (
    ptyId: string,
    options: {
      includeDimensions: boolean
      registerSerializer: 'never' | 'remote' | 'always'
    }
  ): boolean => {
    try {
      clearPaneMode2031State()
      clearHiddenOutputRestoreState()
      const outputCallbacks = captureTransportOutputCallbacks(reportError)
      transport.attach({
        existingPtyId: ptyId,
        ...(options.includeDimensions ? { cols, rows } : {}),
        callbacks: outputCallbacks.callbacks
      })
      const attachedPtyId = transport.getPtyId() ?? ptyId
      bindActivePanePty(attachedPtyId, {
        updateTabPtyId: 'if-missing',
        sampleVisibleForegroundAgent: true
      })
      if (
        options.registerSerializer === 'always' ||
        (options.registerSerializer === 'remote' && isRemoteRuntimePtyId(attachedPtyId))
      ) {
        registerPaneSerializerFor(attachedPtyId)
      }
      return true
    } catch (error) {
      reportError(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  return {
    attachRetainedLegacyPty: (ptyId: string): boolean =>
      attach(ptyId, { includeDimensions: false, registerSerializer: 'remote' }),
    attachDetachedPty: (ptyId: string, eager: boolean): boolean =>
      attach(ptyId, {
        includeDimensions: true,
        registerSerializer: eager ? 'always' : 'remote'
      }),
    adoptPendingSpawn: (ptyId: string): boolean =>
      attach(ptyId, { includeDimensions: true, registerSerializer: 'never' })
  }
}
