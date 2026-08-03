import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { net, safeStorage, session } from 'electron'
import {
  CredentialDecryptionError,
  credentialFileHasContent,
  readStoredCredentialToken
} from '../integration-credential-file'
import { ensureElectronProxyFromEnvironment } from '../network/proxy-settings'
import { withSpan } from '../observability/tracer'
import type {
  JiraAuthType,
  JiraConnectArgs,
  JiraConnectionStatus,
  JiraSite,
  JiraSiteSelection,
  JiraViewer
} from '../../shared/types'
import { clearAttachmentImagesForSite } from './attachment-image-cache'

// Why: Atlassian's XSRF filter rejects POST/PUT REST calls that carry a browser
// User-Agent, failing them with "XSRF check failed" even under API-token auth.
// Electron's net.fetch sends a Chrome UA, so issue search/create/update/comment
// all 403'd while GET calls (connect, /myself) passed. A non-browser UA is the
// reliable fix; X-Atlassian-Token: no-check is not honored for this case.
const JIRA_API_USER_AGENT = 'Orca'

const MAX_CONCURRENT = 4
let running = 0
import { getStatus } from './jira-client-connections'
type QueuedJiraRequest = {
  resolve: () => void
  reject: (error: Error) => void
  signal?: AbortSignal
  onAbort: () => void
}
const queue: QueuedJiraRequest[] = []

function createJiraRequestAbortError(): Error {
  const error = new Error('Jira request aborted')
  error.name = 'AbortError'
  return error
}

function acquire(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(createJiraRequestAbortError())
  }
  if (running < MAX_CONCURRENT) {
    running += 1
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const entry: QueuedJiraRequest = {
      resolve,
      reject,
      signal,
      onAbort: () => {
        const index = queue.indexOf(entry)
        if (index < 0) {
          return
        }
        queue.splice(index, 1)
        reject(createJiraRequestAbortError())
      }
    }
    signal?.addEventListener('abort', entry.onAbort, { once: true })
    queue.push(entry)
  })
}

function release(): void {
  running -= 1
  let next = queue.shift()
  while (next) {
    next.signal?.removeEventListener('abort', next.onAbort)
    if (!next.signal?.aborted) {
      running += 1
      next.resolve()
      return
    }
    next.reject(createJiraRequestAbortError())
    next = queue.shift()
  }
}

type JiraSiteFile = {
  version: 1
  activeSiteId: string | null
  selectedSiteId: JiraSiteSelection | null
  sites: JiraSite[]
}

type JiraClientForSite = {
  site: JiraSite
  authorization: string
}

// Self-hosted Jira Server/Data Center only exposes REST v2; Cloud endpoints
// in this codebase are written against v3. Callers build paths with this
// prefix so one code path serves both deployments.
function apiBasePath(site: JiraSite): string {
  return site.authType === 'server' ? '/rest/api/2' : '/rest/api/3'
}

class JiraApiError extends Error {
  status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.status = status
  }
}

let cachedSiteFile: JiraSiteFile | null = null
let siteFileLoaded = false
const cachedTokens = new Map<string, string>()
// Why: decrypt failures are recorded per site so getStatus can explain
// failing reads without re-touching the keychain on every status poll.
const credentialErrors = new Map<string, string>()

function setCachedSiteFile(value: JiraSiteFile | null): void {
  cachedSiteFile = value
}

function setSiteFileLoaded(value: boolean): void {
  siteFileLoaded = value
}

function getOrcaDir(): string {
  return join(homedir(), '.orca')
}

function getSiteFilePath(): string {
  return join(getOrcaDir(), 'jira-sites.json')
}

function getTokenDir(): string {
  return join(getOrcaDir(), 'jira-tokens')
}

function getTokenPath(siteId: string): string {
  return join(getTokenDir(), `${Buffer.from(siteId).toString('base64url')}.enc`)
}

function ensureOrcaDir(): void {
  const dir = getOrcaDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function ensureTokenDir(): void {
  const dir = getTokenDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function emptySiteFile(): JiraSiteFile {
  return {
    version: 1,
    activeSiteId: null,
    selectedSiteId: null,
    sites: []
  }
}

function hasStoredToken(siteId: string): boolean {
  return cachedTokens.has(siteId) || credentialFileHasContent(getTokenPath(siteId))
}

function normalizeSite(input: unknown): JiraSite | null {
  if (!input || typeof input !== 'object') {
    return null
  }
  const record = input as Record<string, unknown>
  if (
    typeof record.id !== 'string' ||
    typeof record.siteUrl !== 'string' ||
    typeof record.email !== 'string' ||
    typeof record.displayName !== 'string' ||
    typeof record.accountId !== 'string'
  ) {
    return null
  }
  return {
    id: record.id,
    siteUrl: record.siteUrl,
    email: record.email,
    displayName: record.displayName,
    accountId: record.accountId,
    // Sites saved before self-hosted support have no authType; they are Cloud.
    authType: record.authType === 'server' ? 'server' : 'cloud'
  }
}

export { queue, createJiraRequestAbortError, acquire, release, apiBasePath, JiraApiError, cachedSiteFile, siteFileLoaded, cachedTokens, credentialErrors, getOrcaDir, getSiteFilePath, getTokenDir, getTokenPath, ensureOrcaDir, ensureTokenDir, emptySiteFile, hasStoredToken, normalizeSite, setCachedSiteFile, setSiteFileLoaded }
export { type QueuedJiraRequest, type JiraSiteFile, type JiraClientForSite }
