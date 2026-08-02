import { recordCreatedTerminalPaneSplit } from './terminal-pane-split-completion'

export function recordKeyboardCreatedTerminalPaneSplit(
  createdPane: unknown,
  args: {
    source: 'contextual_tour' | 'keyboard'
    direction: 'vertical' | 'horizontal'
  }
): boolean {
  return recordCreatedTerminalPaneSplit(createdPane, args)
}
