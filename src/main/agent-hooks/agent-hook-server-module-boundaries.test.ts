import { describe, expect, it } from 'vitest'

import type {
  AgentHookAuthorityAttestation,
  AgentHookAuthorityEvidence,
  AgentHookProviderSessionIdentity,
  AgentHookSource,
  AgentHookStatusChangeEntry
} from './server'
import { AgentHookServer } from './server'
import { AgentHookServerRuntime } from './agent-hook-server-runtime'

type PublicAgentHookTypes = {
  source: AgentHookSource
  status: AgentHookStatusChangeEntry
  providerSession: AgentHookProviderSessionIdentity
  evidence: AgentHookAuthorityEvidence
  attestation: AgentHookAuthorityAttestation
}

describe('agent hook server split boundaries', () => {
  it('keeps the original server facade and public type imports intact', () => {
    const server = new AgentHookServer()
    const publicTypes: PublicAgentHookTypes | null = null

    expect(publicTypes).toBeNull()
    expect(server).toBeInstanceOf(AgentHookServerRuntime)
    expect(typeof server.ingestRemote).toBe('function')
    expect(typeof server.ingestTerminalStatus).toBe('function')
    expect(typeof server.stop).toBe('function')
  })

  it('keeps persistence lifecycle hooks visible to the runtime layer', () => {
    const runtimeMethods = Object.getOwnPropertyNames(AgentHookServerRuntime.prototype)

    expect(runtimeMethods).toEqual(
      expect.arrayContaining([
        'captureHydratedAuthorityCommitments',
        'flushStatusPersistSync',
        'hydrateLastStatusFromDisk',
        'maybeWriteEndpointFile'
      ])
    )
  })
})
