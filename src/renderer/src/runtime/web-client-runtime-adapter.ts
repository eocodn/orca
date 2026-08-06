import type { PreloadApi } from '../../../preload/api-preload-surface'
import type { ClientRuntimeAdapter } from './client-runtime-adapter'

export function createWebClientRuntimeAdapter(api: PreloadApi): ClientRuntimeAdapter {
  return { kind: 'web', host: api }
}
