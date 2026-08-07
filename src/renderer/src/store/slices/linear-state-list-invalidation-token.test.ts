import { describe, expect, it } from 'vitest'
import {
  advanceLinearListInvalidationToken,
  getLinearListInvalidationToken
} from './linear-state-list-invalidation-token'

describe('Linear list invalidation token', () => {
  it('starts neutral and increments within one source scope', () => {
    expect(getLinearListInvalidationToken()).toEqual({ scope: '', version: 0 })
    expect(advanceLinearListInvalidationToken('local')).toEqual({ scope: 'local', version: 1 })
    expect(advanceLinearListInvalidationToken('local')).toEqual({ scope: 'local', version: 2 })
  })

  it('restarts versioning when the source scope changes', () => {
    expect(advanceLinearListInvalidationToken('runtime:one')).toEqual({
      scope: 'runtime:one',
      version: 1
    })
    expect(advanceLinearListInvalidationToken('runtime:two')).toEqual({
      scope: 'runtime:two',
      version: 1
    })
  })
})
