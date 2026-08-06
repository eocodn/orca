import { beforeEach } from 'vitest'
import type { ClientRuntimeHostAdapter } from '../src/renderer/src/runtime/client-runtime'
import {
  registerClientRuntimeAdapter,
  type ClientRuntimeAdapter
} from '../src/renderer/src/runtime/client-runtime-resolver'

const dynamicWindowHost = new Proxy({} as ClientRuntimeHostAdapter, {
  get: (_target, property) => {
    const globals = globalThis as typeof globalThis & {
      window?: { api?: Record<PropertyKey, unknown> }
    }
    const api = globals.window?.api
    if (!api) {
      throw new Error('ClientRuntime test adapter requires window.api.')
    }
    return api[property]
  }
})

const dynamicElectronAdapter: ClientRuntimeAdapter = {
  kind: 'electron',
  host: dynamicWindowHost
}

// Tests stub window.api per case; keep registration explicit while resolving the current stub.
beforeEach(() => registerClientRuntimeAdapter(dynamicElectronAdapter))
