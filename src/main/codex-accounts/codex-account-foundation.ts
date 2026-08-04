import { execFileSync,type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync,rmSync } from 'node:fs'
import type {
  CodexResetCreditAttemptLedger
} from '../../shared/codex-reset-credit-attempt-ledger'
import {
  buildCodexResetCreditExpectedScope,
  type CodexResetCreditExpectedScope
} from '../../shared/codex-reset-credit-scope'
import type {
  CodexRateLimitResetOutcome,
  CodexRateLimitResetResult,
  RateLimitRuntimeTarget,
  RateLimitState
} from '../../shared/rate-limit-types'
import type {
  CodexManagedAccount,
  CodexRateLimitAccountsState
} from '../../shared/types'
import type { Store } from '../persistence'
import type { RateLimitService } from '../rate-limits/service'
import type { CodexRuntimeHomeService } from './runtime-home-service'
import {
  getSelectedCodexAccountIdForTarget,
  type CodexAccountSelectionTarget
} from './runtime-selection'

export const LOGIN_TIMEOUT_MS = 120_000
export const MAX_LOGIN_OUTPUT_CHARS = 4_000
// Why: mirrors the Windows rm retry policy in local-worktree-filesystem — a
// just-terminated codex login can briefly keep handles inside a managed home.
export const WINDOWS_RM_MAX_RETRIES = 8
export const WINDOWS_RM_RETRY_DELAY_MS = 150
export const WINDOWS_LOGIN_AUTH_POLL_INTERVAL_MS = 500
export const WINDOWS_LOGIN_POST_AUTH_EXIT_GRACE_MS = 5_000
export const WINDOWS_LOGIN_TREE_KILL_TIMEOUT_MS = 5_000

export type CodexOAuthCredentials = {
  idToken: string | null
  accountId: string | null
}

export type ResolvedCodexIdentity = {
  email: string | null
  providerAccountId: string | null
  workspaceLabel: string | null
  workspaceAccountId: string | null
}

export type CanonicalCodexConfig = {
  contents: string
  /** Home the config was read from, in the path style Codex sees (Linux-side for WSL); relative settings resolve against it. */
  sourceHomePath: string
  sourceHooksPath: string
}

export type CodexAccountAddTarget = {
  runtime?: 'host' | 'wsl'
  wslDistro?: string | null
}

export type CodexAccountServiceLifecycle = {
  onHostSystemDefaultSelected?: () => void
}

export type ManagedHomeLocation = {
  managedHomePath: string
  managedHomeRuntime: 'host' | 'wsl'
  wslDistro: string | null
  wslLinuxHomePath: string | null
}

export type CodexResetCreditRejectedBeforeProviderReason =
  | 'targetChanged'
  | 'accountChanged'
  | 'accountRevisionChanged'
  | 'accountRuntimeChanged'
  | 'offerUnavailable'
  | 'offerChanged'

export type CodexResetCreditConsumedResult = {
  outcome: CodexRateLimitResetOutcome
  scope: CodexResetCreditExpectedScope
  codex: CodexRateLimitAccountsState
  rateLimits: RateLimitState
}

export type CodexResetCreditRejectedBeforeProviderResult = {
  status: 'rejectedBeforeProvider'
  retryDisposition: 'discardAttempt'
  reason: CodexResetCreditRejectedBeforeProviderReason
  scope: CodexResetCreditExpectedScope
  codex: CodexRateLimitAccountsState
  rateLimits: RateLimitState
}

export type CodexResetCreditConsumeResult =
  | CodexResetCreditConsumedResult
  | CodexResetCreditRejectedBeforeProviderResult

export type CodexResetCreditAttempt = {
  expectedScope: CodexResetCreditExpectedScope
  scopeKey: string
  accountScopeKey: string
  state: 'fresh' | 'providerPending' | 'settled'
  promise: Promise<CodexResetCreditConsumeResult> | null
  settledOutcome: CodexRateLimitResetOutcome | null
}

export class CodexResetCreditScopeRejection extends Error {
  constructor(
    readonly reason: CodexResetCreditRejectedBeforeProviderReason,
    readonly rateLimits: RateLimitState,
    message: string
  ) {
    super(message)
    this.name = 'CodexResetCreditScopeRejection'
  }
}

export function resetScopeKey(scope: CodexResetCreditExpectedScope): string {
  return JSON.stringify([
    scope.target.runtime,
    scope.target.wslDistro,
    scope.accountId,
    scope.accountRevision,
    scope.offerRevision
  ])
}

