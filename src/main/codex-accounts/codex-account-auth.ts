import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { app } from 'electron'
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
import { rewriteRelativePathConfigValues } from '../codex/codex-config-path-reference-rewrite'
import { stripCodexManagedHookTrustEntriesFromConfig } from '../codex/codex-managed-trust-reconciliation'
import { isCodexSystemDefaultRealHomeEnabled } from '../codex/codex-real-home-flag'
import { getCodexManagedHookInstallMaterial } from '../codex/hook-service'
import { syncSystemConfigIntoManagedCodexHome } from '../codex/codex-config-mirror'
import { getSystemCodexHomePath } from '../codex/codex-home-paths'
import { MANAGED_HOOK_TIMEOUT_SECONDS } from '../agent-hooks/installer-utils'
import { readCodexTopLevelModelProvider } from '../codex/codex-model-provider-config'
import { parseWslUncPath } from '../../shared/wsl-paths'
import { toWindowsWslPath } from '../wsl'
import { buildEncodedWslBashCommand } from '../wsl-bash-command'


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
import { CodexAccountServicePhase2 } from './codex-account-reset-credits'

export class CodexAccountServicePhase3 extends CodexAccountServicePhase2 {
  protected tryCreateWslManagedHome(
    accountId: string,
    target?: CodexAccountAddTarget
  ): ManagedHomeLocation | null {
    if (process.platform !== 'win32' || target?.runtime !== 'wsl') {
      return null
    }

    const distroArgs = target.wslDistro?.trim() ? ['-d', target.wslDistro.trim()] : []
    const infoOutput = execFileSync(
      'wsl.exe',
      [...distroArgs, '--', 'bash', '-lc', 'printf "%s\\n%s\\n" "$WSL_DISTRO_NAME" "$HOME"'],
      { encoding: 'utf-8', timeout: 5000 }
    )
    const [rawDistro, rawHome] = infoOutput
      .replaceAll(String.fromCharCode(0), '')
      .split(/\r?\n/)
      .map((line) => line.trim())
    const distro = target.wslDistro?.trim() || rawDistro
    const home = rawHome
    if (!distro || !home?.startsWith('/')) {
      throw new Error('Could not resolve the active WSL home directory for Codex login.')
    }

    const wslLinuxHomePath = `${home.replace(/\/$/, '')}/.local/share/orca/codex-accounts/${accountId}/home`
    const markerPath = `${wslLinuxHomePath}/.orca-managed-home`
    execFileSync(
      'wsl.exe',
      [
        '-d',
        distro,
        '--',
        'bash',
        '-lc',
        `mkdir -p ${shellQuote(wslLinuxHomePath)} && printf '%s\\n' ${shellQuote(accountId)} > ${shellQuote(markerPath)}`
      ],
      { encoding: 'utf-8', timeout: 5000 }
    )

    const managedHomePath = toWindowsWslPath(wslLinuxHomePath, distro)
    let trustedManagedHomePath: string
    try {
      trustedManagedHomePath = this.assertManagedHomePath(managedHomePath, accountId)
    } catch (error) {
      this.safeRemoveWslManagedHomeCandidate(distro, wslLinuxHomePath, accountId)
      throw error
    }

    return {
      managedHomePath: trustedManagedHomePath,
      managedHomeRuntime: 'wsl',
      wslDistro: distro,
      wslLinuxHomePath
    }
  }

  protected safeSyncCanonicalConfigToManagedHomes(): void {
    try {
      this.syncCanonicalConfigToManagedHomes()
    } catch (error) {
      console.warn('[codex-accounts] Failed to sync canonical config:', error)
    }
  }

  protected safeSyncCanonicalConfigIntoManagedHome(
    managedHomePath: string,
    canonicalConfig?: CanonicalCodexConfig | null,
    expectedAccountId?: string
  ): void {
    try {
      this.syncCanonicalConfigIntoManagedHome(managedHomePath, canonicalConfig, expectedAccountId)
    } catch (error) {
      console.warn('[codex-accounts] Failed to seed managed config:', error)
    }
  }

  protected syncCanonicalConfigToManagedHomes(): void {
    const settings = this.store.getSettings()
    for (const account of settings.codexManagedAccounts) {
      try {
        this.syncCanonicalConfigIntoManagedHome(account.managedHomePath, undefined, account.id)
      } catch (error) {
        console.warn('[codex-accounts] Failed to sync managed config:', error)
      }
    }
  }

