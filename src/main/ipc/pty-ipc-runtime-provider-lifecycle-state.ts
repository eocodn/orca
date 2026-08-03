import type { IPtyProvider } from '../providers/types'
import { scheduleOriginalPtyCleanupAuthorities, schedulePendingPtyCleanupReconciliation } from './pty-ipc-runtime-cleanup-reconciliation'
import { clearHiddenRendererPtyDeliveryState, isHiddenRendererPty } from './pty-hidden-delivery-gate'
import { clearNativeWindowsConptyPty } from '../runtime/terminal-model-query-authority'
import { openCodeHookService } from '../opencode/hook-service'
import { piTitlebarExtensionService } from '../pi/titlebar-extension-service'
import { markClaudePtyExited } from '../claude-accounts/live-pty-gate'
import { agentHookServer } from '../agent-hooks/server'
import { clearMigrationUnsupportedPty } from '../agent-hooks/migration-unsupported-pty-state'
import { advertisedUrlWatcher } from '../ports/advertised-url-watcher'
import { unregisterPty } from '../memory/pty-registry'
import { forgetCodexPaneAccount } from '../codex/codex-pane-account-registry'
import { isPtyIncarnationId } from '../../shared/pty-incarnation'
import { ptyRuntimeState } from './pty-ipc-runtime-state'

const MAX_CLEARED_PTY_LIFECYCLE_IDS = 4096

export function stagePtyIncarnation(id: string, incarnationId: string | undefined): void {
  ptyRuntimeState.clearedPtyLifecycleIds.delete(id)
  if (incarnationId) {
    ptyRuntimeState.pendingPtyIncarnationById.set(id, incarnationId)
    if (ptyRuntimeState.ptyIncarnationById.get(id) !== incarnationId) {
      ptyRuntimeState.ptyStateTokenById.set(id, Symbol(id))
    }
  }
}

export function commitPtyIncarnation(id: string, incarnationId: string | undefined): symbol {
  if (!incarnationId) {
    ptyRuntimeState.pendingPtyIncarnationById.delete(id)
    ptyRuntimeState.ptyIncarnationById.delete(id)
    const stateToken = Symbol(id)
    ptyRuntimeState.ptyStateTokenById.set(id, stateToken)
    return stateToken
  }
  if (ptyRuntimeState.pendingPtyIncarnationById.get(id) !== incarnationId) {
    if (ptyRuntimeState.ptyIncarnationById.get(id) === incarnationId) {
      return getOrCreatePtyStateToken(id)
    }
    throw new Error('pty_incarnation_commit_mismatch')
  }
  ptyRuntimeState.pendingPtyIncarnationById.delete(id)
  const sameLifecycle = ptyRuntimeState.ptyIncarnationById.get(id) === incarnationId
  ptyRuntimeState.ptyIncarnationById.set(id, incarnationId)
  if (!sameLifecycle || !ptyRuntimeState.ptyStateTokenById.has(id)) {
    ptyRuntimeState.ptyStateTokenById.set(id, Symbol(id))
  }
  return getOrCreatePtyStateToken(id)
}

export function rollbackPtyIncarnation(id: string, incarnationId: string | undefined): void {
  if (
    incarnationId &&
    ptyRuntimeState.pendingPtyIncarnationById.get(id) === incarnationId
  ) {
    ptyRuntimeState.pendingPtyIncarnationById.delete(id)
  }
}

export function registerSshPtyProvider(connectionId: string, provider: IPtyProvider): void {
  ptyRuntimeState.sshProviders.set(connectionId, provider)
  const generation = (provider as { providerGeneration?: number }).providerGeneration
  if (Number.isSafeInteger(generation) && generation! > 0) {
    ptyRuntimeState.sshProvidersByGeneration.set(generation!, provider)
  }
  schedulePendingPtyCleanupReconciliation(provider)
}

export function unregisterSshPtyProvider(
  connectionId: string,
  expectedProvider?: IPtyProvider
): void {
  const provider = expectedProvider ?? ptyRuntimeState.sshProviders.get(connectionId)
  const generation = (provider as { providerGeneration?: number } | undefined)?.providerGeneration
  if (
    generation !== undefined &&
    ptyRuntimeState.sshProvidersByGeneration.get(generation) === provider
  ) {
    ptyRuntimeState.sshProvidersByGeneration.delete(generation)
  }
  if (expectedProvider !== undefined && ptyRuntimeState.sshProviders.get(connectionId) !== expectedProvider) {
    return
  }
  ptyRuntimeState.sshProviders.delete(connectionId)
}

