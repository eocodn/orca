const HOST_PROTOCOL_VERSION = 1
const HOST_PROTOCOL_CAPABILITIES = new Set(['workspace.read', 'workspace.write', 'terminal', 'git'])

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
  if (!value || typeof value !== 'object') {
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
  const operation = candidate.operation as {
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
