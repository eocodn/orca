import type { AgentType } from '../../../../shared/agent-status-types'

type TitleCompletionStatus = {
  state: string
  agentType?: AgentType
}

type PtyConnectionTitleCompletionDeferralControllerArgs = {
  resolveCompatibleAgentType: (
    candidate: AgentType | undefined,
    pending: AgentType | undefined
  ) => AgentType | null | undefined
  applyCompletion: (title: string, agentType: AgentType | undefined) => void
  relaxPendingCompletion: () => void
}

export function createPtyConnectionTitleCompletionDeferralController({
  resolveCompatibleAgentType,
  applyCompletion,
  relaxPendingCompletion
}: PtyConnectionTitleCompletionDeferralControllerArgs) {
  let pending: { title: string; agentType: AgentType | undefined } | null = null

  const clear = (): void => {
    pending = null
  }

  return {
    preserve(title: string, status: TitleCompletionStatus): void {
      pending = { title, agentType: status.agentType }
      if (status.state === 'waiting' || status.state === 'blocked') {
        relaxPendingCompletion()
      }
    },
    handleLifecycle(status: TitleCompletionStatus): void {
      if (!pending) {
        return
      }
      const compatibleAgent = resolveCompatibleAgentType(status.agentType, pending.agentType)
      const belongsToPendingAgent =
        !pending.agentType ||
        pending.agentType === 'unknown' ||
        !status.agentType ||
        status.agentType === 'unknown' ||
        compatibleAgent === pending.agentType
      if (!belongsToPendingAgent || status.state === 'working') {
        clear()
        return
      }
      if (status.state === 'done') {
        applyCompletion(pending.title, status.agentType ?? pending.agentType)
        clear()
        return
      }
      if (status.state === 'waiting' || status.state === 'blocked') {
        relaxPendingCompletion()
      }
    },
    clear,
    dispose: clear
  }
}
