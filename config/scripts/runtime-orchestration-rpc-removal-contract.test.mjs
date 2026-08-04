import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '../..')
const methodsDirectory = resolve(projectRoot, 'src/main/runtime/rpc/methods')
const rpcDirectory = resolve(projectRoot, 'src/main/runtime/rpc')

function readProjectFile(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8')
}

describe('runtime orchestration RPC removal contract', () => {
  it('does not register an orchestration RPC method group', () => {
    const source = readProjectFile('src/main/runtime/rpc/methods/index.ts')

    expect(source).not.toContain("from './orchestration'")
    expect(source).not.toContain('ORCHESTRATION_METHODS')
  })

  it('removes every orchestration-only RPC method module', () => {
    const files = readdirSync(methodsDirectory)
    expect(files.filter((file) => file.startsWith('orchestration'))).toEqual([])
  })

  it('keeps the RPC manifest free of orchestration methods', async () => {
    const { ALL_RPC_METHODS } = await import(
      resolve(projectRoot, 'src/main/runtime/rpc/methods/index.ts')
    )

    expect(ALL_RPC_METHODS.some(({ name }) => name.startsWith('orchestration.'))).toBe(false)
  })

  it('does not retain the removed orchestration method directory surface', () => {
    expect(existsSync(resolve(methodsDirectory, 'orchestration.ts'))).toBe(false)
  })

  it('does not retain orchestration-specific dispatcher modules', () => {
    const files = readdirSync(rpcDirectory)
    expect(files.filter((file) => file.startsWith('orchestration'))).toEqual([])

    const dispatcher = readProjectFile('src/main/runtime/rpc/dispatcher.ts')
    expect(dispatcher).not.toContain('OrchestrationLegacyCompatibility')
    expect(dispatcher).not.toContain('OrchestrationMutationExecutor')
    expect(dispatcher).not.toContain('orchestrationMigrationFence')
  })
})
