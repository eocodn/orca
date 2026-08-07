import type { ColdRestoreAgentResumeStartup, FreshSpawnOptions } from './pty-connection-e2e-support'
import {
  runPtyConnectionAttachSpawnSession,
  type PtyConnectionAttachSpawnSessionArgs
} from './pty-connection-attach-spawn-session'
import { runPtyConnectionFreshOrColdRestore } from './pty-connection-fresh-or-cold-restore'
import {
  runPtyConnectionRestoredReattachSession,
  type PtyConnectionRestoredReattachSessionArgs
} from './pty-connection-restored-reattach-session'

export type PtyConnectionNormalRouteSessionArgs = {
  sleptRemoteRuntimeSessionId: string | null
  deferredReattachSessionId: string | null
  hasSleepingAgentSession: boolean
  buildColdRestoreStartup: () => ColdRestoreAgentResumeStartup | null
  startFreshColdRestore: (
    startup?: ColdRestoreAgentResumeStartup | null,
    options?: FreshSpawnOptions
  ) => Promise<string | null> | void
  restoredReattach: Omit<
    PtyConnectionRestoredReattachSessionArgs,
    'sessionId' | 'startFreshColdRestore'
  >
  attachSpawn: Omit<PtyConnectionAttachSpawnSessionArgs, 'startFreshOrColdRestore'>
  scheduleRuntimeGraphSync: () => void
}

export function runPtyConnectionNormalRouteSession({
  sleptRemoteRuntimeSessionId,
  deferredReattachSessionId,
  hasSleepingAgentSession,
  buildColdRestoreStartup,
  startFreshColdRestore,
  restoredReattach,
  attachSpawn,
  scheduleRuntimeGraphSync
}: PtyConnectionNormalRouteSessionArgs): 'reattach' | 'attach' | 'pending' | 'fresh' {
  const sleptRemoteColdRestoreStartup = sleptRemoteRuntimeSessionId
    ? buildColdRestoreStartup()
    : null
  const startFreshOrColdRestore = (): void => {
    runPtyConnectionFreshOrColdRestore({
      coldRestoreStartup: sleptRemoteColdRestoreStartup,
      hasSleepingAgentSession,
      startFreshColdRestore: (startup) => {
        void startFreshColdRestore(startup)
      },
      startFreshSpawn: attachSpawn.startFreshSpawn
    })
  }

  let route: 'reattach' | 'attach' | 'pending' | 'fresh'
  if (deferredReattachSessionId) {
    runPtyConnectionRestoredReattachSession({
      ...restoredReattach,
      sessionId: deferredReattachSessionId,
      startFreshColdRestore
    })
    route = 'reattach'
  } else {
    route = runPtyConnectionAttachSpawnSession({
      ...attachSpawn,
      startFreshOrColdRestore
    })
  }
  scheduleRuntimeGraphSync()
  return route
}
