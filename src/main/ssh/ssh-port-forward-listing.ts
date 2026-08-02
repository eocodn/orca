import type { PortForwardEntry } from '../../shared/ssh-types'
import type { StartedPortForward } from './ssh-port-forward-provider'

export function listStartedPortForwardEntries(
  forwards: Iterable<StartedPortForward>,
  connectionId?: string
): PortForwardEntry[] {
  const entries: PortForwardEntry[] = []
  for (const { entry } of forwards) {
    if (!connectionId || entry.connectionId === connectionId) {
      entries.push(entry)
    }
  }
  return entries
}
