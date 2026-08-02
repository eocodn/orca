import * as pty from 'node-pty'
import { statSync } from 'node:fs'
import { delimiter, win32 as pathWin32 } from 'node:path'
import type { SubprocessHandle } from './session'
import { DaemonProtocolError } from './types'
import {
  getAttributionShellLaunchConfig,
  getShellReadyLaunchConfig,
  resolvePtyShellPath
} from './shell-ready'
import { isValidPtySize, normalizePtySize } from './daemon-pty-size'
import {
  ensureNodePtySpawnHelperExecutable,
  getNodePtySpawnHelperCandidates,
  resolveUnixShellPath,
  validateWorkingDirectory
} from '../providers/local-pty-utils'
import { wrapShellSpawnForMacosTccAttribution } from '../providers/macos-tcc-login-shell'
import { resolveWindowsShellLaunchArgs } from '../providers/windows-shell-args'
import {
  resolveEffectiveWindowsPowerShell,
  shouldProbeWindowsPowerShellAvailability,
  type WindowsPowerShellShellFamily
} from '../providers/windows-powershell'
import {
  buildWindowsPowerShellSpawnAttempts,
  type WindowsShellSpawnAttempt
} from '../providers/windows-shell-fallback-chain'
import { isPwshAvailable } from '../pwsh'
import { isHostCodexHomeForWsl, isWslCodexHomeForHost } from '../pty/codex-home-wsl-env'
import { removeInheritedNoColor } from '../pty/terminal-color-env'
import { removeAppImageRuntimeEnv } from '../pty/appimage-terminal-env'
import { stripInheritedBuildModeEnv } from '../pty/build-mode-env'
import { parseWslPath } from '../wsl'
import { addWslEnvKeys } from '../wsl-env'
import {
  gitCredentialPromptGuardEnv,
  mergeGitConfigEnvProtocol
} from '../../shared/git-credential-prompt-env'
import { TERMINAL_GIT_CREDENTIAL_GUARD_POLICY_ENV } from '../../shared/terminal-git-credential-guard'
import { resolveWslSessionContext } from './wsl-session-context'
import { addOrcaWslInteropEnv } from '../pty/wsl-orca-env'
import {
  POWERLEVEL10K_WIZARD_DISABLE_ENV,
  seedPowerlevel10kWizardEnv
} from '../pty/powerlevel10k-wizard-env'
import { isWindowsGitBashShellPath, resolveWindowsGitBashShellPath } from '../git-bash'
import { WINDOWS_GIT_BASH_SHELL } from '../../shared/windows-terminal-shell'
import { resolveAgentForegroundProcessWithAvailability } from '../providers/agent-foreground-process'
import { readWindowsConptyProcessIds } from '../providers/windows-conpty-process-membership'
import {
  isAgentForegroundWrapperProcess,
  recognizeAgentProcess,
  recognizeAgentProcessFromCommandLine
} from '../../shared/agent-process-recognition'
import { shouldInspectOuterWrapperForegroundProcess } from '../../shared/foreground-wrapper-agent'
import {
  shouldUseShellReadyStartupDelivery,
  type StartupCommandDelivery
} from '../../shared/codex-startup-delivery'
import { isShellProcess } from '../../shared/shell-process-detection'
import { parsePtySessionId } from './pty-session-id'
import { getAgentForegroundContextPaths } from '../providers/agent-foreground-context-paths'
import { assertSafeAgentStartupCwd, resolveSafePtyDefaultCwd } from '../providers/pty-default-cwd'
import { ORCA_HERMES_STARTUP_QUERY_ENV } from '../../shared/hermes-startup-query'
import type { TuiAgent } from '../../shared/types'
import { forceKillPosixPtyProcessGroups } from '../pty/posix-pty-process-groups'
import type { PtySubprocessOptions } from './daemon-pty-spawn-support'

export { PtySubprocessOptions } from './daemon-pty-spawn-support'

