import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { join, win32 as pathWin32 } from 'node:path'
import type { SFTPWrapper } from 'ssh2'
import type { AgentHookInstallState, AgentHookInstallStatus } from '../../shared/agent-hook-types'
import {
  buildManagedCommandHook,
  createManagedCommandMatcher,
  buildWindowsAgentHookCurlPostCommand,
  getSharedManagedScriptPath,
  hookDefinitionHasManagedCommand,
  MANAGED_HOOK_TIMEOUT_SECONDS,
  readHooksJson,
  readHooksJsonWithRaw,
  removeManagedCommands,
  wrapPosixHookCommand,
  wrapWindowsCmdHookCommand,
  writeHooksJson,
  writeManagedScript,
  type HookDefinition
} from '../agent-hooks/installer-utils'
import { resolveHooksJsonWritePath } from '../agent-hooks/hook-config-write-path'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import {
  readHooksJsonRemote,
  readTextFileRemote,
  writeHooksJsonRemote,
  writeManagedScriptRemote,
  writeTextFileRemoteAtomic
} from '../agent-hooks/installer-utils-remote'
import {
  buildPosixHookPayloadCapture,
  buildWindowsHookEnvironmentGuardLines,
  buildWindowsHookStdinDrainEpilogue,
  POSIX_HOOK_STDIN_DRAIN_COMMAND
} from '../agent-hooks/hook-stdin-contract'
import {
  codexHookSourcePathsEqual,
  computeTrustKey,
  computeTrustedHash,
  escapeTomlString,
  getCodexExplicitHomeHookSourcePath,
  normalizeCodexHookSourcePath,
  normalizeCodexProjectPathForLookup,
  normalizeHookTrustKeyForLookup,
  parseTrustKey,
  readHookTrustEntries,
  removeHookTrustEntries,
  upsertHookTrustEntriesInContent,
  upsertHookTrustEntries,
  writeConfigAtomically,
  type CodexEventLabel,
  type CodexHookTrustState,
  type CodexTrustEntry
} from './config-toml-trust'
import { getOrcaManagedCodexHomePath, getSystemCodexHomePath } from './codex-home-paths'
import { syncSystemConfigIntoManagedCodexHome } from './codex-config-mirror'
import {
  createCodexWslRuntimeHookInstallPlan,
  type CodexWslRuntimeHookInstallPlan,
  type CodexWslRuntimeHookTarget,
  type WslCanonicalPathSettlement
} from './codex-wsl-hook-install-plan'
import {
  CODEX_HOOK_EVENT_LABEL,
  createCodexHookTrustEntry,
  getCodexHookTrustSignature,
  getCodexManagedScriptFileName
} from './codex-hook-identity'
import {
  promoteCodexRuntimeHookApprovalsToSystem,
  snapshotCodexRuntimeHookTrustProvenance
} from './hook-trust-promotion'
import { grantManagedCodexHookTrust } from './codex-hook-trust-grant'
import { readCurrentCodexTrustGrantLedgerHome } from './codex-trust-grant-host'
import {
  getCodexLedgerTrustedHash,
  readCodexTrustGrantLedgerHomeForReconciliation,
  removeCodexManagedHookTrustEntries,
  removeStaleWslCodexManagedHookTrustEntries
} from './codex-managed-trust-reconciliation'
import type { CodexTrustGrantLedgerHome } from './codex-trust-grant-ledger'
import { mutateRealHomeHooksPreservingUserTrust } from './codex-user-hook-trust-rebase'
import {
  CODEX_EVENT_LABEL,
  CODEX_EVENTS,
  CODEX_MANAGED_EVENT_LABELS,
  collectManagedTrustEntries,
  getConfigPath,
  getLegacyCodexProfileTomlPath,
  getManagedCommand,
  getManagedScriptPath,
  getSystemConfigPath,
  getSystemCodexConfigTomlPath,
  isSystemCodexHomeHookSweepSuppressed,
  removeSelfComputedMatchingTrustEntries,
  wrapReadablePosixHookCommand,
  writeCodexHooksJson
} from './codex-hook-support-a'