  protected isSelfContainedHostManagedHome(managedHomePath: string): boolean {
    // Why: flag ON makes each host account home its own launch CODEX_HOME. WSL
    // homes keep their distro-local seed lane; the flag-OFF opt-out is unchanged.
    return isCodexSystemDefaultRealHomeEnabled() && !parseWslUncPath(managedHomePath)
  }

  protected syncCanonicalConfigIntoManagedHome(
    managedHomePath: string,
    canonicalConfig = this.readCanonicalConfigForManagedHome(managedHomePath),
    expectedAccountId?: string
  ): void {
    if (canonicalConfig === null) {
      return
    }

    const trustedManagedHomePath = this.assertManagedHomePath(managedHomePath, expectedAccountId)
    if (this.isSelfContainedHostManagedHome(trustedManagedHomePath)) {
      // Why: this home is codex's live CODEX_HOME, so mirror config with the
      // trust-preserving merge — the plain overwrite below would wipe the
      // hook/project trust codex granted in this home, forcing a re-approval and
      // an app-server re-grant on every account switch.
      syncSystemConfigIntoManagedCodexHome({
        runtimeHomePath: trustedManagedHomePath,
        systemHomePath: getSystemCodexHomePath()
      })
      return
    }
    // Why: Orca account switching is meant to swap Codex credentials and quota
    // identity, not silently fork the user's sandbox/config defaults. Syncing
    // one canonical config into every managed home keeps auth isolated per
    // account while preserving consistent Codex behavior. Managed homes are
    // real CODEX_HOMEs for `codex login`, so relative path-valued settings
    // must keep resolving against the home the config was read from.
    let sanitizedConfig = canonicalConfig.contents
    if (isCodexSystemDefaultRealHomeEnabled()) {
      const material = getCodexManagedHookInstallMaterial()
      // Why: source-home Orca trust is foreign to each managed home's hooks.json.
      sanitizedConfig = stripCodexManagedHookTrustEntriesFromConfig(canonicalConfig.contents, {
        runtimeHomePath: canonicalConfig.sourceHomePath,
        sourcePath: canonicalConfig.sourceHooksPath,
        command: material.command,
        managedEventLabels: new Set(Object.values(material.eventLabel)),
        timeoutSec: MANAGED_HOOK_TIMEOUT_SECONDS
      })
    }
    this.writeManagedConfig(
      trustedManagedHomePath,
      rewriteRelativePathConfigValues(sanitizedConfig, canonicalConfig.sourceHomePath)
    )
  }

  protected readCanonicalConfig(): CanonicalCodexConfig | null {
    const sourceHomePath = join(homedir(), '.codex')
    const primaryConfigPath = join(sourceHomePath, 'config.toml')
    if (!existsSync(primaryConfigPath)) {
      return null
    }

    try {
      return {
        contents: readFileSync(primaryConfigPath, 'utf-8'),
        sourceHomePath,
        sourceHooksPath: join(sourceHomePath, 'hooks.json')
      }
    } catch (error) {
      console.warn('[codex-accounts] Failed to read canonical config:', error)
      return null
    }
  }

  protected readCanonicalConfigForManagedHome(managedHomePath: string): CanonicalCodexConfig | null {
    const wslInfo = parseWslUncPath(managedHomePath)
    if (!wslInfo) {
      return this.readCanonicalConfig()
    }

    const managedRootMarker = '/.local/share/orca/codex-accounts/'
    const markerIndex = wslInfo.linuxPath.indexOf(managedRootMarker)
    if (markerIndex < 0) {
      return null
    }
    const wslHome = wslInfo.linuxPath.slice(0, markerIndex)
    const configPath = toWindowsWslPath(`${wslHome}/.codex/config.toml`, wslInfo.distro)
    if (!existsSync(configPath)) {
      return null
    }

    try {
      // Why: the config is read over UNC but consumed by Codex inside WSL, so
      // path rewrites must anchor to the Linux-side ~/.codex, not the UNC path.
      return {
        contents: readFileSync(configPath, 'utf-8'),
        sourceHomePath: `${wslHome}/.codex`,
        sourceHooksPath: `${wslHome}/.codex/hooks.json`
      }
    } catch (error) {
      console.warn('[codex-accounts] Failed to read WSL canonical config:', error)
      return null
    }
  }

