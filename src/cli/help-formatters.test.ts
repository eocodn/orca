import { describe, expect, it } from 'vitest'
import { formatFlagHelp } from './help-formatters'

describe('formatFlagHelp', () => {
  it('keeps the flag descriptions that were lost when help was split', () => {
    expect(formatFlagHelp('current')).toBe(
      '--current              Use the current Orca worktree linked Linear issue'
    )
    expect(formatFlagHelp('full')).toBe(
      '--full                 Include all supported V1 issue context within caps'
    )
    expect(formatFlagHelp('format')).toBe('--format <png|jpeg>    Screenshot image format')
  })
})
