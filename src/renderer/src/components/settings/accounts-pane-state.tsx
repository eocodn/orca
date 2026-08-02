import React from 'react'
import type {
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState,
  CodexSystemDefaultIdentity,
  GlobalSettings
} from '../../../../shared/types'
import { resolveLocalAccountRuntimeTarget } from '../../../../shared/local-account-runtime'
import { getRendererAppPlatform } from '../../lib/renderer-app-platform'
import { translate } from '@/i18n/i18n'
export const EMPTY_WSL_DISTROS: string[] = []
export const MINIMAX_CONSOLE_URL = 'https://platform.minimax.io/console/usage'

export function formatMiniMaxRelativeRefresh(updatedAt: number, now: number): string {
  const diffMs = Math.max(0, now - updatedAt)
  if (diffMs < 60_000) {
    return translate('auto.components.settings.AccountsPane.3a30aaf526', 'just now')
  }
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 60) {
    return formatter.format(-minutes, 'minute')
  }
  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return formatter.format(-hours, 'hour')
  }
  return formatter.format(-Math.round(hours / 24), 'day')
}

export function MiniMaxCookieHelpPopover(): React.JSX.Element {
  const steps = [
    translate(
      'auto.components.settings.AccountsPane.f5d8d2a6a1',
      'Open platform.minimax.io/console/usage in your browser and sign in.'
    ),
    translate('auto.components.settings.AccountsPane.24560fe830', 'Open DevTools.'),
    translate(
      'auto.components.settings.AccountsPane.4cab0fa42d',
      'Go to the Network tab and enable Preserve log.'
    ),
    translate('auto.components.settings.AccountsPane.bee4e63e1c', 'Reload the page.'),
    translate(
      'auto.components.settings.AccountsPane.87f814af6f',
      'Filter for remains and select the coding_plan/remains request.'
    ),
    translate(
      'auto.components.settings.AccountsPane.435df0ee51',
      'Under Request Headers, copy the Cookie value.'
    ),
    translate('auto.components.settings.AccountsPane.7492fb3bba', 'Paste it here and click Save.')
  ]
  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="space-y-1">
        <p className="font-medium">
          {translate('auto.components.settings.AccountsPane.9fec52de4b', 'How to copy the cookie')}
        </p>
        <p className="text-muted-foreground">
          {translate(
            'auto.components.settings.AccountsPane.4e32e030b2',
            'Stored locally. Orca sends it only to platform.minimax.io for usage refreshes.'
          )}
        </p>
      </div>
      <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  )
}

export function getHostRuntimeLabel(): string {
  return navigator.userAgent.includes('Windows')
    ? 'Windows'
    : translate('auto.components.settings.AccountsPane.9baf45d071', 'This device')
}

// Why: the system-default row has no stored identity, so surface the real
// ~/.codex login live — the OAuth email when signed in, a clear custom-provider
// note for env-key logins, and the generic fallback when signed out.
export function getCodexSystemDefaultSubtitle(
  identity: CodexSystemDefaultIdentity | undefined,
  runtimeSentenceLabel: string
): string {
  if (identity?.authKind === 'oauth' && identity.email) {
    return identity.email
  }
  if (identity?.authKind === 'api-key') {
    return translate(
      'auto.components.settings.AccountsPane.codexSystemDefaultCustomProvider',
      'Custom provider — no usage tracked.'
    )
  }
  return translate(
    'auto.components.settings.AccountsPane.fcc4093fc1',
    'Use your current {{value0}} Codex login.',
    { value0: runtimeSentenceLabel }
  )
}

export function getClaudeAccountLabel(
  state: ClaudeRateLimitAccountsState,
  accountId: string | null | undefined
): string {
  if (accountId == null) {
    return 'System default'
  }
  return state.accounts.find((account) => account.id === accountId)?.email ?? 'Claude account'
}

export function getCodexAccountRuntimeLabel(
  account: CodexRateLimitAccountsState['accounts'][number],
  hostLabel = getHostRuntimeLabel()
): string {
  if (account.managedHomeRuntime === 'wsl') {
    return account.wslDistro ? `WSL ${account.wslDistro}` : 'WSL'
  }
  return hostLabel
}

