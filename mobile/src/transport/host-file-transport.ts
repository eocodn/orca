import type { RpcClient } from './rpc-client'
import { readFileRequest, type MobileFileRequest } from './host-protocol-status'
import type { RpcResponse } from './types'

export type MobileFileResponse = {
  request_id: string
  capability: 'file'
  operation: 'read' | 'write'
  path: string
  bytes: number[]
  bytes_written: number
  changed: boolean
}

export function createFileReadRequest(requestId: string, path: string): MobileFileRequest {
  assertFileRequestIdentity(requestId, path)
  return {
    envelope: {
      request_id: requestId,
      capability: 'file',
      protocol_version: 1
    },
    operation: { type: 'read', path }
  }
}

export function createFileWriteRequest(
  requestId: string,
  path: string,
  bytes: number[]
): MobileFileRequest {
  assertFileRequestIdentity(requestId, path)
  if (!bytes.every(isByte)) {
    throw new Error('File write bytes must be unsigned bytes')
  }
  return {
    envelope: {
      request_id: requestId,
      capability: 'file',
      protocol_version: 1
    },
    operation: { type: 'write', path, bytes: [...bytes] }
  }
}

export function readFileResponse(value: unknown): MobileFileResponse | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as {
    request_id?: unknown
    capability?: unknown
    operation?: unknown
    path?: unknown
    bytes?: unknown
    bytes_written?: unknown
    changed?: unknown
  }
  if (
    typeof candidate.request_id !== 'string' ||
    candidate.request_id.trim().length === 0 ||
    candidate.capability !== 'file' ||
    (candidate.operation !== 'read' && candidate.operation !== 'write') ||
    typeof candidate.path !== 'string' ||
    candidate.path.trim().length === 0 ||
    !Array.isArray(candidate.bytes) ||
    !candidate.bytes.every(isByte)
  ) {
    return null
  }
  if (candidate.operation === 'read') {
    if (candidate.bytes_written !== 0 || candidate.changed !== false) {
      return null
    }
  } else if (
    candidate.bytes.length !== 0 ||
    !isNonNegativeInteger(candidate.bytes_written) ||
    typeof candidate.changed !== 'boolean'
  ) {
    return null
  }
  return {
    request_id: candidate.request_id,
    capability: 'file',
    operation: candidate.operation,
    path: candidate.path,
    bytes: [...candidate.bytes],
    bytes_written: candidate.bytes_written as number,
    changed: candidate.changed as boolean
  }
}

export async function requestFile(
  client: Pick<RpcClient, 'sendRequest'>,
  request: MobileFileRequest
): Promise<MobileFileResponse> {
  if (!readFileRequest(request)) {
    throw new Error('Invalid File Host request')
  }
  const response: RpcResponse = await client.sendRequest('host.request', request)
  if (!response.ok) {
    throw new Error(`Host File request failed: ${response.error.code}`)
  }
  const result = readFileResponse(response.result)
  if (
    !result ||
    result.request_id !== request.envelope.request_id ||
    result.operation !== request.operation.type ||
    result.path !== request.operation.path
  ) {
    throw new Error('Invalid Host File response')
  }
  return result
}

function assertFileRequestIdentity(requestId: string, path: string): void {
  if (requestId.trim().length === 0 || path.trim().length === 0) {
    throw new Error('File request id and path are required')
  }
}

function isByte(value: unknown): value is number {
  return Number.isInteger(value) && value >= 0 && value <= 255
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && value >= 0
}
