import type { RpcClient } from './rpc-client'
import { readTerminalRequest, type MobileTerminalRequest } from './host-protocol-status'
import type { RpcResponse } from './types'

export type MobileTerminalStatus = 'created' | 'running' | 'exited' | 'failed' | 'closed'

export type MobileTerminalOperation = 'start' | 'snapshot' | 'output' | 'exit' | 'fail' | 'close'

export type MobileTerminalResponse = {
  request_id: string
  capability: 'terminal'
  protocol_version: 1
  operation: MobileTerminalOperation
  terminal_id: string
  generation: number
  status: MobileTerminalStatus
  exit_code: number | null
  failure_reason: string | null
  output_sequence: number
  tail: string
}

export function createTerminalStartRequest(
  requestId: string,
  terminalId: string,
  expectedGeneration: number
): MobileTerminalRequest {
  return createTerminalRequest(requestId, terminalId, expectedGeneration, { type: 'start' })
}

export function createTerminalSnapshotRequest(
  requestId: string,
  terminalId: string,
  expectedGeneration: number
): MobileTerminalRequest {
  return createTerminalRequest(requestId, terminalId, expectedGeneration, { type: 'snapshot' })
}

export function createTerminalOutputRequest(
  requestId: string,
  terminalId: string,
  expectedGeneration: number,
  sequence: number,
  data: string
): MobileTerminalRequest {
  return createTerminalRequest(requestId, terminalId, expectedGeneration, {
    type: 'output',
    sequence,
    data
  })
}

export function createTerminalExitRequest(
  requestId: string,
  terminalId: string,
  expectedGeneration: number,
  code: number
): MobileTerminalRequest {
  return createTerminalRequest(requestId, terminalId, expectedGeneration, { type: 'exit', code })
}

export function createTerminalFailRequest(
  requestId: string,
  terminalId: string,
  expectedGeneration: number,
  reason: string
): MobileTerminalRequest {
  return createTerminalRequest(requestId, terminalId, expectedGeneration, { type: 'fail', reason })
}

export function createTerminalCloseRequest(
  requestId: string,
  terminalId: string,
  expectedGeneration: number
): MobileTerminalRequest {
  return createTerminalRequest(requestId, terminalId, expectedGeneration, { type: 'close' })
}

export function readTerminalResponse(value: unknown): MobileTerminalResponse | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'request_id',
      'capability',
      'protocol_version',
      'operation',
      'terminal_id',
      'generation',
      'status',
      'exit_code',
      'failure_reason',
      'output_sequence',
      'tail'
    ])
  ) {
    return null
  }
  const candidate = value as {
    request_id?: unknown
    capability?: unknown
    protocol_version?: unknown
    operation?: unknown
    terminal_id?: unknown
    generation?: unknown
    status?: unknown
    exit_code?: unknown
    failure_reason?: unknown
    output_sequence?: unknown
    tail?: unknown
  }
  if (
    typeof candidate.request_id !== 'string' ||
    candidate.request_id.trim().length === 0 ||
    candidate.capability !== 'terminal' ||
    candidate.protocol_version !== 1 ||
    !isTerminalOperation(candidate.operation) ||
    typeof candidate.terminal_id !== 'string' ||
    candidate.terminal_id.trim().length === 0 ||
    !isNonNegativeSafeInteger(candidate.generation) ||
    !isTerminalStatus(candidate.status) ||
    !isValidExitCode(candidate.status, candidate.exit_code) ||
    !isValidFailureReason(candidate.status, candidate.failure_reason) ||
    !isNonNegativeSafeInteger(candidate.output_sequence) ||
    typeof candidate.tail !== 'string'
  ) {
    return null
  }
  return {
    request_id: candidate.request_id,
    capability: 'terminal',
    protocol_version: 1,
    operation: candidate.operation,
    terminal_id: candidate.terminal_id,
    generation: candidate.generation,
    status: candidate.status,
    exit_code: candidate.exit_code,
    failure_reason: candidate.failure_reason,
    output_sequence: candidate.output_sequence,
    tail: candidate.tail
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

export async function requestTerminal(
  client: Pick<RpcClient, 'sendRequest'>,
  request: MobileTerminalRequest
): Promise<MobileTerminalResponse> {
  if (!readTerminalRequest(request)) {
    throw new Error('Invalid Terminal Host request')
  }
  const response: RpcResponse = await client.sendRequest('host.request', request)
  if (!response.ok) {
    throw new Error(`Host Terminal request failed: ${response.error.code}`)
  }
  const result = readTerminalResponse(response.result)
  if (
    !result ||
    result.request_id !== request.envelope.request_id ||
    result.terminal_id !== request.terminal_id ||
    result.operation !== request.operation.type
  ) {
    throw new Error('Invalid Host Terminal response')
  }
  return result
}

function createTerminalRequest(
  requestId: string,
  terminalId: string,
  expectedGeneration: number,
  operation: MobileTerminalRequest['operation']
): MobileTerminalRequest {
  const request = {
    envelope: {
      request_id: requestId,
      capability: 'terminal' as const,
      protocol_version: 1
    },
    terminal_id: terminalId,
    expected_generation: expectedGeneration,
    operation
  }
  if (!readTerminalRequest(request)) {
    throw new Error('Terminal request fields are invalid')
  }
  return request
}

function isTerminalOperation(value: unknown): value is MobileTerminalOperation {
  return (
    value === 'start' ||
    value === 'snapshot' ||
    value === 'output' ||
    value === 'exit' ||
    value === 'fail' ||
    value === 'close'
  )
}

function isTerminalStatus(value: unknown): value is MobileTerminalStatus {
  return (
    value === 'created' ||
    value === 'running' ||
    value === 'exited' ||
    value === 'failed' ||
    value === 'closed'
  )
}

function isValidFailureReason(status: unknown, value: unknown): value is string | null {
  if (status === 'failed') {
    return typeof value === 'string' && value.trim().length > 0
  }
  if (status === 'closed') {
    return value === null || (typeof value === 'string' && value.trim().length > 0)
  }
  return value === null
}

function isValidExitCode(status: unknown, value: unknown): value is number | null {
  return status === 'exited' ? isI32(value) : value === null
}

function isI32(value: unknown): value is number {
  return (
    Number.isInteger(value) && (value as number) >= -2147483648 && (value as number) <= 2147483647
  )
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}
