import { useCallback, useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { FolderWorkspace, ProjectGroup, Repo } from '../../../../shared/types'
import { useFolderWorkspacePathStatusCacheExpiryTick } from '@/lib/folder-workspace-path-status-cache-expiry'
import { getFolderPathStatusRouteOptionsForRows } from './worktree-list-host-filtering'

type PathStatusRequest = Parameters<AppState['fetchFolderWorkspacePathStatus']>[0]

export function useWorktreeListFolderPathStatus({
  projectGroups,
  folderWorkspaces,
  allRepoIds,
  repoMap,
  sshConnectionStates
}: {
  projectGroups: readonly ProjectGroup[]
  folderWorkspaces: readonly FolderWorkspace[]
  allRepoIds: readonly string[]
  repoMap: ReadonlyMap<string, Repo>
  sshConnectionStates: ReadonlyMap<string, { status: string }>
}) {
  const {
    folderWorkspacePathStatuses,
    fetchFolderWorkspacePathStatus,
    getFolderWorkspacePathStatusCacheKey,
    getFreshFolderWorkspacePathStatus,
    activeRuntimeEnvironmentId
  } = useAppStore(
    useShallow((state) => ({
      folderWorkspacePathStatuses: state.folderWorkspacePathStatuses,
      fetchFolderWorkspacePathStatus: state.fetchFolderWorkspacePathStatus,
      getFolderWorkspacePathStatusCacheKey: state.getFolderWorkspacePathStatusCacheKey,
      getFreshFolderWorkspacePathStatus: state.getFreshFolderWorkspacePathStatus,
      activeRuntimeEnvironmentId: state.settings?.activeRuntimeEnvironmentId ?? null
    }))
  )
  const folderPathStatusRepoMembershipKey = useMemo(
    () =>
      allRepoIds
        .map((repoId) => {
          const repo = repoMap.get(repoId)
          return `${repoId}:${repo?.path ?? ''}:${repo?.projectGroupId ?? ''}:${repo?.connectionId ?? ''}`
        })
        .join('\0'),
    [allRepoIds, repoMap]
  )
  const folderPathStatusSshConnectionKey = useMemo(
    () =>
      [...sshConnectionStates.entries()]
        .map(([connectionId, state]) => `${connectionId}:${state.status}`)
        .sort()
        .join('\0'),
    [sshConnectionStates]
  )
  const folderPathStatusCacheExpiryTick = useFolderWorkspacePathStatusCacheExpiryTick(
    folderWorkspacePathStatuses
  )
  const projectGroupById = useMemo(
    () => new Map(projectGroups.map((group) => [group.id, group])),
    [projectGroups]
  )
  const folderWorkspaceById = useMemo(
    () => new Map(folderWorkspaces.map((workspace) => [workspace.id, workspace])),
    [folderWorkspaces]
  )
  const getRouteOptions = useCallback(
    (request: PathStatusRequest) =>
      getFolderPathStatusRouteOptionsForRows({
        request,
        projectGroupsById: projectGroupById,
        folderWorkspacesById: folderWorkspaceById
      }),
    [folderWorkspaceById, projectGroupById]
  )
  useEffect(() => {
    const requests = new Map<
      string,
      { request: PathStatusRequest; options?: { runtimeEnvironmentId: string | null } }
    >()
    for (const group of projectGroups) {
      if (group.parentPath) {
        const request = { scope: 'project-group' as const, projectGroupId: group.id }
        const options = getRouteOptions(request)
        requests.set(getFolderWorkspacePathStatusCacheKey(request, options), { request, options })
      }
    }
    for (const workspace of folderWorkspaces) {
      const request = { scope: 'folder-workspace' as const, folderWorkspaceId: workspace.id }
      const options = getRouteOptions(request)
      requests.set(getFolderWorkspacePathStatusCacheKey(request, options), { request, options })
    }
    for (const { request, options } of requests.values()) {
      void fetchFolderWorkspacePathStatus(request, { force: true, ...options })
    }
  }, [
    activeRuntimeEnvironmentId,
    fetchFolderWorkspacePathStatus,
    folderPathStatusRepoMembershipKey,
    folderPathStatusSshConnectionKey,
    folderWorkspaces,
    getRouteOptions,
    getFolderWorkspacePathStatusCacheKey,
    projectGroups
  ])
  return useCallback(
    (request: PathStatusRequest) => {
      const options = getRouteOptions(request)
      const cacheKey = getFolderWorkspacePathStatusCacheKey(request, options)
      void folderWorkspacePathStatuses[cacheKey]
      void folderPathStatusCacheExpiryTick
      return getFreshFolderWorkspacePathStatus(request, options)
    },
    [
      folderWorkspacePathStatuses,
      folderPathStatusCacheExpiryTick,
      getRouteOptions,
      getFolderWorkspacePathStatusCacheKey,
      getFreshFolderWorkspacePathStatus
    ]
  )
}