const LEGACY_ORCA_PROFILE_BLOCK_START = '# BEGIN ORCA AGENT STATUS HOOKS'
const LEGACY_ORCA_PROFILE_BLOCK_END = '# END ORCA AGENT STATUS HOOKS'

export function removeSystemManagedHookTrustEntries(systemHomePath: string, hooksJsonPath: string): void {
  removeCodexManagedHookTrustEntries({
    tomlPath: getSystemCodexConfigTomlPath(),
    runtimeHomePath: systemHomePath,
    sourcePath: hooksJsonPath,
    command: getManagedCommand(getManagedScriptPath()),
    managedEventLabels: CODEX_MANAGED_EVENT_LABELS,
    timeoutSec: MANAGED_HOOK_TIMEOUT_SECONDS
  })
}
export function cleanupLegacySystemManagedHooks(): void {
  if (isSystemCodexHomeHookSweepSuppressed()) {
    return
  }
  const legacyConfigPath = getSystemConfigPath()
  const runtimeConfigPath = getConfigPath()
  if (legacyConfigPath === runtimeConfigPath) {
    return
  }

  const systemHomePath = getSystemCodexHomePath()
  const hasRecordedRealHomeGrant =
    readCodexTrustGrantLedgerHomeForReconciliation(systemHomePath) !== null
  // Why: the pre-write guard below compares against these bytes; a separate
  // later read would let a concurrent save land between parse and snapshot.
  const { raw: previousRaw, config } = readHooksJsonWithRaw(legacyConfigPath)
  if (!config?.hooks || previousRaw === null) {
    if (hasRecordedRealHomeGrant) {
      removeSystemManagedHookTrustEntries(systemHomePath, legacyConfigPath)
    }
    return
  }

  const isManagedCommand = createManagedCommandMatcher(getCodexManagedScriptFileName())
  const nextHooks = { ...config.hooks }
  const trustEntries: CodexTrustEntry[] = []
  let removedManagedHook = false
  for (const [eventName, definitions] of Object.entries(nextHooks)) {
    if (!Array.isArray(definitions)) {
      continue
    }
    const eventTrustEntries = collectManagedTrustEntries(
      legacyConfigPath,
      eventName,
      definitions,
      isManagedCommand
    )
    // Why: user hook configs can be large; avoid the argument limit from push(...entries).
    for (const entry of eventTrustEntries) {
      trustEntries.push(entry)
    }
    const cleaned = removeManagedCommands(definitions, isManagedCommand)
    removedManagedHook ||= definitions.some((definition) =>
      hookDefinitionHasManagedCommand(definition, isManagedCommand)
    )
    if (cleaned.length === 0) {
      delete nextHooks[eventName]
    } else {
      nextHooks[eventName] = cleaned
    }
  }

  // Why: Codex hooks moved to Orca's managed CODEX_HOME; stale ~/.codex entries would keep external Codex sessions reporting into Orca.
  if (removedManagedHook) {
    // Why: this is the user's system hooks file, not Orca's runtime copy.
    // Remove only stale Orca hook entries and preserve other managers' metadata.
    const hooksWritePath = resolveHooksJsonWritePath(legacyConfigPath)
    const previousMode = statSync(hooksWritePath).mode
    mutateRealHomeHooksPreservingUserTrust({
      sourcePath: legacyConfigPath,
      runtimeHomePath: systemHomePath,
      tomlPath: getSystemCodexConfigTomlPath(),
      beforeHooks: config.hooks,
      afterHooks: nextHooks,
      writeHooks: () => {
        if (
          readFileSync(legacyConfigPath, 'utf-8') !== previousRaw ||
          resolveHooksJsonWritePath(legacyConfigPath) !== hooksWritePath
        ) {
          // Why: the pre-mutation RPC may overlap a user save; downgrade must
          // never replace that newer dotfiles generation with our stale parse.
          throw new Error('System Codex hooks changed during trust repair')
        }
        writeHooksJson(hooksWritePath, { ...config, hooks: nextHooks }, { preserveMode: true })
      },
      restoreHooks: () => writeFileAtomically(hooksWritePath, previousRaw, { mode: previousMode })
    })
    // Why: stale dev/version entries can reference an older managed script
    // path that is not represented by the current grant ledger.
    removeSelfComputedMatchingTrustEntries(getSystemCodexConfigTomlPath(), trustEntries)
  }
  if (removedManagedHook || hasRecordedRealHomeGrant) {
    // Why: the ledger recognizes Codex-computed hashes and remains a retry
    // marker if a prior cleanup removed hooks.json but could not update TOML.
    removeSystemManagedHookTrustEntries(systemHomePath, legacyConfigPath)
  }
}

