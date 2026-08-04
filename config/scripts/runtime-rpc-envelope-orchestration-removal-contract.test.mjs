import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')

function readProjectFile(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8')
}

describe('runtime RPC envelope orchestration removal contract', () => {
  it('keeps the shared response envelope free of orchestration metadata', () => {
    const source = readProjectFile('src/shared/runtime-rpc-envelope.ts')
    expect(source).not.toContain('RuntimeOrchestrationEnvelope')
    expect(source).not.toContain('OrchestrationCompatibilityEvidence')
    expect(source).not.toContain('orchestrationCapability')
  })

  it('keeps the remote request serializer free of orchestration fields', () => {
    const source = readProjectFile('src/shared/remote-runtime-request-client.ts')
    expect(source).not.toContain('RuntimeOrchestrationEnvelope')
    for (const field of [
      'orchestrationCapability',
      'orchestrationContractVersion',
      'orchestrationRequestId',
      'compatibilityInvocationId',
      'orchestrationCompatibilityEvidence'
    ]) {
      expect(source).not.toContain(field)
    }
  })

  it('keeps the core RPC request contract free of orchestration fields', () => {
    const source = readProjectFile('src/main/runtime/rpc/core.ts')
    for (const field of [
      'orchestrationCapability',
      'orchestrationContractVersion',
      'orchestrationRequestId',
      'compatibilityInvocationId',
      'orchestrationCompatibilityEvidence'
    ]) {
      expect(source).not.toContain(field)
    }
  })

  it('does not pass an orchestration envelope through environment routing', () => {
    const source = readProjectFile('src/main/ipc/runtime-environment-transport-routing.ts')
    expect(source).not.toContain('RuntimeOrchestrationEnvelope')
    expect(source).not.toMatch(/\benvelope\s*\??\s*:/)
  })
})
