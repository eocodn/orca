export function createPtyConnectionStreamGenerationController() {
  let generation = 0

  return {
    getCurrent(): number {
      return generation
    },
    advance(): number {
      generation += 1
      return generation
    },
    isCurrent(expected: number): boolean {
      return generation === expected
    }
  }
}
