import {
  ptyDataHandlers,
  ptyReplayHandlers,
  drainRolledBackPtyShutdownData,
  ptyExitHandlers,
  ptyTeardownHandlers,
  ptyShutdownLifecycleHandlers,
  ptyWriteUnavailableHandlers,
  getActivePtyIncarnation,
  isPtyDataHandlerShutdownPending
} from './pty-dispatcher'
import type { PtyDataMeta } from './pty-dispatcher'
import {
  drainPreHandlerPtyData,
  drainPreHandlerPtyExit,
  hasPreHandlerPtyExit
} from './pty-pre-handler-buffer'
import type { PtyIpcTransportContext } from './pty-ipc-transport-context'

export type PtyIpcTransportHandlers = {
  registerPtyDataHandler: (id: string) => void
  registerPtyExitHandler: (id: string) => boolean
  unregisterPtyHandlers: (id: string) => void
  unregisterPtyDataAndStatusHandlers: (id: string) => void
  clearAccumulatedState: () => void
}

export function createPtyIpcTransportHandlers(
  context: PtyIpcTransportContext
): PtyIpcTransportHandlers {
  const { state, options, outputProcessor } = context
  const ownedDataAndReplayHandlers = new Map<
    string,
    {
      data: (data: string, meta?: PtyDataMeta) => void
      replay: (data: string) => void
      writeUnavailable: () => void
    }
  >()
  const ownedExitHandlers = new Map<string, (code: number) => void>()

  function unregisterPtyDataAndStatusHandlers(id: string): void {
    const owned = ownedDataAndReplayHandlers.get(id)
    if (owned) {
      if (ptyDataHandlers.get(id) === owned.data) {
        ptyDataHandlers.delete(id)
      }
      if (ptyReplayHandlers.get(id) === owned.replay) {
        ptyReplayHandlers.delete(id)
      }
      if (ptyWriteUnavailableHandlers.get(id) === owned.writeUnavailable) {
        ptyWriteUnavailableHandlers.delete(id)
      }
    }
    ownedDataAndReplayHandlers.delete(id)
  }

  function clearAccumulatedState(): void {
    outputProcessor.clearAccumulatedState()
  }

  const shutdownLifecycle = {
    pause: outputProcessor.pausePendingSideEffects,
    rollback: outputProcessor.flushPendingSideEffects,
    commit: clearAccumulatedState
  }

  function unregisterPtyHandlers(id: string): void {
    unregisterPtyDataAndStatusHandlers(id)
    const ownedExit = ownedExitHandlers.get(id)
    if (ownedExit && ptyExitHandlers.get(id) === ownedExit) {
      ptyExitHandlers.delete(id)
    }
    ownedExitHandlers.delete(id)
    if (ptyTeardownHandlers.get(id) === clearAccumulatedState) {
      ptyTeardownHandlers.delete(id)
    }
    if (ptyShutdownLifecycleHandlers.get(id) === shutdownLifecycle) {
      ptyShutdownLifecycleHandlers.delete(id)
    }
  }

  function registerPtyDataHandler(id: string): void {
    const registeredIncarnationId = getActivePtyIncarnation(id)
    const acceptsIncarnation = (incarnationId?: string): boolean =>
      registeredIncarnationId === undefined || registeredIncarnationId === incarnationId
    // Route replay through its callback so xterm query replies cannot leak into stdin.
    const replayHandler = (data: string, incarnationId?: string): void => {
      if (!acceptsIncarnation(incarnationId) || state.ptyId !== id) return
      if (state.callbacks.onReplayData) {
        state.callbacks.onReplayData(data)
      } else {
        state.callbacks.onData?.(data)
      }
    }
    ptyReplayHandlers.set(id, replayHandler)
    const dataHandler = (data: string, meta?: PtyDataMeta): void => {
      if (!acceptsIncarnation(meta?.incarnationId) || state.ptyId !== id) return
      outputProcessor.processData(
        data,
        state.callbacks,
        { suppressAttentionEvents: state.suppressAttentionEvents },
        meta
      )
    }
    ptyDataHandlers.set(id, dataHandler)
    const writeUnavailable = (): void => {
      if (state.ptyId === id) {
        state.callbacks.onWriteUnavailable?.()
      }
    }
    ptyWriteUnavailableHandlers.set(id, writeUnavailable)
    ownedDataAndReplayHandlers.set(id, {
      data: dataHandler,
      replay: replayHandler,
      writeUnavailable
    })
    if (!isPtyDataHandlerShutdownPending(id)) {
      drainPreHandlerPtyData(id, dataHandler)
      drainRolledBackPtyShutdownData(id)
    }
  }

  function registerPtyExitHandler(id: string): boolean {
    const hadBufferedExit = hasPreHandlerPtyExit(id)
    const registeredIncarnationId = getActivePtyIncarnation(id)
    let deliveredBufferedExit = false
    const exitHandler = (code: number, incarnationId?: string): void => {
      if (
        registeredIncarnationId !== undefined &&
        registeredIncarnationId !== incarnationId
      ) {
        return
      }
      deliveredBufferedExit = true
      if (state.ptyId !== null && state.ptyId !== id) {
        unregisterPtyHandlers(id)
        return
      }
      clearAccumulatedState()
      state.connected = false
      state.ptyId = null
      unregisterPtyHandlers(id)
      state.callbacks.onExit?.(code)
      state.callbacks.onDisconnect?.()
      options.onPtyExit?.(id)
    }
    ptyExitHandlers.set(id, exitHandler)
    ownedExitHandlers.set(id, exitHandler)
    ptyTeardownHandlers.set(id, clearAccumulatedState)
    ptyShutdownLifecycleHandlers.set(id, shutdownLifecycle)
    try {
      drainPreHandlerPtyExit(id, exitHandler)
    } catch (error) {
      if (!hadBufferedExit) throw error
      console.error('[pty] buffered pre-attach exit cleanup failed', error)
    }
    return hadBufferedExit && deliveredBufferedExit
  }

  return {
    registerPtyDataHandler,
    registerPtyExitHandler,
    unregisterPtyHandlers,
    unregisterPtyDataAndStatusHandlers,
    clearAccumulatedState
  }
}