export function resetAccountScopeKey(
  scope: Pick<CodexResetCreditExpectedScope, 'target' | 'accountId' | 'accountRevision'>
): string {
  return JSON.stringify([
    scope.target.runtime,
    scope.target.wslDistro,
    scope.accountId,
    scope.accountRevision
  ])
}

export function sameRateLimitTarget(left: RateLimitRuntimeTarget, right: RateLimitRuntimeTarget): boolean {
  return left.runtime === right.runtime && left.wslDistro === right.wslDistro
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

export function removeManagedHomeTreeSync(targetPath: string): void {
  // Why: codex login descendants can briefly keep Windows handles on files in
  // the managed home (e.g. log/codex-login.log); bounded retries absorb the
  // transient lock instead of failing with ENOTEMPTY and orphaning the home.
  rmSync(targetPath, {
    recursive: true,
    force: true,
    maxRetries: WINDOWS_RM_MAX_RETRIES,
    retryDelay: WINDOWS_RM_RETRY_DELAY_MS
  })
}

export function killLoginProcessTree(child: ChildProcess): void {
  if (
    process.platform === 'win32' &&
    typeof child.pid === 'number' &&
    child.exitCode === null &&
    child.signalCode === null
  ) {
    try {
      // Why: child.kill() only reaches the direct child (cmd.exe for npm .cmd
      // shims); taskkill /t also ends codex descendants whose open handles on
      // the managed home make post-login file operations fail with ENOTEMPTY.
      execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
        timeout: WINDOWS_LOGIN_TREE_KILL_TIMEOUT_MS,
        stdio: 'ignore'
      })
      return
    } catch {
      // Why: taskkill can race an already-exited tree; fall back to the plain
      // signal so the direct child never outlives its deadline.
    }
  }
  child.kill()
}

export function readLoginAuthSnapshot(authJsonPath: string): string | null | undefined {
  try {
    return readFileSync(authJsonPath, 'utf-8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return null
    }
    // Why: codex can atomically replace auth.json while the poll runs; a later
    // poll will observe the stable credential. An unreadable initial file must
    // disable the shortcut rather than look like a fresh login.
    return undefined
  }
}

export function loginAuthChanged(
  initial: string | null | undefined,
  current: string | null | undefined
): boolean {
  // Why: metadata-only touches can happen before OAuth finishes. Requiring new
  // credential bytes prevents reauthentication from being killed prematurely.
  return initial !== undefined && current !== undefined && current !== null && current !== initial
}

export class CodexAccountServiceFoundation {

  [key: string]: any

  // Why: serialize the read-modify-write of settings; overlapping calls (e.g. double-click Add) would lose updates.
  protected mutationQueue: Promise<unknown> = Promise.resolve()
  protected readonly resetAttemptsByKey = new Map<string, CodexResetCreditAttempt>()
  protected readonly resetAttemptKeyByOffer = new Map<string, string>()
  protected readonly unresolvedResetKeyByAccountScope = new Map<string, string>()
  protected durableResetLedger: CodexResetCreditAttemptLedger | null = null
  protected resetLedgerLoadError: Error | null = null

  constructor(
    protected readonly store: Store,
    protected readonly rateLimits: RateLimitService,
    protected readonly runtimeHome: CodexRuntimeHomeService,
    protected readonly lifecycle: CodexAccountServiceLifecycle = {}
  ) {
    this.hydrateResetCreditAttempts()
    this.safeSyncCanonicalConfigToManagedHomes()
  }

  /**
   * Read-only access for surfaces that report on the runtime home rather than
   * prepare it — notably the config-sync status channel, which must resolve the
   * home the current selection actually mirrors into without creating anything.
   */
  get runtimeHomeService(): CodexRuntimeHomeService {
    return this.runtimeHome
  }

