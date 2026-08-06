import { useCallback } from 'react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { Repo } from '../../../../shared/types'
import {
  keepImportedWorktreesHiddenCard,
  IMPORTED_WORKTREES_KEEP_HIDDEN_ERROR,
  showImportedWorktreesCard,
  type ImportedWorktreeCardActionState
} from './imported-worktrees-card-actions'
import {
  importNewExternalWorktreeInboxPaths,
  keepNewExternalWorktreeInboxHidden,
  suppressNewExternalWorktreeInbox,
  type NewExternalWorktreesInboxActionState
} from './new-external-worktrees-inbox-actions'
import { getHiddenImportedWorktrees } from './imported-worktrees-card-candidates'
import type { WorktreeListSource } from './use-worktree-list-source'
import type { WorktreeListRowInputs } from './use-worktree-list-row-inputs'

type Args = {
  repos: readonly Repo[]
  detectedWorktreesByRepo: WorktreeListSource['detectedWorktreesByRepo']
  newExternalWorktreesInboxByRepo: WorktreeListRowInputs['newExternalWorktreesInboxByRepo']
  importedWorktreeCardActionState: WorktreeListRowInputs['importedWorktreeCardActionState']
  setImportedWorktreeCardActionState: WorktreeListRowInputs['setImportedWorktreeCardState']
  setNewExternalWorktreeInboxActionState: WorktreeListRowInputs['setNewExternalWorktreeInboxState']
  suppressExternalWorktreeInboxRepoId: string | null
  setSuppressExternalWorktreeInboxRepoId: WorktreeListRowInputs['setSuppressExternalWorktreeInboxRepoId']
  updateRepo: AppState['updateRepo']
  fetchWorktrees: AppState['fetchWorktrees']
}

