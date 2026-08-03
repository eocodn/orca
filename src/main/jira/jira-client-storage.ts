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
import { type JiraSiteFile, cachedSiteFile, siteFileLoaded, cachedTokens, credentialErrors, getSiteFilePath, getTokenPath, ensureOrcaDir, ensureTokenDir, emptySiteFile, hasStoredToken, normalizeSite, setCachedSiteFile, setSiteFileLoaded } from './jira-client-limiter'
function readSiteFileFromDisk(): JiraSiteFile {
  const path = getSiteFilePath()
  if (!existsSync(path)) {
    return emptySiteFile()
  }
  try {
    const parsed = JSON.parse(readFileSync(path, { encoding: 'utf-8' })) as Partial<JiraSiteFile>
    const sites = Array.isArray(parsed.sites)
      ? parsed.sites
          .map((site) => normalizeSite(site))
          .filter((site): site is JiraSite => site !== null)
          .filter((site) => hasStoredToken(site.id))
      : []
    const activeSiteId =
      typeof parsed.activeSiteId === 'string' &&
      sites.some((site) => site.id === parsed.activeSiteId)
        ? parsed.activeSiteId
        : (sites[0]?.id ?? null)
    const selectedSiteId =
      parsed.selectedSiteId === 'all' ||
      (typeof parsed.selectedSiteId === 'string' &&
        sites.some((site) => site.id === parsed.selectedSiteId))
        ? parsed.selectedSiteId
        : activeSiteId
    return { version: 1, activeSiteId, selectedSiteId, sites }
  } catch {
    return emptySiteFile()
  }
}

function getSiteFile(): JiraSiteFile {
  if (!siteFileLoaded || !cachedSiteFile) {
    setCachedSiteFile(readSiteFileFromDisk())
    setSiteFileLoaded(true)
  }
  return cachedSiteFile
}

function writeSiteFile(file: JiraSiteFile): void {
  ensureOrcaDir()
  const sites = file.sites.filter((site) => hasStoredToken(site.id))
  const activeSiteId =
    file.activeSiteId && sites.some((site) => site.id === file.activeSiteId)
      ? file.activeSiteId
      : (sites[0]?.id ?? null)
  const selectedSiteId =
    file.selectedSiteId === 'all'
      ? 'all'
      : file.selectedSiteId && sites.some((site) => site.id === file.selectedSiteId)
        ? file.selectedSiteId
        : activeSiteId

  setCachedSiteFile({
    version: 1,
    activeSiteId,
    selectedSiteId,
    sites
  })
  setSiteFileLoaded(true)
  writeFileSync(getSiteFilePath(), JSON.stringify(cachedSiteFile, null, 2), {
    encoding: 'utf-8',
    mode: 0o600
  })
}

function writeEncryptedToken(path: string, apiToken: string): void {
  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(path, safeStorage.encryptString(apiToken), { mode: 0o600 })
    return
  }
  console.warn('[jira] safeStorage encryption unavailable — storing token in plaintext')
  writeFileSync(path, apiToken, { encoding: 'utf-8', mode: 0o600 })
}

function readToken(siteId: string): string | null {
  const cached = cachedTokens.get(siteId)
  if (cached !== undefined) {
    return cached
  }
  const path = getTokenPath(siteId)
  if (!existsSync(path)) {
    return null
  }
  try {
    const raw = readFileSync(path)
    const token = readStoredCredentialToken('Jira', raw)
    if (token) {
      cachedTokens.set(siteId, token)
    }
    credentialErrors.delete(siteId)
    return token
  } catch (error) {
    if (error instanceof CredentialDecryptionError) {
      credentialErrors.set(siteId, error.message)
      throw error
    }
    return null
  }
}

function saveToken(siteId: string, apiToken: string): void {
  ensureOrcaDir()
  ensureTokenDir()
  writeEncryptedToken(getTokenPath(siteId), apiToken)
  cachedTokens.set(siteId, apiToken)
  credentialErrors.delete(siteId)
}

function deleteToken(siteId: string): void {
  cachedTokens.delete(siteId)
  credentialErrors.delete(siteId)
  try {
    unlinkSync(getTokenPath(siteId))
  } catch {
    // Token may not exist — safe to ignore.
  }
}

export { readSiteFileFromDisk, getSiteFile, writeSiteFile, writeEncryptedToken, readToken, saveToken, deleteToken }
