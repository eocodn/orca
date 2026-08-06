import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import type { ProjectGroup, Repo, Worktree } from '../../../../shared/types'
import { getRepoExecutionHostId, type ExecutionHostId } from '../../../../shared/execution-host'
import { getEmptyProjectPlaceholderRepoIds } from './empty-project-placeholder-repos'
import {
  buildImportedWorktreesCardCandidates,
  type ImportedWorktreesCardCandidate
} from './imported-worktrees-card-candidates'
import {
  buildNewExternalWorktreesInboxCandidates,
  type NewExternalWorktreesInboxCandidate
} from './new-external-worktrees-inbox-candidates'
import {
  IMPORTED_WORKTREES_KEEP_HIDDEN_ERROR,
  type ImportedWorktreeCardActionState
} from './imported-worktrees-card-actions'
import type { NewExternalWorktreesInboxActionState } from './new-external-worktrees-inbox-actions'
import { getHostDisplayLabelOverrides } from '../../../../shared/host-setting-overrides'
import { getSettingsFocusedExecutionHostId } from '../../../../shared/execution-host'
import {
  filterFolderWorkspacesForVisibleHosts,
  filterProjectGroupsForVisibleHosts,
  getVisibleSidebarHostIdSet
} from './worktree-list-host-filtering'
import { getLogicalRepoOrderRankById } from './project-header-drop'
import { buildSidebarHostOptions, type SidebarHostOption } from './sidebar-host-options'
import { orderHostSectionOptions } from './host-section-order'
import type { WorktreeGroupBy } from './worktree-list-groups'
import type { WorktreeListSource } from './use-worktree-list-source'

export type WorktreeListRowInputs = {
  visibleReposForRows: readonly Repo[]
  defaultHostId: ExecutionHostId
  visibleProjectGroupsForRows: readonly ProjectGroup[]
  visibleFolderWorkspacesForRows: WorktreeListSource['folderWorkspaces']
  repoOrder: ReadonlyMap<string, number>
  importedWorktreesByRepo: ReadonlyMap<string, ImportedWorktreesCardCandidate>
  newExternalWorktreesInboxByRepo: ReadonlyMap<string, NewExternalWorktreesInboxCandidate>
  placeholderRepoIds: ReadonlySet<string>
  allRepoIds: readonly string[]
  pendingCreations: readonly { creationId: string; repoId: string }[]
  hostOptions: readonly SidebarHostOption[]
  hostLabelById: ReadonlyMap<ExecutionHostId, string>
  orderedHostOptions: readonly SidebarHostOption[]
  importedWorktreeCardActionState: ReadonlyMap<string, ImportedWorktreeCardActionState>
  setImportedWorktreeCardState: React.Dispatch<
    React.SetStateAction<Map<string, ImportedWorktreeCardActionState>>
  >
  newExternalWorktreeInboxActionState: ReadonlyMap<string, NewExternalWorktreesInboxActionState>
  setNewExternalWorktreeInboxState: React.Dispatch<
    React.SetStateAction<Map<string, NewExternalWorktreesInboxActionState>>
  >
  suppressExternalWorktreeInboxRepoId: string | null
  setSuppressExternalWorktreeInboxRepoId: React.Dispatch<React.SetStateAction<string | null>>
}

type WorktreeListRowInputArgs = {
  repos: readonly Repo[]
  projectGroups: readonly ProjectGroup[]
  folderWorkspaces: WorktreeListSource['folderWorkspaces']
  worktreesByRepo: WorktreeListSource['worktreesByRepo']
  visibleWorktrees: readonly Worktree[]
  detectedWorktreesByRepo: WorktreeListSource['detectedWorktreesByRepo']
  filterRepoIds: readonly string[]
  groupBy: WorktreeGroupBy
  visibleWorkspaceHostIds: WorktreeListSource['visibleWorkspaceHostIds']
  workspaceHostScope: WorktreeListSource['workspaceHostScope']
  settings: WorktreeListSource['settings']
  sshTargetLabels: WorktreeListSource['sshTargetLabels']
  sshConnectionStates: WorktreeListSource['sshConnectionStates']
  runtimeEnvironments: WorktreeListSource['runtimeEnvironments']
  runtimeStatusByEnvironmentId: WorktreeListSource['runtimeStatusByEnvironmentId']
  workspaceHostOrder: WorktreeListSource['workspaceHostOrder']
}

