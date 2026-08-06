import { describe, expect, it } from 'vitest'
import { createAgentStatusEventState } from './agent-status-event'
import { upsertBoundedAgentStatus } from './agent-status-cache'

describe('agent status cache bounds', () => {
  it('evicts the oldest fresh working row when every row is live', () => {
    const state = createAgentStatusEventState()
    const payload = (paneKey: string) => ({
      paneKey,
      connectionId: null,
      receivedAt: 1,
      payload: { state: 'working' as const, prompt: '' }
    })
    upsertBoundedAgentStatus(state, payload('a'), { maxPanes: 2 })
    upsertBoundedAgentStatus(state, payload('b'), { maxPanes: 2 })
    const evicted = upsertBoundedAgentStatus(state, payload('c'), { maxPanes: 2 })
    expect(evicted.map((entry) => entry.paneKey)).toEqual(['a'])
    expect([...state.lastStatusByPaneKey.keys()]).toEqual(['b', 'c'])
  })
})
