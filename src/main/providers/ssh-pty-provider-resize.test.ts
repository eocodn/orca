import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SshPtyProvider } from './ssh-pty-provider'

type MockMultiplexer = {
  request: ReturnType<typeof vi.fn>
  notify: ReturnType<typeof vi.fn>
  onNotification: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  isDisposed: ReturnType<typeof vi.fn>
}

function createMockMux(): MockMultiplexer {
  return {
    request: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn(),
    onNotification: vi.fn(),
    dispose: vi.fn(),
    isDisposed: vi.fn().mockReturnValue(false)
  }
}

describe('SshPtyProvider resize authority', () => {
  let mux: MockMultiplexer
  let provider: SshPtyProvider
  const scopedPtyId = 'ssh:conn-1@@pty-1'

  beforeEach(() => {
    mux = createMockMux()
    provider = new SshPtyProvider('conn-1', mux as never)
  })

  it('requests an incarnation-CAS resize from the relay', async () => {
    mux.request.mockResolvedValue({ applied: true })

    await expect(provider.resizeIfCurrent(scopedPtyId, 'incarnation-1', 120, 40)).resolves.toBe(
      true
    )
    expect(mux.request).toHaveBeenCalledWith(
      'pty.resizeIfCurrent',
      { id: 'pty-1', expectedIncarnationId: 'incarnation-1', cols: 120, rows: 40 },
      { timeoutMs: 1_000 }
    )
  })

  it('reads the applied PTY size from the relay', async () => {
    mux.request.mockResolvedValue({ cols: 120, rows: 40 })

    await expect(provider.getAppliedSize(scopedPtyId)).resolves.toEqual({ cols: 120, rows: 40 })
    expect(mux.request).toHaveBeenCalledWith('pty.getSize', { id: 'pty-1' }, { timeoutMs: 1_000 })
  })

  it('caches only an old relay method-not-found response', async () => {
    mux.request.mockRejectedValue(Object.assign(new Error('Method not found'), { code: -32601 }))

    await expect(provider.getAppliedSize(scopedPtyId)).resolves.toBeNull()
    await expect(provider.getAppliedSize(scopedPtyId)).resolves.toBeNull()
    expect(mux.request).toHaveBeenCalledTimes(1)
  })

  it('retries an applied-size read after a transient relay failure', async () => {
    mux.request
      .mockRejectedValueOnce(
        Object.assign(new Error('connection lost'), { code: 'CONNECTION_LOST' })
      )
      .mockResolvedValueOnce({ cols: 100, rows: 30 })

    await expect(provider.getAppliedSize(scopedPtyId)).rejects.toThrow('connection lost')
    await expect(provider.getAppliedSize(scopedPtyId)).resolves.toEqual({ cols: 100, rows: 30 })
    expect(mux.request).toHaveBeenCalledTimes(2)
  })

  it('rejects a malformed applied-size response instead of treating it as unsupported', async () => {
    mux.request.mockResolvedValue({ cols: 'wide', rows: 40 })

    await expect(provider.getAppliedSize(scopedPtyId)).rejects.toThrow(
      'invalid_pty_applied_size_response'
    )
  })
})
