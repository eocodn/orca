import type { PtyIpcTransportContext } from './pty-ipc-transport-context'
import type { PtyTransport } from './pty-transport-types'

export function createPtyIpcTransportControls(
  context: PtyIpcTransportContext
): Pick<
  PtyTransport,
  | 'sendInput'
  | 'sendInputImmediate'
  | 'claimViewport'
  | 'resize'
  | 'isConnected'
  | 'getPtyId'
  | 'getConnectionId'
  | 'getLocalSessionMetadata'
  | 'resetCrossChunkParserState'
> {
  const { options, state, terminalInputDelivery, outputProcessor } = context
  return {
    sendInput(data: string): boolean {
      return terminalInputDelivery.sendInput(data)
    },
    sendInputImmediate(data: string): boolean {
      return terminalInputDelivery.sendInputImmediate(data)
    },
    claimViewport(cols: number, rows: number): boolean {
      if (!state.connected || !state.ptyId) return false
      window.api.pty.claimViewport(state.ptyId, cols, rows)
      return true
    },
    resize(cols: number, rows: number, meta): boolean {
      if (!state.connected || !state.ptyId) return false
      window.api.pty.resize(state.ptyId, cols, rows)
      if (meta?.claim) window.api.pty.claimViewport(state.ptyId, cols, rows)
      return true
    },
    isConnected() {
      return state.connected
    },
    getPtyId() {
      return state.ptyId
    },
    getConnectionId() {
      return options.connectionId ?? null
    },
    getLocalSessionMetadata() {
      if (options.connectionId) return null
      return {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.shellOverride ? { shellOverride: options.shellOverride } : {})
      }
    },
    resetCrossChunkParserState() {
      outputProcessor.resetAgentStatusCarry()
    }
  }
}
