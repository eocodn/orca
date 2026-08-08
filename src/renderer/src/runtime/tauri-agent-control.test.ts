import { describe, expect, it, vi } from 'vitest'
import {
  requestAgentControl,
  type AgentControlInvoke,
  type AgentControlOperation
} from './tauri-agent-control'

describe('Tauri Agent Control bridge', () => {
  it('invokes the typed command without accepting an endpoint path', async () => {
    const invoke = vi.fn<AgentControlInvoke>().mockResolvedValue({ ok: true })
    const operation: AgentControlOperation = { type: 'worker_status' }

    await expect(requestAgentControl('status-1', operation, invoke)).resolves.toEqual({ ok: true })
    expect(invoke).toHaveBeenCalledWith('agent_control_request', {
      request: { requestId: 'status-1', operation }
    })
  })

  it('rejects blank request ids before invoking Tauri', async () => {
    const invoke = vi.fn<AgentControlInvoke>()
    await expect(requestAgentControl(' ', { type: 'control_status' }, invoke)).rejects.toThrow(
      'requestId must be nonblank'
    )
    expect(invoke).not.toHaveBeenCalled()
  })
})
