import { createClientRuntime, type ClientRuntime } from './client-runtime'
import type { ClientRuntimeAdapter } from './client-runtime-adapter'
import { createCapabilityUnavailableService } from './client-runtime-adapter'
import type { ClientRuntimeHostService } from './client-runtime-host-services'
import { createClientRuntimeHostService } from './client-runtime-host-services'

let registeredAdapter: ClientRuntimeAdapter | undefined

export function registerClientRuntimeAdapter(adapter: ClientRuntimeAdapter): void {
  registeredAdapter = adapter
}

export function resolveClientRuntime(adapter: ClientRuntimeAdapter): ClientRuntime {
  const unavailableHost = createCapabilityUnavailableService<ClientRuntimeHostService>(
    'host',
    adapter.kind
  )
  const host = adapter.tauriHost ? createClientRuntimeHostService(adapter.tauriHost) : undefined
  return createClientRuntime(adapter.host, unavailableHost, host)
}

export function getRegisteredClientRuntime(): ClientRuntime {
  if (!registeredAdapter) {
    throw new Error('ClientRuntime adapter has not been registered.')
  }
  return resolveClientRuntime(registeredAdapter)
}

export function getRegisteredClientRuntimeKind(): ClientRuntimeAdapter['kind'] {
  if (!registeredAdapter) {
    throw new Error('ClientRuntime adapter has not been registered.')
  }
  return registeredAdapter.kind
}

export function resetClientRuntimeAdapterForTests(): void {
  registeredAdapter = undefined
}
