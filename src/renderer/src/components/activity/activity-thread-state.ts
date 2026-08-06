import { agentStateLabel } from '@/components/AgentStateDot'
import type { AgentStatusState } from '../../../../shared/agent-status-types'
import type { AgentPaneThread } from './activity-prototype-page-model'

export function threadAgentState(thread: AgentPaneThread): AgentStatusState {
  return thread.currentAgentState ?? thread.latestEvent?.state ?? 'done'
}

export function threadAgentStateLabel(thread: AgentPaneThread): string {
  const state = threadAgentState(thread)
  if (!thread.currentAgentState && state === 'done' && thread.latestEvent?.entry.interrupted) {
    return 'Interrupted'
  }
  return agentStateLabel(state)
}
