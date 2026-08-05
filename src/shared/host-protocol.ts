export const HOST_PROTOCOL_VERSION = 1 as const

export const HOST_PROTOCOL_CAPABILITIES = [
  'workspace.read',
  'workspace.write',
  'terminal',
  'git'
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
  if (!value || typeof value !== 'object') {
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
