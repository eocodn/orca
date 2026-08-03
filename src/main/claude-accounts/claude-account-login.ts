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


import { LOGIN_TIMEOUT_MS,
  STATUS_TIMEOUT_MS,
  MAX_COMMAND_OUTPUT_CHARS,
  WINDOWS_TASKKILL_TIMEOUT_MS,
  CLAUDE_AUTH_DENIED_PATTERN,
  type ClaudeIdentity,
  type CapturedClaudeAuth,
  type ManagedClaudeAuthSnapshot,
  type ClaudeAccountAddTarget,
  type ClaudeAccountImportOptions,
  type ManagedClaudeAuthLocation,
  ClaudeAccountServiceFoundation,
  DuplicateClaudeAccountError,
  shellQuote  } from './claude-account-foundation'

export class ClaudeAccountServicePhase1 extends ClaudeAccountServiceFoundation {
  protected toSummary(account: ClaudeManagedAccount): ClaudeManagedAccountSummary {
    return {
      id: account.id,
      email: account.email,
      managedAuthRuntime: account.managedAuthRuntime ?? 'host',
      wslDistro: account.wslDistro ?? null,
      authMethod: account.authMethod ?? 'unknown',
      organizationUuid: account.organizationUuid ?? null,
      organizationName: account.organizationName ?? null,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      lastAuthenticatedAt: account.lastAuthenticatedAt
    }
  }

  protected requireAccount(accountId: string): ClaudeManagedAccount {
    const account = this.store
      .getSettings()
      .claudeManagedAccounts.find((entry) => entry.id === accountId)
    if (!account) {
      throw new Error('That Claude account no longer exists.')
    }
    return account
  }

  protected normalizeActiveSelection(): void {
    const settings = this.store.getSettings()
    const nextSelection = pruneInvalidClaudeRuntimeSelection(
      normalizeClaudeRuntimeSelection(settings),
      settings.claudeManagedAccounts
    )
    if (
      nextSelection.host !== settings.activeClaudeManagedAccountId ||
      JSON.stringify(nextSelection) !== JSON.stringify(normalizeClaudeRuntimeSelection(settings))
    ) {
      this.store.updateSettings({
        activeClaudeManagedAccountId: nextSelection.host,
        activeClaudeManagedAccountIdsByRuntime: nextSelection
      })
    }
  }

  protected restoreClaudeSettings(settings: ReturnType<Store['getSettings']>): void {
    this.store.updateSettings({
      claudeManagedAccounts: settings.claudeManagedAccounts,
      activeClaudeManagedAccountId: settings.activeClaudeManagedAccountId,
      activeClaudeManagedAccountIdsByRuntime: settings.activeClaudeManagedAccountIdsByRuntime
    })
  }

  protected async syncRuntimeAuthWithLivePtyGate(
    target?: ClaudeAccountSelectionTarget,
    operation?: () => Promise<void>
  ): Promise<void> {
    beginClaudeAuthSwitch()
    try {
      await (operation ? operation() : this.runtimeAuth.syncForCurrentSelection(target))
    } finally {
      endClaudeAuthSwitch()
    }
  }

  protected async runClaudeLoginAndCapture(
    location: ManagedClaudeAuthLocation = {
      managedAuthPath: '',
      managedAuthRuntime: 'host',
      wslDistro: null,
      wslLinuxAuthPath: null
    }
  ): Promise<CapturedClaudeAuth> {
    const tempConfig = this.createTemporaryClaudeConfigDir(location)
    const loginAbortController = new AbortController()
    this.cancelPendingClaudeLogin = () => {
      if (loginAbortController.signal.aborted) {
        return false
      }
      loginAbortController.abort()
      return true
    }
    const previousLegacyKeychain = await readActiveClaudeKeychainCredentials()
    let captured: CapturedClaudeAuth | null = null
    let captureError: unknown = null
    let cleanupError: unknown = null
    try {
      if (loginAbortController.signal.aborted) {
        throw new Error('Claude sign-in was cancelled.')
      }
      await this.runClaudeCommand(['auth', 'login', '--claudeai'], tempConfig, LOGIN_TIMEOUT_MS, {
        signal: loginAbortController.signal,
        keepStdinOpen: true
      })
      this.cancelPendingClaudeLogin = null
      const status = await this.runClaudeCommand(
        ['auth', 'status', '--json'],
        tempConfig,
        STATUS_TIMEOUT_MS,
        { allowFailure: true }
      )
      captured = await this.captureAuthFromConfigDir(
        tempConfig.windowsPath,
        status,
        previousLegacyKeychain
      )
    } catch (error) {
      captureError = error
    } finally {
      if (process.platform === 'darwin') {
        try {
          await deleteActiveClaudeKeychainCredentialsStrict(tempConfig.windowsPath)
        } catch (error) {
          console.warn('[claude-accounts] Failed to clean temporary Claude Keychain item:', error)
        }
      }
      if (process.platform === 'darwin') {
        try {
          // Why: older Claude versions ignored CLAUDE_CONFIG_DIR and wrote the
          // legacy active Keychain item. Preserve that external CLI state.
          await (previousLegacyKeychain
            ? writeActiveClaudeKeychainCredentials(previousLegacyKeychain)
            : deleteActiveClaudeKeychainCredentialsStrict())
        } catch (error) {
          cleanupError = error
        }
      }
      this.removeTemporaryClaudeConfigDir(tempConfig)
      this.cancelPendingClaudeLogin = null
    }
    if (captureError) {
      throw captureError
    }
    if (cleanupError) {
      throw cleanupError
    }
    return captured!
  }

