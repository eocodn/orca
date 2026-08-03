import { gitExecFileAsync, type GitPushTarget, type Repo, type RemoveWorktreeResult, getRepoExecutionHostId, isFolderRepo, advertisedUrlWatcher, gitlabMergeRequestHeadLocalRef, reviewHeadRemoteRefComponent, fetchGitLabMergeRequestHeadRef, isTransientReviewHeadFetchError, fetchCompareBaseRefWithLocalFallback, pickPreferredGitRemote, getGitLabProjectRefForRemote, getGitLabWorkItemByProjectRef, getGlabKnownHosts, getLocalProjectGitExecOptions, getLocalProjectWorktreeGitOptions, getDefaultRemote, deleteWorktreeHistoryDir, requireSshGitProvider, parseExactWorktreeIdSelector, type RuntimeWorktreeRemovalTarget, type RuntimeStore } from './orca-runtime-symbols'
import { OrcaRuntimeProbeWorktreeDriftPart56 } from './orca-runtime-probe-worktree-drift-part-56'

export class OrcaRuntimeResolveManagedMrBasePart57 extends OrcaRuntimeProbeWorktreeDriftPart56 {
  async resolveManagedMrBase(args: {
    repoSelector: string
    mrIid: number
    sourceBranch?: string
    targetBranch?: string
    isCrossRepository?: boolean
  }): Promise<
    { baseBranch: string; compareBaseRef?: string; pushTarget?: GitPushTarget } | { error: string }
  > {
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

    let sourceBranch = args.sourceBranch?.trim() ?? ''
    let targetBranch = args.targetBranch?.trim() ?? ''
    let isCrossRepository = args.isCrossRepository === true

    if (!sourceBranch) {
      let remote: string
      try {
        remote = await this.resolveGitLabIssueSourceRemote(
          repo.path,
          repo.issueSourcePreference,
          repo.connectionId ?? null,
          localWorktreeGitOptions
        )
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Could not resolve git remote.' }
      }
      const knownHosts = await getGlabKnownHosts(repo.connectionId ?? null, localWorktreeGitOptions)
      const projectRef = await getGitLabProjectRefForRemote(
        repo.path,
        remote,
        knownHosts,
        repo.connectionId ?? null,
        localWorktreeGitOptions
      )
      if (!projectRef) {
        return { error: 'No GitLab project found for this repository.' }
      }
      const item = await getGitLabWorkItemByProjectRef(
        repo.path,
        projectRef,
        args.mrIid,
        'mr',
        repo.connectionId ?? null,
        localWorktreeGitOptions
      )
      if (!item || item.type !== 'mr') {
        return { error: `MR !${args.mrIid} not found.` }
      }
      sourceBranch = (item.branchName ?? '').trim()
      targetBranch = (item.baseRefName ?? '').trim()
      if (!sourceBranch) {
        return { error: `MR !${args.mrIid} has no source branch.` }
      }
      if (item.isCrossRepository === true) {
        isCrossRepository = true
      }
    }

    let remote: string
    try {
      remote = await this.resolveGitLabIssueSourceRemote(
        repo.path,
        repo.issueSourcePreference,
        repo.connectionId ?? null,
        localWorktreeGitOptions
      )
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Could not resolve git remote.' }
    }
    const compareBaseRef = targetBranch ? `refs/remotes/${remote}/${targetBranch}` : undefined
    const fetchRemoteTrackingRef = async (branch: string, ref: string): Promise<void> => {
      await (sshGitProvider
        ? sshGitProvider.fetchRemoteTrackingRef(repo.path, remote, branch, ref)
        : gitExec(['fetch', remote, `+refs/heads/${branch}:${ref}`]))
    }
    // Why: the target/compare branch is optional (it only powers the diff
    // base). A merged MR may have had its target ref deleted, so a fetch
    // failure must NOT abort the whole resolution — that would discard the
    // already-verified source-branch base and silently fall back to the repo
    // default branch. Degrade gracefully by dropping compareBaseRef instead.
    const fetchCompareBaseRef = (): Promise<boolean> =>
      fetchCompareBaseRefWithLocalFallback({
        compareBaseRef,
        fetchCompareBaseRef: (ref) => fetchRemoteTrackingRef(targetBranch, ref),
        gitExec,
        logLabel: '[runtime:resolveManagedMrBase]',
        logContext: { remote, targetBranch, mrIid: args.mrIid }
      })

    if (isCrossRepository) {
      const mrRef = `refs/merge-requests/${args.mrIid}/head`
      // Why: soft-keep needs identity when the fetch throws before returning a path.
      // Success uses the path returned by the fetch itself (writer-authoritative).
      let softKeepLocalRefPromise: Promise<string | null> | undefined
      const resolveSoftKeepLocalRef = (): Promise<string | null> => {
        softKeepLocalRefPromise ??= (async () => {
          try {
            const { stdout } = await gitExec(['remote', 'get-url', remote])
            const remoteUrl = stdout.trim()
            if (!remoteUrl) {
              return null
            }
            return gitlabMergeRequestHeadLocalRef(
              reviewHeadRemoteRefComponent(remote, remoteUrl),
              args.mrIid
            )
          } catch {
            return null
          }
        })()
        return softKeepLocalRefPromise
      }
      const resolveDurableHeadSha = async (localRef: string | null): Promise<string | null> => {
        if (!localRef) {
          return null
        }
        try {
          const { stdout } = await gitExec(['rev-parse', '--verify', `${localRef}^{commit}`])
          return stdout.trim() || null
        } catch {
          return null
        }
      }
      try {
        const localRef = await fetchGitLabMergeRequestHeadRef(
          repo,
          sshGitProvider,
          remote,
          args.mrIid,
          localGitExecOptions ? { localGitExecOptions } : {}
        )
        const sha = await resolveDurableHeadSha(localRef)
        if (!sha) {
          return { error: `Could not resolve fork MR !${args.mrIid} head after fetch.` }
        }
        const compareBaseFetched = await fetchCompareBaseRef()
        return { baseBranch: sha, ...(compareBaseFetched ? { compareBaseRef } : {}) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // Why: mirror compare-base — a transient transport failure must not fail
        // the resolve when a prior fetch already pinned the durable head ref. A
        // missing remote ref (deleted MR/fork), auth failure, or stale-relay
        // error must fail hard: serving the durable ref there would check out a
        // dead or unauthorized tip and mask the actionable error.
        if (isTransientReviewHeadFetchError(error)) {
          const localSha = await resolveDurableHeadSha(await resolveSoftKeepLocalRef())
          if (localSha) {
            console.warn(
              '[runtime:resolveManagedMrBase] MR head fetch failed; using durable local ref',
              {
                remote,
                mrIid: args.mrIid,
                error: message.split('\n')[0]
              }
            )
            const compareBaseFetched = await fetchCompareBaseRef()
            return { baseBranch: localSha, ...(compareBaseFetched ? { compareBaseRef } : {}) }
          }
        }
        return { error: `Failed to fetch ${mrRef}: ${message.split('\n')[0]}` }
      }
    }

    try {
      await fetchRemoteTrackingRef(sourceBranch, `refs/remotes/${remote}/${sourceBranch}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { error: `Failed to fetch ${remote}/${sourceBranch}: ${message.split('\n')[0]}` }
    }

    const remoteRef = `${remote}/${sourceBranch}`
    try {
      await gitExec(['rev-parse', '--verify', remoteRef])
    } catch {
      return { error: `Remote ref ${remoteRef} does not exist after fetch.` }
    }
    const compareBaseFetched = await fetchCompareBaseRef()
    return {
      baseBranch: remoteRef,
      ...(compareBaseFetched ? { compareBaseRef } : {}),
      pushTarget: { remoteName: remote, branchName: sourceBranch }
    }
  }
  protected async resolveGitLabIssueSourceRemote(
    repoPath: string,
    preference?: Repo['issueSourcePreference'],
    connectionId?: string | null,
    localGitOptions: { wslDistro?: string } = {}
  ): Promise<string> {
    const knownHosts = await getGlabKnownHosts(connectionId, localGitOptions)
    const localGitOptionArgs =
      Object.keys(localGitOptions).length > 0 ? ([localGitOptions] as const) : []
    if (preference === 'origin') {
      const origin = await getGitLabProjectRefForRemote(
        repoPath,
        'origin',
        knownHosts,
        connectionId,
        ...localGitOptionArgs
      )
      if (origin) {
        return 'origin'
      }
      throw new Error('No GitLab project found for origin.')
    }
    if (preference === 'upstream') {
      const upstream = await getGitLabProjectRefForRemote(
        repoPath,
        'upstream',
        knownHosts,
        connectionId,
        ...localGitOptionArgs
      )
      if (upstream) {
        return 'upstream'
      }
      const origin = await getGitLabProjectRefForRemote(
        repoPath,
        'origin',
        knownHosts,
        connectionId,
        ...localGitOptionArgs
      )
      if (origin) {
        return 'origin'
      }
      throw new Error('No GitLab project found for upstream or origin.')
    }
    const upstream = await getGitLabProjectRefForRemote(
      repoPath,
      'upstream',
      knownHosts,
      connectionId,
      ...localGitOptionArgs
    )
    if (upstream) {
      return 'upstream'
    }
    const origin = await getGitLabProjectRefForRemote(
      repoPath,
      'origin',
      knownHosts,
      connectionId,
      ...localGitOptionArgs
    )
    if (origin) {
      return 'origin'
    }
    if (connectionId) {
      const provider = requireSshGitProvider(connectionId)
      const { stdout } = await provider.exec(['remote'], repoPath)
      return pickPreferredGitRemote(stdout.split('\n'))
    }
    return getDefaultRemote(repoPath, localGitOptions)
  }
  protected async resolveWorktreeRemovalTarget(
    worktreeSelector: string
  ): Promise<RuntimeWorktreeRemovalTarget> {
    try {
      const worktree = await this.resolveWorktreeSelector(worktreeSelector)
      const repo = this.store?.getRepos().find((candidate) => candidate.id === worktree.repoId)
      const removalTarget = {
        id: worktree.id,
        repoId: worktree.repoId,
        path: worktree.path,
        ...(worktree.hostId
          ? { hostId: worktree.hostId }
          : repo
            ? { hostId: getRepoExecutionHostId(repo) }
            : {})
      }
      return worktree.pushTarget
        ? { ...removalTarget, pushTarget: worktree.pushTarget }
        : removalTarget
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'selector_not_found') {
        throw error
      }
      const removalTarget = parseExactWorktreeIdSelector(worktreeSelector)
      const meta = removalTarget ? this.store?.getWorktreeMeta(removalTarget.id) : undefined
      if (!removalTarget || !meta) {
        throw error
      }
      // Why: delete requests can arrive after Git no longer lists the worktree.
      // Only exact IDs with persisted Orca metadata are accepted here so
      // branch/path selectors cannot resolve to an arbitrary missing path.
      const repo = this.store?.getRepos().find((candidate) => candidate.id === removalTarget.repoId)
      return {
        ...removalTarget,
        ...(meta.hostId
          ? { hostId: meta.hostId }
          : repo
            ? { hostId: getRepoExecutionHostId(repo) }
            : {}),
        ...(meta.pushTarget ? { pushTarget: meta.pushTarget } : {})
      }
    }
  }
  protected removeWorktreeMetadataAndHistory(store: RuntimeStore, worktreeId: string): void {
    // Why: worktree IDs are path-derived and can be recreated, so removal must
    // purge history and process-local caches before the ID points at new state.
    store.removeWorktreeMeta(worktreeId)
    advertisedUrlWatcher.forgetWorktree(worktreeId)
    deleteWorktreeHistoryDir(worktreeId)
    this.closeHeadlessBrowserPagesForWorktree(worktreeId)
  }

  // Why: headless offscreen browser pages are main-process BrowserWindows that

  // outlive a worktree unless explicitly closed — removing a worktree without
  // closing its open panes leaks the windows for the life of the serve process.
  protected closeHeadlessBrowserPagesForWorktree(worktreeId: string): void {
    if (!this.offscreenBrowserBackend || !this.agentBrowserBridge?.tabList) {
      return
    }
    for (const tab of this.agentBrowserBridge.tabList(worktreeId).tabs) {
      void this.offscreenBrowserBackend.closeTab(tab.browserPageId).catch(() => {})
    }
  }
  protected rememberPreservedBranchCleanupTarget(
    worktreeId: string,
    result: RemoveWorktreeResult | undefined,
    fallbackHead: string | undefined,
    pushTarget: GitPushTarget | undefined
  ): void {
    if (result?.preservedBranch) {
      const head = result.preservedBranch.head ?? fallbackHead
      if (!head) {
        throw new Error(
          `Cannot safely offer force-delete for preserved branch "${result.preservedBranch.branchName}" without its saved commit.`
        )
      }
      this.preservedBranchCleanupByWorktreeId.set(worktreeId, {
        branchName: result.preservedBranch.branchName,
        head,
        ...(pushTarget ? { pushTarget } : {})
      })
      return
    }
    this.preservedBranchCleanupByWorktreeId.delete(worktreeId)
  }
  protected preserveBranchHeadFallback(
    result: RemoveWorktreeResult | undefined,
    fallbackHead: string | undefined
  ): RemoveWorktreeResult {
    if (!result?.preservedBranch || result.preservedBranch.head || !fallbackHead) {
      return result ?? {}
    }
    return {
      ...result,
      preservedBranch: {
        ...result.preservedBranch,
        head: fallbackHead
      }
    }
  }
}
