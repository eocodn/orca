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
import { CodexAccountServicePhase3 } from './codex-account-auth'

export class CodexAccountServicePhase4 extends CodexAccountServicePhase3 {
  protected assertManagedHomePath(candidatePath: string, expectedAccountId?: string): string {
    const wslInfo = parseWslUncPath(candidatePath)
    if (wslInfo) {
      if (
        !wslInfo.linuxPath.includes('/.local/share/orca/codex-accounts/') ||
        !wslInfo.linuxPath.endsWith('/home')
      ) {
        throw new Error('Managed WSL Codex home is outside Orca account storage.')
      }
      if (
        expectedAccountId !== undefined &&
        !wslInfo.linuxPath.endsWith(`/.local/share/orca/codex-accounts/${expectedAccountId}/home`)
      ) {
        throw new Error('Managed WSL Codex home does not match its persisted account ID.')
      }

      if (process.platform === 'win32') {
        try {
          const canonicalLinuxPath = execFileSync(
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
                  'managed_root="${HOME%/}/.local/share/orca/codex-accounts"',
                  'candidate_real=$(readlink -f -- "$candidate")',
                  'managed_root_real=$(readlink -f -- "$managed_root")',
                  'test -f "$candidate_real/.orca-managed-home"',
                  ...(expectedAccountId === undefined
                    ? [
                        'case "$candidate_real" in "$managed_root_real"/*/home) printf "%s\\n" "$candidate_real" ;; *) exit 35 ;; esac'
                      ]
                    : [
                        `expected_marker=${shellQuote(expectedAccountId)}`,
                        'test "$candidate_real" = "$managed_root_real/$expected_marker/home"',
                        'test "$(cat "$candidate_real/.orca-managed-home")" = "$expected_marker"',
                        'printf "%s\\n" "$candidate_real"'
                      ])
                ].join('\n')
              )
            ],
            { encoding: 'utf-8', timeout: 5000 }
          ).trim()
          if (!canonicalLinuxPath) {
            throw new Error('Managed Codex home directory does not exist on disk.')
          }
          return toWindowsWslPath(canonicalLinuxPath, wslInfo.distro)
        } catch (error) {
          throw new Error('Managed WSL Codex home is outside Orca account storage.', {
            cause: error
          })
        }
      }

      if (wslInfo.linuxPath.split('/').includes('..')) {
        throw new Error('Managed WSL Codex home is outside Orca account storage.')
      }
      if (!existsSync(candidatePath)) {
        throw new Error('Managed Codex home directory does not exist on disk.')
      }
      if (!existsSync(join(candidatePath, '.orca-managed-home'))) {
        throw new Error('Managed Codex home is missing Orca ownership marker.')
      }
      if (
        expectedAccountId !== undefined &&
        readFileSync(join(candidatePath, '.orca-managed-home'), 'utf-8').trim() !==
          expectedAccountId
      ) {
        throw new Error('Managed WSL Codex home ownership marker does not match its account ID.')
      }
      return candidatePath
    }

    return assertOwnedHostCodexManagedHomePath({
      candidatePath,
      managedAccountsRoot: this.getManagedAccountsRoot(),
      systemCodexHomePath: getSystemCodexHomePath(),
      expectedAccountId
    })
  }

  protected safeRemoveWslManagedHomeCandidate(
    distro: string,
    linuxHomePath: string,
    expectedAccountId: string
  ): void {
    // Why: creation can fail after mkdir/marker but before trust, so cleanup must verify the marker/account ID inside WSL.
    try {
      execFileSync(
        'wsl.exe',
        [
          '-d',
          distro,
          '--',
          'bash',
          '-lc',
          buildEncodedWslBashCommand(
            [
              'set -euo pipefail',
              `candidate=${shellQuote(linuxHomePath)}`,
              `expected_marker=${shellQuote(expectedAccountId)}`,
              'managed_root="${HOME%/}/.local/share/orca/codex-accounts"',
              'candidate_real=$(readlink -f -- "$candidate" 2>/dev/null || true)',
              'managed_root_real=$(readlink -f -- "$managed_root" 2>/dev/null || true)',
              'test -n "$candidate_real"',
              'test -n "$managed_root_real"',
              'case "$candidate_real" in "$managed_root_real"/*/home) ;; *) exit 0 ;; esac',
              'test -f "$candidate_real/.orca-managed-home"',
              'test "$(cat "$candidate_real/.orca-managed-home")" = "$expected_marker"',
              'rm -rf -- "$candidate_real"',
              'parent_dir=$(dirname -- "$candidate_real")',
              'case "$parent_dir" in "$managed_root_real"/*) rmdir -- "$parent_dir" 2>/dev/null || true ;; esac'
            ].join('\n')
          )
        ],
        { encoding: 'utf-8', timeout: 5000 }
      )
    } catch (error) {
      console.warn('[codex-accounts] Failed to clean up WSL managed home candidate:', error)
    }
  }

  protected safeRemoveManagedHome(candidatePath: string, expectedAccountId: string): void {
    let managedHomePath: string
    try {
      managedHomePath = this.assertManagedHomePath(candidatePath, expectedAccountId)
    } catch (error) {
      console.warn('[codex-accounts] Refusing to remove untrusted managed home:', error)
      return
    }

    try {
      removeManagedHomeTreeSync(managedHomePath)
    } catch (error) {
      // Why: this runs from error-cleanup paths; a still-held Windows handle
      // must not mask the original failure with an ENOTEMPTY from rmSync.
      console.warn('[codex-accounts] Failed to remove managed home:', error)
      return
    }

    if (parseWslUncPath(managedHomePath)) {
      try {
        removeManagedHomeTreeSync(dirname(managedHomePath))
      } catch {
        // Best-effort cleanup
      }
      return
    }

    // Why: homes live at <accounts-root>/<uuid>/home; removing the home/ leaf leaves an empty <uuid>/ behind.
    try {
      const parentDir = resolve(managedHomePath, '..')
      // Why: canonicalize the root too so the prefix check works on macOS where userData resolves through /protected/var.
      const root = realpathSync(this.getManagedAccountsRoot())
      if (parentDir.startsWith(root + sep) && parentDir !== root) {
        removeManagedHomeTreeSync(parentDir)
      }
    } catch {
      // Best-effort cleanup
    }
  }

  protected async runCodexLogin(managedHomePath: string): Promise<void> {
    const wslInfo = parseWslUncPath(managedHomePath)
    if (wslInfo) {
      this.assertWslCodexCliAvailable(wslInfo)
    }
    // Why: reauthentication starts with an existing auth.json. Only new auth
    // bytes prove this login completed; existence alone would kill the
    // Windows OAuth flow five seconds after it opened.
    const initialAuthSnapshot = wslInfo
      ? null
      : readLoginAuthSnapshot(join(managedHomePath, 'auth.json'))

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const spawnConfig = wslInfo
        ? {
            command: 'wsl.exe',
            args: buildWslCodexLoginArgs(wslInfo.distro, wslInfo.linuxPath),
            env: process.env,
            codexCommand: 'codex'
          }
        : (() => {
            const codexCommand = resolveCodexCommand()
            // Why: Windows codex may be a .cmd/.bat; spawn+shell:true would trigger DEP0190, so invoke cmd.exe /c explicitly.
            const { spawnCmd, spawnArgs } = getSpawnArgsForWindows(codexCommand, ['login'])
            return {
              command: spawnCmd,
              args: spawnArgs,
              env: {
                ...process.env,
                CODEX_HOME: managedHomePath
              },
              codexCommand
            }
          })()
      const child = spawn(spawnConfig.command, spawnConfig.args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        // Why: prevents a console window flash for .cmd/.bat entrypoints routed through cmd.exe on Windows.
        windowsHide: true,
        env: spawnConfig.env
      })

      let settled = false
      let output = ''
      const appendOutput = (chunk: Buffer): void => {
        output = `${output}${chunk.toString()}`
        if (output.length > MAX_LOGIN_OUTPUT_CHARS) {
          output = output.slice(-MAX_LOGIN_OUTPUT_CHARS)
        }
      }

      let timeout: ReturnType<typeof setTimeout> | null = null
      let authWatchInterval: ReturnType<typeof setInterval> | null = null
      let postAuthExitTimeout: ReturnType<typeof setTimeout> | null = null
      let loginTreeKilledAfterAuth = false
      const authJsonPath = join(managedHomePath, 'auth.json')
      const cleanupListeners = (): void => {
        if (timeout) {
          clearTimeout(timeout)
          timeout = null
        }
        if (authWatchInterval) {
          clearInterval(authWatchInterval)
          authWatchInterval = null
        }
        if (postAuthExitTimeout) {
          clearTimeout(postAuthExitTimeout)
          postAuthExitTimeout = null
        }
        child.stdout.off('data', appendOutput)
        child.stderr.off('data', appendOutput)
        child.off('error', onError)
        child.off('close', onClose)
      }

      const settle = (callback: () => void): void => {
        if (settled) {
          return
        }
        settled = true
        cleanupListeners()
        callback()
      }

      const timeoutError = new Error('Codex sign-in took too long to finish. Please try again.')
      timeout = setTimeout(() => {
        killLoginProcessTree(child)
        settle(() => {
          rejectPromise(timeoutError)
        })
      }, LOGIN_TIMEOUT_MS)

      // Why: on Windows the codex login CLI can linger after writing auth.json,
      // and its open handles on the managed home (log/codex-login.log) make the
      // post-login file operations fail with ENOTEMPTY. Once auth.json exists,
      // give the tree a short grace period to exit, then force it down.
      if (process.platform === 'win32' && !wslInfo) {
        authWatchInterval = setInterval(() => {
          if (!loginAuthChanged(initialAuthSnapshot, readLoginAuthSnapshot(authJsonPath))) {
            return
          }
          if (authWatchInterval) {
            clearInterval(authWatchInterval)
            authWatchInterval = null
          }
          postAuthExitTimeout = setTimeout(() => {
            loginTreeKilledAfterAuth = true
            killLoginProcessTree(child)
          }, WINDOWS_LOGIN_POST_AUTH_EXIT_GRACE_MS)
        }, WINDOWS_LOGIN_AUTH_POLL_INTERVAL_MS)
      }

      const onError = (error: Error): void => {
        settle(() => {
          const isEnoent = (error as NodeJS.ErrnoException).code === 'ENOENT'
          // Why: ENOENT is ambiguous — missing codex binary or missing node in PATH; a resolved full path implies node is missing.
          const isBareCommand = spawnConfig.codexCommand === 'codex'
          const message = isEnoent
            ? isBareCommand
              ? 'Codex CLI not found.'
              : 'Codex CLI found but could not run — Node.js may not be in your PATH.'
            : error.message
          rejectPromise(new Error(message))
        })
      }

      const onClose = (code: number | null): void => {
        settle(() => {
          // Why: the post-auth tree kill is a success path — auth.json already
          // exists and codex only failed to exit on its own, so the forced
          // non-zero exit must not surface as a login failure.
          if (code === 0 || (loginTreeKilledAfterAuth && existsSync(authJsonPath))) {
            resolvePromise()
            return
          }
          const trimmedOutput = output.trim()
          rejectPromise(
            new Error(
              trimmedOutput
                ? `Codex login failed: ${trimmedOutput}`
                : `Codex login exited with code ${code ?? 'unknown'}.`
            )
          )
        })
      }

      child.stdout.on('data', appendOutput)
      child.stderr.on('data', appendOutput)
      child.on('error', onError)
      child.on('close', onClose)
    })
  }

  protected assertWslCodexCliAvailable(wslInfo: { distro: string; linuxPath: string }): void {
    try {
      execFileSync('wsl.exe', buildWslCodexAvailabilityArgs(wslInfo.distro), {
        encoding: 'utf-8',
        timeout: WSL_CODEX_AVAILABILITY_TIMEOUT_MS
      })
    } catch (error) {
      throw new Error(
        `Codex CLI is not available in WSL ${wslInfo.distro}. Install Codex in that distro or switch Account location to Windows.`,
        { cause: error }
      )
    }
  }


}