export function stripLegacyManagedProfileBlock(content: string): string {
  const start = content.indexOf(LEGACY_ORCA_PROFILE_BLOCK_START)
  if (start === -1) {
    return content
  }
  const endMarker = content.indexOf(LEGACY_ORCA_PROFILE_BLOCK_END, start)
  const end = endMarker === -1 ? content.length : endMarker + LEGACY_ORCA_PROFILE_BLOCK_END.length
  const before = content.slice(0, start).replace(/[ \t]*(?:\r?\n)*$/, '')
  const after = content.slice(end).replace(/^(?:\r?\n)+/, '')
  if (!before) {
    return after
  }
  if (!after) {
    return before.endsWith('\n') ? before : `${before}\n`
  }
  return `${before}\n\n${after}`
}

export function cleanupLegacyCodexProfileHooks(): void {
  const profilePath = getLegacyCodexProfileTomlPath()
  if (!existsSync(profilePath)) {
    return
  }

  const existing = readFileSync(profilePath, 'utf-8')
  const next = stripLegacyManagedProfileBlock(existing)
  if (next === existing) {
    return
  }
  // Why: #2778 wrote Orca hooks into a Codex profile file; runtime CODEX_HOME supersedes it, so remove only Orca's marked block.
  if (next.trim().length === 0) {
    unlinkSync(profilePath)
  } else {
    writeConfigAtomically(profilePath, next)
  }
}

export function cleanupLegacyManagedHookRepresentations(): void {
  try {
    cleanupLegacySystemManagedHooks()
    cleanupLegacyCodexProfileHooks()
  } catch (error) {
    console.warn('[codex-hook-service] failed to clean legacy Codex hooks', error)
  }
}

export function removeRuntimeManagedHookTrustEntries(configPath: string): void {
  try {
    removeCodexManagedHookTrustEntries({
      tomlPath: getCodexConfigTomlPath(),
      runtimeHomePath: getOrcaManagedCodexHomePath(),
      sourcePath: configPath,
      command: getManagedCommand(getManagedScriptPath()),
      managedEventLabels: CODEX_MANAGED_EVENT_LABELS,
      timeoutSec: MANAGED_HOOK_TIMEOUT_SECONDS,
      sourceUsesExplicitCodexHome: true
    })
  } catch (error) {
    // Best effort — stale trust is harmless once hooks.json no longer references the hook; log so a programmer error isn't silent.
    console.warn('[codex-hook-service] failed to clean trust entries', error)
  }
}

export function removeWslRuntimeManagedHookTrustEntries(plan: CodexWslRuntimeHookInstallPlan): void {
  try {
    removeCodexManagedHookTrustEntries({
      tomlPath: plan.tomlPath,
      runtimeHomePath: pathWin32.dirname(plan.tomlPath),
      sourcePath: plan.trustConfigPath,
      command: wrapReadablePosixHookCommand(plan.commandScriptPath),
      managedEventLabels: CODEX_MANAGED_EVENT_LABELS,
      timeoutSec: MANAGED_HOOK_TIMEOUT_SECONDS
    })
  } catch (error) {
    // Why: best-effort like host cleanup; stale trust is inert once hooks.json no longer points at us.
    console.warn('[codex-hook-service] failed to clean WSL trust entries', error)
  }
}

export function removeStaleWslRuntimeManagedHookTrustEntries(
  tomlPath: string,
  desiredEntries: readonly CodexTrustEntry[],
  priorLedgerHomes: readonly CodexTrustGrantLedgerHome[] = []
): void {
  removeStaleWslCodexManagedHookTrustEntries({
    tomlPath,
    runtimeHomePath: pathWin32.dirname(tomlPath),
    desiredEntries,
    managedEventLabels: CODEX_MANAGED_EVENT_LABELS,
    timeoutSec: MANAGED_HOOK_TIMEOUT_SECONDS,
    buildManagedCommand: (linuxRuntimeHome) =>
      wrapReadablePosixHookCommand(`${linuxRuntimeHome}/.orca/agent-hooks/codex-hook.sh`),
    priorLedgerHomes
  })
}

