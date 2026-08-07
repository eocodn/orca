import { describe, expect, it, vi } from 'vitest'
import { runPtyConnectionSshPromptAdmission } from './pty-connection-ssh-prompt-admission-controller'

const run = (overrides: Partial<Parameters<typeof runPtyConnectionSshPromptAdmission>[0]> = {}) => {
  const warnProbeFailure = vi.fn()
  const reportError = vi.fn()
  const waitForUserConnect = vi.fn(async () => 'connected' as const)
  const result = runPtyConnectionSshPromptAdmission({
    needsPassphrasePrompt: async () => false,
    isCurrentAuthority: () => true,
    isAlreadyConnected: () => false,
    waitForUserConnect,
    warnProbeFailure,
    reportError,
    ...overrides
  })
  return { result, warnProbeFailure, reportError, waitForUserConnect }
}

describe('runPtyConnectionSshPromptAdmission', () => {
  it('continues without waiting when no prompt is required', async () => {
    const state = run()

    await expect(state.result).resolves.toBe('continue')
    expect(state.waitForUserConnect).not.toHaveBeenCalled()
  })

  it('warns and continues when the prompt probe fails', async () => {
    const error = new Error('probe failed')
    const state = run({
      needsPassphrasePrompt: async () => {
        throw error
      }
    })

    await expect(state.result).resolves.toBe('continue')
    expect(state.warnProbeFailure).toHaveBeenCalledWith(error)
    expect(state.waitForUserConnect).not.toHaveBeenCalled()
  })

  it('continues immediately when another actor already connected', async () => {
    const state = run({
      needsPassphrasePrompt: async () => true,
      isAlreadyConnected: () => true
    })

    await expect(state.result).resolves.toBe('continue')
    expect(state.waitForUserConnect).not.toHaveBeenCalled()
  })

  it('preserves cancelled and failed user-connect outcomes', async () => {
    const cancelled = run({
      needsPassphrasePrompt: async () => true,
      waitForUserConnect: async () => 'cancelled'
    })
    await expect(cancelled.result).resolves.toBe('cancelled')
    expect(cancelled.reportError).not.toHaveBeenCalled()

    const failed = run({
      needsPassphrasePrompt: async () => true,
      waitForUserConnect: async () => 'failed'
    })
    await expect(failed.result).resolves.toBe('failed')
    expect(failed.reportError).toHaveBeenCalledWith('SSH connection failed')
  })

  it('stops when retry authority changes after the probe', async () => {
    const state = run({
      needsPassphrasePrompt: async () => true,
      isCurrentAuthority: () => false
    })

    await expect(state.result).resolves.toBe('stale')
    expect(state.waitForUserConnect).not.toHaveBeenCalled()
  })

  it('stops when retry authority changes while waiting for the user', async () => {
    let current = true
    const state = run({
      needsPassphrasePrompt: async () => true,
      isCurrentAuthority: () => current,
      waitForUserConnect: async () => {
        current = false
        return 'connected'
      }
    })

    await expect(state.result).resolves.toBe('stale')
    expect(state.reportError).not.toHaveBeenCalled()
  })
})
