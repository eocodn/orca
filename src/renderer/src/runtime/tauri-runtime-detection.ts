type TauriInternals = {
  invoke?: unknown
}

/** Tauri injects its invoke bridge before loading the frontend bundle. */
export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  const tauriWindow = window as Window & { __TAURI_INTERNALS__?: TauriInternals }
  if (!('__TAURI_INTERNALS__' in tauriWindow)) {
    return false
  }

  const internals = tauriWindow.__TAURI_INTERNALS__
  if (!internals || typeof internals !== 'object' || typeof internals.invoke !== 'function') {
    throw new Error('Tauri runtime marker is present but its invoke bridge is unavailable.')
  }

  return true
}
