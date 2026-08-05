export const HOST_PROTOCOL_VERSION = 1 as const

export const HOST_PROTOCOL_CAPABILITIES = [
  'workspace.read',
  'workspace.write',
  'terminal',
  'pty',
  'git',
  'file'
] as const

export type HostProtocolCapability = (typeof HOST_PROTOCOL_CAPABILITIES)[number]

export type HostProtocolDescriptor = {
  version: typeof HOST_PROTOCOL_VERSION
  capabilities: readonly HostProtocolCapability[]
}

export type HostProtocolValidation =
  | { ok: true; descriptor: HostProtocolDescriptor }
  | { ok: false; reason: 'missing' | 'unsupported-version' | 'invalid-capabilities' }

export type HostProtocolEnvelope = {
  request_id: string
  capability: HostProtocolCapability
  protocol_version: number
}

export type HostProtocolEnvelopeValidation =
  | { ok: true; envelope: HostProtocolEnvelope }
  | {
      ok: false
      reason: 'missing' | 'empty-request-id' | 'unsupported-version' | 'invalid-capability'
    }

export type HostTerminalStatus = 'created' | 'running' | 'exited' | 'failed' | 'closed'

export type HostTerminalOperation =
  | { type: 'start' }
  | { type: 'snapshot' }
  | { type: 'output'; sequence: number; data: string }
  | { type: 'exit'; code: number }
  | { type: 'fail'; reason: string }
  | { type: 'close' }

export type HostTerminalRequest = {
  envelope: HostProtocolEnvelope & { capability: 'terminal'; protocol_version: 1 }
  terminal_id: string
  expected_generation: number
  operation: HostTerminalOperation
}

export type HostTerminalRequestValidation =
  | { ok: true; request: HostTerminalRequest }
  | {
      ok: false
      reason:
        | 'missing'
        | 'invalid-envelope'
        | 'empty-request-id'
        | 'unsupported-version'
        | 'invalid-capability'
        | 'empty-terminal-id'
        | 'invalid-generation'
        | 'invalid-operation'
        | 'invalid-output-sequence'
        | 'invalid-output-data'
        | 'invalid-exit-code'
        | 'empty-failure-reason'
    }

export type HostTerminalOperationValidation =
  | { ok: true; operation: HostTerminalOperation }
  | {
      ok: false
      reason:
        | 'missing'
        | 'invalid-operation'
        | 'invalid-output-sequence'
        | 'invalid-output-data'
        | 'invalid-exit-code'
        | 'empty-failure-reason'
    }

export function getHostProtocolDescriptor(): HostProtocolDescriptor {
  return {
    version: HOST_PROTOCOL_VERSION,
    capabilities: HOST_PROTOCOL_CAPABILITIES
  }
}

export function validateHostProtocol(value: unknown): HostProtocolValidation {
  if (!value || typeof value !== 'object') {
    return { ok: false, reason: 'missing' }
  }
  const candidate = value as { version?: unknown; capabilities?: unknown }
  if (candidate.version !== HOST_PROTOCOL_VERSION) {
    return { ok: false, reason: 'unsupported-version' }
  }
  if (
    !Array.isArray(candidate.capabilities) ||
    candidate.capabilities.some(
      (capability) =>
        typeof capability !== 'string' ||
        !(HOST_PROTOCOL_CAPABILITIES as readonly string[]).includes(capability)
    )
  ) {
    return { ok: false, reason: 'invalid-capabilities' }
  }
  return {
    ok: true,
    descriptor: {
      version: HOST_PROTOCOL_VERSION,
      capabilities: candidate.capabilities as HostProtocolCapability[]
    }
  }
}

