import React from 'react'
import { dirname } from '@/lib/path'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { RightSidebarExplorerView } from '../../../../shared/types'
import { FileExplorerBackgroundMenu } from './FileExplorerBackgroundMenu'
import { FileExplorerNameFilter } from './FileExplorerNameFilter'
import { FileExplorerQueryStrip } from './FileExplorerQueryStrip'
import { FileExplorerToolbar } from './FileExplorerToolbar'
import { SearchFilters } from './SearchFilters'
import { SearchQueryRow } from './SearchQueryRow'
import { SearchResultsPane } from './SearchResultsPane'
import { FileExplorerTreeStatus } from './FileExplorerTreeStatus'
import { FileExplorerVirtualRows } from './FileExplorerVirtualRows'
import type { TreeNode } from './file-explorer-types'
import type { useFileSearchPanel } from './useFileSearchPanel'
import type { useFileExplorerDragDrop } from './useFileExplorerDragDrop'
import type { useFileExplorerManualRefresh } from './useFileExplorerManualRefresh'

type VirtualRowsProps = React.ComponentProps<typeof FileExplorerVirtualRows>
type SearchPanel = ReturnType<typeof useFileSearchPanel>
type DragState = Pick<
  ReturnType<typeof useFileExplorerDragDrop>,
  'isRootDragOver' | 'isNativeDragOver' | 'dragSourcePath' | 'nativeDropTargetDir'
>
export type ExplorerRowsProps = VirtualRowsProps & DragState
type ManualRefresh = ReturnType<typeof useFileExplorerManualRefresh>

export type FileExplorerSurfaceViewProps = {
  explorerView: RightSidebarExplorerView
  worktreePath: string | null
  visibleFilesWorktreePath: string | null
  repoName: string
  connectionId: string | null
  isFilesViewActive: boolean
  activeRepoSupportsGit: boolean
  showDotfiles: boolean
  showGitIgnoredFiles: boolean
  toggleGitIgnoredFiles: () => void
  toggleDotfiles: () => void
  canCollapseAll: boolean
  collapseAll: () => void
  manualRefresh: ManualRefresh
  nameFilterQuery: string
  nameFilterLoading: boolean
  setNameFilterQuery: (query: string) => void
  clearNameFilter: () => void
  handleSelectExplorerView: (view: RightSidebarExplorerView) => void
  searchPanel: SearchPanel
  scrollRef: React.RefObject<HTMLDivElement | null>
  setExplorerShellRef: (node: HTMLDivElement | null) => void
  selectedNode: TreeNode | null
  handleWheelCapture: (event: React.WheelEvent<HTMLDivElement>) => void
  rootDragHandlers: {
    onDragOver: (event: React.DragEvent) => void
    onDragEnter: (event: React.DragEvent) => void
    onDragLeave: (event: React.DragEvent) => void
    onDrop: (event: React.DragEvent) => void
  }
  stopDragEdgeScroll: () => void
  setDropTargetDir: (dir: string | null) => void
  handleExplorerBackgroundContextMenuCapture: (event: React.MouseEvent<HTMLDivElement>) => void
  handleExplorerBackgroundDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void
  virtualRowsProps: ExplorerRowsProps
  bgMenuOpen: boolean
  setBgMenuOpen: (open: boolean) => void
  bgMenuPoint: { x: number; y: number }
  startNew: (type: 'file' | 'folder', parentPath: string, depth: number) => void
  isEmptyState: boolean
  isLoading: boolean
  treeError: string | null
  showNameFilterEmptyMessage: boolean
}

