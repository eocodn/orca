import { type RuntimeTerminalListResult, type RuntimeTerminalOrphanAdoptionRequest, type RuntimeTerminalOrphanAdoptionResult, type RuntimeTerminalSummary, getRepoIdFromWorktreeId, includeTargetResolvedWorktree } from './orca-runtime-symbols'
import { OrcaRuntimeApplyMobileDisplayModePart37 } from './orca-runtime-apply-mobile-display-mode-part-37'

export class OrcaRuntimeListTerminalsPart38 extends OrcaRuntimeApplyMobileDisplayModePart37 {
  async listTerminals(
    worktreeSelector?: string,
    limit = DEFAULT_TERMINAL_LIST_LIMIT,
    opts: { handles?: readonly string[]; requireFreshPtyLiveness?: boolean } = {}
  ): Promise<RuntimeTerminalListResult> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error('invalid_limit')
    }
    const graphEpoch = this.graphStatus === 'ready' ? this.rendererGraphEpoch : null
    const explicitTargetWorktreeId = worktreeSelector
      ? this.getValidatedExplicitWorktreeIdSelector(worktreeSelector)
      : null
    const initialResolvedWorktreeCache = this.worktreeResolutionState.resolvedCache
    const cachedResolvedWorktrees =
      initialResolvedWorktreeCache && initialResolvedWorktreeCache.expiresAt > Date.now()
        ? initialResolvedWorktreeCache.worktrees
        : null
    const cachedExplicitTargetWorktree =
      explicitTargetWorktreeId && cachedResolvedWorktrees
        ? (cachedResolvedWorktrees.find((worktree) => worktree.id === explicitTargetWorktreeId) ??
          null)
        : null
    const parsedExplicitTargetWorktree =
      explicitTargetWorktreeId && !cachedExplicitTargetWorktree
        ? this.buildResolvedWorktreeFromId(explicitTargetWorktreeId)
        : null
    const targetWorktree =
      worktreeSelector && !explicitTargetWorktreeId
        ? await this.resolveWorktreeSelector(worktreeSelector)
        : (cachedExplicitTargetWorktree ?? parsedExplicitTargetWorktree)
    const targetWorktreeId = explicitTargetWorktreeId ?? targetWorktree?.id ?? null
    const classificationResolvedWorktreeCache = this.worktreeResolutionState.resolvedCache
    const classificationResolvedWorktrees =
      targetWorktreeId &&
      classificationResolvedWorktreeCache &&
      classificationResolvedWorktreeCache.expiresAt > Date.now()
        ? includeTargetResolvedWorktree(
            classificationResolvedWorktreeCache.worktrees,
            targetWorktree
          )
        : targetWorktreeId && explicitTargetWorktreeId
          ? this.listKnownResolvedWorktreesForExplicitTarget(targetWorktreeId, targetWorktree)
          : null
    const worktreesById =
      targetWorktreeId && targetWorktree
        ? new Map([[targetWorktree.id, targetWorktree]])
        : targetWorktreeId
          ? new Map()
          : await this.getResolvedWorktreeMap()
    if (graphEpoch !== null) {
      this.assertStableReadyGraph(graphEpoch)
    }

    const resolvedWorktrees =
      targetWorktreeId && classificationResolvedWorktrees
        ? classificationResolvedWorktrees
        : targetWorktreeId && targetWorktree
          ? [targetWorktree]
          : targetWorktreeId
            ? []
            : [...worktreesById.values()]
    const refreshedPtyLiveness = await this.refreshPtyWorktreeRecordsFromController(
      resolvedWorktrees,
      targetWorktreeId
    )
    if (opts.requireFreshPtyLiveness && !refreshedPtyLiveness) {
      throw new Error('terminal_liveness_unavailable')
    }

    const livePtyWorktreeIds = new Set<string>()
    for (const pty of this.ptysById.values()) {
      if (pty.connected) {
        livePtyWorktreeIds.add(pty.worktreeId)
      }
    }

    const terminals: RuntimeTerminalSummary[] = []
    const ptyIdsFromLeaves = new Set<string>()
    if (graphEpoch !== null) {
      for (const leaf of this.leaves.values()) {
        if (targetWorktreeId && leaf.worktreeId !== targetWorktreeId) {
          continue
        }
        if (
          opts.requireFreshPtyLiveness &&
          (!leaf.ptyId || !refreshedPtyLiveness?.has(leaf.ptyId))
        ) {
          continue
        }
        if (!leaf.ptyId && livePtyWorktreeIds.has(leaf.worktreeId)) {
          continue
        }
        if (leaf.ptyId) {
          ptyIdsFromLeaves.add(leaf.ptyId)
        }
        terminals.push(this.buildTerminalSummary(leaf, worktreesById))
      }
    }

    // Why: worktree.ps can classify active worktrees from PTY records even when
    // the renderer graph is missing a leaf. terminal.list needs the same fallback
    // so mobile does not show a false "No terminals" create flow.
    for (const pty of this.ptysById.values()) {
      if (!pty.connected || ptyIdsFromLeaves.has(pty.ptyId)) {
        continue
      }
      if (opts.requireFreshPtyLiveness && !refreshedPtyLiveness?.has(pty.ptyId)) {
        continue
      }
      if (targetWorktreeId && pty.worktreeId !== targetWorktreeId) {
        continue
      }
      terminals.push(this.buildPtyTerminalSummary(pty, worktreesById))
    }

    const requestedHandles = opts.handles ? new Set(opts.handles) : null
    const matchingTerminals = requestedHandles
      ? terminals.filter((terminal) => requestedHandles.has(terminal.handle))
      : terminals
    const listedTerminals = matchingTerminals.slice(0, limit)
    const visualLayouts = this.buildTerminalVisualLayouts(
      listedTerminals,
      worktreesById,
      targetWorktreeId
    )

    return {
      terminals: listedTerminals,
      ...(visualLayouts.length > 0 ? { visualLayouts } : {}),
      topologyRevisions: Object.fromEntries(
        [...new Set(matchingTerminals.map((terminal) => terminal.worktreeId))].map((worktreeId) => [
          worktreeId,
          this.getTerminalTopologyRevision(worktreeId)
        ])
      ),
      totalCount: matchingTerminals.length,
      truncated: matchingTerminals.length > limit
    }
  }
  protected getTerminalTopologyRevision(worktreeId: string): number {
    const repoId = getRepoIdFromWorktreeId(worktreeId)
    return (
      this.getWorkspaceSessionForWorktree(worktreeId)?.terminalTopologyRevisionByRepoId?.[repoId] ??
      this.terminalTopologyRevisionByRepoId.get(repoId) ??
      0
    )
  }
  async adoptTerminalOrphans(
    request: RuntimeTerminalOrphanAdoptionRequest
  ): Promise<RuntimeTerminalOrphanAdoptionResult> {
    if (request.claims.length === 0) {
      throw new Error('terminal_orphan_claims_required')
    }
    const workspace = await this.resolveTerminalWorkspaceLaunchScope(request.worktree)
    const resolvedWorkspace = workspace.folderWorkspace
      ? this.folderWorkspaceToResolvedWorktree(workspace.folderWorkspace)
      : await this.resolveWorktreeSelector(`id:${workspace.id}`)
    const inventory = await this.refreshPtyWorktreeRecordsWithControllerInventory(
      [resolvedWorkspace],
      workspace.id,
      undefined,
      workspace.connectionId ?? null
    )
    if (!inventory) {
      throw new Error('terminal_liveness_unavailable')
    }
    return this.adoptTerminalOrphansFromInventory(request, workspace, inventory)
  }
}
import { DEFAULT_TERMINAL_LIST_LIMIT } from './orca-runtime-tail-constants'
