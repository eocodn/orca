import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getRequestedSplitTelemetrySource,
  recordContextMenuCreatedTerminalPaneSplit
} from './terminal-pane-context-menu-telemetry'

const mocks = vi.hoisted(() => ({
  activeContextualTourId: null as string | null,
  recordCreatedTerminalPaneSplit: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({ activeContextualTourId: mocks.activeContextualTourId })
  }
}))

vi.mock('./terminal-pane-split-completion', () => ({
  recordCreatedTerminalPaneSplit: mocks.recordCreatedTerminalPaneSplit
}))

describe('terminal pane context-menu split completion', () => {
  beforeEach(() => {
    mocks.activeContextualTourId = null
    mocks.recordCreatedTerminalPaneSplit.mockReset()
  })

  it('attributes requested splits only to the active workspace tour', () => {
    expect(getRequestedSplitTelemetrySource()).toBe('context_menu')
    mocks.activeContextualTourId = 'workspace-agent-sessions'
    expect(getRequestedSplitTelemetrySource()).toBe('contextual_tour')
  })

  it('delegates durable completion to the shared split boundary', () => {
    mocks.recordCreatedTerminalPaneSplit.mockReturnValue(true)
    const pane = { id: 2 }
    const args = { source: 'context_menu' as const, direction: 'horizontal' as const }

    expect(recordContextMenuCreatedTerminalPaneSplit(pane, args)).toBe(true)
    expect(mocks.recordCreatedTerminalPaneSplit).toHaveBeenCalledWith(pane, args)
  })
})
