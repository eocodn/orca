import { useTerminalSurfaceCreationActions } from './terminal-surface-creation-actions'
import { useTerminalSurfaceCloseActions } from './terminal-surface-close-actions'
import { useTerminalSurfaceActivationActions } from './terminal-surface-activation-actions'

type TerminalSurfaceActionsContext = Parameters<typeof useTerminalSurfaceCreationActions>[0] &
  Parameters<typeof useTerminalSurfaceCloseActions>[0] &
  Parameters<typeof useTerminalSurfaceActivationActions>[0]

type TerminalSurfaceActions = ReturnType<typeof useTerminalSurfaceCreationActions> &
  ReturnType<typeof useTerminalSurfaceCloseActions> &
  ReturnType<typeof useTerminalSurfaceActivationActions>

export function useTerminalSurfaceActions(
  context: TerminalSurfaceActionsContext
): TerminalSurfaceActions {
  return {
    ...useTerminalSurfaceCreationActions(context),
    ...useTerminalSurfaceCloseActions(context),
    ...useTerminalSurfaceActivationActions(context)
  }
}
