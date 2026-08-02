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
import * as supportA from './codex-hook-support-a'
import * as supportB from './codex-hook-support-b'
import type { AgentHookInstallStatus } from '../../shared/agent-hook-types'

const {
  getConfigPath,\n  writeCodexHooksJson,\n  getCodexConfigTomlPath,\n  getManagedScriptPath,\n  getManagedCommand,\n  getCodexManagedHookInstallMaterial,\n  setSystemCodexHomeHookSweepSuppressed,\n  wrapReadablePosixHookCommand,\n  getSystemConfigPath,\n  getSystemCodexConfigTomlPath,\n  getLegacyCodexProfileTomlPath,\n  collectManagedTrustEntries,\n  removeSelfComputedMatchingTrustEntries,\n  removeStaleRuntimeHookTrustEntries,\n  commandUsesCodexPluginOnlyPlaceholder,\n  removeCodexPluginEnvironmentCommands,\n  getRuntimeHooksWithSystemUserHooks,\n  getTrustedSystemUserHookSignatures,\n  resolveTrustedSystemHookState,\n  getTrustedSystemHookHashesByEvent,\n  collectMirroredRuntimeUserHookTrustEntries,\n  moveMirroredRuntimeUserTrustAfterManagedStatusHook,\n  escapeRegex,\n  buildHookTrustHeaderKeyPattern,\n  applyMirroredRuntimeUserHookTrustStates,\n  dedupeHookDefinitions,\n  CODEX_EVENTS,\n  CODEX_EVENT_LABEL,\n  CODEX_MANAGED_EVENT_LABELS,\n  CODEX_PLUGIN_ONLY_HOOK_PLACEHOLDERS
} = supportA
const {
  removeSystemManagedHookTrustEntries,\n  cleanupLegacySystemManagedHooks,\n  stripLegacyManagedProfileBlock,\n  cleanupLegacyCodexProfileHooks,\n  cleanupLegacyManagedHookRepresentations,\n  removeRuntimeManagedHookTrustEntries,\n  removeWslRuntimeManagedHookTrustEntries,\n  removeStaleWslRuntimeManagedHookTrustEntries,\n  getManagedScript,\n  installManagedHooksIntoWslRuntime,\n  refreshWslRuntimeUserHooks,\n  getWslHookReconciliationAction,\n  getWslReconciliationKey
} = supportB

export class CodexHookService {
  private readonly wslReconciliationGeneration = new Map<string, number>()

  private supersedeWslReconciliation(runtimeHomePath: string | null | undefined): number {
    if (!runtimeHomePath) {
      return 0
    }
    const key = getWslReconciliationKey(runtimeHomePath)
    const generation = (this.wslReconciliationGeneration.get(key) ?? 0) + 1
    this.wslReconciliationGeneration.set(key, generation)
    return generation
  }

  installForRuntimeHome(
    runtimeHomePath: string | null | undefined,
    target?: CodexWslRuntimeHookTarget
  ): AgentHookInstallStatus | null {
    const generation = this.supersedeWslReconciliation(runtimeHomePath)
    let installedTrustConfigPath: string | null = null
    // Why: JS is single-threaded, so the synchronous install below finishes
    // before any async `wsl.exe` settlement callback runs — this flag is
    // always set by the time the callback reads it.
    let installSucceeded = false
    const onCanonicalPathSettled = (settlement: WslCanonicalPathSettlement): void => {
      if (!runtimeHomePath) {
        return
      }
      const key = getWslReconciliationKey(runtimeHomePath)
      const resolvedPlan =
        settlement.status === 'resolved'
          ? createCodexWslRuntimeHookInstallPlan(
              runtimeHomePath,
              target,
              () => settlement.canonicalPath
            )
          : null
      const action = getWslHookReconciliationAction({
        settlement,
        isCurrentGeneration: this.wslReconciliationGeneration.get(key) === generation,
        installedTrustConfigPath,
        resolvedTrustConfigPath: resolvedPlan?.trustConfigPath ?? null,
        installSucceeded
      })
      if (action === 'none') {
        return
      }
      if (action === 'remove') {
        try {
          removeStaleWslRuntimeManagedHookTrustEntries(
            pathWin32.join(runtimeHomePath, 'config.toml'),
            []
          )
        } catch (error) {
          console.warn('[codex-hook-service] failed to revoke stale WSL hook trust', error)
        }
        return
      }
      if (!resolvedPlan) {
        return
      }
      const status = installManagedHooksIntoWslRuntime(resolvedPlan)
      if (status.state === 'error') {
        console.warn('[codex-hook-service] failed to reconcile WSL hook path', status.detail)
        return
      }
      installedTrustConfigPath = resolvedPlan.trustConfigPath
      installSucceeded = status.state === 'installed'
    }
    const wslPlan = createCodexWslRuntimeHookInstallPlan(
      runtimeHomePath,
      target,
      undefined,
      onCanonicalPathSettled
    )
    installedTrustConfigPath = wslPlan?.trustConfigPath ?? null
    const status = wslPlan ? installManagedHooksIntoWslRuntime(wslPlan) : null
    installSucceeded = status?.state === 'installed'
    return status
  }

