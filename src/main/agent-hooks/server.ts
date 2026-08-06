import { clearAllStatusEventCaches } from '../../shared/agent-status-event'
import { AgentHookServer as AgentHookServerImplementation } from './agent-hook-server-persistence'
export {
  equivalentParsedAgentStatusPayload,
  snapshotAgentStatusEntries,
  snapshotAgentStatusEntry,
  toAgentStatusIpcPayload
} from './agent-status-core'
export type { AgentStatusCoreEntry } from './agent-status-core'
export type {
  AgentHookSource,
  AgentHookStatusChangeEntry,
  AgentHookProviderSessionIdentity,
  AgentHookAuthorityEvidence,
  AgentHookAuthorityAttestation
} from './agent-hook-server-shared'
export {
  CLOSED_AGENT_STATUS_TAB_IDS_MAX,
  CLOSED_AGENT_STATUS_PANE_KEYS_MAX,
  PANE_KEY_ALIASES_MAX,
  isValidPaneKey
} from './agent-hook-server-shared'

export { AgentHookServerImplementation as AgentHookServer }
export const agentHookServer = new AgentHookServerImplementation()
export const _internals = {
  resetCachesForTests: (): void => {
    clearAllStatusEventCaches(agentHookServer._getStateForTests())
    agentHookServer._resetPromptSentDedupeForTests()
    agentHookServer._resetConnectionTimestampWatermarksForTests()
  }
}