  protected assertOAuthAccountAddAllowed(canonicalConfig: CanonicalCodexConfig | null): void {
    const modelProvider = canonicalConfig
      ? readCodexTopLevelModelProvider(canonicalConfig.contents)
      : null
    if (!modelProvider || modelProvider === 'openai') {
      return
    }

    // Why: mirroring a custom-provider pin into an OAuth managed home makes
    // the new OAuth credentials inert; fail before login and leave user config intact.
    throw new Error(
      `Orca cannot add a Codex OAuth account while ~/.codex/config.toml pins the custom provider ${JSON.stringify(modelProvider)}. Keep using the system-default account for this provider, or remove model_provider (or set it to "openai") before adding an OAuth account. Orca left your config unchanged.`
    )
  }

  protected writeManagedConfig(managedHomePath: string, contents: string): void {
    const configPath = join(managedHomePath, 'config.toml')
    try {
      if (existsSync(configPath) && readFileSync(configPath, 'utf-8') === contents) {
        return
      }
    } catch {
      // Why: a read error must not make a stale config look current; atomic write owns ACL repair and error surfacing.
    }
    writeFileAtomically(configPath, contents)
  }

  protected getManagedAccountsRoot(): string {
    const root = join(app.getPath('userData'), 'codex-accounts')
    mkdirSync(root, { recursive: true })
    return root
  }

  protected ensureManagedHomeForReauthentication(account: CodexManagedAccount): string {
    const wslInfo = parseWslUncPath(account.managedHomePath)
    if (wslInfo && process.platform === 'win32') {
      this.ensureExpectedWslManagedHomeForReauthentication(account, wslInfo)
      return this.assertManagedHomePath(account.managedHomePath, account.id)
    }

    try {
      return this.assertManagedHomePath(account.managedHomePath, account.id)
    } catch (error) {
      if (!this.isMissingManagedHomeError(error)) {
        throw error
      }
      return this.recreateExpectedHostManagedHomeForReauthentication(account, error)
    }
  }

  protected recreateExpectedHostManagedHomeForReauthentication(
    account: CodexManagedAccount,
    originalError: unknown
  ): string {
    const expectedManagedHomePath = join(this.getManagedAccountsRoot(), account.id, 'home')
    if (!this.pathsEqual(account.managedHomePath, expectedManagedHomePath)) {
      throw originalError
    }

    // Why: re-auth may recreate a lost empty home, but only at the exact Orca-owned path persisted for this account.
    mkdirSync(expectedManagedHomePath, { recursive: true })
    writeFileSync(join(expectedManagedHomePath, '.orca-managed-home'), `${account.id}\n`, 'utf-8')
    return this.assertManagedHomePath(expectedManagedHomePath, account.id)
  }

  protected ensureExpectedWslManagedHomeForReauthentication(
    account: CodexManagedAccount,
    wslInfo: { distro: string; linuxPath: string }
  ): void {
    if (
      account.managedHomeRuntime !== 'wsl' ||
      account.wslDistro !== wslInfo.distro ||
      account.wslLinuxHomePath !== wslInfo.linuxPath ||
      !wslInfo.linuxPath.endsWith(`/.local/share/orca/codex-accounts/${account.id}/home`)
    ) {
      return
    }

    execFileSync(
      'wsl.exe',
      [
        '-d',
        wslInfo.distro,
        '--',
        'bash',
        '-lc',
        buildEncodedWslBashCommand(
          [
            'set -euo pipefail',
            `candidate=${shellQuote(wslInfo.linuxPath)}`,
            `expected_marker=${shellQuote(account.id)}`,
            'marker="$candidate/.orca-managed-home"',
            'if [ -e "$candidate" ] && [ ! -f "$marker" ]; then exit 41; fi',
            'if [ -f "$marker" ] && [ "$(cat "$marker")" != "$expected_marker" ]; then exit 42; fi',
            'mkdir -p -- "$candidate"',
            'printf "%s\\n" "$expected_marker" > "$marker"'
          ].join('\n')
        )
      ],
      { encoding: 'utf-8', timeout: 5000 }
    )
  }

  protected isMissingManagedHomeError(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message === 'Managed Codex home directory does not exist on disk.'
    )
  }

  protected pathsEqual(left: string, right: string): boolean {
    const resolvedLeft = resolve(left)
    const resolvedRight = resolve(right)
    if (process.platform === 'win32') {
      return resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    }
    return resolvedLeft === resolvedRight
  }


}
