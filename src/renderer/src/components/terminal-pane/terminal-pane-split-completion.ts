import { useAppStore } from '@/store'
import type { TerminalPaneSplitSource } from '../../../../shared/feature-education-telemetry'

export type TerminalPaneSplitCompletion = {
  source: TerminalPaneSplitSource
  direction: 'vertical' | 'horizontal'
}

export function recordCreatedTerminalPaneSplit(
  createdPane: unknown,
  _completion: TerminalPaneSplitCompletion
): boolean {
  if (!createdPane) {
    return false
  }
  useAppStore.getState().recordFeatureInteraction('terminal-pane-split')
  return true
}
