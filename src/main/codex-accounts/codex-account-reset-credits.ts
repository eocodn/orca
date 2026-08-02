import {  randomUUID } from 'node:crypto'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { app } from 'electron'
import { getSpawnArgsForWindows } from '../win32-utils'
import type {
  CodexManagedAccount,
  CodexManagedAccountSummary,
  CodexRateLimitAccountsState,
  CodexSystemDefaultIdentity
} from '../../shared/types'
import type {
  CodexRateLimitResetOutcome,
  CodexRateLimitResetResult,
  RateLimitState,
  RateLimitRuntimeTarget
} from '../../shared/rate-limit-types'
import {
  buildCodexResetCreditExpectedScope,
  type CodexResetCreditExpectedScope
} from '../../shared/codex-reset-credit-scope'
import type {
  CodexResetCreditAttemptLedger,
  DurableCodexResetCreditAttempt
} from '../../shared/codex-reset-credit-attempt-ledger'
import type { CodexRuntimeHomeService } from './runtime-home-service'
import { writeFileAtomically } from './fs-utils'
import { rewriteRelativePathConfigValues } from '../codex/codex-config-path-reference-rewrite'
import { stripCodexManagedHookTrustEntriesFromConfig } from '../codex/codex-managed-trust-reconciliation'
import { isCodexSystemDefaultRealHomeEnabled } from '../codex/codex-real-home-flag'
import { getCodexManagedHookInstallMaterial } from '../codex/hook-service'
import { syncSystemConfigIntoManagedCodexHome } from '../codex/codex-config-mirror'
import { getSystemCodexHomePath } from '../codex/codex-home-paths'
import { MANAGED_HOOK_TIMEOUT_SECONDS } from '../agent-hooks/installer-utils'
import { readCodexTopLevelModelProvider } from '../codex/codex-model-provider-config'
import { resolveCodexCommand } from '../codex-cli/command'
import type { Store } from '../persistence'
import type { RateLimitService } from '../rate-limits/service'
import { parseWslUncPath } from '../../shared/wsl-paths'
import { toWindowsWslPath } from '../wsl'
import { buildEncodedWslBashCommand } from '../wsl-bash-command'
import {
  buildWslCodexAvailabilityArgs,
  buildWslCodexLoginArgs,
  WSL_CODEX_AVAILABILITY_TIMEOUT_MS
} from './wsl-codex-command'
import {
  getCodexSelectionTargetForAccount,
  getSelectedCodexAccountIdForTarget,
  normalizeCodexAccountSelectionTarget,
  normalizeCodexRuntimeSelection,
  pruneInvalidCodexRuntimeSelection,
  removeCodexAccountIdFromSelection,
  setSelectedCodexAccountIdForTarget,
  type CodexAccountSelectionTarget
} from './runtime-selection'
import { assertOwnedHostCodexManagedHomePath } from './host-codex-managed-home-ownership'


import { LOGIN_TIMEOUT_MS,
  MAX_LOGIN_OUTPUT_CHARS,
  WINDOWS_RM_MAX_RETRIES,
  WINDOWS_RM_RETRY_DELAY_MS,
  WINDOWS_LOGIN_AUTH_POLL_INTERVAL_MS,
  WINDOWS_LOGIN_POST_AUTH_EXIT_GRACE_MS,
  WINDOWS_LOGIN_TREE_KILL_TIMEOUT_MS,
  type CodexOAuthCredentials,
  type ResolvedCodexIdentity,
  type CanonicalCodexConfig,
  type CodexAccountAddTarget,
  type CodexAccountServiceLifecycle,
  type ManagedHomeLocation,
  type CodexResetCreditRejectedBeforeProviderReason,
  type CodexResetCreditConsumedResult,
  type CodexResetCreditRejectedBeforeProviderResult,
  type CodexResetCreditConsumeResult,
  type CodexResetCreditAttempt,
  CodexResetCreditScopeRejection,
  resetScopeKey,
  resetAccountScopeKey,
  sameRateLimitTarget,
  shellQuote,
  removeManagedHomeTreeSync,
  killLoginProcessTree,
  readLoginAuthSnapshot,
  loginAuthChanged  } from './codex-account-foundation'
