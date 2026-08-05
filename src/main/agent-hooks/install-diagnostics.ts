import type { HookInstallAgent } from '../../shared/telemetry-events'

export function logManagedHookInstallFailure(agent: HookInstallAgent, error: unknown): void {
  console.error('[agent-hooks] managed hook install failed', {
    agent,
    error: error instanceof Error ? error.message : String(error)
  })
}
