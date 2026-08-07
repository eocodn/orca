import type { AgentType } from '../../../../shared/agent-status-types'

type WindowsDoneAgentStatus = {
  state: string
  agentType?: AgentType
}

type PtyConnectionWindowsDoneStatusControllerArgs = {
  enabled: boolean
  initialStatus?: WindowsDoneAgentStatus
  historyResumeIdleCodex: boolean
  subscribe: (listener: (status: WindowsDoneAgentStatus | undefined) => void) => () => void
  applyCompletionSuppression: (agentType: AgentType | undefined) => void
  setCodexSuppression: (suppressed: boolean) => void
  clearSuppression: () => void
  queueIdleReset: () => void
}

export function createPtyConnectionWindowsDoneStatusController({
  enabled,
  initialStatus,
  historyResumeIdleCodex,
  subscribe,
  applyCompletionSuppression,
  setCodexSuppression,
  clearSuppression,
  queueIdleReset
}: PtyConnectionWindowsDoneStatusControllerArgs) {
  let unsubscribe: (() => void) | null = null
  let previousState = initialStatus?.state

  if (enabled) {
    if (!initialStatus && historyResumeIdleCodex) {
      setCodexSuppression(true)
    }
    if (initialStatus?.state === 'done') {
      applyCompletionSuppression(initialStatus.agentType)
    }
    unsubscribe = subscribe((status) => {
      const nextState = status?.state
      if (nextState === 'done') {
        applyCompletionSuppression(status?.agentType)
        if (previousState !== 'done') {
          queueIdleReset()
        }
      } else if (nextState) {
        clearSuppression()
      }
      previousState = nextState
    })
  }

  return {
    dispose(): void {
      unsubscribe?.()
      unsubscribe = null
    }
  }
}
