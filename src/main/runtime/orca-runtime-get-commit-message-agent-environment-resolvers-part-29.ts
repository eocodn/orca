import { type ClaudeRateLimitAccountsState, type CodexRateLimitAccountsState, type CodexAccountSelectionTarget, type CodexResetCreditExpectedScope, type CommitMessageAgentEnvironmentResolvers, type RuntimeAccountServices, type AccountsSnapshot, type CodexRateLimitResetRpcResult } from './orca-runtime-symbols'
import { OrcaRuntimeResolveTerminalCwdPart28 } from './orca-runtime-resolve-terminal-cwd-part-28'

export class OrcaRuntimeGetCommitMessageAgentEnvironmentResolversPart29 extends OrcaRuntimeResolveTerminalCwdPart28 {
  getCommitMessageAgentEnvironmentResolvers(): CommitMessageAgentEnvironmentResolvers | undefined {
    return this.commitMessageAgentEnv ?? undefined
  }

  protected requireAccountServices(): RuntimeAccountServices {
    if (!this.accountServices) {
      throw new Error('Account services are not configured on this runtime')
    }
    return this.accountServices
  }
  getAccountsSnapshot(): AccountsSnapshot {
    const { claudeAccounts, codexAccounts, rateLimits } = this.requireAccountServices()
    return {
      claude: claudeAccounts.listAccounts(),
      codex: codexAccounts.listAccounts(),
      rateLimits: rateLimits.getState()
    }
  }

  // Why: RateLimitService polls only when the Electron window is visible AND
  // focused, and the inactive-account caches fill lazily when the user opens
  // the desktop AccountsPane. Mobile has neither trigger, so without this the
  // phone shows 0% / "—" against a backgrounded desktop. Errors swallowed
  // because partial usage is still useful for the rest of the snapshot.
  async refreshAccountsForMobile(): Promise<void> {
    const { rateLimits } = this.requireAccountServices()
    await Promise.allSettled([
      rateLimits.refresh(),
      rateLimits.fetchInactiveClaudeAccountsOnOpen(),
      rateLimits.fetchInactiveCodexAccountsOnOpen()
    ])
  }

  // Why: connection migration replays subscriptions; use the stale-aware lane
  // so a reconnect cannot turn one mobile viewer into continuous forced fetches.
  async refreshAccountsForMobileSubscriber(): Promise<void> {
    const { rateLimits } = this.requireAccountServices()
    await Promise.allSettled([
      rateLimits.refreshIfStale(),
      rateLimits.fetchInactiveClaudeAccountsOnOpen(),
      rateLimits.fetchInactiveCodexAccountsOnOpen()
    ])
  }
  selectClaudeAccount(accountId: string | null): Promise<ClaudeRateLimitAccountsState> {
    return this.requireAccountServices().claudeAccounts.selectAccount(accountId)
  }
  selectCodexAccount(accountId: string | null): Promise<CodexRateLimitAccountsState> {
    return this.requireAccountServices().codexAccounts.selectAccount(accountId)
  }
  selectCodexAccountForTarget(
    accountId: string | null,
    target: CodexAccountSelectionTarget
  ): Promise<CodexRateLimitAccountsState> {
    return this.requireAccountServices().codexAccounts.selectAccountForTarget(accountId, target)
  }
  async consumeCodexRateLimitResetCredit(
    idempotencyKey: string,
    expectedScope: CodexResetCreditExpectedScope
  ): Promise<CodexRateLimitResetRpcResult> {
    const { claudeAccounts, codexAccounts } = this.requireAccountServices()
    const result = await codexAccounts.consumeRateLimitResetCredit(idempotencyKey, expectedScope)
    // Why: Codex selection and usage were captured before its mutation queue
    // advanced. Re-reading them here could pair scope A with queued selection B.
    const snapshot = {
      claude: claudeAccounts.listAccounts(),
      codex: result.codex,
      rateLimits: result.rateLimits
    }
    if ('status' in result) {
      return {
        status: result.status,
        retryDisposition: result.retryDisposition,
        reason: result.reason,
        scope: result.scope,
        snapshot
      }
    }
    return {
      outcome: result.outcome,
      scope: result.scope,
      snapshot
    }
  }
}
