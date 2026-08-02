import { win32 as pathWin32 } from 'node:path'
import {
  resolveEffectiveWindowsPowerShell,
  shouldProbeWindowsPowerShellAvailability,
  type WindowsPowerShellShellFamily
} from './windows-powershell'
import {
  buildWindowsPowerShellSpawnAttempts,
  type WindowsShellSpawnAttempt
} from './windows-shell-fallback-chain'
import { resolveWindowsShellLaunchArgs } from './windows-shell-args'
import type { WindowsShellWslContext } from './windows-shell-args'
import { getDefaultWslDistro } from '../wsl'
import { getWslContextFromPreferredDistro } from './local-pty-state'
import { resolveWindowsGitBashShellPath } from '../git-bash'
import { WINDOWS_GIT_BASH_SHELL } from '../../shared/windows-terminal-shell'

export type LocalPtyWindowsShellLaunch = {
  shellPath: string
  shellArgs: string[]
  effectiveCwd: string
  validationCwd: string
  startupCommandDeliveredInShellArgs: boolean
  windowsFallbackAttempts: WindowsShellSpawnAttempt[]
  launchWslContext: WindowsShellWslContext | undefined
}

/** Resolves the selected Windows shell and its fallback launch attempts. */
export function resolveLocalPtyWindowsShellLaunch(options: {
  shellOverride?: string
  configuredShell?: string
  command?: string
  cwd: string
  defaultCwd: string
  worktreeWslContext?: WindowsShellWslContext
  launchWslContext?: WindowsShellWslContext
  getWindowsPowerShellImplementation?: () => 'auto' | 'powershell.exe' | 'pwsh.exe' | undefined
  pwshAvailable?: () => boolean
}): LocalPtyWindowsShellLaunch {
  let launchWslContext = options.launchWslContext
  const requestedShellFamily =
    options.shellOverride || options.configuredShell || process.env.COMSPEC || 'powershell.exe'
  const shellFamily = options.worktreeWslContext ? 'wsl.exe' : requestedShellFamily
  if (!launchWslContext && pathWin32.basename(shellFamily).toLowerCase() === 'wsl.exe') {
    launchWslContext = getWslContextFromPreferredDistro(getDefaultWslDistro())
  }
  const normalizedShellFamily = pathWin32.basename(shellFamily).toLowerCase()
  const resolvedGitBashPath = resolveWindowsGitBashShellPath(shellFamily)
  // Why: normalize setting-value and path forms to the PowerShell family so the resolver can fall back to inbox powershell.exe.
  const powerShellImplementation = options.getWindowsPowerShellImplementation?.()
  const resolvedShellFamily: WindowsPowerShellShellFamily =
    normalizedShellFamily === 'powershell.exe' || normalizedShellFamily === 'pwsh.exe'
      ? normalizedShellFamily
      : normalizedShellFamily === 'cmd.exe' || normalizedShellFamily === 'wsl.exe'
        ? normalizedShellFamily
        : undefined
  const shouldProbePwsh = shouldProbeWindowsPowerShellAvailability({
    shellFamily: resolvedShellFamily,
    implementation: powerShellImplementation
  })
  const shouldResolvePowerShellFamily =
    powerShellImplementation !== undefined || pathWin32.basename(shellFamily) === shellFamily
  let shellPath: string
  if (resolvedGitBashPath) {
    shellPath = resolvedGitBashPath
  } else if (shellFamily === WINDOWS_GIT_BASH_SHELL) {
    shellPath = 'powershell.exe'
  } else {
    shellPath = shouldResolvePowerShellFamily
      ? (resolveEffectiveWindowsPowerShell({
          shellFamily: resolvedShellFamily,
          implementation: powerShellImplementation,
          pwshAvailable: shouldProbePwsh ? (options.pwshAvailable?.() ?? false) : false
        }) ?? shellFamily)
      : shellFamily
  }

  // Why: bare `pwsh.exe` resolves to the Store App Execution Alias stub whose spawn fails (code 5); use an absolute exe + cmd.exe fallback.
  const windowsFallbackAttempts = buildWindowsPowerShellSpawnAttempts({
    shellPath,
    cwd: options.cwd,
    defaultCwd: options.defaultCwd,
    wslContext: launchWslContext,
    startupCommand: options.command
  })
  const primaryAttempt = windowsFallbackAttempts[0]
  if (primaryAttempt) {
    return {
      shellPath: primaryAttempt.shellPath,
      shellArgs: primaryAttempt.shellArgs,
      effectiveCwd: primaryAttempt.effectiveCwd,
      validationCwd: primaryAttempt.validationCwd,
      startupCommandDeliveredInShellArgs: primaryAttempt.startupCommandDeliveredInShellArgs,
      windowsFallbackAttempts,
      launchWslContext
    }
  }
  const resolved = resolveWindowsShellLaunchArgs(
    shellPath,
    options.cwd,
    options.defaultCwd,
    launchWslContext,
    options.command
  )
  return {
    shellPath,
    shellArgs: resolved.shellArgs,
    effectiveCwd: resolved.effectiveCwd,
    validationCwd: resolved.validationCwd,
    startupCommandDeliveredInShellArgs: resolved.startupCommandDeliveredInShellArgs === true,
    windowsFallbackAttempts,
    launchWslContext
  }
}
