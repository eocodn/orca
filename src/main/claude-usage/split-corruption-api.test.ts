import { describe, expect, it } from 'vitest'
import {
  aggregateClaudeUsage,
  createWorktreeRefs,
  parseClaudeUsageRecord,
  scanClaudeUsageFiles
} from './scanner'

describe('Claude usage scanner API', () => {
  it('keeps the scanner facade exports available after module splitting', () => {
    expect(typeof aggregateClaudeUsage).toBe('function')
    expect(typeof createWorktreeRefs).toBe('function')
    expect(typeof parseClaudeUsageRecord).toBe('function')
    expect(typeof scanClaudeUsageFiles).toBe('function')
  })
})
