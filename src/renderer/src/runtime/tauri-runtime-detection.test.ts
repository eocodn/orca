import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTauriRuntime } from './tauri-runtime-detection'

describe('Tauri runtime detection', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('requires the injected Tauri invoke bridge', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke: vi.fn() } })
    expect(isTauriRuntime()).toBe(true)
  })

  it('does not classify ordinary browser globals as Tauri', () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    expect(isTauriRuntime()).toBe(false)
  })
})
