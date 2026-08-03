import { describe, expect, it, vi } from 'vitest'
import type { IPtyProvider } from '../providers/types'
import { shutdownDegradedFallbackSessions } from './degraded-daemon-fallback-shutdown'

describe('shutdownDegradedFallbackSessions', () => {
  it('retires a failed shutdown only after authoritative liveness says the PTY is gone', async () => {
    const fallback = {
      shutdown: vi.fn(async () => {
        throw new Error('kill rejected')
      }),
      probePtyLiveness: vi.fn(async () => false)
    } as unknown as IPtyProvider
    const sessionProviders = new Map([['fallback-pty', fallback]])

    await expect(
      shutdownDegradedFallbackSessions(sessionProviders, fallback, () => 'fallback-incarnation')
    ).resolves.toEqual({
      killedCount: 1,
      retired: [{ id: 'fallback-pty', incarnationId: 'fallback-incarnation' }],
      retryable: []
    })
    expect(sessionProviders.has('fallback-pty')).toBe(false)
  })

  it('returns a failed live PTY as retryable instead of claiming it was retired', async () => {
    const fallback = {
      shutdown: vi.fn(async () => {
        throw new Error('still alive')
      }),
      probePtyLiveness: vi.fn(async () => true)
    } as unknown as IPtyProvider
    const sessionProviders = new Map([['fallback-pty', fallback]])

    await expect(
      shutdownDegradedFallbackSessions(sessionProviders, fallback, () => 'fallback-incarnation')
    ).resolves.toEqual({
      killedCount: 0,
      retired: [],
      retryable: [{ id: 'fallback-pty', incarnationId: 'fallback-incarnation' }]
    })
    expect(sessionProviders.get('fallback-pty')).toBe(fallback)
  })
})
