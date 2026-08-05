import { delimiter } from 'node:path'
import type { GlobalSettings, TuiAgent } from '../../shared/types'
import type { NetworkProxySettings } from '../../shared/network-proxy'
import type { CodexAccountSelectionTarget } from '../codex-accounts/runtime-selection'
import type { CodexSessionResumePreparation } from '../codex/codex-session-resume-home'
import type { AgentProviderSessionMetadata } from '../../shared/agent-session-resume'
import type { ClaudeRuntimeAuthPreparation } from '../claude-accounts/runtime-auth-service'
import type { ClaudeAccountSelectionTarget } from '../claude-accounts/runtime-selection'
import { isWslShellName } from '../../shared/local-windows-terminal-runtime'
import { parseWslPath } from '../wsl'
import { isCodexSystemDefaultRealHomeEnabled } from '../codex/codex-real-home-flag'
import { isHostCodexHomeForWsl, isWslCodexHomeForHost } from '../pty/codex-home-wsl-env'
import { getSystemCodexHomePath } from '../codex/codex-home-paths'
import {
  forgetCodexPaneAccount,
  recordCodexPaneAccount
} from '../codex/codex-pane-account-registry'
import { resolveCodexPaneLaunchAccount } from '../codex/codex-pane-launch-account'
import { readShellStartupEnvVar } from '../pty/shell-startup-env'
import type { PiAgentKind } from '../../shared/pi-agent-kind'
import {
  getCommandTokenPathBasename,
  getFirstCommandToken
} from '../../shared/command-token-scanner'
import {
  AGENT_HOOK_RUNTIME_ENV_KEYS,
  CLAUDE_CHILD_SESSION_STAMP_ENV_KEYS
} from './pty-ipc-runtime-host-env-constants'
import { isRemoteAgentHooksEnabled } from '../../shared/agent-hook-relay'

// ─── Host PTY env assembly ──────────────────────────────────────────
// Why: centralize host-local env injections so both spawn paths (local + daemon) get them; implemented twice they drifted, silently breaking daemon PTYs.

export type BuildPtyHostEnvOptions = {
  isPackaged: boolean
  userDataPath: string
  selectedCodexHomePath: string | null
  skipCodexHomeEnv?: boolean
  /** System-default real-home routing (flag ON): inject no managed CODEX_HOME,
   *  and strip only an inherited Orca-owned override so nested Orca panes do not
   *  leak the parent's managed home. A user-set CODEX_HOME is preserved. */
  stripInheritedOrcaCodexHome?: boolean
  /** Launch command the renderer chose (e.g. 'pi', 'omp', 'claude'); resolves the per-agent
   *  extension target for Pi/OMP. Undefined for bare shells → defaults to Pi. NEVER infer from
   *  disk presence (cross-agent shadowing when both dirs exist). */
  launchCommand?: string
  /** Trusted agent identity for wrapped commands that cannot be recognized from text. */
  launchAgent?: TuiAgent
  shellPath?: string
  isWsl?: boolean
  /** Distro for WSL spawns (null = Windows default distro); drives the WSL hook relay + endpoint repoint. Only read when isWsl. */
  wslDistro?: string | null
  agentStatusHooksEnabled: boolean
  networkProxySettings?: NetworkProxySettings
  /** Keep indexed Git config off the sparse daemon wire; the daemon appends guard entries after merging its inherited env. */
  deferGitConfigGuardToDaemon?: boolean
}

export function readInheritedPath(baseEnv: Record<string, string>): string {
  return baseEnv.PATH ?? baseEnv.Path ?? process.env.PATH ?? process.env.Path ?? ''
}

export function firstPathEntry(pathValue: string | undefined): string | null {
  const first = pathValue?.split(delimiter).find((entry) => entry.trim().length > 0)
  return first ?? null
}

