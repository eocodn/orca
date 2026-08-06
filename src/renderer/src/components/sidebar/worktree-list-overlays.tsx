import { translate } from '@/i18n/i18n'
import { ProjectGroupNameDialog } from './ProjectGroupNameDialog'
import { CircleX } from 'lucide-react'
import { ProjectGroupDeleteDialog } from './ProjectGroupDeleteDialog'
import SuppressExternalWorktreeInboxDialog from './SuppressExternalWorktreeInboxDialog'
import type {
  ProjectGroupDeleteDialogState,
  ProjectGroupNameDialogState
} from './worktree-list-types'

type Props = {
  projectGroupNameDialog: ProjectGroupNameDialogState | null
  setProjectGroupNameDialog: (state: ProjectGroupNameDialogState | null) => void
  handleSubmitProjectGroupName: (name: string) => Promise<void>
  suppressExternalWorktreeInboxRepoId: string | null
  setSuppressExternalWorktreeInboxRepoId: (id: string | null) => void
  suppressPending: boolean
  repoDisplayName: string
  handleConfirmSuppressExternalWorktreeInbox: () => Promise<void>
  handleOpenWorktreeVisibility: (projectId: string) => void
  projectGroupDeleteDialog: ProjectGroupDeleteDialogState | null
  setProjectGroupDeleteDialog: (state: ProjectGroupDeleteDialogState | null) => void
  projectGroupDeleteProjectCount: number
  projectGroupDeleteProjectNames: readonly string[]
  projectGroupRemoveContainedProjects: boolean
  handleConfirmDeleteProjectGroup: () => Promise<void>
}

export function WorktreeListOverlays({
  projectGroupNameDialog,
  setProjectGroupNameDialog,
  handleSubmitProjectGroupName,
  suppressExternalWorktreeInboxRepoId,
  setSuppressExternalWorktreeInboxRepoId,
  suppressPending,
  repoDisplayName,
  handleConfirmSuppressExternalWorktreeInbox,
  handleOpenWorktreeVisibility,
  projectGroupDeleteDialog,
  setProjectGroupDeleteDialog,
  projectGroupDeleteProjectCount,
  projectGroupDeleteProjectNames,
  projectGroupRemoveContainedProjects,
  handleConfirmDeleteProjectGroup
}: Props) {
  return (
    <>
      <ProjectGroupNameDialog
        open={projectGroupNameDialog !== null}
        title={
          projectGroupNameDialog?.type === 'rename'
            ? translate('auto.components.sidebar.WorktreeList.f9dc6cc5d3', 'Rename Project Group')
            : translate('auto.components.sidebar.WorktreeList.13757c053c', 'New Project Group')
        }
        description={
          projectGroupNameDialog?.type === 'rename'
            ? translate(
                'auto.components.sidebar.WorktreeList.bc1460beb3',
                'Update the group name shown in the sidebar.'
              )
            : translate(
                'auto.components.sidebar.WorktreeList.d880ea0744',
                'Create a group and move this project into it.'
              )
        }
        initialName={
          projectGroupNameDialog?.type === 'rename'
            ? projectGroupNameDialog.currentName
            : projectGroupNameDialog
              ? `${projectGroupNameDialog.repo.displayName} group`
              : ''
        }
        confirmLabel={projectGroupNameDialog?.type === 'rename' ? 'Rename' : 'Create'}
        onOpenChange={(open) => {
          if (!open) {
            setProjectGroupNameDialog(null)
          }
        }}
        onSubmit={handleSubmitProjectGroupName}
      />
      <SuppressExternalWorktreeInboxDialog
        open={suppressExternalWorktreeInboxRepoId !== null}
        repoDisplayName={repoDisplayName}
        pending={suppressPending}
        onOpenChange={(open) => {
          if (!open) {
            setSuppressExternalWorktreeInboxRepoId(null)
          }
        }}
        onConfirm={() => {
          void handleConfirmSuppressExternalWorktreeInbox()
        }}
        onOpenRecovery={() => {
          if (suppressExternalWorktreeInboxRepoId) {
            const id = suppressExternalWorktreeInboxRepoId
            setSuppressExternalWorktreeInboxRepoId(null)
            handleOpenWorktreeVisibility(id)
          }
        }}
      />
      <ProjectGroupDeleteDialog
        open={projectGroupDeleteDialog !== null}
        groupName={projectGroupDeleteDialog?.groupName ?? ''}
        projectCount={projectGroupDeleteProjectCount}
        projectNames={projectGroupDeleteProjectNames}
        removeContainedProjects={projectGroupRemoveContainedProjects}
        onRemoveContainedProjectsChange={(removeContainedProjects) =>
          setProjectGroupDeleteDialog(
            projectGroupDeleteDialog
              ? { ...projectGroupDeleteDialog, removeContainedProjects }
              : null
          )
        }
        onOpenChange={(open) => {
          if (!open) {
            setProjectGroupDeleteDialog(null)
          }
        }}
        onConfirm={() => {
          void handleConfirmDeleteProjectGroup()
        }}
      />
    </>
  )
}

export function WorktreeListEmptyState({
  hasFilters,
  clearFilters
}: Pick<Props, 'hasFilters' | 'clearFilters'>) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-6 text-center text-[11px] text-muted-foreground">
      <span>
        {translate('auto.components.sidebar.WorktreeList.b7acbf038b', 'No workspaces found')}
      </span>
      {hasFilters && (
        <button
          onClick={clearFilters}
          className="inline-flex items-center gap-1.5 bg-secondary/70 border border-border/80 text-foreground font-medium text-[11px] px-2.5 py-1 rounded-md cursor-pointer hover:bg-accent transition-colors"
        >
          <CircleX className="size-3.5" />
          {translate('auto.components.sidebar.WorktreeList.370c6a55dd', 'Clear Filters')}
        </button>
      )}
    </div>
  )
}
