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

  it('ignores a stale submitted onParsed callback after clearing', async () => {
    vi.resetModules()

    const { writeTerminalOutput } = await import('./pane-terminal-output-scheduler')
    const { clearTerminalScrollbackAndFollowOutput } = await import('./terminal-scrollback-clear')
    let parseCallback: (() => void) | undefined
    const onParsed = vi.fn()
    const ackCredit = vi.fn()
    const terminal = {
      buffer: { active: { viewportY: 0, baseY: 0 } },
      clear: vi.fn(),
      scrollToBottom: vi.fn(),
      write: vi.fn((_data: string, callback?: () => void) => {
        parseCallback = callback
      })
    }

    writeTerminalOutput(terminal, 'already submitted', {
      foreground: true,
      forceForegroundRefresh: true,
      onParsed,
      ackCredit
    })
    expect(terminal.write).toHaveBeenCalledOnce()
    clearTerminalScrollbackAndFollowOutput(terminal)
    parseCallback?.()

    expect(onParsed).not.toHaveBeenCalled()
    expect(ackCredit).toHaveBeenCalledOnce()
  })

  it('does not let a stale callback cancel a newer stall watch after clearing', async () => {
    vi.useFakeTimers()
    vi.resetModules()

    const { writeTerminalOutput } = await import('./pane-terminal-output-scheduler')
    const {
      _resetWritePipelineHealthForTests,
      registerUndeliverableWriteHandler,
      WRITE_PIPELINE_STALL_CHECK_MS
    } = await import('./terminal-write-pipeline-health')
    const { clearTerminalScrollbackAndFollowOutput } = await import('./terminal-scrollback-clear')
    const parseCallbacks: (() => void)[] = []
    const oldOnParsed = vi.fn()
    const oldAckCredit = vi.fn()
    const newAckCredit = vi.fn()
    const recovery = vi.fn()
    const terminal = {
      buffer: { active: { viewportY: 0, baseY: 0 } },
      clear: vi.fn(),
      scrollToBottom: vi.fn(),
      write: vi.fn((_data: string, callback?: () => void) => {
        if (callback) {
          parseCallbacks.push(callback)
        }
      })
    }
    const unregister = registerUndeliverableWriteHandler(terminal, recovery)

    try {
      writeTerminalOutput(terminal, 'old output', {
        foreground: true,
        onParsed: oldOnParsed,
        ackCredit: oldAckCredit
      })
      const staleParseCallback = parseCallbacks[0]

      clearTerminalScrollbackAndFollowOutput(terminal)
      expect(oldAckCredit).toHaveBeenCalledOnce()

      writeTerminalOutput(terminal, 'new output', {
        foreground: true,
        ackCredit: newAckCredit
      })
      staleParseCallback?.()

      expect(oldOnParsed).not.toHaveBeenCalled()
      expect(oldAckCredit).toHaveBeenCalledOnce()
      expect(newAckCredit).not.toHaveBeenCalled()

      vi.advanceTimersByTime(WRITE_PIPELINE_STALL_CHECK_MS * 2)

      expect(recovery).toHaveBeenCalledWith('write-stalled')
      expect(newAckCredit).toHaveBeenCalledOnce()
    } finally {
      unregister()
      _resetWritePipelineHealthForTests(terminal)
    }
  })
})
