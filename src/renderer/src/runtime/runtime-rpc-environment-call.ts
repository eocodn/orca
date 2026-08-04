import { callAbortableRuntimeEnvironment } from './abortable-runtime-environment-call'
import { getClientRuntime } from './client-runtime'

export async function callRuntimeEnvironmentWithRevision(args: {
  environmentId: string
  method: string
  params: unknown
  timeoutMs?: number
  signal?: AbortSignal
  expectedEnvironmentPairingRevision?: number
}): Promise<unknown> {
  if (args.signal) {
    return callAbortableRuntimeEnvironment(
      args.environmentId,
      args.method,
      args.params,
      args.timeoutMs,
      args.signal,
      args.expectedEnvironmentPairingRevision
    )
  }
  return getClientRuntime().remoteHost.call({
    selector: args.environmentId,
    method: args.method,
    params: args.params,
    timeoutMs: args.timeoutMs,
    expectedEnvironmentPairingRevision: args.expectedEnvironmentPairingRevision
  })
}