import { CodexAccountServicePhase1 } from './codex-account-login'

export class CodexAccountServicePhase2 extends CodexAccountServicePhase1 {
  protected async doReauthenticateAccount(accountId: string): Promise<CodexRateLimitAccountsState> {
    const account = this.requireAccount(accountId)
    const managedHomePath = this.ensureManagedHomeForReauthentication(account)
    const accountTarget = getCodexSelectionTargetForAccount(account)
    const selectedAccountId = getSelectedCodexAccountIdForTarget(
      this.store.getSettings(),
      accountTarget
    )

    this.safeSyncCanonicalConfigIntoManagedHome(managedHomePath, undefined, account.id)
    await this.runCodexLogin(managedHomePath)
    const identity = this.readIdentityFromHome(managedHomePath, account.id)
    if (!identity.email) {
      throw new Error('Codex login completed, but Orca could not resolve the account email.')
    }

    const settings = this.store.getSettings()
    const now = Date.now()
    const updatedAccounts = settings.codexManagedAccounts.map((entry) =>
      entry.id === accountId
        ? {
            ...entry,
            email: identity.email!,
            providerAccountId: identity.providerAccountId,
            workspaceLabel: identity.workspaceLabel,
            workspaceAccountId: identity.workspaceAccountId,
            updatedAt: now,
            lastAuthenticatedAt: now
          }
        : entry
    )
    const activeSelection = setSelectedCodexAccountIdForTarget(
      normalizeCodexRuntimeSelection(settings),
      selectedAccountId,
      accountTarget
    )

    // Why: login can transiently clear this runtime's selection; unrelated runtime validation must remain authoritative.
    this.store.updateSettings({
      codexManagedAccounts: updatedAccounts,
      activeCodexManagedAccountId: activeSelection.host,
      activeCodexManagedAccountIdsByRuntime: activeSelection
    })
    this.safeSyncCanonicalConfigToManagedHomes()
    this.runtimeHome.clearLastWrittenAuthJson(accountId)
    this.runtimeHome.syncForCurrentSelection(accountTarget)

    // Why: re-auth can change the underlying Codex identity, so force a fresh read to avoid showing stale quota.
    this.startQuotaRefreshInBackground(undefined, accountTarget)
    return this.getSnapshot()
  }

  protected async doRemoveAccount(accountId: string): Promise<CodexRateLimitAccountsState> {
    const account = this.requireAccount(accountId)
    const settings = this.store.getSettings()
    const nextAccounts = settings.codexManagedAccounts.filter((entry) => entry.id !== accountId)
    const nextSelection = removeCodexAccountIdFromSelection(
      normalizeCodexRuntimeSelection(settings),
      accountId
    )
    const nextActiveId =
      settings.activeCodexManagedAccountId === accountId ? null : nextSelection.host

    this.store.updateSettings({
      codexManagedAccounts: nextAccounts,
      activeCodexManagedAccountId: nextActiveId,
      activeCodexManagedAccountIdsByRuntime: nextSelection
    })
    this.runtimeHome.syncForCurrentSelection()
    if (account.managedHomeRuntime === 'host' && nextSelection.host === null) {
      this.lifecycle.onHostSystemDefaultSelected?.()
    }

    this.safeRemoveManagedHome(account.managedHomePath, account.id)
    // Why: a removed account can no longer appear in the switcher dropdown,
    // so purge its cached usage to avoid stale entries.
    this.rateLimits.evictInactiveCodexCache(accountId)
    this.discardResetAttemptsForRemovedAccount(accountId)
    this.startQuotaRefreshInBackground(
      getSelectedCodexAccountIdForTarget(settings, getCodexSelectionTargetForAccount(account)) ===
        accountId
        ? accountId
        : undefined,
      getCodexSelectionTargetForAccount(account)
    )
    return this.getSnapshot()
  }

