// Concrete runtime for pty-transport.ts

// Keep the public transport surface stable while the local transport and output processor evolve independently.
export { createPtyOutputProcessor } from './pty-agent-output-processor'
export {
  MAX_PENDING_PTY_SIDE_EFFECTS,
  MAX_EVICTED_AGENT_STATUS_PAYLOAD_CARRY
} from './pty-agent-output-processor'
export { createIpcPtyTransport } from './pty-ipc-transport'

// Re-export public dispatcher and transport types for existing consumers.
export {
  ensurePtyDispatcher,
  getEagerPtyBufferHandle,
  registerEagerPtyBuffer,
  restorePtyDataHandlersAfterFailedShutdown,
  subscribeToPtyExit,
  unregisterPtyDataHandlers
} from './pty-dispatcher'
export type { EagerPtyHandle } from './pty-dispatcher'
export type {
  IpcPtyTransportOptions,
  LocalPtySessionMetadata,
  PtyBufferSnapshot,
  PtyConnectResult,
  PtyTransport
} from './pty-transport-types'
export { extractLastOscTitle } from '../../../../shared/agent-detection'
