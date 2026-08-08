import { invoke as tauriInvoke } from '@tauri-apps/api/core'

export type AgentControlOperation =
  | { type: 'control_status' }
  | { type: 'host_status' }
  | { type: 'worker_status' }
  | { type: 'worker_maintenance'; enabled: boolean }

export type AgentControlRequest = {
  requestId: string
  operation: AgentControlOperation
}

export type AgentControlInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export async function requestAgentControl<T = unknown>(
  requestId: string,
  operation: AgentControlOperation,
  invoke: AgentControlInvoke = tauriInvoke as AgentControlInvoke
): Promise<T> {
  if (!requestId.trim()) {
    throw new Error('Agent Control requestId must be nonblank')
  }
  return invoke<T>('agent_control_request', {
    request: { requestId, operation }
  })
}