  protected createTemporaryClaudeConfigDir(location: ManagedClaudeAuthLocation): {
    windowsPath: string
    linuxPath: string | null
    wslDistro: string | null
  } {
    if (location.managedAuthRuntime !== 'wsl') {
      return {
        windowsPath: mkdtempSync(join(tmpdir(), 'orca-claude-login-')),
        linuxPath: null,
        wslDistro: null
      }
    }
    if (!location.wslDistro) {
      throw new Error('Could not resolve the active WSL distribution for Claude login.')
    }
    const linuxPath = execFileSync(
      'wsl.exe',
      [
        '-d',
        location.wslDistro,
        '--',
        'bash',
        '-lc',
        'mktemp -d "${TMPDIR:-/tmp}/orca-claude-login.XXXXXX"'
      ],
      { encoding: 'utf-8', timeout: 5000 }
    )
      .replaceAll(String.fromCharCode(0), '')
      .trim()
    if (!linuxPath.startsWith('/')) {
      throw new Error('Could not create a temporary WSL Claude login directory.')
    }
    return {
      windowsPath: toWindowsWslPath(linuxPath, location.wslDistro),
      linuxPath,
      wslDistro: location.wslDistro
    }
  }

  protected removeTemporaryClaudeConfigDir(tempConfig: {
    windowsPath: string
    linuxPath: string | null
    wslDistro: string | null
  }): void {
    if (tempConfig.linuxPath && tempConfig.wslDistro) {
      try {
        execFileSync(
          'wsl.exe',
          [
            '-d',
            tempConfig.wslDistro,
            '--',
            'bash',
            '-lc',
            `rm -rf -- ${shellQuote(tempConfig.linuxPath)}`
          ],
          { encoding: 'utf-8', timeout: 5000 }
        )
      } catch {
        // Best-effort cleanup.
      }
      return
    }
    rmSync(tempConfig.windowsPath, { recursive: true, force: true })
  }

  protected async captureAuthFromConfigDir(
    configDir: string,
    statusOutput: string,
    previousLegacyKeychain: string | null,
    previousLegacyCredentialsSha256?: string | null
  ): Promise<CapturedClaudeAuth> {
    const credentialsJson = await this.readCapturedCredentials(
      configDir,
      previousLegacyKeychain,
      previousLegacyCredentialsSha256
    )
    if (!credentialsJson) {
      throw new Error('Claude login completed, but no OAuth credentials were captured.')
    }
    const oauthAccount = this.readOauthAccountFromConfigDir(configDir)
    const identity = this.resolveIdentity(statusOutput, oauthAccount, credentialsJson)
    return { credentialsJson, oauthAccount, identity }
  }

  protected async readCapturedCredentials(
    configDir: string,
    previousLegacyKeychain: string | null,
    previousLegacyCredentialsSha256?: string | null
  ): Promise<string | null> {
    if (process.platform === 'darwin') {
      const scopedCredentialsJson = await readActiveClaudeKeychainCredentialsStrict(configDir)
      if (scopedCredentialsJson) {
        return scopedCredentialsJson
      }
      const legacyCredentialsJson = await readActiveClaudeKeychainCredentialsStrict()
      const legacyChanged =
        previousLegacyCredentialsSha256 === undefined
          ? legacyCredentialsJson !== previousLegacyKeychain
          : legacyCredentialsJson !== null &&
            createHash('sha256').update(legacyCredentialsJson).digest('hex') !==
              previousLegacyCredentialsSha256
      if (legacyCredentialsJson && legacyChanged) {
        return legacyCredentialsJson
      }
    }
    const credentialsPath = join(configDir, '.credentials.json')
    return existsSync(credentialsPath) ? readFileSync(credentialsPath, 'utf-8') : null
  }

  protected readOauthAccountFromConfigDir(configDir: string): unknown {
    for (const configPath of [join(configDir, '.claude.json'), join(configDir, '.config.json')]) {
      if (!existsSync(configPath)) {
        continue
      }
      try {
        const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>
        if (parsed.oauthAccount) {
          return parsed.oauthAccount
        }
      } catch {
        continue
      }
    }
    return null
  }

