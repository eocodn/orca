import { describe, expect, it } from 'vitest'
import {
  getCachedEditorDraftVersions,
  getMobileSessionSnapshotVersion,
  nextMobileSessionSnapshotVersion,
  setCachedEditorDraftVersions
} from './runtime-graph-sync'

describe('runtime graph state mutation API', () => {
  it('advances and reads the shared mobile snapshot version monotonically', () => {
    const before = getMobileSessionSnapshotVersion()

    const first = nextMobileSessionSnapshotVersion()
    const second = nextMobileSessionSnapshotVersion()

    expect(first).toBe(before + 1)
    expect(second).toBe(first + 1)
    expect(getMobileSessionSnapshotVersion()).toBe(second)
  })

  it('keeps editor draft cache writes authoritative and source-fenced', () => {
    const source = {} as Record<string, string>
    const otherSource = {} as Record<string, string>
    const versions = new Map([['file.md', 'version-1']])

    expect(getCachedEditorDraftVersions(source)).toBeNull()
    setCachedEditorDraftVersions(source, versions)

    expect(getCachedEditorDraftVersions(source)).toBe(versions)
    expect(getCachedEditorDraftVersions(otherSource)).toBeNull()
  })
})
