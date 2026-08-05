const HOST_PROTOCOL_VERSION = 1
const HOST_PROTOCOL_CAPABILITIES = new Set([
  'workspace.read',
  'workspace.write',
  'terminal',
  'git',
  'file'
])

export type MobileHostProtocolStatus = {
  version: number
  capabilities: string[]
}

export type MobileHostProtocolEnvelope = {
  request_id: string
  capability: string
  protocol_version: number
}

export type MobileGitRequest = {
  envelope: MobileHostProtocolEnvelope
  operation:
    | { type: 'worktree_list'; repository_path: string }
    | { type: 'repository_git_dir'; path: string }
}

export type MobileFileRequest = {
  envelope: MobileHostProtocolEnvelope
  operation: { type: 'read'; path: string } | { type: 'write'; path: string; bytes: number[] }
}

export type MobileTerminalRequest = {
  envelope: MobileHostProtocolEnvelope
  terminal_id: string
  expected_generation: number
  operation:
    | { type: 'start' }
    | { type: 'snapshot' }
    | { type: 'output'; sequence: number; data: string }
    | { type: 'exit'; code: number }
    | { type: 'fail'; reason: string }
    | { type: 'close' }
}

export function readHostProtocolStatus(value: unknown): MobileHostProtocolStatus | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as { version?: unknown; capabilities?: unknown }
  if (
    candidate.version !== HOST_PROTOCOL_VERSION ||
    !Array.isArray(candidate.capabilities) ||
    candidate.capabilities.some(
      (capability) => typeof capability !== 'string' || !HOST_PROTOCOL_CAPABILITIES.has(capability)
    )
  ) {
    return null
  }
  return {
    version: HOST_PROTOCOL_VERSION,
    capabilities: [...candidate.capabilities]
  }
}

export function readHostProtocolEnvelope(value: unknown): MobileHostProtocolEnvelope | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['request_id', 'capability', 'protocol_version'])) {
    return null
  }
  const candidate = value as {
    request_id?: unknown
    capability?: unknown
    protocol_version?: unknown
  }
  if (
    typeof candidate.request_id !== 'string' ||
    candidate.request_id.trim().length === 0 ||
    candidate.protocol_version !== HOST_PROTOCOL_VERSION ||
    typeof candidate.capability !== 'string' ||
    !HOST_PROTOCOL_CAPABILITIES.has(candidate.capability)
  ) {
    return null
  }
  return {
    request_id: candidate.request_id,
    capability: candidate.capability,
    protocol_version: HOST_PROTOCOL_VERSION
  }
}

export function readGitRequest(value: unknown): MobileGitRequest | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as { envelope?: unknown; operation?: unknown }
  const envelope = readHostProtocolEnvelope(candidate.envelope)
  if (!envelope || envelope.capability !== 'git' || !candidate.operation) {
    return null
  }
  if (typeof candidate.operation !== 'object') {
    return null
  }
  const operation = candidate.operation as Record<string, unknown> & {
    type?: unknown
    repository_path?: unknown
    path?: unknown
  }
  if (operation.type === 'worktree_list' && typeof operation.repository_path === 'string') {
    if (operation.repository_path.trim().length === 0) {
      return null
    }
    return {
      envelope,
      operation: {
        type: 'worktree_list',
        repository_path: operation.repository_path
      }
    }
  }
  if (operation.type === 'repository_git_dir' && typeof operation.path === 'string') {
    if (operation.path.trim().length === 0) {
      return null
    }
    return {
      envelope,
      operation: {
        type: 'repository_git_dir',
        path: operation.path
      }
    }
  }
  return null
}

export function readFileRequest(value: unknown): MobileFileRequest | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as { envelope?: unknown; operation?: unknown }
  const envelope = readHostProtocolEnvelope(candidate.envelope)
  if (!envelope || envelope.capability !== 'file' || !candidate.operation) {
    return null
  }
  if (typeof candidate.operation !== 'object') {
    return null
  }
  const operation = candidate.operation as {
    type?: unknown
    path?: unknown
    bytes?: unknown
  }
  if (typeof operation.path !== 'string' || operation.path.trim().length === 0) {
    return null
  }
  if (operation.type === 'read') {
    return { envelope, operation: { type: 'read', path: operation.path } }
  }
  if (
    operation.type === 'write' &&
    Array.isArray(operation.bytes) &&
    operation.bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    return {
      envelope,
      operation: { type: 'write', path: operation.path, bytes: [...operation.bytes] as number[] }
    }
  }
  return null
}

export function readTerminalRequest(value: unknown): MobileTerminalRequest | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['envelope', 'terminal_id', 'expected_generation', 'operation'])
  ) {
    return null
  }
  const candidate = value as {
    envelope?: unknown
    terminal_id?: unknown
    expected_generation?: unknown
    operation?: unknown
  }
  const envelope = readHostProtocolEnvelope(candidate.envelope)
  if (
    !envelope ||
    envelope.capability !== 'terminal' ||
    typeof candidate.terminal_id !== 'string' ||
    candidate.terminal_id.trim().length === 0 ||
    !isNonNegativeSafeInteger(candidate.expected_generation) ||
    !candidate.operation ||
    typeof candidate.operation !== 'object'
  ) {
    return null
  }
  const operation = candidate.operation as Record<string, unknown> & {
    type?: unknown
    sequence?: unknown
    data?: unknown
    code?: unknown
    reason?: unknown
  }
  let parsedOperation: MobileTerminalRequest['operation']
  switch (operation.type) {
    case 'start':
    case 'snapshot':
    case 'close':
      if (!hasOnlyKeys(operation, ['type'])) {
        return null
      }
      parsedOperation = { type: operation.type }
      break
    case 'output':
      if (
        !hasOnlyKeys(operation, ['type', 'sequence', 'data']) ||
        !Number.isSafeInteger(operation.sequence) ||
        (operation.sequence as number) <= 0 ||
        typeof operation.data !== 'string'
      ) {
        return null
      }
      parsedOperation = {
        type: 'output',
        sequence: operation.sequence as number,
        data: operation.data
      }
      break
    case 'exit':
      if (!hasOnlyKeys(operation, ['type', 'code']) || !isI32(operation.code)) {
        return null
      }
      parsedOperation = { type: 'exit', code: operation.code }
      break
    case 'fail':
      if (
        !hasOnlyKeys(operation, ['type', 'reason']) ||
        typeof operation.reason !== 'string' ||
        operation.reason.trim().length === 0
      ) {
        return null
      }
      parsedOperation = { type: 'fail', reason: operation.reason }
      break
    default:
      return null
  }
  return {
    envelope,
    terminal_id: candidate.terminal_id,
    expected_generation: candidate.expected_generation,
    operation: parsedOperation
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
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isI32(value: unknown): value is number {
  return (
    Number.isInteger(value) && (value as number) >= -2147483648 && (value as number) <= 2147483647
  )
}
