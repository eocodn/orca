import { describe, expect, it, vi } from 'vitest'
import { runPtyConnectionSshConnectSettlement } from './pty-connection-ssh-connect-settlement-controller'

const run = (
  overrides: Partial<Parameters<typeof runPtyConnectionSshConnectSettlement>[0]> = {}
) => {
  const removeDeferredReconnectTarget = vi.fn()
  const reportError = vi.fn()
  const onConnected = vi.fn()
  const result = runPtyConnectionSshConnectSettlement({
    waitForConnection: async () => ({ connected: true }),
    isCurrentAuthority: () => true,
    isDisposed: () => false,
    removeDeferredReconnectTarget,
    reportError,
    onConnected,
    ...overrides
  })
  return { result, removeDeferredReconnectTarget, reportError, onConnected }
}

describe('runPtyConnectionSshConnectSettlement', () => {
  it('removes deferred reconnect metadata and continues after success', async () => {
    const state = run()

    await expect(state.result).resolves.toBe('connected')
    expect(state.removeDeferredReconnectTarget).toHaveBeenCalledOnce()
    expect(state.onConnected).toHaveBeenCalledOnce()
    expect(state.reportError).not.toHaveBeenCalled()
  })

  it('reports failure without mutating reconnect metadata', async () => {
    const state = run({
      waitForConnection: async () => ({ connected: false, error: 'auth failed' })
    })

    await expect(state.result).resolves.toBe('failed')
    expect(state.reportError).toHaveBeenCalledWith('SSH connection failed: auth failed')
    expect(state.removeDeferredReconnectTarget).not.toHaveBeenCalled()
    expect(state.onConnected).not.toHaveBeenCalled()
  })

  it('ignores a result after direct retry authority changes', async () => {
    const state = run({ isCurrentAuthority: () => false })

    await expect(state.result).resolves.toBe('stale')
    expect(state.removeDeferredReconnectTarget).not.toHaveBeenCalled()
    expect(state.reportError).not.toHaveBeenCalled()
    expect(state.onConnected).not.toHaveBeenCalled()
  })

  it('does not continue when deferred-target removal disposes the pane', async () => {
    let disposed = false
    const state = run({
      isDisposed: () => disposed,
      removeDeferredReconnectTarget: () => {
        disposed = true
      }
    })

    await expect(state.result).resolves.toBe('stale')
    expect(state.onConnected).not.toHaveBeenCalled()
  })
})
