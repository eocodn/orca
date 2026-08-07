import {
  FOREGROUND_INTERACTIVE_REDRAW_CHARS,
  FOREGROUND_INTERACTIVE_REDRAW_WINDOW_MS
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

type RenderRefreshDecision = {
  refresh: boolean
  inPlaceRewrite: boolean
  recoverWebglAtlasAfterParse: boolean
}

type WindowsEastAsianRefreshOptions = {
  isWindowsClient: boolean
  isNativeWindowsConpty: boolean
  hadRecentInput: boolean
  maxInteractiveRedrawChars: number
}

type PtyConnectionForegroundRenderControllerArgs = {
  now: () => number
  getLastTerminalInputAt: () => number
  foregroundRiskPrefersRefresh: (data: string) => boolean
  rewriteDecision: (data: string, state: RewriteState) => RewriteDecision
  rewriteOutputPrefersRefresh: (data: string) => boolean
  windowsEastAsianPrefersRefresh: (data: string, options: WindowsEastAsianRefreshOptions) => boolean
  isWindowsClient: boolean
  isNativeWindowsConpty: boolean
  getBufferType: () => string
  getBufferSwitches: () => number
  scheduleAtlasRecovery: () => void
}

function containsNonAsciiOutput(data: string): boolean {
  for (let index = 0; index < data.length; index++) {
    if (data.charCodeAt(index) > 0x7f) {
      return true
    }
  }
  return false
}

export function createPtyConnectionForegroundRenderController({
  now,
  getLastTerminalInputAt,
  foregroundRiskPrefersRefresh,
  rewriteDecision,
  rewriteOutputPrefersRefresh,
  windowsEastAsianPrefersRefresh,
  isWindowsClient,
  isNativeWindowsConpty,
  getBufferType,
  getBufferSwitches,
  scheduleAtlasRecovery
}: PtyConnectionForegroundRenderControllerArgs) {
  let rewriteChunkEndedWithCarriageReturn = false
  let rewriteCsiScanTail = ''

  const rewritePrefersRenderRefresh = (data: string): boolean => {
    const decision = rewriteDecision(data, {
      previousChunkEndsWithCarriageReturn: rewriteChunkEndedWithCarriageReturn,
      previousRewriteCsiScanTail: rewriteCsiScanTail
    })
    rewriteChunkEndedWithCarriageReturn = decision.nextChunkEndsWithCarriageReturn
    rewriteCsiScanTail = decision.nextRewriteCsiScanTail
    return decision.prefersRenderRefresh
  }

  return {
    decideRenderRefresh(data: string): RenderRefreshDecision {
      const inPlaceRewrite = rewritePrefersRenderRefresh(data)
      const recentInput =
        now() - getLastTerminalInputAt() <= FOREGROUND_INTERACTIVE_REDRAW_WINDOW_MS
      if (foregroundRiskPrefersRefresh(data)) {
        return {
          refresh: true,
          inPlaceRewrite,
          recoverWebglAtlasAfterParse: true
        }
      }
      if (inPlaceRewrite) {
        return { refresh: true, inPlaceRewrite: true, recoverWebglAtlasAfterParse: false }
      }
      if (
        windowsEastAsianPrefersRefresh(data, {
          isWindowsClient,
          isNativeWindowsConpty,
          hadRecentInput: recentInput,
          maxInteractiveRedrawChars: FOREGROUND_INTERACTIVE_REDRAW_CHARS
        })
      ) {
        return { refresh: true, inPlaceRewrite: false, recoverWebglAtlasAfterParse: false }
      }
      return {
        refresh:
          isNativeWindowsConpty &&
          containsNonAsciiOutput(data) &&
          (data.includes('\r') || rewriteOutputPrefersRefresh(data)),
        inPlaceRewrite: false,
        recoverWebglAtlasAfterParse: false
      }
    },
    alternateScreenAtlasRecoveryOnParsed(): () => void {
      const wasAlternateScreenBuffer = getBufferType() === 'alternate'
      const switchesBeforeParse = getBufferSwitches()
      return () => {
        if (
          wasAlternateScreenBuffer ||
          getBufferSwitches() !== switchesBeforeParse ||
          getBufferType() === 'alternate'
        ) {
          scheduleAtlasRecovery()
        }
      }
    }
  }
}
