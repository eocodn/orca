import { describe, expect, it, vi } from 'vitest'
import {
  createFileReadRequest,
  createFileWriteRequest,
  readFileResponse,
  requestFile
} from './host-file-transport'

describe('mobile Host File transport', () => {
  it('creates strict versioned read and write requests', () => {
    expect(createFileReadRequest('request-read', 'C:\\workspaces\\note.txt')).toEqual({
      envelope: { request_id: 'request-read', capability: 'file', protocol_version: 1 },
      operation: { type: 'read', path: 'C:\\workspaces\\note.txt' }
    })
    expect(createFileWriteRequest('request-write', '/workspace/note.txt', [1, 2])).toEqual({
      envelope: { request_id: 'request-write', capability: 'file', protocol_version: 1 },
      operation: { type: 'write', path: '/workspace/note.txt', bytes: [1, 2] }
    })
  })

  it('rejects malformed authoritative responses', () => {
    expect(readFileResponse({ request_id: 'request-read', capability: 'file' })).toBeNull()
    expect(
      readFileResponse({
        request_id: 'request-read',
        capability: 'file',
        operation: 'read',
        path: '/note.txt',
        bytes: [256],
        bytes_written: 0,
        changed: false
      })
    ).toBeNull()
    expect(
      readFileResponse({
        request_id: 'request-write',
        capability: 'file',
        operation: 'write',
        path: '/note.txt',
        bytes: [1],
        bytes_written: 1,
        changed: true
      })
    ).toBeNull()
  })

  it('sends a file request and validates the matching response', async () => {
    const client = {
      sendRequest: vi.fn().mockResolvedValue({
        id: 'rpc-1',
        ok: true,
        result: {
          request_id: 'request-read',
          capability: 'file',
          operation: 'read',
          path: '/note.txt',
          bytes: [65, 66],
          bytes_written: 0,
          changed: false
        }
      })
    }
    const request = createFileReadRequest('request-read', '/note.txt')

    await expect(requestFile(client, request)).resolves.toEqual({
      request_id: 'request-read',
      capability: 'file',
      operation: 'read',
      path: '/note.txt',
      bytes: [65, 66],
      bytes_written: 0,
      changed: false
    })
    expect(client.sendRequest).toHaveBeenCalledWith('host.request', request)
  })
})