export function getSshPtyProvider(connectionId: string): IPtyProvider | undefined {
  return ptyRuntimeState.sshProviders.get(connectionId)
}

export function getLocalPtyProvider(): IPtyProvider {
  return ptyRuntimeState.localProvider
}

export function setLocalPtyProvider(provider: IPtyProvider): void {
  ptyRuntimeState.localProvider = provider
  scheduleOriginalPtyCleanupAuthorities()
  schedulePendingPtyCleanupReconciliation(provider)
}

export function rebindLocalProviderListeners(): void {
  ptyRuntimeState.rebindProviderListeners?.()
  schedulePendingPtyCleanupReconciliation(ptyRuntimeState.localProvider)
}

export function getPtyIdsForConnection(connectionId: string): string[] {
  const ids: string[] = []
  for (const [ptyId, connId] of ptyRuntimeState.ptyOwnership) {
    if (connId === connectionId) {
      ids.push(ptyId)
    }
  }
  return ids
}

export function clearPtyOwnershipForConnection(connectionId: string): void {
  for (const [ptyId, connId] of ptyRuntimeState.ptyOwnership) {
    if (connId === connectionId) {
      clearProviderPtyState(ptyId, { preserveAgentSessionOwners: true })
      ptyRuntimeState.ptyOwnership.delete(ptyId)
    }
  }
}

export function clearProviderPtyState(
  id: string,
  opts: { preserveAgentSessionOwners?: boolean } = {}
): void {
  const hadPtyLifecycleState =
    ptyRuntimeState.ptyOwnership.has(id) ||
    ptyRuntimeState.ptyStateTokenById.has(id) ||
    ptyRuntimeState.ptySizes.has(id) ||
    ptyRuntimeState.ptyIncarnationById.has(id) ||
    ptyRuntimeState.pendingPtyIncarnationById.has(id)
  if (!opts.preserveAgentSessionOwners) {
    ptyRuntimeState.agentSessionOwners.release(id)
    forgetCodexPaneAccount(id)
  }
  openCodeHookService.clearPty(id)
  piTitlebarExtensionService.clearPty(id)
  markClaudePtyExited(id)
  ptyRuntimeState.ptySizes.delete(id)
  ptyRuntimeState.pendingPtySizes.delete(id)
  ptyRuntimeState.pendingPtyIncarnationById.delete(id)
  ptyRuntimeState.ptyIncarnationById.delete(id)
  ptyRuntimeState.ptyStateTokenById.delete(id)
  ptyRuntimeState.lastInputAtByPty.delete(id)
  ptyRuntimeState.interactiveOutputCharsByPty.delete(id)
  const activeChanged = ptyRuntimeState.activeRendererPtys.delete(id)
  ptyRuntimeState.visibleRendererPtys.delete(id)
  ptyRuntimeState.rendererVisibilityKnownPtys.delete(id)
  ptyRuntimeState.pendingHiddenRendererResizeOutputPtys.delete(id)
  ptyRuntimeState.deliveredHiddenRendererResizeOutputPtys.delete(id)
  const deliveryPolicyChanged = isHiddenRendererPty(id)
  clearHiddenRendererPtyDeliveryState(id)
  if (activeChanged) {
    ptyRuntimeState.invalidatePendingPtyDrainPriority(id, false)
  }
  if (deliveryPolicyChanged) {
    ptyRuntimeState.invalidatePendingPtyDrainPolicy(id, false)
  }
  ptyRuntimeState.clearBackgroundedDeliverySyncForPty(id)
  ptyRuntimeState.providerSnapshotRequiredPtys.delete(id)
  clearNativeWindowsConptyPty(id)
  const paneKey = ptyRuntimeState.ptyPaneKey.get(id)
  const stillOwnsPaneKey = paneKey ? ptyRuntimeState.paneKeyPtyId.get(paneKey) === id : false
  unregisterPty(id)
  advertisedUrlWatcher.unbindPty(id)
  clearMigrationUnsupportedPty(id)
  agentHookServer.clearPaneKeyAliasesForPty(id, {
    shouldClearStablePaneKey: (stablePaneKey) => {
      const stablePaneOwner = ptyRuntimeState.paneKeyPtyId.get(stablePaneKey)
      if (stablePaneOwner && stablePaneOwner !== id) {
        return false
      }
      return !paneKey || (stillOwnsPaneKey && stablePaneKey === paneKey)
    }
  })
  if (paneKey) {
    if (stillOwnsPaneKey) {
      agentHookServer.clearPaneState(paneKey)
      ptyRuntimeState.paneKeyPtyId.delete(paneKey)
    }
    ptyRuntimeState.ptyPaneKey.delete(id)
    if (stillOwnsPaneKey) {
      for (const listener of ptyRuntimeState.paneKeyTeardownListeners) {
        try {
          listener(paneKey)
        } catch (err) {
          console.error('[pty] paneKey teardown listener threw', err)
        }
      }
    }
  }
  for (const [mappedPaneKey, mappedPtyId] of ptyRuntimeState.paneKeyPtyId) {
    if (mappedPtyId === id) {
      ptyRuntimeState.paneKeyPtyId.delete(mappedPaneKey)
    }
  }
  if (hadPtyLifecycleState) {
    if (ptyRuntimeState.clearedPtyLifecycleIds.size >= MAX_CLEARED_PTY_LIFECYCLE_IDS) {
      const oldestId = ptyRuntimeState.clearedPtyLifecycleIds.values().next().value
      if (oldestId !== undefined) {
        ptyRuntimeState.clearedPtyLifecycleIds.delete(oldestId)
      }
    }
    ptyRuntimeState.clearedPtyLifecycleIds.add(id)
  }
}