export function promoteAgentTeamsShimPath(
  env: Record<string, string> | undefined,
  requestedPath: string | undefined
): void {
  if (!env?.ORCA_AGENT_TEAMS_TEAM_ID) {
    return
  }
  const shimPath = firstPathEntry(requestedPath)
  if (!shimPath) {
    return
  }
  const currentPathKey = env.PATH !== undefined || env.Path === undefined ? 'PATH' : 'Path'
  const currentPath = env[currentPathKey] ?? ''
  const remaining = currentPath
    .split(delimiter)
    .filter((entry) => entry.length > 0 && entry !== shimPath)
  // Why: host env injection prepends Orca's shims; Claude Agent Teams must still resolve our fake tmux before any real tmux.
  env[currentPathKey] = [shimPath, ...remaining].join(delimiter)
}

export function deleteRequestedEnvKeys(
  env: Record<string, string> | undefined,
  keys: string[] | undefined
): void {
  if (!env || !keys) {
    return
  }
  for (const key of keys) {
    delete env[key]
  }
}

export function shouldSkipCodexHomeEnvForWindowsShell(
  shellPath: string | undefined,
  cwd: string | undefined
): boolean {
  return isWslShellName(shellPath) || (typeof cwd === 'string' && parseWslPath(cwd) !== null)
}

// Why: with the real-home flag ON, a host system-default launch resolves to a
// null managed home. Signal the env builder to strip a nested-Orca-inherited
// override instead of injecting one, so Codex runs on the user's own ~/.codex.
export function shouldStripInheritedOrcaCodexHome(args: {
  target: CodexAccountSelectionTarget
  selectedCodexHomePath: string | null
  skipCodexHomeEnv: boolean
  settings: GlobalSettings | undefined
}): boolean {
  return (
    args.target.runtime === 'host' &&
    args.selectedCodexHomePath === null &&
    !args.skipCodexHomeEnv &&
    isCodexSystemDefaultRealHomeEnabled()
  )
}

export const CODEX_HOME_ENV_KEYS = ['CODEX_HOME', 'ORCA_CODEX_HOME'] as const

export function stripRemotePaneEnvWhenHooksDisabled(
  connectionId: string | null | undefined,
  env: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!connectionId || isRemoteAgentHooksEnabled()) {
    return env
  }
  if (
    !env ||
    (!('ORCA_PANE_KEY' in env) &&
      !('ORCA_TAB_ID' in env) &&
      !('ORCA_WORKTREE_ID' in env) &&
      !('ORCA_AGENT_LAUNCH_TOKEN' in env))
  ) {
    return env
  }
  const stripped = { ...env }
  delete stripped.ORCA_PANE_KEY
  delete stripped.ORCA_TAB_ID
  delete stripped.ORCA_WORKTREE_ID
  delete stripped.ORCA_AGENT_LAUNCH_TOKEN
  return stripped
}

// Why: system-default real-home routing runs Codex on the user's own ~/.codex.
// Nested Orca panes inherit the parent's Orca-owned override; strip only that
// (CODEX_HOME matching Orca's private ORCA_CODEX_HOME marker), and always drop
// the marker so a shell-ready wrapper cannot restore the managed home. A
// user-set CODEX_HOME with no Orca marker is preserved untouched (see #8606).
export function stripInheritedOrcaCodexHomeOverride(baseEnv: Record<string, string>): void {
  for (const key of getLocalOrcaCodexHomeEnvKeysToDelete(baseEnv)) {
    delete baseEnv[key]
  }
}

// Why: in-process spawns share main's inherited environment, so equality with
// the private marker is authoritative here. Persistent daemons compare locally.
export function getLocalOrcaCodexHomeEnvKeysToDelete(env: Record<string, string>): string[] {
  const inheritedOrcaOverride = env.ORCA_CODEX_HOME ?? process.env.ORCA_CODEX_HOME
  const inheritedCodexHome = env.CODEX_HOME ?? process.env.CODEX_HOME
  const keysToDelete = ['ORCA_CODEX_HOME']
  if (inheritedOrcaOverride && inheritedCodexHome === inheritedOrcaOverride) {
    keysToDelete.push('CODEX_HOME')
  }
  return keysToDelete
}

