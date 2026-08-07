import {
  SYNCHRONIZED_OUTPUT_END_SEQUENCE,
  SYNCHRONIZED_OUTPUT_MARKER_TAIL_CHARS,
  SYNCHRONIZED_OUTPUT_START_SEQUENCE,
  TERMINAL_RENDERER_RISK_SCAN_TAIL_CHARS
} from './pty-connection-runtime-state'

type RewriteState = {
  previousChunkEndsWithCarriageReturn: boolean
  previousRewriteCsiScanTail: string
}

type RewriteDecision = {
  nextChunkEndsWithCarriageReturn: boolean
  nextRewriteCsiScanTail: string
  prefersRenderRefresh: boolean
}

type PtyConnectionRenderRiskControllerArgs = {
  getPtyId: () => string | null
  prefersRenderRefresh: (data: string) => boolean
  rewriteDecision: (data: string, state: RewriteState) => RewriteDecision
  containsCursorPositionSequence: (data: string) => boolean
}

function containsNonAsciiOutput(data: string): boolean {
  for (let index = 0; index < data.length; index++) {
    if (data.charCodeAt(index) > 0x7f) {
      return true
    }
  }
  return false
}

function trailingIncompleteCsiSequence(data: string): string {
  const escapeIndex = data.lastIndexOf('\x1b')
  if (escapeIndex === -1) {
    return ''
  }
  const tail = data.slice(escapeIndex)
  if (tail === '\x1b') {
    return tail
  }
  if (!tail.startsWith('\x1b[')) {
    return ''
  }
  for (let index = 2; index < tail.length; index++) {
    const code = tail.charCodeAt(index)
    if (code >= 0x40 && code <= 0x7e) {
      return ''
    }
  }
  return tail.slice(-TERMINAL_RENDERER_RISK_SCAN_TAIL_CHARS)
}

export function createPtyConnectionRenderRiskController({
  getPtyId,
  prefersRenderRefresh,
  rewriteDecision,
  containsCursorPositionSequence
}: PtyConnectionRenderRiskControllerArgs) {
  let foregroundRefreshRiskScanTail = ''
  let hiddenRiskPtyId: string | null = null
  let hiddenSynchronizedOutputActive = false
  let hiddenSynchronizedOutputMarkerTail = ''
  let hiddenRewriteChunkEndedWithCarriageReturn = false
  let hiddenRewriteCsiScanTail = ''

  const resetHidden = (ptyId: string | null = null): void => {
    hiddenRiskPtyId = ptyId
    hiddenSynchronizedOutputActive = false
    hiddenSynchronizedOutputMarkerTail = ''
    hiddenRewriteChunkEndedWithCarriageReturn = false
    hiddenRewriteCsiScanTail = ''
  }

  const ensureHiddenStateForCurrentPty = (): void => {
    const ptyId = getPtyId()
    if (hiddenRiskPtyId !== ptyId) {
      resetHidden(ptyId)
    }
  }

  const hiddenSynchronizedOutputTouchesParsedFrame = (data: string): boolean => {
    const scanData = hiddenSynchronizedOutputMarkerTail
      ? `${hiddenSynchronizedOutputMarkerTail}${data}`
      : data
    const currentChunkStartIndex = scanData.length - data.length
    let active = hiddenSynchronizedOutputActive
    let touchesParsedFrame = active && data.length > 0
    let offset = 0

    while (offset < scanData.length) {
      const startIndex = scanData.indexOf(SYNCHRONIZED_OUTPUT_START_SEQUENCE, offset)
      const endIndex = scanData.indexOf(SYNCHRONIZED_OUTPUT_END_SEQUENCE, offset)
      if (startIndex === -1 && endIndex === -1) {
        break
      }
      if (endIndex !== -1 && (startIndex === -1 || endIndex < startIndex)) {
        if (active && endIndex + SYNCHRONIZED_OUTPUT_END_SEQUENCE.length > currentChunkStartIndex) {
          touchesParsedFrame = true
        }
        active = false
        offset = endIndex + SYNCHRONIZED_OUTPUT_END_SEQUENCE.length
        continue
      }
      active = true
      if (startIndex + SYNCHRONIZED_OUTPUT_START_SEQUENCE.length > currentChunkStartIndex) {
        touchesParsedFrame = true
      }
      offset = startIndex + SYNCHRONIZED_OUTPUT_START_SEQUENCE.length
    }

    if (active && data.length > 0) {
      touchesParsedFrame = true
    }
    hiddenSynchronizedOutputActive = active
    hiddenSynchronizedOutputMarkerTail = scanData.slice(-SYNCHRONIZED_OUTPUT_MARKER_TAIL_CHARS)
    return touchesParsedFrame
  }

  const hiddenTuiRedrawOutputPrefersAtlasRecovery = (data: string): boolean => {
    if (!data) {
      return false
    }
    const scanData = hiddenRewriteCsiScanTail ? `${hiddenRewriteCsiScanTail}${data}` : data
    const decision = rewriteDecision(data, {
      previousChunkEndsWithCarriageReturn: hiddenRewriteChunkEndedWithCarriageReturn,
      previousRewriteCsiScanTail: hiddenRewriteCsiScanTail
    })
    hiddenRewriteChunkEndedWithCarriageReturn = decision.nextChunkEndsWithCarriageReturn
    hiddenRewriteCsiScanTail = decision.nextRewriteCsiScanTail
    return decision.prefersRenderRefresh || containsCursorPositionSequence(scanData)
  }

  return {
    foregroundOutputPrefersRenderRefresh(data: string): boolean {
      if (!data) {
        return false
      }
      const scanData = foregroundRefreshRiskScanTail
        ? `${foregroundRefreshRiskScanTail}${data}`
        : data
      const prefersRefresh =
        (scanData.includes('\x1b[') || containsNonAsciiOutput(scanData)) &&
        prefersRenderRefresh(scanData)
      foregroundRefreshRiskScanTail = trailingIncompleteCsiSequence(scanData)
      return prefersRefresh
    },
    hiddenOutputNeedsAtlasRecoveryAfterParse(data: string): boolean {
      if (!data) {
        return false
      }
      ensureHiddenStateForCurrentPty()
      const synchronizedOutputTouchesParsedFrame = hiddenSynchronizedOutputTouchesParsedFrame(data)
      const tuiRedrawOutputPrefersAtlasRecovery = hiddenTuiRedrawOutputPrefersAtlasRecovery(data)
      return synchronizedOutputTouchesParsedFrame || tuiRedrawOutputPrefersAtlasRecovery
    },
    resetHidden,
    resetSkippedHidden(): void {
      // Why: skipped bytes were not parsed, so prior hidden frame state is no longer authoritative.
      resetHidden(getPtyId())
    }
  }
}
