import { e2eConfig } from '@/lib/e2e-config'
import {
  deliverTerminalDataWithDeferredCredit,
  takeCurrentTerminalDeliveryCredit
} from '@/lib/pane-manager/terminal-delivery-credit'

type E2eTerminalPtyAckGateSnapshot = {
  gatedPtyCount: number
  heldAckCount: number
  heldAckChars: number
}

type E2eTerminalPtyAckGateApi = {
  hold: (ptyIds: string[]) => void
  release: () => void
  snapshot: () => E2eTerminalPtyAckGateSnapshot
}

type E2eTerminalPtyAckGateWindow = Window & {
  __terminalPtyAckGate?: E2eTerminalPtyAckGateApi
}

const e2eTerminalAckGatePtyIds = new Set<string>()
const e2eTerminalAckGateHeldChars = new Map<string, { chars: number; incarnationId?: string }>()
// Why: monotonic totals are scoped to the PTY incarnation; a reused id must
// not let an old renderer ACK repay a new process's delivery debt.
const processedPtyCharTotals = new Map<string, { incarnationId?: string; chars: number }>()

function sendPtyAck(ptyId: string, chars: number, incarnationId?: string): void {
  const previous = processedPtyCharTotals.get(ptyId)
  const processedChars =
    previous && previous.incarnationId === incarnationId ? previous.chars + chars : chars
  processedPtyCharTotals.set(ptyId, { incarnationId, chars: processedChars })
  if (incarnationId === undefined) {
    // Why: unincarnated legacy providers cannot attach the isolation token.
    const legacyAckData = window.api.pty.ackData as unknown as
      | ((id: string, chars: number, processed: number) => void)
      | undefined
    legacyAckData?.(ptyId, chars, processedChars)
  } else {
    window.api.pty.ackData?.(ptyId, chars, processedChars, incarnationId)
  }
}

function releaseE2eTerminalAckGate(): void {
  const held = Array.from(e2eTerminalAckGateHeldChars.entries())
  e2eTerminalAckGatePtyIds.clear()
  e2eTerminalAckGateHeldChars.clear()
  for (const [ptyId, heldAck] of held) {
    sendPtyAck(ptyId, heldAck.chars, heldAck.incarnationId)
  }
}

export function exposeE2eTerminalPtyAckGate(): void {
  if (!e2eConfig.exposeStore || typeof window === 'undefined') {
    return
  }
  // Why: perf tests need to force main-process renderer-delivery pressure
  // without changing production ACK behavior or dropping terminal output.
  const target = window as E2eTerminalPtyAckGateWindow
  target.__terminalPtyAckGate ??= {
    hold: (ptyIds) => {
      releaseE2eTerminalAckGate()
      for (const ptyId of ptyIds) {
        e2eTerminalAckGatePtyIds.add(ptyId)
      }
    },
    release: releaseE2eTerminalAckGate,
    snapshot: () => {
      let heldAckChars = 0
      for (const heldAck of e2eTerminalAckGateHeldChars.values()) {
        heldAckChars += heldAck.chars
      }
      return {
        gatedPtyCount: e2eTerminalAckGatePtyIds.size,
        heldAckCount: e2eTerminalAckGateHeldChars.size,
        heldAckChars
      }
    }
  }
}

export function ackPtyData(ptyId: string, chars: number, incarnationId?: string): void {
  // Why: held e2e-gate chars stay out of the cumulative total too, so a
  // delivery-resync probe cannot leak them past the simulated backpressure.
  if (e2eTerminalAckGatePtyIds.has(ptyId)) {
    const held = e2eTerminalAckGateHeldChars.get(ptyId)
    e2eTerminalAckGateHeldChars.set(ptyId, {
      chars: (held?.chars ?? 0) + chars,
      ...(incarnationId ? { incarnationId } : {})
    })
    return
  }
  sendPtyAck(ptyId, chars, incarnationId)
}

// ─── Parse-deferred ACK crediting ───────────────────────────────────
// Why: ACKing at dispatcher enqueue made main's 512KB in-flight window mean
// "bytes RECEIVED", not "bytes PARSED" — under flood the renderer's write
// queue grew unbounded behind instant ACKs, main saw no backpressure, crossed
// its pending cap, and dropped output (rc.7.perf DSR timeouts). Crediting is
// now deferred to the output scheduler's consume point, so in-flight becomes
// true parse backpressure and main's producer flow control pauses the shell
// instead of dropping.

/** Runs one pty:data delivery with a parse-deferred ACK credit. If the
 *  handler hands bytes to the output scheduler, the claimed credit fires when
 *  the scheduler consumes (writes or discards) them; any credit left
 *  unclaimed fires here at return, so a chunk the handler drops outright can
 *  never leave main's in-flight window permanently open. */
export function deliverPtyDataWithDeferredAck(
  ptyId: string,
  chars: number,
  deliver: () => void,
  incarnationId?: string
): void {
  deliverTerminalDataWithDeferredCredit(() => ackPtyData(ptyId, chars, incarnationId), deliver)
}

export function takeCurrentPtyDeliveryAckCredit(): (() => void) | null {
  return takeCurrentTerminalDeliveryCredit()
}

export function getProcessedPtyCharTotals(): Record<
  string,
  number | { incarnationId: string; processedChars: number }
> {
  const totals: Record<string, number | { incarnationId: string; processedChars: number }> = {}
  for (const [ptyId, total] of processedPtyCharTotals) {
    totals[ptyId] = total.incarnationId
      ? { incarnationId: total.incarnationId, processedChars: total.chars }
      : total.chars
  }
  return totals
}

export function clearProcessedPtyCharTotal(ptyId: string): void {
  processedPtyCharTotals.delete(ptyId)
}
