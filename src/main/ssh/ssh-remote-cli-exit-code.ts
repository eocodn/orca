import type { RpcResponse } from '../runtime/rpc/core'

export function getRemoteCliExitCode(response: RpcResponse): number {
  return response.ok ? 0 : 1
}
