import { homedir, type FolderWorkspace, HEADLESS_RUNTIME_WINDOW_ID, WORKTREE_ID_SEPARATOR, splitWorktreeIdForFilesystem, resolveTerminalStartupCwd, folderWorkspaceKey, parseWorkspaceKey, folderWorkspaceToWorktree, FLOATING_TERMINAL_WORKTREE_ID, getSshFilesystemProvider, assertFolderWorkspacePathUsable, getFolderWorkspacePathStatus, inferFolderWorkspacePathConnection, branchSelectorMatches, getExplicitWorktreeIdSelector, runtimePathsEqual, runtimeWorktreeIdsEqual, type ResolvedWorktree, AGENT_HOOK_RUNTIME_ENV_KEYS, type TerminalWorkspaceLaunchScope, WorktreeIdRequiresFullPathError } from './orca-runtime-symbols'
import { OrcaRuntimeSleepResolvedWorktreeTerminalsPart68 } from './orca-runtime-sleep-resolved-worktree-terminals-part-68'

export class OrcaRuntimeGetLivePtyIdsForWorktreePart69 extends OrcaRuntimeSleepResolvedWorktreeTerminalsPart68 {
  protected getLivePtyIdsForWorktree(
    worktreeId: string,
    freshPtyIds?: ReadonlySet<string>
  ): Set<string> {
    const ptyIds = new Set<string>()
    for (const leaf of this.leaves.values()) {
      if (
        runtimeWorktreeIdsEqual(leaf.worktreeId, worktreeId) &&
        leaf.connected &&
        leaf.ptyId &&
        (!freshPtyIds || freshPtyIds.has(leaf.ptyId))
      ) {
        ptyIds.add(leaf.ptyId)
      }
    }
    for (const pty of this.ptysById.values()) {
      if (
        runtimeWorktreeIdsEqual(pty.worktreeId, worktreeId) &&
        pty.connected &&
        (!freshPtyIds || freshPtyIds.has(pty.ptyId))
      ) {
        ptyIds.add(pty.ptyId)
      }
    }
    return ptyIds
  }
  protected getTerminalHandlesForPtyId(ptyId: string): string[] {
    const handles = new Set<string>(
      this.getLeavesForPty(ptyId)
        .filter((candidate) => candidate.connected)
        .map((leaf) => this.issueHandle(leaf))
    )
    const runtimeHandle = this.handleByPtyId.get(ptyId)
    if (runtimeHandle) {
      handles.add(runtimeHandle)
    }
    const pty = this.getOrCreatePtyWorktreeRecord(ptyId)
    if (!pty) {
      throw Object.assign(new Error('terminal_worktree_sleep_handle_unavailable'), { ptyId })
    }
    if (handles.size === 0) {
      handles.add(this.issuePtyHandle(pty))
    }
    return [...handles].sort()
  }
  protected getRecordedTerminalSleepHandles(
    ptyIds: Iterable<string>,
    terminalHandlesByPtyId: Readonly<Record<string, readonly string[]>>
  ): string[] {
    return [...new Set([...ptyIds].flatMap((ptyId) => terminalHandlesByPtyId[ptyId] ?? []))].sort()
  }
  protected commitWorktreeTerminalSleepPtys(args: {
    worktreeId: string
    generation: number
    ptyIds: readonly string[]
    pendingPtyIds: Set<string>
    committedPtyIds: Set<string>
    terminalHandlesByPtyId: Readonly<Record<string, readonly string[]>>
  }): void {
    const newlyCommittedPtyIds = [...new Set(args.ptyIds)]
      .filter((ptyId) => !args.committedPtyIds.has(ptyId))
      .sort()
    for (const ptyId of newlyCommittedPtyIds) {
      args.pendingPtyIds.delete(ptyId)
      args.committedPtyIds.add(ptyId)
    }
    if (newlyCommittedPtyIds.length === 0) {
      return
    }
    this.emitClientEvent({
      type: 'worktreeTerminalSleepState',
      worktreeId: args.worktreeId,
      generation: args.generation,
      phase: 'committed',
      ptyIds: newlyCommittedPtyIds,
      terminalHandles: this.getRecordedTerminalSleepHandles(
        newlyCommittedPtyIds,
        args.terminalHandlesByPtyId
      )
    })
  }
  async hasTerminalsForWorktree(worktreeSelector: string): Promise<boolean> {
    const graphEpoch = this.captureReadyGraphEpoch()
    const worktree = await this.resolveWorktreeSelector(worktreeSelector)
    this.assertStableReadyGraph(graphEpoch)
    for (const leaf of this.leaves.values()) {
      if (leaf.worktreeId === worktree.id && leaf.ptyId) {
        return true
      }
    }
    for (const pty of this.ptysById.values()) {
      if (pty.worktreeId === worktree.id && pty.connected) {
        return true
      }
    }
    return false
  }
  markRendererReloading(windowId: number): void {
    if (windowId !== this.authoritativeWindowId) {
      return
    }
    if (this.graphStatus !== 'ready') {
      return
    }
    // Why: a renderer reload tears down the live graph, so live handles must go stale immediately, not be reused against the rebuild.
    this.rendererGraphEpoch += 1
    this.graphStatus = 'reloading'
    this.setTerminalSideEffectConsumerAvailable(false)
    this.rememberDetachedPreAllocatedLeaves()
    this.handles.clear()
    this.handleByLeafKey.clear()
    // Why: handleByPtyId (pre-allocated CLI handles) survives reloads so CLI agents keep control; adoptPreAllocatedHandle re-links on the new graph.
    this.rejectAllWaiters('terminal_handle_stale')
    this.refreshWritableFlags()
  }
  markGraphReady(windowId: number): void {
    if (windowId !== this.authoritativeWindowId) {
      return
    }
    this.graphStatus = 'ready'
    this.setTerminalSideEffectConsumerAvailable(windowId !== HEADLESS_RUNTIME_WINDOW_ID)
    this.refreshWritableFlags()
  }
  markGraphUnavailable(windowId: number): void {
    if (windowId !== this.authoritativeWindowId) {
      return
    }
    // Why: once the authoritative renderer graph disappears, fail closed for live-terminal ops instead of guessing from old state.
    if (this.graphStatus !== 'unavailable') {
      this.rendererGraphEpoch += 1
    }
    this.graphStatus = 'unavailable'
    this.setTerminalSideEffectConsumerAvailable(false)
    this.authoritativeWindowId = null
    this.rememberDetachedPreAllocatedLeaves()
    this.tabs.clear()
    this.leaves.clear()
    this.leavesByPtyId.clear()
    this.handles.clear()
    this.handleByLeafKey.clear()
    // Why: pre-allocated CLI handles must survive graph unavailability so they can be re-adopted on reconnect.
    this.rejectAllWaiters('terminal_handle_stale')
  }
  protected assertGraphReady(): void {
    if (this.graphStatus !== 'ready') {
      throw new Error('runtime_unavailable')
    }
  }
  protected captureReadyGraphEpoch(): number {
    this.assertGraphReady()
    return this.rendererGraphEpoch
  }
  protected assertStableReadyGraph(expectedGraphEpoch: number): void {
    if (this.graphStatus !== 'ready' || this.rendererGraphEpoch !== expectedGraphEpoch) {
      throw new Error('runtime_unavailable')
    }
  }
  protected resolveFolderWorkspaceConnectionId(workspace: FolderWorkspace): string | null {
    const repos = this.store?.getRepos() ?? []
    const projectGroups = this.store?.getProjectGroups?.() ?? []
    const connection = inferFolderWorkspacePathConnection({
      folderPath: workspace.folderPath,
      projectGroupId: workspace.projectGroupId,
      connectionId: workspace.connectionId ?? null,
      projectGroups,
      repos
    })
    if (connection.kind === 'ambiguous') {
      // Why: a PTY spawns on one runtime target; mixed child-repo connections need an explicit V2 routing decision.
      throw new Error('folder_workspace_connection_ambiguous')
    }
    return connection.kind === 'ssh' ? connection.connectionId : null
  }
  protected async resolveFolderWorkspaceLaunchScope(
    selector: string
  ): Promise<TerminalWorkspaceLaunchScope | null> {
    const workspaceSelector = selector.startsWith('id:') ? selector.slice(3) : selector
    const parsed = parseWorkspaceKey(workspaceSelector)
    if (parsed?.type !== 'folder') {
      return null
    }
    const workspace = this.store
      ?.getFolderWorkspaces?.()
      .find((entry) => entry.id === parsed.folderWorkspaceId)
    if (!workspace) {
      throw new Error('selector_not_found')
    }
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }
    const status = await getFolderWorkspacePathStatus(
      this.store,
      { scope: 'folder-workspace', folderWorkspaceId: workspace.id },
      { getSshFilesystemProvider }
    )
    assertFolderWorkspacePathUsable(status)
    return {
      id: folderWorkspaceKey(workspace.id),
      path: workspace.folderPath,
      connectionId: this.resolveFolderWorkspaceConnectionId(workspace),
      repo: null,
      folderWorkspace: workspace
    }
  }
  protected folderWorkspaceToResolvedWorktree(folderWorkspace: FolderWorkspace): ResolvedWorktree {
    const worktree = folderWorkspaceToWorktree(folderWorkspace)
    return {
      ...worktree,
      parentWorktreeId: null,
      childWorktreeIds: [],
      lineage: null,
      git: {
        path: worktree.path,
        head: worktree.head,
        branch: worktree.branch,
        isBare: worktree.isBare,
        isMainWorktree: worktree.isMainWorktree
      }
    }
  }
  protected resolveWorkspaceTerminalStartupCwd(
    workspace: Pick<TerminalWorkspaceLaunchScope, 'path'>,
    requestedCwd?: string | null
  ): string | undefined {
    return resolveTerminalStartupCwd(workspace.path, requestedCwd)
  }
  protected async resolveTerminalWorkspaceLaunchScope(
    selector: string
  ): Promise<TerminalWorkspaceLaunchScope> {
    const floatingTerminalSelector =
      selector === FLOATING_TERMINAL_WORKTREE_ID ||
      selector === `id:${FLOATING_TERMINAL_WORKTREE_ID}`
    if (floatingTerminalSelector) {
      // Why: the floating sentinel is terminal-only — no backing repo/worktree record for other workspace APIs.
      return {
        id: FLOATING_TERMINAL_WORKTREE_ID,
        path: homedir(),
        connectionId: null,
        repo: null,
        folderWorkspace: null
      }
    }

    const folderScope = await this.resolveFolderWorkspaceLaunchScope(selector)
    if (folderScope) {
      return folderScope
    }

    const workspaceSelector = selector.startsWith('id:') ? selector.slice(3) : selector
    const parsed = parseWorkspaceKey(workspaceSelector)
    const worktreeSelector = parsed?.type === 'worktree' ? `id:${parsed.worktreeId}` : selector
    const worktree = await this.resolveWorktreeSelector(worktreeSelector)
    const repo = this.store?.getRepo(worktree.repoId) ?? null
    return {
      id: worktree.id,
      path: worktree.path,
      connectionId: repo?.connectionId ?? null,
      repo,
      folderWorkspace: null
    }
  }
  protected buildTerminalWorkspaceEnv(
    scope: TerminalWorkspaceLaunchScope,
    baseEnv: Record<string, string>,
    paneKey: string,
    tabId: string,
    agentTeamsEnv?: Record<string, string>
  ): Record<string, string> {
    const cleanBaseEnv = { ...baseEnv }
    for (const key of AGENT_HOOK_RUNTIME_ENV_KEYS) {
      delete cleanBaseEnv[key]
    }
    const env = {
      ...cleanBaseEnv,
      ...agentTeamsEnv,
      ...this.buildAgentHookPtyEnv?.(),
      ORCA_PANE_KEY: paneKey,
      ORCA_TAB_ID: tabId,
      ORCA_WORKTREE_ID: scope.id
    }
    if (!scope.folderWorkspace) {
      return env
    }
    return {
      ...env,
      ORCA_WORKSPACE_ID: scope.id,
      ORCA_PROJECT_GROUP_ID: scope.folderWorkspace.projectGroupId,
      ORCA_WORKSPACE_ROOT: scope.folderWorkspace.folderPath
    }
  }
  protected getValidatedExplicitWorktreeIdSelector(selector: string | undefined): string | null {
    const worktreeId = getExplicitWorktreeIdSelector(selector)
    if (
      worktreeId &&
      !worktreeId.includes(WORKTREE_ID_SEPARATOR) &&
      this.store?.getRepo(worktreeId)
    ) {
      // Why: a registered repo id is a known-invalid worktree id; reject early before fast paths or Git/SSH scans hide the mistake.
      throw new WorktreeIdRequiresFullPathError()
    }
    return worktreeId
  }
  protected async resolveWorktreeSelector(selector: string): Promise<ResolvedWorktree> {
    const explicitWorktreeId = this.getValidatedExplicitWorktreeIdSelector(selector)
    const worktrees = await this.listResolvedWorktrees()
    let candidates: ResolvedWorktree[]

    if (selector === 'active') {
      throw new Error('selector_not_found')
    }

    if (selector.startsWith('id:')) {
      const worktreeId = explicitWorktreeId ?? selector.slice(3)
      candidates = worktrees.filter((worktree) => worktree.id === worktreeId)
      if (candidates.length === 0) {
        const parsed = splitWorktreeIdForFilesystem(worktreeId)
        const repo = parsed ? this.store?.getRepo(parsed.repoId) : null
        const fallback =
          repo?.connectionId && this.store?.getWorktreeMeta(worktreeId)
            ? this.buildResolvedWorktreeFromId(worktreeId)
            : null
        if (fallback !== null) {
          candidates = [fallback]
        }
      }
    } else if (selector.startsWith('path:')) {
      candidates = worktrees.filter((worktree) =>
        runtimePathsEqual(worktree.path, selector.slice(5))
      )
      if (candidates.length > 1) {
        // Why: the same physical path can appear under multiple repo IDs; a path selector is exact, so take the first row over a dup-registration ambiguity.
        candidates = [candidates[0]]
      }
    } else if (selector.startsWith('branch:')) {
      const branchSelector = selector.slice(7)
      candidates = worktrees.filter((worktree) =>
        branchSelectorMatches(worktree.branch, branchSelector)
      )
    } else if (selector.startsWith('name:')) {
      // Keep display-name matching exact so duplicate names hit the same ambiguity path as other selectors.
      candidates = worktrees.filter((worktree) => worktree.displayName === selector.slice(5))
    } else if (selector.startsWith('issue:')) {
      candidates = worktrees.filter(
        (worktree) =>
          worktree.linkedIssue !== null && String(worktree.linkedIssue) === selector.slice(6)
      )
    } else {
      candidates = worktrees.filter(
        (worktree) =>
          worktree.id === selector ||
          runtimePathsEqual(worktree.path, selector) ||
          branchSelectorMatches(worktree.branch, selector)
      )
    }

    if (candidates.length === 1) {
      return candidates[0]
    }
    if (candidates.length > 1) {
      throw new Error('selector_ambiguous')
    }
    throw new Error('selector_not_found')
  }
}
