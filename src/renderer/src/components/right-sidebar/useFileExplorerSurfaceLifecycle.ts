import { useEffect, useRef } from 'react'
import { splitPathSegments } from './path-tree'
import { clearFileExplorerUndoHistory } from './fileExplorerUndoRedo'
import { shouldResetFileExplorerForVisibleWorktree } from './file-explorer-reset'
import type { DirCache } from './file-explorer-types'

type SurfaceLifecycleParams = {
  visibleFilesWorktreePath: string | null
  sshConnectedGeneration: number
  rootError: string | null
  expanded: Set<string>
  dirCache: Record<string, DirCache>
  resetSelection: () => void
  setNameFilterQuery: (query: string) => void
  resetAndLoad: () => void
  loadDir: (dirPath: string, depth: number) => Promise<boolean>
}

export function useFileExplorerSurfaceLifecycle({
  visibleFilesWorktreePath,
  sshConnectedGeneration,
  rootError,
  expanded,
  dirCache,
  resetSelection,
  setNameFilterQuery,
  resetAndLoad,
  loadDir
}: SurfaceLifecycleParams): void {
  const lastResetWorktreePathRef = useRef<string | null>(null)
  useEffect(() => {
    if (!visibleFilesWorktreePath) {
      return
    }
    // Keep hidden-worktree caches intact and avoid probing paths while closed.
    if (
      !shouldResetFileExplorerForVisibleWorktree(
        lastResetWorktreePathRef.current,
        visibleFilesWorktreePath
      )
    ) {
      return
    }
    lastResetWorktreePathRef.current = visibleFilesWorktreePath
    resetSelection()
    setNameFilterQuery('')
    resetAndLoad()
    clearFileExplorerUndoHistory()
  }, [visibleFilesWorktreePath, resetSelection]) // eslint-disable-line react-hooks/exhaustive-deps

  // Retry a failed remote read when the SSH provider becomes available.
  const sshGenRef = useRef(sshConnectedGeneration)
  useEffect(() => {
    if (sshConnectedGeneration > sshGenRef.current) {
      sshGenRef.current = sshConnectedGeneration
      if (visibleFilesWorktreePath && rootError) {
        resetAndLoad()
      }
    }
  }, [sshConnectedGeneration, visibleFilesWorktreePath]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!visibleFilesWorktreePath) {
      return
    }
    for (const dirPath of expanded) {
      if (!dirCache[dirPath]?.children.length && !dirCache[dirPath]?.loading) {
        const depth =
          splitPathSegments(dirPath.slice(visibleFilesWorktreePath.length + 1)).length - 1
        void loadDir(dirPath, depth)
      }
    }
  }, [expanded, visibleFilesWorktreePath]) // eslint-disable-line react-hooks/exhaustive-deps
}
