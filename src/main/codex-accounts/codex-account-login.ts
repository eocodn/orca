import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
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
import { writeFileAtomically } from './fs-utils'
import {
  getCodexSelectionTargetForAccount,
  getSelectedCodexAccountIdForTarget,
  normalizeCodexAccountSelectionTarget,
  setSelectedCodexAccountIdForTarget,
} from './runtime-selection'


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
  CodexAccountServiceFoundation,
  CodexResetCreditScopeRejection,
  resetScopeKey,
  resetAccountScopeKey,
  sameRateLimitTarget,
  shellQuote,
  removeManagedHomeTreeSync,
  killLoginProcessTree,
  readLoginAuthSnapshot,
  loginAuthChanged  } from './codex-account-foundation'

export class CodexAccountServicePhase1 extends CodexAccountServiceFoundation {
  protected validateResetCreditScope(
    expectedScope: CodexResetCreditExpectedScope,
    requireCurrentOffer: boolean
  ): { managedHomePath: string; rateLimits: RateLimitState } {
    const rateLimitState = this.rateLimits.getState()
    if (!sameRateLimitTarget(rateLimitState.codexTarget, expectedScope.target)) {
      throw new CodexResetCreditScopeRejection(
        'targetChanged',
        rateLimitState,
        'The active Codex rate-limit target changed before reset.'
      )
    }

    const settings = this.store.getSettings()
    if (
      getSelectedCodexAccountIdForTarget(settings, expectedScope.target) !== expectedScope.accountId
    ) {
      throw new CodexResetCreditScopeRejection(
        'accountChanged',
        rateLimitState,
        'The selected Codex account changed before reset.'
      )
    }
    const account = settings.codexManagedAccounts.find(
      (candidate) => candidate.id === expectedScope.accountId
    )
    if (!account || account.updatedAt !== expectedScope.accountRevision) {
      throw new CodexResetCreditScopeRejection(
        'accountRevisionChanged',
        rateLimitState,
        'The selected Codex account was updated before reset.'
      )
    }
    const normalizedAccountTarget = normalizeCodexAccountSelectionTarget(
      getCodexSelectionTargetForAccount(account)
    )
    if (!sameRateLimitTarget(normalizedAccountTarget, expectedScope.target)) {
      throw new CodexResetCreditScopeRejection(
        'accountRuntimeChanged',
        rateLimitState,
        'The selected Codex account belongs to a different runtime.'
      )
    }

    const currentScope = buildCodexResetCreditExpectedScope({
      target: rateLimitState.codexTarget,
      account: this.toSummary(account),
      limits: rateLimitState.codex
    })
    // Why: a same-key replay resolves an already-started provider mutation;
    // its credit snapshot may have refreshed, but its account/runtime identity may not change.
    if (requireCurrentOffer && !currentScope) {
      throw new CodexResetCreditScopeRejection(
        'offerUnavailable',
        rateLimitState,
        'The Codex reset-credit offer is no longer available.'
      )
    }
    if (
      requireCurrentOffer &&
      currentScope &&
      resetScopeKey(expectedScope) !== resetScopeKey(currentScope)
    ) {
      throw new CodexResetCreditScopeRejection(
        'offerChanged',
        rateLimitState,
        'The Codex reset-credit offer changed before reset.'
      )
    }

    return { managedHomePath: account.managedHomePath, rateLimits: rateLimitState }
  }

  protected hydrateResetCreditAttempts(): void {
    try {
      const ledger = this.store.getCodexResetCreditAttemptLedger()
      this.durableResetLedger = ledger
      for (const durable of ledger.attempts) {
        const scopeKey = resetScopeKey(durable.expectedScope)
        const accountScopeKey = resetAccountScopeKey(durable.expectedScope)
        this.resetAttemptsByKey.set(durable.idempotencyKey, {
          expectedScope: durable.expectedScope,
          scopeKey,
          accountScopeKey,
          state: durable.state,
          promise: null,
          settledOutcome: durable.state === 'settled' ? durable.outcome : null
        })
        this.resetAttemptKeyByOffer.set(scopeKey, durable.idempotencyKey)
        if (durable.state === 'providerPending') {
          this.unresolvedResetKeyByAccountScope.set(accountScopeKey, durable.idempotencyKey)
        }
      }
    } catch (error) {
      this.resetLedgerLoadError =
        error instanceof Error ? error : new Error('Codex reset-credit attempt ledger is corrupt')
    }
  }