export function useWorktreeListRowInputs({
  repos,
  projectGroups,
  folderWorkspaces,
  worktreesByRepo,
  visibleWorktrees,
  detectedWorktreesByRepo,
  filterRepoIds,
  groupBy,
  visibleWorkspaceHostIds,
  workspaceHostScope,
  settings,
  sshTargetLabels,
  sshConnectionStates,
  runtimeEnvironments,
  runtimeStatusByEnvironmentId,
  workspaceHostOrder
}: WorktreeListRowInputArgs): WorktreeListRowInputs {
  const defaultHostId = getSettingsFocusedExecutionHostId(settings)
  const visibleHostIdSet = useMemo(
    () => getVisibleSidebarHostIdSet(visibleWorkspaceHostIds, workspaceHostScope),
    [visibleWorkspaceHostIds, workspaceHostScope]
  )
  const visibleReposForRows = useMemo(() => {
    if (!visibleHostIdSet) {
      return repos
    }
    return repos.filter((repo) => {
      const hostId =
        repo.connectionId || repo.executionHostId ? getRepoExecutionHostId(repo) : defaultHostId
      return visibleHostIdSet.has(hostId)
    })
  }, [defaultHostId, repos, visibleHostIdSet])
  const visibleProjectGroupsForRows = useMemo(
    () => filterProjectGroupsForVisibleHosts(projectGroups, visibleHostIdSet, defaultHostId),
    [defaultHostId, projectGroups, visibleHostIdSet]
  )
  const visibleFolderWorkspacesForRows = useMemo(
    () =>
      filterFolderWorkspacesForVisibleHosts(
        folderWorkspaces,
        projectGroups,
        visibleHostIdSet,
        defaultHostId
      ),
    [defaultHostId, folderWorkspaces, projectGroups, visibleHostIdSet]
  )
  const repoOrder = useMemo(
    () => getLogicalRepoOrderRankById(repos.map((repo) => repo.id)),
    [repos]
  )
  const [importedWorktreeCardActionState, setImportedWorktreeCardActionState] = useState<
    Map<string, ImportedWorktreeCardActionState>
  >(new Map())
  const [newExternalWorktreeInboxActionState, setNewExternalWorktreeInboxActionState] = useState<
    Map<string, NewExternalWorktreesInboxActionState>
  >(new Map())
  const [suppressExternalWorktreeInboxRepoId, setSuppressExternalWorktreeInboxRepoId] = useState<
    string | null
  >(null)
  const importedWorktreesByRepo = useMemo(() => {
    const forceVisibleRepoIds = new Set(
      [...importedWorktreeCardActionState.entries()]
        .filter(([, state]) => state.forceVisible)
        .map(([repoId]) => repoId)
    )
    return buildImportedWorktreesCardCandidates({
      repos: visibleReposForRows,
      detectedWorktreesByRepo,
      filterRepoIds,
      forceVisibleRepoIds
    })
  }, [detectedWorktreesByRepo, filterRepoIds, importedWorktreeCardActionState, visibleReposForRows])
  const newExternalWorktreesInboxByRepo = useMemo(
    () =>
      buildNewExternalWorktreesInboxCandidates({
        repos: visibleReposForRows,
        detectedWorktreesByRepo,
        filterRepoIds
      }),
    [detectedWorktreesByRepo, filterRepoIds, visibleReposForRows]
  )
  const placeholderRepoIds = useMemo(
    () =>
      getEmptyProjectPlaceholderRepoIds({
        groupBy,
        repos: visibleReposForRows,
        worktreesByRepo,
        visibleWorktrees,
        filterRepoIds
      }),
    [filterRepoIds, groupBy, visibleReposForRows, visibleWorktrees, worktreesByRepo]
  )
  const allRepoIds = useMemo(() => repos.map((repo) => repo.id), [repos])
  const pendingCreationKeys = useAppStore(
    useShallow((state) =>
      Object.values(state.pendingWorktreeCreations ?? {}).map(
        (creation) => `${creation.creationId} ${creation.request.repoId}`
      )
    )
  )
  const pendingCreations = useMemo(
    () =>
      pendingCreationKeys.map((key) => {
        const separator = key.indexOf(' ')
        return { creationId: key.slice(0, separator), repoId: key.slice(separator + 1) }
      }),
    [pendingCreationKeys]
  )
  const hostLabelOverrides = useMemo(() => getHostDisplayLabelOverrides(settings), [settings])
  const hostOptions = useMemo(
    () =>
      buildSidebarHostOptions({
        repos,
        sshTargetLabels,
        sshConnectionStates,
        settings,
        runtimeEnvironments,
        runtimeStatusByEnvironmentId,
        hostLabelOverrides
      }),
    [
      hostLabelOverrides,
      repos,
      runtimeEnvironments,
      runtimeStatusByEnvironmentId,
      settings,
      sshConnectionStates,
      sshTargetLabels
    ]
  )
  const hostLabelById = useMemo(
    () => new Map(hostOptions.map((host) => [host.id, host.label])),
    [hostOptions]
  )
  const orderedHostOptions = useMemo(
    () => orderHostSectionOptions(hostOptions, workspaceHostOrder),
    [hostOptions, workspaceHostOrder]
  )
  return {
    visibleReposForRows,
    defaultHostId,
    visibleProjectGroupsForRows,
    visibleFolderWorkspacesForRows,
    repoOrder,
    importedWorktreesByRepo,
    newExternalWorktreesInboxByRepo,
    placeholderRepoIds,
    allRepoIds,
    pendingCreations,
    hostOptions,
    hostLabelById,
    orderedHostOptions,
    importedWorktreeCardActionState,
    setImportedWorktreeCardState: setImportedWorktreeCardActionState,
    newExternalWorktreeInboxActionState,
    setNewExternalWorktreeInboxState: setNewExternalWorktreeInboxActionState,
    suppressExternalWorktreeInboxRepoId,
    setSuppressExternalWorktreeInboxRepoId
  }
}

export { IMPORTED_WORKTREES_KEEP_HIDDEN_ERROR }
