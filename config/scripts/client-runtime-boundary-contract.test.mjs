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
  'src/renderer/src/runtime/runtime-repo-client.ts',
  'src/renderer/src/runtime/runtime-git-ai-client.ts',
  'src/renderer/src/runtime/runtime-git-read-client.ts',
  'src/renderer/src/runtime/runtime-git-remote-links.ts',
  'src/renderer/src/runtime/runtime-git-staging-client.ts',
  'src/renderer/src/runtime/runtime-git-sync-client.ts',
  'src/renderer/src/runtime/runtime-graph-window-publisher.ts',
  'src/renderer/src/runtime/web-runtime-session-terminal-creation.ts',
  'src/renderer/src/runtime/web-runtime-session-terminal-operations.ts',
  'src/renderer/src/runtime/web-session-tabs-sync-hook.ts',
  'src/renderer/src/runtime/remote-runtime-terminal-stream.ts',
  'src/renderer/src/runtime/web-session-terminal-orphan-recovery.ts',
  'src/renderer/src/runtime/runtime-jira-payload-stream.ts',
  'src/renderer/src/runtime/runtime-provider-accounts-client.ts',
  'src/renderer/src/components/right-sidebar/SourceControl.tsx',
  'src/renderer/src/app-shell-page-session-effects.ts',
  'src/renderer/src/app-shell-page-startup-effects.ts',
  'src/renderer/src/hooks/ipc-events-session.ts'
]

const sessionFiles = [
  'src/renderer/src/app-shell-page-session-effects.ts',
  'src/renderer/src/app-shell-page-startup-effects.ts',
  'src/renderer/src/hooks/ipc-events-session.ts',
  'src/renderer/src/components/terminal-pane/terminal-pane-lifecycle-policies.ts'
]

const terminalFiles = [
  'src/renderer/src/components/terminal-pane/pty-ipc-transport-context.ts',
  'src/renderer/src/components/terminal-pane/pty-ipc-transport-connection.ts',
  'src/renderer/src/components/terminal-pane/pty-ipc-transport-controls.ts',
  'src/renderer/src/components/terminal-pane/pty-ipc-transport-lifecycle.ts',
  'src/renderer/src/components/terminal-pane/pty-buffer-serializer.ts',
  'src/renderer/src/components/terminal-pane/pty-dispatcher.ts',
  'src/renderer/src/components/terminal-pane/resolve-split-cwd.ts',
  'src/renderer/src/components/terminal-pane/terminal-pane-lifecycle-effects.ts',
  'src/renderer/src/components/terminal-pane/terminal-pane-lifecycle-policies.ts',
  'src/renderer/src/components/terminal-pane/terminal-pty-ack-gate.ts',
  'src/renderer/src/components/terminal-pane/terminal-view-attributes-publisher.ts'
]

async function readRuntimeFile(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8')
}

describe('ClientRuntime renderer boundary', () => {
  it('routes runtime RPC entry points through the explicit ClientRuntime adapter', async () => {
    const sources = await Promise.all(runtimeFiles.map(readRuntimeFile))

    for (const source of sources) {
      expect(source).toMatch(
        /from ['"](?:\.\/client-runtime|\.\/runtime\/client-runtime|\.\.\/runtime\/client-runtime|\.\.\/\.\.\/runtime\/client-runtime|@\/runtime\/client-runtime)['"]/
      )
      expect(source).not.toMatch(
        /window\.api\.(?:runtime(?:Environments)?|fs|pty|git|session|repos)/
      )
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

  it('routes session persistence and scrollback through the session adapter', async () => {
    const sources = await Promise.all(sessionFiles.map(readRuntimeFile))

    for (const source of sources) {
      expect(source).toMatch(
        /from ['"](?:\.\/client-runtime|\.\/runtime\/client-runtime|\.\.\/runtime\/client-runtime|\.\.\/\.\.\/runtime\/client-runtime|@\/runtime\/client-runtime)['"]/
      )
      expect(source).not.toMatch(/window\.api\.session/)
    }
  })

  it('routes terminal transport and lifecycle calls through the terminal adapter', async () => {
    const sources = await Promise.all(terminalFiles.map(readRuntimeFile))

    for (const source of sources) {
      expect(source).toMatch(
        /from ['"](?:\.\/client-runtime|\.\/runtime\/client-runtime|\.\.\/runtime\/client-runtime|\.\.\/\.\.\/runtime\/client-runtime|@\/runtime\/client-runtime)['"]/
      )
      expect(source).not.toMatch(/window\.api\.pty/)
    }
  })
})
