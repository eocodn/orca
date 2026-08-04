import type { RpcResponse } from '../runtime/rpc/core'
import type { ParsedRemoteCli } from './ssh-remote-cli-argument-error'
import type { RemoteOrcaCliResult } from './ssh-remote-cli-host-passthrough'
import { formatRemoteCli } from './ssh-remote-cli-format'
import { getRemoteCliExitCode } from './ssh-remote-cli-exit-code'

export function formatInProcessRemoteCliResult(
  parsed: ParsedRemoteCli,
  env: Record<string, string>,
  response: RpcResponse,
  json: boolean
): RemoteOrcaCliResult {
  const formatted = json
    ? { stdout: `${JSON.stringify(response, null, 2)}\n`, stderr: '' }
    : formatRemoteCli(response)
  return {
    stdout: formatted.stdout,
    stderr: formatted.stderr,
    exitCode: getRemoteCliExitCode(response)
  }
}
