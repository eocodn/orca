import type { AgentType } from '../../../../shared/agent-status-types'
import type { TuiAgent } from '../../../../shared/types'
import { RESET_KITTY_KEYBOARD_PROTOCOL, RESET_TERMINAL_CURSOR_STYLE } from './layout-serialization'

type PtyConnectionAgentIdleTerminalModeControllerArgs = {
  isDisposed: () => boolean
  writeReset: (sequence: string) => void
  resolveCommittedTitleAgentType: (title: string) => TuiAgent | null
}

export function createPtyConnectionAgentIdleTerminalModeController({
  isDisposed,
  writeReset: initialWriteReset,
  resolveCommittedTitleAgentType
}: PtyConnectionAgentIdleTerminalModeControllerArgs) {
  let resetSequence = RESET_TERMINAL_CURSOR_STYLE
  let suppressCodexFocusReports = false
  let writeReset = initialWriteReset

  return {
    enableNativeWindowsReset(): void {
      resetSequence = `${RESET_TERMINAL_CURSOR_STYLE}${RESET_KITTY_KEYBOARD_PROTOCOL}`
    },
    setWriter(nextWriteReset: (sequence: string) => void): void {
      // Preserve reset ordering once the deferred PTY output writer exists.
      writeReset = nextWriteReset
    },
    queueReset(): void {
      if (!isDisposed()) {
        writeReset(resetSequence)
      }
    },
    applyCompletionFocusSuppression(
      title: string | undefined,
      agentType: AgentType | undefined
    ): void {
      const titleAgentType = resolveCommittedTitleAgentType(title ?? '')
      suppressCodexFocusReports =
        agentType && agentType !== 'unknown' ? agentType === 'codex' : titleAgentType === 'codex'
    },
    setCodexFocusSuppressed(suppressed: boolean): void {
      suppressCodexFocusReports = suppressed
    },
    clearFocusSuppression(): void {
      suppressCodexFocusReports = false
    },
    shouldSuppressCodexFocusReport(): boolean {
      return suppressCodexFocusReports
    }
  }
}
