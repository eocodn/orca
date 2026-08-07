import { describe, expect, it, vi } from 'vitest'
import { RESET_KITTY_KEYBOARD_PROTOCOL, RESET_TERMINAL_CURSOR_STYLE } from './layout-serialization'
import { createPtyConnectionAgentIdleTerminalModeController } from './pty-connection-agent-idle-terminal-mode-controller'

describe('createPtyConnectionAgentIdleTerminalModeController', () => {
  it('writes the cursor reset by default and adds the Kitty reset for native Windows', () => {
    const writeReset = vi.fn()
    const controller = createPtyConnectionAgentIdleTerminalModeController({
      isDisposed: () => false,
      writeReset,
      resolveCommittedTitleAgentType: () => null
    })

    controller.queueReset()
    controller.enableNativeWindowsReset()
    controller.queueReset()

    expect(writeReset).toHaveBeenNthCalledWith(1, RESET_TERMINAL_CURSOR_STYLE)
    expect(writeReset).toHaveBeenNthCalledWith(
      2,
      `${RESET_TERMINAL_CURSOR_STYLE}${RESET_KITTY_KEYBOARD_PROTOCOL}`
    )
  })

  it('hands later resets to the ordered PTY writer', () => {
    const initialWriter = vi.fn()
    const orderedWriter = vi.fn()
    const controller = createPtyConnectionAgentIdleTerminalModeController({
      isDisposed: () => false,
      writeReset: initialWriter,
      resolveCommittedTitleAgentType: () => null
    })

    controller.setWriter(orderedWriter)
    controller.queueReset()

    expect(initialWriter).not.toHaveBeenCalled()
    expect(orderedWriter).toHaveBeenCalledWith(RESET_TERMINAL_CURSOR_STYLE)
  })

  it('does not write a reset after disposal', () => {
    const writeReset = vi.fn()
    const controller = createPtyConnectionAgentIdleTerminalModeController({
      isDisposed: () => true,
      writeReset,
      resolveCommittedTitleAgentType: () => null
    })

    controller.queueReset()

    expect(writeReset).not.toHaveBeenCalled()
  })

  it('suppresses Codex focus reports from explicit or committed-title identity', () => {
    const controller = createPtyConnectionAgentIdleTerminalModeController({
      isDisposed: () => false,
      writeReset: vi.fn(),
      resolveCommittedTitleAgentType: (title) => (title === 'Codex title' ? 'codex' : null)
    })

    controller.applyCompletionFocusSuppression('Other title', 'codex')
    expect(controller.shouldSuppressCodexFocusReport()).toBe(true)

    controller.applyCompletionFocusSuppression('Codex title', 'unknown')
    expect(controller.shouldSuppressCodexFocusReport()).toBe(true)
  })

  it('clears focus suppression for known non-Codex completion identity', () => {
    const controller = createPtyConnectionAgentIdleTerminalModeController({
      isDisposed: () => false,
      writeReset: vi.fn(),
      resolveCommittedTitleAgentType: () => 'codex'
    })
    controller.setCodexFocusSuppressed(true)

    controller.applyCompletionFocusSuppression('Codex title', 'claude')

    expect(controller.shouldSuppressCodexFocusReport()).toBe(false)
  })

  it('supports explicit set and clear for status-watch transitions', () => {
    const controller = createPtyConnectionAgentIdleTerminalModeController({
      isDisposed: () => false,
      writeReset: vi.fn(),
      resolveCommittedTitleAgentType: () => null
    })

    controller.setCodexFocusSuppressed(true)
    expect(controller.shouldSuppressCodexFocusReport()).toBe(true)
    controller.clearFocusSuppression()
    expect(controller.shouldSuppressCodexFocusReport()).toBe(false)
  })
})