export function useWorktreeListImportActions({
  repos,
  detectedWorktreesByRepo,
  newExternalWorktreesInboxByRepo,
  importedWorktreeCardActionState,
  setImportedWorktreeCardActionState,
  setNewExternalWorktreeInboxActionState,
  suppressExternalWorktreeInboxRepoId,
  setSuppressExternalWorktreeInboxRepoId,
  updateRepo,
  fetchWorktrees
}: Args) {
  const setImportedWorktreeCardState = useCallback(
    (projectId: string, state: ImportedWorktreeCardActionState | null) => {
      setImportedWorktreeCardActionState((previous) => {
        const next = new Map(previous)
        if (state) {
          next.set(projectId, state)
        } else {
          next.delete(projectId)
        }
        return next
      })
    },
    [setImportedWorktreeCardActionState]
  )

  const handleShowImportedWorktrees = useCallback(
    async (projectId: string) => {
      await showImportedWorktreesCard({
        projectId,
        forceVisible: importedWorktreeCardActionState.get(projectId)?.forceVisible === true,
        updateRepo,
        fetchWorktrees,
        setCardState: setImportedWorktreeCardState
      })
    },
    [fetchWorktrees, importedWorktreeCardActionState, setImportedWorktreeCardState, updateRepo]
  )

  const handleKeepImportedWorktreesHidden = useCallback(
    async (projectId: string) => {
      const repo = repos.find((candidate) => candidate.id === projectId)
      let detected = detectedWorktreesByRepo[projectId]
      if (detected?.authoritative !== true) {
        const refreshed = await fetchWorktrees(projectId, { requireAuthoritative: true })
        if (!refreshed) {
          setImportedWorktreeCardState(projectId, {
            pending: false,
            error: IMPORTED_WORKTREES_KEEP_HIDDEN_ERROR
          })
          return
        }
        detected = useAppStore.getState().detectedWorktreesByRepo[projectId]
      }
      if (detected?.authoritative !== true) {
        setImportedWorktreeCardState(projectId, {
          pending: false,
          error: IMPORTED_WORKTREES_KEEP_HIDDEN_ERROR
        })
        return
      }
      const hiddenWorktrees = getHiddenImportedWorktrees(detected)
      await keepImportedWorktreesHiddenCard({
        projectId,
        updateRepo,
        setCardState: setImportedWorktreeCardState,
        hiddenWorktreePaths: hiddenWorktrees.map((worktree) => worktree.path),
        existingBaselinePaths: repo?.externalWorktreeInboxBaselinePaths
      })
    },
    [detectedWorktreesByRepo, fetchWorktrees, repos, setImportedWorktreeCardState, updateRepo]
  )

  const setNewExternalWorktreeInboxState = useCallback(
    (projectId: string, state: NewExternalWorktreesInboxActionState | null) => {
      setNewExternalWorktreeInboxActionState((previous) => {
        const next = new Map(previous)
        if (state) {
          next.set(projectId, state)
        } else {
          next.delete(projectId)
        }
        return next
      })
    },
    [setNewExternalWorktreeInboxActionState]
  )

  const getActionArgs = useCallback(
    (projectId: string, worktreePaths: readonly string[]) => {
      const repo = repos.find((candidate) => candidate.id === projectId)
      return repo
        ? {
            projectId,
            repo,
            worktreePaths,
            updateRepo,
            fetchWorktrees,
            setInboxState: setNewExternalWorktreeInboxState
          }
        : null
    },
    [fetchWorktrees, repos, setNewExternalWorktreeInboxState, updateRepo]
  )

  const handleImportNewExternalWorktree = useCallback(
    async (projectId: string, worktreeId: string) => {
      const worktree = newExternalWorktreesInboxByRepo
        .get(projectId)
        ?.inboxWorktrees.find((item) => item.id === worktreeId)
      const args = worktree ? getActionArgs(projectId, [worktree.path]) : null
      if (args) {
        await importNewExternalWorktreeInboxPaths(args)
      }
    },
    [getActionArgs, newExternalWorktreesInboxByRepo]
  )

  const handleImportAllNewExternalWorktrees = useCallback(
    async (projectId: string) => {
      const paths =
        newExternalWorktreesInboxByRepo.get(projectId)?.inboxWorktrees.map((item) => item.path) ??
        []
      const args = getActionArgs(projectId, paths)
      if (args) {
        await importNewExternalWorktreeInboxPaths(args)
      }
    },
    [getActionArgs, newExternalWorktreesInboxByRepo]
  )

  const handleKeepNewExternalWorktreeInboxHidden = useCallback(
    async (projectId: string) => {
      const paths =
        newExternalWorktreesInboxByRepo.get(projectId)?.inboxWorktrees.map((item) => item.path) ??
        []
      const args = getActionArgs(projectId, paths)
      if (args) {
        await keepNewExternalWorktreeInboxHidden(args)
      }
    },
    [getActionArgs, newExternalWorktreesInboxByRepo]
  )

  const handleOpenSuppressExternalWorktreeInbox = useCallback(
    (projectId: string) => setSuppressExternalWorktreeInboxRepoId(projectId),
    [setSuppressExternalWorktreeInboxRepoId]
  )

  const handleConfirmSuppressExternalWorktreeInbox = useCallback(async () => {
    if (!suppressExternalWorktreeInboxRepoId) {
      return
    }
    const projectId = suppressExternalWorktreeInboxRepoId
    const paths =
      newExternalWorktreesInboxByRepo.get(projectId)?.inboxWorktrees.map((item) => item.path) ?? []
    const args = getActionArgs(projectId, paths)
    if (!args) {
      setSuppressExternalWorktreeInboxRepoId(null)
      return
    }
    if (await suppressNewExternalWorktreeInbox(args)) {
      setSuppressExternalWorktreeInboxRepoId(null)
    }
  }, [
    getActionArgs,
    newExternalWorktreesInboxByRepo,
    setSuppressExternalWorktreeInboxRepoId,
    suppressExternalWorktreeInboxRepoId
  ])

  return {
    handleShowImportedWorktrees,
    handleKeepImportedWorktreesHidden,
    handleImportNewExternalWorktree,
    handleImportAllNewExternalWorktrees,
    handleKeepNewExternalWorktreeInboxHidden,
    handleOpenSuppressExternalWorktreeInbox,
    handleConfirmSuppressExternalWorktreeInbox
  }
}