  protected async doSelectAccount(
    accountId: string | null,
    target?: CodexAccountSelectionTarget
  ): Promise<CodexRateLimitAccountsState> {
    let effectiveTarget = target
    if (accountId !== null) {
      const account = this.requireAccount(accountId)
      const accountTarget = getCodexSelectionTargetForAccount(account)
      const requestedTarget = normalizeCodexAccountSelectionTarget(target ?? accountTarget)
      const normalizedAccountTarget = normalizeCodexAccountSelectionTarget(accountTarget)
      if (
        requestedTarget.runtime !== normalizedAccountTarget.runtime ||
        (requestedTarget.wslDistro !== null &&
          requestedTarget.wslDistro !== normalizedAccountTarget.wslDistro)
      ) {
        throw new Error('That Codex account belongs to a different runtime.')
      }
      effectiveTarget = accountTarget
    }

    const previousSettings = this.store.getSettings()
    const selection = normalizeCodexRuntimeSelection(previousSettings)
    const outgoingAccountId = getSelectedCodexAccountIdForTarget(previousSettings, effectiveTarget)
    const nextSelection = setSelectedCodexAccountIdForTarget(selection, accountId, effectiveTarget)

    this.store.updateSettings({
      activeCodexManagedAccountId:
        effectiveTarget?.runtime === 'wsl' ? nextSelection.host : accountId,
      activeCodexManagedAccountIdsByRuntime: nextSelection
    })
    this.safeSyncCanonicalConfigToManagedHomes()
    this.runtimeHome.syncForCurrentSelection(effectiveTarget)
    if (
      accountId === null &&
      normalizeCodexAccountSelectionTarget(effectiveTarget).runtime === 'host'
    ) {
      this.lifecycle.onHostSystemDefaultSelected?.()
    }

    this.startQuotaRefreshInBackground(outgoingAccountId, effectiveTarget)
    return this.getSnapshot()
  }

  protected getSnapshot(): CodexRateLimitAccountsState {
    const settings = this.store.getSettings()
    return {
      accounts: settings.codexManagedAccounts
        .map((account) => this.toSummary(account))
        .sort((a, b) => b.updatedAt - a.updatedAt),
      activeAccountId: normalizeCodexRuntimeSelection(settings).host,
      activeAccountIdsByRuntime: normalizeCodexRuntimeSelection(settings),
      systemDefault: this.resolveSystemDefaultIdentity()
    }
  }

