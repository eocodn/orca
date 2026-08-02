import { afterEach, describe, expect, it } from 'vitest'

import { setSystemCodexHomeHookSweepSuppressed } from './codex-hook-support-a'
import { cleanupLegacySystemManagedHooks } from './codex-hook-support-b'

describe('Codex hook support split API', () => {
  afterEach(() => {
    setSystemCodexHomeHookSweepSuppressed(() => false)
  })

  it('exposes the sweep gate consumed by legacy cleanup', () => {
    expect(() => {
      setSystemCodexHomeHookSweepSuppressed(() => true)
      cleanupLegacySystemManagedHooks()
    }).not.toThrow()
  })
})
