import type { RemoteWorkspaceTargetSync } from './remote-workspace-target-sync'
import type { DirectSshAuthority } from '../../../shared/ssh-types'

type IpcEventsCleanupContext = {
  unsubscribeRuntimeEnvironmentStore: () => void
  unsubs: Array<() => void>
  markDirectSshEffectStopped: () => void
  authorityReconciliationDeadlines: Set<{ timer: ReturnType<typeof setTimeout>; settle: () => void }>
  remoteWorkspaceTargetSync: RemoteWorkspaceTargetSync | null
  hostHydration: { stop: () => void }
  reconnectCoordinator: { stop: () => void }
  reconnectAuthorityByTarget: Map<string, DirectSshAuthority>
  resetAgentHookCompletionNotificationCoordinators: () => void
}

export function createIpcEventsCleanup(context: IpcEventsCleanupContext): () => void {
  return () => {
    context.unsubscribeRuntimeEnvironmentStore()
    context.unsubs.forEach((fn) => fn())
    context.markDirectSshEffectStopped()
    for (const deadline of context.authorityReconciliationDeadlines) {
      clearTimeout(deadline.timer)
      deadline.settle()
    }
    context.authorityReconciliationDeadlines.clear()
    context.remoteWorkspaceTargetSync?.stop()
    context.hostHydration.stop()
    context.reconnectCoordinator.stop()
    context.reconnectAuthorityByTarget.clear()
    context.resetAgentHookCompletionNotificationCoordinators()
  }
}
