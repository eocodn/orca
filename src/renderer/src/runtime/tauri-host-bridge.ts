import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import type { z } from 'zod'
import {
  FileRequestArgsSchema,
  FileResultSchema,
  GitResultSchema,
  GitWorktreeListArgsSchema,
  HostStatusArgsSchema,
  HostStatusSchema,
  RegisterWorkspaceArgsSchema,
  TerminalRequestSchema,
  TerminalResultSchema,
  type TauriFileRequestArgs,
  type TauriFileResult,
  type TauriGitWorktreeListArgs,
  type TauriGitWorktreeListResult,
  type TauriHostStatus,
  type TauriRegisterWorkspaceArgs,
  type TauriTerminalRequest,
  type TauriTerminalResult
} from './tauri-host-bridge-schemas'

/** Tauri command names are an explicit allow-list; pty_request is intentionally absent. */
export const TAURI_HOST_COMMANDS = Object.freeze({
  hostStatus: 'host_status',
  registerWorkspace: 'register_workspace',
  gitWorktreeList: 'git_worktree_list',
  fileRequest: 'file_request',
  terminalRequest: 'terminal_request'
} as const)

export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export type TauriHostBridgeErrorCode =
  | 'capability_unavailable'
  | 'invalid_request'
  | 'malformed_response'
  | 'correlation_mismatch'
  | 'invoke_failed'
  | (string & {})

export class TauriHostBridgeError extends Error {
  readonly name = 'TauriHostBridgeError'

  constructor(
    readonly code: TauriHostBridgeErrorCode,
    message: string,
    readonly command: string,
    readonly requestId?: string,
    readonly cause?: unknown
  ) {
    super(message)
  }
}

export type TauriHostBridge = {
  hostStatus: (stateDb: string) => Promise<TauriHostStatus>
  registerWorkspace: (args: TauriRegisterWorkspaceArgs) => Promise<TauriHostStatus>
  gitWorktreeList: (args: TauriGitWorktreeListArgs) => Promise<TauriGitWorktreeListResult>
  fileRequest: (args: TauriFileRequestArgs) => Promise<TauriFileResult>
  terminalRequest: (request: TauriTerminalRequest) => Promise<TauriTerminalResult>
}

function requestError(command: string, error: z.ZodError): TauriHostBridgeError {
  return new TauriHostBridgeError('invalid_request', error.message, command, undefined, error)
}

function parseResponse<T>(command: string, raw: unknown, schema: z.ZodType<T>): T {
  if (typeof raw !== 'string') {
    throw new TauriHostBridgeError(
      'malformed_response',
      'Tauri command returned a non-string response.',
      command
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new TauriHostBridgeError(
      'malformed_response',
      'Tauri command returned invalid JSON.',
      command,
      undefined,
      error
    )
  }
  const result = schema.safeParse(parsed)
  if (!result.success) {
    throw new TauriHostBridgeError(
      'malformed_response',
      result.error.message,
      command,
      undefined,
      result.error
    )
  }
  return result.data
}

function normalizeInvokeError(
  command: string,
  error: unknown,
  requestId?: string
): TauriHostBridgeError {
  if (error instanceof TauriHostBridgeError) {
    return error
  }
  const objectError =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown; message?: unknown })
      : undefined
  const code =
    typeof error === 'string' && /^[a-z][a-z0-9_]*$/.test(error)
      ? error
      : typeof objectError?.code === 'string' && /^[a-z][a-z0-9_]*$/.test(objectError.code)
        ? objectError.code
        : 'invoke_failed'
  const message =
    typeof error === 'string'
      ? error
      : typeof objectError?.message === 'string'
        ? objectError.message
        : 'Tauri command invocation failed.'
  return new TauriHostBridgeError(code, message, command, requestId, error)
}

function correlated<T extends { request_id: string }>(
  result: T,
  requestId: string,
  command: string
): T {
  if (result.request_id !== requestId) {
    throw new TauriHostBridgeError(
      'correlation_mismatch',
      `Tauri response request_id ${result.request_id} does not match ${requestId}.`,
      command,
      requestId
    )
  }
  return result
}

