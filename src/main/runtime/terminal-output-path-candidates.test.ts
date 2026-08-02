import { describe, expect, it } from 'vitest'
import {
  appendRecentPtyPathCandidates,
  recentTerminalOutputIncludesPath,
  recentTerminalPathCandidatesIncludePath
} from './terminal-output-path-candidates'

describe('terminal output path candidates', () => {
  it('retains a bounded candidate history and matches path aliases', () => {
    const candidates = appendRecentPtyPathCandidates(undefined, 'wrote file:///tmp/report.json\n')

    expect(
      recentTerminalPathCandidatesIncludePath(candidates, '/tmp/report.json', '/tmp/report.json')
    ).toBe(true)
    expect(candidates.length).toBeGreaterThan(0)
  })

  it('matches encoded output only at path boundaries', () => {
    expect(
      recentTerminalOutputIncludesPath(
        'saved file:///tmp/my%20report.json:12\n',
        '/tmp/my report.json',
        '/tmp/my report.json'
      )
    ).toBe(true)
    expect(
      recentTerminalOutputIncludesPath(
        '/tmp/report.json.bak\n',
        '/tmp/report.json',
        '/tmp/report.json'
      )
    ).toBe(false)
  })
})
