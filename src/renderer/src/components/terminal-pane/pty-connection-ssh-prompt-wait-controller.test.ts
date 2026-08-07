import { describe, expect, it } from 'vitest'
import { waitForUserInitiatedSshConnect } from './pty-connection-ssh-prompt-wait-controller'

const outcomeForStatus = (status: string | undefined, sawNonDisconnected: boolean) => {
  if (status === 'connected') {
    return 'connected' as const
  }
  if (status === 'auth-failed' || status === 'error' || status === 'reconnection-failed') {
    return 'failed' as const
  }
  return sawNonDisconnected && status === 'disconnected' ? ('cancelled' as const) : null
}

function createStatusSource(initialStatus: string | undefined) {
  let status = initialStatus
  const listeners = new Set<() => void>()
  return {
    getStatus: () => status,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setStatus: (nextStatus: string | undefined) => {
      status = nextStatus
      for (const listener of listeners) {
        listener()
      }
    },
    listenerCount: () => listeners.size
  }
}

describe('waitForUserInitiatedSshConnect', () => {
  it('does not treat the entry-time disconnected state as cancellation', async () => {
    const source = createStatusSource('disconnected')
    const teardowns: (() => void)[] = []
    const result = waitForUserInitiatedSshConnect({
      getStatus: source.getStatus,
      subscribe: source.subscribe,
      isDisposed: () => false,
      waitTeardowns: teardowns,
      outcomeForStatus
    })

    expect(source.listenerCount()).toBe(1)
    expect(teardowns).toHaveLength(1)
    source.setStatus('connected')

    await expect(result).resolves.toBe('connected')
    expect(source.listenerCount()).toBe(0)
    expect(teardowns).toHaveLength(0)
  })

  it('resolves terminal connection failures', async () => {
    const source = createStatusSource('connecting')
    const result = waitForUserInitiatedSshConnect({
      getStatus: source.getStatus,
      subscribe: source.subscribe,
      isDisposed: () => false,
      waitTeardowns: [],
      outcomeForStatus
    })

    source.setStatus('auth-failed')
    await expect(result).resolves.toBe('failed')
  })

  it('cancels through the registered dispose teardown', async () => {
    const source = createStatusSource('disconnected')
    const teardowns: (() => void)[] = []
    const result = waitForUserInitiatedSshConnect({
      getStatus: source.getStatus,
      subscribe: source.subscribe,
      isDisposed: () => false,
      waitTeardowns: teardowns,
      outcomeForStatus
    })

    teardowns[0]?.()

    await expect(result).resolves.toBe('cancelled')
    expect(source.listenerCount()).toBe(0)
    expect(teardowns).toHaveLength(0)
  })

  it('catches a connecting transition that lands during subscription setup', async () => {
    let status: string | undefined = 'disconnected'
    let listener: (() => void) | null = null
    const result = waitForUserInitiatedSshConnect({
      getStatus: () => status,
      subscribe: (nextListener) => {
        listener = nextListener
        status = 'connecting'
        return () => {
          listener = null
        }
      },
      isDisposed: () => false,
      waitTeardowns: [],
      outcomeForStatus
    })

    status = 'disconnected'
    listener?.()

    await expect(result).resolves.toBe('cancelled')
  })

  it('cancels immediately when the pane is already disposed', async () => {
    const source = createStatusSource('connecting')
    const result = waitForUserInitiatedSshConnect({
      getStatus: source.getStatus,
      subscribe: source.subscribe,
      isDisposed: () => true,
      waitTeardowns: [],
      outcomeForStatus
    })

    await expect(result).resolves.toBe('cancelled')
    expect(source.listenerCount()).toBe(0)
  })
})
