
import type { HostQualifiedDetectedWorktreeResult, LegacyDetectedWorktreeRequest, ListDetectedWorktreesArgs, ProviderRequestId, HostRepoCatalogSnapshot, ListReposForExecutionHostArgs, HostLineageSnapshot, ListDesktopLineageForHostArgs, CreateLocalOrcaProfileArgs, CreateLocalOrcaProfileResult, CreateCloudLinkedOrcaProfileArgs, CreateCloudLinkedOrcaProfileResult, ConnectCurrentOrcaProfileResult, FindOrcaProfileProjectsByPathArgs, FindOrcaProfileProjectsByPathResult, OrcaProfileListResult, OrcaProfileAuthStatus, RefreshCurrentOrcaProfileAuthResult, SelectOrcaProfileOrgArgs, SelectOrcaProfileOrgResult, SignOutCurrentOrcaProfileResult, SwitchOrcaProfileArgs, SwitchOrcaProfileResult, TransferOrcaProfileProjectArgs, TransferOrcaProfileProjectResult, OrcaProfileOrgInviteRevokeArgs, OrcaProfileOrgMemberChangeRoleArgs, OrcaProfileOrgMemberInviteArgs, OrcaProfileOrgMemberMutationResult, OrcaProfileOrgMemberRemoveArgs, OrcaProfileOrgMembersListArgs, OrcaProfileOrgMembersListResult, FolderWorkspacePathStatus, FolderWorkspacePathStatusRequest, BaseRefDefaultResult, BaseRefSearchResult, CreateWorktreeArgs, CreateWorktreeResult, DetectedWorktreeListResult, ForceDeleteWorktreeBranchResult, GitPushTarget, GitHubPrStartPoint, Project, ProjectUpdateArgs, Repo, ProjectGroup, ProjectHostSetup, ProjectHostSetupCreateArgs, ProjectHostSetupCreateResult, ProjectHostSetupDeleteArgs, ProjectHostSetupDeleteResult, ProjectHostSetupExistingFolderArgs, ProjectHostSetupResult, ProjectHostSetupUpdateArgs, ProjectHostSetupUpdateResult, FolderWorkspace, ProjectGroupImportResult, ProjectGroupImportMode, SparsePreset, NestedRepoScanResult, Worktree, WorktreeBaseStatusEvent, WorktreeHeadIdentity, WorktreeLineage, WorkspaceLineage, WorktreeMeta, WorktreeRemoteBranchConflictEvent, RemoveWorktreeResult, ExecutionHostId, E2EConfig, WorkspaceSpaceAnalyzeResult, WorkspaceSpaceScanProgress, WorkspacePortAdvertisedUrlChangedEvent, WorkspacePortKillRequest, WorkspacePortKillResult, WorkspacePortScanRequest, WorkspacePortScanResult, WorkspaceCleanupDismissArgs, WorkspaceCleanupLocalProcessArgs, WorkspaceCleanupLocalProcessResult, WorkspaceCleanupScanArgs, WorkspaceCleanupScanProgress, WorkspaceCleanupScanResult, AppApi } from './preload-api-contract-types';export type PreloadApiApp = {
  app: AppApi
  orcaProfiles: {
    list: () => Promise<OrcaProfileListResult>
    authStatus: () => Promise<OrcaProfileAuthStatus>
    createLocal: (args?: CreateLocalOrcaProfileArgs) => Promise<CreateLocalOrcaProfileResult>
    createCloudLinked: (
      args?: CreateCloudLinkedOrcaProfileArgs
    ) => Promise<CreateCloudLinkedOrcaProfileResult>
    switchProfile: (args: SwitchOrcaProfileArgs) => Promise<SwitchOrcaProfileResult>
    transferProject: (
      args: TransferOrcaProfileProjectArgs
    ) => Promise<TransferOrcaProfileProjectResult>
    findProjectProfiles: (
      args: FindOrcaProfileProjectsByPathArgs
    ) => Promise<FindOrcaProfileProjectsByPathResult>
    connectCurrent: () => Promise<ConnectCurrentOrcaProfileResult>
    refreshAuth: () => Promise<RefreshCurrentOrcaProfileAuthResult>
    signOutCurrent: () => Promise<SignOutCurrentOrcaProfileResult>
    selectOrg: (args: SelectOrcaProfileOrgArgs) => Promise<SelectOrcaProfileOrgResult>
    orgMembersList: (
      args: OrcaProfileOrgMembersListArgs
    ) => Promise<OrcaProfileOrgMembersListResult>
    orgMemberInvite: (
      args: OrcaProfileOrgMemberInviteArgs
    ) => Promise<OrcaProfileOrgMemberMutationResult>
    orgInviteRevoke: (
      args: OrcaProfileOrgInviteRevokeArgs
    ) => Promise<OrcaProfileOrgMemberMutationResult>
    orgMemberChangeRole: (
      args: OrcaProfileOrgMemberChangeRoleArgs
    ) => Promise<OrcaProfileOrgMemberMutationResult>
    orgMemberRemove: (
      args: OrcaProfileOrgMemberRemoveArgs
    ) => Promise<OrcaProfileOrgMemberMutationResult>
  }
  platform: {
    get: () => {
      platform: NodeJS.Platform
      osRelease: string
      displayServer: 'wayland' | 'x11' | null
    }
  }
  e2e: {
    getConfig: () => E2EConfig
  }
  repos: {
    list: () => Promise<Repo[]>
    listForExecutionHost?: (args: ListReposForExecutionHostArgs) => Promise<HostRepoCatalogSnapshot>
    // Why: error union matches the IPC handler's return shape; renderer callers branch on `'error' in result`.
    add: (args: {
      path: string
      kind?: 'git' | 'folder'
    }) => Promise<{ repo: Repo } | { error: string }>
    remove: (args: { repoId: string }) => Promise<void>
    // Forget a project on one execution host only, leaving the same repo id on other hosts intact.
    removeForHost: (args: { repoId: string; hostId: string }) => Promise<void>
    reorder: (args: { orderedIds: string[] }) => Promise<{ status: 'applied' | 'rejected' }>
    reorderForHost: (args: {
      orderedIds: string[]
      hostId: string
    }) => Promise<{ status: 'applied' | 'rejected' }>
    update: (args: {
      repoId: string
      hostId?: ExecutionHostId
      updates: Partial<
        Pick<
          Repo,
          | 'displayName'
          | 'badgeColor'
          | 'repoIcon'
          | 'upstream'
          | 'hookSettings'
          | 'worktreeBaseRef'
          | 'worktreeBasePath'
          | 'kind'
          | 'issueSourcePreference'
          | 'externalWorktreeVisibility'
          | 'externalWorktreeVisibilityPromptDismissedAt'
          | 'externalWorktreeInboxBaselinePaths'
          | 'importedExternalWorktreePaths'
          | 'projectGroupId'
          | 'projectGroupOrder'
          | 'forkSyncMode'
        >
      > & {
        sourceControlAi?: Repo['sourceControlAi'] | null
        externalWorktreeDiscoverySuppressedAt?: Repo['externalWorktreeDiscoverySuppressedAt'] | null
      }
    }) => Promise<Repo>
    pickFolder: () => Promise<string | null>
    pickFolders: () => Promise<string[]>
    pickDirectory: () => Promise<string | null>
    clone: (args: { url: string; destination: string }) => Promise<Repo>
    cloneRemote: (args: { connectionId: string; url: string; destination: string }) => Promise<Repo>
    createRemote: (args: {
      connectionId: string
      parentPath: string
      name: string
      kind: 'git' | 'folder'
    }) => Promise<{ repo: Repo } | { error: string }>
    cloneAbort: () => Promise<void>
    // Why: error union matches the IPC handler's return shape; renderer callers branch on `'error' in result`.
    addRemote: (args: {
      connectionId: string
      remotePath: string
      displayName?: string
      kind?: 'git' | 'folder'
    }) => Promise<{ repo: Repo } | { error: string }>
    // Why: error union matches the IPC handler's return shape; renderer callers branch on `'error' in result`.
    create: (args: {
      parentPath: string
      name: string
      kind: 'git' | 'folder'
    }) => Promise<{ repo: Repo } | { error: string }>
    isGitAvailable: () => Promise<boolean>
    getDefaultCreateProjectParent: () => Promise<string>
    onCloneProgress: (callback: (data: { phase: string; percent: number }) => void) => () => void
    getGitUsername: (args: { repoId: string }) => Promise<string>
    getBaseRefDefault: (args: {
      repoId: string
      hostId?: ExecutionHostId
    }) => Promise<BaseRefDefaultResult>
    searchBaseRefs: (args: {
      repoId: string
      query: string
      limit?: number
      hostId?: ExecutionHostId
    }) => Promise<string[]>
    searchBaseRefDetails: (args: {
      repoId: string
      query: string
      limit?: number
      hostId?: ExecutionHostId
    }) => Promise<BaseRefSearchResult[]>
    onChanged: (callback: () => void) => () => void
  }
  projects: {
    list: () => Promise<Project[]>
    update: (args: ProjectUpdateArgs) => Promise<Project | null>
    listHostSetups: () => Promise<ProjectHostSetup[]>
    createHostSetup: (args: ProjectHostSetupCreateArgs) => Promise<ProjectHostSetupCreateResult>
    setupExistingFolder: (
      args: ProjectHostSetupExistingFolderArgs
    ) => Promise<ProjectHostSetupResult>
    updateHostSetup: (args: ProjectHostSetupUpdateArgs) => Promise<ProjectHostSetupUpdateResult>
    deleteHostSetup: (args: ProjectHostSetupDeleteArgs) => Promise<ProjectHostSetupDeleteResult>
  }
  projectGroups: {
    list: () => Promise<ProjectGroup[]>
    create: (args: {
      name: string
      parentPath?: string | null
      connectionId?: string | null
      parentGroupId?: string | null
      createdFrom?: ProjectGroup['createdFrom']
    }) => Promise<ProjectGroup>
    update: (args: {
      groupId: string
      updates: Partial<Pick<ProjectGroup, 'name' | 'isCollapsed' | 'tabOrder' | 'color'>>
    }) => Promise<ProjectGroup | null>
    delete: (args: { groupId: string }) => Promise<boolean>
    moveProject: (args: {
      projectId: string
      groupId: string | null
      order?: number
    }) => Promise<Repo | null>
    scanNested: (args: {
      path: string
      connectionId?: string
      scanId?: string
      options?: Record<string, unknown>
    }) => Promise<NestedRepoScanResult>
    cancelNestedScan: (args: { scanId: string }) => Promise<boolean>
    onNestedScanProgress: (
      callback: (data: { scanId: string; scan: NestedRepoScanResult }) => void
    ) => () => void
    importNested: (args: {
      parentPath: string
      groupName: string
      projectPaths: string[]
      connectionId?: string
      scanId?: string
      mode: ProjectGroupImportMode
    }) => Promise<ProjectGroupImportResult>
  }
  folderWorkspaces: {
    list: () => Promise<FolderWorkspace[]>
    getPathStatus: (args: FolderWorkspacePathStatusRequest) => Promise<FolderWorkspacePathStatus>
    create: (args: {
      projectGroupId: string
      name?: string
      folderPath?: string | null
      connectionId?: string | null
      linkedTask?: FolderWorkspace['linkedTask']
      createdWithAgent?: FolderWorkspace['createdWithAgent']
      pendingFirstAgentMessageRename?: boolean
    }) => Promise<FolderWorkspace>
    update: (args: {
      folderWorkspaceId: string
      updates: Partial<
        Pick<
          FolderWorkspace,
          | 'name'
          | 'folderPath'
          | 'linkedTask'
          | 'comment'
          | 'isArchived'
          | 'isUnread'
          | 'isPinned'
          | 'sortOrder'
          | 'manualOrder'
          | 'workspaceStatus'
          | 'createdWithAgent'
          | 'pendingFirstAgentMessageRename'
          | 'firstAgentMessageRenameError'
          | 'lastActivityAt'
        >
      >
    }) => Promise<FolderWorkspace | null>
    delete: (args: { folderWorkspaceId: string }) => Promise<boolean>
  }
  sparsePresets: {
    list: (args: { repoId: string }) => Promise<SparsePreset[]>
    save: (args: {
      repoId: string
      id?: string
      name: string
      directories: string[]
    }) => Promise<SparsePreset>
    remove: (args: { repoId: string; presetId: string }) => Promise<void>
    onChanged: (callback: (data: { repoId: string }) => void) => () => void
  }
  worktrees: {
    list: (args: { repoId: string }) => Promise<Worktree[]>
    listDetected: {
      (
        args: ListDetectedWorktreesArgs
      ): Promise<HostQualifiedDetectedWorktreeResult | DetectedWorktreeListResult>
      (args: LegacyDetectedWorktreeRequest): Promise<DetectedWorktreeListResult>
    }
    cancelListDetected?: (args: { providerRequestId: ProviderRequestId }) => Promise<void>
    listAll: () => Promise<Worktree[]>
    create: (args: CreateWorktreeArgs) => Promise<CreateWorktreeResult>
    /** Two-phase progress for a background `create`, correlated by `creationId`. The remote/runtime
     *  create path emits nothing, so the surface falls back to an indeterminate spinner. */
    onCreateProgress: (
      callback: (data: { creationId?: string; phase: 'fetching' | 'creating' }) => void
    ) => () => void
    prefetchCreateBase: (args: { repoId: string; baseBranch?: string }) => Promise<void>
    resolvePrBase: (args: {
      repoId: string
      prNumber: number
      headRefName?: string
      baseRefName?: string
      isCrossRepository?: boolean
    }) => Promise<GitHubPrStartPoint | { error: string }>
    /** GitLab parallel of resolvePrBase. For same-project MRs returns
     *  `<remote>/<source_branch>`; for fork MRs fetches
     *  refs/merge-requests/<iid>/head and returns the SHA. */
    resolveMrBase: (args: {
      repoId: string
      mrIid: number
      sourceBranch?: string
      targetBranch?: string
      isCrossRepository?: boolean
    }) => Promise<
      | { baseBranch: string; compareBaseRef?: string; pushTarget?: GitPushTarget }
      | { error: string }
    >
    remove: (args: {
      worktreeId: string
      hostId?: ExecutionHostId
      force?: boolean
      skipArchive?: boolean
    }) => Promise<RemoveWorktreeResult>
    // Forget a workspace from Orca only (no remote Git/FS work) — for workspaces pinned to a removed/disconnected SSH host.
    forgetLocal: (args: {
      worktreeId: string
      hostId?: ExecutionHostId
    }) => Promise<RemoveWorktreeResult>
    forceDeletePreservedBranch: (args: {
      worktreeId: string
      branchName: string
      expectedHead: string
    }) => Promise<ForceDeleteWorktreeBranchResult>
    updateMeta: (args: { worktreeId: string; updates: Partial<WorktreeMeta> }) => Promise<Worktree>
    listLineage: () => Promise<{
      lineage: Record<string, WorktreeLineage>
      workspaceLineage?: Record<string, WorkspaceLineage>
    }>
    listLineageForHost?: (args: ListDesktopLineageForHostArgs) => Promise<HostLineageSnapshot>
    updateLineage: (args: {
      worktreeId: string
      parentWorktreeId?: string
      noParent?: boolean
    }) => Promise<WorktreeLineage | null>
    persistSortOrder: (args: { orderedIds: string[] }) => Promise<void>
    /** Full CLI output of the last branch auto-rename generation failure, held
     *  in main memory only — null after a restart or once the failure clears. */
    getBranchRenameFailureOutput: (args: { worktreeId: string }) => Promise<string | null>
    onChanged: (callback: (data: { repoId: string }) => void) => () => void
    onGitStatusMetadataChanged: (callback: (data: { repoId: string }) => void) => () => void
    onHeadIdentitiesChanged: (
      callback: (data: { repoId: string; identities: WorktreeHeadIdentity[] }) => void
    ) => () => void
    onBaseStatus: (callback: (data: WorktreeBaseStatusEvent) => void) => () => void
    onRemoteBranchConflict: (
      callback: (data: WorktreeRemoteBranchConflictEvent) => void
    ) => () => void
  }
  workspaceCleanup: {
    scan: (
      args?: WorkspaceCleanupScanArgs,
      onProgress?: (progress: WorkspaceCleanupScanProgress) => void
    ) => Promise<WorkspaceCleanupScanResult>
    dismiss: (args: WorkspaceCleanupDismissArgs) => Promise<void>
    clearDismissals: () => Promise<void>
    hasKillableLocalProcesses: (
      args: WorkspaceCleanupLocalProcessArgs
    ) => Promise<WorkspaceCleanupLocalProcessResult>
  }
  workspaceSpace: {
    analyze: () => Promise<WorkspaceSpaceAnalyzeResult>
    cancel: () => Promise<boolean>
    onProgress: (callback: (progress: WorkspaceSpaceScanProgress) => void) => () => void
  }
  workspacePorts: {
    scan: (args: WorkspacePortScanRequest) => Promise<WorkspacePortScanResult>
    kill: (args: WorkspacePortKillRequest) => Promise<WorkspacePortKillResult>
    onAdvertisedUrlChanged: (
      callback: (event: WorkspacePortAdvertisedUrlChangedEvent) => void
    ) => () => void
  }
}
