import type { ClientRuntimeHostAdapter } from './client-runtime'
import {
  createCapabilityUnavailableService,
  type ClientRuntimeAdapter
} from './client-runtime-adapter'

/** Tauri stays capability-empty until operations route through ade-host. */
export function createTauriClientRuntimeAdapter(): ClientRuntimeAdapter {
  return {
    kind: 'tauri',
    host: createCapabilityUnavailableService<ClientRuntimeHostAdapter>('tauri')
  }
}
