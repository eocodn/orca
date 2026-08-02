import { useContextualTour } from '@/components/contextual-tours/use-contextual-tour'
import { FloatingTerminalPanelView } from './floating-terminal-panel-renderer'
import { useFloatingTerminalPanelState } from './floating-terminal-panel-state'
import { useFloatingTerminalPanelFileActions } from './floating-terminal-panel-file-actions'
import { useFloatingTerminalPanelTabActions } from './floating-terminal-panel-tab-actions'
import { useFloatingTerminalPanelBounds } from './floating-terminal-panel-bounds-actions'
import { useFloatingTerminalPanelLifecycle } from './floating-terminal-panel-lifecycle'
import { useFloatingTerminalPanelFocus, clearReportedFloatingFocusCache } from './floating-terminal-panel-focus'
import { useFloatingTerminalPanelShortcuts } from './floating-terminal-panel-shortcuts'
import { useFloatingTerminalPanelDrag } from './floating-terminal-panel-drag'

export type FloatingTerminalPanelProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tourInteractionSnapshot?: {
    wasPreviouslyInteracted?: boolean
    persisted?: Promise<void>
    recordFeatureInteractionForTour: boolean
  } | null
}

export { clearReportedFloatingFocusCache }

export function FloatingTerminalPanel({ open, onOpenChange, tourInteractionSnapshot }: FloatingTerminalPanelProps): React.JSX.Element | null {
  const state = useFloatingTerminalPanelState({ open })
  useContextualTour('floating-workspace', open, 'floating_workspace_visible', {
    recordFeatureInteraction: tourInteractionSnapshot?.recordFeatureInteractionForTour ?? false,
    featureInteractionPersisted: tourInteractionSnapshot?.persisted,
    wasFeaturePreviouslyInteracted: tourInteractionSnapshot?.wasPreviouslyInteracted
  })
  const fileActions = useFloatingTerminalPanelFileActions(state)
  const tabActions = useFloatingTerminalPanelTabActions(state, fileActions)
  const bounds = useFloatingTerminalPanelBounds(state)
  const lifecycle = useFloatingTerminalPanelLifecycle(state, bounds, open)
  const focus = useFloatingTerminalPanelFocus(state, open, {
    closeFloatingItemConfirmed: tabActions.closeFloatingItemConfirmed,
    visibleFloatingItemCount: state.visibleFloatingItemCount
  })
  const shortcuts = useFloatingTerminalPanelShortcuts(state, tabActions, bounds, focus, open, onOpenChange)
  const drag = useFloatingTerminalPanelDrag(state, bounds, focus.focusPanelForShortcuts)

  const context = {
    ...state,
    ...fileActions,
    ...tabActions,
    ...bounds,
    ...lifecycle,
    ...focus,
    ...shortcuts,
    ...drag,
    open,
    onOpenChange,
    tourInteractionSnapshot
  }

  return <FloatingTerminalPanelView context={context} />
}
