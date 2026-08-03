import { afterEach, describe, expect, it, vi } from 'vitest'

describe('terminal scrollback clear', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not render queued output after clearing the terminal', async () => {
    vi.useFakeTimers()
    vi.resetModules()

    const { writeTerminalOutput } = await import('./pane-terminal-output-scheduler')
    const { clearTerminalScrollbackAndFollowOutput } = await import('./terminal-scrollback-clear')
    const terminal = {
      buffer: { active: { viewportY: 0, baseY: 0 } },
      clear: vi.fn(),
      scrollToBottom: vi.fn(),
      write: vi.fn((_data: string, callback?: () => void) => callback?.())
    }

    writeTerminalOutput(terminal, 'stale output', { foreground: false })
    clearTerminalScrollbackAndFollowOutput(terminal)
    vi.advanceTimersByTime(50)

    expect(terminal.clear).toHaveBeenCalledTimes(1)
    expect(terminal.scrollToBottom).toHaveBeenCalledTimes(1)
    expect(terminal.write).not.toHaveBeenCalled()
  })

  it('does not repaint output whose parse callback runs after clearing', async () => {
    vi.resetModules()

    const { writeTerminalOutput } = await import('./pane-terminal-output-scheduler')
    const { clearTerminalScrollbackAndFollowOutput } = await import('./terminal-scrollback-clear')
    let parseCallback: (() => void) | undefined
    const terminal = {
      buffer: { active: { viewportY: 0, baseY: 0 } },
      clear: vi.fn(),
      refresh: vi.fn(),
      rows: 24,
      scrollToBottom: vi.fn(),
      write: vi.fn((_data: string, callback?: () => void) => {
        parseCallback = callback
      })
    }

    writeTerminalOutput(terminal, 'stale foreground output', {
      foreground: true,
      forceForegroundRefresh: true
    })
    clearTerminalScrollbackAndFollowOutput(terminal)
    parseCallback?.()

    expect(terminal.refresh).not.toHaveBeenCalled()
  })
})