export type GetSelectedCodexHomePath = (
  target?: CodexAccountSelectionTarget,
  launchEnv?: NodeJS.ProcessEnv,
  launchContext?: { workspacePath?: string; launchAgent?: TuiAgent }
) => string | null
export type PrepareCodexSessionResume = (args: {
  providerSession: AgentProviderSessionMetadata
  target: CodexAccountSelectionTarget
  launchEnv?: NodeJS.ProcessEnv
  workspacePath?: string
}) => Promise<CodexSessionResumePreparation | null>
export type PrepareClaudeAuth = (
  target?: ClaudeAccountSelectionTarget
) => Promise<ClaudeRuntimeAuthPreparation>

export function getCodexSelectionTargetForPty(
  shellPath: string | undefined,
  cwd: string | undefined,
  wslDistro?: string | null
): CodexAccountSelectionTarget {
  const wslPath = typeof cwd === 'string' ? parseWslPath(cwd) : null
  if (isWslShellName(shellPath) || wslPath) {
    return { runtime: 'wsl', wslDistro: wslPath?.distro ?? wslDistro ?? null }
  }
  return { runtime: 'host' }
}

export function getCompatibleSelectedCodexHomePath(
  target: CodexAccountSelectionTarget,
  selectedCodexHomePath: string | null
): string | null {
  if (!selectedCodexHomePath) {
    return null
  }
  const wslInfo = parseWslPath(selectedCodexHomePath)
  if (target.runtime === 'wsl') {
    return wslInfo || !isHostCodexHomeForWsl(selectedCodexHomePath) ? selectedCodexHomePath : null
  }
  return wslInfo || (process.platform === 'win32' && isWslCodexHomeForHost(selectedCodexHomePath))
    ? null
    : selectedCodexHomePath
}

// Why: CODEX_HOME is fixed in a shell's environment at spawn and the daemon
// keeps that shell alive across app restarts, so the launch account is the only
// way to tell later that a pane still runs Codex as the previously selected
// account. A reattach inherits that baked environment rather than choosing one,
// so re-recording it under the current selection would erase the very evidence
// that the pane is stale.
export function recordCodexPaneAccountForSpawn(args: {
  ptyId: string | undefined
  isDaemonHostSpawn: boolean
  isReattach: boolean
  pinnedByResume: boolean
  launchCodexHomePath: string | null
  target: CodexAccountSelectionTarget
  settings: GlobalSettings | undefined
}): void {
  if (!args.ptyId || !args.isDaemonHostSpawn || args.isReattach) {
    return
  }
  const record = args.settings
    ? resolveCodexPaneLaunchAccount({
        pinnedByResume: args.pinnedByResume,
        launchCodexHomePath: args.launchCodexHomePath,
        systemCodexHomePath: getSystemCodexHomePath(),
        settings: args.settings,
        target: args.target
      })
    : null
  if (!record) {
    forgetCodexPaneAccount(args.ptyId)
    return
  }
  recordCodexPaneAccount(args.ptyId, record)
}

export function readEnvWithProcessFallback(
  baseEnv: Record<string, string>,
  key: string
): string | undefined {
  return baseEnv[key] ?? process.env[key]
}

export function resolvePiAgentSourceDir(
  baseEnv: Record<string, string>,
  kind: PiAgentKind
): string | undefined {
  const sourceKey = kind === 'omp' ? 'ORCA_OMP_SOURCE_AGENT_DIR' : 'ORCA_PI_SOURCE_AGENT_DIR'
  const overlayKey = kind === 'omp' ? 'ORCA_OMP_CODING_AGENT_DIR' : 'ORCA_PI_CODING_AGENT_DIR'
  const otherOverlayKey = kind === 'omp' ? 'ORCA_PI_CODING_AGENT_DIR' : 'ORCA_OMP_CODING_AGENT_DIR'

  const sourceDir = readEnvWithProcessFallback(baseEnv, sourceKey)
  if (sourceDir) {
    return sourceDir
  }

  const publicDir = readEnvWithProcessFallback(baseEnv, 'PI_CODING_AGENT_DIR')
  const ownOverlayDir = readEnvWithProcessFallback(baseEnv, overlayKey)
  const otherOverlayDir = readEnvWithProcessFallback(baseEnv, otherOverlayKey)
  // Why: if PI_CODING_AGENT_DIR is a restored Orca overlay with no source shadow, remirroring leaks another agent's overlay tree; fall through to defaults.
  if (publicDir && publicDir !== ownOverlayDir && publicDir !== otherOverlayDir) {
    return publicDir
  }

  return readShellStartupEnvVar(
    'PI_CODING_AGENT_DIR',
    baseEnv.HOME ?? process.env.HOME,
    baseEnv.SHELL ?? process.env.SHELL
  )
}