export function createPtySubprocess(opts: PtySubprocessOptions): SubprocessHandle {
  const size = normalizePtySize(opts.cols, opts.rows)
  const env: Record<string, string> = {
    ...mergeGitConfigEnvProtocol(stripInheritedBuildModeEnv(process.env), opts.env),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'Orca',
    // Why: TUIs feature-gate on TERM_PROGRAM_VERSION; ORCA_APP_VERSION is inherited from the forking main process.
    TERM_PROGRAM_VERSION: process.env.ORCA_APP_VERSION ?? '0.0.0-dev',
    // Why: `supports-hyperlinks` gates OSC 8 on a TERM_PROGRAM allowlist excluding Orca; force it since xterm.js parses OSC 8 for clickable links.
    FORCE_HYPERLINK: '1'
  } as Record<string, string>
  composeGuardedDaemonGitConfigEnv(env, opts.env, opts.launchAgent)
  deleteRequestedDaemonEnvKeys(env, opts.envToDelete)
  if (opts.env?.TERM) {
    env.TERM = opts.env.TERM
  }
  // Why: the daemon can inherit the pane identity of the terminal that launched `pn dev`; each PTY must opt into its own.
  removeUnspecifiedPaneIdentityEnv(env, opts.env)
  removeInheritedDevAgentHookEndpoint(env, opts.env)
  removeInheritedElectronRunAsNode(env)
  removeAppImageRuntimeEnv(env)
  removeInheritedNoColor(env)

  env.LANG ??= 'en_US.UTF-8'

  // Why: shellOverride must win over env.COMSPEC, or Windows always resolves to cmd.exe/PowerShell regardless of the user's pick.
  const resolvedWslContext = resolveWslSessionContext(opts)
  // Why: older persisted tabs can carry a PowerShell/cmd shellOverride; ignore it so WSL reconnects still enter the distro.
  let shellPath = resolvedWslContext ? 'wsl.exe' : opts.shellOverride || resolvePtyShellPath(env)
  let shellArgs: string[]
  let startupCommandDeliveredInShellArgs = false
  let windowsFallbackAttempts: WindowsShellSpawnAttempt[] = []
  const startupAgentRecognition = recognizeAgentProcessFromCommandLine(opts.command)
  const isCodexStartupCommand = startupAgentRecognition?.agent === 'codex'
  // Why: gate on the effective cwd, not raw opts.cwd — an omitted cwd becomes a safe
  // default (mirrors LocalPtyProvider). Guarding first treated undefined as root-like (#9578).
  const requestedCwd = opts.cwd || getDefaultCwd()
  if (opts.command && startupAgentRecognition) {
    assertSafeAgentStartupCwd(requestedCwd, opts.command)
  }
  let spawnCwd = requestedCwd
  let validationCwd = spawnCwd

  if (process.platform === 'win32') {
    const normalizedShellFamily = pathWin32.basename(shellPath).toLowerCase()
    const resolvedGitBashPath = resolveWindowsGitBashShellPath(shellPath)
    // Why: normalize concrete PowerShell paths to the family so the resolver can fall back to powershell.exe when pwsh.exe is unavailable.
    const resolvedShellFamily: WindowsPowerShellShellFamily =
      normalizedShellFamily === 'powershell.exe' || normalizedShellFamily === 'pwsh.exe'
        ? normalizedShellFamily
        : normalizedShellFamily === 'cmd.exe' || normalizedShellFamily === 'wsl.exe'
          ? normalizedShellFamily
          : undefined
    const shouldProbePwsh = shouldProbeWindowsPowerShellAvailability({
      shellFamily: resolvedShellFamily,
      implementation: opts.terminalWindowsPowerShellImplementation
    })
    const shouldResolvePowerShellFamily =
      opts.terminalWindowsPowerShellImplementation !== undefined ||
      pathWin32.basename(shellPath) === shellPath
    if (resolvedGitBashPath) {
      shellPath = resolvedGitBashPath
    } else if (shellPath === WINDOWS_GIT_BASH_SHELL) {
      shellPath = 'powershell.exe'
    } else {
      shellPath = shouldResolvePowerShellFamily
        ? (resolveEffectiveWindowsPowerShell({
            shellFamily: resolvedShellFamily,
            implementation: opts.terminalWindowsPowerShellImplementation,
            pwshAvailable: shouldProbePwsh ? isPwshAvailable() : false
          }) ?? shellPath)
        : shellPath
    }
    // Why: a bare `pwsh.exe` resolves to the Store App Execution Alias stub whose launch fails with ERROR_ACCESS_DENIED (5).
    windowsFallbackAttempts = buildWindowsPowerShellSpawnAttempts({
      shellPath,
      cwd: spawnCwd,
      defaultCwd: getDefaultCwd(),
      wslContext: resolvedWslContext,
      startupCommand: opts.command
    })
    const primaryAttempt = windowsFallbackAttempts[0]
    if (primaryAttempt) {
      shellPath = primaryAttempt.shellPath
      shellArgs = primaryAttempt.shellArgs
      spawnCwd = primaryAttempt.effectiveCwd
      validationCwd = primaryAttempt.validationCwd
      startupCommandDeliveredInShellArgs = primaryAttempt.startupCommandDeliveredInShellArgs
    } else {
      const resolved = resolveWindowsShellLaunchArgs(
        shellPath,
        spawnCwd,
        getDefaultCwd(),
        resolvedWslContext,
        opts.command
      )
      shellArgs = resolved.shellArgs
      spawnCwd = resolved.effectiveCwd
      validationCwd = resolved.validationCwd
      startupCommandDeliveredInShellArgs = resolved.startupCommandDeliveredInShellArgs === true
    }
    if (isWindowsGitBashShellPath(shellPath)) {
      // Why: Git for Windows login startup files otherwise cd to $HOME, ignoring node-pty's cwd.
      env.CHERE_INVOKING ??= '1'
    }
    const codexHomeWslInfo = env.CODEX_HOME ? parseWslPath(env.CODEX_HOME) : null
    if (pathWin32.basename(shellPath).toLowerCase() === 'wsl.exe') {
      if (codexHomeWslInfo) {
        const launchWslDistro = resolvedWslContext?.distro
        if (launchWslDistro && launchWslDistro !== codexHomeWslInfo.distro) {
          delete env.CODEX_HOME
          delete env.ORCA_CODEX_HOME
        } else {
          env.CODEX_HOME = codexHomeWslInfo.linuxPath
          env.ORCA_CODEX_HOME = codexHomeWslInfo.linuxPath
          // Why: wsl.exe only imports non-default env vars named in WSLENV.
          addWslEnvKeys(env, ['CODEX_HOME', 'ORCA_CODEX_HOME'])
          if (!launchWslDistro) {
            const resolved = resolveWindowsShellLaunchArgs(
              shellPath,
              requestedCwd,
              getDefaultCwd(),
              {
                distro: codexHomeWslInfo.distro
              },
              opts.command
            )
            shellArgs = resolved.shellArgs
            spawnCwd = resolved.effectiveCwd
            validationCwd = resolved.validationCwd
            startupCommandDeliveredInShellArgs =
              resolved.startupCommandDeliveredInShellArgs === true
          }
        }
      } else if (isHostCodexHomeForWsl(env.CODEX_HOME)) {
        // Why: host-local Codex home is unusable in WSL; let WSL Codex use its Linux-side ~/.codex.
        delete env.CODEX_HOME
        delete env.ORCA_CODEX_HOME
      } else if (env.CODEX_HOME) {
        addWslEnvKeys(env, ['CODEX_HOME', 'ORCA_CODEX_HOME'])
      }

