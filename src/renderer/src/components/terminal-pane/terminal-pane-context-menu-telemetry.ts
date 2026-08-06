import { useAppStore } from '@/store'
import { recordCreatedTerminalPaneSplit } from './terminal-pane-split-completion'

export function getRequestedSplitTelemetrySource(): 'contextual_tour' | 'context_menu' {
  return useAppStore.getState().activeContextualTourId === 'workspace-agent-sessions'
    ? 'contextual_tour'
    : 'context_menu'
}

export function recordContextMenuCreatedTerminalPaneSplit(
  createdPane: unknown,
  args: {
    source: 'contextual_tour' | 'context_menu'
    direction: 'vertical' | 'horizontal'
  }
): boolean {
  return recordCreatedTerminalPaneSplit(createdPane, args)
}
