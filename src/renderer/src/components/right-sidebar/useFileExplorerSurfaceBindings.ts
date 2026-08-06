import { useMemo, useRef, useState } from 'react'
import { useFileDeletion } from './useFileDeletion'
import { useFileExplorerDragDrop } from './useFileExplorerDragDrop'
import { useFileExplorerSelection } from './useFileExplorerSelection'
import { buildFolderStatusMap, buildStatusMap } from './status-display'
import type { useAppStore } from '@/store'
import type { FileExplorerRowProjection } from './file-explorer-row-projection'

type BindingsParams = {
  activeWorktreeId: string | null
  worktreePath: string | null
  expanded: Set<string>
  toggleDir: (worktreeId: string, dirPath: string) => void
  refreshDir: (dirPath: string) => Promise<void>
  rowProjection: FileExplorerRowProjection
  gitStatusByWorktree: ReturnType<typeof useAppStore.getState>['gitStatusByWorktree']
  openFiles: ReturnType<typeof useAppStore.getState>['openFiles']
  closeFile: ReturnType<typeof useAppStore.getState>['closeFile']
  isWindows: boolean
}

export function useFileExplorerSurfaceBindings({
  activeWorktreeId,
  worktreePath,
  expanded,
  toggleDir,
  refreshDir,
  rowProjection,
  gitStatusByWorktree,
  openFiles,
  closeFile,
  isWindows
}: BindingsParams) {
  const [flashingPath, setFlashingPath] = useState<string | null>(null)
  const [bgMenuOpen, setBgMenuOpen] = useState(false)
  const [bgMenuPoint, setBgMenuPoint] = useState({ x: 0, y: 0 })
  const scrollRef = useRef<HTMLDivElement>(null)
  const explorerShellRef = useRef<HTMLDivElement | null>(null)
  const flashTimeoutRef = useRef<number | null>(null)
  const isMac = useMemo(() => navigator.userAgent.includes('Mac'), [])
  const {
    selectedPath,
    selectedPaths,
    setSingleSelectedPath,
    setSelectedPaths,
    resetSelection,
    selectRowWithModifiers,
    moveSelection,
    preserveSelectionForContextMenu,
    copyPathsForNode
  } = useFileExplorerSelection(rowProjection, isMac)
  const entries = useMemo(
    () => (activeWorktreeId ? (gitStatusByWorktree[activeWorktreeId] ?? []) : []),
    [activeWorktreeId, gitStatusByWorktree]
  )
  const statusByRelativePath = useMemo(() => buildStatusMap(entries), [entries])
  const folderStatusByRelativePath = useMemo(() => buildFolderStatusMap(entries), [entries])
  const { deleteShortcutLabel, requestDelete, requestDeleteAll } = useFileDeletion({
    activeWorktreeId,
    openFiles,
    closeFile,
    refreshDir,
    setSelectedPaths,
    isWindows
  })
  const drag = useFileExplorerDragDrop({
    worktreePath,
    activeWorktreeId,
    expanded,
    toggleDir,
    refreshDir,
    scrollRef,
    getOperationOwnerForPath: (path) => rowProjection.getRowByPath(path)?.operationOwner
  })
  return {
    flashingPath,
    setFlashingPath,
    bgMenuOpen,
    setBgMenuOpen,
    bgMenuPoint,
    setBgMenuPoint,
    scrollRef,
    explorerShellRef,
    flashTimeoutRef,
    selectedPath,
    selectedPaths,
    setSingleSelectedPath,
    setSelectedPaths,
    resetSelection,
    selectRowWithModifiers,
    moveSelection,
    preserveSelectionForContextMenu,
    copyPathsForNode,
    statusByRelativePath,
    folderStatusByRelativePath,
    deleteShortcutLabel,
    requestDelete,
    requestDeleteAll,
    ...drag
  }
}
