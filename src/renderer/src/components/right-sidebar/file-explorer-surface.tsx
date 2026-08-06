// Concrete surface implementation for FileExplorer.tsx
import React, { useCallback, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { useActiveWorktree, useRepoById } from '@/store/selectors'
import { useFileSearchPanel } from './useFileSearchPanel'
import { CLOSE_ALL_CONTEXT_MENUS_EVENT } from '@/components/tab-bar/SortableTab'
import type { RightSidebarExplorerView } from '../../../../shared/types'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { FileExplorerSurfaceView } from './file-explorer-surface-view'
import { useFileExplorerSurfaceModel } from './useFileExplorerSurfaceModel'
import { useFileExplorerSurfaceBindings } from './useFileExplorerSurfaceBindings'
import { useFileExplorerSurfaceController } from './useFileExplorerSurfaceController'
function FileExplorerFiles(): React.JSX.Element {
  const explorerView = useAppStore((s) => s.rightSidebarExplorerView)
  const showRightSidebarFiles = useAppStore((s) => s.showRightSidebarFiles)
  const showRightSidebarSearch = useAppStore((s) => s.showRightSidebarSearch)
  const [nameFilterQuery, setNameFilterQuery] = useState('')
  const [nameFilterCollapsedPaths, setNameFilterCollapsedPaths] = useState<Set<string>>(
    () => new Set()
  )
  const searchPanel = useFileSearchPanel(explorerView)

  const handleSelectExplorerView = useCallback(
    (view: RightSidebarExplorerView) => {
      if (view === 'files') {
        showRightSidebarFiles()
        return
      }
      const trimmedQuery = nameFilterQuery.trim()
      showRightSidebarSearch(trimmedQuery ? { query: trimmedQuery } : undefined)
    },
    [nameFilterQuery, showRightSidebarFiles, showRightSidebarSearch]
  )
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const activeWorktree = useActiveWorktree()
  const activeRepo = useRepoById(activeWorktree?.repoId ?? null)
  const supportsFolderDownload = useAppStore((s) => {
    const connectionId = activeRepo?.connectionId
    return connectionId
      ? s.sshConnectionStates.get(connectionId)?.supportsFolderDownload === true
      : false
  })
  const activeRuntimeEnvironmentId = useAppStore((s) =>
    getRuntimeEnvironmentIdForWorktree(s, activeWorktreeId)
  )
  const sshConnectedGeneration = useAppStore((s) => s.sshConnectedGeneration)
  const expandedDirs = useAppStore((s) => s.expandedDirs)
  const collapseAllDirs = useAppStore((s) => s.collapseAllDirs)
  const collapseDirSubtree = useAppStore((s) => s.collapseDirSubtree)
  const toggleDir = useAppStore((s) => s.toggleDir)
  const pendingExplorerReveal = useAppStore((s) => s.pendingExplorerReveal)
  const clearPendingExplorerReveal = useAppStore((s) => s.clearPendingExplorerReveal)
  const openFile = useAppStore((s) => s.openFile)
  const makePreviewFilePermanent = useAppStore((s) => s.makePreviewFilePermanent)
  const activeFileId = useAppStore((s) => s.activeFileId)
  const gitStatusByWorktree = useAppStore((s) => s.gitStatusByWorktree)
  const openFiles = useAppStore((s) => s.openFiles)
  const closeFile = useAppStore((s) => s.closeFile)
  const openModal = useAppStore((s) => s.openModal)
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen)
  const showDotfiles = useAppStore((s) =>
    activeWorktreeId ? (s.showDotfilesByWorktree[activeWorktreeId] ?? true) : true
  )
  const toggleShowDotfilesForWorktree = useAppStore((s) => s.toggleShowDotfilesForWorktree)
  const worktreePath = activeWorktree?.path ?? null

  const surfaceModel = useFileExplorerSurfaceModel({
    explorerView,
    rightSidebarOpen,
    worktreePath,
    activeWorktreeId,
    activeRuntimeEnvironmentId,
    activeRepo,
    expandedDirs,
    nameFilterQuery,
    nameFilterCollapsedPaths,
    setNameFilterCollapsedPaths,
    showDotfiles,
    collapseAllDirs,
    toggleShowDotfilesForWorktree
  })
  const {
    runtimeDownloadContext,
    isFilesViewActive,
    visibleFilesWorktreePath,
    repoName,
    activeRepoSupportsGit,
    expanded,
    hasNameFilter,
    nameFilterFiles,
    rowProjection,
    ignoredByRelativePath,
    showGitIgnoredFiles,
    toggleGitIgnoredFiles,
    rowExpandedPaths,
    manualRefresh,
    canCollapseAll,
    handleCollapseAll,
    handleToggleDotfiles
  } = surfaceModel
  const bindings = useFileExplorerSurfaceBindings({
    activeWorktreeId,
    worktreePath,
    expanded,
    toggleDir,
    refreshDir: surfaceModel.refreshDir,
    rowProjection,
    gitStatusByWorktree,
    openFiles,
    closeFile,
    isWindows: useMemo(() => navigator.userAgent.includes('Windows'), [])
  })
  const controller = useFileExplorerSurfaceController({
    model: surfaceModel,
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
  })
  const {
    flashingPath,
    bgMenuOpen,
    setBgMenuOpen,
    bgMenuPoint,
    setBgMenuPoint,
    scrollRef,
    selectedPaths,
    preserveSelectionForContextMenu,
    copyPathsForNode,
    statusByRelativePath,
    folderStatusByRelativePath,
    deleteShortcutLabel,
    handleMoveDrop,
    handleDragExpandDir,
    dropTargetDir,
    setDropTargetDir,
    dragSourcePath,
    setDragSourcePath,
    isRootDragOver,
    isNativeDragOver,
    nativeDropTargetDir,
    handleNativeDragExpandDir,
    stopDragEdgeScroll,
    rootDragHandlers,
    inlineInput,
    inlineInputIndex,
    startNew,
    dismissInlineInput,
    handleInlineSubmit,
    handleExplorerBackgroundDoubleClick,
    handleClick,
    handleDoubleClick,
    handleWheelCapture,
    selectedNode,
    virtualizer,
    setExplorerShellRef,
    handleExpandNameFilterDir,
    handleStartRename,
    handleContextMenuDelete,
    handleRowClick,
    handleCollapseFolderSubtree,
    handleFindInFolder,
    handleAddFolderAsProject,
    handleOpenInTerminal,
    handleDuplicate,
    canAddFolderAsProject,
    isEmptyState,
    isLoading,
    treeError
  } = controller
  const handleClearNameFilter = useCallback(() => {
    setNameFilterQuery('')
  }, [setNameFilterQuery])
  const handleExplorerBackgroundContextMenuCapture = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement
      if (target.closest('[data-slot="context-menu-trigger"]')) {
        return
      }
      event.preventDefault()
      window.dispatchEvent(new Event(CLOSE_ALL_CONTEXT_MENUS_EVENT))
      setBgMenuPoint({ x: event.clientX, y: event.clientY })
      setBgMenuOpen(true)
    },
    [setBgMenuOpen, setBgMenuPoint]
  )
  const virtualRowsProps = {
    virtualizer,
    inlineInputIndex,
    rowProjection,
    inlineInput,
    selectedPaths,
    activeFileId,
    flashingPath,
    handleInlineSubmit,
    dismissInlineInput,
    folderStatusByRelativePath,
    statusByRelativePath,
    ignoredByRelativePath,
    expanded: rowExpandedPaths,
    canCollapseFolderSubtree: !hasNameFilter,
    deleteShortcutLabel,
    connectionId: activeRepo?.connectionId ?? null,
    runtimeDownloadContext,
    supportsFolderDownload,
    onClick: handleRowClick,
    onDoubleClick: handleDoubleClick,
    onViewFile: handleClick,
    onContextMenuSelect: preserveSelectionForContextMenu,
    onCopyPaths: copyPathsForNode,
    onStartNew: startNew,
    onStartRename: handleStartRename,
    onDuplicate: handleDuplicate,
    onAddFolderAsProject: handleAddFolderAsProject,
    canAddFolderAsProject,
    onOpenInTerminal: handleOpenInTerminal,
    onRequestDelete: handleContextMenuDelete,
    onCollapseFolderSubtree: handleCollapseFolderSubtree,
    onFindInFolder: handleFindInFolder,
    onMoveDrop: handleMoveDrop,
    onDragTargetChange: setDropTargetDir,
    onDragSourceChange: setDragSourcePath,
    onDragExpandDir: hasNameFilter ? handleExpandNameFilterDir : handleDragExpandDir,
    onNativeDragTargetChange: setNativeDropTargetDir,
    onNativeDragExpandDir: hasNameFilter ? handleExpandNameFilterDir : handleNativeDragExpandDir,
    dropTargetDir,
    dragSourcePath,
    nativeDropTargetDir,
    isRootDragOver,
    isNativeDragOver
  }
  return (
    <FileExplorerSurfaceView
      explorerView={explorerView}
      worktreePath={worktreePath}
      visibleFilesWorktreePath={visibleFilesWorktreePath}
      repoName={repoName}
      connectionId={activeRepo?.connectionId ?? null}
      isFilesViewActive={isFilesViewActive}
      activeRepoSupportsGit={activeRepoSupportsGit}
      showDotfiles={showDotfiles}
      showGitIgnoredFiles={showGitIgnoredFiles}
      toggleGitIgnoredFiles={toggleGitIgnoredFiles}
      toggleDotfiles={handleToggleDotfiles}
      canCollapseAll={canCollapseAll}
      collapseAll={handleCollapseAll}
      manualRefresh={manualRefresh}
      nameFilterQuery={nameFilterQuery}
      nameFilterLoading={nameFilterFiles.loading}
      setNameFilterQuery={setNameFilterQuery}
      clearNameFilter={handleClearNameFilter}
      handleSelectExplorerView={handleSelectExplorerView}
      searchPanel={searchPanel}
      scrollRef={scrollRef}
      setExplorerShellRef={setExplorerShellRef}
      selectedNode={selectedNode}
      handleWheelCapture={handleWheelCapture}
      rootDragHandlers={rootDragHandlers}
      stopDragEdgeScroll={stopDragEdgeScroll}
      setDropTargetDir={setDropTargetDir}
      handleExplorerBackgroundContextMenuCapture={handleExplorerBackgroundContextMenuCapture}
      handleExplorerBackgroundDoubleClick={handleExplorerBackgroundDoubleClick}
      virtualRowsProps={virtualRowsProps}
      bgMenuOpen={bgMenuOpen}
      setBgMenuOpen={setBgMenuOpen}
      bgMenuPoint={bgMenuPoint}
      startNew={startNew}
      isEmptyState={isEmptyState}
      isLoading={isLoading}
      treeError={treeError}
      showNameFilterEmptyMessage={hasNameFilter && !nameFilterFiles.loadError}
    />
  )
}

const FileExplorerFilesMemo = React.memo(FileExplorerFiles)

function FileExplorer(): React.JSX.Element {
  return <FileExplorerFilesMemo />
}

export default React.memo(FileExplorer)