export function clearProviderPtyStateIfCurrent(
  id: string,
  expectedStateToken: symbol,
  expectedIncarnationId?: string,
  opts: { preserveAgentSessionOwners?: boolean } = {}
): boolean {
  if (ptyRuntimeState.ptyStateTokenById.get(id) !== expectedStateToken) {
    return false
  }
  if (expectedIncarnationId !== undefined) {
    const currentIncarnation = ptyRuntimeState.ptyIncarnationById.get(id)
    const pendingIncarnation = ptyRuntimeState.pendingPtyIncarnationById.get(id)
    if (
      currentIncarnation !== expectedIncarnationId &&
      pendingIncarnation !== expectedIncarnationId
    ) {
      return false
    }
  } else if (
    ptyRuntimeState.ptyIncarnationById.has(id) ||
    ptyRuntimeState.pendingPtyIncarnationById.has(id)
  ) {
    // Identity-less failures cannot prove ownership of an identity-bearing lifecycle.
    return false
  }
  clearProviderPtyState(id, opts)
  return true
}

export function deletePtyOwnership(id: string): void {
  ptyRuntimeState.ptyOwnership.delete(id)
}

export function setPtyOwnership(id: string, connectionId: string | null): void {
  ptyRuntimeState.clearedPtyLifecycleIds.delete(id)
  ptyRuntimeState.ptyOwnership.set(id, connectionId)
}

export function restorePtyIncarnation(id: string, incarnationId: string): void {
  if (!isPtyIncarnationId(incarnationId)) {
    throw new Error('Invalid PTY incarnation')
  }
  ptyRuntimeState.pendingPtyIncarnationById.delete(id)
  ptyRuntimeState.clearedPtyLifecycleIds.delete(id)
  ptyRuntimeState.ptyIncarnationById.set(id, incarnationId)
  ptyRuntimeState.ptyStateTokenById.set(id, Symbol(id))
}

export function getPtyIncarnation(id: string): string | undefined {
  return ptyRuntimeState.ptyIncarnationById.get(id)
}

export function getPtyStateToken(id: string): symbol | undefined {
  return ptyRuntimeState.ptyStateTokenById.get(id)
}

export function getOrCreatePtyStateToken(id: string): symbol {
  const current = ptyRuntimeState.ptyStateTokenById.get(id)
  if (current) {
    return current
  }
  const created = Symbol(id)
  ptyRuntimeState.ptyStateTokenById.set(id, created)
  return created
}
