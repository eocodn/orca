// Concrete surface implementation for CombinedDiffViewer.tsx
/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: diff entry changes must reset virtualizer measurement and generation state in lockstep with external scroll restoration. */
import React, { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } from 'react'
import { elementScroll, useVirtualizer } from '@tanstack/react-virtual'
import type { editor as monacoEditor } from 'monaco-editor'
import { useAppStore } from '@/store'
import {
  useVirtualizedScrollAnchor,
  VIRTUALIZED_SCROLL_ANCHOR_RECORD_EVENT,
  type VirtualizedScrollAnchor
} from '@/hooks/useVirtualizedScrollAnchor'
import { getVirtualizedScrollAnchorForOffset } from '@/hooks/virtualized-scroll-anchor-recording'
import { createProgrammaticScrollMarks } from '@/hooks/programmatic-scroll-marks'
import { joinPath } from '@/lib/path'
import { detectLanguage } from '@/lib/language-detect'
import { setWithLRU } from '@/lib/scroll-cache'
import { getCombinedDiffSectionConnectionId } from './combined-diff-section-connection'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { selectWorktreeDiffCommentsOrEmpty } from '@/store/worktree-diff-comments-selector'
import { writeRuntimeFile } from '@/runtime/runtime-file-client'
import { settingsForRuntimeOwner } from '@/runtime/runtime-rpc-client'
import { getEditorFileOperationContext } from '@/lib/editor-file-operation-owner'
import { formatDiffComments } from '@/lib/diff-comments-format'
import { getDiffCommentLineLabel } from '@/lib/diff-comment-compat'
import {
  getRuntimeGitBranchDiff,
  getRuntimeGitCommitDiff,
  getRuntimeGitDiff
} from '@/runtime/runtime-git-client'
import '@/lib/monaco-setup'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { OpenFile } from '@/store/slices/editor'
import type {
  DiffComment,
  GitBranchChangeEntry,
  GitDiffResult,
  GitStatusEntry
} from '../../../../shared/types'
import { Check, Copy, MessageSquare, PanelLeftOpen, Sparkles, Trash2, WrapText } from 'lucide-react'
import { toast } from 'sonner'
import { DiffSectionItem } from './DiffSectionItem'
import { DiffNotesSendMenu } from './DiffNotesSendMenu'
import {
  CombinedDiffFileTree,
  createCombinedDiffSectionIndexMap,
  handleCombinedDiffFileTreeNavigation
} from './CombinedDiffFileTree'
import { getCombinedDiffFileTreeSectionKey } from './combined-diff-file-tree-model'
import {
  ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT,
  type EditorPathMutationTarget
} from './editor-autosave'
import {
  getCombinedBranchEntries,
  getCombinedUncommittedEntries,
  resolveCombinedUncommittedSnapshotEntries,
  shouldAutoReloadCombinedDiffFromGitStatus
} from './combined-diff-entries'
import { getCombinedDiffCommitMessageBody } from './combined-diff-commit-message'
import { getDiffSectionEstimatedHeight, isIntrinsicHeightImageDiff } from './diff-section-layout'
import { getLargeDiffRenderLimit } from './large-diff-render-limit'
import { getStoredTextDiffContent, getStoredTextDiffResult } from './large-diff-section-content'
import type { DiffSection } from './diff-section-types'
import { getInitialCombinedDiffSectionLoadIndices } from './combined-diff-initial-section-load'
import { removeDiffSectionMeasuredHeight } from './diff-section-height-cache'
import { createCombinedDiffLoadScheduler } from './combined-diff-load-scheduler'
import { combinedDiffSectionsMatchEntryMetadata } from './combined-diff-section-cache-match'
import {
  beginCombinedDiffScrollbarDrag,
  type CombinedDiffScrollbarDragCleanup
} from './combined-diff-scrollbar-drag'
import { shouldRequestCombinedDiffSectionLoad } from './combined-diff-section-load-state'
import { translate } from '@/i18n/i18n'

