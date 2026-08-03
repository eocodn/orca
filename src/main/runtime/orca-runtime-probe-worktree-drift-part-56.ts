import { gitExecFileAsync, type GitHubPrStartPoint, type GitPushTarget, type Repo, type WorktreeMeta, isFolderRepo, worktreeWorkspaceKey, resolveGitHubPrStartPoint, fetchGitHubPullRequestHeadRef, fetchPrHeadTrackingRef, resolveGitHubReviewHeadRemote, getLocalProjectGitExecOptions, getLocalProjectWorktreeGitOptions, getBaseRefDefault, getRemoteDrift, getRecentDriftSubjects, stripOrcaProvenanceMetaUpdates, requireSshGitProvider, omitUndefinedProperties, DRIFT_PROBE_SUBJECT_LIMIT, RuntimeLineageError } from './orca-runtime-symbols'
import { OrcaRuntimeGetCanonicalFetchKeyPart55 } from './orca-runtime-get-canonical-fetch-key-part-55'

export class OrcaRuntimeProbeWorktreeDriftPart56 extends OrcaRuntimeGetCanonicalFetchKeyPart55 {
  async probeWorktreeDrift(worktreeSelector: string): Promise<{
    base: string
    behind: number
    recentSubjects: string[]
  } | null> {
    const wt = await this.resolveWorktreeSelector(worktreeSelector)
    if (!this.store) {
      return null
    }
    const repo = this.store.getRepos().find((r) => r.id === wt.repoId)
    if (!repo) {
      return null
    }
    if (repo.connectionId) {
      // Why: the drift probe uses local git helpers. Until the SSH provider
      // exposes equivalent remote refs/log plumbing, fail closed to "unknown"
      // instead of probing a server path on the desktop filesystem.
      return null
    }
    const localGitExecOptions = getLocalProjectGitExecOptions(this.requireStore(), repo)
    const localWorktreeGitOptions = getLocalProjectWorktreeGitOptions(this.requireStore(), repo)
    const meta = this.store.getWorktreeMeta(wt.id)
    const base =
      meta?.baseRef ||
      meta?.sparseBaseRef ||
      repo.worktreeBaseRef ||
      (await getBaseRefDefault(repo.path, localWorktreeGitOptions))
    if (!base) {
      // Why: brand-new repo with no remote primary — nothing to compare
      // against, so there's no meaningful drift to report. Dispatch should
      // not block on a probe that cannot form an opinion.
      return null
    }
    const remoteTrackingBase = await this.resolveRemoteTrackingBase(
      repo.path,
      base,
      localWorktreeGitOptions
    )
    if (!remoteTrackingBase) {
      return null
    }
    const remote = remoteTrackingBase.remote
    // Why: fetch failures are non-fatal; we proceed with whatever the
    // last-known remote ref points at. `fetchRemoteWithCache` never throws.
    await this.fetchRemoteWithCache(repo.path, remote, localWorktreeGitOptions)
    const drift = getRemoteDrift(wt.path, 'HEAD', base, localGitExecOptions)
    if (!drift) {
      return null
    }
    const recentSubjects = getRecentDriftSubjects(
      wt.path,
      'HEAD',
      base,
      DRIFT_PROBE_SUBJECT_LIMIT,
      localGitExecOptions
    )
    return { base, behind: drift.behind, recentSubjects }
  }
  async updateManagedWorktreeMeta(
    worktreeSelector: string,
    updates: Omit<Partial<WorktreeMeta>, 'pushTarget'> & {
      pushTarget?: GitPushTarget | null
      lineage?: {
        parentWorktree?: string
        noParent?: boolean
      }
    }
  ) {
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }
    const worktree = await this.resolveWorktreeSelector(worktreeSelector)
    const { lineage, ...metaUpdates } = updates
    if (lineage?.parentWorktree) {
      this.invalidateResolvedWorktreeCache()
      this.invalidateWorktreeScanCacheForRepo(worktree.repoId)
    }
    const shouldClearPushTarget =
      Object.prototype.hasOwnProperty.call(metaUpdates, 'pushTarget') &&
      metaUpdates.pushTarget === null
    const normalizedMetaUpdates: Partial<WorktreeMeta> = shouldClearPushTarget
      ? { ...metaUpdates, pushTarget: undefined }
      : (metaUpdates as Partial<WorktreeMeta>)
    const persistedMetaUpdates: Partial<WorktreeMeta> = omitUndefinedProperties(
      normalizedMetaUpdates.displayName !== undefined
        ? {
            ...normalizedMetaUpdates,
            pendingFirstAgentMessageRename: false,
            firstAgentMessageRenameError: null
          }
        : normalizedMetaUpdates
    )
    if (shouldClearPushTarget) {
      // Why: omitUndefinedProperties protects ordinary optional RPC fields, but
      // pushTarget:null is an explicit request to remove persisted target metadata.
      persistedMetaUpdates.pushTarget = undefined
    }
    if (lineage?.noParent === true) {
      this.store.removeWorktreeLineage?.(worktree.id)
      this.store.removeWorkspaceLineage?.(worktreeWorkspaceKey(worktree.id))
    } else if (lineage?.parentWorktree) {
      const parent = await this.resolveWorktreeSelector(lineage.parentWorktree)

      this.validateLineageParent(worktree, parent)
      if (!worktree.instanceId || !parent.instanceId) {
        throw new RuntimeLineageError(
          'LINEAGE_PARENT_CONTEXT_MISSING',
          'Worktree instance identity was unavailable.'
        )
      }
      if (!this.store.setWorktreeLineage) {
        throw new RuntimeLineageError(
          'LINEAGE_PARENT_CONTEXT_MISSING',
          'Worktree lineage storage was unavailable.'
        )
      }
      const createdAt = Date.now()
      this.store.setWorktreeLineage(worktree.id, {
        worktreeId: worktree.id,
        worktreeInstanceId: worktree.instanceId,
        parentWorktreeId: parent.id,
        parentWorktreeInstanceId: parent.instanceId,
        origin: 'manual',
        capture: { source: 'manual-action', confidence: 'explicit' },
        createdAt
      })
      this.store.setWorkspaceLineage?.({
        childWorkspaceKey: worktreeWorkspaceKey(worktree.id),
        childInstanceId: worktree.instanceId,
        parentWorkspaceKey: worktreeWorkspaceKey(parent.id),
        parentInstanceId: parent.instanceId,
        origin: 'manual',
        capture: { source: 'manual-action', confidence: 'explicit' },
        createdAt
      })
    }
    this.store.setWorktreeMeta(worktree.id, stripOrcaProvenanceMetaUpdates(persistedMetaUpdates))
    // Why: unlike renderer-initiated optimistic updates, CLI callers need an
    // explicit push so the editor refreshes metadata changed outside the UI.
    this.invalidateResolvedWorktreeCache()
    this.notifyWorktreesChanged(worktree.repoId)
    return await this.showManagedWorktree(`id:${worktree.id}`)
  }
  persistManagedWorktreeSortOrder(orderedIds: string[]): { updated: number } {
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }
    const now = Date.now()
    let updated = 0
    for (let i = 0; i < orderedIds.length; i++) {
      // Why: a sort-order snapshot must only reorder existing worktrees, never
      // mint new meta — a stale id would otherwise resurrect an orphan workspace
      // (setWorktreeMeta has no repo-existence check).
      if (!this.store.getWorktreeMeta(orderedIds[i])) {
        continue
      }
      this.store.setWorktreeMeta(orderedIds[i], { sortOrder: now - i * 1000 })
      updated++
    }
    this.invalidateResolvedWorktreeCache()
    this.notifyReposChanged()
    return { updated }
  }
  async resolveManagedPrBase(args: {
    repoSelector: string
    prNumber: number
    headRefName?: string
    baseRefName?: string
    isCrossRepository?: boolean
  }): Promise<GitHubPrStartPoint | { error: string }> {
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }
    let repo: Repo
    try {
      repo = await this.resolveRepoSelector(args.repoSelector)
    } catch {
      return { error: 'Repo not found' }
    }
    if (isFolderRepo(repo)) {
      return { error: 'Folder mode does not support creating worktrees.' }
    }
    const sshGitProvider = repo.connectionId ? requireSshGitProvider(repo.connectionId) : null
    const localGitExecOptions = sshGitProvider
      ? undefined
      : getLocalProjectGitExecOptions(this.requireStore(), repo)
    const localWorktreeGitOptions = sshGitProvider
      ? {}
      : getLocalProjectWorktreeGitOptions(this.requireStore(), repo)
    const gitExec = sshGitProvider
      ? (gitArgs: string[]) => sshGitProvider.exec(gitArgs, repo.path)
      : (gitArgs: string[]) => gitExecFileAsync(gitArgs, localGitExecOptions ?? { cwd: repo.path })
    // Why: one resolver keeps source preference and hosting identity aligned
    // across local, WSL, and SSH worktree creation.
    const resolveRemote = (): Promise<string> =>
      resolveGitHubReviewHeadRemote({
        repoPath: repo.path,
        issueSourcePreference: repo.issueSourcePreference,
        connectionId: repo.connectionId ?? null,
        localGitOptions: localWorktreeGitOptions,
        gitExec
      })

    // Why: SSH review-head fetches require narrow write-capable RPCs.
    const fetchRemoteTrackingRef = (remote: string, branch: string): Promise<void> =>
      fetchPrHeadTrackingRef(
        repo,
        sshGitProvider,
        remote,
        branch,
        localGitExecOptions ? { localGitExecOptions } : {}
      )
    const fetchPullRequestHeadRef = (remote: string, prNumber: number): Promise<string> =>
      fetchGitHubPullRequestHeadRef(
        repo,
        sshGitProvider,
        remote,
        prNumber,
        localGitExecOptions ? { localGitExecOptions } : {}
      )

    return resolveGitHubPrStartPoint({
      repoPath: repo.path,
      prNumber: args.prNumber,
      headRefName: args.headRefName,
      baseRefName: args.baseRefName,
      isCrossRepository: args.isCrossRepository,
      issueSourcePreference: repo.issueSourcePreference,
      connectionId: repo.connectionId ?? null,
      localGitOptions: localWorktreeGitOptions,
      gitExec,
      fetchRemoteTrackingRef,
      fetchPullRequestHeadRef,
      resolveRemote
    })
  }
}
