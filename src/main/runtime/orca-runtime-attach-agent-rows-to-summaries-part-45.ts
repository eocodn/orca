import { isFreshNonDoneAgentStatus, type ParsedAgentStatusPayload, type Project, type ProjectUpdateArgs, type ProjectHostSetup, type ProjectHostSetupCloneArgs, type ProjectHostSetupCreateArgs, type ProjectHostSetupCreateResult, type ProjectHostSetupDeleteArgs, type ProjectHostSetupDeleteResult, type ProjectHostSetupExistingFolderArgs, type ProjectHostSetupResult, type ProjectHostSetupUpdateArgs, type ProjectHostSetupUpdateResult, type Repo, type ProjectGroup, type FolderWorkspace, type RuntimeWorktreePsSummary, type RuntimeWorktreeAgentRow, getProjectIdForProviderIdentity, getProjectHostSetupForRepo, parsePaneKey, invalidateAuthorizedRootsCache, prepareLocalWorktreeRootForRepo, enrichMissingRepoGitRemoteIdentities, mergeWorktreeStatus, type RuntimeWorktreeSummaryPathIndex, assertProjectHostSetupHostIsSupported } from './orca-runtime-symbols'
import { OrcaRuntimeGetWorktreePsPart44 } from './orca-runtime-get-worktree-ps-part-44'