  protected persistResetAttempt(nextAttempt: DurableCodexResetCreditAttempt): void {
    if (!this.durableResetLedger) {
      throw (
        this.resetLedgerLoadError ?? new Error('Codex reset-credit attempt ledger is unavailable')
      )
    }
    const index = this.durableResetLedger.attempts.findIndex(
      (attempt) => attempt.idempotencyKey === nextAttempt.idempotencyKey
    )
    const attempts = [...this.durableResetLedger.attempts]
    if (index === -1) {
      attempts.push(nextAttempt)
    } else {
      attempts[index] = nextAttempt
    }
    const nextLedger: CodexResetCreditAttemptLedger = { version: 1, attempts }
    this.store.replaceCodexResetCreditAttemptLedgerAndFlush(nextLedger)
    this.durableResetLedger = structuredClone(nextLedger)
  }

  protected releaseFreshResetAttempt(idempotencyKey: string, attempt: CodexResetCreditAttempt): void {
    if (attempt.state !== 'fresh') {
      return
    }
    this.resetAttemptsByKey.delete(idempotencyKey)
    if (this.resetAttemptKeyByOffer.get(attempt.scopeKey) === idempotencyKey) {
      this.resetAttemptKeyByOffer.delete(attempt.scopeKey)
    }
  }

  // Why: a removed account's managed home is gone, so its unresolved providerPending
  // attempt can never validate or be replayed; drop it so a target-scoped default reset
  // is not wedged forever by hasPendingResetForTarget matching the orphan.
  protected discardResetAttemptsForRemovedAccount(accountId: string): void {
    const staleAttempts: [string, CodexResetCreditAttempt][] = []
    for (const [idempotencyKey, attempt] of this.resetAttemptsByKey) {
      if (attempt.expectedScope.accountId === accountId) {
        staleAttempts.push([idempotencyKey, attempt])
      }
    }
    if (staleAttempts.length === 0) {
      return
    }
    const staleKeySet = new Set(staleAttempts.map(([idempotencyKey]) => idempotencyKey))
    if (this.durableResetLedger) {
      const attempts = this.durableResetLedger.attempts.filter(
        (attempt) => !staleKeySet.has(attempt.idempotencyKey)
      )
      if (attempts.length !== this.durableResetLedger.attempts.length) {
        const nextLedger: CodexResetCreditAttemptLedger = { version: 1, attempts }
        // Persist first so a failed durability barrier leaves the in-memory
        // fail-closed guards aligned with the ledger that will reload.
        this.store.replaceCodexResetCreditAttemptLedgerAndFlush(nextLedger)
        this.durableResetLedger = structuredClone(nextLedger)
      }
    }
    for (const [idempotencyKey, attempt] of staleAttempts) {
      this.resetAttemptsByKey.delete(idempotencyKey)
      if (this.resetAttemptKeyByOffer.get(attempt.scopeKey) === idempotencyKey) {
        this.resetAttemptKeyByOffer.delete(attempt.scopeKey)
      }
      if (this.unresolvedResetKeyByAccountScope.get(attempt.accountScopeKey) === idempotencyKey) {
        this.unresolvedResetKeyByAccountScope.delete(attempt.accountScopeKey)
      }
    }
  }

  // Why: quota probes against a cold per-account CODEX_HOME can take 10–25s
  // (RPC + PTY fallback) and queue behind an in-flight global usage refresh.
  // The refresh synchronously flips usage to "fetching" before its first await,
  // so the switcher updates immediately; the probe itself must never block or
  // fail the already-durable account mutation.
  protected startQuotaRefreshInBackground(
    outgoingAccountId: string | null | undefined,
    target: CodexAccountSelectionTarget | undefined
  ): void {
    void this.rateLimits.refreshForCodexAccountChange(outgoingAccountId, target).catch((error) => {
      console.error('[codex-accounts] Quota refresh after account change failed:', error)
    })
  }

  protected async doAddAccount(target?: CodexAccountAddTarget): Promise<CodexRateLimitAccountsState> {
    const accountId = randomUUID()
    const managedHome = this.createManagedHome(accountId, target)
    const { managedHomePath } = managedHome
    try {
      const canonicalConfig = this.readCanonicalConfigForManagedHome(managedHomePath)
      this.assertOAuthAccountAddAllowed(canonicalConfig)
      this.safeSyncCanonicalConfigIntoManagedHome(managedHomePath, canonicalConfig, accountId)
      await this.runCodexLogin(managedHomePath)
      return await this.persistCapturedCodexAccount(accountId, managedHome)
    } catch (error) {
      this.safeRemoveManagedHome(managedHomePath, accountId)
      throw error
    }
  }

