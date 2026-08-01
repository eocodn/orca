export const TERMINAL_MIN_COLS = 1
export const TERMINAL_MAX_COLS = 1000
export const TERMINAL_MIN_ROWS = 1
export const TERMINAL_MAX_ROWS = 500

export function areValidTerminalDimensions(cols: number, rows: number): boolean {
  return (
    Number.isInteger(cols) &&
    cols >= TERMINAL_MIN_COLS &&
    cols <= TERMINAL_MAX_COLS &&
    Number.isInteger(rows) &&
    rows >= TERMINAL_MIN_ROWS &&
    rows <= TERMINAL_MAX_ROWS
  )
}

export function assertTerminalDimensions(cols: number, rows: number): void {
  if (!areValidTerminalDimensions(cols, rows)) {
    throw new Error('invalid_terminal_dimensions')
  }
}
