import { describe, expect, it, vi } from 'vitest'
import { shallow } from 'zustand/shallow'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { TerminalLayoutSnapshot } from '../../../../shared/types'
import {
  createTabBarAgentProjectionSelector,
  selectTabAgentTypesByTabId,
  selectTabBarAgentProjections
} from './tab-agent-types-by-tab-id'

function entry(partial: Partial<AgentStatusEntry>): AgentStatusEntry {
  return { state: 'working', updatedAt: 0, ...partial } as AgentStatusEntry
}

function splitLayout(activeLeafId: string | null): TerminalLayoutSnapshot {
  return {
    root: {
      type: 'split',
      direction: 'horizontal',
      first: { type: 'leaf', leafId: 'leaf-a' },
      second: { type: 'leaf', leafId: 'leaf-b' }
    },
    activeLeafId,
    expandedLeafId: null
  }
}

describe('selectTabAgentTypesByTabId', () => {
  it('uses the active split leaf regardless of pane-map insertion order', () => {
    const layouts = { 'tab-1': splitLayout('leaf-b') }
    const statuses = {
      'tab-1:leaf-a': entry({ agentType: 'claude' }),
      'tab-1:leaf-b': entry({ agentType: 'codex' })
    }

    expect(selectTabAgentTypesByTabId(statuses, layouts)).toEqual({ 'tab-1': 'codex' })
  })

  it('falls back to the first pane while layout data hydrates', () => {
    expect(
      selectTabAgentTypesByTabId({
        'tab-1:leaf-a': entry({ agentType: 'claude' }),
        'tab-2:leaf-a': entry({ agentType: 'codex' })
      })
    ).toEqual({ 'tab-1': 'claude', 'tab-2': 'codex' })
  })

  it('does not inherit a sibling when the active split leaf has no agent', () => {
    expect(
      selectTabAgentTypesByTabId(
        {
          'tab-1:leaf-a': entry({ agentType: 'claude' }),
          'tab-1:leaf-b': entry({ agentType: undefined })
        },
        { 'tab-1': splitLayout('leaf-b') }
      )
    ).toEqual({})
  })

  it('ignores malformed pane keys and stale active leaves', () => {
    expect(selectTabAgentTypesByTabId({ ':leaf-a': entry({ agentType: 'claude' }) })).toEqual({})
    expect(
      selectTabAgentTypesByTabId(
        { 'tab-1:leaf-a': entry({ agentType: 'claude' }) },
        {
          'tab-1': {
            root: { type: 'leaf', leafId: 'leaf-a' },
            activeLeafId: 'closed-leaf',
            expandedLeafId: null
          }
        }
      )
    ).toEqual({})
  })

  it('stays shallow-equal across status-only changes', () => {
    const working = selectTabAgentTypesByTabId({
      'tab-1:leaf-a': entry({ agentType: 'claude', state: 'working' })
    })
    const done = selectTabAgentTypesByTabId({
      'tab-1:leaf-a': entry({ agentType: 'claude', state: 'done' })
    })
    expect(shallow(working, done)).toBe(true)
  })
})

describe('createTabBarAgentProjectionSelector', () => {
  it('shares scans and reuses the projected result when inputs are stable', () => {
    const onStatusEntryVisited = vi.fn()
    const onAgentTypeLayoutVisited = vi.fn()
    const select = createTabBarAgentProjectionSelector({
      onStatusEntryVisited,
      onAgentTypeLayoutVisited
    })
    const state = {
      agentStatusByPaneKey: { 'tab-1:leaf-a': entry({ agentType: 'claude' }) },
      terminalLayoutsByTabId: { 'tab-1': splitLayout('leaf-a') }
    }

    const first = select(state)
    expect(select(state)).toBe(first)
    expect(onStatusEntryVisited).toHaveBeenCalledTimes(1)
    expect(onAgentTypeLayoutVisited).toHaveBeenCalledTimes(1)
  })

  it('returns the shared empty projection when no maps are available', () => {
    expect(selectTabBarAgentProjections({})).toBe(selectTabBarAgentProjections({}))
  })
})