  protected resolveIdentity(
    statusOutput: string,
    oauthAccount: unknown,
    credentialsJson: string
  ): ClaudeIdentity {
    const status = this.parseJsonObject(statusOutput)
    const oauth = this.asRecord(oauthAccount)
    const credentials = this.parseJsonObject(credentialsJson)
    const credentialOauth = this.asRecord(credentials?.claudeAiOauth)

    return {
      email: this.normalizeField(
        this.readString(status, 'email') ??
          this.readString(oauth, 'emailAddress') ??
          this.readString(oauth, 'email') ??
          this.readString(credentialOauth, 'email')
      ),
      organizationUuid: this.normalizeField(
        this.readString(status, 'organizationUuid') ??
          this.readString(status, 'organizationId') ??
          this.readString(oauth, 'organizationUuid') ??
          this.readString(oauth, 'organizationId')
      ),
      organizationName: this.normalizeField(
        this.readString(status, 'organizationName') ?? this.readString(oauth, 'organizationName')
      )
    }
  }

  protected async writeManagedAuth(
    accountId: string,
    managedAuthPath: string,
    captured: CapturedClaudeAuth
  ): Promise<void> {
    await this.writeManagedCredentials(accountId, managedAuthPath, captured.credentialsJson)
    await this.writeManagedOauthAccount(accountId, managedAuthPath, captured.oauthAccount)
  }

  protected async writeManagedCredentials(
    accountId: string,
    managedAuthPath: string,
    credentialsJson: string
  ): Promise<void> {
    const trustedPath = this.assertManagedAuthPath(managedAuthPath, accountId)
    if (process.platform === 'darwin') {
      await writeManagedClaudeKeychainCredentials(accountId, credentialsJson)
    } else {
      writeClaudeManagedAuthFile(trustedPath, '.credentials.json', credentialsJson)
    }
  }

  protected async writeManagedOauthAccount(
    accountId: string,
    managedAuthPath: string,
    oauthAccount: unknown
  ): Promise<void> {
    const trustedPath = this.assertManagedAuthPath(managedAuthPath, accountId)
    writeClaudeManagedAuthFile(
      trustedPath,
      'oauth-account.json',
      `${JSON.stringify(oauthAccount, null, 2)}\n`
    )
  }

  protected async readManagedAuthSnapshot(
    accountId: string,
    managedAuthPath: string
  ): Promise<ManagedClaudeAuthSnapshot> {
    const trustedPath = this.assertManagedAuthPath(managedAuthPath, accountId)
    return {
      credentialsJson:
        process.platform === 'darwin'
          ? await readManagedClaudeKeychainCredentials(accountId)
          : readClaudeManagedAuthFile(trustedPath, '.credentials.json'),
      oauthAccountJson: readClaudeManagedAuthFile(trustedPath, 'oauth-account.json')
    }
  }

  protected async restoreManagedCredentialsSnapshot(
    accountId: string,
    managedAuthPath: string,
    snapshot: ManagedClaudeAuthSnapshot
  ): Promise<void> {
    const trustedPath = this.assertManagedAuthPath(managedAuthPath, accountId)
    const credentialsPath = join(trustedPath, '.credentials.json')
    if (process.platform === 'darwin') {
      await (snapshot.credentialsJson !== null
        ? writeManagedClaudeKeychainCredentials(accountId, snapshot.credentialsJson)
        : deleteManagedClaudeKeychainCredentials(accountId))
    } else if (snapshot.credentialsJson !== null) {
      writeClaudeManagedAuthFile(trustedPath, '.credentials.json', snapshot.credentialsJson)
    } else {
      rmSync(credentialsPath, { force: true })
    }
  }

  protected restoreManagedOauthSnapshot(
    accountId: string,
    managedAuthPath: string,
    snapshot: ManagedClaudeAuthSnapshot
  ): void {
    const trustedPath = this.assertManagedAuthPath(managedAuthPath, accountId)
    const oauthPath = join(trustedPath, 'oauth-account.json')
    if (snapshot.oauthAccountJson !== null) {
      writeClaudeManagedAuthFile(trustedPath, 'oauth-account.json', snapshot.oauthAccountJson)
    } else {
      rmSync(oauthPath, { force: true })
    }
  }

  protected createManagedAuthDir(
    accountId: string,
    target?: ClaudeAccountAddTarget
  ): ManagedClaudeAuthLocation {
    const wslAuth = this.tryCreateWslManagedAuthDir(accountId, target)
    if (wslAuth) {
      return wslAuth
    }

    const managedAuthPath = join(this.getManagedAccountsRoot(), accountId, 'auth')
    mkdirSync(managedAuthPath, { recursive: true })
    writeFileSync(join(managedAuthPath, '.orca-managed-claude-auth'), `${accountId}\n`, 'utf-8')
    return {
      managedAuthPath: this.assertManagedAuthPath(managedAuthPath, accountId),
      managedAuthRuntime: 'host',
      wslDistro: null,
      wslLinuxAuthPath: null
    }
  }


}
