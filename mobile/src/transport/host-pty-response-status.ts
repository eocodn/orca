import { readHostProtocolEnvelope, type MobileHostProtocolEnvelope } from './host-protocol-status'

export type MobilePtyResponse = {
  envelope: MobileHostProtocolEnvelope
  workspace_id: string
  worker_id: string
  session_id: string
  session_generation: number
  generation: number
  operation: string
  status: 'created' | 'running' | 'exited' | 'failed' | 'closed'
  exit_code: number | null
  output_sequence: number
  tail: string
  failure_reason: string | null
}

export function readPtyResponse(value: unknown): MobilePtyResponse | null {
  if (
    !isRecord(value) ||
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
    return null
  }
  const envelope = readHostProtocolEnvelope(value.envelope)
  if (
    !envelope ||
    envelope.capability !== 'pty' ||
    !isNonEmptyString(value.workspace_id) ||
    !isNonEmptyString(value.worker_id) ||
    !isNonEmptyString(value.session_id) ||
    !isNonNegativeSafeInteger(value.session_generation) ||
    !isNonNegativeSafeInteger(value.generation) ||
    typeof value.operation !== 'string' ||
    !isPtyStatus(value.status) ||
    !isNullableI32(value.exit_code) ||
    !isNonNegativeSafeInteger(value.output_sequence) ||
    typeof value.tail !== 'string' ||
    !isNullableString(value.failure_reason)
  ) {
    return null
  }
  return {
    envelope,
    workspace_id: value.workspace_id,
    worker_id: value.worker_id,
    session_id: value.session_id,
    session_generation: value.session_generation,
    generation: value.generation,
    operation: value.operation,
    status: value.status,
    exit_code: value.exit_code ?? null,
    output_sequence: value.output_sequence,
    tail: value.tail,
    failure_reason: value.failure_reason ?? null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string'
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isNullableI32(value: unknown): value is number | null | undefined {
  return (
    value === undefined ||
    value === null ||
    (Number.isInteger(value) && (value as number) >= -2147483648 && (value as number) <= 2147483647)
  )
}

function isPtyStatus(value: unknown): value is MobilePtyResponse['status'] {
  return (
    value === 'created' ||
    value === 'running' ||
    value === 'exited' ||
    value === 'failed' ||
    value === 'closed'
  )
}