export class OrcaRuntimeAttachAgentRowsToSummariesPart45 extends OrcaRuntimeGetWorktreePsPart44 {
  protected attachAgentRowsToSummaries(
    summaries: Map<string, RuntimeWorktreePsSummary>,
    runtimeWorktreeSummaryPathIndex: RuntimeWorktreeSummaryPathIndex,
    missingRuntimeWorktreeIds: Set<string>,
    mirroredWorktreeIdByTabId: ReadonlyMap<string, string>
  ): void {
    // Why: most agents report via hooks (agent-hooks/server), not OSC, so the
    // hook snapshot is the primary source — same one the desktop sidebar reads.
    // OSC-only entries (no hook) are merged in as a fallback, keyed by paneKey.
    const rowSources = new Map<
      string,
      {
        paneKey: string
        tabId?: string
        worktreeId?: string
        state: ParsedAgentStatusPayload['state']
        agentType: string | null
        prompt: string
        lastAssistantMessage: string | null
        toolName: string | null
        toolInput: string | null
        interrupted: boolean
        stateStartedAt: number
        updatedAt: number
      }
    >()
    for (const snapshot of this.latestAgentStatusByPaneKey.values()) {
      const { payload } = snapshot
      rowSources.set(snapshot.paneKey, {
        paneKey: snapshot.paneKey,
        tabId: snapshot.tabId,
        worktreeId: snapshot.worktreeId,
        state: payload.state,
        agentType: payload.agentType ?? null,
        prompt: payload.prompt,
        lastAssistantMessage: payload.lastAssistantMessage ?? null,
        toolName: payload.toolName ?? null,
        toolInput: payload.toolInput ?? null,
        interrupted: payload.interrupted ?? false,
        stateStartedAt: snapshot.stateStartedAt,
        updatedAt: snapshot.updatedAt
      })
    }
    for (const entry of this.getAgentStatusSnapshotFn?.() ?? []) {
      const existing = rowSources.get(entry.paneKey)
      // Why: hook rows win ties, but an older cached hook must not replace a
      // fresh OSC status and make a running mobile workspace look inactive.
      if (existing && existing.updatedAt > entry.receivedAt) {
        continue
      }
      rowSources.set(entry.paneKey, {
        paneKey: entry.paneKey,
        tabId: entry.tabId,
        worktreeId: entry.worktreeId,
        state: entry.state,
        agentType: entry.agentType ?? null,
        prompt: entry.prompt,
        lastAssistantMessage: entry.lastAssistantMessage ?? null,
        toolName: entry.toolName ?? null,
        toolInput: entry.toolInput ?? null,
        interrupted: entry.interrupted ?? false,
        stateStartedAt: entry.stateStartedAt,
        updatedAt: entry.receivedAt
      })
    }
    if (rowSources.size === 0) {
      return
    }
    const orchestrationByPaneKey = this.buildAgentOrchestrationByPaneKey()
    const rowsByWorktree = new Map<string, RuntimeWorktreeAgentRow[]>()
    const now = Date.now()
    for (const src of rowSources.values()) {
      // Why: hooks retain launch-time attribution across automatic workspace
      // renames; the tab's current mirrored owner is authoritative when present.
      const tabId = src.tabId ?? parsePaneKey(src.paneKey)?.tabId
      const worktreeId =
        (tabId ? mirroredWorktreeIdByTabId.get(tabId) : undefined) ?? src.worktreeId
      if (!worktreeId) {
        continue
      }
      const summary = this.getSummaryForRuntimeWorktreeId(
        summaries,
        runtimeWorktreeSummaryPathIndex,
        missingRuntimeWorktreeIds,
        worktreeId
      )
      if (!summary) {
        continue
      }
      const taskTitle = orchestrationByPaneKey?.[src.paneKey]?.taskTitle ?? null
      const displayName = orchestrationByPaneKey?.[src.paneKey]?.displayName ?? null
      const row: RuntimeWorktreeAgentRow = {
        paneKey: src.paneKey,
        parentPaneKey: orchestrationByPaneKey?.[src.paneKey]?.parentPaneKey ?? null,
        state: src.state,
        agentType: src.agentType,
        prompt: src.prompt,
        taskTitle,
        displayName,
        lastAssistantMessage: src.lastAssistantMessage,
        toolName: src.toolName,
        toolInput: src.toolInput,
        interrupted: src.interrupted,
        stateStartedAt: src.stateStartedAt,
        updatedAt: src.updatedAt
      }
      // Why: SSH/runtime projections can spell an equivalent path differently;
      // bucket by the canonical summary id so mobile keeps the agent activity.
      const rows = rowsByWorktree.get(summary.worktreeId)
      if (rows) {
        rows.push(row)
      } else {
        rowsByWorktree.set(summary.worktreeId, [row])
      }
    }
    for (const [worktreeId, rows] of rowsByWorktree) {
      // Oldest-started first, matching the desktop dashboard's start-order sort.
      rows.sort((a, b) => a.stateStartedAt - b.stateStartedAt)
      const summary = summaries.get(worktreeId)
      if (summary) {
        summary.agents = rows
        for (const row of rows) {
          if (!isFreshNonDoneAgentStatus(row, now)) {
            continue
          }
          // Why: worktree.ps is mobile's host-sidebar parity source, so a live
          // agent must survive the same temporary PTY gaps as desktop.
          summary.hasHostSidebarActivity = true
          summary.status = mergeWorktreeStatus(
            summary.status,
            row.state === 'working' ? 'working' : 'permission'
          )
        }
      }
    }
  }
  listRepos(): Repo[] {
    return this.store?.getRepos() ?? []
  }
  enrichMissingRepoGitRemoteIdentities(): void {
    if (!this.store) {
      return
    }
    enrichMissingRepoGitRemoteIdentities(this.store, {
      onChanged: () => {
        this.invalidateResolvedWorktreeCache()
        this.notifyReposChanged()
      }
    })
  }
  listProjects(): Project[] {
    return this.store?.getProjects?.() ?? []
  }
  updateProject(projectId: string, updates: ProjectUpdateArgs['updates']): Project {
    if (!this.store?.updateProject) {
      throw new Error('runtime_unavailable')
    }
    const project = this.store.updateProject(projectId, updates)
    if (!project) {
      throw new Error(`Project not found: ${projectId}`)
    }
    this.invalidateResolvedWorktreeCache()
    this.notifyReposChanged()
    return project
  }
  listProjectHostSetups(): ProjectHostSetup[] {
    return this.store?.getProjectHostSetups?.() ?? []
  }
  createProjectHostSetup(args: ProjectHostSetupCreateArgs): ProjectHostSetupCreateResult {
    if (!this.store?.createProjectHostSetup) {
      throw new Error('runtime_unavailable')
    }
    const result = this.store.createProjectHostSetup(args)
    if (!result) {
      throw new Error(`Project not found: ${args.projectId}`)
    }
    return result
  }
  async setupProjectExistingFolder(
    args: ProjectHostSetupExistingFolderArgs
  ): Promise<ProjectHostSetupResult> {
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }
    assertProjectHostSetupHostIsSupported(args.hostId)
    const knownRepoIds = new Set(this.listRepos().map((repo) => repo.id))
    const repo = await this.addRepo(
      args.path,
      args.kind === 'folder' ? 'folder' : 'git',
      args.hostId
    )
    return this.completeProjectHostSetup(args, repo, !knownRepoIds.has(repo.id))
  }
  async setupProjectClone(args: ProjectHostSetupCloneArgs): Promise<ProjectHostSetupResult> {
    // Why: guard before cloneRepo, which would otherwise clone to the local disk.
    assertProjectHostSetupHostIsSupported(args.hostId)
    const knownRepoIds = new Set(this.listRepos().map((repo) => repo.id))
    const repo = await this.cloneRepo(args.url, args.destination, args.hostId)
    return this.completeProjectHostSetup(
      { ...args, path: repo.path, kind: 'git', setupMethod: 'cloned' },
      repo,
      !knownRepoIds.has(repo.id)
    )
  }
  protected completeProjectHostSetup(
    args: ProjectHostSetupExistingFolderArgs,
    initialRepo: Repo,
    repoWasCreated: boolean
  ): ProjectHostSetupResult {
    try {
      return this.linkRepoToProjectHostSetup(args, initialRepo)
    } catch (err) {
      if (repoWasCreated) {
        // Why: a failed link must not leave a new repo registration or stale host caches behind.
        this.store?.removeProject?.(initialRepo.id)
        this.invalidateResolvedWorktreeCache()
        this.invalidateWorktreeScanCacheForRepo(initialRepo.id)
        invalidateAuthorizedRootsCache()
        this.notifyReposChanged()
      }
      throw err
    }
  }
  protected linkRepoToProjectHostSetup(
    args: ProjectHostSetupExistingFolderArgs,
    initialRepo: Repo
  ): ProjectHostSetupResult {
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }
    let repo = initialRepo
    let setup = getProjectHostSetupForRepo(this.listProjectHostSetups(), repo)
    if (setup.projectId !== args.projectId) {
      const existingProject = this.listProjects().find((project) => project.id === args.projectId)
      // Why: the selected project can exist only on the source host, so its structured identity travels with the request.
      const identity = existingProject?.providerIdentity ?? args.projectProviderIdentity
      if (!identity || getProjectIdForProviderIdentity(identity) !== args.projectId) {
        throw new Error('Imported folder does not match the selected project identity.')
      }
      const updated = this.store.updateRepo(repo.id, {
        upstream: {
          owner: identity.owner,
          repo: identity.repo,
          ...(identity.host ? { host: identity.host } : {})
        }
      })
      if (!updated) {
        throw new Error(`Project setup repo disappeared before it could be linked: ${repo.id}`)
      }
      repo = updated

      setup = getProjectHostSetupForRepo(this.listProjectHostSetups(), repo)
    }
    const setupMethod = args.setupMethod ?? 'imported-existing-folder'
    const updated = this.store.updateRepo(repo.id, { projectHostSetupMethod: setupMethod })
    if (!updated) {
      throw new Error(
        `Project setup repo disappeared before setup metadata could be linked: ${repo.id}`
      )
    }
    repo = updated
    setup = getProjectHostSetupForRepo(this.listProjectHostSetups(), repo)
    const project = this.listProjects().find((entry) => entry.id === setup.projectId)
    if (!project) {
      throw new Error(`Project setup was created without a project record: ${setup.projectId}`)
    }
    return { project, setup, repo }
  }
  updateProjectHostSetup(args: ProjectHostSetupUpdateArgs): ProjectHostSetupUpdateResult {
    if (!this.store?.updateProjectHostSetup) {
      throw new Error('runtime_unavailable')
    }
    const result = this.store.updateProjectHostSetup(args)
    if (!result) {
      throw new Error(`Project host setup not found: ${args.setupId}`)
    }
    if ('worktreeBasePath' in args.updates && result.repo) {
      void prepareLocalWorktreeRootForRepo(this.store, result.repo)
      invalidateAuthorizedRootsCache()
    }
    return result
  }
  deleteProjectHostSetup(args: ProjectHostSetupDeleteArgs): ProjectHostSetupDeleteResult {
    if (!this.store?.deleteProjectHostSetup) {
      throw new Error('runtime_unavailable')
    }
    const result = this.store.deleteProjectHostSetup(args)
    if (!result) {
      throw new Error(`Project host setup not found: ${args.setupId}`)
    }
    return result
  }
  listProjectGroups(): ProjectGroup[] {
    return this.store?.getProjectGroups?.() ?? []
  }
  listFolderWorkspaces(): FolderWorkspace[] {
    return this.store?.getFolderWorkspaces?.() ?? []
  }
  async createProjectGroup(input: {
    name: string
    parentPath?: string | null
    connectionId?: string | null
    parentGroupId?: string | null
    createdFrom?: ProjectGroup['createdFrom']
  }): Promise<ProjectGroup> {
    if (!this.store?.createProjectGroup) {
      throw new Error('runtime_unavailable')
    }
    const group = this.store.createProjectGroup({
      name: input.name,
      parentPath: input.parentPath ?? null,
      connectionId: input.connectionId ?? null,
      parentGroupId: input.parentGroupId ?? null,
      createdFrom: input.createdFrom ?? 'manual'
    })
    this.notifyReposChanged()
    return group
  }
  async updateProjectGroup(
    groupId: string,
    updates: Partial<Pick<ProjectGroup, 'name' | 'isCollapsed' | 'tabOrder' | 'color'>>
  ): Promise<ProjectGroup | null> {
    if (!this.store?.updateProjectGroup) {
      throw new Error('runtime_unavailable')
    }
    const updated = this.store.updateProjectGroup(groupId, updates)
    if (updated) {
      this.notifyReposChanged()
    }
    return updated
  }
  async deleteProjectGroup(groupId: string): Promise<{ deleted: boolean }> {
    if (!this.store?.deleteProjectGroup) {
      throw new Error('runtime_unavailable')
    }
    const deleted = this.store.deleteProjectGroup(groupId)
    if (deleted) {
      this.notifyReposChanged()
    }
    return { deleted }
  }
  async moveProjectToGroup(
    repoSelector: string,
    groupId: string | null,
    order?: number
  ): Promise<Repo> {
    if (!this.store?.moveProjectToGroup) {
      throw new Error('runtime_unavailable')
    }
    const repo = await this.resolveRepoSelector(repoSelector)
    const moved = this.store.moveProjectToGroup(repo.id, groupId, order)
    if (!moved) {
      throw new Error('repo_not_found')
    }
    this.notifyReposChanged()
    return moved
  }
}
