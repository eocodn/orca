import type { PtyIpcTransportContext } from './pty-ipc-transport-context'
import type { PtyIpcTransportHandlers } from './pty-ipc-transport-handlers'
import type { PtyTransport } from './pty-transport-types'
import { getClientRuntime } from '../../runtime/client-runtime'

export function createPtyIpcTransportLifecycle(
  context: PtyIpcTransportContext,
  handlers: PtyIpcTransportHandlers
): Pick<PtyTransport, 'disconnect' | 'detach' | 'destroy'> {
  const { state, inputWriteQueue } = context
  const disconnect = (): void => {
    handlers.clearAccumulatedState()
    inputWriteQueue.clear()
    if (state.ptyId) {
      const id = state.ptyId
      getClientRuntime().terminal.kill(id)
      state.connected = false
      state.ptyId = null
      handlers.unregisterPtyHandlers(id)
      state.callbacks.onDisconnect?.()
    }
  }

  return {
    disconnect,
    detach(detachOptions) {
      handlers.clearAccumulatedState()
      inputWriteQueue.clear()
      if (state.ptyId) {
        if (detachOptions?.preserveExitObserver === false) {
          handlers.unregisterPtyHandlers(state.ptyId)
        } else {
          handlers.unregisterPtyDataAndStatusHandlers(state.ptyId)
        }
      }
      state.connected = false
      state.ptyId = null
      state.callbacks = {}
    },
    destroy() {
      state.destroyed = true
      disconnect()
    }
  }
}
