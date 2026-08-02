import {
  isTerminalInputTooLargeWithDeferredMeasurement,
  iterateTerminalInputChunks
} from '../../../../shared/terminal-input'
import type { RuntimeTerminalSend } from '../../../../shared/runtime-types'
import type { RemoteRuntimePtyTransportContext } from './remote-runtime-pty-transport-session-context'

export function installRemoteRuntimePtyIo(
  context: RemoteRuntimePtyTransportContext
): void {
  context.recoveryBlocksIo = () => context.recovery.isActive || context.recovery.currentPhase === 'disconnected'
  context.sendInputAcceptedToRuntime = async (data) => {
    const targetHandle = context.handle
    if (!context.connected || !targetHandle || context.recoveryBlocksIo()) return false
    if (!data) return true
    await context.inputBatcher.drain()
    if (!context.connected || context.handle !== targetHandle || context.recoveryBlocksIo()) return false
    if (context.pendingViewportClaim && !context.getCurrentMultiplexedStream(targetHandle)) {
      const ready = await new Promise<boolean>((resolve) => {
        context.viewportClaimReadyWaiters.add(resolve)
      })
      if (!ready || !context.connected || context.handle !== targetHandle) return false
    }
    const text = `${context.inputBatcher.takePending()}${data}`
    try {
      const tooLarge = isTerminalInputTooLargeWithDeferredMeasurement(text)
      if (typeof tooLarge === 'boolean' ? tooLarge : await tooLarge) return false
    } catch {
      return false
    }
    try {
      for (const chunk of iterateTerminalInputChunks(text)) {
        if (!context.connected || context.handle !== targetHandle || context.recoveryBlocksIo()) return false
        const result = await context.callRuntime<{ send: RuntimeTerminalSend }>('terminal.send', {
          terminal: targetHandle,
          text: chunk,
          client: { id: context.clientId, type: 'desktop' },
          ...(context.desiredViewport
            ? { viewport: context.desiredViewport, claimViewport: true as const }
            : {})
        })
        if (result.send.accepted !== true) return false
      }
      return true
    } catch (error) {
      context.handleRemoteTerminalError(error)
      return false
    }
  }
  context.sendViewportUpdate = (cols, rows, claim = false) => {
    const targetHandle = context.handle
    if (!context.connected || !targetHandle || context.recoveryBlocksIo()) return
    const stream = context.getCurrentMultiplexedStream(targetHandle)
    if (claim ? stream?.claimViewport(cols, rows) : stream?.resize(cols, rows)) {
      if (claim) context.pendingViewportClaim = false
      return
    }
    if (claim) context.pendingViewportClaim = true
    void context
      .callRuntime('terminal.updateViewport', {
        terminal: targetHandle,
        client: { id: context.clientId, type: 'desktop' },
        viewport: { cols, rows },
        ...(claim ? { claim: true } : {})
      })
      .catch(() => {})
  }
  context.rememberViewport = (cols, rows) => {
    context.desiredViewport = { cols, rows }
  }
}