  // Why: the system-default (activeAccountId:null) account has no stored
  // identity — its effective login is whatever the real ~/.codex/auth.json is
  // right now. Read it live and read-only so the switcher can display who the
  // system default is and attribute usage, without ever mutating ~/.codex.
  protected resolveSystemDefaultIdentity(): CodexSystemDefaultIdentity {
    const authFilePath = join(homedir(), '.codex', 'auth.json')
    let contents: string
    try {
      // Why: a single read avoids an exists/read race and halves filesystem
      // probes whenever an accounts snapshot resolves this live identity.
      contents = readFileSync(authFilePath, 'utf-8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        // Why: no auth.json means either a signed-out home or an env-key/custom
        // provider that authenticates via OPENAI_API_KEY instead of a token file.
        return {
          hasAuth: false,
          authKind: this.hasEnvApiKey() ? 'api-key' : 'none',
          email: null,
          providerAccountId: null,
          workspaceLabel: null
        }
      }
      console.warn(
        '[codex-accounts] Failed to read system-default Codex identity',
        code ?? 'unknown-error'
      )
      return {
        hasAuth: true,
        authKind: 'none',
        email: null,
        providerAccountId: null,
        workspaceLabel: null
      }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(contents)
    } catch {
      // Why: SyntaxError messages can echo malformed input; never let auth
      // contents or token fragments reach logs while degrading safely.
      console.warn('[codex-accounts] System-default Codex auth is not valid JSON')
      return {
        hasAuth: true,
        authKind: 'none',
        email: null,
        providerAccountId: null,
        workspaceLabel: null
      }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      // Why: valid JSON can still have the wrong shape; account listing must
      // degrade to an unknown identity instead of crashing the settings pane.
      console.warn('[codex-accounts] System-default Codex auth has an unexpected format')
      return {
        hasAuth: true,
        authKind: 'none',
        email: null,
        providerAccountId: null,
        workspaceLabel: null
      }
    }
    const raw = parsed as Record<string, unknown>

    if (typeof raw.OPENAI_API_KEY === 'string' && raw.OPENAI_API_KEY.trim() !== '') {
      // Why: API-key/custom-provider logins carry no OAuth identity or ChatGPT
      // usage. Surface them as a custom provider, not a blank/broken row.
      return {
        hasAuth: true,
        authKind: 'api-key',
        email: null,
        providerAccountId: null,
        workspaceLabel: null
      }
    }

    const identity = this.resolveIdentityFromCredentials(this.extractOAuthCredentials(raw))
    return {
      hasAuth: true,
      authKind: 'oauth',
      email: identity.email,
      providerAccountId: identity.providerAccountId,
      workspaceLabel: identity.workspaceLabel
    }
  }

  protected hasEnvApiKey(): boolean {
    const key = process.env.OPENAI_API_KEY
    return typeof key === 'string' && key.trim() !== ''
  }

  protected toSummary(account: CodexManagedAccount): CodexManagedAccountSummary {
    return {
      id: account.id,
      email: account.email,
      managedHomeRuntime: account.managedHomeRuntime ?? 'host',
      wslDistro: account.wslDistro ?? null,
      providerAccountId: account.providerAccountId ?? null,
      workspaceLabel: account.workspaceLabel ?? null,
      workspaceAccountId: account.workspaceAccountId ?? null,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      lastAuthenticatedAt: account.lastAuthenticatedAt
    }
  }

  protected requireAccount(accountId: string): CodexManagedAccount {
    const settings = this.store.getSettings()
    const account = settings.codexManagedAccounts.find((entry) => entry.id === accountId)
    if (!account) {
      throw new Error('That Codex rate limit account no longer exists.')
    }
    return account
  }

  protected normalizeActiveSelection(): void {
    const settings = this.store.getSettings()
    const selection = normalizeCodexRuntimeSelection(settings)
    const nextSelection = pruneInvalidCodexRuntimeSelection(
      selection,
      settings.codexManagedAccounts
    )
    const changed =
      nextSelection.host !== selection.host ||
      JSON.stringify(nextSelection.wsl) !== JSON.stringify(selection.wsl)
    if (changed) {
      this.store.updateSettings({
        activeCodexManagedAccountId: nextSelection.host,
        activeCodexManagedAccountIdsByRuntime: nextSelection
      })
      if (selection.host !== null && nextSelection.host === null) {
        this.lifecycle.onHostSystemDefaultSelected?.()
      }
    }
  }

  protected createManagedHome(
    accountId: string,
    target?: CodexAccountAddTarget
  ): ManagedHomeLocation {
    const wslHome = this.tryCreateWslManagedHome(accountId, target)
    if (wslHome) {
      return wslHome
    }

    const managedHomePath = join(this.getManagedAccountsRoot(), accountId, 'home')
    mkdirSync(managedHomePath, { recursive: true })
    // Why: marker lets future cleanup prove the path belongs to Orca before deleting anything.
    writeFileSync(join(managedHomePath, '.orca-managed-home'), `${accountId}\n`, 'utf-8')
    return {
      managedHomePath: this.assertManagedHomePath(managedHomePath, accountId),
      managedHomeRuntime: 'host',
      wslDistro: null,
      wslLinuxHomePath: null
    }
  }


}
