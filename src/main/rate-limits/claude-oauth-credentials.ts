import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  readActiveClaudeKeychainCredentials,
  readActiveClaudeKeychainCredentialsStrict
} from '../claude-accounts/keychain'

type KeychainCredentials = {
  claudeAiOauth?: {
    accessToken?: string
    refreshToken?: string
    expiresAt?: number
  }
}

export type OAuthCredentialSource =
  | 'scoped-keychain'
  | 'legacy-keychain'
  | 'credentials-file'
  | 'none'

export type OAuthCredentialReadResult = {
  token: string | null
  hasRefreshableCredentials: boolean
  source: OAuthCredentialSource
  keychainUnavailable?: boolean
}

export type OAuthCredentialReadOptions = {
  credentialsFileConfigDir?: string
  keychainConfigDir?: string
}

export function parseOAuthCredentialsJson(
  raw: string,
  source: OAuthCredentialSource
): OAuthCredentialReadResult {
  try {
    const parsed = JSON.parse(raw) as KeychainCredentials
    const oauth = parsed?.claudeAiOauth
    const token = oauth?.accessToken
    const refreshToken = oauth?.refreshToken
    const hasRefreshableCredentials = typeof refreshToken === 'string' && refreshToken.trim() !== ''
    if (!token || typeof token !== 'string') {
      return { token: null, hasRefreshableCredentials, source }
    }
    // Local expiry is advisory; the usage endpoint is authoritative.
    return { token, hasRefreshableCredentials, source }
  } catch {
    return emptyOAuthCredentialReadResult()
  }
}

function emptyOAuthCredentialReadResult(): OAuthCredentialReadResult {
  return { token: null, hasRefreshableCredentials: false, source: 'none' }
}

function keychainUnavailableOAuthCredentialReadResult(): OAuthCredentialReadResult {
  return { ...emptyOAuthCredentialReadResult(), keychainUnavailable: true }
}

async function readCredentialsFromStrictKeychain(
  configDir: string | undefined,
  source: OAuthCredentialSource
): Promise<OAuthCredentialReadResult> {
  try {
    const credentials = await readActiveClaudeKeychainCredentialsStrict(configDir)
    return credentials
      ? parseOAuthCredentialsJson(credentials, source)
      : emptyOAuthCredentialReadResult()
  } catch {
    return keychainUnavailableOAuthCredentialReadResult()
  }
}

async function readFromKeychain(configDir?: string): Promise<OAuthCredentialReadResult> {
  if (process.platform !== 'darwin') {
    return emptyOAuthCredentialReadResult()
  }

  if (configDir) {
    const scopedCredentials = await readCredentialsFromStrictKeychain(configDir, 'scoped-keychain')
    if (scopedCredentials.token) {
      return scopedCredentials
    }
    const legacyCredentials = await readCredentialsFromStrictKeychain(undefined, 'legacy-keychain')
    if (legacyCredentials.token) {
      return legacyCredentials
    }
    if (scopedCredentials.hasRefreshableCredentials) {
      return scopedCredentials
    }
    if (legacyCredentials.hasRefreshableCredentials) {
      return legacyCredentials
    }
    return scopedCredentials.keychainUnavailable || legacyCredentials.keychainUnavailable
      ? keychainUnavailableOAuthCredentialReadResult()
      : legacyCredentials
  }

  try {
    const credentials = await readActiveClaudeKeychainCredentials(configDir)
    return credentials
      ? parseOAuthCredentialsJson(credentials, 'legacy-keychain')
      : emptyOAuthCredentialReadResult()
  } catch {
    return keychainUnavailableOAuthCredentialReadResult()
  }
}

async function readFromCredentialsFile(configDir?: string): Promise<OAuthCredentialReadResult> {
  const credPath = path.join(configDir ?? path.join(homedir(), '.claude'), '.credentials.json')
  try {
    return parseOAuthCredentialsJson(await readFile(credPath, 'utf-8'), 'credentials-file')
  } catch {
    return emptyOAuthCredentialReadResult()
  }
}

export async function readOAuthCredentials(
  options?: OAuthCredentialReadOptions
): Promise<OAuthCredentialReadResult> {
  const fromKeychain = await readFromKeychain(options?.keychainConfigDir)
  if (fromKeychain.token || fromKeychain.hasRefreshableCredentials) {
    return fromKeychain
  }

  const fromFile = await readFromCredentialsFile(options?.credentialsFileConfigDir)
  if (fromFile.token || fromFile.hasRefreshableCredentials) {
    return fromFile
  }
  return fromKeychain.keychainUnavailable ? fromKeychain : emptyOAuthCredentialReadResult()
}
