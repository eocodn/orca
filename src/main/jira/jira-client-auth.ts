import { createHash } from 'node:crypto'
import type { JiraAuthType, JiraSite, JiraViewer } from '../../shared/types'

function normalizeJiraSiteUrl(siteUrl: string): string {
  const trimmed = siteUrl.trim()
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const url = new URL(withProtocol)
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function getSiteId(siteUrl: string, email: string): string {
  return createHash('sha256')
    .update(`${siteUrl}\n${email.toLowerCase()}`)
    .digest('base64url')
    .slice(0, 24)
}

function toViewer(data: Record<string, unknown>, fallbackEmail: string): JiraViewer {
  const avatarUrls = data.avatarUrls as Record<string, unknown> | undefined
  // Server/DC /myself has no accountId; its stable identifiers are name/key.
  const accountId =
    typeof data.accountId === 'string'
      ? data.accountId
      : typeof data.name === 'string'
        ? data.name
        : typeof data.key === 'string'
          ? data.key
          : ''
  return {
    accountId,
    displayName: typeof data.displayName === 'string' ? data.displayName : fallbackEmail,
    email: typeof data.emailAddress === 'string' ? data.emailAddress : fallbackEmail,
    avatarUrl:
      typeof avatarUrls?.['48x48'] === 'string'
        ? avatarUrls['48x48']
        : typeof avatarUrls?.['32x32'] === 'string'
          ? avatarUrls['32x32']
          : undefined
  }
}

function siteToViewer(site: JiraSite | null): JiraViewer | null {
  if (!site) {
    return null
  }
  return {
    accountId: site.accountId,
    displayName: site.displayName,
    email: site.email
  }
}

function authHeader(email: string, apiToken: string, authType?: JiraAuthType): string {
  // Self-hosted with no username = a personal access token (Bearer); Basic auth
  // with a PAT in the password slot is what produces the 401s users report.
  // Self-hosted WITH a username is classic username+password Basic auth, which
  // older Server/DC instances (predating PATs) require. Cloud is always Basic.
  if (authType === 'server' && !email) {
    return `Bearer ${apiToken}`
  }
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`
}

function describeErrorCause(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('cause' in error)) {
    return undefined
  }
  const cause = (error as { cause?: unknown }).cause
  if (cause instanceof Error) {
    return `${cause.name}: ${cause.message}`
  }
  return cause === undefined ? undefined : String(cause)
}

export { normalizeJiraSiteUrl, getSiteId, toViewer, siteToViewer, authHeader, describeErrorCause }
