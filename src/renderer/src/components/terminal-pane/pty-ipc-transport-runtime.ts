import type { IpcPtyTransportOptions, PtyTransport } from './pty-transport-types'
import { createPtyIpcTransportContext } from './pty-ipc-transport-context'
import { createPtyIpcTransportHandlers } from './pty-ipc-transport-handlers'
import { createPtyIpcTransportConnection } from './pty-ipc-transport-connection'
import { createPtyIpcTransportLifecycle } from './pty-ipc-transport-lifecycle'
import { createPtyIpcTransportControls } from './pty-ipc-transport-controls'

export function createIpcPtyTransport(opts: IpcPtyTransportOptions = {}): PtyTransport {
  const context = createPtyIpcTransportContext(opts)
  const handlers = createPtyIpcTransportHandlers(context)
  const connection = createPtyIpcTransportConnection(context, handlers)
  const lifecycle = createPtyIpcTransportLifecycle(context, handlers)
  const controls = createPtyIpcTransportControls(context)

  return {
    ...connection,
    ...lifecycle,
    ...controls,
    ...(opts.connectionId
      ? {}
      : {
          async sendInputAccepted(data: string): Promise<boolean> {
            return context.terminalInputDelivery.sendInputAccepted!(data)
          }
        })
  }
}
