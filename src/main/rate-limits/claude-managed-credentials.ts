import { existsSync, lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseWslUncPath } from '../../shared/wsl-paths'
import type { ProviderRateLimits, RateLimitWindow } from '../../shared/rate-limit-types'
import type { ClaudeRuntimeAuthPreparation } from '../claude-accounts/runtime-auth-service'
import {
  deleteActiveClaudeKeychainCredentialsStrict,
  readActiveClaudeKeychainCredentialsStrict,
  readManagedClaudeKeychainCredentials,
  writeActiveClaudeKeychainCredentials,
  writeManagedClaudeKeychainCredentials
} from '../claude-accounts/keychain'
import {
  readClaudeManagedAuthFile,
  resolveOwnedClaudeManagedAuthPath,
  writeClaudeManagedAuthFile
} from '../claude-accounts/managed-auth-path'

export type InactiveClaudeAccountInfo = {
  id: string
  managedAuthPath: string
  managedAuthRuntime?: 'host' | 'wsl'
  wslDistro?: string | null
  wslLinuxAuthPath?: string | null
}

export type ManagedCredentialsLocation =
  | { kind: 'keychain'; accountId: string; managedAuthPath: string }
  | { kind: 'file'; managedAuthPath: string }

export function resolveManagedCredentialsLocation(
  account: InactiveClaudeAccountInfo
): ManagedCredentialsLocation | null {
  if (account.managedAuthRuntime === 'wsl') {
    const managedAuthPath = resolveOwnedWslClaudeManagedAuthPath(account)
    return managedAuthPath ? { kind: 'file', managedAuthPath } : null
  }
  const managedAuthPath = resolveOwnedClaudeManagedAuthPath(account.id, account.managedAuthPath, {
    adoptLegacyMarker: true
  })
  if (!managedAuthPath) {
    return null
  }
  return process.platform === 'darwin'
    ? { kind: 'keychain', accountId: account.id, managedAuthPath }
    : { kind: 'file', managedAuthPath }
}

async function readManagedCredentialsJson(
  location: ManagedCredentialsLocation
): Promise<string | null> {
  try {
    return location.kind === 'keychain'
      ? await readManagedClaudeKeychainCredentials(location.accountId)
      : readClaudeManagedAuthFile(location.managedAuthPath, '.credentials.json')
  } catch {
    return null
  }
}

export async function writeManagedCredentialsJson(
  location: ManagedCredentialsLocation,
  credentialsJson: string
): Promise<void> {
  if (location.kind === 'keychain') {
    await writeManagedClaudeKeychainCredentials(location.accountId, credentialsJson)
    return
  }
  writeClaudeManagedAuthFile(location.managedAuthPath, '.credentials.json', credentialsJson)
}

function resolveOwnedWslClaudeManagedAuthPath(
  account: InactiveClaudeAccountInfo
): string | null {
  if (process.platform !== 'win32') {
    return null
  }
  const wslInfo = parseWslUncPath(account.managedAuthPath)
  if (!wslInfo || (account.wslDistro && wslInfo.distro !== account.wslDistro)) {
    return null
  }
  const linuxPath = account.wslLinuxAuthPath ?? wslInfo.linuxPath
  if (
    !linuxPath.includes('/.local/share/orca/claude-accounts/') ||
    !linuxPath.endsWith(`/${account.id}/auth`)
  ) {
    return null
  }
  try {
    const markerPath = path.join(account.managedAuthPath, '.orca-managed-claude-auth')
    return existsSync(markerPath) &&
      !lstatSync(markerPath).isSymbolicLink() &&
      readFileSync(markerPath, 'utf-8').trim() === account.id
      ? account.managedAuthPath
      : null
  } catch {
    return null
  }
}

export function getManagedUsagePanelAuthPreparation(
  account: InactiveClaudeAccountInfo,
  location: ManagedCredentialsLocation
): ClaudeRuntimeAuthPreparation | null {
  if (process.platform === 'win32') {
    return null
  }
  if (account.managedAuthRuntime === 'wsl') {
    if (!account.wslLinuxAuthPath || !account.wslDistro) {
      return null
    }
    return {
      configDir: location.managedAuthPath,
      runtime: 'wsl',
      wslDistro: account.wslDistro,
      wslLinuxConfigDir: account.wslLinuxAuthPath,
      envPatch: { CLAUDE_CONFIG_DIR: account.wslLinuxAuthPath },
      stripAuthEnv: true,
      provenance: `managed:${account.id}:inactive-preview`
    }
  }
  return {
    configDir: location.managedAuthPath,
    runtime: 'host',
    wslDistro: null,
    wslLinuxConfigDir: null,
    envPatch: { CLAUDE_CONFIG_DIR: location.managedAuthPath },
    stripAuthEnv: true,
    provenance: `managed:${account.id}:inactive-preview`
  }
}

function windowsAgree(left: RateLimitWindow | null, right: RateLimitWindow | null): boolean {
  return Boolean(left && right && Math.abs(left.usedPercent - right.usedPercent) <= 1)
}

export function canTrustManagedUsagePanelSupplement(
  oauthLimits: ProviderRateLimits,
  cliLimits: ProviderRateLimits,
  options: { requireMatchingOAuthWindow: boolean }
): boolean {
  if (!options.requireMatchingOAuthWindow) {
    return true
  }
  const sharedWindowMatches = [
    oauthLimits.session && cliLimits.session
      ? windowsAgree(oauthLimits.session, cliLimits.session)
      : null,
    oauthLimits.weekly && cliLimits.weekly
      ? windowsAgree(oauthLimits.weekly, cliLimits.weekly)
      : null
  ].filter((match): match is boolean => match !== null)
  return sharedWindowMatches.length > 0 && sharedWindowMatches.every(Boolean)
}

export async function withManagedPreviewKeychainCredentials<T>(
  location: ManagedCredentialsLocation,
  credentialsJson: string,
  fn: () => Promise<T>
): Promise<T> {
  if (location.kind !== 'keychain') {
    return fn()
  }
  await writeActiveClaudeKeychainCredentials(credentialsJson, location.managedAuthPath)
  try {
    return await fn()
  } finally {
    await deleteActiveClaudeKeychainCredentialsStrict(location.managedAuthPath).catch(() => {})
  }
}

export async function readStagedManagedPreviewCredentials(
  location: ManagedCredentialsLocation
): Promise<string | null> {
  if (location.kind !== 'keychain') {
    return null
  }
  try {
    return await readActiveClaudeKeychainCredentialsStrict(location.managedAuthPath)
  } catch {
    return null
  }
}

export async function readManagedCredentials(
  location: ManagedCredentialsLocation
): Promise<string | null> {
  return readManagedCredentialsJson(location)
}
