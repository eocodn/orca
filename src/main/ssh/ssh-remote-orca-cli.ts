import type { CliStatusResult, RuntimeStatus } from '../../shared/runtime-types'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import type { RpcResponse } from '../runtime/rpc/core'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  HostCliUnavailableError,
  runHostOrcaCliPassthrough,
  type HostCliPassthroughOptions,
  type RemoteOrcaCliRequest,
  type RemoteOrcaCliResult
} from './ssh-remote-cli-host-passthrough'
import { RemoteCliArgumentError, type ParsedRemoteCli } from './ssh-remote-cli-argument-error'
import {
  optionalRemoteCliNumber,
  optionalRemoteCliString,
  parseRemoteCliArgs
} from './ssh-remote-cli-args'
import { buildRemoteCliError } from './ssh-remote-cli-error-response'
import { getRemoteLinearHelp, tryDispatchRemoteLinearCli } from './ssh-remote-linear-cli'
import { formatInProcessRemoteCliResult } from './ssh-remote-cli-in-process-result'

export type { RemoteOrcaCliRequest, RemoteOrcaCliResult } from './ssh-remote-cli-host-passthrough'

// Why: these commands run a foreground/interactive process attached to the
// caller's TTY (or a local tmux pane), which a buffered one-shot relay bridge
// cannot host. Everything else routes through the full host CLI.
const HOST_INTERACTIVE_COMMANDS: Record<string, string> = {
  serve:
    'orca serve starts a foreground headless Orca server and cannot run through the SSH relay bridge. Run it directly on the machine that should host Orca.',
  'claude-teams':
    'orca claude-teams starts an interactive Claude Code session and cannot run through the SSH relay bridge. Run it in a terminal on the Orca host machine.',
  'agent-teams-tmux':
    'orca agent-teams-tmux is a tmux pane shim for the Orca host machine and cannot run through the SSH relay bridge.',
  'account add':
    'orca account add runs an interactive agent login and cannot run through the buffered SSH relay bridge. Run it directly in a terminal on the Orca host machine.'
}

export async function runRemoteOrcaCli(
  runtime: OrcaRuntimeService,
  request: RemoteOrcaCliRequest,
  passthroughOptions?: HostCliPassthroughOptions
): Promise<RemoteOrcaCliResult> {
  const parsed = parseRemoteCliArgs(request.argv)
  const json = parsed.flags.has('json')
  const command = parsed.commandPath.join(' ')

  const interactiveMessage =
    HOST_INTERACTIVE_COMMANDS[command] ?? HOST_INTERACTIVE_COMMANDS[parsed.commandPath[0] ?? '']
  if (interactiveMessage && !parsed.flags.has('help')) {
    if (json) {
      return {
        stdout: `${JSON.stringify(buildRemoteCliError(interactiveMessage, 'unsupported_over_ssh'), null, 2)}\n`,
        stderr: '',
        exitCode: 1
      }
    }
    return { stdout: '', stderr: `${interactiveMessage}\n`, exitCode: 1 }
  }

  let passthroughFailure: HostCliUnavailableError | null = null
  try {
    return await runHostOrcaCliPassthrough(request, passthroughOptions)
  } catch (err) {
    if (!(err instanceof HostCliUnavailableError)) {
      throw err
    }
    // Why: fall back to the legacy in-process command switch below so the
    // historical read-only surface keeps working even when the
    // bundled CLI entry cannot be launched on this install.
    passthroughFailure = err
  }
  return await runLegacyRemoteOrcaCli(runtime, request, parsed, json, passthroughFailure)
}

async function runLegacyRemoteOrcaCli(
  runtime: OrcaRuntimeService,
  request: RemoteOrcaCliRequest,
  parsed: ParsedRemoteCli,
  json: boolean,
  passthroughFailure: HostCliUnavailableError
): Promise<RemoteOrcaCliResult> {
  const dispatcher = new RpcDispatcher({ runtime })
  const help = getRemoteLinearHelp(parsed)
  if (help) {
    return { stdout: `${help}\n`, stderr: '', exitCode: 0 }
  }

  try {
    const response = await dispatchRemoteCli(
      dispatcher,
      parsed,
      request.env,
      request.stdin,
      passthroughFailure.message
    )
    return formatInProcessRemoteCliResult(parsed, request.env, response, json)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const code =
      err instanceof RemoteCliArgumentError
        ? err.code
        : err instanceof Error &&
            'code' in err &&
            typeof (err as { code: unknown }).code === 'string'
          ? (err as { code: string }).code
          : 'runtime_error'
    if (json) {
      return {
        stdout: `${JSON.stringify(buildRemoteCliError(message, code), null, 2)}\n`,
        stderr: '',
        exitCode: 1
      }
    }
    return { stdout: '', stderr: `${message}\n`, exitCode: 1 }
  }
}

async function dispatchRemoteCli(
  dispatcher: RpcDispatcher,
  parsed: ParsedRemoteCli,
  env: Record<string, string>,
  stdin: string | undefined,
  passthroughFailureReason: string
): Promise<RpcResponse> {
  const command = parsed.commandPath.join(' ')
  const linearResponse = await tryDispatchRemoteLinearCli(dispatcher, parsed, env, stdin)
  if (linearResponse) {
    return linearResponse
  }
  switch (command) {
    case 'status': {
      const response = await call(dispatcher, 'status.get')
      if (!response.ok) {
        return response
      }
      const status = response.result as RuntimeStatus
      const cliStatus: CliStatusResult = {
        app: {
          running: true,
          pid: null,
          ...(status.desktopWindowStatus ? { desktopWindowStatus: status.desktopWindowStatus } : {})
        },
        runtime: {
          state: status.graphStatus === 'ready' ? 'ready' : 'graph_not_ready',
          reachable: true,
          runtimeId: status.runtimeId
        },
        graph: { state: status.graphStatus }
      }
      return { ...response, result: cliStatus }
    }
    case 'terminal list':
      return await call(dispatcher, 'terminal.list', {
        worktree: optionalRemoteCliString(parsed.flags, 'worktree'),
        limit: optionalRemoteCliNumber(parsed.flags, 'limit')
      })
    default:
      // Why: only reachable when the full host CLI could not be launched;
      // include that root cause so users can fix the install instead of
      // assuming the command family is unsupported over SSH.
      throw new Error(
        `Unsupported SSH Orca CLI command: ${command} (full Orca CLI bridge unavailable: ${passthroughFailureReason})`
      )
  }
}

async function call(
  dispatcher: RpcDispatcher,
  method: string,
  params?: Record<string, unknown>
): Promise<RpcResponse> {
  return await dispatcher.dispatch({
    id: `remote-cli-${Date.now()}`,
    authToken: 'remote-cli',
    method,
    params
  })
}
