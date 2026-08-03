import { type LegacyWorkerTerminalRecoveryPlan, parseAppSshPtyId, retireTerminalSurfacesFromSnapshot, retireTerminalSurfaceFromPersistence, runtimeWorktreeIdsEqual } from './orca-runtime-symbols'
import { OrcaRuntimeGetLocalProviderPart1 } from './orca-runtime-get-local-provider-part-1'

export class OrcaRuntimeResolveExitedLegacyWorkerTerminalPart2 extends OrcaRuntimeGetLocalProviderPart1 {
  protected resolveExitedLegacyWorkerTerminal(
    candidate: LegacyWorkerTerminalRecoveryPlan['candidates'][number]
  ): boolean {
    if (
      !this.rollbackLegacyWorkerTerminalSurface(candidate) ||
      !this.persistLegacyWorkerTerminalRecoveryResolution(candidate, 'exited') ||
      !this.reconcileMissingLegacyWorkerTerminal(candidate)
    ) {
      return false
    }
    this.notifier?.resolveLegacyWorkerTerminalRecovery?.(candidate.paneKey, 'exited')
    return true
  }
  protected rollbackLegacyWorkerTerminalSurface(
    candidate: LegacyWorkerTerminalRecoveryPlan['candidates'][number]
  ): boolean {
    const store = this.store
    const session = this.getWorkspaceSessionForWorktree(candidate.worktreeId)
    if (store?.setWorkspaceSession && store.flushOrThrow && session) {
      const retired = retireTerminalSurfaceFromPersistence(session, {
        worktreeId: candidate.worktreeId,
        parentTabId: candidate.tabId,
        leafId: candidate.leafId,
        ptyId: candidate.ptyId,
        incarnationId: candidate.incarnationId
      })
      if (retired !== session) {
        try {
          this.setWorkspaceSessionForWorktree(candidate.worktreeId, retired)
          store.flushOrThrow()
        } catch (error) {
          this.setWorkspaceSessionForWorktree(candidate.worktreeId, session)
          console.warn('[orchestration] failed to persist legacy worker surface rollback', {
            dispatchId: candidate.dispatchId,
            error
          })
          return false
        }
      }
    }

    const snapshot = this.mobileSessionTabsByWorktree.get(candidate.worktreeId)
    if (snapshot) {
      const retired = retireTerminalSurfacesFromSnapshot({
        snapshot,
        ptyId: candidate.ptyId,
        exactSurfaces: [{ parentTabId: candidate.tabId, leafId: candidate.leafId }],
        exactOnly: true
      })
      if (retired) {
        this.mobileSessionTabsByWorktree.set(candidate.worktreeId, retired.snapshot)
        this.notifyMobileSessionTabsChanged(candidate.worktreeId)
      }
    }

    const leafKey = this.getLeafKey(candidate.tabId, candidate.leafId)
    const leaf = this.leaves.get(leafKey)
    const pty = this.ptysById.get(candidate.ptyId)
    if (
      leaf?.ptyId === candidate.ptyId &&
      runtimeWorktreeIdsEqual(leaf.worktreeId, candidate.worktreeId)
    ) {
      this.leaves.delete(leafKey)
      const surfaceHandle = this.handleByLeafKey.get(leafKey)
      this.handleByLeafKey.delete(leafKey)
      const handleRecord = surfaceHandle ? this.handles.get(surfaceHandle) : undefined
      if (
        surfaceHandle &&
        handleRecord?.tabId === candidate.tabId &&
        handleRecord.leafId === candidate.leafId &&
        handleRecord.ptyId === candidate.ptyId
      ) {
        this.handles.delete(surfaceHandle)
      }
      this.rebuildLeafPtyIndex()
      if (![...this.leaves.values()].some((entry) => entry.tabId === candidate.tabId)) {
        this.tabs.delete(candidate.tabId)
      }
    }
    if (pty?.tabId === candidate.tabId) {
      pty.tabId = null
      pty.paneKey = null
    }
    this.notifier?.resolveLegacyWorkerTerminalRecovery?.(
      candidate.paneKey,
      'rolled_back',
      candidate.ptyId
    )
    return true
  }
  protected resolveReplacedLegacyWorkerTerminal(
    candidate: LegacyWorkerTerminalRecoveryPlan['candidates'][number]
  ): boolean {
    return this.resolveExitedLegacyWorkerTerminal(candidate)
  }
  protected updateLegacyWorkerTerminalRecoveryRetry(
    plan: LegacyWorkerTerminalRecoveryPlan,
    deferredDispatchIds: ReadonlySet<string>,
    options: { connectionId?: string; materializeRenderer?: boolean }
  ): void {
    const scopeKey = options.connectionId ? `ssh:${options.connectionId}` : 'local'
    const hasDeferredWorker = plan.candidates.some((candidate) => {
      const sshPty = parseAppSshPtyId(candidate.ptyId)
      const inScope = options.connectionId
        ? sshPty?.connectionId === options.connectionId
        : sshPty === null
      return inScope && deferredDispatchIds.has(candidate.dispatchId)
    })
    if (!hasDeferredWorker) {
      this.cancelLegacyWorkerTerminalRecoveryRetry(scopeKey)
      return
    }
    const existing = this.legacyWorkerTerminalRecoveryRetries.get(scopeKey)
    const retry = existing ?? {
      attempt: 0,
      ...(options.connectionId ? { connectionId: options.connectionId } : {}),
      materializeRenderer: options.materializeRenderer === true,
      timer: null
    }
    retry.materializeRenderer ||= options.materializeRenderer === true
    this.legacyWorkerTerminalRecoveryRetries.set(scopeKey, retry)
    this.armLegacyWorkerTerminalRecoveryRetry(scopeKey, retry)
  }
  protected cancelLegacyWorkerTerminalRecoveryRetry(scopeKey: string): void {
    const retry = this.legacyWorkerTerminalRecoveryRetries.get(scopeKey)
    if (retry?.timer) {
      clearTimeout(retry.timer)
    }
    this.legacyWorkerTerminalRecoveryRetries.delete(scopeKey)
  }
  protected armLegacyWorkerTerminalRecoveryRetry(
    scopeKey: string,
    retry: {
      attempt: number
      connectionId?: string
      materializeRenderer: boolean
      timer: ReturnType<typeof setTimeout> | null
    }
  ): void {
    if (retry.timer) {
      return
    }
    const delayMs = Math.min(1_000 * 2 ** retry.attempt, 30_000)
    retry.attempt += 1
    retry.timer = setTimeout(() => {
      retry.timer = null
      void this.reconcileLegacyWorkerTerminals({
        ...(retry.connectionId ? { connectionId: retry.connectionId } : {}),
        materializeRenderer: retry.materializeRenderer
      }).catch((error) => {
        console.warn('[orchestration] worker terminal recovery retry failed', {
          scope: scopeKey,
          error
        })
        if (this.legacyWorkerTerminalRecoveryRetries.get(scopeKey) === retry) {
          this.armLegacyWorkerTerminalRecoveryRetry(scopeKey, retry)
        }
      })
    }, delayMs)
    retry.timer.unref?.()
  }
}
