import type { PreloadApi } from '../../../preload/api-preload-surface'
import type { ClientRuntimeHostAdapter } from './client-runtime'

export type ClientRuntimeAdapterKind = 'electron' | 'web' | 'tauri'

export type ClientRuntimeAdapter = {
  kind: ClientRuntimeAdapterKind
  host: ClientRuntimeHostAdapter
}

export class ClientRuntimeCapabilityUnavailableError extends Error {
  readonly code = 'capability_unavailable' as const

  constructor(
    readonly capability: string,
    readonly runtime: ClientRuntimeAdapterKind,
    method?: string
  ) {
    super(
      `[capability_unavailable] ${runtime} ClientRuntime capability is unavailable: ${method ? `${capability}.${method}` : capability}`
    )
    this.name = 'ClientRuntimeCapabilityUnavailableError'
  }
}

/** Tauri's unwired capabilities fail explicitly rather than pretending success. */
export function createCapabilityUnavailableService<T>(
  capability: string,
  runtime: ClientRuntimeAdapterKind = 'tauri'
): T {
  const createProxy = (path = ''): unknown => {
    const unavailable = () => {
      throw new ClientRuntimeCapabilityUnavailableError(capability, runtime, path || undefined)
    }
    return new Proxy(unavailable, {
      apply: unavailable,
      get: (_target, property) => {
        if (property === 'then') return undefined
        return createProxy(path ? `${path}.${String(property)}` : String(property))
      }
    })
  }
  return createProxy(capability) as T
}

export type ClientRuntimePreloadApi = PreloadApi