export function resolveScopedPiAgentSourceDir(
  baseEnv: Record<string, string>,
  kind: PiAgentKind
): string | undefined {
  const sourceKey = kind === 'omp' ? 'ORCA_OMP_SOURCE_AGENT_DIR' : 'ORCA_PI_SOURCE_AGENT_DIR'
  return readEnvWithProcessFallback(baseEnv, sourceKey)
}

export function clearPiAgentShadowEnv(baseEnv: Record<string, string>, kind: PiAgentKind): void {
  if (kind === 'omp') {
    delete baseEnv.ORCA_OMP_CODING_AGENT_DIR
    delete baseEnv.ORCA_OMP_SOURCE_AGENT_DIR
    delete baseEnv.ORCA_OMP_STATUS_EXTENSION
    return
  }
  delete baseEnv.ORCA_PI_CODING_AGENT_DIR
  delete baseEnv.ORCA_PI_SOURCE_AGENT_DIR
}

export function exposePiManagedExtensionEnv(
  baseEnv: Record<string, string>,
  kind: PiAgentKind,
  managedEnv: Record<string, string>
): void {
  if (kind === 'omp') {
    delete baseEnv.ORCA_OMP_CODING_AGENT_DIR
    if (managedEnv.ORCA_OMP_SOURCE_AGENT_DIR) {
      baseEnv.ORCA_OMP_SOURCE_AGENT_DIR = managedEnv.ORCA_OMP_SOURCE_AGENT_DIR
    } else {
      delete baseEnv.ORCA_OMP_SOURCE_AGENT_DIR
    }
    if (managedEnv.ORCA_OMP_STATUS_EXTENSION) {
      baseEnv.ORCA_OMP_STATUS_EXTENSION = managedEnv.ORCA_OMP_STATUS_EXTENSION
    } else {
      delete baseEnv.ORCA_OMP_STATUS_EXTENSION
    }
    return
  }
  delete baseEnv.ORCA_PI_CODING_AGENT_DIR
  if (managedEnv.ORCA_PI_SOURCE_AGENT_DIR) {
    baseEnv.ORCA_PI_SOURCE_AGENT_DIR = managedEnv.ORCA_PI_SOURCE_AGENT_DIR
  } else {
    delete baseEnv.ORCA_PI_SOURCE_AGENT_DIR
  }
}

// Why: variadic because a nested call per source made intermediate `string[] | undefined` collide with the parameter type.
export function mergePtyEnvDeletions(
  existingKeys: string[] | undefined,
  ...additionalKeyGroups: readonly (readonly string[])[]
): string[] | undefined {
  if (!existingKeys && additionalKeyGroups.every((keys) => keys.length === 0)) {
    return undefined
  }
  return Array.from(new Set([...(existingKeys ?? []), ...additionalKeyGroups.flat()]))
}

export function removeCodexHomeDeletionRequests(keys: string[] | undefined): string[] | undefined {
  // Why: resume provenance is launch-authoritative; late deletions must not fall back to the current account.
  const filtered = keys?.filter((key) => key !== 'CODEX_HOME' && key !== 'ORCA_CODEX_HOME')
  return filtered?.length ? filtered : undefined
}

