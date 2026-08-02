import { useMobileSessionRecoverySessionTabs } from './mobile-session-recovery-session-tabs'
import { useMobileSessionRecoveryCapabilities } from './mobile-session-recovery-capabilities'
import { useMobileSessionForegroundRecovery } from './mobile-session-foreground-recovery'
import { useMobileSessionRecoveryRouteState } from './mobile-session-recovery-route-state'

type SessionRecoveryContext = Record<string, any>

export function useMobileSessionRecovery(context: SessionRecoveryContext) {
  const sessionTabs = useMobileSessionRecoverySessionTabs(context)
  const capabilities = useMobileSessionRecoveryCapabilities(context)
  const foreground = useMobileSessionForegroundRecovery(context)
  const routeState = useMobileSessionRecoveryRouteState({
    ...context,
    ...sessionTabs,
    ...capabilities,
    ...foreground
  })

  return {
    ...sessionTabs,
    ...capabilities,
    ...foreground,
    ...routeState
  }
}
