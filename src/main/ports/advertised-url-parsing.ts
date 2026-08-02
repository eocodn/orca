const URL_CANDIDATE_LIMIT = 2048

// ANSI/OSC strippers mirror the runtime normalizer, with cursor guards for redraws.
const OSC_PATTERN = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
const CURSOR_MOVE_PATTERN = /\x1b\[[0-?]*[ -/]*[CDGHf]/g
const CURSOR_MOVE_URL_GUARD = '['
const CSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g
const SINGLE_ESC_PATTERN = /\x1b[@-_]/g
const CONTROL_PATTERN = /[\x00-\x08\x0b-\x1f\x7f]/g
const URL_CANDIDATE_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi

export type HostKind = 'custom' | 'loopback' | 'private-ip' | 'public-ip'

export function stripTerminalControls(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(OSC_PATTERN, '')
    .replace(CURSOR_MOVE_PATTERN, CURSOR_MOVE_URL_GUARD)
    .replace(CSI_PATTERN, '')
    .replace(SINGLE_ESC_PATTERN, '')
    .replace(CONTROL_PATTERN, '')
}

export function extractUrlCandidates(cleaned: string): URL[] {
  const results: URL[] = []
  for (const match of cleaned.matchAll(URL_CANDIDATE_PATTERN)) {
    let candidate = match[0]
    if (candidate.length > URL_CANDIDATE_LIMIT) {
      continue
    }
    while (candidate.length > 0 && /[.,;:!?)\]}>'"`]/.test(candidate.slice(-1))) {
      candidate = candidate.slice(0, -1)
    }
    const url = parseUrl(candidate)
    if (url) {
      results.push(url)
    }
  }
  return results
}

function parseUrl(candidate: string): URL | null {
  try {
    const url = new URL(candidate)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
      return null
    }
    return url
  } catch {
    return null
  }
}

export function classifyHost(hostname: string): HostKind {
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (lower === 'localhost' || lower === '127.0.0.1' || lower === '::1') {
    return 'loopback'
  }
  if (isIpv4(lower)) {
    return isPrivateIpv4(lower) ? 'private-ip' : 'public-ip'
  }
  if (isIpv6(lower)) {
    return isPrivateIpv6(lower) ? 'private-ip' : 'public-ip'
  }
  return 'custom'
}

function isIpv4(value: string): boolean {
  const parts = value.split('.')
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function isPrivateIpv4(value: string): boolean {
  const [a, b] = value.split('.').map(Number)
  return a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
}

function isIpv6(value: string): boolean {
  return value.includes(':') && /^[0-9a-f:]+$/.test(value)
}

function isPrivateIpv6(value: string): boolean {
  if (value.startsWith('fc') || value.startsWith('fd')) {
    return true
  }
  const firstHextet = Number.parseInt(value.split(':', 1)[0], 16)
  return Number.isFinite(firstHextet) && (firstHextet & 0xffc0) === 0xfe80
}

export function isUnspecifiedHost(hostname: string): boolean {
  const stripped = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return stripped === '0.0.0.0' || stripped === '::' || stripped === '*'
}