export function getInheritedAgentHookEnvKeysToDelete(
  spawnEnv: Record<string, string> | undefined
): string[] {
  const env = spawnEnv ?? {}
  // Why: providers merge process.env after cleanup; delete stale hook keys without dropping fresh coordinates buildPtyHostEnv set.
  return AGENT_HOOK_RUNTIME_ENV_KEYS.filter((key) => env[key] === undefined)
}

export function getInheritedClaudeSessionStampEnvKeysToDelete(
  spawnEnv: Record<string, string> | undefined
): string[] {
  const env = spawnEnv ?? {}
  // Why: strip only values inherited from the pty host; a caller that explicitly
  // provides a stamp (deliberately spawning a nested Claude child) keeps it.
  return CLAUDE_CHILD_SESSION_STAMP_ENV_KEYS.filter((key) => env[key] === undefined)
}

// Why: a nested terminal can inherit prior OpenCode/Pi/OMP overlay env; restore the user's recorded source dir, else strip only Orca-owned values.
export function restoreOrStripOverlayEnv(
  baseEnv: Record<string, string>,
  keys: {
    primary: string
    overlay: string
    source: string
  }
): void {
  const sourceValue = baseEnv[keys.source] ?? process.env[keys.source]
  const overlayValue = baseEnv[keys.overlay] ?? process.env[keys.overlay]
  if (sourceValue) {
    baseEnv[keys.primary] = sourceValue
  } else if (overlayValue && baseEnv[keys.primary] === overlayValue) {
    delete baseEnv[keys.primary]
  }
  delete baseEnv[keys.overlay]
  delete baseEnv[keys.source]
}

export function isMimoLaunchCommand(launchCommand: string | undefined): boolean {
  const binary = getCommandTokenPathBasename(getFirstCommandToken(launchCommand ?? ''))
    .toLowerCase()
    .replace(/\.(?:cmd|exe|sh)$/, '')
  return binary === 'mimo'
}

export function resolveMimocodeSourceHome(baseEnv: Record<string, string>): string | undefined {
  const sourceHome = baseEnv.ORCA_MIMOCODE_SOURCE_HOME ?? process.env.ORCA_MIMOCODE_SOURCE_HOME
  if (sourceHome) {
    return sourceHome
  }
  const configHome = baseEnv.MIMOCODE_HOME ?? process.env.MIMOCODE_HOME
  const orcaHome = baseEnv.ORCA_MIMOCODE_HOME ?? process.env.ORCA_MIMOCODE_HOME
  if (configHome && orcaHome && configHome === orcaHome) {
    return undefined
  }
  return configHome
}

export function resolveOpenCodeSourceConfigDir(
  baseEnv: Record<string, string>
): string | undefined {
  const sourceDir =
    baseEnv.ORCA_OPENCODE_SOURCE_CONFIG_DIR ?? process.env.ORCA_OPENCODE_SOURCE_CONFIG_DIR
  if (sourceDir) {
    return sourceDir
  }

  const configDir = baseEnv.OPENCODE_CONFIG_DIR ?? process.env.OPENCODE_CONFIG_DIR
  const orcaConfigDir = baseEnv.ORCA_OPENCODE_CONFIG_DIR ?? process.env.ORCA_OPENCODE_CONFIG_DIR
  // Why: with no recorded source dir, an inherited OPENCODE_CONFIG_DIR is Orca-owned, not user config; treating it as user config makes child Orcas mirror the hook dir.
  if (configDir && orcaConfigDir && configDir === orcaConfigDir) {
    return undefined
  }

  return (
    configDir ??
    readShellStartupEnvVar(
      'OPENCODE_CONFIG_DIR',
      baseEnv.HOME ?? process.env.HOME,
      baseEnv.SHELL ?? process.env.SHELL
    )
  )
}

/**
 * Mutates `baseEnv` in place with all host-local PTY env vars and returns it.
 *
 * Do NOT call when `args.connectionId` is set (SSH): every injection is host-loopback
 * or references local filesystem paths meaningless to a remote shell.
 */