export function getManagedScript(target: 'local' | 'posix' = 'local'): string {
  if (target === 'local' && process.platform === 'win32') {
    return [
      '@echo off',
      'setlocal',
      // Why: the endpoint file holds this install's live port/token; sourcing it lets a surviving PTY reach the current server (see claude/hook-service.ts).
      'if defined ORCA_AGENT_HOOK_ENDPOINT if exist "%ORCA_AGENT_HOOK_ENDPOINT%" call "%ORCA_AGENT_HOOK_ENDPOINT%" 2>nul',
      ...buildWindowsHookEnvironmentGuardLines(),
      buildWindowsAgentHookCurlPostCommand('codex'),
      'exit /b 0',
      ...buildWindowsHookStdinDrainEpilogue(),
      ''
    ].join('\r\n')
  }

  return [
    '#!/bin/sh',
    ...buildPosixHookPayloadCapture(),
    // Why: sourcing refreshes PORT/TOKEN/ENV/VERSION from the current Orca so a surviving PTY keeps reporting after a restart (see claude/hook-service.ts).
    'load_hook_endpoint() {',
    '  endpoint_path="$1"',
    '  case "$endpoint_path" in',
    '    *.cmd)',
    // Why: Windows passes endpoint.cmd into WSL via WSLENV; parse only Orca's known assignments since cmd.exe `set` lines aren't shell syntax.
    '      endpoint_cr=$(printf "\\r")',
    '      while IFS= read -r endpoint_line || [ -n "$endpoint_line" ]; do',
    '        endpoint_line=${endpoint_line%"$endpoint_cr"}',
    '        case "$endpoint_line" in',
    '          "set ORCA_AGENT_HOOK_PORT="*) ORCA_AGENT_HOOK_PORT=${endpoint_line#*=} ;;',
    '          "set ORCA_AGENT_HOOK_TOKEN="*) ORCA_AGENT_HOOK_TOKEN=${endpoint_line#*=} ;;',
    '          "set ORCA_AGENT_HOOK_ENV="*) ORCA_AGENT_HOOK_ENV=${endpoint_line#*=} ;;',
    '          "set ORCA_AGENT_HOOK_VERSION="*) ORCA_AGENT_HOOK_VERSION=${endpoint_line#*=} ;;',
    '        esac',
    '      done < "$endpoint_path"',
    '      ;;',
    '    *)',
    '      . "$endpoint_path" 2>/dev/null || :',
    '      ;;',
    '  esac',
    '}',
    'if [ -n "$ORCA_AGENT_HOOK_ENDPOINT" ] && [ -r "$ORCA_AGENT_HOOK_ENDPOINT" ]; then',
    '  load_hook_endpoint "$ORCA_AGENT_HOOK_ENDPOINT"',
    'fi',
    'if [ -z "$ORCA_AGENT_HOOK_PORT" ] || [ -z "$ORCA_AGENT_HOOK_TOKEN" ] || [ -z "$ORCA_PANE_KEY" ]; then',
    '  exit 0',
    'fi',
    'post_codex_hook() {',
    '  curl_bin="$1"',
    '  connect_timeout="${2:-0.5}"',
    '  max_time="${3:-1.5}"',
    // Why: worktreeId embeds a path, so hand-building JSON in shell is unsafe with quotes/newlines; post raw payload plus metadata as form fields instead.
    // Why: pipe payload to curl's stdin (`payload@-`) not an inline arg, so tens-of-KB tool output stays off the command line (EDR false positives).
    '  printf \'%s\' "$payload" | "$curl_bin" -sS -X POST "http://127.0.0.1:${ORCA_AGENT_HOOK_PORT}/hook/codex" \\',
    '    --connect-timeout "$connect_timeout" --max-time "$max_time" \\',
    '    --noproxy "127.0.0.1" \\',
    '    -H "Content-Type: application/x-www-form-urlencoded" \\',
    '    -H "X-Orca-Agent-Hook-Token: ${ORCA_AGENT_HOOK_TOKEN}" \\',
    '    --data-urlencode "paneKey=${ORCA_PANE_KEY}" \\',
    '    --data-urlencode "tabId=${ORCA_TAB_ID}" \\',
    '    --data-urlencode "launchToken=${ORCA_AGENT_LAUNCH_TOKEN}" \\',
    '    --data-urlencode "worktreeId=${ORCA_WORKTREE_ID}" \\',
    '    --data-urlencode "env=${ORCA_AGENT_HOOK_ENV}" \\',
    '    --data-urlencode "version=${ORCA_AGENT_HOOK_VERSION}" \\',
    '    --data-urlencode "payload@-"',
    '}',
    'is_wsl_runtime() {',
    '  [ -n "$WSL_DISTRO_NAME" ] && return 0',
    '  grep -qiE "microsoft|wsl" /proc/sys/kernel/osrelease /proc/version 2>/dev/null',
    '}',
    'if post_codex_hook curl >/dev/null 2>&1; then',
    '  exit 0',
    'fi',
    'if is_wsl_runtime; then',
    '  windows_curl=$(command -v curl.exe 2>/dev/null || true)',
    '  if [ -n "$windows_curl" ] && [ -x "$windows_curl" ]; then',
    '    post_codex_hook "$windows_curl" 3 5 >/dev/null 2>&1 || true',
    '  fi',
    'fi',
    'exit 0',
    ''
  ].join('\n')
}

