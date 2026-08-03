import { win32 as pathWin32 } from 'node:path'
import type { AgentHookInstallStatus } from '../../shared/agent-hook-types'
import {
  createCodexWslRuntimeHookInstallPlan,
  type CodexWslRuntimeHookTarget,
  type WslCanonicalPathSettlement
} from './codex-wsl-hook-install-plan'
import {
  removeStaleWslRuntimeManagedHookTrustEntries,
  installManagedHooksIntoWslRuntime,
  refreshWslRuntimeUserHooks,
  getWslHookReconciliationAction,
  getWslReconciliationKey
} from './codex-hook-support-b'

type WslReconciliationService = {
  supersedeWslReconciliation(runtimeHomePath: string | null | undefined): number
  wslReconciliationGeneration: ReadonlyMap<string, number>
}

export function installForRuntimeHome(
  service: unknown,
  runtimeHomePath: string | null | undefined,
  target?: CodexWslRuntimeHookTarget
): AgentHookInstallStatus | null {
  const runtimeService = service as WslReconciliationService
  const generation = runtimeService.supersedeWslReconciliation(runtimeHomePath)
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
      isCurrentGeneration: runtimeService.wslReconciliationGeneration.get(key) === generation,
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

export function refreshRuntimeUserHooksForRuntimeHome(
  service: unknown,
  runtimeHomePath: string | null | undefined,
  target?: CodexWslRuntimeHookTarget
): AgentHookInstallStatus | null {
  const runtimeService = service as WslReconciliationService
  runtimeService.supersedeWslReconciliation(runtimeHomePath)
  const wslPlan = createCodexWslRuntimeHookInstallPlan(runtimeHomePath, target)
  return wslPlan ? refreshWslRuntimeUserHooks(wslPlan) : null
}
