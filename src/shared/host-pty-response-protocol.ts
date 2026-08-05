import {
  HOST_PROTOCOL_VERSION,
  type HostProtocolEnvelope,
  validateHostProtocolEnvelope
} from './host-protocol'

export type HostPtyStatus = 'created' | 'running' | 'exited' | 'failed' | 'closed'

export type HostPtyResponse = {
  envelope: HostProtocolEnvelope & { capability: 'pty'; protocol_version: 1 }
  workspace_id: string
  worker_id: string
  session_id: string
  session_generation: number
  generation: number
  operation: string
  status: HostPtyStatus
  exit_code: number | null
  output_sequence: number
  tail: string
  failure_reason: string | null
}

export type HostPtyResponseValidation =
  | { ok: true; response: HostPtyResponse }
  | {
      ok: false
      reason:
        | 'missing'
        | 'invalid-envelope'
        | 'empty-request-id'
        | 'unsupported-version'
        | 'invalid-capability'
        | 'empty-workspace-id'
        | 'empty-worker-id'
        | 'empty-session-id'
        | 'invalid-session-generation'
        | 'invalid-generation'
        | 'empty-operation'
        | 'invalid-status'
        | 'invalid-exit-code'
        | 'invalid-output-sequence'
        | 'invalid-tail'
        | 'invalid-failure-reason'
        | 'invalid-status-payload'
        | 'invalid-operation'
    }

export function validateHostPtyResponse(value: unknown): HostPtyResponseValidation {
  if (!isRecord(value)) {
    return { ok: false, reason: 'missing' }
  }
  if (
    !hasOnlyKeys(value, [
      'envelope',
      'workspace_id',
      'worker_id',
      'session_id',
      'session_generation',
      'generation',
      'operation',
      'status',
      'exit_code',
      'output_sequence',
      'tail',
      'failure_reason'
    ])
  ) {
    return { ok: false, reason: 'invalid-operation' }
  }
  const envelope = validateHostProtocolEnvelope(value.envelope)
  if (!envelope.ok) {
    return envelope.reason === 'missing'
      ? { ok: false, reason: 'invalid-envelope' }
      : { ok: false, reason: envelope.reason }
  }
  if (envelope.envelope.capability !== 'pty') {
    return { ok: false, reason: 'invalid-capability' }
  }
  if (typeof value.workspace_id !== 'string' || value.workspace_id.trim().length === 0) {
    return { ok: false, reason: 'empty-workspace-id' }
  }
  if (typeof value.worker_id !== 'string' || value.worker_id.trim().length === 0) {
    return { ok: false, reason: 'empty-worker-id' }
  }
  if (typeof value.session_id !== 'string' || value.session_id.trim().length === 0) {
    return { ok: false, reason: 'empty-session-id' }
  }
  if (!isNonNegativeSafeInteger(value.session_generation)) {
    return { ok: false, reason: 'invalid-session-generation' }
  }
  if (!isNonNegativeSafeInteger(value.generation)) {
    return { ok: false, reason: 'invalid-generation' }
  }
  if (typeof value.operation !== 'string') {
    return { ok: false, reason: 'empty-operation' }
  }
  if (!isHostPtyStatus(value.status)) {
    return { ok: false, reason: 'invalid-status' }
  }
  const exitCode = value.exit_code === undefined ? null : value.exit_code
  if (exitCode !== null && !isI32(exitCode)) {
    return { ok: false, reason: 'invalid-exit-code' }
  }
  if (!isNonNegativeSafeInteger(value.output_sequence)) {
    return { ok: false, reason: 'invalid-output-sequence' }
  }
  if (typeof value.tail !== 'string') {
    return { ok: false, reason: 'invalid-tail' }
  }
  const failureReason = value.failure_reason === undefined ? null : value.failure_reason
  if (failureReason !== null && typeof failureReason !== 'string') {
    return { ok: false, reason: 'invalid-failure-reason' }
  }
  if (!hasValidHostPtyOutcome(value.status, exitCode, failureReason)) {
    return { ok: false, reason: 'invalid-status-payload' }
  }
  return {
    ok: true,
    response: {
      envelope: {
        request_id: envelope.envelope.request_id,
        capability: 'pty',
        protocol_version: HOST_PROTOCOL_VERSION
      },
      workspace_id: value.workspace_id,
      worker_id: value.worker_id,
      session_id: value.session_id,
      session_generation: value.session_generation,
      generation: value.generation,
      operation: value.operation,
      status: value.status,
      exit_code: exitCode,
      output_sequence: value.output_sequence,
      tail: value.tail,
      failure_reason: failureReason
    }
  }
}

function hasValidHostPtyOutcome(
  status: HostPtyStatus,
  exitCode: number | null,
  failureReason: string | null
): boolean {
  switch (status) {
    case 'created':
    case 'running':
      return exitCode === null && failureReason === null
    case 'exited':
      return exitCode !== null && failureReason === null
    case 'failed':
      return exitCode === null && failureReason.trim().length > 0
    case 'closed':
      return (
        (exitCode !== null && failureReason === null) ||
        (exitCode === null && failureReason.trim().length > 0)
      )
  }
}

function isHostPtyStatus(value: unknown): value is HostPtyStatus {
  return (
    value === 'created' ||
    value === 'running' ||
    value === 'exited' ||
    value === 'failed' ||
    value === 'closed'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isI32(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= -2147483648 &&
    value <= 2147483647
  )
}
