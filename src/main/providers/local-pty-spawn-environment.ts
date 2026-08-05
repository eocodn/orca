import { win32 as pathWin32 } from 'node:path'
import { parseWslPath } from '../wsl'
import type { PtySpawnOptions } from './types'
import {
  getAttributionShellLaunchConfig,
  getShellReadyLaunchConfig,
  type ShellReadyLaunchConfig
} from './local-pty-shell-ready'
import { resolveWindowsShellLaunchArgs } from './windows-shell-args'
import { isWindowsGitBashShellPath } from '../git-bash'
import { addWslEnvKeys } from '../wsl-env'
import {
  POWERLEVEL10K_WIZARD_DISABLE_ENV,
  seedPowerlevel10kWizardEnv
} from '../pty/powerlevel10k-wizard-env'
import { removeInheritedNoColor } from '../pty/terminal-color-env'
import { removeAppImageRuntimeEnv } from '../pty/appimage-terminal-env'
import { stripInheritedBuildModeEnv } from '../pty/build-mode-env'
import { isHostCodexHomeForWsl, isWslCodexHomeForHost } from '../pty/codex-home-wsl-env'
import { ORCA_HERMES_STARTUP_QUERY_ENV } from '../../shared/hermes-startup-query'
import { mergeGitConfigEnvProtocol } from '../../shared/git-credential-prompt-env'
import { shouldUseShellReadyStartupDelivery } from '../../shared/codex-startup-delivery'
import type { recognizeAgentProcessFromCommandLine } from '../../shared/agent-process-recognition'
import { removeUnspecifiedPaneIdentityEnv } from './local-pty-state'
import type { WindowsShellWslContext } from './windows-shell-args'

type BuildSpawnEnv = (
  id: string,
  baseEnv: Record<string, string>,
  ctx?: {
    command?: string
    launchAgent?: PtySpawnOptions['launchAgent']
    codexHomePathOverride?: PtySpawnOptions['codexHomePathOverride']
    cwd?: string
    shellPath?: string
    isWsl?: boolean
    wslDistro?: string | null
  }
) => Record<string, string>

export type LocalPtySpawnEnvironment = {
  finalEnv: Record<string, string>
  shellArgs: string[]
  effectiveCwd: string
  validationCwd: string
  startupCommandDeliveredInShellArgs: boolean
  launchWslDistro: string | null
  shellReadyLaunch: ShellReadyLaunchConfig | null
  getFallbackShellReadyConfig: ((shell: string) => ShellReadyLaunchConfig) | undefined
}