export function installManagedHooksIntoWslRuntime(
  plan: CodexWslRuntimeHookInstallPlan
): AgentHookInstallStatus {
  const config = readHooksJson(plan.configPath)
  if (!config) {
    return {
      agent: 'codex',
      state: 'error',
      configPath: plan.configPath,
      managedHooksPresent: false,
      detail: 'Could not parse Codex hooks.json'
    }
  }

  const isManagedCommand = createManagedCommandMatcher('codex-hook.sh')
  const command = wrapReadablePosixHookCommand(plan.commandScriptPath)
  const nextHooks = { ...config.hooks }
  const managedEvents = new Set<string>(CODEX_EVENTS)
  for (const [eventName, definitions] of Object.entries(nextHooks)) {
    if (managedEvents.has(eventName) || !Array.isArray(definitions)) {
      continue
    }
    const cleaned = removeManagedCommands(definitions, isManagedCommand)
    if (cleaned.length === 0) {
      delete nextHooks[eventName]
    } else {
      nextHooks[eventName] = cleaned
    }
  }

  const trustEntries: CodexTrustEntry[] = []
  for (const eventName of CODEX_EVENTS) {
    const current = Array.isArray(nextHooks[eventName]) ? nextHooks[eventName] : []
    const cleaned = removeManagedCommands(current, isManagedCommand)
    const definition: HookDefinition = {
      hooks: [buildManagedCommandHook(command)]
    }
    nextHooks[eventName] = [definition, ...cleaned]
    trustEntries.push({
      sourcePath: plan.trustConfigPath,
      eventLabel: CODEX_EVENT_LABEL[eventName],
      groupIndex: 0,
      handlerIndex: 0,
      command,
      timeoutSec: MANAGED_HOOK_TIMEOUT_SECONDS
    })
  }

  config.hooks = nextHooks
  writeManagedScript(plan.scriptPath, getManagedScript('posix'))
  writeCodexHooksJson(plan.configPath, nextHooks)
  try {
    // Why: same grant-then-fallback split as the host install — codex runs
    // inside the distro so the hash authority matches the codex the pane runs.
    const runtimeHomePath = pathWin32.dirname(plan.tomlPath)
    // Why: a successful re-grant replaces the ledger. Keep the previous
    // records long enough to prove ownership of stale canonical-path keys.
    const previousLedgerHome = readCodexTrustGrantLedgerHomeForReconciliation(runtimeHomePath)
    // Why: Codex's verified RPC write must be the final config mutation. A
    // host-side rewrite after verification can race or invalidate that grant.
    removeStaleWslRuntimeManagedHookTrustEntries(
      plan.tomlPath,
      trustEntries,
      previousLedgerHome ? [previousLedgerHome] : []
    )
    const grant = grantManagedCodexHookTrust({
      runtimeHomePath,
      tomlPath: plan.tomlPath,
      managedCommand: command,
      managedEntries: trustEntries,
      host: { kind: 'wsl', distro: plan.wslDistro, linuxRuntimeHome: plan.linuxRuntimeHome },
      telemetryLane: 'managed'
    })
    if (grant.lane === 'fallback') {
      // Why: WSL runtime homes may carry user hook approvals we did not rebuild
      // here; only upsert Orca's entries instead of sweeping the whole source.
      upsertHookTrustEntries(plan.tomlPath, trustEntries)
    }
  } catch (error) {
    return {
      agent: 'codex',
      state: 'error',
      configPath: plan.configPath,
      managedHooksPresent: true,
      detail: `Hooks installed but trust entries could not be written: ${error instanceof Error ? error.message : String(error)}. Run /hooks in Codex to approve.`
    }
  }

  return {
    agent: 'codex',
    state: 'installed',
    configPath: plan.configPath,
    managedHooksPresent: true,
    detail: null
  }
}

