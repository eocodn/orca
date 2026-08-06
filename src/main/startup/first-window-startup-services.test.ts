import { describe, expect, it, vi } from 'vitest'
import {
  FIRST_WINDOW_STARTUP_SERVICE_TIMEOUT_MS,
  LOCAL_PTY_STARTUP_FAIL_OPEN_TIMEOUT_MS,
  startFirstWindowStartupServices
} from './first-window-startup-services'

describe('startFirstWindowStartupServices', () => {
  it('starts the daemon before awaiting the startup gates', async () => {
    const events: string[] = []
    let resolveDaemon!: () => void

    const started = startFirstWindowStartupServices({
      startDaemonPtyProvider: () =>
        new Promise<void>((resolve) => {
          events.push('daemon-started')
          resolveDaemon = resolve
        }),
      onDaemonError: vi.fn()
    })

    await Promise.resolve()
    expect(events).toEqual(['daemon-started'])

    let completed = false
    started.firstWindowReady.then(() => {
      completed = true
    })

    resolveDaemon()
    await started.firstWindowReady
    await started.localPtyReady
    await started.localPtyProviderReady
    expect(completed).toBe(true)
  })

  it('opens both PTY gates when daemon startup finishes', async () => {
    let resolveDaemon!: () => void
    const started = startFirstWindowStartupServices({
      startDaemonPtyProvider: () =>
        new Promise<void>((resolve) => {
          resolveDaemon = resolve
        }),
      onDaemonError: vi.fn()
    })
    await Promise.resolve()

    let ptyGateOpened = false
    void started.localPtyReady.then(() => {
      ptyGateOpened = true
    })
    resolveDaemon()
    await expect(started.localPtyReady).resolves.toBeUndefined()
    await expect(started.localPtyProviderReady).resolves.toBeUndefined()
    expect(ptyGateOpened).toBe(true)
  })

  it('logs a daemon failure and still resolves the startup barriers', async () => {
    const onDaemonError = vi.fn()
    const started = startFirstWindowStartupServices({
      startDaemonPtyProvider: () => Promise.reject(new Error('daemon failed')),
      onDaemonError
    })

    await expect(started.firstWindowReady).resolves.toBeUndefined()
    await expect(started.localPtyReady).resolves.toBeUndefined()
    await expect(started.localPtyProviderReady).resolves.toBeUndefined()
    expect(onDaemonError).toHaveBeenCalledWith(expect.any(Error))
  })

  it('logs a synchronous daemon startup failure and still resolves the barriers', async () => {
    const onDaemonError = vi.fn()
    const started = startFirstWindowStartupServices({
      startDaemonPtyProvider: () => {
        throw new Error('daemon sync failed')
      },
      onDaemonError
    })

    await expect(started.firstWindowReady).resolves.toBeUndefined()
    await expect(started.localPtyReady).resolves.toBeUndefined()
    await expect(started.localPtyProviderReady).resolves.toBeUndefined()
    expect(onDaemonError).toHaveBeenCalledWith(expect.any(Error))
  })

  it('opens the first window at the window timeout without aborting a slow daemon or opening the PTY gate', async () => {
    vi.useFakeTimers()
    const onDaemonError = vi.fn()
    let daemonSignal: AbortSignal | undefined
    let resolveDaemon!: () => void

    try {
      const started = startFirstWindowStartupServices({
        startDaemonPtyProvider: (signal) => {
          daemonSignal = signal
          return new Promise<void>((resolve) => {
            resolveDaemon = resolve
          })
        },
        onDaemonError
      })

      let ptyGateOpened = false
      void started.localPtyReady.then(() => {
        ptyGateOpened = true
      })

      await vi.advanceTimersByTimeAsync(FIRST_WINDOW_STARTUP_SERVICE_TIMEOUT_MS)
      await expect(started.firstWindowReady).resolves.toBeUndefined()
      expect(ptyGateOpened).toBe(false)
      expect(daemonSignal?.aborted).toBe(false)
      expect(onDaemonError).not.toHaveBeenCalled()

      resolveDaemon()
      await expect(started.localPtyReady).resolves.toBeUndefined()
      await expect(started.localPtyProviderReady).resolves.toBeUndefined()
      expect(daemonSignal?.aborted).toBe(false)
      expect(onDaemonError).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails open the local PTY gates at the hard cap while aborting a hung daemon', async () => {
    vi.useFakeTimers()
    const onDaemonError = vi.fn()
    let daemonSignal: AbortSignal | undefined

    try {
      const started = startFirstWindowStartupServices({
        startDaemonPtyProvider: (signal) => {
          daemonSignal = signal
          return new Promise<void>(() => {})
        },
        onDaemonError
      })

      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(LOCAL_PTY_STARTUP_FAIL_OPEN_TIMEOUT_MS)
      await expect(started.firstWindowReady).resolves.toBeUndefined()
      await expect(started.localPtyReady).resolves.toBeUndefined()
      await expect(started.localPtyProviderReady).resolves.toBeUndefined()
      expect(onDaemonError).toHaveBeenCalledWith(expect.any(Error))
      expect(daemonSignal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
