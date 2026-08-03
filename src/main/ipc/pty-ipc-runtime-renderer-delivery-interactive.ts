import {
  INTERACTIVE_OUTPUT_BUDGET_CHARS,
  INTERACTIVE_OUTPUT_MAX_CHARS,
  INTERACTIVE_OUTPUT_WINDOW_MS
} from './pty-ipc-runtime-renderer-delivery-constants'
import { ptyRuntimeState } from './pty-ipc-runtime-state'

type RendererDeliveryInteractiveOptions = {
  redrawMaxChars: number
}

export function createPtyRendererDeliveryInteractive({
  redrawMaxChars
}: RendererDeliveryInteractiveOptions) {
  function isLikelyInteractiveRedraw(data: string): boolean {
    if (data.length <= INTERACTIVE_OUTPUT_MAX_CHARS) {
      return true
    }
    // ANSI redraws are latency-sensitive; plain output stays on the batch path.
    return data.length <= redrawMaxChars && data.includes('\x1b[')
  }

  function shouldSendInteractiveOutputNow(id: string, data: string, now: number): boolean {
    const lastInputAt = ptyRuntimeState.lastInputAtByPty.get(id)
    if (lastInputAt === undefined || now - lastInputAt > INTERACTIVE_OUTPUT_WINDOW_MS) {
      ptyRuntimeState.interactiveOutputCharsByPty.delete(id)
      return false
    }
    if (!isLikelyInteractiveRedraw(data)) {
      ptyRuntimeState.interactiveOutputCharsByPty.set(id, INTERACTIVE_OUTPUT_BUDGET_CHARS)
      return false
    }
    const usedChars = ptyRuntimeState.interactiveOutputCharsByPty.get(id) ?? 0
    if (usedChars + data.length > INTERACTIVE_OUTPUT_BUDGET_CHARS) {
      ptyRuntimeState.interactiveOutputCharsByPty.set(id, INTERACTIVE_OUTPUT_BUDGET_CHARS)
      return false
    }
    ptyRuntimeState.interactiveOutputCharsByPty.set(id, usedChars + data.length)
    return true
  }

  return { shouldSendInteractiveOutputNow }
}