  protected async doAddAccountFromHome(
    sourceHome: string,
    target?: CodexAccountAddTarget
  ): Promise<CodexRateLimitAccountsState> {
    const accountId = randomUUID()
    const managedHome = this.createManagedHome(accountId, target)
    const { managedHomePath } = managedHome
    try {
      const canonicalConfig = this.readCanonicalConfigForManagedHome(managedHomePath)
      this.assertOAuthAccountAddAllowed(canonicalConfig)
      this.safeSyncCanonicalConfigIntoManagedHome(managedHomePath, canonicalConfig, accountId)
      this.importCodexAuthFromHome(sourceHome, managedHomePath, accountId)
      return await this.persistCapturedCodexAccount(accountId, managedHome)
    } catch (error) {
      this.safeRemoveManagedHome(managedHomePath, accountId)
      throw error
    }
  }

  // Why: copy the auth.json from an already-authenticated CODEX_HOME (e.g. a temp
  // dir the CLI ran `codex login` into) into the managed home. Mirrors the login
  // step of doAddAccount without spawning an interactive browser flow.
  protected importCodexAuthFromHome(
    sourceHome: string,
    managedHomePath: string,
    accountId: string
  ): void {
    const trimmed = sourceHome.trim()
    if (!trimmed) {
      throw new Error('A Codex home directory path is required.')
    }
    const authPath = join(resolve(trimmed), 'auth.json')
    if (!existsSync(authPath)) {
      throw new Error(
        `No Codex credentials found in ${resolve(trimmed)}. Run \`codex login\` into this directory first.`
      )
    }
    const trustedHome = this.assertManagedHomePath(managedHomePath, accountId)
    writeFileAtomically(join(trustedHome, 'auth.json'), readFileSync(authPath, 'utf-8'), {
      mode: 0o600
    })
  }

  protected async persistCapturedCodexAccount(
    accountId: string,
    managedHome: ManagedHomeLocation
  ): Promise<CodexRateLimitAccountsState> {
    const identity = this.readIdentityFromHome(managedHome.managedHomePath, accountId)
    if (!identity.email) {
      throw new Error('Codex login completed, but Orca could not resolve the account email.')
    }

    const now = Date.now()
    const account: CodexManagedAccount = {
      id: accountId,
      email: identity.email,
      managedHomePath: managedHome.managedHomePath,
      managedHomeRuntime: managedHome.managedHomeRuntime,
      wslDistro: managedHome.wslDistro,
      wslLinuxHomePath: managedHome.wslLinuxHomePath,
      providerAccountId: identity.providerAccountId,
      workspaceLabel: identity.workspaceLabel,
      workspaceAccountId: identity.workspaceAccountId,
      createdAt: now,
      updatedAt: now,
      lastAuthenticatedAt: now
    }

    const settings = this.store.getSettings()
    const selection = normalizeCodexRuntimeSelection(settings)
    const targetSelection = getCodexSelectionTargetForAccount(account)
    this.store.updateSettings({
      codexManagedAccounts: [...settings.codexManagedAccounts, account],
      activeCodexManagedAccountId: targetSelection.runtime === 'host' ? account.id : selection.host,
      activeCodexManagedAccountIdsByRuntime: setSelectedCodexAccountIdForTarget(
        selection,
        account.id,
        targetSelection
      )
    })
    try {
      this.safeSyncCanonicalConfigToManagedHomes()
      this.runtimeHome.clearLastWrittenAuthJson(account.id)
      // Why: pass the account's selection target so a WSL account syncs the WSL
      // runtime home instead of the default host target.
      this.runtimeHome.syncForCurrentSelection(targetSelection)
    } catch (error) {
      // Why: settings were already written; if a post-write step fails, restore the
      // previous account/selection so the caller's managed-home cleanup cannot leave
      // a dangling, broken managed account behind in settings.
      this.store.updateSettings({
        codexManagedAccounts: settings.codexManagedAccounts,
        activeCodexManagedAccountId: settings.activeCodexManagedAccountId,
        activeCodexManagedAccountIdsByRuntime: settings.activeCodexManagedAccountIdsByRuntime
      })
      // Why: a failed post-write step must restore both persisted selection and
      // the runtime home it drives before the new managed home is removed.
      try {
        this.runtimeHome.syncForCurrentSelection(targetSelection)
      } catch (rollbackError) {
        console.warn(
          '[codex-accounts] Failed to restore runtime home during rollback:',
          rollbackError
        )
      }
      throw error
    }

    // Why: switching activates the new account, so cache the outgoing account's usage for the
    // switcher — in the background, since the probe must never block or fail a durable add.
    const outgoingAccountId = getSelectedCodexAccountIdForTarget(settings, targetSelection)
    this.startQuotaRefreshInBackground(outgoingAccountId, targetSelection)
    return this.getSnapshot()
  }


}
