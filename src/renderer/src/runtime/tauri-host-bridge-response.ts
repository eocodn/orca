import type { z } from 'zod'
import type {
  TauriFileRequestArgs,
  TauriFileResult,
  TauriTerminalRequest,
  TauriTerminalResult
} from './tauri-host-bridge-schemas'

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

export function requestError(
  command: string,
  error: z.ZodError | string,
  requestId?: string
): TauriHostBridgeError {
  const message = typeof error === 'string' ? error : error.message
  return new TauriHostBridgeError('invalid_request', message, command, requestId, error)
}

export function parseJsonResponse(command: string, raw: unknown): unknown {
  if (typeof raw !== 'string') {
    throw new TauriHostBridgeError(
      'malformed_response',
      'Tauri command returned a non-string response.',
      command
    )
  }
  try {
    return JSON.parse(raw) as unknown
  } catch (error) {
    throw new TauriHostBridgeError(
      'malformed_response',
      'Tauri command returned invalid JSON.',
      command,
      undefined,
      error
    )
  }
}

export function parseResponse<T>(command: string, raw: unknown, schema: z.ZodType<T>): T {
  const result = schema.safeParse(parseJsonResponse(command, raw))
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

export function normalizeInvokeError(
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

export function correlated<T extends { request_id: string }>(
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

export function correlatedFile(
  result: TauriFileResult,
  request: Pick<TauriFileRequestArgs, 'requestId' | 'operation' | 'path'>,
  command: string
): TauriFileResult {
  if (result.operation !== request.operation || result.path !== request.path) {
    throw new TauriHostBridgeError(
      'correlation_mismatch',
      'Tauri file response does not match the requested operation or path.',
      command,
      request.requestId
    )
  }
  return correlated(result, request.requestId, command)
}

export function correlatedTerminal(
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
