import type { PendingPortForwardStart } from './ssh-port-forward-lifecycle-types'
import type { SshPortForwardMutationCoordinator } from './ssh-port-forward-mutation-coordinator'

export function disposePortForwardResources(
  coordinator: SshPortForwardMutationCoordinator,
  pendingStarts: Iterable<PendingPortForwardStart>,
  forwardIds: Iterable<string>,
  removeForward: (id: string) => void
): void {
  coordinator.cancelAll()
  for (const pending of pendingStarts) {
    pending.cancelled = true
  }
  for (const id of forwardIds) {
    removeForward(id)
  }
}
