import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
import { CodexAccountServicePhase4 } from './codex-account-cleanup'

export class CodexAccountServicePhase5 extends CodexAccountServicePhase4 {
  protected readIdentityFromHome(
    managedHomePath: string,
    expectedAccountId: string
  ): ResolvedCodexIdentity {
    return this.resolveIdentityFromCredentials(
      this.loadOAuthCredentials(managedHomePath, expectedAccountId)
    )
  }

  protected resolveIdentityFromCredentials(
    credentials: CodexOAuthCredentials
  ): ResolvedCodexIdentity {
    const payload = credentials.idToken ? this.parseJwtPayload(credentials.idToken) : null
    const authClaims = this.readRecordClaim(payload, 'https://api.openai.com/auth')
    const profileClaims = this.readRecordClaim(payload, 'https://api.openai.com/profile')

    return {
      email: this.normalizeField(
        this.readStringClaim(payload, 'email') ?? this.readStringClaim(profileClaims, 'email')
      ),
      providerAccountId: this.normalizeField(
        credentials.accountId ??
          this.readStringClaim(authClaims, 'chatgpt_account_id') ??
          this.readStringClaim(payload, 'chatgpt_account_id')
      ),
      workspaceLabel: this.normalizeField(
        this.readStringClaim(authClaims, 'workspace_name') ??
          this.readStringClaim(profileClaims, 'workspace_name')
      ),
      workspaceAccountId: this.normalizeField(
        this.readStringClaim(authClaims, 'workspace_account_id') ??
          credentials.accountId ??
          this.readStringClaim(payload, 'chatgpt_account_id')
      )
    }
  }

  protected loadOAuthCredentials(
    managedHomePath: string,
    expectedAccountId: string
  ): CodexOAuthCredentials {
    const authFilePath = join(
      this.assertManagedHomePath(managedHomePath, expectedAccountId),
      'auth.json'
    )
    const authFileContents = readFileSync(authFilePath, 'utf-8')
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(authFileContents) as Record<string, unknown>
    } catch {
      // Why: a raw SyntaxError echoes credential bytes into logs/error UI; a
      // corrupt auth.json must fail loudly but without them (same sanitization
      // intent as the system-default identity path, which degrades instead).
      throw new Error('Codex auth.json is corrupt or not valid JSON')
    }
    return this.extractOAuthCredentials(parsed)
  }

  protected extractOAuthCredentials(raw: Record<string, unknown>): CodexOAuthCredentials {
    // Why: API-key-based auth files have no OAuth tokens or JWT identity
    // claims. Returning nulls causes the caller to fail with a clear
    // "could not resolve the account email" error rather than crashing
    // on missing nested token fields.
    if (typeof raw.OPENAI_API_KEY === 'string' && raw.OPENAI_API_KEY.trim() !== '') {
      return {
        idToken: null,
        accountId: null
      }
    }

    const tokens = this.readRecordClaim(raw, 'tokens')
    return {
      idToken: this.normalizeField(
        this.readStringClaim(tokens, 'id_token') ?? this.readStringClaim(tokens, 'idToken')
      ),
      accountId: this.normalizeField(
        this.readStringClaim(tokens, 'account_id') ?? this.readStringClaim(tokens, 'accountId')
      )
    }
  }

  protected parseJwtPayload(token: string): Record<string, unknown> | null {
    const parts = token.split('.')
    if (parts.length < 2) {
      return null
    }

    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    while (payload.length % 4 !== 0) {
      payload += '='
    }

    try {
      const json = Buffer.from(payload, 'base64').toString('utf-8')
      return JSON.parse(json) as Record<string, unknown>
    } catch {
      return null
    }
  }

  protected readRecordClaim(
    value: Record<string, unknown> | null,
    key: string
  ): Record<string, unknown> | null {
    const claim = value?.[key]
    if (!claim || typeof claim !== 'object' || Array.isArray(claim)) {
      return null
    }
    return claim as Record<string, unknown>
  }

  protected readStringClaim(value: Record<string, unknown> | null, key: string): string | null {
    const claim = value?.[key]
    return typeof claim === 'string' ? claim : null
  }

  protected normalizeField(value: string | null | undefined): string | null {
    if (!value) {
      return null
    }
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
}
