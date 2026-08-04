import { getClientRuntime } from '@/runtime/client-runtime'
import { toRuntimeExecutionHostId, type ExecutionHostId } from '../../shared/execution-host'

export async function listRuntimeSessionHostIdsForStartup(): Promise<ExecutionHostId[]> {
  try {
    return (await getClientRuntime().remoteHost.list()).map((environment) =>
      toRuntimeExecutionHostId(environment.id)
    )
  } catch (err) {
    console.warn('Failed to list runtime session hosts for startup:', err)
    return []
  }
}
