import {
  isTerminalInputTooLargeWithDeferredMeasurement,
  iterateTerminalInputChunks
} from '../../../../shared/terminal-input'

export async function writeAcceptedPtyInput(options: {
  id: string
  data: string
  isCurrent: () => boolean
  write: (id: string, data: string) => Promise<boolean>
}): Promise<boolean> {
  try {
    const tooLarge = isTerminalInputTooLargeWithDeferredMeasurement(options.data)
    if (typeof tooLarge === 'boolean' ? tooLarge : await tooLarge) {
      return false
    }
    const chunks = iterateTerminalInputChunks(options.data)
    let chunk = chunks.next()
    while (!chunk.done) {
      if (!options.isCurrent()) {
        return false
      }
      if (!(await options.write(options.id, chunk.value))) {
        return false
      }
      chunk = chunks.next()
      if (!chunk.done) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    }
    return true
  } catch {
    return false
  }
}