/** Prepares inherited environment and shell-ready startup delivery before PTY creation. */
export function prepareLocalPtySpawnEnvironment(options: {
  id: string
  args: PtySpawnOptions
  cwd: string
  defaultCwd: string
  shellPath: string
  shellArgs: string[]
  effectiveCwd: string
  validationCwd: string
  startupCommandDeliveredInShellArgs: boolean
  startupAgentRecognition: ReturnType<typeof recognizeAgentProcessFromCommandLine> | null
  wslInfo: ReturnType<typeof parseWslPath>
  worktreeWslContext?: WindowsShellWslContext
  preferredWslContext?: WindowsShellWslContext
  launchWslContext?: WindowsShellWslContext
  buildSpawnEnv?: BuildSpawnEnv
}): LocalPtySpawnEnvironment {
  const { args, cwd, defaultCwd, shellPath, startupAgentRecognition } = options
  const spawnEnv: Record<string, string> = {
    ...mergeGitConfigEnvProtocol(stripInheritedBuildModeEnv(process.env), args.env),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'Orca',
    // Why: TUIs feature-gate on TERM_PROGRAM_VERSION; the fallback keeps tests and non-Electron runs working.
    TERM_PROGRAM_VERSION: process.env.ORCA_APP_VERSION ?? '0.0.0-dev',
    // Why: supports-hyperlinks rejects TERM_PROGRAM=Orca, so tools drop OSC 8 links; force it since xterm.js parses them.
    FORCE_HYPERLINK: '1'
  } as Record<string, string>
  // Why: Orca can be launched from an Orca terminal; pane identity belongs to the child PTY, not the parent shell.
  removeUnspecifiedPaneIdentityEnv(spawnEnv, args.env)
  removeAppImageRuntimeEnv(spawnEnv)
  removeInheritedNoColor(spawnEnv)
  for (const key of args.envToDelete ?? []) {
    delete spawnEnv[key]
  }
  if (args.env?.TERM) {
    spawnEnv.TERM = args.env.TERM
  }

  spawnEnv.LANG ??= 'en_US.UTF-8'

  // Why: on Windows LANG doesn't set the console code page; PYTHONUTF8=1 forces Python UTF-8 stdio to avoid garbled CJK.
  if (process.platform === 'win32') {
    spawnEnv.PYTHONUTF8 ??= '1'
    if (isWindowsGitBashShellPath(shellPath)) {
      // Why: Git for Windows login files otherwise cd to $HOME, ignoring node-pty's cwd for repo-scoped terminals.
      spawnEnv.CHERE_INVOKING ??= '1'
    }
  }

  const isWslShell =
    Boolean(options.wslInfo) || pathWin32.basename(shellPath).toLowerCase() === 'wsl.exe'
  const launchWslDistro = isWslShell ? (options.launchWslContext?.distro ?? null) : null
  const finalEnv = options.buildSpawnEnv
    ? options.buildSpawnEnv(options.id, spawnEnv, {
        command: args.command,
        launchAgent: args.launchAgent,
        codexHomePathOverride: args.codexHomePathOverride,
        cwd,
        shellPath,
        isWsl: isWslShell,
        wslDistro: launchWslDistro
      })
    : spawnEnv
  // Why: app-level env hooks can re-add scrubbed vars; delete last so shims like Claude Agent Teams keep their PATH.
  for (const key of args.envToDelete ?? []) {
    delete finalEnv[key]
  }
  if (args.env?.TERM) {
    finalEnv.TERM = args.env.TERM
  }
  let shellArgs = options.shellArgs
  let effectiveCwd = options.effectiveCwd
  let validationCwd = options.validationCwd
  let startupCommandDeliveredInShellArgs = options.startupCommandDeliveredInShellArgs
  if (process.platform === 'win32') {
    const codexHomeWslInfo = finalEnv.CODEX_HOME ? parseWslPath(finalEnv.CODEX_HOME) : null
    if (pathWin32.basename(shellPath).toLowerCase() === 'wsl.exe') {
      if (codexHomeWslInfo) {
        if (launchWslDistro && launchWslDistro !== codexHomeWslInfo.distro) {
          delete finalEnv.CODEX_HOME
          delete finalEnv.ORCA_CODEX_HOME
        } else {
          finalEnv.CODEX_HOME = codexHomeWslInfo.linuxPath
          finalEnv.ORCA_CODEX_HOME = codexHomeWslInfo.linuxPath
          // Why: wsl.exe only imports non-default env vars named in WSLENV.
          addWslEnvKeys(finalEnv, ['CODEX_HOME', 'ORCA_CODEX_HOME'])
          if (!launchWslDistro) {
            const resolved = resolveWindowsShellLaunchArgs(shellPath, cwd, defaultCwd, {
              distro: codexHomeWslInfo.distro
            })
            shellArgs = resolved.shellArgs
            effectiveCwd = resolved.effectiveCwd
            validationCwd = resolved.validationCwd
            startupCommandDeliveredInShellArgs =
              resolved.startupCommandDeliveredInShellArgs === true
          }
        }
      } else if (isHostCodexHomeForWsl(finalEnv.CODEX_HOME)) {
        // Why: Orca's Codex home is host-local; WSL Codex must use its Linux-side ~/.codex, not a Windows path.
        delete finalEnv.CODEX_HOME
        delete finalEnv.ORCA_CODEX_HOME
      } else if (finalEnv.CODEX_HOME) {
        addWslEnvKeys(finalEnv, ['CODEX_HOME', 'ORCA_CODEX_HOME'])
      }
      if (finalEnv.CLAUDE_CONFIG_DIR) {
        // Why: managed WSL Claude passes a Linux CLAUDE_CONFIG_DIR through wsl.exe; non-default vars need WSLENV import.
        addWslEnvKeys(finalEnv, ['CLAUDE_CONFIG_DIR'])
      }
      if (finalEnv[ORCA_HERMES_STARTUP_QUERY_ENV] !== undefined) {
        // Why: wsl.exe drops custom Windows env vars; the startup wrapper needs this imported inside WSL.
        addWslEnvKeys(finalEnv, [ORCA_HERMES_STARTUP_QUERY_ENV])
      }
    } else if (codexHomeWslInfo || isWslCodexHomeForHost(finalEnv.CODEX_HOME)) {
      // Why: WSL Codex homes are Linux paths Windows can't use; also drop ORCA_CODEX_HOME (shell-ready restores CODEX_HOME from it).
      delete finalEnv.CODEX_HOME
      delete finalEnv.ORCA_CODEX_HOME
    }
  }
  seedPowerlevel10kWizardEnv(finalEnv, { envToDelete: args.envToDelete })
  if (
    finalEnv[POWERLEVEL10K_WIZARD_DISABLE_ENV] !== undefined &&
    process.platform === 'win32' &&
    pathWin32.basename(shellPath).toLowerCase() === 'wsl.exe'
  ) {
    addWslEnvKeys(finalEnv, [POWERLEVEL10K_WIZARD_DISABLE_ENV])
  }

  let shellReadyLaunch: ShellReadyLaunchConfig | null = null
  let getFallbackShellReadyConfig: ((shell: string) => ShellReadyLaunchConfig) | undefined
  if (!options.wslInfo && process.platform !== 'win32') {
    // Why: OpenCode/Codex PATH restoration and OMP's status wrapper need shell-ready code after user startup files run.
    const needsNoMarkerWrapper =
      finalEnv.ORCA_OPENCODE_CONFIG_DIR ||
      finalEnv.ORCA_MIMOCODE_HOME ||
      finalEnv.ORCA_OMP_STATUS_EXTENSION ||
      finalEnv.ORCA_CODEX_HOME ||
      finalEnv.ORCA_AGENT_TEAMS_SHIM_DIR
    const isCodexStartupCommand = startupAgentRecognition?.agent === 'codex'
    let shellLaunch: ShellReadyLaunchConfig | null = null
    if (args.command && isCodexStartupCommand) {
      const shouldWaitForShellReady = shouldUseShellReadyStartupDelivery({
        command: args.command,
        startupCommandDelivery: args.startupCommandDelivery
      })
      // Why: payload-bearing Codex startup can be lost to rc-file noise; plain Codex stays markerless for startup speed.
      getFallbackShellReadyConfig = (shell) =>
        shouldWaitForShellReady
          ? getShellReadyLaunchConfig(shell)
          : getAttributionShellLaunchConfig(shell)
      shellLaunch = shouldWaitForShellReady
        ? getShellReadyLaunchConfig(shellPath)
        : getAttributionShellLaunchConfig(shellPath)
    } else if (args.command) {
      getFallbackShellReadyConfig = (shell) => getShellReadyLaunchConfig(shell)
      shellLaunch = getShellReadyLaunchConfig(shellPath)
    } else if (needsNoMarkerWrapper) {
      getFallbackShellReadyConfig = (shell) => getAttributionShellLaunchConfig(shell)
      shellLaunch = getAttributionShellLaunchConfig(shellPath)
    }
    if (shellLaunch) {
      Object.assign(finalEnv, shellLaunch.env)
      shellArgs = shellLaunch.args ?? shellArgs
      shellReadyLaunch = args.command ? shellLaunch : null
    }
  }

  return {
    finalEnv,
    shellArgs,
    effectiveCwd,
    validationCwd,
    startupCommandDeliveredInShellArgs,
    launchWslDistro,
    shellReadyLaunch,
    getFallbackShellReadyConfig
  }
}