function correlatedFile(
  result: TauriFileResult,
  request: Pick<TauriFileRequestArgs, 'requestId' | 'operation' | 'path'>,
  command: string
): TauriFileResult {
  const requestId = request.requestId
  if (result.operation !== request.operation || result.path !== request.path) {
    throw new TauriHostBridgeError(
      'correlation_mismatch',
      'Tauri file response does not match the requested operation or path.',
      command,
      requestId
    )
  }
  return correlated(result, requestId, command)
}

function correlatedTerminal(
  result: TauriTerminalResult,
  request: TauriTerminalRequest,
  command: string
): TauriTerminalResult {
  const requestId = request.envelope.request_id
  if (result.terminal_id !== request.terminal_id || result.operation !== request.operation.type) {
    throw new TauriHostBridgeError(
      'correlation_mismatch',
      'Tauri terminal response does not match the requested terminal or operation.',
      command,
      requestId
    )
  }
  return correlated(result, requestId, command)
}

function withOptionalArgs<T extends Record<string, unknown>>(args: T): T {
  return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined)) as T
}

export function createTauriHostBridge(
  invoke: TauriInvoke = tauriInvoke as TauriInvoke
): TauriHostBridge {
  const invokeJson = async (
    command: string,
    args: Record<string, unknown>,
    requestId?: string
  ): Promise<unknown> => {
    let raw: unknown
    try {
      raw = await invoke<string>(command, args)
    } catch (error) {
      throw normalizeInvokeError(command, error, requestId)
    }
    return raw
  }

  return {
    async hostStatus(stateDb) {
      const parsed = HostStatusArgsSchema.safeParse({ stateDb })
      if (!parsed.success) {
        throw requestError(TAURI_HOST_COMMANDS.hostStatus, parsed.error)
      }
      return parseResponse(
        TAURI_HOST_COMMANDS.hostStatus,
        await invokeJson(TAURI_HOST_COMMANDS.hostStatus, parsed.data),
        HostStatusSchema
      )
    },

    async registerWorkspace(input) {
      const parsed = RegisterWorkspaceArgsSchema.safeParse(input)
      if (!parsed.success) {
        throw requestError(TAURI_HOST_COMMANDS.registerWorkspace, parsed.error)
      }
      const args = withOptionalArgs(parsed.data)
      return parseResponse(
        TAURI_HOST_COMMANDS.registerWorkspace,
        await invokeJson(TAURI_HOST_COMMANDS.registerWorkspace, args),
        HostStatusSchema
      )
    },

    async gitWorktreeList(input) {
      const parsed = GitWorktreeListArgsSchema.safeParse(input)
      if (!parsed.success) {
        throw requestError(TAURI_HOST_COMMANDS.gitWorktreeList, parsed.error)
      }
      const args = withOptionalArgs(parsed.data)
      const result = parseResponse(
        TAURI_HOST_COMMANDS.gitWorktreeList,
        await invokeJson(TAURI_HOST_COMMANDS.gitWorktreeList, args, parsed.data.requestId),
        GitResultSchema
      )
      return correlated(result, parsed.data.requestId, TAURI_HOST_COMMANDS.gitWorktreeList)
    },

    async fileRequest(input) {
      const bytes = input.bytes === undefined ? [] : Array.from(input.bytes)
      const parsed = FileRequestArgsSchema.safeParse({ ...input, bytes })
      if (!parsed.success) {
        throw requestError(TAURI_HOST_COMMANDS.fileRequest, parsed.error)
      }
      const result = parseResponse(
        TAURI_HOST_COMMANDS.fileRequest,
        await invokeJson(TAURI_HOST_COMMANDS.fileRequest, parsed.data, parsed.data.requestId),
        FileResultSchema
      )
      return correlatedFile(result, parsed.data, TAURI_HOST_COMMANDS.fileRequest)
    },

    async terminalRequest(input) {
      const parsed = TerminalRequestSchema.safeParse(input)
      if (!parsed.success) {
        throw requestError(TAURI_HOST_COMMANDS.terminalRequest, parsed.error)
      }
      const result = parseResponse(
        TAURI_HOST_COMMANDS.terminalRequest,
        await invokeJson(
          TAURI_HOST_COMMANDS.terminalRequest,
          { request: parsed.data },
          parsed.data.envelope.request_id
        ),
        TerminalResultSchema
      )
      return correlatedTerminal(result, parsed.data, TAURI_HOST_COMMANDS.terminalRequest)
    }
  }
}
