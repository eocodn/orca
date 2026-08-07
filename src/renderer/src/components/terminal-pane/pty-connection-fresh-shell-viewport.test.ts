import { describe, expect, it, vi } from 'vitest'
import { buildFreshShellViewportBlankingSequence } from './terminal-restored-viewport'
import { preparePtyConnectionFreshShellViewport } from './pty-connection-fresh-shell-viewport'

describe('preparePtyConnectionFreshShellViewport', () => {
  it('consumes the pane marker and blanks with the current terminal rows', () => {
    const markers = new Set([7])
    const writeReplayData = vi.fn()

    const blanked = preparePtyConnectionFreshShellViewport({
      paneId: 7,
      rows: 42,
      forceBlankRestoredViewport: false,
      restoredViewportBlankingPanes: markers,
      writeReplayData
    })

    expect(blanked).toBe(true)
    expect(markers.has(7)).toBe(false)
    expect(writeReplayData).toHaveBeenCalledWith(buildFreshShellViewportBlankingSequence(42))
  })

  it('force blanks even without a restored marker', () => {
    const writeReplayData = vi.fn()

    const blanked = preparePtyConnectionFreshShellViewport({
      paneId: 7,
      rows: 24,
      forceBlankRestoredViewport: true,
      restoredViewportBlankingPanes: new Set(),
      writeReplayData
    })

    expect(blanked).toBe(true)
    expect(writeReplayData).toHaveBeenCalledWith(buildFreshShellViewportBlankingSequence(24))
  })

  it('does nothing when neither force nor marker requires blanking', () => {
    const writeReplayData = vi.fn()

    const blanked = preparePtyConnectionFreshShellViewport({
      paneId: 7,
      rows: 24,
      forceBlankRestoredViewport: false,
      restoredViewportBlankingPanes: undefined,
      writeReplayData
    })

    expect(blanked).toBe(false)
    expect(writeReplayData).not.toHaveBeenCalled()
  })

  it('consumes a marker even when force also requests blanking', () => {
    const markers = new Set([7])

    preparePtyConnectionFreshShellViewport({
      paneId: 7,
      rows: 24,
      forceBlankRestoredViewport: true,
      restoredViewportBlankingPanes: markers,
      writeReplayData: vi.fn()
    })

    expect(markers.has(7)).toBe(false)
  })
})
