import { useCallback, useEffect, useMemo } from 'react'
import { useFileExplorerAutoReveal } from './useFileExplorerAutoReveal'
import { useFileExplorerHandlers } from './useFileExplorerHandlers'
import { useFileExplorerReveal } from './useFileExplorerReveal'
import { useFileExplorerInlineInput } from './useFileExplorerInlineInput'
import { useFileExplorerKeys } from './useFileExplorerKeys'
import { useFileDuplicate } from './useFileDuplicate'
import { useFileExplorerImport } from './useFileExplorerImport'
import { useFileExplorerWatch } from './useFileExplorerWatch'
import { useFileExplorerSurfaceActions } from './useFileExplorerSurfaceActions'
import { useFileExplorerSurfaceLifecycle } from './useFileExplorerSurfaceLifecycle'
import { useFileExplorerSurfaceVirtualizer } from './useFileExplorerSurfaceVirtualizer'
import {
  getNameFilterCollapsedPathsAfterExpand,
  getNextNameFilterCollapsedPaths
} from './file-explorer-name-filter-projection'
import type { SurfaceControllerParams } from './file-explorer-surface-controller-types'
export function useFileExplorerSurfaceController({
  model,
  bindings,
  activeWorktreeId,
  activeRuntimeEnvironmentId,
  worktreePath,
  sshConnectedGeneration,
  pendingExplorerReveal,
  clearPendingExplorerReveal,
  activeFileId,
  openFiles,
  openFile,
  makePreviewFilePermanent,
  toggleDir,
  collapseDirSubtree,
  showRightSidebarSearch,
  openModal,
  activeRepo,
  setNameFilterQuery
}: SurfaceControllerParams) {
  const {
    dirCache,
    setDirCache,
    rootCache,
    rootError,
    loadDir,
    statPath,
    markPathAsDirectory,
    refreshTree,
    refreshDir,
    resetAndLoad,
    expanded,
    hasNameFilter,
    nameFilterFiles,
    nameFilterSource,
    rowProjection,
    rowExpandedPaths,
    visibleRowCount
  } = model
  const {
    scrollRef,
    explorerShellRef,
    flashTimeoutRef,
    selectedPath,
    selectedPaths,
    setSingleSelectedPath,
    resetSelection,
    selectRowWithModifiers,
    moveSelection,
    setFlashingPath,
    requestDelete,
    requestDeleteAll,
    ...dragState
  } = bindings
  useFileExplorerSurfaceLifecycle({
    visibleFilesWorktreePath: model.visibleFilesWorktreePath,
    sshConnectedGeneration,
    rootError,
    expanded,
    dirCache,
    resetSelection,
    setNameFilterQuery,
    resetAndLoad,
    loadDir
  })
  const {
    inlineInput,
    inlineInputIndex,
    startNew,
    startRename,
    dismissInlineInput,
    handleInlineSubmit
  } = useFileExplorerInlineInput({
    activeWorktreeId,
    worktreePath: model.visibleFilesWorktreePath,
    expanded,
    rowProjection,
    scrollRef,
    refreshDir
  })
  const handleExplorerBackgroundDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!worktreePath || inlineInput) {
        return
      }
      const target = event.target as HTMLElement
      if (target.closest('[data-slot="context-menu-trigger"]')) {
        return
      }
      startNew('file', worktreePath, 0)
    },
    [inlineInput, startNew, worktreePath]
  )
  useFileExplorerWatch({
    worktreePath: model.visibleFilesWorktreePath,
    activeWorktreeId,
    dirCache,
    setDirCache,
    expanded,
    setSelectedPath: setSingleSelectedPath,
    refreshDir,
    refreshTree,
    inlineInput,
    dragSourcePath: dragState.dragSourcePath,
    isNativeDragOver: dragState.isNativeDragOver,
    operationOwner: rootCache?.operationOwner
  })
  useFileExplorerImport({
    worktreePath: model.visibleFilesWorktreePath,
    activeWorktreeId,
    refreshDir,
    clearNativeDragState: dragState.clearNativeDragState,
    setSelectedPath: setSingleSelectedPath,
    operationOwner: rootCache?.operationOwner
  })
  const totalCount = visibleRowCount + (inlineInputIndex >= 0 ? 1 : 0)
  const virtualizer = useFileExplorerSurfaceVirtualizer({
    count: totalCount,
    inlineInputIndex,
    rowProjection,
    scrollRef
  })
  const cancelRevealTimers = useFileExplorerReveal({
    activeWorktreeId,
    worktreePath: model.visibleFilesWorktreePath,
    pendingExplorerReveal,
    clearPendingExplorerReveal,
    expanded,
    dirCache,
    rootCache,
    rowProjection,
    loadDir,
    setSelectedPath: setSingleSelectedPath,
    setFlashingPath,
    flashTimeoutRef,
    virtualizer
  })
  const setExplorerShellRef = useCallback(
    (node: HTMLDivElement | null): void => {
      explorerShellRef.current = node
      if (node === null) {
        cancelRevealTimers()
      }
    },
    [cancelRevealTimers, explorerShellRef]
  )
  useFileExplorerAutoReveal({
    activeFileId,
    activeWorktreeId,
    worktreePath: model.visibleFilesWorktreePath,
    pendingExplorerReveal,
    openFiles,
    rowProjection,
    setSelectedPath: setSingleSelectedPath,
    virtualizer
  })
  useEffect(() => {
    if (inlineInputIndex >= 0) {
      virtualizer.scrollToIndex(inlineInputIndex, { align: 'auto' })
    }
  }, [inlineInputIndex, virtualizer])
  const selectedNode = selectedPath ? rowProjection.getRowByPath(selectedPath) : null
  const selectedNodes = useMemo(
    () => rowProjection.getRowsByPaths(selectedPaths),
    [rowProjection, selectedPaths]
  )
  const handleToggleNameFilterDir = useCallback(
    (_worktreeId: string, dirPath: string) => {
      model.setNameFilterCollapsedPaths((current) =>
        getNextNameFilterCollapsedPaths(current, dirPath, rowExpandedPaths.has(dirPath))
      )
    },
    [model, rowExpandedPaths]
  )
  const handleExpandNameFilterDir = useCallback(
    (dirPath: string) => {
      model.setNameFilterCollapsedPaths((current) =>
        getNameFilterCollapsedPathsAfterExpand(current, dirPath)
      )
    },
    [model]
  )
  const { handleClick, handleDoubleClick, handleWheelCapture, cancelPendingDirToggle } =
    useFileExplorerHandlers({
      activeWorktreeId,
      runtimeEnvironmentId: activeRuntimeEnvironmentId,
      openFile,
      makePreviewFilePermanent,
      toggleDir: hasNameFilter ? handleToggleNameFilterDir : toggleDir,
      loadDir,
      statPath,
      markPathAsDirectory,
      setSelectedPath: setSingleSelectedPath,
      scrollRef
    })
  const handleDuplicate = useFileDuplicate({ activeWorktreeId, worktreePath, refreshDir })
  const actions = useFileExplorerSurfaceActions({
    activeWorktreeId,
    activeRepo,
    selectedPaths,
    selectedNodes,
    handleClick,
    cancelPendingDirToggle,
    selectRowWithModifiers,
    startRename,
    requestDelete,
    requestDeleteAll,
    handleDuplicate,
    collapseDirSubtree,
    showRightSidebarSearch,
    openModal
  })
  const scrollToIndex = useCallback(
    (index: number) => virtualizer.scrollToIndex(index, { align: 'auto' }),
    [virtualizer]
  )
  useFileExplorerKeys({
    containerRef: explorerShellRef,
    rowProjection,
    expandedPaths: rowExpandedPaths,
    canToggleDirectories: true,
    inlineInput,
    selectedPaths,
    selectedNode,
    activateNode: actions.activateNode,
    moveSelection,
    toggleDir: hasNameFilter ? handleToggleNameFilterDir : toggleDir,
    startRename: actions.handleStartRename,
    requestDelete,
    requestDeleteAll,
    scrollToIndex,
    activeWorktreeId
  })
  return {
    ...bindings,
    ...dragState,
    ...actions,
    inlineInput,
    inlineInputIndex,
    startNew,
    startRename,
    dismissInlineInput,
    handleInlineSubmit,
    handleExplorerBackgroundDoubleClick,
    handleClick,
    handleDoubleClick,
    handleWheelCapture,
    selectedNode,
    selectedNodes,
    virtualizer,
    setExplorerShellRef,
    handleToggleNameFilterDir,
    handleExpandNameFilterDir,
    isEmptyState: visibleRowCount === 0 && !inlineInput,
    isLoading:
      visibleRowCount === 0 &&
      !inlineInput &&
      (hasNameFilter ? nameFilterSource?.relativePaths === null : (rootCache?.loading ?? true)),
    treeError: hasNameFilter ? nameFilterFiles.loadError : rootError
  }
}
