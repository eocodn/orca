import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const runtimeFiles = [
  'src/renderer/src/runtime/abortable-runtime-environment-call.ts',
  'src/renderer/src/runtime/runtime-file-mutation-client.ts',
  'src/renderer/src/runtime/runtime-file-read-client.ts',
  'src/renderer/src/runtime/runtime-file-search-client.ts',
  'src/renderer/src/runtime/runtime-file-watch-client.ts',
  'src/renderer/src/runtime/runtime-client-events.ts',
  'src/renderer/src/runtime/runtime-rpc-client.ts',
  'src/renderer/src/runtime/runtime-rpc-environment-call.ts',
  'src/renderer/src/runtime/runtime-terminal-inspection.ts',
  'src/renderer/src/runtime/runtime-git-ai-client.ts',
  'src/renderer/src/runtime/runtime-git-read-client.ts',
  'src/renderer/src/runtime/runtime-git-remote-links.ts',
  'src/renderer/src/runtime/runtime-git-staging-client.ts',
  'src/renderer/src/runtime/runtime-git-sync-client.ts',
  'src/renderer/src/components/right-sidebar/SourceControl.tsx'
]

async function readRuntimeFile(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8')
}

describe('ClientRuntime renderer boundary', () => {
  it('routes runtime RPC entry points through the explicit ClientRuntime adapter', async () => {
    const sources = await Promise.all(runtimeFiles.map(readRuntimeFile))

    for (const source of sources) {
      expect(source).toMatch(/from ['"](?:\.\/client-runtime|@\/runtime\/client-runtime)['"]/)
      expect(source).not.toMatch(/window\.api\.(?:runtime(?:Environments)?|fs|pty|git)/)
    }
  })

  it('keeps the adapter free of Electron-specific transport calls', async () => {
    const source = await readFile(
      path.join(root, 'src/renderer/src/runtime/client-runtime.ts'),
      'utf8'
    )

    expect(source).not.toMatch(/ipcRenderer|contextBridge|electron/i)
    expect(source).toContain('createClientRuntime')
  })
})
