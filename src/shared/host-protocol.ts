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