export function refreshWslRuntimeUserHooks(plan: CodexWslRuntimeHookInstallPlan): AgentHookInstallStatus {
  const config = readHooksJson(plan.configPath)
  if (!config) {
    return {
      agent: 'codex',
      state: 'error',
      configPath: plan.configPath,
      managedHooksPresent: false,
      detail: 'Could not parse Codex hooks.json'
    }
  }

  const isManagedCommand = createManagedCommandMatcher('codex-hook.sh')
  const nextHooks = { ...config.hooks }
  for (const [eventName, definitions] of Object.entries(nextHooks)) {
    if (!Array.isArray(definitions)) {
      continue
    }
    const cleaned = removeManagedCommands(definitions, isManagedCommand)
    if (cleaned.length === 0) {
      delete nextHooks[eventName]
    } else {
      nextHooks[eventName] = cleaned
    }
  }
  writeCodexHooksJson(plan.configPath, nextHooks)
  removeWslRuntimeManagedHookTrustEntries(plan)
  try {
    // Why: the disabled path may run after the WSL mount root changed, so cleanup can't be scoped to the plan's current source path.
    removeStaleWslRuntimeManagedHookTrustEntries(plan.tomlPath, [])
  } catch (error) {
    console.warn('[codex-hook-service] failed to clean stale WSL trust entries', error)
  }
  return {
    agent: 'codex',
    state: 'not_installed',
    configPath: plan.configPath,
    managedHooksPresent: false,
    detail: null
  }
}

// Why: transport failures preserve last known-good identity; a successful absence probe is strong enough to revoke trust immediately.
export function getWslHookReconciliationAction(args: {
  settlement: WslCanonicalPathSettlement
  isCurrentGeneration: boolean
  installedTrustConfigPath: string | null
  resolvedTrustConfigPath: string | null
  /** Whether the synchronous install for this generation wrote trust. */
  installSucceeded: boolean
}): 'none' | 'remove' | 'reinstall' {
  if (!args.isCurrentGeneration) {
    return 'none'
  }
  if (args.settlement.status === 'missing') {
    // Why: a `missing` directory probe right after a verified install/grant is
    // a false negative — the RPC (or fallback) just wrote and read trust in
    // that home, so it exists. Revoking here would delete the fresh grant the
    // launching pane needs, resurfacing "hooks need review". A genuinely moved
    // home resolves to a different path and takes the `reinstall` branch below.
    return args.installSucceeded ? 'none' : 'remove'
  }
  if (
    args.settlement.status !== 'resolved' ||
    !args.resolvedTrustConfigPath ||
    args.resolvedTrustConfigPath === args.installedTrustConfigPath
  ) {
    return 'none'
  }
  return 'reinstall'
}

// Why: fold only the Windows-case-insensitive portion; a full lowercase would let case-distinct WSL homes share one reconciliation slot.
export function getWslReconciliationKey(runtimeHomePath: string): string {
  return normalizeCodexProjectPathForLookup(runtimeHomePath)
}
