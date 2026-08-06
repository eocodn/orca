import type { Repo } from '../../../../shared/types'
import type { useAppStore } from '@/store'
import type { useFileExplorerSurfaceModel } from './useFileExplorerSurfaceModel'
import type { useFileExplorerSurfaceBindings } from './useFileExplorerSurfaceBindings'

export type SurfaceModel = ReturnType<typeof useFileExplorerSurfaceModel>
export type SurfaceBindings = ReturnType<typeof useFileExplorerSurfaceBindings>

export type SurfaceControllerParams = {
  model: SurfaceModel
  bindings: SurfaceBindings
  activeWorktreeId: string | null
  activeRuntimeEnvironmentId: string | null
  worktreePath: string | null
  sshConnectedGeneration: number
  pendingExplorerReveal: ReturnType<typeof useAppStore.getState>['pendingExplorerReveal']
  clearPendingExplorerReveal: () => void
  activeFileId: string | null
  openFiles: ReturnType<typeof useAppStore.getState>['openFiles']
  openFile: ReturnType<typeof useAppStore.getState>['openFile']
  makePreviewFilePermanent: ReturnType<typeof useAppStore.getState>['makePreviewFilePermanent']
  toggleDir: (worktreeId: string, dirPath: string) => void
  collapseDirSubtree: (worktreeId: string, dirPath: string) => void
  showRightSidebarSearch: (options: { includePattern: string }) => void
  openModal: ReturnType<typeof useAppStore.getState>['openModal']
  activeRepo: Repo | null
  setNameFilterQuery: (query: string) => void
}