import {
  COMBINED_DIFF_OVERSCAN,
  COMBINED_DIFF_SCROLLBAR_THUMB_MIN_HEIGHT,
  EMPTY_GIT_BRANCH_ENTRIES,
  EMPTY_GIT_STATUS_ENTRIES,
  CombinedDiffSectionLoadTimeoutError,
  type CombinedDiffScrollThumb,
  buildCombinedGitStatusSignature,
  combinedDiffPreferences,
  combinedDiffScrollAnchorCache,
  combinedDiffScrollTopCache,
  combinedDiffViewStateCache,
  getDiffSectionLoadErrorMessage,
  getInitialCombinedDiffFileTreeCollapsed,
  getInitialCombinedDiffSideBySide,
  getRetainedResolvedSnapshotEntries,
  invalidateCombinedDiffCachesForRelativePath,
  withDiffSectionLoadTimeout
} from './combined-diff-view-state'


export function CombinedDiffViewerView({ context }: { context: Record<string, any> }): React.JSX.Element {
  const {
    absolutePath,
    activeGroupId,
    activeScrollbarDragCleanupRef,
    activeTreeSectionKey,
    activeTreeSectionState,
    allEntries,
    allSectionsCollapsed,
    anchor,
    branchCompare,
    branchEntries,
    branchSummary,
    cached,
    canRestoreCachedSections,
    canRestoreSnapshotSectionsByKey,
    cancelScheduledAnchorPersist,
    clampRestoreCount,
    cleanupActiveScrollbarDrag,
    clearDiffComments,
    clearNotesCopiedResetTimer,
    clearNotesDialogOpen,
    clearNotesDialogVisible,
    collapsed,
    collapsedPreference,
    combinedDiffRestoreSignal,
    combinedDiffTotalSize,
    combinedGitStatusSignature,
    commitBody,
    commitCompare,
    commitEntries,
    commitHeader,
    connectionId,
    container,
    containerRect,
    content,
    currentSections,
    detail,
    diffCommentCount,
    diffCommentsForWorktree,
    diffCommentsPrompt,
    directScrollInputUntilRef,
    ensureCombinedDiffSectionLoaded,
    entries,
    entry,
    entrySignature,
    existing,
    file,
    fileRuntimeOwner,
    fileSettings,
    fileTreeCollapsed,
    firstVisible,
    gen,
    generation,
    generationRef,
    getCombinedDiffSectionElementKey,
    getCombinedDiffSectionKey,
    getLiveThumbHeight,
    getScrollTopForPointer,
    gitStatusEntries,
    grabOffset,
    handleCombinedDiffScrollbarPointerDown,
    handleConfirmClearNotes,
    handleCopyNotes,
    handlePointerMove,
    handleScroll,
    handleSectionSave,
    handleSectionSaveRef,
    handleTreeNavigate,
    handler,
    hasDirectScrollInput,
    hasRuntimeOwnerFilter,
    hasUncommittedEntriesSnapshot,
    height,
    index,
    initialIndices,
    invalidateCombinedDiffViewStateCache,
    isAllMode,
    isBranchEntry,
    isBranchMode,
    isClearingNotes,
    isCommitMode,
    isDark,
    key,
    language,
    largeDiffRenderLimit,
    lastScrollHeightRef,
    latestDomScrollAnchorRef,
    liveBranchEntries,
    loadSchedulerRef,
    loadSection,
    loadSectionNow,
    loadSectionRef,
    loadedIndicesRef,
    loadingIndicesRef,
    markDirectScrollInput,
    maxScrollTop,
    maxThumbTop,
    modifiedEditor,
    modifiedEditorsRef,
    mountedRef,
    navigatedIndex,
    next,
    nextDiffResult,
    nextLargeDiffRenderLimit,
    notesCopied,
    notesCopiedResetTimerRef,
    notesCopyMountedRef,
    ok,
    openAllDiffs,
    openAlternateDiff,
    openBranchAllDiffs,
    openBranchDiff,
    openCommitDiff,
    openConflictReview,
    openFile,
    openSection,
    persistCombinedDiffScrollAnchor,
    preservedScrollTop,
    prevCombinedGitStatusSignatureRef,
    previewDiffComments,
    programmaticScrollMarks,
    recordCombinedDiffDomScrollAnchor,
    recordCombinedDiffVirtualScrollAnchor,
    rect,
    renderableBranchEntries,
    requestCombinedDiffSectionReload,
    resizeObserver,
    restoredSections,
    retrySection,
    retrySectionRef,
    scheduleSettledAnchorPersist,
    scheduler,
    scrollAnchorRef,
    scrollContainerRef,
    scrollHeight,
    scrollOffsetRef,
    scrollThumb,
    scrollTop,
    section,
    sectionHeights,
    sectionIndexByKey,
    sectionIndexByKeyRef,
    sections,
    sectionsRef,
    setActiveTreeSectionState,
    setAllSectionsCollapsed,
    setClampRestoreCount,
    setClearNotesDialogOpen,
    setFileTreeCollapsed,
    setFileTreeCollapsedState,
    setGeneration,
    setIsClearingNotes,
    setNotesCopied,
    setScrollContainerRef,
    setScrollThumb,
    setSectionHeights,
    setSections,
    setSideBySide,
    settings,
    shouldAutoReloadFromGitStatus,
    shouldLoadAfterExpand,
    shrank,
    sideBySide,
    skippedConflictNotice,
    snapshotEntries,
    state,
    storedContent,
    storedResult,
    target,
    targetRuntimeOwner,
    thumb,
    thumbHeight,
    thumbTop,
    timerId,
    toggleDiffWordWrap,
    toggleSection,
    toggleSideBySide,
    top,
    track,
    trackHeight,
    trackRect,
    treeMode,
    uncommittedEntries,
    updateCachedScrollPosition,
    updateCombinedDiffScrollbar,
    updateSettings,
    viewStateKey,
    viewedSectionKeys,
    virtualizer,
    visibleRows,
    worktree,
    writeCombinedDiffScrollAnchor,
  } = context

  return (
    <>
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between gap-3 px-3 py-1.5 border-b border-border bg-background/50 shrink-0">
          <div className="flex min-w-0 items-center gap-2">
            {fileTreeCollapsed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={translate(
                      'auto.components.editor.CombinedDiffViewer.b6c3b84476',
                      'Show file tree'
                    )}
                    onClick={() => setFileTreeCollapsed(false)}
                  >
                    <PanelLeftOpen className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  {translate(
                    'auto.components.editor.CombinedDiffViewer.b6c3b84476',
                    'Show file tree'
                  )}
                </TooltipContent>
              </Tooltip>
            )}
            <span className="truncate text-xs text-muted-foreground">
              {sections.length}{' '}
              {translate('auto.components.editor.CombinedDiffViewer.7e7ca60816', 'changed files')}
              {(isAllMode || isBranchMode) && branchCompare
                ? translate(
                    'auto.components.editor.CombinedDiffViewer.6094135eec',
                    ' vs {{value0}}',
                    { value0: branchCompare.baseRef }
                  )
                : ''}
              {isCommitMode && commitCompare
                ? translate(
                    'auto.components.editor.CombinedDiffViewer.724a13568d',
                    ' in {{value0}}',
                    { value0: commitCompare.compareRef }
                  )
                : ''}
            </span>
            {diffCommentCount > 0 && (
              <div className="ml-1 flex shrink-0 items-center overflow-hidden rounded-full border border-border/70 bg-muted/40">
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-6 items-center gap-1 pl-2 pr-1.5 text-[11px] font-medium leading-none text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
                      aria-label={translate(
                        'auto.components.editor.CombinedDiffViewer.8f68ad9ca9',
                        'Show {{value0}} AI {{value1}}',
                        {
                          value0: diffCommentCount,
                          value1: diffCommentCount === 1 ? 'note' : 'notes'
                        }
                      )}
                    >
                      <Sparkles className="size-3 text-violet-500 dark:text-violet-400" />
                      <span>
                        {translate(
                          'auto.components.editor.CombinedDiffViewer.bb84b4c374',
                          'AI notes'
                        )}
                      </span>
                      <span className="rounded-full bg-background/80 px-1 text-[10px] tabular-nums text-muted-foreground">
                        {diffCommentCount}
                      </span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" side="bottom" sideOffset={6} className="w-80 p-0">
                    <DiffNotesPreviewPopover
                      comments={previewDiffComments}
                      totalCount={diffCommentCount}
                      copied={notesCopied}
                      onCopy={() => void handleCopyNotes()}
                      onClear={() => setClearNotesDialogOpen(true)}
                    />
                  </PopoverContent>
                </Popover>
                <DiffNotesSendMenu
                  worktreeId={file.worktreeId}
                  groupId={activeGroupId ?? file.worktreeId}
                  comments={diffCommentsForWorktree}
                  actionLabel="Send"
                  triggerClassName="h-6 gap-1 rounded-none border-l border-border/70 px-2 text-[11px] font-medium leading-none text-foreground/80 hover:bg-accent hover:text-foreground"
                  iconClassName="size-3"
                />
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {file.combinedAlternate && (
              <button
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={openAlternateDiff}
              >
                {file.combinedAlternate.source === 'combined-branch'
                  ? translate(
                      'auto.components.editor.CombinedDiffViewer.3d909843bb',
                      'Open Branch Diff'
                    )
                  : translate(
                      'auto.components.editor.CombinedDiffViewer.982d14bfa5',
                      'Open All Changes'
                    )}
              </button>
            )}
            <button
              className="w-20 text-left text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setAllSectionsCollapsed(!allSectionsCollapsed)}
            >
              {allSectionsCollapsed
                ? translate('auto.components.editor.CombinedDiffViewer.19c45cfdc0', 'Expand All')
                : translate('auto.components.editor.CombinedDiffViewer.ea08dae15b', 'Collapse All')}
            </button>
            <button
              className="w-24 px-2 py-0.5 text-center text-xs rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
              onClick={toggleSideBySide}
            >
              {sideBySide
                ? translate('auto.components.editor.CombinedDiffViewer.f786fd54e1', 'Inline')
                : translate('auto.components.editor.CombinedDiffViewer.ec5053c7f5', 'Side by Side')}
            </button>
            <button
              className={`inline-flex h-6 items-center gap-1 rounded border border-border px-2 text-xs transition-colors hover:text-foreground ${
                settings?.diffWordWrap === true
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground'
              }`}
              onClick={toggleDiffWordWrap}
              aria-pressed={settings?.diffWordWrap === true}
            >
              <WrapText className="size-3.5" />
              {settings?.diffWordWrap === true
                ? translate('auto.components.editor.CombinedDiffViewer.a4420ca1f7', 'Wrap On')
                : translate('auto.components.editor.CombinedDiffViewer.dde325ddfe', 'Wrap Off')}
            </button>
          </div>
        </div>

        {commitHeader}
        <div className="flex min-h-0 flex-1">
          <CombinedDiffFileTree
            mode={treeMode}
            worktreePath={file.filePath}
            entries={entries}
            sectionIndexByKey={sectionIndexByKey}
            activeSectionKey={activeTreeSectionKey}
            viewedSectionKeys={viewedSectionKeys}
            collapsed={fileTreeCollapsed}
            onCollapsedChange={setFileTreeCollapsed}
            onNavigate={handleTreeNavigate}
          />
          <div className="relative min-w-0 flex-1">
            <div
              ref={setScrollContainerRef}
              className="combined-diff-scroll-container h-full overflow-auto pr-5 scrollbar-editor"
              onWheel={markDirectScrollInput}
              onTouchMove={markDirectScrollInput}
            >
              {skippedConflictNotice}
              <div className="relative w-full" style={{ height: `${combinedDiffTotalSize}px` }}>
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const section = sections[virtualItem.index]
                  if (!section) {
                    return null
                  }

                  return (
                    <div
                      key={virtualItem.key}
                      data-index={virtualItem.index}
                      data-combined-diff-section-row
                      data-combined-diff-section-key={section.key}
                      ref={virtualizer.measureElement}
                      className="absolute left-0 top-0 w-full"
                      // Why: position via top, not transform, so sticky file headers don't jump (transform creates a containing block).
                      style={{ top: `${virtualItem.start}px` }}
                    >
                      <DiffSectionItem
                        section={section}
                        index={virtualItem.index}
                        isBranchMode={isBranchMode}
                        sideBySide={sideBySide}
                        isDark={isDark}
                        settings={settings}
                        sectionHeight={sectionHeights[virtualItem.index]}
                        worktreeId={file.worktreeId}
                        loadSection={loadSection}
                        retrySection={retrySection}
                        toggleSection={toggleSection}
                        openSection={openSection}
                        openSectionTitle={
                          isAllMode || isBranchMode || isCommitMode ? 'Open diff' : 'Open in editor'
                        }
                        setSectionHeights={setSectionHeights}
                        setSections={setSections}
                        modifiedEditorsRef={modifiedEditorsRef}
                        handleSectionSaveRef={handleSectionSaveRef}
                        renderHeaderTrailingContent={(section) => {
                          const fileNotes = diffCommentsForWorktree.filter(
                            (comment) => comment.filePath === section.path
                          )
                          return fileNotes.length > 0 ? (
                            <DiffNotesSendMenu
                              worktreeId={file.worktreeId}
                              groupId={activeGroupId ?? file.worktreeId}
                              comments={diffCommentsForWorktree}
                              filePath={section.path}
                              showFileScope
                              triggerClassName="p-0.5 can-hover:opacity-0 group-hover:opacity-100"
                            />
                          ) : null
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
            {scrollThumb.visible && (
              <div
                aria-hidden="true"
                className="absolute inset-y-1 right-1 z-20 w-4 cursor-default rounded bg-muted/15 pl-1"
                onPointerDown={handleCombinedDiffScrollbarPointerDown}
              >
                <div
                  data-combined-diff-scrollbar-thumb
                  className="absolute left-1 right-0 rounded bg-muted-foreground/30"
                  style={{ top: scrollThumb.top, height: scrollThumb.height }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      <Dialog
        open={clearNotesDialogVisible}
        onOpenChange={(open) => {
          if (!open && !isClearingNotes) {
            setClearNotesDialogOpen(false)
          } else if (open) {
            setClearNotesDialogOpen(true)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {translate('auto.components.editor.CombinedDiffViewer.948a5fd6c8', 'Clear Notes')}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {translate('auto.components.editor.CombinedDiffViewer.84898c548d', 'Clear')}{' '}
              {diffCommentCount}{' '}
              {diffCommentCount === 1
                ? translate('auto.components.editor.CombinedDiffViewer.8ab3248fd8', 'note')
                : translate('auto.components.editor.CombinedDiffViewer.0fb870a0fe', 'notes')}{' '}
              {translate(
                'auto.components.editor.CombinedDiffViewer.80a286d8f5',
                'from this worktree?'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setClearNotesDialogOpen(false)}
              disabled={isClearingNotes}
            >
              {translate('auto.components.editor.CombinedDiffViewer.0f806a2ab1', 'Cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleConfirmClearNotes()}
              disabled={isClearingNotes || diffCommentCount === 0}
            >
              <Trash2 className="size-4" />
              {translate('auto.components.editor.CombinedDiffViewer.948a5fd6c8', 'Clear Notes')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

}

