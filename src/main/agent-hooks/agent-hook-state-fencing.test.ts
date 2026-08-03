import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { makePaneKey } from '../../shared/stable-pane-id'
import { AgentHookServer } from './server'

const PANE_KEY = makePaneKey('fencing-tab', '11111111-1111-4111-8111-111111111111')

describe('agent hook state fencing', () => {
  const servers: AgentHookServer[] = []
  const tempDirs: string[] = []

  afterEach(() => {
    for (const server of servers) {
      server.stop()
    }
    servers.length = 0
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  it('does not let an out-of-order replay replace a live hook status', () => {
    const server = new AgentHookServer()
    servers.push(server)

    server.ingestRemote(
      {
        paneKey: PANE_KEY,
        payload: { state: 'working', prompt: 'new turn', agentType: 'codex' }
      },
      'ssh-1'
    )
    server.ingestRemote(
      {
        paneKey: PANE_KEY,
        isReplay: true,
        payload: { state: 'done', prompt: 'old turn', agentType: 'codex' }
      },
      'ssh-1'
    )

    expect(server.getStatusSnapshotForPane(PANE_KEY)[0]).toMatchObject({
      state: 'working',
      prompt: 'new turn'
    })
  })

  it('rehydrates persisted state idempotently without retaining derived roster entries', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-agent-hook-fencing-'))
    tempDirs.push(userDataPath)
    const endpointDir = join(userDataPath, 'agent-hooks')
    mkdirSync(endpointDir, { recursive: true })
    const receivedAt = Date.now()
    writeFileSync(
      join(endpointDir, 'last-status.json'),
      JSON.stringify({
        version: 2,
        entries: {
          [PANE_KEY]: {
            paneKey: PANE_KEY,
            receivedAt,
            stateStartedAt: receivedAt,
            payload: {
              state: 'working',
              prompt: 'persisted turn',
              agentType: 'claude',
              subagents: [{ id: 'fresh-child', state: 'working', startedAt: receivedAt }]
            }
          }
        }
      }),
      'utf8'
    )

    const server = new AgentHookServer()
    servers.push(server)
    await server.start({ env: 'production', userDataPath })
    const state = server._getStateForTests()
    state.claudeSubagentRosterByPaneKey.get(PANE_KEY)?.set('stale-child', {
      state: 'working',
      startedAt: receivedAt,
      restoredFromSnapshot: true
    })

    const hydrate = (server as unknown as { hydrateLastStatusFromDisk: () => void })
      .hydrateLastStatusFromDisk
    hydrate.call(server)

    expect([...state.claudeSubagentRosterByPaneKey.get(PANE_KEY)!.keys()]).toEqual(['fresh-child'])
  })
})
