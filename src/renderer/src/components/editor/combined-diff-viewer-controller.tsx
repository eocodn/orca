import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { OpenFile } from '@/store/slices/editor'
import { CombinedDiffViewerView } from './combined-diff-viewer-view'
import { useCombinedDiffViewerModel } from './combined-diff-viewer-model'
import { useCombinedDiffViewerDecorator } from './combined-diff-viewer-decorator'
import { DiffNotesPreviewPopover } from './combined-diff-viewer-notes'
import { DiffNotesSendMenu } from './DiffNotesSendMenu'
import { getCombinedDiffCommitMessageBody } from './combined-diff-commit-message'

export default function CombinedDiffViewer({
  file,
  viewStateKey
}: {
  file: OpenFile
  viewStateKey: string
}): React.JSX.Element {
  const model = useCombinedDiffViewerModel({ file, viewStateKey })
  const decorator = useCombinedDiffViewerDecorator(model)
  const clearDiffComments = useAppStore((s) => s.clearDiffComments)
  const openAllDiffs = useAppStore((s) => s.openAllDiffs)
  const openBranchAllDiffs = useAppStore((s) => s.openBranchAllDiffs)
  const openConflictReview = useAppStore((s) => s.openConflictReview)
  const isDark = model.settings?.theme === 'dark' ||
    (model.settings?.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [clearNotesDialogOpen, setClearNotesDialogOpen] = useState(false)
  const [isClearingNotes, setIsClearingNotes] = useState(false)
  const [notesCopied, setNotesCopied] = useState(false)
  const mountedRef = useRef(true)
  const notesCopiedResetTimerRef = useRef<number | null>(null)
  const notesCopyMountedRef = useRef(false)
  const clearNotesDialogVisible = clearNotesDialogOpen && (model.diffCommentsForWorktree.length > 0 || isClearingNotes)
  if (clearNotesDialogOpen && !clearNotesDialogVisible) setClearNotesDialogOpen(false)
  const clearNotesCopiedResetTimer = useCallback(() => {
    if (notesCopiedResetTimerRef.current !== null) {
      window.clearTimeout(notesCopiedResetTimerRef.current)
      notesCopiedResetTimerRef.current = null
    }
  }, [])
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearNotesCopiedResetTimer()
    }
  }, [clearNotesCopiedResetTimer])
  const setScrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    notesCopyMountedRef.current = node !== null
    decorator.setScrollContainerRef(node)
  }, [decorator])
  const handleCopyNotes = useCallback(async () => {
    if (model.diffCommentsForWorktree.length === 0) return
    try {
      await window.api.ui.writeClipboardText(model.diffCommentsPrompt)
      if (!notesCopyMountedRef.current) return
      clearNotesCopiedResetTimer()
      setNotesCopied(true)
      notesCopiedResetTimerRef.current = window.setTimeout(() => {
        setNotesCopied(false)
        notesCopiedResetTimerRef.current = null
      }, 1500)
    } catch {
      // Clipboard feedback is intentionally non-blocking when the window loses focus.
    }
  }, [clearNotesCopiedResetTimer, model.diffCommentsForWorktree.length, model.diffCommentsPrompt])
  const handleConfirmClearNotes = useCallback(async () => {
    if (model.diffCommentsForWorktree.length === 0 || isClearingNotes) return
    setIsClearingNotes(true)
    try {
      const ok = await clearDiffComments(file.worktreeId)
      if (!mountedRef.current) return
      if (ok) setClearNotesDialogOpen(false)
      else toast.error(translate('auto.components.editor.CombinedDiffViewer.45cf23b418', 'Failed to clear notes.'))
    } finally {
      if (mountedRef.current) setIsClearingNotes(false)
    }
  }, [clearDiffComments, file.worktreeId, isClearingNotes, model.diffCommentsForWorktree.length])
  const openAlternateDiff = useCallback(() => {
    if (!file.combinedAlternate) return
    if (file.combinedAlternate.source === 'combined-all') {
      openAllDiffs(file.worktreeId, file.filePath)
      return
    }
    if (model.branchSummary?.status === 'ready') {
      openBranchAllDiffs(file.worktreeId, file.filePath, model.branchSummary, { source: 'combined-all' })
    }
  }, [file, model.branchSummary, openAllDiffs, openBranchAllDiffs])
  const commitBody = getCombinedDiffCommitMessageBody(model.commitCompare?.message, model.commitCompare?.subject)
  const commitHeader = model.isCommitMode && model.commitCompare ? (
    <div className="border-b border-border bg-background px-4 py-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          {model.commitCompare.subject && <Tooltip><TooltipTrigger asChild><div className="truncate text-sm font-semibold text-foreground" title={model.commitCompare.subject}>{model.commitCompare.subject}</div></TooltipTrigger><TooltipContent side="bottom" sideOffset={6} className="max-w-96">{model.commitCompare.subject}</TooltipContent></Tooltip>}
          {commitBody && <div className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground scrollbar-sleek">{commitBody}</div>}
        </div>
        <span className="shrink-0 font-mono text-[11px] leading-5 text-muted-foreground">{model.commitCompare.compareRef}</span>
      </div>
    </div>
  ) : null
  const reviewConflicts = useCallback(() => {
    openConflictReview(file.worktreeId, file.filePath, (file.skippedConflicts ?? []).map((entry) => ({ path: entry.path, conflictKind: entry.conflictKind })), 'combined-diff-exclusion')
  }, [file.filePath, file.skippedConflicts, file.worktreeId, openConflictReview])
  if (model.sections.length === 0 && (file.skippedConflicts?.length ?? 0) > 0) {
    return <div className="flex h-full min-h-0 flex-col">{commitHeader}<div className="flex flex-1 items-center justify-center px-6 text-center"><div className="max-w-md space-y-3"><div className="text-sm font-medium text-foreground">{translate('auto.components.editor.CombinedDiffViewer.820ec01f24', 'Conflicted files are reviewed separately')}</div><div className="text-xs text-muted-foreground">{translate('auto.components.editor.CombinedDiffViewer.eb5f40e49c', 'This diff view excludes unresolved conflicts because the normal two-way diff pipeline is not conflict-safe.')}</div><div className="text-xs text-muted-foreground">{file.skippedConflicts.map((entry) => entry.path).join(', ')}</div><div className="flex justify-center"><Button type="button" size="sm" variant="outline" onClick={reviewConflicts}>{translate('auto.components.editor.CombinedDiffViewer.39f8007549', 'Review conflicts')}</Button></div></div></div></div>
  }
  if (model.sections.length === 0) {
    return <div className="flex h-full min-h-0 flex-col">{commitHeader}<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{translate('auto.components.editor.CombinedDiffViewer.fd8892b120', 'No changes to display')}</div></div>
  }
  const skippedConflictNotice = (file.skippedConflicts?.length ?? 0) > 0 ? (
    <div className="mx-4 mt-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs">
      <div className="font-medium text-foreground">{translate('auto.components.editor.CombinedDiffViewer.820ec01f24', 'Conflicted files are reviewed separately')}</div>
      <div className="mt-1 text-muted-foreground">{file.skippedConflicts!.length} {translate('auto.components.editor.CombinedDiffViewer.689b99f8ad', 'unresolved conflict')}{file.skippedConflicts!.length === 1 ? '' : 's'} {translate('auto.components.editor.CombinedDiffViewer.39e73e7181', 'were excluded from this diff view.')}</div>
      <div className="mt-2 flex items-center gap-2"><Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={reviewConflicts}>{translate('auto.components.editor.CombinedDiffViewer.39f8007549', 'Review conflicts')}</Button></div>
    </div>
  ) : null
  const allSectionsCollapsed = model.sections.every((section) => section.collapsed)
  const context = {
    ...model,
    ...decorator,
    isDark,
    commitBody,
    commitHeader,
    skippedConflictNotice,
    allSectionsCollapsed,
    clearDiffComments,
    clearNotesCopiedResetTimer,
    clearNotesDialogOpen,
    clearNotesDialogVisible,
    handleConfirmClearNotes,
    handleCopyNotes,
    notesCopied,
    notesCopiedResetTimerRef,
    notesCopyMountedRef,
    setClearNotesDialogOpen,
    setIsClearingNotes,
    setNotesCopied,
    setScrollContainerRef,
    openAlternateDiff,
    openAllDiffs,
    openBranchAllDiffs,
    openConflictReview,
    previewDiffComments: model.previewDiffComments,
    DiffNotesPreviewPopover,
    DiffNotesSendMenu
  }
  return <CombinedDiffViewerView context={context} />
}
