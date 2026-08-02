export class PtyGenerationReferenceCount {
  private readonly counts = new Map<string, Map<number, number>>()

  add(ptyId: string, generation: number): void {
    let byGeneration = this.counts.get(ptyId)
    if (!byGeneration) {
      byGeneration = new Map()
      this.counts.set(ptyId, byGeneration)
    }
    byGeneration.set(generation, (byGeneration.get(generation) ?? 0) + 1)
  }

  delete(ptyId: string, generation: number): void {
    const byGeneration = this.counts.get(ptyId)
    const count = byGeneration?.get(generation) ?? 0
    if (count <= 1) {
      byGeneration?.delete(generation)
      if (byGeneration?.size === 0) {
        this.counts.delete(ptyId)
      }
      return
    }
    byGeneration?.set(generation, count - 1)
  }

  clear(ptyId: string, generation: number): void {
    const byGeneration = this.counts.get(ptyId)
    byGeneration?.delete(generation)
    if (byGeneration?.size === 0) {
      this.counts.delete(ptyId)
    }
  }

  has(ptyId: string, generation: number): boolean {
    return (this.counts.get(ptyId)?.get(generation) ?? 0) > 0
  }
}
