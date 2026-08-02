import type { IBuffer } from '@xterm/xterm'
import { resolveCursorAgentImeAnchor } from '@/lib/pane-manager/terminal-ime-anchor'

export type TerminalWithFocusMode = {
  textarea?: HTMLTextAreaElement | null
  modes?: {
    sendFocusMode?: boolean
  }
}

export type TerminalWithInspectableBuffer = {
  cols: number
  rows: number
  buffer?: {
    active?: IBuffer
  }
}

// Why: replay bytes can carry a dead run's screen in scrollback — or still
// painted in the viewport with a shell prompt below it — so once xterm has
// parsed the replay the confirmation needs both the cursor-agent screen shape
// AND the parked cursor. A dead screen leaves the shell cursor after its
// prompt; a live agent that needs the focus-in is by definition parked, and a
// live agent that is not parked only loses focus reporting the way the
// pre-fix reattach always did. Returns null when the buffer is not
// inspectable (e.g. test doubles).
export function parsedViewportShowsParkedCursorAgentScreen(
  terminal: TerminalWithInspectableBuffer
): boolean | null {
  const buffer = terminal.buffer?.active
  if (
    !buffer ||
    typeof buffer.getLine !== 'function' ||
    typeof buffer.cursorX !== 'number' ||
    typeof buffer.cursorY !== 'number'
  ) {
    return null
  }
  return (
    resolveCursorAgentImeAnchor({
      buffer,
      rows: terminal.rows,
      cols: terminal.cols,
      cursorX: buffer.cursorX,
      cursorY: buffer.cursorY
    }) !== null
  )
}

export function terminalHasFocusReportingEnabled(terminal: TerminalWithFocusMode): boolean {
  return terminal.modes?.sendFocusMode === true
}

export function terminalOwnsDomFocus(terminal: TerminalWithFocusMode): boolean {
  if (typeof document === 'undefined' || !terminal.textarea) {
    return false
  }
  return document.activeElement === terminal.textarea
}

export function stripAnsiCsiSequences(data: string): string {
  let normalized = ''
  let index = 0
  while (index < data.length) {
    if (data.charCodeAt(index) === 0x1b && data[index + 1] === '[') {
      index += 2
      while (index < data.length) {
        const code = data.charCodeAt(index)
        index += 1
        if (code >= 0x40 && code <= 0x7e) {
          break
        }
      }
      continue
    }
    normalized += data[index]
    index += 1
  }
  return normalized
}

export const CURSOR_AGENT_REATTACH_HEADER = 'Cursor Agent'
export const CURSOR_AGENT_REATTACH_INPUT_MARKER = '→'
export const CURSOR_AGENT_REATTACH_SCREEN_SIGNAL_MAX_CHARS = 5000

export function hasCursorAgentReattachPayloadScreenSignal(data: string): boolean {
  const normalized = stripAnsiCsiSequences(data)
  // Why: anchor on the LAST header occurrence — replay buffers keep scrollback,
  // and an earlier finished run must not classify the current screen.
  const headerIndex = normalized.lastIndexOf(CURSOR_AGENT_REATTACH_HEADER)
  if (headerIndex === -1) {
    return false
  }
  const screenTail = normalized.slice(
    headerIndex + CURSOR_AGENT_REATTACH_HEADER.length,
    headerIndex + CURSOR_AGENT_REATTACH_SCREEN_SIGNAL_MAX_CHARS
  )
  return screenTail.includes(`${CURSOR_AGENT_REATTACH_INPUT_MARKER} `)
}


