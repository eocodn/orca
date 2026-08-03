import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteRuntimePtyTransportContext } from './remote-runtime-pty-transport-session-context'
import { installRemoteRuntimePtyHostSessionPane } from './remote-runtime-pty-transport-host-session-pane'
import {
  _resetTerminalInputQuarantineForTests,
  isTerminalInputQuarantined
} from './terminal-input-quarantine'

vi.mock('../../runtime/runtime-rpc-client', () => ({
  RuntimeRpcCallError: class RuntimeRpcCallError extends Error {}
}))
vi.mock('../../runtime/runtime-terminal-stream', () => ({
  runtimeTerminalErrorMessage: (error: unknown) => String(error),
  toRemoteRuntimePtyId: (handle: string, environmentId: string) =>
    `remote:${environmentId}@@${handle}`
}))
vi.mock('../../runtime/runtime-worktree-selector', () => ({
  toRuntimeWorktreeSelector: (worktreeId: string) => worktreeId
}))
vi.mock('@/runtime/remote-runtime-session-tabs-inflight', () => ({
  listRemoteRuntimeSessionTabsDeduped: vi.fn()
}))

const TAB = 'web-session-tab'

beforeEach(() => {
  _resetTerminalInputQuarantineForTests()
})

describe('remote runtime host-session expiry recovery', () => {
  it('clears stale input and arms quarantine before the replacement can receive input', async () => {
    const events: string[] = []
    let handle = 'expired-handle'
    let connected = true
    let quarantineWhenConnected = false
    const inputBatcher = { clear: vi.fn(() => events.push('clear-input')) }
    const subscribeToHandle = vi.fn(async () => {
      events.push('subscribe-replacement')
      expect(isTerminalInputQuarantined(TAB)).toBe(true)
    })
    const context = {
      opts: {
        tabId: TAB,
        leafId: 'leaf-1',
        worktreeId: 'worktree-1',
        onPtyRebind: vi.fn()
      },
      destroyed: false,
      recoveringPaneHandle: null,
      inputBatcher,
      clearPendingViewportClaim: vi.fn(() => events.push('clear-viewport')),
      closeMultiplexedStream: vi.fn(() => events.push('close-old-subscription')),
      callRuntime: vi.fn(async () => {
        events.push('recover-pane')
        return {
          terminal: {
            handle: 'replacement-handle',
            tabId: TAB,
            leafId: 'leaf-1',
            worktreeId: 'worktree-1'
          }
        }
      }),
      currentRuntimeEnvironmentId: 'environment-1',
      adoptExecutionMetadata: vi.fn(),
      remotePtyId: 'remote:expired-handle',
      unregisterShutdownHandlers: vi.fn(() => events.push('unregister-old')),
      registerShutdownHandlers: vi.fn(() => events.push('register-replacement')),
      subscribeToHandle,
      storedCallbacks: {},
      handle,
      connected
    } as unknown as RemoteRuntimePtyTransportContext

    Object.defineProperty(context, 'handle', {
      configurable: true,
      get: () => handle,
      set: (nextHandle: string) => {
        if (nextHandle === 'replacement-handle') events.push('replace-handle')
        handle = nextHandle
      }
    })
    Object.defineProperty(context, 'connected', {
      configurable: true,
      get: () => connected,
      set: (nextConnected: boolean) => {
        connected = nextConnected
        if (nextConnected) {
          quarantineWhenConnected = isTerminalInputQuarantined(TAB)
          events.push('connected-replacement')
        }
      }
    })

    installRemoteRuntimePtyHostSessionPane(context)
    context.recoverExpiredHostPane()

    await vi.waitFor(() => expect(subscribeToHandle).toHaveBeenCalledOnce())

    expect(inputBatcher.clear).toHaveBeenCalledOnce()
    expect(quarantineWhenConnected).toBe(true)
    expect(events.indexOf('clear-input')).toBeLessThan(events.indexOf('replace-handle'))
    expect(events.indexOf('close-old-subscription')).toBeLessThan(events.indexOf('replace-handle'))
    expect(events.indexOf('unregister-old')).toBeLessThan(events.indexOf('register-replacement'))
    expect(events.indexOf('register-replacement')).toBeLessThan(
      events.indexOf('connected-replacement')
    )
    expect(events.indexOf('connected-replacement')).toBeLessThan(
      events.indexOf('subscribe-replacement')
    )
  })
})