  protected serializeMutation<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(fn, fn)
    this.mutationQueue = next.catch(() => {})
    return next
  }

  listAccounts(): CodexRateLimitAccountsState {
    this.normalizeActiveSelection()
    return this.getSnapshot()
  }

  async addAccount(target?: CodexAccountAddTarget): Promise<CodexRateLimitAccountsState> {
    return this.serializeMutation(() => this.doAddAccount(target))
  }

  /**
   * Registers a managed Codex account from an already-authenticated `CODEX_HOME`
   * instead of driving `codex login` here. Lets the `orca account add --agent codex`
   * CLI run the login in the user's own terminal on a headless host and then import
   * the captured `auth.json` into managed storage.
   */
  async addAccountFromHome(
    sourceHome: string,
    target?: CodexAccountAddTarget
  ): Promise<CodexRateLimitAccountsState> {
    return this.serializeMutation(() => this.doAddAccountFromHome(sourceHome, target))
  }

  async reauthenticateAccount(accountId: string): Promise<CodexRateLimitAccountsState> {
    return this.serializeMutation(() => this.doReauthenticateAccount(accountId))
  }

  async removeAccount(accountId: string): Promise<CodexRateLimitAccountsState> {
    return this.serializeMutation(() => this.doRemoveAccount(accountId))
  }

  async selectAccount(accountId: string | null): Promise<CodexRateLimitAccountsState> {
    return this.serializeMutation(() => this.doSelectAccount(accountId))
  }

  async selectAccountForTarget(
    accountId: string | null,
    target?: CodexAccountSelectionTarget
  ): Promise<CodexRateLimitAccountsState> {
    return this.serializeMutation(() => this.doSelectAccount(accountId, target))
  }

  consumeRateLimitResetCredit(
    idempotencyKey: string,
    expectedScope: CodexResetCreditExpectedScope
  ): Promise<CodexResetCreditConsumeResult> {
    if (this.resetLedgerLoadError) {
      return Promise.reject(this.resetLedgerLoadError)
    }
    const scopeKey = resetScopeKey(expectedScope)
    const accountScopeKey = resetAccountScopeKey(expectedScope)
    const existing = this.resetAttemptsByKey.get(idempotencyKey)
    if (existing) {
      if (existing.scopeKey !== scopeKey) {
        return Promise.reject(new Error('That idempotency key belongs to a different reset scope.'))
      }
      if (existing.state === 'settled' && existing.settledOutcome) {
        return this.serializeMutation(async () => {
          const { rateLimits } = this.validateResetCreditScope(expectedScope, false)
          return {
            outcome: existing.settledOutcome!,
            scope: existing.expectedScope,
            codex: this.getSnapshot(),
            rateLimits
          }
        })
      }
      if (existing.promise) {
        return existing.promise
      }
      return this.startResetCreditAttempt(idempotencyKey, expectedScope, existing)
    }

    const unresolvedKey = this.unresolvedResetKeyByAccountScope.get(accountScopeKey)
    if (unresolvedKey && unresolvedKey !== idempotencyKey) {
      return Promise.reject(
        new Error('A previous reset attempt for this account still has an unknown outcome.')
      )
    }
    const claimedKey = this.resetAttemptKeyByOffer.get(scopeKey)
    if (claimedKey && claimedKey !== idempotencyKey) {
      return Promise.reject(new Error('That reset-credit offer was already attempted.'))
    }

    const attempt: CodexResetCreditAttempt = {
      expectedScope,
      scopeKey,
      accountScopeKey,
      state: 'fresh',
      promise: null,
      settledOutcome: null
    }
    this.resetAttemptsByKey.set(idempotencyKey, attempt)
    this.resetAttemptKeyByOffer.set(scopeKey, idempotencyKey)
    return this.startResetCreditAttempt(idempotencyKey, expectedScope, attempt)
  }

  async consumeCurrentRateLimitResetCredit(): Promise<CodexRateLimitResetResult> {
    if (this.resetLedgerLoadError) {
      throw this.resetLedgerLoadError
    }
    const initialRateLimits = this.rateLimits.getState()
    const initialTarget = { ...initialRateLimits.codexTarget }
    const initialSettings = this.store.getSettings()
    const selectedAccountId = getSelectedCodexAccountIdForTarget(initialSettings, initialTarget)
    if (selectedAccountId) {
      const account = initialSettings.codexManagedAccounts.find(
        (candidate) => candidate.id === selectedAccountId
      )
      const pendingAttempt = account
        ? this.getPendingResetAttemptForAccount(initialTarget, account)
        : null
      const expectedScope =
        pendingAttempt?.expectedScope ??
        (account
          ? buildCodexResetCreditExpectedScope({
              target: initialTarget,
              account: this.toSummary(account),
              limits: initialRateLimits.codex
            })
          : null)
      if (!expectedScope) {
        throw new Error('The managed Codex reset-credit offer is no longer available.')
      }
      // Why: do not enter the mutation queue first; the coordinator owns that
      // queue and nested serialization would deadlock behind this operation.
      const result = await this.consumeRateLimitResetCredit(
        pendingAttempt?.idempotencyKey ?? randomUUID(),
        expectedScope
      )
      if ('status' in result) {
        throw new Error('The Codex account or reset offer changed before reset.')
      }
      return { outcome: result.outcome, state: result.rateLimits }
    }

    return this.serializeMutation(async () => {
      if (this.resetLedgerLoadError) {
        throw this.resetLedgerLoadError
      }
      const target = this.rateLimits.getState().codexTarget
      if (!sameRateLimitTarget(target, initialTarget)) {
        throw new Error('The active Codex rate-limit target changed before reset.')
      }
      if (getSelectedCodexAccountIdForTarget(this.store.getSettings(), target)) {
        throw new Error('The selected Codex account changed before reset.')
      }
      if (this.hasPendingResetForTarget(target)) {
        throw new Error('A previous reset attempt for this target still has an unknown outcome.')
      }
      const codexHomePath = this.runtimeHome.prepareForRateLimitFetch(target)
      return this.rateLimits.consumeCodexRateLimitResetCredit({
        idempotencyKey: randomUUID(),
        target,
        codexHomePath
      })
    })
  }

  protected getPendingResetAttemptForAccount(
    target: RateLimitRuntimeTarget,
    account: CodexManagedAccount
  ): { idempotencyKey: string; expectedScope: CodexResetCreditExpectedScope } | null {
    const accountScopeKey = resetAccountScopeKey({
      target,
      accountId: account.id,
      accountRevision: account.updatedAt
    })
    const idempotencyKey = this.unresolvedResetKeyByAccountScope.get(accountScopeKey)
    if (!idempotencyKey) {
      return null
    }
    const attempt = this.resetAttemptsByKey.get(idempotencyKey)
    if (attempt?.state !== 'providerPending') {
      throw new Error('Codex reset-credit attempt state is inconsistent.')
    }
    // Why: a durable providerPending attempt can only be resolved with its original key.
    return { idempotencyKey, expectedScope: attempt.expectedScope }
  }

  protected hasPendingResetForTarget(target: RateLimitRuntimeTarget): boolean {
    return [...this.resetAttemptsByKey.values()].some(
      (attempt) =>
        attempt.state === 'providerPending' &&
        sameRateLimitTarget(attempt.expectedScope.target, target)
    )
  }

  protected startResetCreditAttempt(
    idempotencyKey: string,
    expectedScope: CodexResetCreditExpectedScope,
    attempt: CodexResetCreditAttempt
  ): Promise<CodexResetCreditConsumeResult> {
    const promise = this.serializeMutation(async (): Promise<CodexResetCreditConsumeResult> => {
      const isFresh = attempt.state === 'fresh'
      let validation: { managedHomePath: string; rateLimits: RateLimitState }
      try {
        validation = this.validateResetCreditScope(expectedScope, isFresh)
      } catch (error) {
        if (isFresh && error instanceof CodexResetCreditScopeRejection) {
          this.releaseFreshResetAttempt(idempotencyKey, attempt)
          return {
            status: 'rejectedBeforeProvider',
            retryDisposition: 'discardAttempt',
            reason: error.reason,
            scope: expectedScope,
            codex: this.getSnapshot(),
            rateLimits: error.rateLimits
          }
        }
        throw error
      }
      if (isFresh) {
        this.persistResetAttempt({
          idempotencyKey,
          expectedScope,
          state: 'providerPending'
        })
        attempt.state = 'providerPending'
        this.unresolvedResetKeyByAccountScope.set(attempt.accountScopeKey, idempotencyKey)
      }
      const { outcome, state } = await this.rateLimits.consumeCodexRateLimitResetCredit({
        idempotencyKey,
        target: expectedScope.target,
        codexHomePath: validation.managedHomePath
      })
      // Why: queued account selection may start as soon as this mutation resolves;
      // capture both account selection and usage before releasing the queue.
      const result: CodexResetCreditConsumedResult = {
        outcome,
        scope: expectedScope,
        codex: this.getSnapshot(),
        rateLimits: state
      }
      this.persistResetAttempt({
        idempotencyKey,
        expectedScope,
        state: 'settled',
        outcome
      })
      attempt.state = 'settled'
      attempt.settledOutcome = outcome
      if (this.unresolvedResetKeyByAccountScope.get(attempt.accountScopeKey) === idempotencyKey) {
        this.unresolvedResetKeyByAccountScope.delete(attempt.accountScopeKey)
      }
      return result
    })
    attempt.promise = promise
    void promise.then(
      () => {
        attempt.promise = null
      },
      () => {
        attempt.promise = null
        if (attempt.state === 'fresh') {
          this.releaseFreshResetAttempt(idempotencyKey, attempt)
        }
      }
    )
    return promise
  }


}
