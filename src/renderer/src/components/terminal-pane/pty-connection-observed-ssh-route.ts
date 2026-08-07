import {
  runPtyConnectionSshDeferredRoute,
  type PtyConnectionSshDeferredRouteArgs
} from './pty-connection-ssh-deferred-route'
import {
  runPtyConnectionSshDeferredSession,
  type PtyConnectionSshDeferredSessionArgs
} from './pty-connection-ssh-deferred-session-controller'

type PtyConnectionObservedSshRouteArgs = {
  route: Omit<PtyConnectionSshDeferredRouteArgs, 'dispatchDeferredFlow'>
  session: Omit<PtyConnectionSshDeferredSessionArgs, 'pendingSessionId'>
}

export function runPtyConnectionObservedSshRoute({
  route,
  session
}: PtyConnectionObservedSshRouteArgs): boolean {
  return runPtyConnectionSshDeferredRoute({
    ...route,
    dispatchDeferredFlow: (pendingSessionId) => {
      void runPtyConnectionSshDeferredSession({
        ...session,
        pendingSessionId
      })
    }
  })
}
