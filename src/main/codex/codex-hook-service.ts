import type { SFTPWrapper } from 'ssh2'
import type { AgentHookInstallStatus } from '../../shared/agent-hook-types'
import type { CodexTrustEntry } from './config-toml-trust'
import { getOrcaManagedCodexHomePath } from './codex-home-paths'
import type { CodexWslRuntimeHookTarget } from './codex-wsl-hook-install-plan'
import {
  getManagedScript,
  installManagedHooksIntoWslRuntime,
  refreshWslRuntimeUserHooks,
  removeStaleWslRuntimeManagedHookTrustEntries,
  getWslHookReconciliationAction,
  getWslReconciliationKey
} from './codex-hook-support-b'

import * as codexHookRuntimeInstallation from './codex-hook-runtime-installation'
import * as codexHookStatus from './codex-hook-status'
import * as codexHookInstallation from './codex-hook-installation'
import * as codexHookRemote from './codex-hook-remote'
import * as codexHookRemoval from './codex-hook-removal'

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
    return codexHookRuntimeInstallation.installForRuntimeHome(this, runtimeHomePath, target)
  }

  refreshRuntimeUserHooksForRuntimeHome(
    runtimeHomePath: string | null | undefined,
    target?: CodexWslRuntimeHookTarget
  ): AgentHookInstallStatus | null {
    return codexHookRuntimeInstallation.refreshRuntimeUserHooksForRuntimeHome(
      this,
      runtimeHomePath,
      target
    )
  }

  getStatus(runtimeHomePath: string = getOrcaManagedCodexHomePath()): AgentHookInstallStatus {
    return codexHookStatus.getStatus(this, runtimeHomePath)
  }

  private getStatusAfterInstall(
    recentGrantEntries: readonly CodexTrustEntry[] | null,
    runtimeHomePath: string = getOrcaManagedCodexHomePath()
  ): AgentHookInstallStatus {
    return codexHookStatus.getStatusAfterInstall(this, recentGrantEntries, runtimeHomePath)
  }

  install(runtimeHomePath: string = getOrcaManagedCodexHomePath()): AgentHookInstallStatus {
    return codexHookInstallation.install(this, runtimeHomePath)
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
    return codexHookRemote.installRemote(this, sftp, remoteHome, options)
  }

  refreshRuntimeUserHooks(
    runtimeHomePath: string = getOrcaManagedCodexHomePath()
  ): AgentHookInstallStatus {
    return codexHookRemote.refreshRuntimeUserHooks(this, runtimeHomePath)
  }

  remove(): AgentHookInstallStatus {
    return codexHookRemoval.remove(this)
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
