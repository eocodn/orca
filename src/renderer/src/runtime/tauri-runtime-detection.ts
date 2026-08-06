type TauriInternals = {
  invoke?: unknown
}

/** Tauri injects its invoke bridge before loading the frontend bundle. */
export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  const internals = (window as Window & { __TAURI_INTERNALS__?: TauriInternals })
    .__TAURI_INTERNALS__
  return typeof internals?.invoke === 'function'
}
