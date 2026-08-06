import { createClientRuntime, type ClientRuntime } from './client-runtime'
import type { ClientRuntimeAdapter } from './client-runtime-adapter'

let registeredAdapter: ClientRuntimeAdapter | undefined

export function registerClientRuntimeAdapter(adapter: ClientRuntimeAdapter): void {
  registeredAdapter = adapter
}

export function resolveClientRuntime(adapter: ClientRuntimeAdapter): ClientRuntime {
  return createClientRuntime(adapter.host)
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
