import { useTerminalSurfaceCreationActions } from './terminal-surface-creation-actions'
import { useTerminalSurfaceCloseActions } from './terminal-surface-close-actions'
import { useTerminalSurfaceActivationActions } from './terminal-surface-activation-actions'

export function useTerminalSurfaceActions(context: Record<string, any>): Record<string, any> {
  return {
    ...useTerminalSurfaceCreationActions(context),
    ...useTerminalSurfaceCloseActions(context),
    ...useTerminalSurfaceActivationActions(context)
  }
}
