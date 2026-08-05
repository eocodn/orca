import {
  HOST_PROTOCOL_VERSION,
  type HostProtocolEnvelope,
  validateHostProtocolEnvelope
} from './host-protocol'

export type HostPtyExecutionTarget =
  | { kind: 'windows-native' }
  | { kind: 'wsl2'; distro: string }
  | { kind: 'ssh'; host: string; shell: 'posix' }

export type HostPtyOperation =
  | {
      type: 'start'
      program: string
      args: string[]
      current_dir: string | null
      execution_target: HostPtyExecutionTarget | null
      cols: number
      rows: number
    }
  | { type: 'write'; input: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'poll' }
  | { type: 'wait'; timeout_ms: number }
  | { type: 'terminate' }

export type HostPtyRequest = {
  envelope: HostProtocolEnvelope & { capability: 'pty'; protocol_version: 1 }
  workspace_id: string
  worker_id: string
  session_id: string
  session_generation: number | null
  operation: HostPtyOperation
}

export type HostPtyRequestValidation =
  | { ok: true; request: HostPtyRequest }
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
        | 'empty-program'
        | 'invalid-args'
        | 'invalid-current-dir'
        | 'invalid-execution-target'
        | 'invalid-size'
        | 'invalid-timeout'
        | 'invalid-operation'
    }

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
        | 'invalid-operation'
    }

export function validateHostPtyRequest(value: unknown): HostPtyRequestValidation {
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
      'operation'
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
  const sessionGeneration = value.session_generation === undefined ? null : value.session_generation
  if (sessionGeneration !== null && !isNonNegativeSafeInteger(sessionGeneration)) {
    return { ok: false, reason: 'invalid-session-generation' }
  }

  const operation = validateHostPtyOperation(value.operation)
  if (!operation.ok) {
    return operation
  }
  if (operation.operation.type === 'start') {
    if (sessionGeneration !== null) {
      return { ok: false, reason: 'invalid-session-generation' }
    }
  } else if (sessionGeneration === null) {
    return { ok: false, reason: 'invalid-session-generation' }
  }

  return {
    ok: true,
    request: {
      envelope: {
        request_id: envelope.envelope.request_id,
        capability: 'pty',
        protocol_version: HOST_PROTOCOL_VERSION
      },
      workspace_id: value.workspace_id,
      worker_id: value.worker_id,
      session_id: value.session_id,
      session_generation: sessionGeneration,
      operation: operation.operation
    }
  }
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
  if (
    value.status !== 'created' &&
    value.status !== 'running' &&
    value.status !== 'exited' &&
    value.status !== 'failed' &&
    value.status !== 'closed'
  ) {
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

function validateHostPtyOperation(
  value: unknown
): { ok: true; operation: HostPtyOperation } | Extract<HostPtyRequestValidation, { ok: false }> {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return { ok: false, reason: 'missing' }
  }
  switch (value.type) {
    case 'start': {
      if (
        !hasOnlyKeys(value, [
          'type',
          'program',
          'args',
          'current_dir',
          'execution_target',
          'cols',
          'rows'
        ])
      ) {
        return { ok: false, reason: 'invalid-operation' }
      }
      if (typeof value.program !== 'string' || value.program.trim().length === 0) {
        return { ok: false, reason: 'empty-program' }
      }
      if (
        value.args !== undefined &&
        (!Array.isArray(value.args) || value.args.some((arg) => typeof arg !== 'string'))
      ) {
        return { ok: false, reason: 'invalid-args' }
      }
      if (
        value.current_dir !== undefined &&
        value.current_dir !== null &&
        typeof value.current_dir !== 'string'
      ) {
        return { ok: false, reason: 'invalid-current-dir' }
      }
      const executionTarget = validateHostPtyExecutionTarget(value.execution_target)
      if (!executionTarget.ok) {
        return executionTarget
      }
      if (!isPositiveU16(value.cols) || !isPositiveU16(value.rows)) {
        return { ok: false, reason: 'invalid-size' }
      }
      return {
        ok: true,
        operation: {
          type: 'start',
          program: value.program,
          args: value.args === undefined ? [] : value.args,
          current_dir: value.current_dir === undefined ? null : value.current_dir,
          execution_target: executionTarget.target,
          cols: value.cols,
          rows: value.rows
        }
      }
    }
    case 'write':
      return hasOnlyKeys(value, ['type', 'input']) && typeof value.input === 'string'
        ? { ok: true, operation: { type: 'write', input: value.input } }
        : { ok: false, reason: 'invalid-operation' }
    case 'resize':
      return hasOnlyKeys(value, ['type', 'cols', 'rows']) &&
        isPositiveU16(value.cols) &&
        isPositiveU16(value.rows)
        ? { ok: true, operation: { type: 'resize', cols: value.cols, rows: value.rows } }
        : { ok: false, reason: 'invalid-size' }
    case 'poll':
    case 'terminate':
      return hasOnlyKeys(value, ['type'])
        ? { ok: true, operation: { type: value.type } }
        : { ok: false, reason: 'invalid-operation' }
    case 'wait':
      return hasOnlyKeys(value, ['type', 'timeout_ms']) &&
        isPositiveSafeInteger(value.timeout_ms) &&
        value.timeout_ms <= 30_000
        ? { ok: true, operation: { type: 'wait', timeout_ms: value.timeout_ms } }
        : { ok: false, reason: 'invalid-timeout' }
    default:
      return { ok: false, reason: 'invalid-operation' }
  }
}

function validateHostPtyExecutionTarget(
  value: unknown
):
  | { ok: true; target: HostPtyExecutionTarget | null }
  | Extract<HostPtyRequestValidation, { ok: false }> {
  if (value === undefined || value === null) {
    return { ok: true, target: null }
  }
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return { ok: false, reason: 'invalid-execution-target' }
  }
  switch (value.kind) {
    case 'windows-native':
    case 'windows_native':
      return hasOnlyKeys(value, ['kind'])
        ? { ok: true, target: { kind: 'windows-native' } }
        : { ok: false, reason: 'invalid-execution-target' }
    case 'wsl2':
      return hasOnlyKeys(value, ['kind', 'distro']) &&
        typeof value.distro === 'string' &&
        value.distro.trim().length > 0
        ? { ok: true, target: { kind: 'wsl2', distro: value.distro } }
        : { ok: false, reason: 'invalid-execution-target' }
    case 'ssh':
      return hasOnlyKeys(value, ['kind', 'host', 'shell']) &&
        typeof value.host === 'string' &&
        value.host.trim().length > 0 &&
        value.shell === 'posix'
        ? { ok: true, target: { kind: 'ssh', host: value.host, shell: 'posix' } }
        : { ok: false, reason: 'invalid-execution-target' }
    default:
      return { ok: false, reason: 'invalid-execution-target' }
  }
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

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isPositiveU16(value: unknown): value is number {
  return isPositiveSafeInteger(value) && value <= 65_535
}

function isI32(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= -2147483648 &&
    value <= 2147483647
  )
}
