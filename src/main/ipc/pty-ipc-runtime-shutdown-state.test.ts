import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ptyRuntimeState } from './pty-ipc-runtime-state'

const { clearProviderPtyStateMock, markClaudePtyExitedMock } = vi.hoisted(() => ({
  clearProviderPtyStateMock: vi.fn(),
  markClaudePtyExitedMock: vi.fn()
}))

vi.mock('./pty-ipc-runtime-provider-lifecycle-state', () => ({
  clearProviderPtyState: clearProviderPtyStateMock
}))
vi.mock('../claude-accounts/live-pty-gate', () => ({
  markClaudePtyExited: markClaudePtyExitedMock
}))

const PTY_ID = 'shutdown-provider-fence'

describe('pty shutdown state', () => {
  beforeEach(() => {
    ptyRuntimeState.localProvider = {} as never
    ptyRuntimeState.ptyOwnership.clear()
    ptyRuntimeState.ptyIncarnationById.clear()
    ptyRuntimeState.ptyStateTokenById.clear()
    ptyRuntimeState.ptyOwnership.set(PTY_ID, null)
    clearProviderPtyStateMock.mockReset()
    markClaudePtyExitedMock.mockReset()
  })

  it('does not finish an old provider target after the provider is replaced', async () => {
    const { capturePtyShutdownTarget, finishPtyShutdown, isPtyShutdownTargetCurrent } = await import(
      './pty-ipc-runtime-shutdown-state'
    )
    const oldProvider = {}
    const replacementProvider = {}
    ptyRuntimeState.localProvider = oldProvider as never

    const target = capturePtyShutdownTarget(PTY_ID, oldProvider as never)
    ptyRuntimeState.localProvider = replacementProvider as never

    expect(isPtyShutdownTargetCurrent(PTY_ID, target)).toBe(false)
    expect(finishPtyShutdown(PTY_ID, null, undefined, target)).toBeUndefined()
    expect(clearProviderPtyStateMock).not.toHaveBeenCalled()
  })
})