  refreshRuntimeUserHooksForRuntimeHome(
    runtimeHomePath: string | null | undefined,
    target?: CodexWslRuntimeHookTarget
  ): AgentHookInstallStatus | null {
    this.supersedeWslReconciliation(runtimeHomePath)
    const wslPlan = createCodexWslRuntimeHookInstallPlan(runtimeHomePath, target)
    return wslPlan ? refreshWslRuntimeUserHooks(wslPlan) : null
  }

  getStatus(runtimeHomePath: string = getOrcaManagedCodexHomePath()): AgentHookInstallStatus {
    return this.getStatusAfterInstall(null, runtimeHomePath)
  }

  private getStatusAfterInstall(
    recentGrantEntries: readonly CodexTrustEntry[] | null,
    runtimeHomePath: string = getOrcaManagedCodexHomePath()
  ): AgentHookInstallStatus {
    const configPath = getConfigPath(runtimeHomePath)
    const scriptPath = getManagedScriptPath()
    const config = readHooksJson(configPath)
    if (!config) {
      return {
        agent: 'codex',
        state: 'error',
        configPath,
        managedHooksPresent: false,
        detail: 'Could not parse Codex hooks.json'
      }
    }

    // Why: Codex 0.129+ silently drops untrusted hooks, so report `partial` when managed events OR their trust entries are missing/stale.
    const command = getManagedCommand(scriptPath)
    const tomlPath = getCodexConfigTomlPath(runtimeHomePath)
    // Why: an unreadable config.toml (EACCES/EIO) is distinct from "file
    // absent" (which returns an empty Map without throwing). Hooks.json may
    // still be fine, so report partial with a specific reason rather than
    // collapsing to a generic error or masking it as universally-stale trust.
    let trustEntries: Map<string, CodexHookTrustState>
    let trustReadError: string | null = null
    try {
      trustEntries = readHookTrustEntries(tomlPath)
    } catch (error) {
      trustEntries = new Map()
      trustReadError = error instanceof Error ? error.message : String(error)
    }
    // Why: RPC-granted entries store Codex's own hash, which is authoritative
    // even when it differs from computeTrustedHash — that difference is the
    // drift bug class this lane exists to absorb, not a stale entry.
    // Why: install() already resolved the binary and either verified Codex's
    // hashes or wrote fallback hashes. Re-resolving PATH here doubles sync launch work.
    const ledgerHome =
      recentGrantEntries === null
        ? readCurrentCodexTrustGrantLedgerHome(runtimeHomePath, { kind: 'native' })
        : null
    const recentGrantHashes = new Map<string, { signature: string; trustedHash: string }>()
    for (const entry of recentGrantEntries ?? []) {
      if (entry.trustedHash) {
        recentGrantHashes.set(normalizeHookTrustKeyForLookup(computeTrustKey(entry)), {
          signature: getCodexHookTrustSignature(entry),
          trustedHash: entry.trustedHash
        })
      }
    }

    const missing: string[] = []
    const trustMissing: string[] = []
    const disabled: string[] = []
    const trustSourcePath = getCodexExplicitHomeHookSourcePath(configPath)
    let presentCount = 0
    for (const eventName of CODEX_EVENTS) {
      const definitions = Array.isArray(config.hooks?.[eventName]) ? config.hooks![eventName]! : []
      // Why: older installs appended, current ones prepend; last-match keeps status repair conservative when stale duplicate definitions survive.
      let foundGroupIndex = -1
      let foundHandlerIndex = -1
      definitions.forEach((definition, idx) => {
        const hooks = definition.hooks ?? []
        // Why: last-match-wins at the group level — if merged hook arrays repeat our command, the surviving runtime entry is the last one.
        const handlerIdx = hooks.findLastIndex((hook) => hook.command === command)
        if (handlerIdx !== -1) {
          foundGroupIndex = idx
          foundHandlerIndex = handlerIdx
        }
      })
      if (foundGroupIndex === -1) {
        missing.push(eventName)
        continue
      }
      presentCount += 1
      // Why: a stale hash blocks firing like a missing entry, so compare against the canonical hash we would write.
      // Why: Codex's hook_key is positional, so hardcoding handlerIndex 0 misreports trust for user-merged hook arrays.
      // Why: hash the same `timeout` install() writes, since Codex folds it into the trust hash or every managed hook reports stale-trust.
      const trustInput: CodexTrustEntry = {
        sourcePath: trustSourcePath,
        eventLabel: CODEX_EVENT_LABEL[eventName],
        groupIndex: foundGroupIndex,
        handlerIndex: foundHandlerIndex,
        command,
        timeoutSec: MANAGED_HOOK_TIMEOUT_SECONDS
      }
      const trustKey = computeTrustKey(trustInput)
      const validHashes = new Set([computeTrustedHash(trustInput)])
      const grantedHash = getCodexLedgerTrustedHash(ledgerHome, trustKey, trustInput)
      if (grantedHash) {
        validHashes.add(grantedHash)
      }
      const recentGrant = recentGrantHashes.get(normalizeHookTrustKeyForLookup(trustKey))
      if (
        recentGrant?.signature === getCodexHookTrustSignature(trustInput) &&
        recentGrant.trustedHash
      ) {
        validHashes.add(recentGrant.trustedHash)
      }
      const actualState = trustEntries.get(trustKey)
      if (!actualState?.trustedHash || !validHashes.has(actualState.trustedHash)) {
        trustMissing.push(eventName)
      } else if (actualState?.enabled === false) {
        disabled.push(eventName)
      }
    }
    const managedHooksPresent = presentCount > 0
    let state: AgentHookInstallState
    let detail: string | null
    if (presentCount === 0) {
      state = 'not_installed'
      // Why: surface the trust read error even when not_installed, so a broken config.toml gives actionable info.
      detail = trustReadError !== null ? `Trust entries unverifiable: ${trustReadError}` : null
    } else if (
      missing.length === 0 &&
      trustMissing.length === 0 &&
      disabled.length === 0 &&
      trustReadError === null
    ) {
      state = 'installed'
      detail = null
    } else {
      state = 'partial'
      const parts: string[] = []
      if (missing.length > 0) {
        parts.push(`Managed hook missing for events: ${missing.join(', ')}`)
      }
      if (trustReadError !== null) {
        parts.push(`Trust entries unverifiable: ${trustReadError}`)
      } else if (trustMissing.length > 0) {
        parts.push(`Trust entry missing or stale for events: ${trustMissing.join(', ')}`)
      }
      if (disabled.length > 0) {
        parts.push(`Managed hook disabled for events: ${disabled.join(', ')}`)
      }
      detail = parts.join('; ')
    }
    return { agent: 'codex', state, configPath, managedHooksPresent, detail }
  }

