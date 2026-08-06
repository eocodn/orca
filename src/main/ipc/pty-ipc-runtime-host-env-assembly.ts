import { join, delimiter } from 'node:path'
import { applyTerminalGitCredentialPromptGuard } from './terminal-git-credential-guard'
import { ensureLinuxTerminalOrcaCliShimDir } from '../cli/linux-terminal-orca-cli-shim'
import { buildConfiguredProxyEnv } from '../../shared/network-proxy'
import { resolveSetupAgentSequenceLaunchCommand } from '../../shared/setup-agent-sequencing'
import { mergePersistedWindowsPath } from '../pty/windows-environment-path'
import {
  RETIRED_TERMINAL_ATTRIBUTION_ENV_KEYS,
  type BuildPtyHostEnvOptions
} from './pty-ipc-runtime-host-env-foundation'
import { AGENT_HOOK_RUNTIME_ENV_KEYS } from './pty-ipc-runtime-host-env-constants'
import { stripInheritedOrcaCodexHomeOverride } from './pty-ipc-runtime-host-env-foundation'

const RETIRED_AGENT_OVERLAY_ENV_KEYS = [
  'ORCA_OPENCODE_CONFIG_DIR',
  'ORCA_OPENCODE_SOURCE_CONFIG_DIR',
  'ORCA_MIMOCODE_HOME',
  'ORCA_MIMOCODE_SOURCE_HOME',
  'ORCA_PI_CODING_AGENT_DIR',
  'ORCA_PI_SOURCE_AGENT_DIR',
  'ORCA_OMP_CODING_AGENT_DIR',
  'ORCA_OMP_SOURCE_AGENT_DIR',
  'ORCA_OMP_STATUS_EXTENSION',
  'ORCA_WSL_HOOK_RELAY_VERSION',
  'ORCA_WSL_HOOK_INSTANCE'
] as const

export function buildPtyHostEnv(
  id: string,
  baseEnv: Record<string, string>,
  opts: BuildPtyHostEnvOptions
): Record<string, string> {
  mergePersistedWindowsPath(baseEnv)
  Object.assign(baseEnv, buildConfiguredProxyEnv(opts.networkProxySettings))

  for (const key of RETIRED_TERMINAL_ATTRIBUTION_ENV_KEYS) {
    delete baseEnv[key]
  }
  // Managed hooks and provider overlays are retired; never leak inherited
  // coordinates into a new PTY, while preserving the user's unprefixed env.
  for (const key of [...AGENT_HOOK_RUNTIME_ENV_KEYS, ...RETIRED_AGENT_OVERLAY_ENV_KEYS]) {
    delete baseEnv[key]
  }

  const launchCommandHint = resolveSetupAgentSequenceLaunchCommand(baseEnv, opts.launchCommand)

  // Why: unattended agents must fail instead of looping on OS credential prompts; user terminals keep normal Git behavior.
  applyTerminalGitCredentialPromptGuard(baseEnv, {
    launchCommand: launchCommandHint,
    isUnattended: opts.launchAgent !== undefined,
    deferGitConfigGuardToHost: opts.deferGitConfigGuardToDaemon
  })

  // Why: keep the Codex home override PTY-scoped so dev/prod Orcas don't share hooks through ~/.codex.
  if (opts.skipCodexHomeEnv) {
    delete baseEnv.CODEX_HOME
    delete baseEnv.ORCA_CODEX_HOME
  } else if (opts.selectedCodexHomePath) {
    baseEnv.CODEX_HOME = opts.selectedCodexHomePath
    // Why: user startup files may re-export CODEX_HOME; shell-ready wrappers restore this runtime home before Codex launches.
    baseEnv.ORCA_CODEX_HOME = opts.selectedCodexHomePath
  } else if (opts.stripInheritedOrcaCodexHome) {
    stripInheritedOrcaCodexHomeOverride(baseEnv)
  }

  // Why: WSL shells need the managed userData root for shell-ready wrappers; dev-mode terminals need the same export so `orca` targets the live dev instance.
  if (opts.isWsl) {
    baseEnv.ORCA_USER_DATA_PATH = opts.userDataPath
    // Why: managed WSL registration uses `orca-ide`; exposing that literal scopes agent guidance to WSL without a bare-orca shim.
    baseEnv.ORCA_CLI_COMMAND = opts.isPackaged ? 'orca-ide' : 'orca-dev'
  } else {
    if (!opts.isPackaged) {
      baseEnv.ORCA_USER_DATA_PATH ??= opts.userDataPath
    }
    delete baseEnv.ORCA_CLI_COMMAND
  }
  // Why: dev mode needs the launcher PATH override so `orca` resolves to the dev build instead of the production binary at /usr/local/bin/orca.
  if (!opts.isPackaged) {
    const devCliBin = join(opts.userDataPath, 'cli', 'bin')
    const inheritedPath = readInheritedPath(baseEnv)
    // Why: an empty PATH segment resolves as `.` in some shells (commands run from cwd); avoid a trailing delimiter.
    baseEnv.PATH = inheritedPath ? `${devCliBin}${delimiter}${inheritedPath}` : devCliBin
  } else if (process.platform === 'linux') {
    // Why: bare-`orca` shim scoped to Orca PTYs — Linux CLI installs as `orca-ide` to avoid shadowing GNOME's /usr/bin/orca screen reader (stablyai/orca#7904).
    const shimDir = ensureLinuxTerminalOrcaCliShimDir({ userDataPath: opts.userDataPath })
    if (shimDir) {
      const inheritedEntries = readInheritedPath(baseEnv)
        .split(delimiter)
        .filter((entry) => entry.length > 0 && entry !== shimDir)
      baseEnv.PATH = [shimDir, ...inheritedEntries].join(delimiter)
    }
  }

  return baseEnv
}
