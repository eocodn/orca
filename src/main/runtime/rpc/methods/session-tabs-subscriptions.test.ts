import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { SESSION_TAB_METHODS } from './session-tabs'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

describe('session tab RPC subscriptions', () => {
  it('keeps duplicate session tab subscribers for one worktree independent', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      listMobileSessionTabs: vi.fn().mockResolvedValue({
        worktree: 'wt-1',
        publicationEpoch: 'epoch-1',
        snapshotVersion: 1,
        activeGroupId: null,
        activeTabId: null,
        activeTabType: null,
        tabs: []
      }),
      onMobileSessionTabsChanged: vi.fn(() => vi.fn()),
      registerSubscriptionCleanup: vi.fn()
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: SESSION_TAB_METHODS })

    await dispatcher.dispatchStreaming(
      { ...makeRequest('session.tabs.subscribe', { worktree: 'id:wt-1' }), id: 'sub-1' },
      vi.fn(),
      { connectionId: 'conn-1' }
    )
    await dispatcher.dispatchStreaming(
      { ...makeRequest('session.tabs.subscribe', { worktree: 'wt-1' }), id: 'sub-2' },
      vi.fn(),
      { connectionId: 'conn-1' }
    )

    expect(runtime.registerSubscriptionCleanup).toHaveBeenCalledWith(
      'session.tabs:conn-1:wt-1:sub-1',
      expect.any(Function),
      'conn-1'
    )
    expect(runtime.registerSubscriptionCleanup).toHaveBeenCalledWith(
      'session.tabs:conn-1:wt-1:sub-2',
      expect.any(Function),
      'conn-1'
    )
  })

  it('unsubscribes a session tabs stream using the resolved worktree id and connection id', async () => {
    const cleanupSubscription = vi.fn()
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      listMobileSessionTabs: vi.fn().mockResolvedValue({
        worktree: 'wt-1',
        publicationEpoch: 'test',
        snapshotVersion: 1,
        activeGroupId: null,
        activeTabId: null,
        activeTabType: null,
        tabs: []
      }),
      cleanupSubscription,
      cleanupSubscriptionsByPrefix: vi.fn()
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: SESSION_TAB_METHODS })
    const messages: string[] = []

    await dispatcher.dispatchStreaming(
      makeRequest('session.tabs.unsubscribe', { worktree: 'id:wt-1' }),
      (message) => messages.push(message),
      { connectionId: 'conn-1' }
    )

    expect(cleanupSubscription).toHaveBeenCalledWith('session.tabs:conn-1:wt-1')
    expect(JSON.parse(messages[0]!)).toMatchObject({
      ok: true,
      result: { unsubscribed: true }
    })
  })

  it('unsubscribes one shared-control session tab stream by subscription id', async () => {
    const cleanupSubscription = vi.fn()
    const cleanupSubscriptionsByPrefix = vi.fn()
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      listMobileSessionTabs: vi.fn().mockResolvedValue({
        worktree: 'wt-1',
        publicationEpoch: 'test',
        snapshotVersion: 1,
        activeGroupId: null,
        activeTabId: null,
        activeTabType: null,
        tabs: []
      }),
      cleanupSubscription,
      cleanupSubscriptionsByPrefix
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: SESSION_TAB_METHODS })

    await dispatcher.dispatchStreaming(
      makeRequest('session.tabs.unsubscribe', { worktree: 'id:wt-1', subscriptionId: 'sub-1' }),
      vi.fn(),
      { connectionId: 'conn-1' }
    )

    expect(cleanupSubscription).toHaveBeenCalledWith('session.tabs:conn-1:wt-1:sub-1')
    expect(cleanupSubscriptionsByPrefix).not.toHaveBeenCalled()
  })

  it('unsubscribes one shared-control all-session-tabs stream by subscription id', async () => {
    const cleanupSubscription = vi.fn()
    const cleanupSubscriptionsByPrefix = vi.fn()
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      cleanupSubscription,
      cleanupSubscriptionsByPrefix
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: SESSION_TAB_METHODS })

    await dispatcher.dispatchStreaming(
      makeRequest('session.tabs.unsubscribeAll', { subscriptionId: 'sub-all-1' }),
      vi.fn(),
      { connectionId: 'conn-1' }
    )

    expect(cleanupSubscription).toHaveBeenCalledWith('session.tabs:conn-1:*:sub-all-1')
    expect(cleanupSubscriptionsByPrefix).not.toHaveBeenCalled()
  })
})
