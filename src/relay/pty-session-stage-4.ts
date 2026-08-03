import { PtyHandlerStage4Inspection } from './pty-session-stage-4-inspection'

export abstract class PtyHandlerStage4 extends PtyHandlerStage4Inspection {}

export {
  IMMEDIATE_PTY_EXIT_TIMEOUT_MS,
  MAX_RELAY_PTY_SESSIONS,
  REPLAY_BUFFER_MAX,
  attachIdentityMismatches,
  formatNodePtyUnavailableMessage
} from './pty-session-stage-contracts'
export type {
  PtyEnvAugmenter,
  PtyExitListener,
  RelayPtyWorktreeRemovalCoordinator
} from './pty-session-stage-contracts'