  // Why: runtimeHomePath defaults to the shared managed mirror, but a managed
  // account launching against its own self-contained CODEX_HOME passes that
  // per-account home so hooks.json/config.toml/trust land where codex reads.
  install(runtimeHomePath: string = getOrcaManagedCodexHomePath()): AgentHookInstallStatus {
    const configPath = getConfigPath(runtimeHomePath)
    const scriptPath = getManagedScriptPath()
    // Why: must run before this install rewrites hooks.json/config.toml —
    // approvals the user made inside Orca-launched Codex are keyed to the
    // previous launch's runtime layout, and stale-trust cleanup below would
    // delete them once the system config stops backing them.
    promoteCodexRuntimeHookApprovalsToSystem(runtimeHomePath)
    const config = readHooksJson(configPath)
    if (!config) {
      return {
        agent: 'codex',
        state: 'error',
        configPath,
        managedHooksPresent: false,
        detail: 'Could not parse Codex hooks.json'
      }
    }

    // Why: match by script filename (not exact command) so a fresh install sweeps stale entries from older builds or a different userData path.
    const isManagedCommand = createManagedCommandMatcher(getCodexManagedScriptFileName())
    const command = getManagedCommand(scriptPath)
    const hookPlan = getRuntimeHooksWithSystemUserHooks(config.hooks, isManagedCommand, configPath)
    const nextHooks = hookPlan.hooks
    const managedEvents = new Set<string>(CODEX_EVENTS)

    // Why: sweep managed entries from events we no longer subscribe to (e.g. a prior install's PreToolUse), else they keep firing stale hooks after upgrade.
    for (const [eventName, definitions] of Object.entries(nextHooks)) {
      if (managedEvents.has(eventName)) {
        continue
      }
      if (!Array.isArray(definitions)) {
        // Why: a non-array event value would make removeManagedCommands throw; skip the unparsable entry, managed events below still install.
        continue
      }
      const cleaned = removeManagedCommands(definitions, isManagedCommand)
      if (cleaned.length === 0) {
        delete nextHooks[eventName]
      } else {
        nextHooks[eventName] = cleaned
      }
    }

    // Why: Codex 0.129+ requires a per-hook config.toml trust entry or the hook needs manual /hooks-approve; precompute the hash to avoid that.
    const mirroredUserTrustEntries = moveMirroredRuntimeUserTrustAfterManagedStatusHook(
      hookPlan.trustEntries
    )
    const mirroredTrustEntries: CodexTrustEntry[] = mirroredUserTrustEntries.map(
      ({ entry }) => entry
    )
    const managedTrustEntries: CodexTrustEntry[] = []
    const trustSourcePath = getCodexExplicitHomeHookSourcePath(configPath)
    for (const eventName of CODEX_EVENTS) {
      const current = Array.isArray(nextHooks[eventName]) ? nextHooks[eventName] : []
      const cleaned = removeManagedCommands(current, isManagedCommand)
      const definition: HookDefinition = {
        hooks: [buildManagedCommandHook(command)]
      }
      nextHooks[eventName] = [definition, ...cleaned]
      // Why: the status hook must run before user hooks so a slow
      // PostToolUse/Stop hook cannot leave the sidebar stuck on the previous
      // state while Codex visibly reports that hooks are still running.
      // timeoutSec mirrors the hook's `timeout` so the trust hash matches the
      // entry actually written to hooks.json.
      managedTrustEntries.push({
        sourcePath: trustSourcePath,
        eventLabel: CODEX_EVENT_LABEL[eventName],
        groupIndex: 0,
        handlerIndex: 0,
        command,
        timeoutSec: MANAGED_HOOK_TIMEOUT_SECONDS
      })
    }
    const trustEntries: CodexTrustEntry[] = [...mirroredTrustEntries, ...managedTrustEntries]
    let recentGrantEntries: readonly CodexTrustEntry[] = []

    config.hooks = nextHooks
    writeManagedScript(scriptPath, getManagedScript())
    writeCodexHooksJson(configPath, nextHooks)
    // Why: trust entries write last so a half-write can't leave a hash pointing at a nonexistent hook.
    // Why: surface trust-write failures — otherwise getStatus reports green for a hook Codex won't fire.
    try {
      const tomlPath = getCodexConfigTomlPath(runtimeHomePath)
      syncSystemConfigIntoManagedCodexHome({
        runtimeHomePath,
        systemHomePath: getSystemCodexHomePath()
      })
      // Why: Codex is the only authority on its trust-hash algorithm, so the
      // managed entries are granted through codex app-server RPCs (verified by
      // re-list) whenever the installed CLI supports them; the granted entries
      // then carry Codex's verbatim hashes into stale cleanup so it cannot
      // delete what Codex just wrote. Mirrored user trust keeps its existing
      // verbatim-carry lane either way.
      const grant = grantManagedCodexHookTrust({
        runtimeHomePath,
        tomlPath,
        managedCommand: command,
        managedEntries: managedTrustEntries,
        host: { kind: 'native' },
        telemetryLane: 'managed'
      })
      if (grant.lane === 'rpc') {
        recentGrantEntries = grant.entries
        upsertHookTrustEntries(tomlPath, mirroredTrustEntries)
        removeStaleRuntimeHookTrustEntries(tomlPath, configPath, [
          ...mirroredTrustEntries,
          ...grant.entries
        ])
      } else {
        // Why: system user hook approvals are mirrored into runtime CODEX_HOME.
        // If the user later revokes approval in ~/.codex/config.toml, preserving
        // all old runtime [hooks.state.*] blocks would keep Orca Codex trusted.
        // Upsert first so duplicate repair can preserve a disabled managed copy
        // before stale cleanup removes old managed hook keys.
        upsertHookTrustEntries(tomlPath, trustEntries)
        removeStaleRuntimeHookTrustEntries(tomlPath, configPath, trustEntries)
      }
      applyMirroredRuntimeUserHookTrustStates(tomlPath, mirroredUserTrustEntries)
    } catch (error) {
      return {
        agent: 'codex',
        state: 'error',
        configPath,
        managedHooksPresent: true,
        detail: `Hooks installed but trust entries could not be written: ${error instanceof Error ? error.message : String(error)}. Run /hooks in Codex to approve.`
      }
    }
    snapshotCodexRuntimeHookTrustProvenance(runtimeHomePath)
    try {
      cleanupLegacySystemManagedHooks()
      cleanupLegacyCodexProfileHooks()
    } catch (error) {
      console.warn('[codex-hook-service] failed to clean legacy Codex hooks', error)
    }
    return this.getStatusAfterInstall(recentGrantEntries, runtimeHomePath)
  }

