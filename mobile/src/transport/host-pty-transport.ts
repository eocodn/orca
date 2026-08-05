import {
  validateHostPtyRequest,
  validateHostPtyResponse,
  type HostPtyExecutionTarget,
  type HostPtyOperation,
  type HostPtyRequest,
  type HostPtyResponse
} from '../../../src/shared/host-pty-protocol'
import type { RpcClient } from './rpc-client'
import type { RpcResponse } from './types'

export type HostPtyIdentity = {
  requestId: string
  workspaceId: string
  workerId: string
  sessionId: string
}

export type HostPtySessionIdentity = HostPtyIdentity & {
  sessionGeneration: number
}

export type HostPtyStartOptions = {
  program: string
  args: string[]
  currentDir: string | null
  executionTarget: HostPtyExecutionTarget | null
  cols: number
  rows: number
}

export function createPtyStartRequest(
  identity: HostPtyIdentity,
  options: HostPtyStartOptions
): HostPtyRequest {
  return createPtyRequest(identity, null, {
    type: 'start',
    program: options.program,
    args: [...options.args],
    current_dir: options.currentDir,
    execution_target: options.executionTarget,
    cols: options.cols,
    rows: options.rows
  })
}

export function createPtyWriteRequest(
  identity: HostPtySessionIdentity,
  input: string
): HostPtyRequest {
  return createPtyRequest(identity, identity.sessionGeneration, { type: 'write', input })
}

export function createPtyResizeRequest(
  identity: HostPtySessionIdentity,
  cols: number,
  rows: number
): HostPtyRequest {
  return createPtyRequest(identity, identity.sessionGeneration, { type: 'resize', cols, rows })
}

export function createPtyPollRequest(identity: HostPtySessionIdentity): HostPtyRequest {
  return createPtyRequest(identity, identity.sessionGeneration, { type: 'poll' })
}

export function createPtyWaitRequest(
  identity: HostPtySessionIdentity,
  timeoutMs: number
): HostPtyRequest {
  return createPtyRequest(identity, identity.sessionGeneration, {
    type: 'wait',
    timeout_ms: timeoutMs
  })
}

export function createPtyTerminateRequest(identity: HostPtySessionIdentity): HostPtyRequest {
  return createPtyRequest(identity, identity.sessionGeneration, { type: 'terminate' })
}

export async function requestPty(
  client: Pick<RpcClient, 'sendRequest'>,
  request: HostPtyRequest
): Promise<HostPtyResponse> {
  const requestValidation = validateHostPtyRequest(request)
  if (!requestValidation.ok) {
    throw new Error(`Invalid Host PTY request: ${requestValidation.reason}`)
  }
  const validatedRequest = requestValidation.request
  const response: RpcResponse = await client.sendRequest('host.request', validatedRequest)
  if (!response.ok) {
    throw new Error(`Host PTY request failed: ${response.error.code}`)
  }

  const responseValidation = validateHostPtyResponse(response.result)
  if (!responseValidation.ok) {
    throw new Error(`Invalid Host PTY response: ${responseValidation.reason}`)
  }
  const result = responseValidation.response
  if (
    result.envelope.request_id !== validatedRequest.envelope.request_id ||
    result.workspace_id !== validatedRequest.workspace_id ||
    result.worker_id !== validatedRequest.worker_id ||
    result.session_id !== validatedRequest.session_id ||
    result.operation !== validatedRequest.operation.type
  ) {
    throw new Error('Invalid Host PTY response: correlation mismatch')
  }
  if (
    validatedRequest.operation.type !== 'start' &&
    result.session_generation !== validatedRequest.session_generation
  ) {
    throw new Error('Invalid Host PTY response: session generation mismatch')
  }
  return result
}

function createPtyRequest(
  identity: HostPtyIdentity,
  sessionGeneration: number | null,
  operation: HostPtyOperation
): HostPtyRequest {
  const request: HostPtyRequest = {
    envelope: {
      request_id: identity.requestId,
      capability: 'pty',
      protocol_version: 1
    },
    workspace_id: identity.workspaceId,
    worker_id: identity.workerId,
    session_id: identity.sessionId,
    session_generation: sessionGeneration,
    operation
  }
  const validation = validateHostPtyRequest(request)
  if (!validation.ok) {
    throw new Error(`Invalid Host PTY request: ${validation.reason}`)
  }
  return validation.request
}
