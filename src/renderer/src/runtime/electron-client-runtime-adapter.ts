import type { PreloadApi } from '../../../preload/api-preload-surface'
import type { ClientRuntimeAdapter } from './client-runtime-adapter'

export function createElectronClientRuntimeAdapter(api: PreloadApi): ClientRuntimeAdapter {
  return { kind: 'electron', host: api }
}
