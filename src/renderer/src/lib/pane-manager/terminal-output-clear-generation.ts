const clearGenerationByTerminal = new WeakMap<object, number>()

export function captureTerminalOutputClearGeneration(terminal: object): number {
  return clearGenerationByTerminal.get(terminal) ?? 0
}

export function isCurrentTerminalOutputClearGeneration(
  terminal: object,
  generation: number
): boolean {
  return captureTerminalOutputClearGeneration(terminal) === generation
}

export function invalidateTerminalOutputClearGeneration(terminal: object): void {
  clearGenerationByTerminal.set(
    terminal,
    captureTerminalOutputClearGeneration(terminal) + 1
  )
}
