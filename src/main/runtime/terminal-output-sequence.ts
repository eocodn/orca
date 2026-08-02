export class TerminalOutputSequence {
  private readonly sequenceByPtyId = new Map<string, number>()

  // Retained for runtime diagnostics that inspect authoritative sequence state.
  get map(): Map<string, number> {
    return this.sequenceByPtyId
  }

  get(ptyId: string): number {
    return this.sequenceByPtyId.get(ptyId) ?? 0
  }

  set(ptyId: string, sequence: number): void {
    if (!Number.isFinite(sequence) || sequence < 0) {
      throw new Error(`invalid terminal output sequence for ${ptyId}`)
    }
    this.sequenceByPtyId.set(ptyId, Math.floor(sequence))
  }

  advance(ptyId: string, amount: number): number {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`invalid terminal output increment for ${ptyId}`)
    }
    const next = this.get(ptyId) + Math.floor(amount)
    this.sequenceByPtyId.set(ptyId, next)
    return next
  }

  delete(ptyId: string): void {
    this.sequenceByPtyId.delete(ptyId)
  }
}
