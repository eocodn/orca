import { describe, expect, it } from 'vitest'
import { normalizeFolderWorkspaceOperationId } from './folder-workspaces'

describe('normalizeFolderWorkspaceOperationId', () => {
  it('canonicalizes an operation ID at every runtime boundary', () => {
    expect(normalizeFolderWorkspaceOperationId('  operation-1  ')).toBe('operation-1')
  })

  it.each(['   ', 'x'.repeat(257)])('rejects a non-persistable operation ID', (value) => {
    expect(() => normalizeFolderWorkspaceOperationId(value)).toThrow(
      'folder_workspace_operation_id_invalid'
    )
  })
})
