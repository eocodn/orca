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

export function installForRuntimeHome(service: any,
    runtimeHomePath: string | null | undefined,
    target?: CodexWslRuntimeHookTarget
  ): AgentHookInstallStatus | null {

    const generation = service.supersedeWslReconciliation(runtimeHomePath)
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
        isCurrentGeneration: service.wslReconciliationGeneration.get(key) === generation,
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

export function refreshRuntimeUserHooksForRuntimeHome(service: any,
    runtimeHomePath: string | null | undefined,
    target?: CodexWslRuntimeHookTarget
  ): AgentHookInstallStatus | null {

    service.supersedeWslReconciliation(runtimeHomePath)
    const wslPlan = createCodexWslRuntimeHookInstallPlan(runtimeHomePath, target)
    return wslPlan ? refreshWslRuntimeUserHooks(wslPlan) : null
}
