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
