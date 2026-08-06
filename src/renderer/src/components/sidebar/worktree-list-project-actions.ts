import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { selectProjectGroupRemovalTargets } from '@/store/slices/project-group-removal-targets'
import { translate } from '@/i18n/i18n'
import type { ProjectGroup, Repo } from '../../../../shared/types'
import type {
  ProjectGroupDeleteDialogState,
  ProjectGroupNameDialogState
} from './worktree-list-types'

type Args = {
  repos: readonly Repo[]
  projectGroups: readonly ProjectGroup[]
  repoMap: ReadonlyMap<string, Repo>
  openModal: AppState['openModal']
}

export function useWorktreeListProjectActions({ repos, projectGroups, repoMap, openModal }: Args) {
  const moveProjectToGroup = useAppStore((s) => s.moveProjectToGroup)
  const createProjectGroup = useAppStore((s) => s.createProjectGroup)
  const updateProjectGroup = useAppStore((s) => s.updateProjectGroup)
  const deleteProjectGroupWithContainedProjects = useAppStore(
    (s) => s.deleteProjectGroupWithContainedProjects
  )
  const [projectGroupNameDialog, setProjectGroupNameDialog] =
    useState<ProjectGroupNameDialogState | null>(null)
  const [projectGroupDeleteDialog, setProjectGroupDeleteDialog] =
    useState<ProjectGroupDeleteDialogState | null>(null)

  const handleCreateGroupFromRepo = useCallback((repo: Repo) => {
    setProjectGroupNameDialog({ type: 'create-from-repo', repo })
  }, [])
  const handleMoveProjectToGroup = useCallback(
    (repo: Repo, groupId: string) => {
      if (repo.projectGroupId !== groupId) {
        void moveProjectToGroup(repo.id, groupId)
      }
    },
    [moveProjectToGroup]
  )
  const handleRemoveProjectFromGroup = useCallback(
    (repo: Repo) => {
      void moveProjectToGroup(repo.id, null)
    },
    [moveProjectToGroup]
  )
  const handleRenameProjectGroup = useCallback((groupId: string, currentName: string) => {
    setProjectGroupNameDialog({ type: 'rename', groupId, currentName })
  }, [])
  const handleSubmitProjectGroupName = useCallback(
    async (name: string) => {
      if (!projectGroupNameDialog) {
        return
      }
      if (projectGroupNameDialog.type === 'create-from-repo') {
        const group = await createProjectGroup(name)
        if (group) {
          await moveProjectToGroup(projectGroupNameDialog.repo.id, group.id)
        }
        return
      }
      await updateProjectGroup(projectGroupNameDialog.groupId, { name })
    },
    [createProjectGroup, moveProjectToGroup, projectGroupNameDialog, updateProjectGroup]
  )

  const projectGroupDeleteTargets = useMemo(
    () =>
      projectGroupDeleteDialog
        ? selectProjectGroupRemovalTargets(projectGroups, repos, projectGroupDeleteDialog.groupId)
        : null,
    [projectGroupDeleteDialog, projectGroups, repos]
  )
  const projectGroupDeleteProjectCount = projectGroupDeleteTargets?.projectIds.length ?? 0
  const projectGroupDeleteProjectNames = useMemo(
    () =>
      (projectGroupDeleteTargets?.projectIds ?? []).map((id) => repoMap.get(id)?.displayName ?? id),
    [projectGroupDeleteTargets, repoMap]
  )
  const projectGroupRemoveContainedProjects =
    projectGroupDeleteProjectCount > 0 && projectGroupDeleteDialog?.removeContainedProjects === true
  const handleDeleteProjectGroup = useCallback((groupId: string, groupName: string) => {
    setProjectGroupDeleteDialog({ groupId, groupName, removeContainedProjects: false })
  }, [])
  const handleConfirmDeleteProjectGroup = useCallback(async () => {
    if (!projectGroupDeleteDialog) {
      return
    }
    try {
      const result = await deleteProjectGroupWithContainedProjects(
        projectGroupDeleteDialog.groupId,
        { removeContainedProjects: projectGroupRemoveContainedProjects }
      )
      if (result.status === 'group-delete-failed') {
        toast.error(
          translate(
            'auto.components.sidebar.WorktreeList.groupDeleteFailed',
            'Failed to delete group'
          ),
          {
            description: translate(
              'auto.components.sidebar.WorktreeList.groupDeleteFailedDesc',
              'Something went wrong while deleting the group. No projects were removed.'
            )
          }
        )
        return
      }
      if (result.status === 'deleted-group' && result.failedProjectRemovals.length > 0) {
        const failedCount = result.failedProjectRemovals.length
        const requestedCount = result.requestedProjectIds.length
        toast.error(
          translate(
            'auto.components.sidebar.WorktreeList.b667b59632',
            'Some projects could not be removed from Orca'
          ),
          {
            description: translate(
              'auto.components.sidebar.WorktreeList.f94466bc39',
              '{{value0}} of {{value1}} contained project{{value2}} remained after deleting the group.',
              {
                value0: failedCount,
                value1: requestedCount,
                value2: requestedCount === 1 ? '' : 's'
              }
            )
          }
        )
      }
    } finally {
      setProjectGroupDeleteDialog(null)
    }
  }, [
    deleteProjectGroupWithContainedProjects,
    projectGroupDeleteDialog,
    projectGroupRemoveContainedProjects
  ])
  const handleCreateFolderWorkspace = useCallback(
    (projectGroup: ProjectGroup) => {
      if (projectGroup.parentPath) {
        openModal('new-workspace-composer', { initialProjectGroupId: projectGroup.id })
      }
    },
    [openModal]
  )

  return {
    projectGroupNameDialog,
    setProjectGroupNameDialog,
    projectGroupDeleteDialog,
    setProjectGroupDeleteDialog,
    projectGroupDeleteProjectCount,
    projectGroupDeleteProjectNames,
    projectGroupRemoveContainedProjects,
    handleCreateGroupFromRepo,
    handleMoveProjectToGroup,
    handleRemoveProjectFromGroup,
    handleRenameProjectGroup,
    handleSubmitProjectGroupName,
    handleDeleteProjectGroup,
    handleConfirmDeleteProjectGroup,
    handleCreateFolderWorkspace
  }
}
