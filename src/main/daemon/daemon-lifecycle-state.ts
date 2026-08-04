import type { DaemonSpawner } from './daemon-spawner'
import type { DaemonPtyAdapter } from './daemon-pty-adapter'
import type { DaemonPtyRouter } from './daemon-pty-router'
import type { DegradedDaemonPtyProvider } from './degraded-daemon-pty-provider'

export type DaemonProvider = DaemonPtyRouter | DaemonPtyAdapter | DegradedDaemonPtyProvider

export const daemonLifecycleState: {
  spawner: DaemonSpawner | null
  adapter: DaemonProvider | null
  restartInFlight: Promise<unknown> | null
} = {
  spawner: null,
  adapter: null,
  restartInFlight: null
}
