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

const {
  getConfigPath,
  writeCodexHooksJson,
  getCodexConfigTomlPath,
  getManagedScriptPath,
  getManagedCommand,
  getCodexManagedHookInstallMaterial,
  setSystemCodexHomeHookSweepSuppressed,
  wrapReadablePosixHookCommand,
  getSystemConfigPath,
  getSystemCodexConfigTomlPath,
  getLegacyCodexProfileTomlPath,
  collectManagedTrustEntries,
  removeSelfComputedMatchingTrustEntries,
  removeStaleRuntimeHookTrustEntries,
  commandUsesCodexPluginOnlyPlaceholder,
  removeCodexPluginEnvironmentCommands,
  getRuntimeHooksWithSystemUserHooks,
  getTrustedSystemUserHookSignatures,
  resolveTrustedSystemHookState,
  getTrustedSystemHookHashesByEvent,
  collectMirroredRuntimeUserHookTrustEntries,
  moveMirroredRuntimeUserTrustAfterManagedStatusHook,
  escapeRegex,
  buildHookTrustHeaderKeyPattern,
  applyMirroredRuntimeUserHookTrustStates,
  dedupeHookDefinitions,
  CODEX_EVENTS,
  CODEX_EVENT_LABEL,
  CODEX_MANAGED_EVENT_LABELS,
  CODEX_PLUGIN_ONLY_HOOK_PLACEHOLDERS
} = supportA
const {
  removeSystemManagedHookTrustEntries,
  cleanupLegacySystemManagedHooks,
  stripLegacyManagedProfileBlock,
  cleanupLegacyCodexProfileHooks,
  cleanupLegacyManagedHookRepresentations,
  removeRuntimeManagedHookTrustEntries,
  removeWslRuntimeManagedHookTrustEntries,
  removeStaleWslRuntimeManagedHookTrustEntries,
  getManagedScript,
  installManagedHooksIntoWslRuntime,
  refreshWslRuntimeUserHooks,
  getWslHookReconciliationAction,
  getWslReconciliationKey
} = supportB

export async function installRemote(service: any,
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

export function refreshRuntimeUserHooks(service: any,
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
    return service.getStatus(runtimeHomePath)
}
