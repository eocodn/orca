import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import { isRecoverableRemoteRuntimeConnectionError } from '../../../shared/remote-runtime-client-error-classification'
import {
  TerminalStreamOpcode,
  decodeTerminalStreamFrame,
  decodeTerminalStreamJson,
  decodeTerminalStreamText,
  encodeTerminalStreamFrame,
  encodeTerminalStreamJson,
  encodeTerminalStreamText
} from '../../../shared/terminal-stream-protocol'
import { e2eConfig, e2eDisableRemoteTerminalStallRecovery } from '@/lib/e2e-config'
import { recordRendererCrashBreadcrumb } from '@/lib/crash-breadcrumb-recorder'
import { deliverTerminalDataWithDeferredCredit } from '@/lib/pane-manager/terminal-delivery-credit'
import { unwrapRuntimeRpcResult } from './runtime-rpc-client'
import { getRuntimeEnvironmentRevision } from './runtime-environment-revision'
import {
  TERMINAL_MULTIPLEX_ACK_BATCH_BYTES,
  TERMINAL_MULTIPLEX_ACK_FLUSH_MS,
  TERMINAL_MULTIPLEX_STREAM_LIMIT_ERROR
} from '../../../shared/terminal-multiplex-flow-control'
import {
  createRemoteTerminalStreamWatchdog,
  type RemoteTerminalStreamWatchdog
} from './remote-terminal-stream-watchdog'
import type { RemoteRuntimeMultiplexedTerminalState } from './remote-runtime-terminal-stream'
import { multiplexers } from './remote-runtime-terminal-stream'

export type E2eRemoteTerminalMultiplexAckGateSnapshot = {
  droppedOutputBytes: number
  droppedOutputFrames: number
  heldTerminalCount: number
  heldStreamCount: number
  heldAckChars: number
  releasedAckChars: number
}

export type E2eRemoteTerminalMultiplexAckGateApi = {
  dropOutputUntilResubscribe: (terminals: string[]) => number
  hold: (terminals: string[]) => void
  release: () => void
  sendInput: (terminal: string, text: string) => number
  snapshot: () => E2eRemoteTerminalMultiplexAckGateSnapshot
}

export type E2eRemoteTerminalMultiplexAckGateWindow = Window & {
  __remoteTerminalMultiplexAckGate?: E2eRemoteTerminalMultiplexAckGateApi
}

export const e2eHeldRemoteAckTerminals = new Set<string>()
export const e2eDroppedOutputStreams = new Set<RemoteRuntimeMultiplexedTerminalState>()
export let e2eDroppedOutputBytes = 0
export let e2eDroppedOutputFrames = 0
export let e2eReleasedRemoteAckChars = 0

export function shouldHoldE2eRemoteTerminalAck(terminal: string): boolean {
  return e2eConfig.exposeStore && e2eHeldRemoteAckTerminals.has(terminal)
}

export function getE2eRemoteAckSnapshot(): E2eRemoteTerminalMultiplexAckGateSnapshot {
  let heldStreamCount = 0
  let heldAckChars = 0
  for (const multiplexer of multiplexers.values()) {
    for (const stream of multiplexer.getStreamsForE2e()) {
      if (stream.heldAckBytes > 0) {
        heldStreamCount += 1
        heldAckChars += stream.heldAckBytes
      }
    }
  }
  return {
    droppedOutputBytes: e2eDroppedOutputBytes,
    droppedOutputFrames: e2eDroppedOutputFrames,
    heldTerminalCount: e2eHeldRemoteAckTerminals.size,
    heldStreamCount,
    heldAckChars,
    releasedAckChars: e2eReleasedRemoteAckChars
  }
}

export function releaseE2eRemoteTerminalAcks(): void {
  for (const multiplexer of multiplexers.values()) {
    e2eReleasedRemoteAckChars += multiplexer.releaseHeldAcksForE2e()
  }
  e2eHeldRemoteAckTerminals.clear()
}

export function resetE2eDroppedRemoteOutput(): void {
  e2eDroppedOutputStreams.clear()
  e2eDroppedOutputBytes = 0
  e2eDroppedOutputFrames = 0
}

export function shouldDropE2eRemoteTerminalOutput(
  stream: RemoteRuntimeMultiplexedTerminalState,
  bytes: number
): boolean {
  if (!e2eConfig.exposeStore || !e2eDroppedOutputStreams.has(stream)) {
    return false
  }
  e2eDroppedOutputBytes += bytes
  e2eDroppedOutputFrames += 1
  return true
}

export function exposeE2eRemoteTerminalMultiplexAckGate(): void {
  if (!e2eConfig.exposeStore || typeof window === 'undefined') {
    return
  }
  const target = window as E2eRemoteTerminalMultiplexAckGateWindow
  target.__remoteTerminalMultiplexAckGate ??= {
    dropOutputUntilResubscribe: (terminals) => {
      resetE2eDroppedRemoteOutput()
      const targets = new Set(terminals)
      for (const multiplexer of multiplexers.values()) {
        for (const stream of multiplexer.getStreamsForE2e()) {
          if (targets.has(stream.terminal)) {
            e2eDroppedOutputStreams.add(stream)
          }
        }
      }
      return e2eDroppedOutputStreams.size
    },
    hold: (terminals) => {
      releaseE2eRemoteTerminalAcks()
      for (const terminal of terminals) {
        e2eHeldRemoteAckTerminals.add(terminal)
      }
    },
    release: () => {
      releaseE2eRemoteTerminalAcks()
      resetE2eDroppedRemoteOutput()
    },
    sendInput: (terminal, value) => {
      let sent = 0
      for (const multiplexer of multiplexers.values()) {
        sent += multiplexer.sendInputForE2e(terminal, value)
      }
      return sent
    },
    snapshot: getE2eRemoteAckSnapshot
  }
}

export function resetE2eRemoteTerminalMultiplexersState(): void {
  e2eHeldRemoteAckTerminals.clear()
  resetE2eDroppedRemoteOutput()
  e2eReleasedRemoteAckChars = 0
}
