import type { ColdRestoreAgentResumeStartup } from './pty-connection-e2e-support'

type PtyConnectionFreshOrColdRestoreArgs = {
  coldRestoreStartup: ColdRestoreAgentResumeStartup | null
  hasSleepingAgentSession: boolean
  startFreshColdRestore: (startup: ColdRestoreAgentResumeStartup | undefined) => void
  startFreshSpawn: () => void
}

export function runPtyConnectionFreshOrColdRestore({
  coldRestoreStartup,
  hasSleepingAgentSession,
  startFreshColdRestore,
  startFreshSpawn
}: PtyConnectionFreshOrColdRestoreArgs): 'cold-restore' | 'fresh-spawn' {
  if (coldRestoreStartup || hasSleepingAgentSession) {
    startFreshColdRestore(coldRestoreStartup ?? undefined)
    return 'cold-restore'
  }
  startFreshSpawn()
  return 'fresh-spawn'
}
