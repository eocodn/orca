import { createHash, randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import type {
  ClaudeManagedAccount,
  ClaudeManagedAccountSummary,
  ClaudeRateLimitAccountsState
} from '../../shared/types'
import type { Store } from '../persistence'
import type { RateLimitService } from '../rate-limits/service'
import { resolveClaudeCommand } from '../codex-cli/command'
import type { ClaudeRuntimeAuthService } from './runtime-auth-service'
import {
  getClaudeManagedAccountsRoot,
  readClaudeManagedAuthFile,
  resolveOwnedClaudeManagedAuthPath,
  writeClaudeManagedAuthFile
} from './managed-auth-path'
import {
  deleteActiveClaudeKeychainCredentialsStrict,
  deleteManagedClaudeKeychainCredentials,
  readActiveClaudeKeychainCredentials,
  readActiveClaudeKeychainCredentialsStrict,
  readManagedClaudeKeychainCredentials,
  writeActiveClaudeKeychainCredentials,
  writeManagedClaudeKeychainCredentials
} from './keychain'
import { beginClaudeAuthSwitch, endClaudeAuthSwitch } from './live-pty-gate'
import { findDuplicateClaudeAccount } from './claude-duplicate-account'
import { parseWslUncPath } from '../../shared/wsl-paths'
import { toWindowsWslPath } from '../wsl'
import { buildEncodedWslBashCommand } from '../wsl-bash-command'
import { buildWindowsCommandInvocation } from './windows-command-invocation'
import {
  getClaudeSelectionTargetForAccount,
  getSelectedClaudeAccountIdForTarget,
  normalizeClaudeAccountSelectionTarget,
  normalizeClaudeRuntimeSelection,
  pruneInvalidClaudeRuntimeSelection,
  removeClaudeAccountIdFromSelection,
  setSelectedClaudeAccountIdForTarget,
  type ClaudeAccountSelectionTarget
} from './runtime-selection'

export const LOGIN_TIMEOUT_MS = 180_000
export const STATUS_TIMEOUT_MS = 20_000
export const MAX_COMMAND_OUTPUT_CHARS = 4_000
export const WINDOWS_TASKKILL_TIMEOUT_MS = 5_000
// Claude leaves the login process running after an OAuth denial; fail fast so Settings can clear loading state.
export const CLAUDE_AUTH_DENIED_PATTERN =
  /\baccess_denied\b|authorization (?:request )?(?:was )?denied|sign-?in (?:was )?denied|login (?:was )?denied/i

export type ClaudeIdentity = {
  email: string | null
  organizationUuid: string | null
  organizationName: string | null
}

export type CapturedClaudeAuth = {
  credentialsJson: string
  oauthAccount: unknown
  identity: ClaudeIdentity
}

export type ManagedClaudeAuthSnapshot = {
  credentialsJson: string | null
  oauthAccountJson: string | null
}

export type ClaudeAccountAddTarget = {
  runtime?: 'host' | 'wsl'
  wslDistro?: string | null
}

export type ClaudeAccountImportOptions = ClaudeAccountAddTarget & {
  previousLegacyCredentialsSha256?: string | null
}

export type ManagedClaudeAuthLocation = {
  managedAuthPath: string
  managedAuthRuntime: 'host' | 'wsl'
  wslDistro: string | null
  wslLinuxAuthPath: string | null
}

export class DuplicateClaudeAccountError extends Error {}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}


  [key: string]: any

  protected mutationQueue: Promise<unknown> = Promise.resolve()
  protected cancelPendingClaudeLogin: (() => boolean) | null = null

  constructor(
    protected readonly store: Store,
    protected readonly rateLimits: RateLimitService,
    protected readonly runtimeAuth: ClaudeRuntimeAuthService
  ) {}

  listAccounts(): ClaudeRateLimitAccountsState {
    this.normalizeActiveSelection()
    return this.getSnapshot()
  }

  async addAccount(target?: ClaudeAccountAddTarget): Promise<ClaudeRateLimitAccountsState> {
    return this.serializeMutation(() => this.doAddAccount(target))
  }

  /**
   * Adds a managed Claude account from an already-authenticated `CLAUDE_CONFIG_DIR`
   * instead of driving the interactive browser login here. Enables the
   * `orca account add` CLI to run `claude login` in the user's own terminal on a
   * headless host, then register the captured credentials without a desktop GUI.
   */
  async addAccountFromConfigDir(
    configDir: string,
    options?: ClaudeAccountImportOptions
  ): Promise<ClaudeRateLimitAccountsState> {
    return this.serializeMutation(() => this.doAddAccountFromConfigDir(configDir, options))
  }

  async reauthenticateAccount(accountId: string): Promise<ClaudeRateLimitAccountsState> {
    return this.serializeMutation(() => this.doReauthenticateAccount(accountId))
  }

  async removeAccount(accountId: string): Promise<ClaudeRateLimitAccountsState> {
    return this.serializeMutation(() => this.doRemoveAccount(accountId))
  }

  async selectAccount(accountId: string | null): Promise<ClaudeRateLimitAccountsState> {
    return this.serializeMutation(() => this.doSelectAccount(accountId))
  }

  async selectAccountForTarget(
    accountId: string | null,
    target?: ClaudeAccountSelectionTarget
  ): Promise<ClaudeRateLimitAccountsState> {
    return this.serializeMutation(() => this.doSelectAccount(accountId, target))
  }

  cancelPendingLogin(): boolean {
    return this.cancelPendingClaudeLogin?.() ?? false
  }

  protected serializeMutation<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(fn, fn)
    this.mutationQueue = next.catch(() => {})
    return next
  }

  protected async doAddAccount(
    target?: ClaudeAccountAddTarget
  ): Promise<ClaudeRateLimitAccountsState> {
    const accountId = randomUUID()
    const managedAuth = this.createManagedAuthDir(accountId, target)
    const previousSettings = this.store.getSettings()
    try {
      const captured = await this.runClaudeLoginAndCapture(managedAuth)
      return await this.persistCapturedClaudeAccount(
        accountId,
        managedAuth,
        previousSettings,
        captured
      )
    } catch (error) {
      await this.cleanupFailedAdd(accountId, managedAuth.managedAuthPath, previousSettings, error)
      throw error
    }
  }

  protected async doAddAccountFromConfigDir(
    configDir: string,
    options?: ClaudeAccountImportOptions
  ): Promise<ClaudeRateLimitAccountsState> {
    const accountId = randomUUID()
    const managedAuth = this.createManagedAuthDir(accountId, options)
    const previousSettings = this.store.getSettings()
    try {
      const captured = await this.captureFromExistingConfigDir(
        configDir,
        options?.previousLegacyCredentialsSha256
      )
      return await this.persistCapturedClaudeAccount(
        accountId,
        managedAuth,
        previousSettings,
        captured
      )
    } catch (error) {
      await this.cleanupFailedAdd(accountId, managedAuth.managedAuthPath, previousSettings, error)
      throw error
    }
  }

  // Why: capture credentials from a CLAUDE_CONFIG_DIR the caller already
  // authenticated (e.g. a temp dir the CLI ran `claude login` into), mirroring
  // runClaudeLoginAndCapture's capture step but without spawning the interactive
  // login. On Linux/Windows the credentials live in a plaintext `.credentials.json`.
  protected async captureFromExistingConfigDir(
    configDir: string,
    previousLegacyCredentialsSha256?: string | null
  ): Promise<CapturedClaudeAuth> {
    const trimmed = configDir.trim()
    if (!trimmed) {
      throw new Error('A Claude config directory path is required.')
    }
    const resolvedDir = resolve(trimmed)
    // Why: macOS keeps Claude credentials in the Keychain rather than a file, so
    // only require `.credentials.json` off-darwin; captureAuthFromConfigDir reads
    // the scoped Keychain item on macOS.
    if (process.platform !== 'darwin' && !existsSync(join(resolvedDir, '.credentials.json'))) {
      throw new Error(
        `No Claude credentials found in ${resolvedDir}. Run \`claude login\` into this directory first.`
      )
    }
    // Why: `allowFailure` covers a non-zero exit but not a spawn error, and unlike
    // the GUI flow nothing has run `claude` in this process yet — a daemon started
    // with a minimal PATH (launchd/systemd) would hard-fail an add the user already
    // signed in for. Identity still resolves from the config dir's oauthAccount.
    let status = ''
    try {
      status = await this.runClaudeCommand(
        ['auth', 'status', '--json'],
        { windowsPath: resolvedDir, linuxPath: null, wslDistro: null },
        STATUS_TIMEOUT_MS,
        { allowFailure: true }
      )
    } catch (error) {
      console.warn('[claude-accounts] Could not read `claude auth status`:', error)
    }
    // Why: this post-login RPC did not observe the legacy Keychain value before
    // login unless the CLI supplied its one-way pre-login credential baseline.
    const currentLegacyKeychain = await readActiveClaudeKeychainCredentialsStrict()
    return this.captureAuthFromConfigDir(
      resolvedDir,
      status,
      currentLegacyKeychain,
      previousLegacyCredentialsSha256
    )
  }

  protected async persistCapturedClaudeAccount(
    accountId: string,
    managedAuth: ManagedClaudeAuthLocation,
    previousSettings: ReturnType<Store['getSettings']>,
    captured: CapturedClaudeAuth
  ): Promise<ClaudeRateLimitAccountsState> {
    if (!captured.identity.email) {
      throw new Error('Claude login completed, but Orca could not resolve the account email.')
    }
    // Why: duplicate rows confuse selection and rate-limit tracking; re-authentication
    // is the supported way to refresh an account that is already managed.
    if (
      findDuplicateClaudeAccount(previousSettings.claudeManagedAccounts, {
        email: captured.identity.email,
        organizationUuid: captured.identity.organizationUuid,
        managedAuthRuntime: managedAuth.managedAuthRuntime,
        wslDistro: managedAuth.wslDistro
      })
    ) {
      throw new DuplicateClaudeAccountError('This Claude account is already added.')
    }
    await this.writeManagedAuth(accountId, managedAuth.managedAuthPath, captured)

    const now = Date.now()
    const account: ClaudeManagedAccount = {
      id: accountId,
      email: captured.identity.email,
      managedAuthPath: managedAuth.managedAuthPath,
      managedAuthRuntime: managedAuth.managedAuthRuntime,
      wslDistro: managedAuth.wslDistro,
      wslLinuxAuthPath: managedAuth.wslLinuxAuthPath,
      authMethod: 'subscription-oauth',
      organizationUuid: captured.identity.organizationUuid,
      organizationName: captured.identity.organizationName,
      createdAt: now,
      updatedAt: now,
      lastAuthenticatedAt: now
    }

    const selection = normalizeClaudeRuntimeSelection(previousSettings)
    this.store.updateSettings({
      claudeManagedAccounts: [...previousSettings.claudeManagedAccounts, account],
      activeClaudeManagedAccountId: selection.host,
      activeClaudeManagedAccountIdsByRuntime: selection
    })
    this.runtimeAuth.clearLastWrittenCredentialsJson(accountId)
    this.rateLimits.evictInactiveClaudeCache(accountId)
    return this.getSnapshot()
  }

  protected async rollbackAddAccount(
    accountId: string,
    managedAuthPath: string,
    previousSettings: ReturnType<Store['getSettings']>
  ): Promise<void> {
    this.restoreClaudeSettings(previousSettings)
    // Why: rollback is best-effort — a failed rematerialization must not skip the
    // managed-auth cleanup below, and the caller rethrows the original add error.
    try {
      await this.runtimeAuth.forceMaterializeCurrentSelectionForRollback()
    } catch (rollbackError) {
      console.warn('[claude-accounts] Rollback rematerialization failed:', rollbackError)
    }
    await this.safeRemoveManagedAuth(accountId, managedAuthPath)
  }

  protected async cleanupFailedAdd(
    accountId: string,
    managedAuthPath: string,
    previousSettings: ReturnType<Store['getSettings']>,
    error: unknown
  ): Promise<void> {
    if (error instanceof DuplicateClaudeAccountError) {
      // Why: duplicate detection precedes writes; rollback I/O could only mask
      // the useful duplicate-account error.
      await this.safeRemoveManagedAuth(accountId, managedAuthPath)
      return
    }
    await this.rollbackAddAccount(accountId, managedAuthPath, previousSettings)
  }

  protected async doReauthenticateAccount(accountId: string): Promise<ClaudeRateLimitAccountsState> {
    const account = this.requireAccount(accountId)
    const managedAuthPath = this.assertManagedAuthPath(account.managedAuthPath, accountId)
    const previousSettings = this.store.getSettings()
    const previousManagedAuth = await this.readManagedAuthSnapshot(accountId, managedAuthPath)
    const captured = await this.runClaudeLoginAndCapture({
      managedAuthPath,
      managedAuthRuntime: account.managedAuthRuntime ?? 'host',
      wslDistro: account.wslDistro ?? null,
      wslLinuxAuthPath: account.wslLinuxAuthPath ?? null
    })
    if (!captured.identity.email) {
      throw new Error('Claude login completed, but Orca could not resolve the account email.')
    }

    const settings = this.store.getSettings()
    const now = Date.now()
    const reauthenticatedAccounts = settings.claudeManagedAccounts.map((entry) =>
      entry.id === accountId
        ? {
            ...entry,
            email: captured.identity.email!,
            organizationUuid: captured.identity.organizationUuid,
            organizationName: captured.identity.organizationName,
            updatedAt: now,
            lastAuthenticatedAt: now
          }
        : entry
    )
    let wroteManagedCredentials = false
    try {
      await this.writeManagedOauthAccount(accountId, managedAuthPath, captured.oauthAccount)
      await this.writeManagedCredentials(accountId, managedAuthPath, captured.credentialsJson)
      wroteManagedCredentials = true
      this.store.updateSettings({ claudeManagedAccounts: reauthenticatedAccounts })
      this.runtimeAuth.clearLastWrittenCredentialsJson(accountId)
      this.rateLimits.evictInactiveClaudeCache(accountId)
      await this.syncRuntimeAuthWithLivePtyGate(getClaudeSelectionTargetForAccount(account))
      await this.rateLimits.refreshForClaudeAccountChange(
        undefined,
        getClaudeSelectionTargetForAccount(account)
      )
      return this.getSnapshot()
    } catch (error) {
      let restoredManagedCredentials = false
      try {
        await this.restoreManagedCredentialsSnapshot(
          accountId,
          managedAuthPath,
          previousManagedAuth
        )
        restoredManagedCredentials = true
      } catch (rollbackError) {
        console.warn(
          '[claude-accounts] Failed to restore managed credentials during rollback:',
          rollbackError
        )
      }
      if (restoredManagedCredentials || !wroteManagedCredentials) {
        try {
          this.restoreManagedOauthSnapshot(accountId, managedAuthPath, previousManagedAuth)
        } catch (rollbackError) {
          console.warn(
            '[claude-accounts] Failed to restore managed oauth metadata during rollback:',
            rollbackError
          )
        }
      }
      if (restoredManagedCredentials) {
        this.restoreClaudeSettings(previousSettings)
        await this.runtimeAuth.forceMaterializeCurrentSelectionForRollback()
      } else if (wroteManagedCredentials) {
        this.store.updateSettings({ claudeManagedAccounts: reauthenticatedAccounts })
      } else {
        this.restoreClaudeSettings(previousSettings)
      }
      throw error
    }
  }

  protected async doRemoveAccount(accountId: string): Promise<ClaudeRateLimitAccountsState> {
    const account = this.requireAccount(accountId)
    const settings = this.store.getSettings()
    const nextAccounts = settings.claudeManagedAccounts.filter((entry) => entry.id !== accountId)
    const nextSelection = removeClaudeAccountIdFromSelection(
      normalizeClaudeRuntimeSelection(settings),
      accountId
    )
    const nextActiveId =
      settings.activeClaudeManagedAccountId === accountId ? null : nextSelection.host

    try {
      if (
        getSelectedClaudeAccountIdForTarget(
          settings,
          getClaudeSelectionTargetForAccount(account)
        ) === accountId
      ) {
        this.store.updateSettings({
          activeClaudeManagedAccountId: nextActiveId,
          activeClaudeManagedAccountIdsByRuntime: nextSelection
        })
        await this.syncRuntimeAuthWithLivePtyGate(getClaudeSelectionTargetForAccount(account))
        this.store.updateSettings({ claudeManagedAccounts: nextAccounts })
      } else {
        this.store.updateSettings({
          claudeManagedAccounts: nextAccounts,
          activeClaudeManagedAccountId: nextActiveId,
          activeClaudeManagedAccountIdsByRuntime: nextSelection
        })
        await this.syncRuntimeAuthWithLivePtyGate(getClaudeSelectionTargetForAccount(account))
      }
      await this.safeRemoveManagedAuth(accountId, account.managedAuthPath)
      this.rateLimits.evictInactiveClaudeCache(accountId)
      await this.rateLimits.refreshForClaudeAccountChange(
        getSelectedClaudeAccountIdForTarget(
          settings,
          getClaudeSelectionTargetForAccount(account)
        ) === accountId
          ? accountId
          : undefined,
        getClaudeSelectionTargetForAccount(account)
      )
      return this.getSnapshot()
    } catch (error) {
      this.restoreClaudeSettings(settings)
      await this.runtimeAuth.forceMaterializeCurrentSelectionForRollback()
      throw error
    }
  }

  protected async doSelectAccount(
    accountId: string | null,
    target?: ClaudeAccountSelectionTarget
  ): Promise<ClaudeRateLimitAccountsState> {
    let effectiveTarget = target
    if (accountId !== null) {
      const account = this.requireAccount(accountId)
      const accountTarget = getClaudeSelectionTargetForAccount(account)
      const requestedTarget = normalizeClaudeAccountSelectionTarget(target ?? accountTarget)
      const normalizedAccountTarget = normalizeClaudeAccountSelectionTarget(accountTarget)
      if (
        requestedTarget.runtime !== normalizedAccountTarget.runtime ||
        (requestedTarget.wslDistro !== null &&
          requestedTarget.wslDistro !== normalizedAccountTarget.wslDistro)
      ) {
        throw new Error('That Claude account belongs to a different runtime.')
      }
      effectiveTarget = accountTarget
    }
    const previousSettings = this.store.getSettings()
    const selection = normalizeClaudeRuntimeSelection(previousSettings)
    const outgoingAccountId = getSelectedClaudeAccountIdForTarget(previousSettings, effectiveTarget)
    const nextSelection = setSelectedClaudeAccountIdForTarget(selection, accountId, effectiveTarget)
    this.store.updateSettings({
      activeClaudeManagedAccountId:
        effectiveTarget?.runtime === 'wsl' ? nextSelection.host : accountId,
      activeClaudeManagedAccountIdsByRuntime: nextSelection
    })
    try {
      await this.syncRuntimeAuthWithLivePtyGate(effectiveTarget)
      await this.rateLimits.refreshForClaudeAccountChange(outgoingAccountId, effectiveTarget)
      return this.getSnapshot()
    } catch (error) {
      this.restoreClaudeSettings(previousSettings)
      await this.runtimeAuth.forceMaterializeCurrentSelectionForRollback()
      throw error
    }
  }

  protected getSnapshot(): ClaudeRateLimitAccountsState {
    const settings = this.store.getSettings()
    return {
      accounts: settings.claudeManagedAccounts
        .map((account) => this.toSummary(account))
        .sort((a, b) => b.updatedAt - a.updatedAt),
      activeAccountId: normalizeClaudeRuntimeSelection(settings).host,
      activeAccountIdsByRuntime: normalizeClaudeRuntimeSelection(settings)
    }
  }


}

