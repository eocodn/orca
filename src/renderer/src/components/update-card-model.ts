import type { ChangelogData } from '../../../shared/types'

// ── Helpers ──────────────────────────────────────────────────────────

export function releaseUrlForVersion(version: string | null): string {
  // Why: fall back to the plain releases listing (not /releases/latest) — /latest also breaks when GitHub's API is degraded.
  return version
    ? `https://github.com/stablyai/orca/releases/tag/v${version}`
    : 'https://github.com/stablyai/orca/releases'
}

export function isAnimatedGif(url: string | undefined): boolean {
  return typeof url === 'string' && url.toLowerCase().endsWith('.gif')
}

export function isHttp2ProtocolError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('err_http2_protocol_error') ||
    normalized.includes('http2_protocol_error') ||
    (normalized.includes('http/2') && normalized.includes('protocol'))
  )
}

export type ErrorCardModel = {
  variant?: 'default' | 'http1Compatibility' | 'security'
  title: string
  summary: string
  /** Optional guidance box between the summary and the raw error output. */
  explainer?: string
  /** Raw error text, shown only when the user expands "Show details". */
  detail?: string
  releaseUrl?: string
  /** Overrides the secondary button label (defaults to "Download Manually"). */
  manualLabel?: string
  primaryAction?: {
    label: string
    pendingLabel?: string
    isPending?: boolean
    onClick: () => void
  }
}


