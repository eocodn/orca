import { type GitWorktreeInfo, type Repo, getRepoExecutionHostId, type RuntimeSyncedLeaf, splitWorktreeId, splitWorktreeIdForFilesystem, isTerminalLeafId, makePaneKey, parseAppSshPtyId, parseWslUncPath, advertisedUrlWatcher, areWorktreePathsEqual, inferWorktreeIdFromPtyId, maxTimestamp, type RuntimePtyWorktreeRecord, type ResolvedWorktree } from './orca-runtime-symbols'
import { OrcaRuntimeListWorkspaceLineagePart71 } from './orca-runtime-list-workspace-lineage-part-71'

export class OrcaRuntimeListStoredSshWorktreesForResolutionPart72 extends OrcaRuntimeListWorkspaceLineagePart71 {
  protected listStoredSshWorktreesForResolution(repo: Repo): GitWorktreeInfo[] {
    const store = this.store
    if (!store) {
      return []
    }
    const byWorktreeId = new Map<string, GitWorktreeInfo>()
    const repoHostId = getRepoExecutionHostId(repo)
    for (const [worktreeId, meta] of Object.entries(store.getAllWorktreeMeta())) {
      const parsed = splitWorktreeId(worktreeId)
      if (!parsed || parsed.repoId !== repo.id) {
        continue
      }
      if (meta.hostId !== undefined && meta.hostId !== repoHostId) {
        continue
      }
      // Why: mirror worktrees:list's disconnected-SSH fallback — keep persisted SSH worktrees while the provider reconnects instead of zero rows.
      byWorktreeId.set(worktreeId, {
        path: parsed.worktreePath,
        head: '',
        branch: '',
        isBare: false,
        isMainWorktree: areWorktreePathsEqual(parsed.worktreePath, repo.path),
        ...(meta.sparseDirectories !== undefined ||
        meta.sparseBaseRef !== undefined ||
        meta.sparsePresetId !== undefined
          ? { isSparse: true }
          : {})
      })
    }
    return [...byWorktreeId.values()]
  }
  protected async getResolvedWorktreeMap(): Promise<Map<string, ResolvedWorktree>> {
    return new Map((await this.listResolvedWorktrees()).map((worktree) => [worktree.id, worktree]))
  }
  protected invalidateResolvedWorktreeCache(): void {
    this.worktreeResolutionState.invalidateResolved()
  }
  protected invalidateWorktreeScanCacheForRepo(repoId: string): void {
    this.worktreeResolutionState.invalidateScan(repoId)
  }
  protected invalidateSshWorktreeScanCacheInternal(targetId: string): void {
    const repos = this.store?.getRepos() ?? []
    const affectedRepoIds = new Set(
      repos.filter((repo) => repo.connectionId === targetId).map((repo) => repo.id)
    )
    for (const repoId of affectedRepoIds) {
      this.worktreeResolutionState.invalidateScan(repoId)
    }
    if (affectedRepoIds.size > 0) {
      this.worktreeResolutionState.invalidateResolved()
    }
  }

  /** Invalidate the worktree cache and tell the renderer to re-list after an out-of-band branch change so the new name surfaces immediately. */
  notifyBranchRenamed(repoId: string): void {
    this.invalidateResolvedWorktreeCache()
    this.invalidateWorktreeScanCacheForRepo(repoId)
    this.notifyWorktreesChanged(repoId)
  }

