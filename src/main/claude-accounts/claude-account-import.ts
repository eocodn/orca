import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { resolveClaudeCommand } from '../codex-cli/command'
import { getClaudeManagedAccountsRoot, resolveOwnedClaudeManagedAuthPath } from './managed-auth-path'
import { deleteManagedClaudeKeychainCredentials } from './keychain'
import { parseWslUncPath } from '../../shared/wsl-paths'
import { toWindowsWslPath } from '../wsl'
import { buildEncodedWslBashCommand } from '../wsl-bash-command'
import { buildWindowsCommandInvocation } from './windows-command-invocation'
import { MAX_COMMAND_OUTPUT_CHARS,
  WINDOWS_TASKKILL_TIMEOUT_MS,
  CLAUDE_AUTH_DENIED_PATTERN,
  type ClaudeAccountAddTarget,
  type ManagedClaudeAuthLocation,
  shellQuote  } from './claude-account-foundation'
import { ClaudeAccountServicePhase1 } from './claude-account-login'

export class ClaudeAccountServicePhase2 extends ClaudeAccountServicePhase1 {
  protected tryCreateWslManagedAuthDir(
    accountId: string,
    target?: ClaudeAccountAddTarget
  ): ManagedClaudeAuthLocation | null {
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
      throw new Error('Could not resolve the active WSL home directory for Claude login.')
    }

    const wslLinuxAuthPath = `${home.replace(/\/$/, '')}/.local/share/orca/claude-accounts/${accountId}/auth`
    const markerPath = `${wslLinuxAuthPath}/.orca-managed-claude-auth`
    execFileSync(
      'wsl.exe',
      [
        '-d',
        distro,
        '--',
        'bash',
        '-lc',
        `mkdir -p ${shellQuote(wslLinuxAuthPath)} && printf '%s\\n' ${shellQuote(accountId)} > ${shellQuote(markerPath)}`
      ],
      { encoding: 'utf-8', timeout: 5000 }
    )

