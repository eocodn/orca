import { readHostProtocolEnvelope, type MobileHostProtocolEnvelope } from './host-protocol-status'

export type MobilePtyExecutionTarget =
  | { kind: 'windows-native' }
  | { kind: 'wsl2'; distro: string }
  | { kind: 'ssh'; host: string; shell: 'posix' }

export type MobilePtyOperation =
  | {
      type: 'start'
      program: string
      args: string[]
      current_dir: string | null
      execution_target: MobilePtyExecutionTarget | null
      cols: number
      rows: number
    }
  | { type: 'write'; input: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'poll' }
  | { type: 'wait'; timeout_ms: number }
  | { type: 'terminate' }

export type MobilePtyRequest = {
  envelope: MobileHostProtocolEnvelope
  workspace_id: string
  worker_id: string
  session_id: string
  session_generation: number | null
  operation: MobilePtyOperation
}

export function readPtyRequest(value: unknown): MobilePtyRequest | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'envelope',
      'workspace_id',
      'worker_id',
      'session_id',
      'session_generation',
      'operation'
    ])
  ) {
    return null
  }
  const candidate = value as Record<string, unknown>
  const envelope = readHostProtocolEnvelope(candidate.envelope)
  if (
    !envelope ||
    envelope.capability !== 'pty' ||
    !isNonEmptyString(candidate.workspace_id) ||
    !isNonEmptyString(candidate.worker_id) ||
    !isNonEmptyString(candidate.session_id) ||
    !isNullableNonNegativeSafeInteger(candidate.session_generation) ||
    !isRecord(candidate.operation)
  ) {
    return null
  }
  const operation = readPtyOperation(candidate.operation, candidate.session_generation)
  if (!operation) {
    return null
  }
  return {
    envelope,
    workspace_id: candidate.workspace_id,
    worker_id: candidate.worker_id,
    session_id: candidate.session_id,
    session_generation: candidate.session_generation ?? null,
    operation
  }
}

function readPtyOperation(
  value: Record<string, unknown>,
  sessionGeneration: unknown
): MobilePtyOperation | null {
  if (typeof value.type !== 'string') {
    return null
  }
  switch (value.type) {
    case 'start':
      const executionTarget = readPtyExecutionTarget(value.execution_target)
      if (
        !hasOnlyKeys(value, [
          'type',
          'program',
          'args',
          'current_dir',
          'execution_target',
          'cols',
          'rows'
        ]) ||
        (sessionGeneration !== undefined && sessionGeneration !== null) ||
        !isNonEmptyString(value.program) ||
        (value.args !== undefined &&
          (!Array.isArray(value.args) || !value.args.every((arg) => typeof arg === 'string'))) ||
        (value.current_dir !== undefined &&
          value.current_dir !== null &&
          typeof value.current_dir !== 'string') ||
        (value.execution_target !== undefined &&
          value.execution_target !== null &&
          executionTarget === null) ||
        !isPositiveU16(value.cols) ||
        !isPositiveU16(value.rows)
      ) {
        return null
      }
      return {
        type: 'start',
        program: value.program,
        args: value.args ? [...value.args] : [],
        current_dir: value.current_dir === undefined ? null : value.current_dir,
        execution_target: executionTarget,
        cols: value.cols,
        rows: value.rows
      }
    case 'write':
      return hasOnlyKeys(value, ['type', 'input']) &&
        sessionGeneration !== null &&
        sessionGeneration !== undefined &&
        typeof value.input === 'string'
        ? { type: 'write', input: value.input }
        : null
    case 'resize':
      return hasOnlyKeys(value, ['type', 'cols', 'rows']) &&
        sessionGeneration !== null &&
        sessionGeneration !== undefined &&
        isPositiveU16(value.cols) &&
        isPositiveU16(value.rows)
        ? { type: 'resize', cols: value.cols, rows: value.rows }
        : null
    case 'poll':
      return hasOnlyKeys(value, ['type']) && hasGeneration(sessionGeneration)
        ? { type: 'poll' }
        : null
    case 'wait':
      return hasOnlyKeys(value, ['type', 'timeout_ms']) &&
        hasGeneration(sessionGeneration) &&
        isPositiveSafeInteger(value.timeout_ms) &&
        value.timeout_ms <= 30000
        ? { type: 'wait', timeout_ms: value.timeout_ms }
        : null
    case 'terminate':
      return hasOnlyKeys(value, ['type']) && hasGeneration(sessionGeneration)
        ? { type: 'terminate' }
        : null
    default:
      return null
  }
}

function readPtyExecutionTarget(value: unknown): MobilePtyExecutionTarget | null {
  if (value === undefined || value === null) {
    return null
  }
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return null
  }
  switch (value.kind) {
    case 'windows-native':
    case 'windows_native':
      return { kind: 'windows-native' }
    case 'wsl2':
      return isNonEmptyString(value.distro) && hasOnlyKeys(value, ['kind', 'distro'])
        ? { kind: 'wsl2', distro: value.distro }
        : null
    case 'ssh':
      return isNonEmptyString(value.host) &&
        value.shell === 'posix' &&
        hasOnlyKeys(value, ['kind', 'host', 'shell'])
        ? { kind: 'ssh', host: value.host, shell: 'posix' }
        : null
    default:
      return null
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

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isNullableNonNegativeSafeInteger(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || isNonNegativeSafeInteger(value)
}

function hasGeneration(value: unknown): value is number {
  return isNonNegativeSafeInteger(value)
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function isPositiveU16(value: unknown): value is number {
  return isPositiveSafeInteger(value) && (value as number) <= 65535
}
