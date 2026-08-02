import { clearAllListenerCaches, normalizeHookPayload, parseFormEncodedBody } from "../../shared/agent-hook-listener"
import type { AgentHookEventPayload } from "../../shared/agent-hook-listener"
import { AgentHookServer as AgentHookServerImplementation } from "./agent-hook-server-persistence"
import type { AgentHookSource } from "./agent-hook-server-shared"
export type { AgentHookSource, AgentHookStatusChangeEntry, AgentHookProviderSessionIdentity, AgentHookAuthorityEvidence, AgentHookAuthorityAttestation } from "./agent-hook-server-shared"
export { CLOSED_AGENT_STATUS_TAB_IDS_MAX, CLOSED_AGENT_STATUS_PANE_KEYS_MAX, PANE_KEY_ALIASES_MAX, isValidPaneKey } from "./agent-hook-server-shared"

export { AgentHookServerImplementation as AgentHookServer }
export const agentHookServer = new AgentHookServerImplementation()
export const _internals = {
  normalizeHookPayload: (source: AgentHookSource, body: unknown, expectedEnv: string): AgentHookEventPayload | null => normalizeHookPayload(agentHookServer._getStateForTests(), source, body, expectedEnv),
  parseFormEncodedBody,
  resetCachesForTests: (): void => {
    clearAllListenerCaches(agentHookServer._getStateForTests())
    agentHookServer._resetPromptSentDedupeForTests()
    agentHookServer._resetConnectionTimestampWatermarksForTests()
  }
}