    const managedAuthPath = toWindowsWslPath(wslLinuxAuthPath, distro)
    return {
      managedAuthPath: this.assertManagedAuthPath(managedAuthPath, accountId),
      managedAuthRuntime: 'wsl',
      wslDistro: distro,
      wslLinuxAuthPath
    }
  }

  protected getManagedAccountsRoot(): string {
    const root = getClaudeManagedAccountsRoot()
    mkdirSync(root, { recursive: true })
    return root
  }

  protected assertManagedAuthPath(candidatePath: string, expectedAccountId?: string): string {
    const wslInfo = parseWslUncPath(candidatePath)
    if (wslInfo) {
      if (
        !wslInfo.linuxPath.includes('/.local/share/orca/claude-accounts/') ||
        !wslInfo.linuxPath.endsWith('/auth')
      ) {
        throw new Error('Managed WSL Claude auth storage is outside Orca account storage.')
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
                  'managed_root="${HOME%/}/.local/share/orca/claude-accounts"',
                  'candidate_real=$(readlink -f -- "$candidate")',
                  'managed_root_real=$(readlink -f -- "$managed_root")',
                  'test -f "$candidate_real/.orca-managed-claude-auth"',
                  expectedAccountId
                    ? `test "$(cat "$candidate_real/.orca-managed-claude-auth")" = ${shellQuote(expectedAccountId)}`
                    : 'test -n "$(cat "$candidate_real/.orca-managed-claude-auth")"',
                  'case "$candidate_real" in "$managed_root_real"/*/auth) printf "%s\\n" "$candidate_real" ;; *) exit 35 ;; esac'
                ].join('\n')
              )
            ],
            { encoding: 'utf-8', timeout: 5000 }
          ).trim()
          if (!canonicalLinuxPath) {
            throw new Error('Managed Claude auth directory does not exist on disk.')
          }
          return toWindowsWslPath(canonicalLinuxPath, wslInfo.distro)
        } catch (error) {
          throw new Error('Managed WSL Claude auth storage is outside Orca account storage.', {
            cause: error
          })
        }
      }
      if (
        !existsSync(candidatePath) ||
        !existsSync(join(candidatePath, '.orca-managed-claude-auth'))
      ) {
        throw new Error('Managed Claude auth storage is not owned by Orca.')
      }
      return candidatePath
    }

    this.getManagedAccountsRoot()
    const accountId = expectedAccountId ?? this.readManagedAuthAccountIdFromPath(candidatePath)
    if (!accountId || (expectedAccountId && accountId !== expectedAccountId)) {
      throw new Error('Managed Claude auth directory does not exist on disk.')
    }
    const trustedPath = resolveOwnedClaudeManagedAuthPath(accountId, candidatePath, {
      adoptLegacyMarker: true
    })
    if (!trustedPath) {
      throw new Error('Managed Claude auth storage is not owned by Orca.')
    }
    return trustedPath
  }

  protected readManagedAuthAccountIdFromPath(candidatePath: string): string | null {
    const rootPath = this.getManagedAccountsRoot()
    const relativePath = relative(resolve(rootPath), resolve(candidatePath))
    const parts = relativePath.split(sep)
    return parts.length === 2 && parts[1] === 'auth' ? parts[0] : null
  }

  protected async safeRemoveManagedAuth(accountId: string, candidatePath: string): Promise<void> {
    try {
      const managedAuthPath = this.assertManagedAuthPath(candidatePath, accountId)
      rmSync(resolve(managedAuthPath, '..'), { recursive: true, force: true })
    } catch (error) {
      console.warn('[claude-accounts] Refusing to remove untrusted managed auth:', error)
    }
    await deleteManagedClaudeKeychainCredentials(accountId)
  }

  protected runClaudeCommand(
    args: string[],
    configDir: { windowsPath: string; linuxPath: string | null; wslDistro: string | null },
    timeoutMs: number,
    options?: { allowFailure?: boolean; signal?: AbortSignal; keepStdinOpen?: boolean }
  ): Promise<string> {
    return new Promise((resolvePromise, rejectPromise) => {
      const spawnConfig =
        configDir.linuxPath && configDir.wslDistro
          ? {
              command: 'wsl.exe',
              args: [
                '-d',
                configDir.wslDistro,
                '--',
                'bash',
                '-lc',
                `export CLAUDE_CONFIG_DIR=${shellQuote(configDir.linuxPath)}; exec claude ${args.map(shellQuote).join(' ')}`
              ],
              env: process.env,
              shell: false,
              windowsVerbatimArguments: false
            }
          : process.platform === 'win32'
            ? {
                ...buildWindowsCommandInvocation(resolveClaudeCommand(), args),
                env: {
                  ...process.env,
                  CLAUDE_CONFIG_DIR: configDir.windowsPath
                },
                shell: false
              }
            : {
                command: resolveClaudeCommand(),
                args,
                env: {
                  ...process.env,
                  CLAUDE_CONFIG_DIR: configDir.windowsPath
                },
                shell: false,
                windowsVerbatimArguments: false
              }
      const child = spawn(spawnConfig.command, spawnConfig.args, {
        // Why: Claude's browser auth can bind its callback lifetime to stdin.
        // Keeping stdin open prevents hidden managed-login runs from tearing down
        // the local callback server before the browser returns.
        stdio: [options?.keepStdinOpen ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        shell: spawnConfig.shell,
        windowsVerbatimArguments: spawnConfig.windowsVerbatimArguments,
        env: spawnConfig.env,
        // Why: Claude auth can leave browser/login descendants alive after denial.
        // A process group lets cancellation terminate the whole POSIX login tree.
        detached: process.platform !== 'win32'
      })
      const stdout = child.stdout
      const stderr = child.stderr
      if (!stdout || !stderr) {
        if (options?.keepStdinOpen) {
          child.stdin?.destroy()
        }
        child.kill()
        rejectPromise(new Error('Claude command failed to open output streams.'))
        return
      }
      const completesOnExit =
        process.platform === 'win32' &&
        configDir.linuxPath === null &&
        configDir.wslDistro === null &&
        args[0] === 'auth' &&
        args[1] === 'login'
      const completionEvent = completesOnExit ? 'exit' : 'close'

      let settled = false
      let output = ''
      const appendOutput = (chunk: Buffer): void => {
        output = `${output}${chunk.toString()}`
        if (output.length > MAX_COMMAND_OUTPUT_CHARS) {
          output = output.slice(-MAX_COMMAND_OUTPUT_CHARS)
        }
        if (CLAUDE_AUTH_DENIED_PATTERN.test(output)) {
          killChild(() =>
            settle(() => rejectPromise(new Error('Claude sign-in was denied. Please try again.')))
          )
        }
      }
      let timeout: ReturnType<typeof setTimeout> | null = null
      const cleanupListeners = (): void => {
        if (timeout) {
          clearTimeout(timeout)
          timeout = null
        }
        stdout.off('data', appendOutput)
        stderr.off('data', appendOutput)
        child.off('error', onError)
        child.off(completionEvent, onDone)
        options?.signal?.removeEventListener('abort', onAbort)
        if (options?.keepStdinOpen) {
          child.stdin?.destroy()
        }
        if (completesOnExit) {
          stdout.destroy()
          stderr.destroy()
        }
      }
      const settle = (callback: () => void): void => {
        if (settled) {
          return
        }
        settled = true
        cleanupListeners()
        callback()
      }
      const timeoutError = new Error('Claude sign-in took too long to finish.')
      const cancelError = new Error('Claude sign-in was cancelled.')
      let terminationPending = false
      const killChild = (afterKill: () => void): void => {
        if (terminationPending || settled) {
          return
        }
        terminationPending = true
        if (process.platform === 'win32' && child.pid) {
          const taskkill = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
            stdio: 'ignore',
            windowsHide: true
          })
          let taskkillFinished = false
          const finishTaskkill = (succeeded: boolean): void => {
            if (taskkillFinished) {
              return
            }
            taskkillFinished = true
            clearTimeout(taskkillTimeout)
            if (!succeeded) {
              child.kill()
            }
            afterKill()
          }
          const taskkillTimeout = setTimeout(() => {
            taskkill.kill()
            finishTaskkill(false)
          }, WINDOWS_TASKKILL_TIMEOUT_MS)
          taskkill.once('error', () => finishTaskkill(false))
          taskkill.once('close', (code) => finishTaskkill(code === 0))
          return
        }
        if (process.platform !== 'win32' && child.pid) {
          try {
            process.kill(-child.pid)
            afterKill()
            return
          } catch {
            // Fall back to the direct child if the process group is unavailable.
          }
        }
        child.kill()
        afterKill()
      }
      timeout = setTimeout(() => {
        killChild(() => settle(() => rejectPromise(timeoutError)))
      }, timeoutMs)

      const onAbort = (): void => {
        killChild(() => settle(() => rejectPromise(cancelError)))
      }
      const onError = (error: Error): void => {
        if (terminationPending) {
          return
        }
        settle(() => rejectPromise(error))
      }
      const onDone = (code: number | null): void => {
        if (terminationPending) {
          return
        }
        settle(() => {
          if (code === 0 || options?.allowFailure) {
            resolvePromise(output)
            return
          }
          const trimmedOutput = output.trim()
          rejectPromise(
            new Error(
              trimmedOutput
                ? `Claude command failed: ${trimmedOutput}`
                : `Claude command exited with code ${code ?? 'unknown'}.`
            )
          )
        })
      }

      stdout.on('data', appendOutput)
      stderr.on('data', appendOutput)
      child.on('error', onError)
      // Native Windows browsers can inherit these pipes and indefinitely delay close.
      child.on(completionEvent, onDone)

      if (options?.signal?.aborted) {
        onAbort()
      } else {
        options?.signal?.addEventListener('abort', onAbort, { once: true })
      }
    })
  }

  protected parseJsonObject(value: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(value) as unknown
      return this.asRecord(parsed)
    } catch {
      return null
    }
  }

  protected asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null
    }
    return value as Record<string, unknown>
  }

  protected readString(value: Record<string, unknown> | null, key: string): string | null {
    const field = value?.[key]
    return typeof field === 'string' ? field : null
  }

  protected normalizeField(value: string | null | undefined): string | null {
    if (!value) {
      return null
    }
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
}
