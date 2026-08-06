import { describe, expect, it } from 'vitest'

import {
  equivalentParsedAgentStatusPayload,
  snapshotAgentStatusEntries,
  snapshotAgentStatusEntry
} from './agent-status-core'

const entry = {
  paneKey: 'tab:leaf',
  tabId: 'tab',
  connectionId: null,
  receivedAt: 10,
  stateStartedAt: 9,
  payload: {
    state: 'working' as const,
    prompt: 'ship it',
    agentType: 'custom-agent',
    model: 'model-x'
  }
}

describe('generic agent status core', () => {
  it('flattens OSC/PTY status records into the generic IPC snapshot shape', () => {
    expect(snapshotAgentStatusEntries([entry])).toEqual([
      {
        paneKey: 'tab:leaf',
        tabId: 'tab',
        worktreeId: undefined,
        connectionId: null,
        receivedAt: 10,
        stateStartedAt: 9,
        state: 'working',
        prompt: 'ship it',
        agentType: 'custom-agent',
        model: 'model-x'
      }
    ])
  })

  it('returns one-pane snapshots without provider-specific enrichment', () => {
    expect(snapshotAgentStatusEntry(entry, 'tab:leaf')).toHaveLength(1)
    expect(snapshotAgentStatusEntry(entry, 'other:leaf')).toEqual([])
  })

  it('compares only fields represented by the OSC status wire', () => {
    expect(
      equivalentParsedAgentStatusPayload(entry.payload, {
        ...entry.payload,
        model: 'different-model'
      })
    ).toBe(true)
    expect(
      equivalentParsedAgentStatusPayload(entry.payload, {
        ...entry.payload,
        state: 'done'
      })
    ).toBe(false)
  })
})
