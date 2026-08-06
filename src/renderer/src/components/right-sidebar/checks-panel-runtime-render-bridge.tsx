import React from 'react'
import { renderChecksPanel } from './checks-panel-runtime-render'

type RecordValue = Record<string, unknown>

export function renderChecksPanelRuntime<
  Foundation extends RecordValue,
  ViewState extends RecordValue,
  Generation extends RecordValue,
  Effects extends RecordValue,
  Actions extends RecordValue,
  Overrides extends RecordValue
>(args: {
  foundation: Foundation
  viewState: ViewState
  generation: Generation
  effects: Effects
  actions: Actions
  overrides: Overrides
}): React.JSX.Element {
  return renderChecksPanel({
    ...args.foundation,
    ...args.viewState,
    ...args.generation,
    ...args.effects,
    ...args.actions,
    ...args.overrides
  })
}