  /** Like {@link notifyBranchRenamed} but carries old->new worktree id so the renderer re-keys instead of treating the id change as a deletion. */
  notifyWorktreeFolderRenamed(repoId: string, oldWorktreeId: string, newWorktreeId: string): void {
    this.clientSessionTabSelections.migrateWorktree(oldWorktreeId, newWorktreeId)
    this.invalidateResolvedWorktreeCache()
    this.invalidateWorktreeScanCacheForRepo(repoId)
    this.notifier?.worktreesChanged(repoId, { oldWorktreeId, newWorktreeId })
    // Mirror notifyBranchRenamed so in-process onClientEvent listeners also see the rename.
    this.emitClientEvent({ type: 'worktreesChanged', repoId })
  }
  notifyFolderWorkspaceChanged(): void {
    this.invalidateResolvedWorktreeCache()
    this.notifyReposChanged()
  }
  protected recordPtyWorktree(
    ptyId: string,
    worktreeId: string,
    state: Partial<
      Pick<
        RuntimePtyWorktreeRecord,
        | 'connected'
        | 'lastOutputAt'
        | 'preview'
        | 'tabId'
        | 'paneKey'
        | 'title'
        | 'connectionId'
        | 'runtimeSessionOwned'
        | 'isWsl'
        | 'wslDistro'
        | 'incarnationId'
      >
    > = {}
  ): RuntimePtyWorktreeRecord {
    let pty = this.ptysById.get(ptyId)
    if (!pty) {
      const titleObservedAt = state.title ? this.nextTitleObservationSequence() : null
      const connectionId = state.connectionId ?? parseAppSshPtyId(ptyId)?.connectionId ?? null
      const worktreePath = splitWorktreeIdForFilesystem(worktreeId)?.worktreePath
      const fallbackWslDistro =
        process.platform === 'win32' && connectionId === null && worktreePath
          ? parseWslUncPath(worktreePath)?.distro
          : undefined
      const wslDistro =
        connectionId === null
          ? (state.wslDistro ?? this.wslDistroByPtyId.get(ptyId) ?? fallbackWslDistro ?? null)
          : null
      pty = {
        ptyId,
        incarnationId: state.incarnationId ?? null,
        worktreeId,
        connectionId,
        runtimeSessionOwned: state.runtimeSessionOwned ?? false,
        isWsl: state.isWsl ?? null,
        wslDistro,
        tabId: state.tabId ?? null,
        paneKey: state.paneKey ?? null,
        launchConfig: null,
        launchToken: null,
        launchAgent: null,
        foregroundAgent: null,
        connected: state.connected ?? true,
        disconnectedAt: state.connected === false ? Date.now() : null,
        lastExitCode: null,
        lastAgentStatus: null,
        lastOscTitle: null,
        lastOscTitleAt: null,
        managementTitle: null,
        managementTitleAt: null,
        controllerTitle: null,
        title: state.title ?? null,
        titleUpdatedAt: titleObservedAt,
        lastOutputAt: state.lastOutputAt ?? null,
        tailBuffer: [],
        tailTranscriptBuffer: [],
        tailTranscriptChars: 0,
        tailPartialLine: '',
        tailPendingAnsi: '',
        tailRedrawCursor: null,
        tailTruncated: false,
        tailLinesTotal: 0,
        preview: state.preview ?? '',
        waitBlockedAt: null
      }
      if (state.title) {
        this.setPtyManagementTitleFromObservedTitle(pty, state.title, titleObservedAt ?? 0)
      }
      this.ptysById.set(ptyId, pty)
      if (wslDistro) {
        this.wslDistroByPtyId.set(ptyId, wslDistro)
      } else if (connectionId !== null) {
        // Why: restored SSH IDs can collide with stale local parser state; connection ownership must win before their first output is parsed.
        this.wslDistroByPtyId.delete(ptyId)
      }
      // Why: restored/controller-discovered PTYs learn their worktree here without registerPty(), so URL enrichment must bind at this source.
      advertisedUrlWatcher.bindPty(ptyId, worktreeId)
      return pty
    }

    pty.worktreeId = worktreeId
    if (state.incarnationId !== undefined) {
      pty.incarnationId = state.incarnationId
    }
    if (state.connectionId !== undefined) {
      pty.connectionId = state.connectionId
      if (state.connectionId !== null) {
        pty.wslDistro = null
        this.wslDistroByPtyId.delete(ptyId)
      }
    }
    if (state.runtimeSessionOwned !== undefined) {
      pty.runtimeSessionOwned = state.runtimeSessionOwned
    }
    if (state.isWsl !== undefined) {
      pty.isWsl = state.isWsl
    }
    if (state.wslDistro !== undefined) {
      pty.wslDistro = state.wslDistro
      if (state.wslDistro) {
        this.wslDistroByPtyId.set(ptyId, state.wslDistro)
      } else {
        this.wslDistroByPtyId.delete(ptyId)
      }
    }
    if (state.tabId !== undefined) {
      pty.tabId = state.tabId
    }
    if (state.paneKey !== undefined) {
      pty.paneKey = state.paneKey
    }
    if (state.connected !== undefined) {
      pty.connected = state.connected
      pty.disconnectedAt = state.connected ? null : (pty.disconnectedAt ?? Date.now())
    }
    if (state.lastOutputAt !== undefined) {
      pty.lastOutputAt = maxTimestamp(pty.lastOutputAt, state.lastOutputAt)
    }
    if (state.preview !== undefined && state.preview.length > 0) {
      pty.preview = state.preview
    }
    if (state.title !== undefined && state.title !== null && state.title.length > 0) {
      const observedAt = this.nextTitleObservationSequence()
      pty.title = state.title
      pty.titleUpdatedAt = observedAt
      this.setPtyManagementTitleFromObservedTitle(pty, state.title, observedAt)
    }
    // Why: recordPtyWorktree is the common lifecycle point for every path that resolves a PTY's worktree (renderer restore, controller list).
    advertisedUrlWatcher.bindPty(ptyId, worktreeId)
    return pty
  }

