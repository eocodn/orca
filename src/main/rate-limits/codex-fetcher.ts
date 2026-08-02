import type { ProviderRateLimits } from '../../shared/rate-limit-types'
import { probeCodexAuthPresence } from './codex-auth-presence'
import { withMacTailscaleDnsHint } from '../network/macos-tailscale-dns-diagnostic'
import { parseWslUncPath } from '../../shared/wsl-paths'
import { isCodexAuthError } from '../../shared/codex-auth-errors'
import { fetchCodexRateLimitsViaRpc } from './codex-rpc-fetch'
import { fetchCodexRateLimitsViaPty } from './codex-pty-fetch'
import {
  buildWslCodexCommand,
  cloneProcessEnvWithoutCodexHome,
  fetchViaBackend,
  withBackendRateLimitResetCredits,
  withBackendSessionWindow
} from './codex-backend-fetch'

export { consumeCodexRateLimitResetCredit } from './codex-backend-fetch'

function abortedCodexRateLimitResult(): ProviderRateLimits {
  return {
    provider: 'codex',
    session: null,
    weekly: null,
    updatedAt: Date.now(),
    error: 'Rate-limit fetch aborted',
    status: 'error'
  }
}

export type FetchCodexRateLimitsOptions = {
  codexHomePath?: string | null
  allowPtyFallback?: boolean
  signal?: AbortSignal
}

// ---------------------------------------------------------------------------
// PTY fallback adapter
// ---------------------------------------------------------------------------

function fetchViaPty(options?: FetchCodexRateLimitsOptions): Promise<ProviderRateLimits> {
  return fetchCodexRateLimitsViaPty(options, {
    buildWslCodexCommand,
    cloneProcessEnvWithoutCodexHome
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchCodexRateLimits(
  options?: FetchCodexRateLimitsOptions
): Promise<ProviderRateLimits> {
  if (options?.signal?.aborted) {
    return abortedCodexRateLimitResult()
  }
  // Why: don't spawn `codex` unless signed in — otherwise non-Codex users see an unexpected background process that can only error.
  const authPresence = await probeCodexAuthPresence(options?.codexHomePath, {
    signal: options?.signal
  })
  if (options?.signal?.aborted) {
    return abortedCodexRateLimitResult()
  }
  if (authPresence === 'absent') {
    return {
      provider: 'codex',
      session: null,
      weekly: null,
      updatedAt: Date.now(),
      error: 'Codex not signed in',
      status: 'unavailable'
    }
  }
  if (authPresence !== 'present') {
    return {
      provider: 'codex',
      session: null,
      weekly: null,
      updatedAt: Date.now(),
      error:
        authPresence === 'timeout'
          ? 'Timed out while checking Codex sign-in status'
          : 'Codex sign-in status is unavailable',
      status: 'error'
    }
  }

  // Path A (WSL): use Codex's backend usage contract so a routine poll skips spawning a login shell to rebuild the CLI env.
  if (options?.codexHomePath && parseWslUncPath(options.codexHomePath)) {
    try {
      const backendResult = await fetchViaBackend(options)
      if (options?.signal?.aborted) {
        return abortedCodexRateLimitResult()
      }
      if (backendResult) {
        const withResetCredits = await withBackendRateLimitResetCredits(backendResult, options)
        return options?.signal?.aborted ? abortedCodexRateLimitResult() : withResetCredits
      }
    } catch {
      if (options?.signal?.aborted) {
        return abortedCodexRateLimitResult()
      }
      // Why: token refresh, network routing, and custom-CA behavior can differ from the host fetch stack; keep CLI paths as fallbacks.
    }
  }

  // Path B: try RPC
  try {
    const rpcResult = await fetchCodexRateLimitsViaRpc(options)
    if (options?.signal?.aborted) {
      return abortedCodexRateLimitResult()
    }
    if (rpcResult.status === 'ok' || rpcResult.status === 'unavailable') {
      const withSession = await withBackendSessionWindow(rpcResult, options)
      const withResetCredits = await withBackendRateLimitResetCredits(withSession, options)
      return options?.signal?.aborted ? abortedCodexRateLimitResult() : withResetCredits
    }
    if (isCodexAuthError(rpcResult.error)) {
      return rpcResult
    }
    if (options?.allowPtyFallback === false) {
      return rpcResult
    }
    // Why: app-server can fail independently of the interactive CLI; fall back to the /status PTY reader on RPC errors.
  } catch {
    if (options?.signal?.aborted) {
      return abortedCodexRateLimitResult()
    }
    if (options?.allowPtyFallback === false) {
      return {
        provider: 'codex',
        session: null,
        weekly: null,
        updatedAt: Date.now(),
        error: 'RPC failed',
        status: 'error'
      }
    }
    // RPC failed — fall through to PTY
  }

  // Path C: PTY fallback
  try {
    if (options?.signal?.aborted) {
      return abortedCodexRateLimitResult()
    }
    const ptyResult = await fetchViaPty(options)
    if (options?.signal?.aborted) {
      return abortedCodexRateLimitResult()
    }
    const withSession = await withBackendSessionWindow(ptyResult, options)
    const withResetCredits = await withBackendRateLimitResetCredits(withSession, options)
    return options?.signal?.aborted ? abortedCodexRateLimitResult() : withResetCredits
  } catch (err) {
    if (options?.signal?.aborted) {
      return abortedCodexRateLimitResult()
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    const isNotInstalled = message.includes('ENOENT')
    return {
      provider: 'codex',
      session: null,
      weekly: null,
      updatedAt: Date.now(),
      error: isNotInstalled ? 'Codex CLI not found' : withMacTailscaleDnsHint(message),
      status: isNotInstalled ? 'unavailable' : 'error'
    }
  }
}
