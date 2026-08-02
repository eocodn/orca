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
import { type JiraClientForSite, JiraApiError } from './jira-client-limiter'
import { authHeader, describeErrorCause } from './jira-client-auth'
async function jiraFetch(url: string, init: RequestInit): Promise<Response> {
  return withSpan(
    'jira.request',
    async (span) => {
      span.setAttribute('jira.siteUrl', new URL(url).origin)
      await ensureElectronProxyFromEnvironment({
        proxySession: session.defaultSession,
        probeUrl: url
      }).catch((error) => {
        span.addEvent('jira.proxySetupFailed', {
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: error instanceof Error ? error.message : String(error)
        })
      })
      try {
        // Why: Electron's network stack follows Chromium proxy/session state,
        // avoiding undici's stale keep-alive sockets after VPN path changes.
        return await net.fetch(url, init)
      } catch (error) {
        span.setAttribute(
          'jira.transportErrorName',
          error instanceof Error ? error.name : typeof error
        )
        span.setAttribute(
          'jira.transportErrorMessage',
          error instanceof Error ? error.message : String(error)
        )
        const cause = describeErrorCause(error)
        if (cause) {
          span.setAttribute('jira.transportErrorCause', cause)
        }
        throw error
      }
    },
    { kind: 'client' }
  )
}

async function requestWithCredentials(
  siteUrl: string,
  email: string,
  apiToken: string,
  path: string,
  init?: RequestInit,
  authType?: JiraAuthType
): Promise<unknown> {
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  headers.set('Content-Type', 'application/json')
  headers.set('User-Agent', JIRA_API_USER_AGENT)
  headers.set('Authorization', authHeader(email, apiToken, authType))
  const response = await jiraFetch(`${siteUrl}${path}`, {
    ...init,
    headers
  })
  if (!response.ok) {
    throw new JiraApiError(await readJiraError(response), response.status)
  }
  if (response.status === 204) {
    return null
  }
  return response.json()
}

async function readJiraError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as {
      errorMessages?: string[]
      errors?: Record<string, string>
      message?: string
    }
    const messages = [
      ...(Array.isArray(data.errorMessages) ? data.errorMessages : []),
      ...Object.values(data.errors ?? {}),
      ...(data.message ? [data.message] : [])
    ].filter(Boolean)
    if (messages.length > 0) {
      return messages.join('; ')
    }
  } catch {
    // Fall through to status text.
  }
  return response.statusText || `Jira request failed (${response.status})`
}

async function jiraRequest<T>(
  client: JiraClientForSite,
  path: string,
  init?: RequestInit
): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  headers.set('Content-Type', 'application/json')
  headers.set('User-Agent', JIRA_API_USER_AGENT)
  headers.set('Authorization', client.authorization)
  const response = await jiraFetch(`${client.site.siteUrl}${path}`, {
    ...init,
    headers
  })
  if (!response.ok) {
    throw new JiraApiError(await readJiraError(response), response.status)
  }
  if (response.status === 204) {
    return null as T
  }
  return (await response.json()) as T
}

async function jiraRequestBinary(
  client: JiraClientForSite,
  pathOrUrl: string
): Promise<{ data: ArrayBuffer; contentType: string }> {
  const siteUrl = new URL(client.site.siteUrl)
  const requestUrl = /^https?:\/\//i.test(pathOrUrl)
    ? new URL(pathOrUrl)
    : new URL(`${client.site.siteUrl}${pathOrUrl}`)
  if (requestUrl.origin !== siteUrl.origin) {
    // Why: attachment metadata is provider-controlled; never forward Jira
    // credentials if a malformed response points at another origin.
    throw new JiraApiError('Jira attachment URL must use the configured site origin.', null)
  }
  const headers = new Headers()
  // Why: attachment content is binary; forcing JSON Accept/Content-Type can
  // break downloads and confuses some Atlassian edge responses.
  headers.set('Accept', '*/*')
  headers.set('User-Agent', JIRA_API_USER_AGENT)
  headers.set('Authorization', client.authorization)
  const response = await jiraFetch(requestUrl.toString(), { headers })
  if (!response.ok) {
    throw new JiraApiError(await readJiraError(response), response.status)
  }
  const contentType = response.headers.get('content-type') || 'application/octet-stream'
  return {
    data: await response.arrayBuffer(),
    contentType
  }
}

export { jiraFetch, requestWithCredentials, readJiraError, jiraRequest, jiraRequestBinary }

