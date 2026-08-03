import { OrchestrationError, type OrchestrationWorkerServer, type RuntimeSessionFlushResult, type RuntimeSessionSnapshot, parseAppSshPtyId, type AutomationService, getLatestPtyTitle, resolveTerminalSessionWorktreeId, runtimeWorktreeIdsEqual, SESSION_SNAPSHOT_STABILITY_ATTEMPTS, type LegacyWorkerTerminalRecoveryResult, type ResolvedWorktree, type TerminalWorkspaceLaunchScope } from './orca-runtime-symbols'
import { OrcaRuntimeResolveExitedLegacyWorkerTerminalPart2 } from './orca-runtime-resolve-exited-legacy-worker-terminal-part-2'

export class OrcaRuntimeReconcileLegacyWorkerTerminalsNowPart3 extends OrcaRuntimeResolveExitedLegacyWorkerTerminalPart2 {
  protected async reconcileLegacyWorkerTerminalsNow(options: {
    connectionId?: string
    materializeRenderer?: boolean
  }): Promise<LegacyWorkerTerminalRecoveryResult> {
    const plan = this.prepareLegacyWorkerTerminalRecovery()
    const adoptedDispatchIds: string[] = []
    const exitedDispatchIds: string[] = []
    const deferredDispatchIds = new Set(plan.ambiguousDispatchIds)
    const recoveryCandidatesByProvider = new Map<
      string,
      {
        connectionId: string | null
        entries: {
          candidate: (typeof plan.candidates)[number]
          workspace: TerminalWorkspaceLaunchScope
          resolvedWorkspace: ResolvedWorktree
        }[]
      }
    >()
    for (const candidate of plan.candidates) {
      try {
        const workspace = await this.resolveTerminalWorkspaceLaunchScope(
          `id:${candidate.worktreeId}`
        )
        const sshPty = parseAppSshPtyId(candidate.ptyId)
        if (workspace.connectionId) {
          if (
            options.connectionId !== workspace.connectionId ||
            sshPty?.connectionId !== workspace.connectionId
          ) {
            deferredDispatchIds.add(candidate.dispatchId)
            continue
          }
        } else if (
          options.connectionId !== undefined ||
          sshPty !== null ||
          !this.canRecoverPersistentLocalPtysFn()
        ) {
          deferredDispatchIds.add(candidate.dispatchId)
          continue
        }
        const resolvedWorkspace = workspace.folderWorkspace
          ? this.folderWorkspaceToResolvedWorktree(workspace.folderWorkspace)
          : await this.resolveWorktreeSelector(`id:${workspace.id}`)
        const connectionId = workspace.connectionId ?? null
        const providerKey = connectionId === null ? 'local' : `ssh:${connectionId}`
        const provider: {
          connectionId: string | null
          entries: {
            candidate: (typeof plan.candidates)[number]
            workspace: TerminalWorkspaceLaunchScope
            resolvedWorkspace: ResolvedWorktree
          }[]
        } = recoveryCandidatesByProvider.get(providerKey) ?? {
          connectionId,
          entries: []
        }
        provider.entries.push({ candidate, workspace, resolvedWorkspace })
        recoveryCandidatesByProvider.set(providerKey, provider)
      } catch {
        deferredDispatchIds.add(candidate.dispatchId)
      }
    }
    for (const provider of recoveryCandidatesByProvider.values()) {
      const resolvedWorktrees = [
        ...new Map(
          provider.entries.map(({ resolvedWorkspace }) => [resolvedWorkspace.id, resolvedWorkspace])
        ).values()
      ]
      const inventory = await this.refreshPtyWorktreeRecordsWithControllerInventory(
        resolvedWorktrees,
        null,
        undefined,
        provider.connectionId
      )
      if (!inventory) {
        provider.entries.forEach(({ candidate }) => deferredDispatchIds.add(candidate.dispatchId))
        continue
      }
      for (const { candidate, workspace } of provider.entries) {
        if (!inventory.livePtyIds.has(candidate.ptyId)) {
          if (this.resolveExitedLegacyWorkerTerminal(candidate)) {
            exitedDispatchIds.push(candidate.dispatchId)
          } else {
            deferredDispatchIds.add(candidate.dispatchId)
          }
          continue
        }
        const controllerIdentity = inventory.terminalIdentityByPtyId.get(candidate.ptyId)
        if (!controllerIdentity) {
          deferredDispatchIds.add(candidate.dispatchId)
          continue
        }
        if (
          controllerIdentity.handle !== candidate.terminalHandle ||
          controllerIdentity.incarnationId !== candidate.incarnationId
        ) {
          if (this.resolveReplacedLegacyWorkerTerminal(candidate)) {
            exitedDispatchIds.push(candidate.dispatchId)
          } else {
            deferredDispatchIds.add(candidate.dispatchId)
          }
          continue
        }
        const preAdoptionInventory = await this.refreshPtyWorktreeRecordsWithControllerInventory(
          resolvedWorktrees,
          null,
          undefined,
          provider.connectionId
        )
        if (!preAdoptionInventory) {
          deferredDispatchIds.add(candidate.dispatchId)
          continue
        }
        if (!preAdoptionInventory.livePtyIds.has(candidate.ptyId)) {
          if (this.resolveExitedLegacyWorkerTerminal(candidate)) {
            exitedDispatchIds.push(candidate.dispatchId)
          } else {
            deferredDispatchIds.add(candidate.dispatchId)
          }
          continue
        }
        const preAdoptionIdentity = preAdoptionInventory.terminalIdentityByPtyId.get(
          candidate.ptyId
        )
        if (!preAdoptionIdentity) {
          deferredDispatchIds.add(candidate.dispatchId)
          continue
        }
        if (
          preAdoptionIdentity.handle !== candidate.terminalHandle ||
          preAdoptionIdentity.incarnationId !== candidate.incarnationId
        ) {
          if (this.resolveReplacedLegacyWorkerTerminal(candidate)) {
            exitedDispatchIds.push(candidate.dispatchId)
          } else {
            deferredDispatchIds.add(candidate.dispatchId)
          }
          continue
        }
        const session = this.getWorkspaceSessionForWorktree(candidate.worktreeId)
        const sessionWorktreeId = session
          ? resolveTerminalSessionWorktreeId(session, candidate.worktreeId)
          : null
        const activeTabId = sessionWorktreeId
          ? session?.activeTabIdByWorktree?.[sessionWorktreeId]
          : undefined
        const activeGroupId = sessionWorktreeId
          ? session?.activeGroupIdByWorktree?.[sessionWorktreeId]
          : undefined
        const exactSurfaceAlreadyPublished =
          this.hasExactPersistedTerminalSurfaceIdentity(candidate) &&
          this.hasExactTerminalSurfaceIdentity(candidate)
        if (!exactSurfaceAlreadyPublished) {
          try {
            await this.adoptTerminalOrphansFromInventory(
              {
                worktree: `id:${candidate.worktreeId}`,
                expectedTopologyRevision: this.getTerminalTopologyRevision(candidate.worktreeId),
                ...(activeTabId ? { activeTabId } : {}),
                ...(activeGroupId ? { activeGroupId } : {}),
                claims: [
                  {
                    terminal: candidate.terminalHandle,
                    ptyId: candidate.ptyId,
                    incarnationId: candidate.incarnationId,
                    tabId: candidate.tabId,
                    leafId: candidate.leafId
                  }
                ]
              },
              workspace,
              preAdoptionInventory
            )
          } catch (error) {
            console.warn('[orchestration] legacy worker terminal adoption deferred', {
              dispatchId: candidate.dispatchId,
              error
            })
            deferredDispatchIds.add(candidate.dispatchId)
            continue
          }
        }
        let rendererMaterialized =
          options.materializeRenderer !== true ||
          this.legacyWorkerTerminalReceiptEpochByPane.get(candidate.paneKey) ===
            this.rendererGraphEpoch
        const pty = this.ptysById.get(candidate.ptyId)
        if (
          options.materializeRenderer &&
          !rendererMaterialized &&
          pty &&
          this.notifier?.revealTerminalSession
        ) {
          for (let attempt = 0; attempt < 2 && !rendererMaterialized; attempt += 1) {
            try {
              const reveal = await this.notifier.revealTerminalSession(candidate.worktreeId, {
                ptyId: candidate.ptyId,
                title: getLatestPtyTitle(pty) ?? pty.controllerTitle,
                activate: false,
                presentation: 'background',
                tabId: candidate.tabId,
                leafId: candidate.leafId,
                focus: false,
                expectedProcessIdentity: {
                  terminalHandle: candidate.terminalHandle,
                  incarnationId: candidate.incarnationId
                }
              })
              const identity = reveal?.identity
              if (
                !identity ||
                !runtimeWorktreeIdsEqual(identity.worktreeId, candidate.worktreeId) ||
                identity.tabId !== candidate.tabId ||
                identity.leafId !== candidate.leafId ||
                identity.ptyId !== candidate.ptyId
              ) {
                throw new Error('terminal_reveal_identity_mismatch')
              }
              rendererMaterialized = true
              this.legacyWorkerTerminalReceiptEpochByPane.set(
                candidate.paneKey,
                this.rendererGraphEpoch
              )
            } catch (error) {
              if (attempt === 0) {
                await new Promise<void>((resolve) => setTimeout(resolve, 100))
                continue
              }
              console.warn('[orchestration] adopted legacy worker was not revealed', {
                dispatchId: candidate.dispatchId,
                error
              })
            }
          }
        }
        if (!rendererMaterialized) {
          this.legacyWorkerTerminalReceiptEpochByPane.delete(candidate.paneKey)
          deferredDispatchIds.add(candidate.dispatchId)
          continue
        }
        if (
          options.materializeRenderer === true &&
          !this.hasExactTerminalSurfaceIdentity({
            worktreeId: candidate.worktreeId,
            tabId: candidate.tabId,
            leafId: candidate.leafId,
            ptyId: candidate.ptyId,
            terminalHandle: candidate.terminalHandle,
            incarnationId: candidate.incarnationId
          })
        ) {
          deferredDispatchIds.add(candidate.dispatchId)
          continue
        }
        const finalInventory = await this.refreshPtyWorktreeRecordsWithControllerInventory(
          resolvedWorktrees,
          null,
          undefined,
          provider.connectionId
        )
        if (!finalInventory) {
          deferredDispatchIds.add(candidate.dispatchId)
          continue
        }
        if (!finalInventory.livePtyIds.has(candidate.ptyId)) {
          this.legacyWorkerTerminalReceiptEpochByPane.delete(candidate.paneKey)
          this.onPtyExit(candidate.ptyId, 0, candidate.incarnationId, {
            authoritativeIdentityLess: candidate.incarnationId === undefined,
            ...(candidate.incarnationId ? { expectedIncarnationId: candidate.incarnationId } : {})
          })
          if (this.resolveExitedLegacyWorkerTerminal(candidate)) {
            exitedDispatchIds.push(candidate.dispatchId)
          } else {
            deferredDispatchIds.add(candidate.dispatchId)
          }
          continue
        }
        const finalIdentity = finalInventory.terminalIdentityByPtyId.get(candidate.ptyId)
        if (!finalIdentity) {
          this.legacyWorkerTerminalReceiptEpochByPane.delete(candidate.paneKey)
          deferredDispatchIds.add(candidate.dispatchId)
          continue
        }
        if (
          finalIdentity.handle !== candidate.terminalHandle ||
          finalIdentity.incarnationId !== candidate.incarnationId
        ) {
          this.legacyWorkerTerminalReceiptEpochByPane.delete(candidate.paneKey)
          if (this.resolveReplacedLegacyWorkerTerminal(candidate)) {
            exitedDispatchIds.push(candidate.dispatchId)
          } else {
            deferredDispatchIds.add(candidate.dispatchId)
          }
          continue
        }
        if (!this.persistLegacyWorkerTerminalRecoveryResolution(candidate, 'adopted')) {
          deferredDispatchIds.add(candidate.dispatchId)
          continue
        }
        this.legacyWorkerRecoveredPtys.add(candidate.ptyId)
        this.notifier?.resolveLegacyWorkerTerminalRecovery?.(candidate.paneKey, 'adopted')
        adoptedDispatchIds.push(candidate.dispatchId)
      }
    }
    const result = {
      blockedPaneCount: plan.blockedPanes.length,
      adoptedDispatchIds,
      exitedDispatchIds,
      deferredDispatchIds: [...deferredDispatchIds]
    }
    this.updateLegacyWorkerTerminalRecoveryRetry(plan, deferredDispatchIds, options)
    return result
  }
  setAutomationService(service: AutomationService): void {
    this.automationService = service
  }
  getRuntimeId(): string {
    return this.runtimeId
  }
  protected async readStableSessionSnapshot(): Promise<RuntimeSessionSnapshot> {
    const store = this.store
    if (!store?.getStateRevision) {
      throw new Error('session_revision_unavailable')
    }
    const readStateRevision = (): string => store.getStateRevision!()
    for (let attempt = 0; attempt < SESSION_SNAPSHOT_STABILITY_ATTEMPTS; attempt += 1) {
      const revisionBefore = readStateRevision()
      const snapshots = await this.listAllMobileSessionTabs()
      const revisionAfter = readStateRevision()
      if (revisionBefore === revisionAfter) {
        return {
          hostGeneration: this.runtimeId,
          revision: revisionAfter,
          snapshots
        }
      }
    }
    throw new Error('session_snapshot_unstable')
  }
  async getSessionSnapshot(): Promise<RuntimeSessionSnapshot> {
    return this.readStableSessionSnapshot()
  }
  async flushSession(): Promise<RuntimeSessionFlushResult> {
    if (!this.store?.flushOrThrow || !this.store?.getStateRevision) {
      throw new Error('session_persistence_unavailable')
    }
    const snapshot = await this.readStableSessionSnapshot()
    this.store.flushOrThrow()
    const flushedRevision = this.store.getStateRevision()
    if (flushedRevision !== snapshot.revision) {
      throw new Error('session_flush_raced')
    }
    return {
      ...snapshot,
      flushed: true
    }
  }
  resolveOrchestrationWorkerServer(selector: string): OrchestrationWorkerServer {
    if (!this.orchestrationEnvironmentTransport) {
      throw new OrchestrationError(
        'server_required',
        'Connected-server orchestration is unavailable in this runtime.'
      )
    }
    return this.orchestrationEnvironmentTransport.resolve(selector)
  }
}
