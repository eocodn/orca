import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')
const read = (path) => readFileSync(resolve(projectDir, path), 'utf8')

describe('renderer runtime export closure', () => {
  it('does not retain the retired Grok accounts web capability', () => {
    const webDir = resolve(projectDir, 'src/renderer/src/web')
    const offenders = readdirSync(webDir)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))
      .filter((name) =>
        readFileSync(resolve(webDir, name), 'utf8').includes('createGrokAccountsApi')
      )
    expect(offenders).toEqual([])
  })

  it('keeps runtime git status in the read client owner', () => {
    const client = read('src/renderer/src/runtime/runtime-git-read-client.ts')
    expect(client).toContain('export async function getRuntimeGitStatus(')
    expect(client).toContain("'git.status'")
    expect(client).toContain('callLocalGitStatus(')
  })

  it('imports web-session activity from the transport owner', () => {
    const browserCreation = read('src/renderer/src/runtime/web-runtime-session-browser-creation.ts')
    expect(browserCreation).toMatch(
      /import \{[\s\S]*?isWebRuntimeSessionActive,[\s\S]*?\} from '\.\/web-runtime-session-transport'/
    )
    expect(browserCreation).not.toMatch(
      /import \{[\s\S]*?isWebRuntimeSessionActive,[\s\S]*?\} from '\.\/web-runtime-session-terminal-creation'/
    )
  })

  it('re-exports tracking contracts as types rather than runtime values', () => {
    const reconciliation = read('src/renderer/src/runtime/web-session-tabs-reconciliation.ts')
    expect(reconciliation).toContain('export type {')
    for (const name of [
      'SessionTabsStreamEvent',
      'SessionTabsListAllResult',
      'SnapshotFreshness',
      'TerminalSurface',
      'WebSessionTabsSyncState'
    ]) {
      expect(reconciliation).toMatch(new RegExp(`export type \\{[\\s\\S]*?\\b${name}\\b`))
    }
  })
})