export function validateHostProtocolEnvelope(value: unknown): HostProtocolEnvelopeValidation {
  if (!isRecord(value)) {
    return { ok: false, reason: 'missing' }
  }
  if (!hasOnlyKeys(value, ['request_id', 'capability', 'protocol_version'])) {
    return { ok: false, reason: 'missing' }
  }
  const candidate = value as {
    request_id?: unknown
    capability?: unknown
    protocol_version?: unknown
  }
  if (typeof candidate.request_id !== 'string' || candidate.request_id.trim().length === 0) {
    return { ok: false, reason: 'empty-request-id' }
  }
  if (candidate.protocol_version !== HOST_PROTOCOL_VERSION) {
    return { ok: false, reason: 'unsupported-version' }
  }
  if (
    typeof candidate.capability !== 'string' ||
    !(HOST_PROTOCOL_CAPABILITIES as readonly string[]).includes(candidate.capability)
  ) {
    return { ok: false, reason: 'invalid-capability' }
  }
  return {
    ok: true,
    envelope: {
      request_id: candidate.request_id,
      capability: candidate.capability as HostProtocolCapability,
      protocol_version: HOST_PROTOCOL_VERSION
    }
  }
}

export function validateHostTerminalOperation(value: unknown): HostTerminalOperationValidation {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return { ok: false, reason: 'missing' }
  }

  switch (value.type) {
    case 'start':
    case 'snapshot':
    case 'close':
      return hasOnlyKeys(value, ['type'])
        ? { ok: true, operation: { type: value.type } }
        : { ok: false, reason: 'invalid-operation' }
    case 'output':
      if (!hasOnlyKeys(value, ['type', 'sequence', 'data'])) {
        return { ok: false, reason: 'invalid-operation' }
      }
      if (!isPositiveSafeInteger(value.sequence)) {
        return { ok: false, reason: 'invalid-output-sequence' }
      }
      if (typeof value.data !== 'string') {
        return { ok: false, reason: 'invalid-output-data' }
      }
      return { ok: true, operation: { type: 'output', sequence: value.sequence, data: value.data } }
    case 'exit':
      if (!hasOnlyKeys(value, ['type', 'code'])) {
        return { ok: false, reason: 'invalid-operation' }
      }
      if (!isI32(value.code)) {
        return { ok: false, reason: 'invalid-exit-code' }
      }
      return { ok: true, operation: { type: 'exit', code: value.code } }
    case 'fail':
      if (!hasOnlyKeys(value, ['type', 'reason'])) {
        return { ok: false, reason: 'invalid-operation' }
      }
      if (typeof value.reason !== 'string' || value.reason.trim().length === 0) {
        return { ok: false, reason: 'empty-failure-reason' }
      }
      return { ok: true, operation: { type: 'fail', reason: value.reason } }
    default:
      return { ok: false, reason: 'invalid-operation' }
  }
}

export function validateHostTerminalRequest(value: unknown): HostTerminalRequestValidation {
  if (!isRecord(value)) {
    return { ok: false, reason: 'missing' }
  }
  if (!hasOnlyKeys(value, ['envelope', 'terminal_id', 'expected_generation', 'operation'])) {
    return { ok: false, reason: 'invalid-operation' }
  }

  const envelope = validateHostProtocolEnvelope(value.envelope)
  if (!envelope.ok) {
    return envelope.reason === 'missing'
      ? { ok: false, reason: 'invalid-envelope' }
      : { ok: false, reason: envelope.reason }
  }
  if (envelope.envelope.capability !== 'terminal') {
    return { ok: false, reason: 'invalid-capability' }
  }
  if (typeof value.terminal_id !== 'string' || value.terminal_id.trim().length === 0) {
    return { ok: false, reason: 'empty-terminal-id' }
  }
  if (!isNonNegativeSafeInteger(value.expected_generation)) {
    return { ok: false, reason: 'invalid-generation' }
  }

  const operation = validateHostTerminalOperation(value.operation)
  if (!operation.ok) {
    return operation
  }
  return {
    ok: true,
    request: {
      envelope: {
        request_id: envelope.envelope.request_id,
        capability: 'terminal',
        protocol_version: HOST_PROTOCOL_VERSION
      },
      terminal_id: value.terminal_id,
      expected_generation: value.expected_generation,
      operation: operation.operation
    }
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

function isI32(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= -2147483648 &&
    value <= 2147483647
  )
}
