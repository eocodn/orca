import {
  preparePtyConnectionAttachRouteObservation,
  type PtyConnectionAttachRouteObservationArgs
} from './pty-connection-attach-route-observation'
import {
  runPtyConnectionNormalRouteSession,
  type PtyConnectionNormalRouteSessionArgs
} from './pty-connection-normal-route-session'

type CandidateAttachSpawnArgs = Omit<
  PtyConnectionNormalRouteSessionArgs['attachSpawn'],
  'attachPtyId' | 'legacyAttachOnlyPtyId' | 'attachUsesEagerBuffer'
>

type PtyConnectionObservedNormalRouteArgs = {
  observation: PtyConnectionAttachRouteObservationArgs
  normalRoute: Omit<
    PtyConnectionNormalRouteSessionArgs,
    | 'sleptRemoteRuntimeSessionId'
    | 'deferredReattachSessionId'
    | 'hasSleepingAgentSession'
    | 'attachSpawn'
  > & {
    attachSpawn: CandidateAttachSpawnArgs
  }
}

export function runPtyConnectionObservedNormalRoute({
  observation,
  normalRoute
}: PtyConnectionObservedNormalRouteArgs): 'reattach' | 'attach' | 'pending' | 'fresh' {
  const candidate = preparePtyConnectionAttachRouteObservation(observation)
  return runPtyConnectionNormalRouteSession({
    ...normalRoute,
    sleptRemoteRuntimeSessionId: candidate.sleptRemoteRuntimeSessionId,
    deferredReattachSessionId: candidate.deferredReattachSessionId,
    hasSleepingAgentSession: observation.hasSleepingAgentSession,
    attachSpawn: {
      ...normalRoute.attachSpawn,
      attachPtyId: candidate.attachPtyId,
      legacyAttachOnlyPtyId: candidate.legacyAttachOnlyPtyId,
      attachUsesEagerBuffer: candidate.attachUsesEagerBuffer
    }
  })
}
