import { describe, expect, it } from 'vitest'
import { isDaemonChildSurviving } from './windows-daemon-workspace-close-repro.mjs'

describe('windows daemon workspace-close survivor assertion', () => {
  it('rejects a child with a signal code even when its exit code is null', () => {
    expect(
      isDaemonChildSurviving({
        exitCode: null,
        signalCode: 'SIGTERM'
      })
    ).toBe(false)
  })
})
