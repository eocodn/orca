import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  session: { fromPartition: vi.fn() }
}))

import { deriveUrl, validateCookieEntry } from './browser-cookie-value-validation'

describe('browser cookie split API', () => {
  it('keeps cookie validation available from the split module', () => {
    expect(deriveUrl('.example.com', true)).toBe('https://example.com/')
    expect(
      validateCookieEntry({
        domain: '.example.com',
        name: 'session',
        value: 'value',
        secure: true
      })
    ).toMatchObject({
      url: 'https://example.com/',
      domain: '.example.com',
      name: 'session',
      value: 'value'
    })
  })
})