// Keep the heavy tree/search layout outside the stateful facade. This preserves
// the mounted body-slot invariant while keeping the orchestration surface small.
export function FileExplorerSurfaceView({
  explorerView,
  worktreePath,
  visibleFilesWorktreePath,
  repoName,
  connectionId,
  isFilesViewActive,
  activeRepoSupportsGit,
  showDotfiles,
  showGitIgnoredFiles,
  toggleGitIgnoredFiles,
  toggleDotfiles,
  canCollapseAll,
  collapseAll,
  manualRefresh,
  nameFilterQuery,
  nameFilterLoading,
  setNameFilterQuery,
  clearNameFilter,
  handleSelectExplorerView,
  searchPanel,
  scrollRef,
  setExplorerShellRef,
  selectedNode,
  handleWheelCapture,
  rootDragHandlers,
  stopDragEdgeScroll,
  setDropTargetDir,
  handleExplorerBackgroundContextMenuCapture,
  handleExplorerBackgroundDoubleClick,
  virtualRowsProps,
  bgMenuOpen,
  setBgMenuOpen,
  bgMenuPoint,
  startNew,
  isEmptyState,
  isLoading,
  treeError,
  showNameFilterEmptyMessage
}: FileExplorerSurfaceViewProps): React.JSX.Element {
  if (!worktreePath) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-muted-foreground">
        {explorerView === 'search'
          ? translate(
              'auto.components.right.sidebar.Search.98c8435e36',
              'Select a workspace to search'
            )
          : translate(
              'auto.components.right.sidebar.FileExplorer.79b1537dd3',
              'Select a workspace to browse files'
            )}
      </div>
    )
  }

  const showTree = !isEmptyState
  const emptyMessage = showNameFilterEmptyMessage
    ? translate(
        'auto.components.right.sidebar.FileExplorer.2f4483d6c4',
        'No files match this filter'
      )
    : undefined

  return (
    <>
      <div
        ref={setExplorerShellRef}
        data-orca-explorer-shell
        data-selected-folder-relative-path={
          selectedNode?.isDirectory ? selectedNode.relativePath : undefined
        }
        className="flex min-h-0 flex-1 flex-col"
      >
        <FileExplorerToolbar
          repoName={repoName}
          worktreePath={worktreePath}
          connectionId={connectionId}
          refresh={manualRefresh}
          canRefresh={isFilesViewActive}
          canCollapseAll={canCollapseAll}
          onCollapseAll={collapseAll}
          showGitIgnoredFilesToggle={activeRepoSupportsGit}
          showGitIgnoredFiles={showGitIgnoredFiles}
          onToggleGitIgnoredFiles={toggleGitIgnoredFiles}
          showDotfiles={showDotfiles}
          onToggleDotfiles={toggleDotfiles}
        />
        <FileExplorerQueryStrip view={explorerView} onSelectView={handleSelectExplorerView}>
          <div className="relative min-h-7">
            <div
              className={cn(
                explorerView !== 'files' && 'pointer-events-none invisible absolute inset-x-0 top-0'
              )}
            >
              <FileExplorerNameFilter
                query={nameFilterQuery}
                loading={nameFilterLoading}
                onQueryChange={setNameFilterQuery}
                onClear={clearNameFilter}
              />
            </div>
            <div
              className={cn(
                explorerView !== 'search' &&
                  'pointer-events-none invisible absolute inset-x-0 top-0'
              )}
            >
              <SearchQueryRow {...searchPanel.queryRowProps} />
            </div>
          </div>
        </FileExplorerQueryStrip>
        <div
          className={cn(
            'border-b border-border px-2 pb-1.5',
            explorerView !== 'search' &&
              'pointer-events-none invisible h-0 overflow-hidden border-b-0 p-0'
          )}
        >
          <SearchFilters {...searchPanel.filtersProps} />
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <ScrollArea
            className={cn(
              'h-full min-h-0',
              explorerView !== 'files' && 'pointer-events-none invisible',
              virtualRowsProps.isRootDragOver &&
                explorerView === 'files' &&
                !(
                  virtualRowsProps.dragSourcePath &&
                  dirname(virtualRowsProps.dragSourcePath) === worktreePath
                ) &&
                'bg-border',
              virtualRowsProps.isNativeDragOver &&
                explorerView === 'files' &&
                !virtualRowsProps.nativeDropTargetDir &&
                'bg-border'
            )}
            viewportRef={scrollRef}
            viewportTabIndex={-1}
            viewportClassName="h-full min-h-0 py-2"
            data-native-file-drop-target={isFilesViewActive ? 'file-explorer' : undefined}
            data-native-file-drop-dir={visibleFilesWorktreePath ?? undefined}
            onWheelCapture={handleWheelCapture}
            onDragOver={rootDragHandlers.onDragOver}
            onDragEnter={rootDragHandlers.onDragEnter}
            onDragLeave={rootDragHandlers.onDragLeave}
            onDrop={rootDragHandlers.onDrop}
            onDragEnd={() => {
              stopDragEdgeScroll()
              setDropTargetDir(null)
            }}
            viewportProps={{
              onContextMenuCapture: handleExplorerBackgroundContextMenuCapture,
              onDoubleClick: handleExplorerBackgroundDoubleClick
            }}
          >
            {!showTree && (
              <FileExplorerTreeStatus
                isLoading={isLoading}
                error={treeError}
                isEmpty={isEmptyState && !isLoading && !treeError}
                emptyMessage={emptyMessage}
              />
            )}
            {showTree && <FileExplorerVirtualRows {...virtualRowsProps} />}
          </ScrollArea>
          <div
            className={cn(
              'absolute inset-0 flex min-h-0 flex-col',
              explorerView !== 'search' && 'pointer-events-none invisible'
            )}
          >
            {searchPanel.activeWorktreeId ? (
              <SearchResultsPane {...searchPanel.resultsProps} />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                {translate(
                  'auto.components.right.sidebar.Search.98c8435e36',
                  'Select a workspace to search'
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <FileExplorerBackgroundMenu
        open={bgMenuOpen}
        onOpenChange={setBgMenuOpen}
        point={bgMenuPoint}
        worktreePath={worktreePath}
        onStartNew={startNew}
      />
    </>
  )
}