  async installRemote(
    sftp: SFTPWrapper,
    remoteHome: string,
    options?: {
      /** Explicit CODEX_HOME dir (flat layout). WSL sessions read Orca's managed runtime home, not ~/.codex, so the default location leaves them hookless. */
      codexHomeDir?: string
      /** Skip the trust write when config.toml is absent — the WSL launch path seeds it only-if-absent, so creating it here would cancel that seed. */
      deferTrustUntilConfigToml?: boolean
    }
  ): Promise<AgentHookInstallStatus> {
    const codexHomeBase =
      options?.codexHomeDir?.replace(/\/$/, '') ?? `${remoteHome.replace(/\/$/, '')}/.codex`
    const remoteConfigPath = `${codexHomeBase}/hooks.json`
    const remoteTomlPath = `${codexHomeBase}/config.toml`
    const remoteScriptPath = `${remoteHome.replace(/\/$/, '')}/.orca/agent-hooks/codex-hook.sh`
    try {
      const config = await readHooksJsonRemote(sftp, remoteConfigPath)
      if (!config) {
        return {
          agent: 'codex',
          state: 'error',
          configPath: remoteConfigPath,
          managedHooksPresent: false,
          detail: 'Could not parse remote Codex hooks.json'
        }
      }

      const command = wrapPosixHookCommand(remoteScriptPath)
      const nextHooks = { ...config.hooks }
      const managedEvents = new Set<string>(CODEX_EVENTS)
      const isManagedCommand = createManagedCommandMatcher('codex-hook.sh')

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
        nextHooks[eventName] = [...cleaned, definition]
        trustEntries.push({
          sourcePath: remoteConfigPath,
          eventLabel: CODEX_EVENT_LABEL[eventName],
          groupIndex: cleaned.length,
          handlerIndex: 0,
          command,
          timeoutSec: MANAGED_HOOK_TIMEOUT_SECONDS
        })
      }

      config.hooks = nextHooks
      // Why: write script/settings before trust TOML; a partial trust write leaves Codex asking approval instead of running a missing script.
      // Why: SSH remotes use POSIX `.sh` paths even when Orca runs on Windows; never derive remote script syntax from local OS.
      await writeManagedScriptRemote(sftp, remoteScriptPath, getManagedScript('posix'))
      // Why: SSH edits the user's remote ~/.codex/hooks.json directly, so preserve non-Orca top-level metadata while replacing the hooks tree.
      await writeHooksJsonRemote(sftp, remoteConfigPath, { ...config, hooks: nextHooks })
      try {
        const existingTomlRaw = await readTextFileRemote(sftp, remoteTomlPath)
        if (existingTomlRaw === null && options?.deferTrustUntilConfigToml === true) {
          return {
            agent: 'codex',
            state: 'installed',
            configPath: remoteConfigPath,
            managedHooksPresent: true,
            detail: 'Trust entries deferred until config.toml is seeded by the launch path'
          }
        }
        const existingToml = existingTomlRaw ?? ''
        const updatedToml = upsertHookTrustEntriesInContent(existingToml, trustEntries)
        if (updatedToml !== existingToml) {
          await writeTextFileRemoteAtomic(sftp, remoteTomlPath, updatedToml)
        }
      } catch (error) {
        return {
          agent: 'codex',
          state: 'error',
          configPath: remoteConfigPath,
          managedHooksPresent: true,
          detail: `Hooks installed but trust entries could not be written: ${
            error instanceof Error ? error.message : String(error)
          }. Run /hooks in Codex on the remote host to approve.`
        }
      }

      return {
        agent: 'codex',
        state: 'installed',
        configPath: remoteConfigPath,
        managedHooksPresent: true,
        detail: null
      }
    } catch (err) {
      return {
        agent: 'codex',
        state: 'error',
        configPath: remoteConfigPath,
        managedHooksPresent: false,
        detail: err instanceof Error ? err.message : String(err)
      }
    }
  }

  refreshRuntimeUserHooks(
    runtimeHomePath: string = getOrcaManagedCodexHomePath()
  ): AgentHookInstallStatus {
    const configPath = getConfigPath(runtimeHomePath)
    // Why: same as install() — capture in-Orca approvals before this refresh
    // rewrites the runtime files they are keyed against.
    promoteCodexRuntimeHookApprovalsToSystem(runtimeHomePath)
    const config = readHooksJson(configPath)
    if (!config) {
      // Why: disabled launch prep once called remove(); preserve that legacy cleanup even when runtime hooks.json is malformed.
      cleanupLegacyManagedHookRepresentations()
      return {
        agent: 'codex',
        state: 'error',
        configPath,
        managedHooksPresent: false,
        detail: 'Could not parse Codex hooks.json'
      }
    }

    const isManagedCommand = createManagedCommandMatcher(getCodexManagedScriptFileName())
    const hookPlan = getRuntimeHooksWithSystemUserHooks(config.hooks, isManagedCommand, configPath)
    config.hooks = hookPlan.hooks
    writeCodexHooksJson(configPath, hookPlan.hooks)

    try {
      const tomlPath = getCodexConfigTomlPath(runtimeHomePath)
      const trustEntries = hookPlan.trustEntries.map(({ entry }) => entry)
      syncSystemConfigIntoManagedCodexHome({
        runtimeHomePath,
        systemHomePath: getSystemCodexHomePath()
      })
      // Why: this path is used when Orca status hooks are disabled. The
      // runtime CODEX_HOME should keep user hooks, but not Orca-managed trust.
      // Write current mirrored user trust first so stale cleanup compares
      // against current hashes while deleting old managed hook keys.
      upsertHookTrustEntries(tomlPath, trustEntries)
      removeStaleRuntimeHookTrustEntries(tomlPath, configPath, trustEntries)
      applyMirroredRuntimeUserHookTrustStates(tomlPath, hookPlan.trustEntries)
    } catch (error) {
      return {
        agent: 'codex',
        state: 'error',
        configPath,
        managedHooksPresent: false,
        detail: `User hooks refreshed but trust entries could not be written: ${error instanceof Error ? error.message : String(error)}. Run /hooks in Codex to approve.`
      }
    }
    snapshotCodexRuntimeHookTrustProvenance(runtimeHomePath)

    cleanupLegacyManagedHookRepresentations()
    return this.getStatus(runtimeHomePath)
  }

  remove(): AgentHookInstallStatus {
    const configPath = getConfigPath()
    const configExists = existsSync(configPath)
    const config = readHooksJson(configPath)
    if (!config) {
      // Why: a malformed hooks.json shouldn't strand old hooks in ~/.codex or the legacy profile after disabling.
      cleanupLegacyManagedHookRepresentations()
      return {
        agent: 'codex',
        state: 'error',
        configPath,
        managedHooksPresent: false,
        detail: 'Could not parse Codex hooks.json'
      }
    }

    const nextHooks = { ...config.hooks }
    // Why: same broad matcher as install() so stale entries from older builds get cleaned even if scriptPath moved.
    const isManagedCommand = createManagedCommandMatcher(getCodexManagedScriptFileName())
    for (const [eventName, definitions] of Object.entries(nextHooks)) {
      if (!Array.isArray(definitions)) {
        // Why: a non-array event value would make removeManagedCommands throw; skip it.
        continue
      }
      const cleaned = removeManagedCommands(definitions, isManagedCommand)
      if (cleaned.length === 0) {
        delete nextHooks[eventName]
      } else {
        nextHooks[eventName] = cleaned
      }
    }
    if (configExists) {
      // Why: remove() may be the only repair path for a file whose top-level plugin metadata makes Codex reject hooks.json.
      writeCodexHooksJson(configPath, nextHooks)
    }

    // Why: drop trust entries so config.toml doesn't accumulate dead [hooks.state] blocks across install/remove cycles.
    removeRuntimeManagedHookTrustEntries(configPath)

    cleanupLegacyManagedHookRepresentations()

    return this.getStatus()
  }
}

export const codexHookService = new CodexHookService()

export const _internals = {
  getManagedScript,
  installManagedHooksIntoWslRuntime,
  refreshWslRuntimeUserHooks,
  removeStaleWslRuntimeManagedHookTrustEntries,
  getWslHookReconciliationAction
}

