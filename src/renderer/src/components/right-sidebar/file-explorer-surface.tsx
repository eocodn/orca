// Concrete surface implementation for FileExplorer.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAppStore } from '@/store'
import { useActiveWorktree, useRepoById } from '@/store/selectors'
import { basename } from '@/lib/path'
import { useRuntimeFileListForWorktree } from '@/components/quick-open-file-list'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import { getVisibleFileExplorerWorktreePath } from './file-explorer-reset'
import { useFileSearchPanel } from './useFileSearchPanel'
import {
  getNameFilterCollapsedPathsAfterExpand,
  getNextNameFilterCollapsedPaths,
  isFileExplorerNameFilterQueryTooLarge
} from './file-explorer-name-filter-projection'
import { buildFolderStatusMap, buildStatusMap } from './status-display'
import { useFileDeletion } from './useFileDeletion'
import { useFileExplorerAutoReveal } from './useFileExplorerAutoReveal'
import { useFileExplorerHandlers } from './useFileExplorerHandlers'
import { useFileExplorerReveal } from './useFileExplorerReveal'
import { useFileExplorerInlineInput } from './useFileExplorerInlineInput'
import { useFileExplorerKeys } from './useFileExplorerKeys'
import { useFileDuplicate } from './useFileDuplicate'
import { useFileExplorerDragDrop } from './useFileExplorerDragDrop'
import { useFileExplorerImport } from './useFileExplorerImport'
import { useFileExplorerManualRefresh } from './useFileExplorerManualRefresh'
import { useFileExplorerTree } from './useFileExplorerTree'
import { useFileExplorerWatch } from './useFileExplorerWatch'
import { useFileExplorerSelection } from './useFileExplorerSelection'
import { useFileExplorerVisibleRowProjection } from './useFileExplorerVisibleRowProjection'
import { CLOSE_ALL_CONTEXT_MENUS_EVENT } from '@/components/tab-bar/SortableTab'
import type { RightSidebarExplorerView } from '../../../../shared/types'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { FileExplorerSurfaceView } from './file-explorer-surface-view'
import { useFileExplorerSurfaceActions } from './useFileExplorerSurfaceActions'
import { useFileExplorerSurfaceLifecycle } from './useFileExplorerSurfaceLifecycle'
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
  const runtimeDownloadContext = useMemo(
    () =>
      activeRuntimeEnvironmentId && activeWorktreeId && worktreePath
        ? {
            settings: { activeRuntimeEnvironmentId },
            worktreeId: activeWorktreeId,
            worktreePath,
            connectionId: activeRepo?.connectionId ?? undefined
          }
        : null,
    [activeRepo?.connectionId, activeRuntimeEnvironmentId, activeWorktreeId, worktreePath]
  )
  const isFilesViewActive = explorerView === 'files'
  const visibleFilesWorktreePath = getVisibleFileExplorerWorktreePath({
    explorerView,
    rightSidebarOpen,
    worktreePath
  })
  const repoName = activeRepo?.displayName ?? (worktreePath ? basename(worktreePath) : '')
  const activeRepoSupportsGit = activeRepo ? isGitRepoKind(activeRepo) : false

  const expanded = useMemo(
    () =>
      activeWorktreeId ? (expandedDirs[activeWorktreeId] ?? new Set<string>()) : new Set<string>(),
    [activeWorktreeId, expandedDirs]
  )

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
    resetAndLoad
  } = useFileExplorerTree(worktreePath, expanded, activeWorktreeId)
  const hasNameFilterQuery = nameFilterQuery.trim().length > 0
  const nameFilterQueryTooLarge = useMemo(
    () => isFileExplorerNameFilterQueryTooLarge(nameFilterQuery),
    [nameFilterQuery]
  )
  const hasNameFilter = isFilesViewActive && hasNameFilterQuery
  useEffect(() => {
    if (!hasNameFilter) {
      setNameFilterCollapsedPaths((current) => (current.size > 0 ? new Set() : current))
    }
  }, [hasNameFilter])
  const nameFilterFiles = useRuntimeFileListForWorktree({
    enabled: hasNameFilter && !nameFilterQueryTooLarge,
    worktreeId: activeWorktreeId
  })
  const nameFilterSource = useMemo(
    () =>
      hasNameFilter
        ? {
            query: nameFilterQuery,
            operationOwner: nameFilterFiles.operationOwner,
            relativePaths: nameFilterQueryTooLarge
              ? []
              : nameFilterFiles.loading && nameFilterFiles.files.length === 0
                ? null
                : nameFilterFiles.files
          }
        : null,
    [
      hasNameFilter,
      nameFilterFiles.files,
      nameFilterFiles.loading,
      nameFilterFiles.operationOwner,
      nameFilterQuery,
      nameFilterQueryTooLarge
    ]
  )
  const {
    rowProjection,
    ignoredByRelativePath,
    showGitIgnoredFiles,
    nameFilterExpandedPaths,
    toggleGitIgnoredFiles
  } = useFileExplorerVisibleRowProjection(
    activeWorktreeId,
    visibleFilesWorktreePath,
    dirCache,
    expanded,
    activeRepoSupportsGit && isFilesViewActive,
    showDotfiles,
    nameFilterSource,
    hasNameFilter ? nameFilterCollapsedPaths : null
  )
  const rowExpandedPaths = useMemo(
    () =>
      hasNameFilter
        ? nameFilterExpandedPaths
        : nameFilterExpandedPaths.size > 0
          ? new Set([...expanded, ...nameFilterExpandedPaths])
          : expanded,
    [expanded, hasNameFilter, nameFilterExpandedPaths]
  )
  const visibleRowCount = rowProjection.getVisibleCount()
  const manualRefresh = useFileExplorerManualRefresh(refreshTree)
  const canCollapseAll = isFilesViewActive && !hasNameFilter && expanded.size > 0
  const handleCollapseAll = useCallback(() => {
    if (!activeWorktreeId || !isFilesViewActive || hasNameFilter) {
      return
    }
    collapseAllDirs(activeWorktreeId)
  }, [activeWorktreeId, collapseAllDirs, hasNameFilter, isFilesViewActive])
  const handleToggleDotfiles = useCallback(() => {
    if (activeWorktreeId) {
      toggleShowDotfilesForWorktree(activeWorktreeId)
    }
  }, [activeWorktreeId, toggleShowDotfilesForWorktree])
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
    []
  )

  const [flashingPath, setFlashingPath] = useState<string | null>(null)
  const [bgMenuOpen, setBgMenuOpen] = useState(false)
  const [bgMenuPoint, setBgMenuPoint] = useState({ x: 0, y: 0 })
  const scrollRef = useRef<HTMLDivElement>(null)
  /** Includes Radix scroll viewport + scrollbar (scrollbar is not a child of the viewport). */
  const explorerShellRef = useRef<HTMLDivElement | null>(null)
  const flashTimeoutRef = useRef<number | null>(null)
  const isMac = useMemo(() => navigator.userAgent.includes('Mac'), [])
  const isWindows = useMemo(() => navigator.userAgent.includes('Windows'), [])
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

  const {
    handleMoveDrop,
    handleDragExpandDir,
    dropTargetDir,
    setDropTargetDir,
    dragSourcePath,
    setDragSourcePath,
    isRootDragOver,
    isNativeDragOver,
    nativeDropTargetDir,
    setNativeDropTargetDir,
    handleNativeDragExpandDir,
    stopDragEdgeScroll,
    rootDragHandlers,
    clearNativeDragState
  } = useFileExplorerDragDrop({
    worktreePath,
    activeWorktreeId,
    expanded,
    toggleDir,
    refreshDir,
    scrollRef,
    getOperationOwnerForPath: (path) => rowProjection.getRowByPath(path)?.operationOwner
  })

  useFileExplorerSurfaceLifecycle({
    visibleFilesWorktreePath,
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
    worktreePath: visibleFilesWorktreePath,
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
    worktreePath: visibleFilesWorktreePath,
    activeWorktreeId,
    dirCache,
    setDirCache,
    expanded,
    setSelectedPath: setSingleSelectedPath,
    refreshDir,
    refreshTree,
    inlineInput,
    dragSourcePath,
    isNativeDragOver,
    operationOwner: rootCache?.operationOwner
  })

  useFileExplorerImport({
    worktreePath: visibleFilesWorktreePath,
    activeWorktreeId,
    refreshDir,
    clearNativeDragState,
    setSelectedPath: setSingleSelectedPath,
    operationOwner: rootCache?.operationOwner
  })

  const totalCount = visibleRowCount + (inlineInputIndex >= 0 ? 1 : 0)

  const virtualizer = useVirtualizer({
    count: totalCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 26,
    overscan: 20,
    getItemKey: (index) => {
      if (inlineInputIndex >= 0) {
        if (index === inlineInputIndex) {
          return '__inline_input__'
        }
        const rowIndex = index > inlineInputIndex ? index - 1 : index
        return rowProjection.getRowAtIndex(rowIndex)?.path ?? `__fallback_${index}`
      }
      return rowProjection.getRowAtIndex(index)?.path ?? `__fallback_${index}`
    }
  })

  const cancelRevealTimers = useFileExplorerReveal({
    activeWorktreeId,
    worktreePath: visibleFilesWorktreePath,
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
      if (node !== null) {
        return
      }
      // Why: reveal flash/scroll timers target the explorer shell; clear them
      // when that owner detaches instead of keeping a passive unmount Effect.
      cancelRevealTimers()
    },
    [cancelRevealTimers]
  )

  useFileExplorerAutoReveal({
    activeFileId,
    activeWorktreeId,
    worktreePath: visibleFilesWorktreePath,
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
      setNameFilterCollapsedPaths((current) =>
        getNextNameFilterCollapsedPaths(current, dirPath, rowExpandedPaths.has(dirPath))
      )
    },
    [rowExpandedPaths]
  )
  const handleExpandNameFilterDir = useCallback((dirPath: string) => {
    setNameFilterCollapsedPaths((current) =>
      getNameFilterCollapsedPathsAfterExpand(current, dirPath)
    )
  }, [])
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
  const {
    activateNode,
    handleStartRename,
    handleContextMenuDelete,
    handleRowClick,
    handleCollapseFolderSubtree,
    handleFindInFolder,
    handleAddFolderAsProject,
    handleOpenInTerminal,
    canAddFolderAsProject
  } = useFileExplorerSurfaceActions({
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
    (index: number) => {
      virtualizer.scrollToIndex(index, { align: 'auto' })
    },
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
    activateNode,
    moveSelection,
    toggleDir: hasNameFilter ? handleToggleNameFilterDir : toggleDir,
    startRename: handleStartRename,
    requestDelete,
    requestDeleteAll,
    scrollToIndex,
    activeWorktreeId
  })

  const isEmptyState = visibleRowCount === 0 && !inlineInput
  const isNameFilterLoading = nameFilterSource?.relativePaths === null
  const isLoading =
    isEmptyState && (hasNameFilter ? isNameFilterLoading : (rootCache?.loading ?? true))
  const treeError = hasNameFilter ? nameFilterFiles.loadError : rootError
  const virtualRowsProps = {
    virtualizer,
    inlineInputIndex,
    rowProjection,
    inlineInput,
    handleInlineSubmit,
    dismissInlineInput,
    folderStatusByRelativePath,
    statusByRelativePath,
    ignoredByRelativePath,
    expanded: rowExpandedPaths,
    canCollapseFolderSubtree: !hasNameFilter,
    dirCache,
    selectedPaths,
    activeFileId,
    flashingPath,
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