export function getClaudeAccountRuntimeLabel(
  account: ClaudeRateLimitAccountsState['accounts'][number],
  hostLabel = getHostRuntimeLabel()
): string {
  if (account.managedAuthRuntime === 'wsl') {
    return account.wslDistro ? `WSL ${account.wslDistro}` : 'WSL'
  }
  return hostLabel
}

export function getCodexAccountErrorDescription(error: unknown): string {
  const message = String((error as Error)?.message ?? error)
    .replace(/^Error occurred in handler for 'codexAccounts:[^']+':\s*/i, '')
    .replace(/^Error invoking remote method 'codexAccounts:[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
  const normalizedMessage = message.toLowerCase()

  // Why: Codex account actions cross the Electron IPC boundary, and invoke()
  // failures often include transport-level wrapper text that is useful in
  // devtools but noisy in product UI. Normalize the handful of expected auth
  // failures here so users see actionable sign-in guidance instead of IPC
  // internals or raw upstream wording.
  if (normalizedMessage.includes('timed out waiting for codex login to finish')) {
    return 'Codex sign-in took too long to finish. Please try again.'
  }
  if (normalizedMessage.includes('codex sign-in took too long to finish')) {
    return 'Codex sign-in took too long to finish. Please try again.'
  }
  if (
    normalizedMessage.includes('auth error 502') ||
    normalizedMessage.includes('gateway') ||
    normalizedMessage.includes('bad gateway')
  ) {
    return 'Codex sign-in is temporarily unavailable. Please try again in a minute.'
  }
  if (normalizedMessage.startsWith('codex login failed:')) {
    const loginMessage = message.slice('Codex login failed:'.length).trim()
    return loginMessage || 'Codex sign-in failed. Please try again.'
  }

  return message || 'Codex sign-in failed. Please try again.'
}

export function getClaudeAccountErrorDescription(error: unknown): string {
  return (
    String((error as Error)?.message ?? error)
      .replace(/^Error occurred in handler for 'claudeAccounts:[^']+':\s*/i, '')
      .replace(/^Error invoking remote method 'claudeAccounts:[^']+':\s*/i, '')
      .replace(/^Error:\s*/i, '')
      .trim() || 'Claude sign-in failed. Please try again.'
  )
}

export function isClaudeAccountCancellation(error: unknown): boolean {
  return getClaudeAccountErrorDescription(error).toLowerCase() === 'claude sign-in was cancelled.'
}

export type LocalAccountRuntime = {
  runtime: 'host' | 'wsl'
  wslDistro?: string | null
  label: string
}

export function getSelectedAccountRuntime(
  settings: GlobalSettings,
  wslSupportedPlatform: boolean,
  wslAvailable: boolean,
  wslDistros: string[],
  wslCapabilitiesLoading: boolean
): LocalAccountRuntime {
  // Why: the two-option control displays the concrete target behind the persisted auto policy.
  const resolvedRuntime = resolveLocalAccountRuntimeTarget(settings, getRendererAppPlatform())
  if (wslSupportedPlatform && resolvedRuntime.runtime === 'wsl') {
    if (!wslAvailable && !wslCapabilitiesLoading) {
      return {
        runtime: 'wsl',
        label: translate('auto.components.settings.AccountsPane.8619f9afa9', 'WSL')
      }
    }
    const configuredDistro = resolvedRuntime.wslDistro?.trim() || null
    const selectedDistro =
      configuredDistro && (wslCapabilitiesLoading || wslDistros.includes(configuredDistro))
        ? configuredDistro
        : null
    return {
      runtime: 'wsl',
      wslDistro: selectedDistro,
      label: selectedDistro
        ? `WSL ${selectedDistro}`
        : translate('auto.components.settings.AccountsPane.2358ac71d2', 'WSL default')
    }
  }
  return { runtime: 'host', label: getHostRuntimeLabel() }
}
