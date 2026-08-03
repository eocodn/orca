import { createPtyInputWriteQueue } from './pty-input-write-queue'
import { createPtyOutputProcessor } from './pty-agent-output-processor'
import type { IpcPtyTransportOptions, PtyTransport } from './pty-transport-types'
import { writeAcceptedPtyInput } from './pty-ipc-input-writer'
import { createTerminalInputDelivery } from './terminal-input-delivery'

export type PtyIpcCallbacks = Parameters<PtyTransport['connect']>[0]['callbacks']

export type PtyIpcTransportState = {
  connected: boolean
  destroyed: boolean
  ptyId: string | null
  suppressAttentionEvents: boolean
  callbacks: PtyIpcCallbacks
}

export type PtyIpcTransportContext = {
  options: IpcPtyTransportOptions
  state: PtyIpcTransportState
  inputWriteQueue: ReturnType<typeof createPtyInputWriteQueue>
  terminalInputDelivery: ReturnType<typeof createTerminalInputDelivery>
  outputProcessor: ReturnType<typeof createPtyOutputProcessor>
}

export function createPtyIpcTransportContext(
  options: IpcPtyTransportOptions
): PtyIpcTransportContext {
  const state: PtyIpcTransportState = {
    connected: false,
    destroyed: false,
    ptyId: null,
    // Replayed eager-buffer bytes must not produce fresh attention events.
    suppressAttentionEvents: false,
    callbacks: {}
  }
  const inputWriteQueue = createPtyInputWriteQueue({
    isWritable: (id) => state.connected && state.ptyId === id,
    write: (id, data) => window.api.pty.write(id, data)
  })
  const terminalInputDelivery = createTerminalInputDelivery({
    tabId: options.tabId,
    sendInput: (data) => {
      if (!state.connected || !state.ptyId) return false
      return inputWriteQueue.enqueue(state.ptyId, data)
    },
    sendInputImmediate: (data) => {
      if (!state.connected || !state.ptyId) return false
      return inputWriteQueue.enqueue(state.ptyId, data)
    },
    ...(options.connectionId
      ? {}
      : {
          sendInputAccepted: async (data: string): Promise<boolean> => {
            if (!state.connected || !state.ptyId) return false
            const id = state.ptyId
            await inputWriteQueue.waitForDrain()
            if (!state.connected || state.ptyId !== id) return false
            return writeAcceptedPtyInput({
              id,
              data,
              isCurrent: () => state.connected && state.ptyId === id,
              write: (writeId, chunk) => window.api.pty.writeAccepted(writeId, chunk)
            })
          }
        })
  })
  const outputProcessor = createPtyOutputProcessor({
    onTitleChange: options.onTitleChange,
    onBell: options.onBell,
    onAgentBecameIdle: (title) => {
      if (!state.suppressAttentionEvents) {
        options.onAgentBecameIdle?.(title)
      }
    },
    onAgentBecameWorking: options.onAgentBecameWorking,
    onAgentExited: options.onAgentExited,
    onAgentStatus: options.onAgentStatus
  })

  return { options, state, inputWriteQueue, terminalInputDelivery, outputProcessor }
}
