import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClientError, RuntimeRpcFailureError } from '../runtime/types'

const callMock = vi.fn()

vi.mock('../runtime-client', () => {
  class RuntimeClient {
    readonly isRemote: boolean
    call = callMock
    getCliStatus = vi.fn()
    openOrca = vi.fn()

    constructor(
      _userDataPath?: string,
      _requestTimeoutMs?: number,
      remotePairingCode?: string | null,
      environmentSelector?: string | null
    ) {
      this.isRemote = Boolean(remotePairingCode || environmentSelector)
    }
  }

  return {
    RuntimeClient,
    RuntimeClientError,
    RuntimeRpcFailureError
  }
})

import { main } from '../index'
import { okFixture, queueFixtures } from '../test-fixtures'

const workspace = {
  id: 'folder-1',
  projectGroupId: 'group-1',
  name: 'Docs',
  folderPath: '/srv/docs',
  connectionId: null,
  linkedTask: null,
  comment: '',
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 1,
  lastActivityAt: 0,
  createdAt: 1,
  updatedAt: 1
}

describe('orca folder-workspace CLI', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    callMock.mockReset()
    process.exitCode = undefined
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('lists host-qualified folder workspaces in the JSON envelope', async () => {
    queueFixtures(callMock, okFixture('list-1', { folderWorkspaces: [workspace] }))

    await main(['folder-workspace', 'list', '--json'], '/tmp')

    expect(callMock).toHaveBeenCalledWith('folderWorkspace.list')
    const output = JSON.parse(String(vi.mocked(console.log).mock.calls[0][0]))
    expect(output.result.folderWorkspaces[0]).toMatchObject({
      id: 'folder-1',
      executionHostId: 'local'
    })
    expect(output._meta.runtimeId).toBe('runtime-1')
  })

  it('adds by absolute folder path and verifies the authoritative list', async () => {
    queueFixtures(
      callMock,
      okFixture('create-1', { folderWorkspace: workspace }),
      okFixture('list-2', { folderWorkspaces: [workspace] })
    )

    await main(
      [
        'folder-workspace',
        'add',
        '--project-group',
        'group-1',
        '--path',
        '/srv/docs',
        '--name',
        'Docs',
        '--operation-id',
        'op-1',
        '--json'
      ],
      '/tmp'
    )

    expect(callMock).toHaveBeenNthCalledWith(1, 'folderWorkspace.create', {
      projectGroupId: 'group-1',
      folderPath: '/srv/docs',
      name: 'Docs',
      operationId: 'op-1'
    })
    expect(callMock).toHaveBeenNthCalledWith(2, 'folderWorkspace.list')
    const output = JSON.parse(String(vi.mocked(console.log).mock.calls[0][0]))
    expect(output.result.folderWorkspace).toMatchObject({
      id: 'folder-1',
      executionHostId: 'local'
    })
    expect(output.result.authoritative).toBe(true)
  })

  it('rejects a whitespace-only operation id before contacting the runtime', async () => {
    await main(
      [
        'folder-workspace',
        'add',
        '--project-group',
        'group-1',
        '--path',
        '/srv/docs',
        '--operation-id',
        '   ',
        '--json'
      ],
      '/tmp'
    )

    expect(process.exitCode).toBe(1)
    expect(callMock).not.toHaveBeenCalled()
  })

  it('inspects a workspace on the selected remote runtime', async () => {
    queueFixtures(callMock, okFixture('list-3', { folderWorkspaces: [workspace] }))

    await main(
      [
        'folder-workspace',
        'inspect',
        '--folder-workspace',
        'folder-1',
        '--environment',
        'gpu',
        '--json'
      ],
      '/tmp'
    )

    const output = JSON.parse(String(vi.mocked(console.log).mock.calls[0][0]))
    expect(output.result.folderWorkspace.executionHostId).toBe('runtime:runtime-1')
  })

  it('removes idempotently and verifies absence from authoritative state', async () => {
    queueFixtures(
      callMock,
      okFixture('delete-1', { deleted: true }),
      okFixture('list-4', { folderWorkspaces: [] })
    )

    await main(['folder-workspace', 'remove', '--folder-workspace', 'folder-1', '--json'], '/tmp')

    expect(callMock).toHaveBeenNthCalledWith(1, 'folderWorkspace.delete', {
      folderWorkspaceId: 'folder-1'
    })
    expect(callMock).toHaveBeenNthCalledWith(2, 'folderWorkspace.list')
    const output = JSON.parse(String(vi.mocked(console.log).mock.calls[0][0]))
    expect(output.result).toMatchObject({
      deleted: true,
      folderWorkspaceId: 'folder-1',
      executionHostId: 'local',
      authoritative: true
    })
  })

  it('fails closed when mutation read-back contradicts the requested state', async () => {
    queueFixtures(
      callMock,
      okFixture('delete-2', { deleted: true }),
      okFixture('list-5', { folderWorkspaces: [workspace] })
    )

    await main(['folder-workspace', 'remove', '--folder-workspace', 'folder-1', '--json'], '/tmp')

    expect(process.exitCode).toBe(1)
    const output = JSON.parse(String(vi.mocked(console.log).mock.calls[0][0]))
    expect(output.error.code).toBe('state_conflict')
  })
})