  // Why: provider inventory/spawn may revive a PTY; renderer/mobile projections
  // may only update metadata and must never perform that lifecycle transition.
  protected recordAuthoritativePtyWorktree(
    ptyId: string,
    worktreeId: string,
    state: Partial<
      Pick<
        RuntimePtyWorktreeRecord,
        | 'lastOutputAt'
        | 'preview'
        | 'tabId'
        | 'paneKey'
        | 'title'
        | 'connectionId'
        | 'runtimeSessionOwned'
        | 'isWsl'
        | 'wslDistro'
        | 'incarnationId'
      >
    > = {}
  ): RuntimePtyWorktreeRecord {
    const wasKnown = this.ptysById.has(ptyId)
    const { incarnationId, ...metadata } = state
    const pty = this.recordPtyWorktree(ptyId, worktreeId, metadata)
    this.admitPtyLifecycle(pty, incarnationId ?? undefined, wasKnown ? {} : { adoptHandles: true })
    return pty
  }
  protected makeRuntimePaneKey(
    leaf: Pick<RuntimeSyncedLeaf, 'tabId' | 'leafId' | 'paneRuntimeId'>
  ): string {
    return isTerminalLeafId(leaf.leafId)
      ? makePaneKey(leaf.tabId, leaf.leafId)
      : `${leaf.tabId}:${leaf.paneRuntimeId}`
  }
  protected getOrCreatePtyWorktreeRecord(ptyId: string): RuntimePtyWorktreeRecord | null {
    const existing = this.ptysById.get(ptyId)
    if (existing) {
      return existing
    }
    const inferredWorktreeId = inferWorktreeIdFromPtyId(ptyId)
    if (!inferredWorktreeId) {
      return null
    }
    // Why: daemon-backed PTY session IDs are prefixed with the worktree ID so mobile summaries survive renderer graph gaps and reloads.
    return this.recordPtyWorktree(ptyId, inferredWorktreeId)
  }

  /** Synchronizes PTY tracking records with running daemon sessions, querying their foreground agent states. */
  protected async refreshPtyWorktreeRecordsFromController(
    resolvedWorktrees: ResolvedWorktree[],
    targetWorktreeId: string | null = null,
    deadline?: number
  ): Promise<Set<string> | null> {
    const inventory = await this.refreshPtyWorktreeRecordsWithControllerInventory(
      resolvedWorktrees,
      targetWorktreeId,
      deadline
    )
    return inventory ? new Set(inventory.livePtyIds) : null
  }
}
