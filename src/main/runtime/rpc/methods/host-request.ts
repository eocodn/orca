import { z } from 'zod'
import { validateHostTerminalRequest } from '../../../../shared/host-protocol'
import { defineMethod, InvalidArgumentError, type RpcMethod } from '../core'
import { HostTerminalStateRegistry } from '../host-terminal-state-registry'
import type { OrcaRuntimeService } from '../../orca-runtime'

const HOST_REQUEST_PARAMS = z.unknown()
const terminalRegistries = new WeakMap<OrcaRuntimeService, HostTerminalStateRegistry>()

export const HOST_REQUEST_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'host.request',
    params: HOST_REQUEST_PARAMS,
    handler: (params, { runtime }) => {
      const validation = validateHostTerminalRequest(params)
      if (!validation.ok) {
        throw new InvalidArgumentError(`Invalid host terminal request: ${validation.reason}`)
      }

      const snapshot = getTerminalRegistry(runtime).apply(validation.request)
      return {
        request_id: validation.request.envelope.request_id,
        capability: 'terminal',
        protocol_version: 1,
        operation: validation.request.operation.type,
        terminal_id: snapshot.terminal_id,
        generation: snapshot.generation,
        status: snapshot.status,
        exit_code: snapshot.exit_code,
        failure_reason: snapshot.failure_reason,
        output_sequence: snapshot.output_sequence,
        tail: snapshot.tail
      }
    }
  })
]

function getTerminalRegistry(runtime: OrcaRuntimeService): HostTerminalStateRegistry {
  let registry = terminalRegistries.get(runtime)
  if (!registry) {
    registry = new HostTerminalStateRegistry()
    terminalRegistries.set(runtime, registry)
  }
  return registry
}
