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

import { CombinedDiffViewerView } from './combined-diff-viewer-view'

export default function CombinedDiffViewer({
  file,
  viewStateKey
}: {
  file: OpenFile
  viewStateKey: string
}): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const gitStatusEntries = useAppStore(
    (s) => s.gitStatusByWorktree[file.worktreeId] ?? EMPTY_GIT_STATUS_ENTRIES
  )
  const liveBranchEntries = useAppStore(
    (s) => s.gitBranchChangesByWorktree[file.worktreeId] ?? EMPTY_GIT_BRANCH_ENTRIES
  )
  const branchSummary = useAppStore((s) => s.gitBranchCompareSummaryByWorktree[file.worktreeId])
  const openAllDiffs = useAppStore((s) => s.openAllDiffs)
  const openFile = useAppStore((s) => s.openFile)
  const openBranchDiff = useAppStore((s) => s.openBranchDiff)
  const openCommitDiff = useAppStore((s) => s.openCommitDiff)
  const openConflictReview = useAppStore((s) => s.openConflictReview)
  const openBranchAllDiffs = useAppStore((s) => s.openBranchAllDiffs)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const clearDiffComments = useAppStore((s) => s.clearDiffComments)
  const diffCommentsForWorktree = useAppStore((s) =>
    selectWorktreeDiffCommentsOrEmpty(s, file.worktreeId)
  )
  const activeGroupId = useAppStore((s) => s.activeGroupIdByWorktree[file.worktreeId])
  const isDark =
    settings?.theme === 'dark' ||
    (settings?.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  const diffCommentCount = diffCommentsForWorktree.length
  const diffCommentsPrompt = React.useMemo(
    () => formatDiffComments(diffCommentsForWorktree),
    [diffCommentsForWorktree]
  )
  const previewDiffComments = React.useMemo(
    () =>
      [...diffCommentsForWorktree]
        .sort((a, b) => a.filePath.localeCompare(b.filePath) || a.lineNumber - b.lineNumber)
        .slice(0, 4),
    [diffCommentsForWorktree]
  )

  const [sections, setSections] = useState<DiffSection[]>([])
  const [sideBySide, setSideBySide] = useState(() =>
    getInitialCombinedDiffSideBySide(settings?.diffDefaultView)
  )
  const [sectionHeights, setSectionHeights] = useState<Record<number, number>>({})
  const [clearNotesDialogOpen, setClearNotesDialogOpen] = useState(false)
  const [isClearingNotes, setIsClearingNotes] = useState(false)
  const clearNotesDialogVisible = clearNotesDialogOpen && (diffCommentCount > 0 || isClearingNotes)
  if (clearNotesDialogOpen && !clearNotesDialogVisible) {
    // Why: notes may be cleared outside this dialog; close it this render instead of flashing an empty confirmation.
    setClearNotesDialogOpen(false)
  }
  const [notesCopied, setNotesCopied] = useState(false)
  const mountedRef = useRef(true)
  // Why: the copy action owns its reset timer instead of repairing copied state after render.
  const notesCopiedResetTimerRef = useRef<number | null>(null)
  // Why: clipboard IPC can resolve after unmount; skip copied feedback rather than start a reset timer on a stale viewer.
  const notesCopyMountedRef = useRef(false)
  const [fileTreeCollapsed, setFileTreeCollapsedState] = useState(() =>
    getInitialCombinedDiffFileTreeCollapsed(settings?.combinedDiffFileTreeVisibleByDefault)
  )
  // Why: generation (state) keys DiffSectionItem remounts; generationRef mirrors it so loadSection's stale-async check avoids a stale closure.
  const [generation, setGeneration] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [scrollThumb, setScrollThumb] = useState<CombinedDiffScrollThumb>({
    visible: false,
    top: 0,
    height: COMBINED_DIFF_SCROLLBAR_THUMB_MIN_HEIGHT
  })
  const scrollOffsetRef = useRef(combinedDiffScrollTopCache.get(viewStateKey) ?? 0)
  const scrollAnchorRef = useRef<VirtualizedScrollAnchor>(
    combinedDiffScrollAnchorCache.get(viewStateKey) ?? null
  )
  const latestDomScrollAnchorRef = useRef<VirtualizedScrollAnchor>(
    combinedDiffScrollAnchorCache.get(viewStateKey) ?? null
  )
  const directScrollInputUntilRef = useRef(0)
  const [programmaticScrollMarks] = useState(createProgrammaticScrollMarks)
  // Why: a scroll pinned at a shrunken max is a browser clamp, not user input; bump to ask the anchor restore to re-pin.
  const [clampRestoreCount, setClampRestoreCount] = useState(0)
  const lastScrollHeightRef = useRef(0)
  const activeScrollbarDragCleanupRef = useRef<CombinedDiffScrollbarDragCleanup | null>(null)
  const loadedIndicesRef = useRef<Set<number>>(new Set())
  const loadingIndicesRef = useRef<Set<number>>(new Set())
  const sectionsRef = useRef<DiffSection[]>([])
  const generationRef = useRef(0)
  const loadSectionRef = useRef<(index: number) => Promise<void>>(async () => {})
  const retrySectionRef = useRef<(index: number) => void>(() => {})
  const updateCombinedDiffScrollbar = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container || container.scrollHeight <= container.clientHeight + 1) {
      setScrollThumb((prev) =>
        prev.visible
          ? {
              visible: false,
              top: 0,
              height: COMBINED_DIFF_SCROLLBAR_THUMB_MIN_HEIGHT
            }
          : prev
      )
      return
    }

    const trackHeight = Math.max(1, container.clientHeight - 8)
    const maxScrollTop = Math.max(1, container.scrollHeight - container.clientHeight)
    const height = Math.min(
      trackHeight,
      Math.max(
        COMBINED_DIFF_SCROLLBAR_THUMB_MIN_HEIGHT,
        (container.clientHeight / container.scrollHeight) * trackHeight
      )
    )
    const top = ((trackHeight - height) * container.scrollTop) / maxScrollTop
    setScrollThumb({ visible: true, top, height })
  }, [])

  const markDirectScrollInput = useCallback((): void => {
    directScrollInputUntilRef.current = window.performance.now() + 250
  }, [])

  const hasDirectScrollInput = useCallback(
    () => window.performance.now() < directScrollInputUntilRef.current,
    []
  )

  const clearNotesCopiedResetTimer = useCallback((): void => {
    if (notesCopiedResetTimerRef.current !== null) {
      window.clearTimeout(notesCopiedResetTimerRef.current)
      notesCopiedResetTimerRef.current = null
    }
  }, [])

  const cleanupActiveScrollbarDrag = useCallback((): void => {
    activeScrollbarDragCleanupRef.current?.()
  }, [])

  const setScrollContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollContainerRef.current = node
      notesCopyMountedRef.current = node !== null
      if (node === null) {
        // Why: copied feedback is tied to the surface lifetime; the root-ref unmount is where stale feedback gets disabled.
        clearNotesCopiedResetTimer()
        cleanupActiveScrollbarDrag()
        return
      }
      window.requestAnimationFrame(updateCombinedDiffScrollbar)
    },
    [cleanupActiveScrollbarDrag, clearNotesCopiedResetTimer, updateCombinedDiffScrollbar]
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cleanupActiveScrollbarDrag()
    }
  }, [cleanupActiveScrollbarDrag])
  const loadSchedulerRef = useRef(
    createCombinedDiffLoadScheduler({
      loadSection: (index) => loadSectionRef.current(index)
    })
  )
  sectionsRef.current = sections

  // Why: seed from Settings until the user picks a toolbar mode this session, then follow that choice over the global default.
  useEffect(() => {
    if (settings?.diffDefaultView !== undefined && combinedDiffPreferences.sideBySide === null) {
      setSideBySide(settings.diffDefaultView === 'side-by-side')
    }
  }, [settings?.diffDefaultView])

  useEffect(() => {
    if (
      settings?.combinedDiffFileTreeVisibleByDefault !== undefined &&
      combinedDiffPreferences.fileTreeCollapsed === null
    ) {
      setFileTreeCollapsedState(settings.combinedDiffFileTreeVisibleByDefault === false)
    }
  }, [settings?.combinedDiffFileTreeVisibleByDefault])

  const setFileTreeCollapsed = useCallback((collapsed: boolean) => {
    combinedDiffPreferences.fileTreeCollapsed = collapsed
    setFileTreeCollapsedState(collapsed)
  }, [])

  const isBranchMode = file.diffSource === 'combined-branch'
  const isCommitMode = file.diffSource === 'combined-commit'
  const isAllMode = file.diffSource === 'combined-all'
  const branchCompare =
    file.branchCompare?.baseOid && file.branchCompare.headOid && file.branchCompare.mergeBase
      ? file.branchCompare
      : null
  const commitCompare = file.commitCompare?.commitOid ? file.commitCompare : null

  // Why: prefer the tab-open snapshot so a commit changing gitStatusByWorktree doesn't rebuild sections and lose loaded content.
  const snapshotEntries = React.useMemo(
    () => file.uncommittedEntriesSnapshot?.filter((e) => e.conflictStatus !== 'unresolved'),
    [file.uncommittedEntriesSnapshot]
  )
  const uncommittedEntries = React.useMemo(() => {
    if (!snapshotEntries) {
      return getCombinedUncommittedEntries(gitStatusEntries, file.combinedAreaFilter)
    }
    // Why: row load-state changes must not rebuild the snapshot list; the ref is consulted only when live Git status changes.
    return resolveCombinedUncommittedSnapshotEntries(
      snapshotEntries,
      gitStatusEntries,
      getRetainedResolvedSnapshotEntries(sectionsRef.current)
    )
  }, [snapshotEntries, gitStatusEntries, file.combinedAreaFilter])
  const branchEntries = React.useMemo<GitBranchChangeEntry[]>(() => {
    return getCombinedBranchEntries(file.branchEntriesSnapshot, liveBranchEntries)
  }, [file.branchEntriesSnapshot, liveBranchEntries])
  const renderableBranchEntries = React.useMemo(
    () => (branchCompare ? branchEntries : []),
    [branchCompare, branchEntries]
  )
  const commitEntries = React.useMemo<GitBranchChangeEntry[]>(
    () => file.commitEntriesSnapshot ?? [],
    [file.commitEntriesSnapshot]
  )
  const allEntries = React.useMemo(
    () => [...uncommittedEntries, ...renderableBranchEntries],
    [renderableBranchEntries, uncommittedEntries]
  )
  const entries = isAllMode
    ? allEntries
    : isBranchMode
      ? renderableBranchEntries
      : isCommitMode
        ? commitEntries
        : uncommittedEntries
  const treeMode = isAllMode
    ? 'all'
    : isBranchMode
      ? 'branch'
      : isCommitMode
        ? 'commit'
        : 'uncommitted'
  const hasUncommittedEntriesSnapshot = file.uncommittedEntriesSnapshot !== undefined
  const shouldAutoReloadFromGitStatus = shouldAutoReloadCombinedDiffFromGitStatus({
    mode: treeMode,
    hasUncommittedEntriesSnapshot
  })
  const entrySignature = React.useMemo(
    () =>
      JSON.stringify({
        mode: file.diffSource,
        areaFilter: file.combinedAreaFilter ?? null,
        compareVersion: file.branchCompare?.compareVersion ?? null,
        commitVersion: file.commitCompare?.compareVersion ?? null,
        compare:
          isBranchMode && branchCompare
            ? {
                baseOid: branchCompare.baseOid,
                headOid: branchCompare.headOid,
                mergeBase: branchCompare.mergeBase
              }
            : null,
        commit:
          isCommitMode && commitCompare
            ? {
                commitOid: commitCompare.commitOid,
                parentOid: commitCompare.parentOid ?? null
              }
            : null,
        entries: entries.map((entry) => ({
          path: entry.path,
          status: entry.status,
          oldPath: entry.oldPath ?? null,
          area: 'area' in entry ? entry.area : null,
          added: 'added' in entry ? (entry.added ?? null) : null,
          removed: 'removed' in entry ? (entry.removed ?? null) : null
        }))
      }),
    [
      branchCompare,
      commitCompare,
      entries,
      file.branchCompare?.compareVersion,
      file.combinedAreaFilter,
      file.commitCompare?.compareVersion,
      file.diffSource,
      isBranchMode,
      isCommitMode
    ]
  )

  // Why: tab/worktree switches unmount this viewer; cache by pane key so remount restores sections+scroll before repaint.
  useLayoutEffect(() => {
    const cached = combinedDiffViewStateCache.get(viewStateKey)
    const canRestoreSnapshotSectionsByKey =
      hasUncommittedEntriesSnapshot &&
      cached !== undefined &&
      combinedDiffSectionsMatchEntryMetadata({
        entries,
        sections: cached.sections,
        treeMode
      })
    const canRestoreCachedSections =
      cached &&
      (cached.entrySignature === entrySignature || canRestoreSnapshotSectionsByKey) &&
      (!shouldAutoReloadFromGitStatus ||
        (cached.gitStatusSignature ?? '') ===
          buildCombinedGitStatusSignature(cached.sections, gitStatusEntries)) &&
      (cached.sections.length > 0 || entries.length === 0)
    if (canRestoreCachedSections && cached) {
      const collapsedPreference = combinedDiffPreferences.collapsed
      const restoredSections =
        collapsedPreference === null
          ? cached.sections
          : cached.sections.map((section) => ({
              ...section,
              collapsed: collapsedPreference
            }))
      setSections(restoredSections)
      setSectionHeights(cached.sectionHeights)
      setSideBySide(combinedDiffPreferences.sideBySide ?? cached.sideBySide)
      loadedIndicesRef.current = new Set(
        cached.loadedIndices.filter((index) => !restoredSections[index]?.loading)
      )
      loadingIndicesRef.current.clear()
      scrollOffsetRef.current = combinedDiffScrollTopCache.get(viewStateKey) ?? cached.scrollTop
      scrollAnchorRef.current = combinedDiffScrollAnchorCache.get(viewStateKey) ?? null
      latestDomScrollAnchorRef.current = scrollAnchorRef.current
      return
    }

    scrollOffsetRef.current = combinedDiffScrollTopCache.get(viewStateKey) ?? 0
    scrollAnchorRef.current = combinedDiffScrollAnchorCache.get(viewStateKey) ?? null
    latestDomScrollAnchorRef.current = scrollAnchorRef.current
    setSections(
      entries.map((entry) => ({
        key: getCombinedDiffFileTreeSectionKey(treeMode, entry),
        path: entry.path,
        status: entry.status,
        area: 'area' in entry ? entry.area : undefined,
        oldPath: entry.oldPath,
        added: 'added' in entry ? entry.added : undefined,
        removed: 'removed' in entry ? entry.removed : undefined,
        originalContent: '',
        modifiedContent: '',
        collapsed: combinedDiffPreferences.collapsed ?? false,
        loading: true,
        error: undefined,
        dirty: false,
        diffResult: null,
        largeDiffRenderLimit: null
      }))
    )
    setSectionHeights({})
    loadedIndicesRef.current.clear()
    loadingIndicesRef.current.clear()
    loadSchedulerRef.current.reset()
    generationRef.current += 1
    setGeneration((prev) => prev + 1)
  }, [
    entries,
    entrySignature,
    gitStatusEntries,
    hasUncommittedEntriesSnapshot,
    shouldAutoReloadFromGitStatus,
    treeMode,
    viewStateKey
  ])

  const loadSectionNow = useCallback(
    async (index: number) => {
      if (loadedIndicesRef.current.has(index) || loadingIndicesRef.current.has(index)) {
        return
      }
      loadingIndicesRef.current.add(index)

      const gen = generationRef.current
      const entries = isAllMode
        ? allEntries
        : isBranchMode
          ? renderableBranchEntries
          : isCommitMode
            ? commitEntries
            : uncommittedEntries
      const entry = entries[index]
      if (!entry) {
        loadingIndicesRef.current.delete(index)
        return
      }

      let result: GitDiffResult
      let error: string | undefined
      try {
        const connectionId = getCombinedDiffSectionConnectionId(
          file.worktreeId,
          file.filePath,
          entry.path
        )
        const state = useAppStore.getState()
        const fileSettings = settingsForRuntimeOwner(state.settings, file.runtimeEnvironmentId)
        if ((isBranchMode || (isAllMode && !('area' in entry))) && branchCompare) {
          result = await withDiffSectionLoadTimeout(
            getRuntimeGitBranchDiff(
              {
                settings: fileSettings,
                worktreeId: file.worktreeId,
                worktreePath: file.filePath,
                connectionId
              },
              {
                compare: {
                  baseRef: branchCompare.baseRef,
                  baseOid: branchCompare.baseOid!,
                  headOid: branchCompare.headOid!,
                  mergeBase: branchCompare.mergeBase!
                },
                filePath: entry.path,
                oldPath: entry.oldPath
              }
            )
          )
        } else if (isCommitMode && commitCompare) {
          result = await withDiffSectionLoadTimeout(
            getRuntimeGitCommitDiff(
              {
                settings: fileSettings,
                worktreeId: file.worktreeId,
                worktreePath: file.filePath,
                connectionId
              },
              {
                commitOid: commitCompare.commitOid,
                parentOid: commitCompare.parentOid,
                filePath: entry.path,
                oldPath: entry.oldPath
              }
            )
          )
        } else {
          result = await withDiffSectionLoadTimeout(
            getRuntimeGitDiff(
              {
                settings: fileSettings,
                worktreeId: file.worktreeId,
                worktreePath: file.filePath,
                connectionId
              },
              {
                filePath: entry.path,
                staged: 'area' in entry && entry.area === 'staged'
              }
            )
          )
        }
      } catch (err) {
        error = getDiffSectionLoadErrorMessage(err)
        result = {
          kind: 'text',
          originalContent: '',
          modifiedContent: '',
          originalIsBinary: false,
          modifiedIsBinary: false
        } as GitDiffResult
      }

      const largeDiffRenderLimit =
        !error && result.kind === 'text'
          ? (result.largeDiffRenderLimit ??
            getLargeDiffRenderLimit({
              originalContent: result.originalContent,
              modifiedContent: result.modifiedContent
            }))
          : null

      loadingIndicesRef.current.delete(index)
      if (generationRef.current !== gen) {
        return
      }
      const storedContent = getStoredTextDiffContent(result, largeDiffRenderLimit)
      const storedResult = getStoredTextDiffResult(result, largeDiffRenderLimit)
      loadedIndicesRef.current.add(index)
      setSections((prev) => {
        return prev.map((s, i) =>
          i === index
            ? {
                ...s,
                diffResult: storedResult,
                originalContent: storedContent.originalContent,
                modifiedContent: storedContent.modifiedContent,
                loading: false,
                error,
                largeDiffRenderLimit
              }
            : s
        )
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      branchCompare?.baseOid,
      branchCompare?.headOid,
      branchCompare?.mergeBase,
      allEntries,
      commitCompare?.commitOid,
      commitCompare?.parentOid,
      commitEntries,
      file.filePath,
      file.runtimeEnvironmentId,
      isAllMode,
      isBranchMode,
      isCommitMode,
      renderableBranchEntries,
      uncommittedEntries
    ]
  )
  loadSectionRef.current = loadSectionNow

  useEffect(() => {
    // Why: React StrictMode replays effect cleanup in dev; reset revives the scheduler for the replayed mount.
    const scheduler = loadSchedulerRef.current
    scheduler.reset()
    return () => scheduler.dispose()
  }, [])

  // Progressive loading: queue diff content when a section becomes visible.
  const loadSection = useCallback((index: number) => {
    if (sectionsRef.current[index]?.collapsed) {
      return
    }
    loadSchedulerRef.current.request(index)
  }, [])

  useEffect(() => {
    // Why: queue the first rows deterministically so the visible viewport doesn't depend on IntersectionObserver delivery.
    const currentSections = sectionsRef.current
    for (let index = 0; index < currentSections.length; index += 1) {
      if (currentSections[index]?.loading && loadedIndicesRef.current.has(index)) {
        loadedIndicesRef.current.delete(index)
      }
    }

    const initialIndices = getInitialCombinedDiffSectionLoadIndices({
      sectionCount: currentSections.length,
      loadedIndices: loadedIndicesRef.current
    })

    for (const index of initialIndices) {
      if (!currentSections[index]?.collapsed) {
        loadSection(index)
      }
    }
  }, [entrySignature, loadSection, sections.length])

  const invalidateCombinedDiffViewStateCache = useCallback((): void => {
    combinedDiffViewStateCache.delete(viewStateKey)
  }, [viewStateKey])

  const retrySection = useCallback(
    (index: number) => {
      const collapsed = sectionsRef.current[index]?.collapsed ?? false
      loadedIndicesRef.current.delete(index)
      loadingIndicesRef.current.delete(index)
      invalidateCombinedDiffViewStateCache()
      generationRef.current += 1
      setGeneration((prev) => prev + 1)
      setSectionHeights((prev) => removeDiffSectionMeasuredHeight(prev, index))
      setSections((prev) =>
        prev.map((section, sectionIndex) =>
          sectionIndex === index
            ? {
                ...section,
                loading: !collapsed,
                error: undefined,
                diffResult: null,
                originalContent: '',
                modifiedContent: '',
                largeDiffRenderLimit: null,
                contentGeneration: (section.contentGeneration ?? 0) + 1
              }
            : section
        )
      )
      if (collapsed) {
        return
      }
      loadSchedulerRef.current.rerequest(index)
    },
    [invalidateCombinedDiffViewStateCache]
  )
  retrySectionRef.current = retrySection

  const modifiedEditorsRef = useRef<Map<number, monacoEditor.IStandaloneCodeEditor>>(new Map())

  const virtualizer = useVirtualizer({
    count: sections.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => {
      const section = sections[index]
      if (!section) {
        return 88
      }

      return getDiffSectionEstimatedHeight({
        collapsed: section.collapsed,
        measuredContentHeight: sectionHeights[index],
        originalContent: section.originalContent,
        modifiedContent: section.modifiedContent,
        changedLineCount:
          section.added === undefined && section.removed === undefined
            ? undefined
            : (section.added ?? 0) + (section.removed ?? 0),
        useIntrinsicImageHeight: isIntrinsicHeightImageDiff(section.diffResult),
        isLargeDiffLimited: section.largeDiffRenderLimit?.limited === true,
        lineCounts: section.largeDiffRenderLimit?.lineCounts ?? undefined
      })
    },
    overscan: COMBINED_DIFF_OVERSCAN,
    initialOffset: () => scrollOffsetRef.current,
    // Why: mark every virtualizer-issued scroll so events are attributed to the user only when this code didn't cause them.
    scrollToFn: (offset, options, instance) => {
      const target = offset + (options.adjustments ?? 0)
      // Why: writing the current position emits no scroll event; a mark here would go stale and claim a later user scroll.
      if (instance.scrollElement?.scrollTop !== target) {
        programmaticScrollMarks.mark(target)
      }
      elementScroll(offset, options, instance)
    },
    getItemKey: (index) => {
      const section = sections[index]
      if (!section) {
        return `${index}:${generation}`
      }
      return `${section.key}:${section.collapsed ? 'collapsed' : 'expanded'}:${generation}`
    }
  })
  const combinedDiffTotalSize = virtualizer.getTotalSize()
  const getCombinedDiffSectionKey = useCallback((section: DiffSection): string => section.key, [])
  const getCombinedDiffSectionElementKey = useCallback(
    (element: Element): string | null =>
      element instanceof HTMLElement ? (element.dataset.combinedDiffSectionKey ?? null) : null,
    []
  )
  const recordCombinedDiffVirtualScrollAnchor = useCallback(
    (scrollTop: number): void => {
      scrollAnchorRef.current = getVirtualizedScrollAnchorForOffset({
        getRowKey: getCombinedDiffSectionKey,
        rows: sectionsRef.current,
        scrollTop,
        virtualItems: virtualizer.getVirtualItems()
      })
      latestDomScrollAnchorRef.current = null
    },
    [getCombinedDiffSectionKey, virtualizer]
  )
  const recordCombinedDiffDomScrollAnchor = useCallback((): boolean => {
    const container = scrollContainerRef.current
    if (!container) {
      return false
    }

    const containerRect = container.getBoundingClientRect()
    const visibleRows = Array.from(
      container.querySelectorAll<HTMLElement>('[data-combined-diff-section-row]')
    )
      .map((row) => {
        const key = row.dataset.combinedDiffSectionKey
        if (!key || !row.isConnected) {
          return null
        }
        const rect = row.getBoundingClientRect()
        if (
          rect.height <= 0 ||
          rect.bottom <= containerRect.top ||
          rect.top >= containerRect.bottom
        ) {
          return null
        }
        return { key, rect }
      })
      .filter((row): row is { key: string; rect: DOMRect } => row !== null)
      .sort((a, b) => a.rect.top - b.rect.top)

    const firstVisible = visibleRows[0]
    if (!firstVisible) {
      return false
    }

    const anchor: NonNullable<VirtualizedScrollAnchor> = {
      fallbackKeys: visibleRows.slice(1).map((row) => row.key),
      key: firstVisible.key,
      offset: Math.min(
        firstVisible.rect.height,
        Math.max(0, containerRect.top - firstVisible.rect.top)
      ),
      scrollTop: container.scrollTop
    }
    scrollAnchorRef.current = anchor
    latestDomScrollAnchorRef.current = anchor
    return true
  }, [])
  const writeCombinedDiffScrollAnchor = useCallback((): void => {
    const anchor = scrollAnchorRef.current
    if (anchor) {
      setWithLRU(combinedDiffScrollAnchorCache, viewStateKey, anchor)
    } else {
      combinedDiffScrollAnchorCache.delete(viewStateKey)
    }
  }, [viewStateKey])
  const persistCombinedDiffScrollAnchor = useCallback(
    (refreshDomAnchor = true): void => {
      if (refreshDomAnchor) {
        recordCombinedDiffDomScrollAnchor()
      }
      writeCombinedDiffScrollAnchor()
    },
    [recordCombinedDiffDomScrollAnchor, writeCombinedDiffScrollAnchor]
  )

  // Why: restore only on structural changes — restoring on measurement churn overwrote scrollTop during active wheel input.
  const combinedDiffRestoreSignal = useMemo(
    () =>
      `${generation}|${sideBySide ? 'sbs' : 'inline'}|${clampRestoreCount}|${sections
        .map((section) => `${section.key}:${section.collapsed ? 'c' : 'e'}`)
        .join(',')}`,
    [clampRestoreCount, generation, sections, sideBySide]
  )

  useVirtualizedScrollAnchor({
    anchorRef: scrollAnchorRef,
    getItemElementKey: getCombinedDiffSectionElementKey,
    getRowKey: getCombinedDiffSectionKey,
    hasDirectScrollInput,
    itemElementSelector: '[data-combined-diff-section-row]',
    programmaticScrollMarks,
    recordAnchorOnCleanup: false,
    recordAnchorOnScroll: false,
    restoreSignal: combinedDiffRestoreSignal,
    rows: sections,
    scrollElementRef: scrollContainerRef,
    shouldSkipRestore: hasDirectScrollInput,
    scrollOffsetRef,
    totalSize: combinedDiffTotalSize,
    virtualizer
  })

  useLayoutEffect(() => {
    // Why: inline vs side-by-side changes Monaco row heights; re-measure on the mode flip, not on every section load.
    virtualizer.measure()
  }, [sideBySide, virtualizer])

  const toggleSection = useCallback((index: number) => {
    const shouldLoadAfterExpand = sectionsRef.current[index]?.collapsed ?? false
    setSections((prev) => prev.map((s, i) => (i === index ? { ...s, collapsed: !s.collapsed } : s)))
    if (shouldLoadAfterExpand) {
      loadSchedulerRef.current.request(index)
    }
  }, [])
  const sectionIndexByKey = React.useMemo(
    () => createCombinedDiffSectionIndexMap(sections),
    [sections]
  )
  const sectionIndexByKeyRef = useRef(sectionIndexByKey)
  sectionIndexByKeyRef.current = sectionIndexByKey
  const requestCombinedDiffSectionReload = useCallback((index: number): void => {
    const section = sectionsRef.current[index]
    if (!section || section.dirty) {
      return
    }
    retrySectionRef.current(index)
  }, [])
  const ensureCombinedDiffSectionLoaded = useCallback((index: number): void => {
    const section = sectionsRef.current[index]
    if (!shouldRequestCombinedDiffSectionLoad(section, loadingIndicesRef.current.has(index))) {
      return
    }
    loadedIndicesRef.current.delete(index)
    loadSchedulerRef.current.request(index)
  }, [])
  const [activeTreeSectionState, setActiveTreeSectionState] = useState<{
    entrySignature: string
    key: string | null
  }>(() => ({ entrySignature, key: null }))
  const activeTreeSectionKey =
    activeTreeSectionState.entrySignature === entrySignature ? activeTreeSectionState.key : null
  if (activeTreeSectionState.entrySignature !== entrySignature) {
    // Why: the tree highlight belongs to one entry set; reset now so it can't flash on another before an Effect would.
    setActiveTreeSectionState({ entrySignature, key: null })
  }
  const viewedSectionKeys = React.useMemo(
    () => new Set(sections.filter((section) => !section.loading).map((section) => section.key)),
    [sections]
  )
  const handleTreeNavigate = useCallback(
    (entry: GitStatusEntry | GitBranchChangeEntry) => {
      markDirectScrollInput()
      const navigatedIndex = handleCombinedDiffFileTreeNavigation({
        mode: treeMode,
        entry,
        sections: sectionsRef.current,
        sectionIndexByKey,
        toggleSection,
        loadSection: ensureCombinedDiffSectionLoaded,
        scrollToIndex: (index) => {
          scrollAnchorRef.current = null
          latestDomScrollAnchorRef.current = null
          virtualizer.scrollToIndex(index, { align: 'start' })
          // Why: this jump is programmatic (no scroll event records an anchor); snapshot the destination once layout settles.
          window.requestAnimationFrame(() => {
            scrollContainerRef.current?.dispatchEvent(
              new Event(VIRTUALIZED_SCROLL_ANCHOR_RECORD_EVENT)
            )
          })
        }
      })
      if (navigatedIndex !== null) {
        setActiveTreeSectionState({
          entrySignature,
          key: sectionsRef.current[navigatedIndex]?.key ?? null
        })
      }
    },
    [
      ensureCombinedDiffSectionLoaded,
      entrySignature,
      markDirectScrollInput,
      sectionIndexByKey,
      toggleSection,
      treeMode,
      virtualizer
    ]
  )

  const combinedGitStatusSignature = React.useMemo(() => {
    if (!shouldAutoReloadFromGitStatus) {
      return ''
    }
    return buildCombinedGitStatusSignature(sections, gitStatusEntries)
  }, [gitStatusEntries, sections, shouldAutoReloadFromGitStatus])
  const prevCombinedGitStatusSignatureRef = useRef<string | null>(null)

  useEffect(() => {
    if (!shouldAutoReloadFromGitStatus) {
      prevCombinedGitStatusSignatureRef.current = null
      return
    }
    if (prevCombinedGitStatusSignatureRef.current === null) {
      prevCombinedGitStatusSignatureRef.current = combinedGitStatusSignature
      return
    }
    if (prevCombinedGitStatusSignatureRef.current === combinedGitStatusSignature) {
      return
    }
    prevCombinedGitStatusSignatureRef.current = combinedGitStatusSignature
    for (const index of loadedIndicesRef.current) {
      requestCombinedDiffSectionReload(index)
    }
  }, [combinedGitStatusSignature, requestCombinedDiffSectionReload, shouldAutoReloadFromGitStatus])

  useEffect(() => {
    if (treeMode !== 'all' && treeMode !== 'uncommitted') {
      return
    }
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<EditorPathMutationTarget>).detail
      if (!detail || detail.worktreeId !== file.worktreeId) {
        return
      }
      const hasRuntimeOwnerFilter = Object.prototype.hasOwnProperty.call(
        detail,
        'runtimeEnvironmentId'
      )
      const targetRuntimeOwner = detail.runtimeEnvironmentId?.trim() || null
      const fileRuntimeOwner = file.runtimeEnvironmentId?.trim() || null
      if (hasRuntimeOwnerFilter && targetRuntimeOwner !== fileRuntimeOwner) {
        return
      }
      for (const area of ['unstaged', 'staged', 'untracked'] as const) {
        const key = getCombinedDiffFileTreeSectionKey('uncommitted', {
          path: detail.relativePath,
          status: 'modified',
          area
        })
        const index = sectionIndexByKeyRef.current.get(key)
        if (index !== undefined) {
          requestCombinedDiffSectionReload(index)
        }
      }
    }
    window.addEventListener(ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT, handler as EventListener)
    return () =>
      window.removeEventListener(ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT, handler as EventListener)
  }, [file.runtimeEnvironmentId, file.worktreeId, requestCombinedDiffSectionReload, treeMode])

  const setAllSectionsCollapsed = useCallback((collapsed: boolean) => {
    combinedDiffPreferences.collapsed = collapsed
    setSections((prev) => prev.map((section) => ({ ...section, collapsed })))
    if (!collapsed) {
      const initialIndices = getInitialCombinedDiffSectionLoadIndices({
        sectionCount: sectionsRef.current.length,
        loadedIndices: loadedIndicesRef.current
      })
      for (const index of initialIndices) {
        loadSchedulerRef.current.request(index)
      }
    }
  }, [])

  const toggleSideBySide = useCallback(() => {
    setSideBySide((prev) => {
      const next = !prev
      combinedDiffPreferences.sideBySide = next
      return next
    })
  }, [])

  const toggleDiffWordWrap = useCallback(() => {
    void updateSettings({ diffWordWrap: settings?.diffWordWrap !== true })
  }, [settings?.diffWordWrap, updateSettings])

  const openSection = useCallback(
    (index: number) => {
      const section = sectionsRef.current[index]
      if (!section) {
        return
      }

      const language = detectLanguage(section.path)
      const entry: GitBranchChangeEntry = {
        path: section.path,
        status: section.status as GitBranchChangeEntry['status'],
        oldPath: section.oldPath,
        added: section.added,
        removed: section.removed
      }

      const isBranchEntry = section.area === undefined

      if ((isBranchMode || (isAllMode && isBranchEntry)) && branchCompare) {
        openBranchDiff(file.worktreeId, file.filePath, entry, branchCompare, language)
        return
      }

      if (isCommitMode && commitCompare) {
        openCommitDiff(file.worktreeId, file.filePath, entry, commitCompare, language)
        return
      }

      openFile({
        filePath: joinPath(file.filePath, section.path),
        relativePath: section.path,
        worktreeId: file.worktreeId,
        runtimeEnvironmentId: file.runtimeEnvironmentId,
        language,
        mode: 'edit'
      })
    },
    [
      branchCompare,
      commitCompare,
      file.filePath,
      file.runtimeEnvironmentId,
      file.worktreeId,
      isAllMode,
      isBranchMode,
      isCommitMode,
      openBranchDiff,
      openCommitDiff,
      openFile
    ]
  )

  const handleSectionSave = useCallback(
    async (index: number) => {
      const section = sections[index]
      if (!section) {
        return
      }
      const modifiedEditor = modifiedEditorsRef.current.get(index)
      if (!modifiedEditor && !section.dirty) {
        return
      }

      const content = modifiedEditor?.getValue() ?? section.modifiedContent
      const absolutePath = joinPath(file.filePath, section.path)
      try {
        const state = useAppStore.getState()
        const worktree = file.worktreeId
          ? findWorktreeById(state.worktreesByRepo, file.worktreeId)
          : null
        await writeRuntimeFile(
          getEditorFileOperationContext(
            state,
            {
              worktreeId: file.worktreeId,
              runtimeEnvironmentId: file.runtimeEnvironmentId,
              operationProvenance: file.operationProvenance
            },
            worktree?.path ?? null
          ),
          absolutePath,
          content
        )
        setSectionHeights((prev) => removeDiffSectionMeasuredHeight(prev, index))
        setSections((prev) =>
          prev.map((s, i) => {
            if (i !== index) {
              return s
            }

            if (s.diffResult?.kind !== 'text') {
              return {
                ...s,
                modifiedContent: content,
                dirty: false,
                largeDiffRenderLimit: s.largeDiffRenderLimit
              }
            }

            const nextDiffResult = { ...s.diffResult, modifiedContent: content }
            const nextLargeDiffRenderLimit = getLargeDiffRenderLimit({
              originalContent: s.originalContent,
              modifiedContent: content
            })
            const storedContent = getStoredTextDiffContent(nextDiffResult, nextLargeDiffRenderLimit)

            return {
              ...s,
              modifiedContent: storedContent.modifiedContent,
              originalContent: storedContent.originalContent,
              dirty: false,
              diffResult: getStoredTextDiffResult(nextDiffResult, nextLargeDiffRenderLimit),
              largeDiffRenderLimit: nextLargeDiffRenderLimit
            }
          })
        )
      } catch (err) {
        console.error('Save failed:', err)
      }
    },
    [file.filePath, file.operationProvenance, file.runtimeEnvironmentId, file.worktreeId, sections]
  )

  const handleSectionSaveRef = useRef(handleSectionSave)
  handleSectionSaveRef.current = handleSectionSave

  useEffect(() => {
    if (sections.length === 0 && entries.length > 0) {
      return
    }
    const preservedScrollTop =
      combinedDiffScrollTopCache.get(viewStateKey) ?? scrollContainerRef.current?.scrollTop ?? 0
    setWithLRU(combinedDiffViewStateCache, viewStateKey, {
      entrySignature,
      gitStatusSignature: combinedGitStatusSignature,
      sections,
      sectionHeights,
      loadedIndices: Array.from(loadedIndicesRef.current).filter(
        (index) => !sections[index]?.loading
      ),
      scrollTop: preservedScrollTop,
      sideBySide
    })
  }, [
    combinedGitStatusSignature,
    entries.length,
    entrySignature,
    sectionHeights,
    sections,
    sideBySide,
    viewStateKey
  ])

  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    if (!container) {
      return
    }

    const cached = combinedDiffViewStateCache.get(viewStateKey)
    if (cached && cached.entrySignature === entrySignature) {
      scrollOffsetRef.current = combinedDiffScrollTopCache.get(viewStateKey) ?? cached.scrollTop
    }

    let anchorIdleTimerId: number | null = null
    let anchorFrameId: number | null = null
    const cancelScheduledAnchorPersist = (): void => {
      if (anchorIdleTimerId !== null) {
        window.clearTimeout(anchorIdleTimerId)
        anchorIdleTimerId = null
      }
      if (anchorFrameId !== null) {
        window.cancelAnimationFrame(anchorFrameId)
        anchorFrameId = null
      }
    }
    const scheduleSettledAnchorPersist = (): void => {
      cancelScheduledAnchorPersist()
      anchorIdleTimerId = window.setTimeout(() => {
        anchorIdleTimerId = null
        if (hasDirectScrollInput()) {
          // Why: the idle timer can fire mid-wheel while TanStack still shows a transitional virtual window.
          scheduleSettledAnchorPersist()
          return
        }
        anchorFrameId = window.requestAnimationFrame(() => {
          anchorFrameId = null
          persistCombinedDiffScrollAnchor()
        })
      }, 150)
    }

    const updateCachedScrollPosition = ({
      recordDomAnchor,
      scheduleSettled,
      scrollTop,
      writeAnchor
    }: {
      recordDomAnchor: boolean
      scheduleSettled: boolean
      scrollTop: number
      writeAnchor: boolean
    }): void => {
      const existing = combinedDiffViewStateCache.get(viewStateKey)
      scrollOffsetRef.current = scrollTop
      setWithLRU(combinedDiffScrollTopCache, viewStateKey, scrollTop)
      if (writeAnchor) {
        if (recordDomAnchor) {
          persistCombinedDiffScrollAnchor()
        } else {
          writeCombinedDiffScrollAnchor()
        }
      }
      if (scheduleSettled) {
        scheduleSettledAnchorPersist()
      }
      updateCombinedDiffScrollbar()
      if (!existing || existing.entrySignature !== entrySignature) {
        return
      }
      setWithLRU(combinedDiffViewStateCache, viewStateKey, {
        ...existing,
        scrollTop
      })
    }
    lastScrollHeightRef.current = container.scrollHeight
    const handleScroll = (event: Event): void => {
      const scrollTop = container.scrollTop
      const scrollHeight = container.scrollHeight
      const maxScrollTop = Math.max(0, scrollHeight - container.clientHeight)
      const shrank = scrollHeight < lastScrollHeightRef.current - 1
      lastScrollHeightRef.current = scrollHeight
      if (programmaticScrollMarks.consume(event, scrollTop, maxScrollTop)) {
        updateCombinedDiffScrollbar()
        return
      }
      if (shrank && scrollTop >= maxScrollTop - 1 && scrollOffsetRef.current > maxScrollTop + 1) {
        // Why: pinned at a just-shrunk max from an unreachable offset is a browser clamp, not user input — re-pin, don't record it.
        setClampRestoreCount((count) => count + 1)
        updateCombinedDiffScrollbar()
        return
      }
      // Why: any unmarked scroll is the user's — even events delayed past their window by main-thread jank.
      recordCombinedDiffVirtualScrollAnchor(scrollTop)
      updateCachedScrollPosition({
        recordDomAnchor: false,
        scheduleSettled: true,
        scrollTop,
        writeAnchor: true
      })
    }

    // Why: detach in the layout phase so the outgoing tab snapshots its real scroll before teardown fires a reset-to-top scroll.
    updateCombinedDiffScrollbar()
    const resizeObserver = new ResizeObserver(updateCombinedDiffScrollbar)
    resizeObserver.observe(container)
    container.addEventListener('scroll', handleScroll)
    return () => {
      cancelScheduledAnchorPersist()
      if (latestDomScrollAnchorRef.current) {
        scrollAnchorRef.current = latestDomScrollAnchorRef.current
      }
      updateCachedScrollPosition({
        recordDomAnchor: false,
        scheduleSettled: false,
        scrollTop: scrollOffsetRef.current,
        writeAnchor: true
      })
      resizeObserver.disconnect()
      container.removeEventListener('scroll', handleScroll)
    }
  }, [
    entrySignature,
    hasDirectScrollInput,
    persistCombinedDiffScrollAnchor,
    programmaticScrollMarks,
    recordCombinedDiffVirtualScrollAnchor,
    sections.length,
    updateCombinedDiffScrollbar,
    writeCombinedDiffScrollAnchor,
    viewStateKey
  ])

  useLayoutEffect(() => {
    updateCombinedDiffScrollbar()
    const container = scrollContainerRef.current
    if (!container || container.scrollTop <= 0) {
      return
    }

    let frameId: number | null = null
    const timerId = window.setTimeout(() => {
      if (!container.isConnected || hasDirectScrollInput()) {
        return
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        persistCombinedDiffScrollAnchor()
      })
    }, 300)

    return () => {
      window.clearTimeout(timerId)
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [
    hasDirectScrollInput,
    persistCombinedDiffScrollAnchor,
    sectionHeights,
    sections,
    updateCombinedDiffScrollbar
  ])

  const openAlternateDiff = useCallback(() => {
    if (!file.combinedAlternate) {
      return
    }

    if (file.combinedAlternate.source === 'combined-all') {
      openAllDiffs(file.worktreeId, file.filePath)
      return
    }

    if (branchSummary && branchSummary.status === 'ready') {
      openBranchAllDiffs(file.worktreeId, file.filePath, branchSummary, {
        source: 'combined-all'
      })
    }
  }, [branchSummary, file, openAllDiffs, openBranchAllDiffs])

  const handleCombinedDiffScrollbarPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const container = scrollContainerRef.current
      if (!container) {
        return
      }

      event.preventDefault()
      markDirectScrollInput()
      const track = event.currentTarget
      const thumb =
        event.target instanceof HTMLElement
          ? event.target.closest('[data-combined-diff-scrollbar-thumb]')
          : null

      const getLiveThumbHeight = (): number => {
        const trackHeight = Math.max(1, track.getBoundingClientRect().height)
        return Math.min(
          trackHeight,
          Math.max(
            COMBINED_DIFF_SCROLLBAR_THUMB_MIN_HEIGHT,
            (container.clientHeight / container.scrollHeight) * trackHeight
          )
        )
      }

      const getScrollTopForPointer = (clientY: number, grabOffset: number): number => {
        const trackRect = track.getBoundingClientRect()
        const trackHeight = Math.max(1, trackRect.height)
        const thumbHeight = getLiveThumbHeight()
        const maxThumbTop = Math.max(1, trackHeight - thumbHeight)
        const maxScrollTop = Math.max(1, container.scrollHeight - container.clientHeight)
        const thumbTop = Math.max(0, Math.min(maxThumbTop, clientY - trackRect.top - grabOffset))
        return (thumbTop / maxThumbTop) * maxScrollTop
      }

      const grabOffset = thumb
        ? event.clientY - thumb.getBoundingClientRect().top
        : getLiveThumbHeight() / 2

      if (!thumb) {
        container.scrollTop = getScrollTopForPointer(event.clientY, grabOffset)
        updateCombinedDiffScrollbar()
      }

      const handlePointerMove = (moveEvent: PointerEvent): void => {
        moveEvent.preventDefault()
        markDirectScrollInput()
        container.scrollTop = getScrollTopForPointer(moveEvent.clientY, grabOffset)
        updateCombinedDiffScrollbar()
      }
      cleanupActiveScrollbarDrag()
      let cleanupPointerDrag: CombinedDiffScrollbarDragCleanup
      cleanupPointerDrag = beginCombinedDiffScrollbarDrag({
        track,
        pointerId: event.pointerId,
        onPointerMove: handlePointerMove,
        onEnd: () => {
          if (activeScrollbarDragCleanupRef.current === cleanupPointerDrag) {
            activeScrollbarDragCleanupRef.current = null
          }
        }
      })
      activeScrollbarDragCleanupRef.current = cleanupPointerDrag
    },
    [cleanupActiveScrollbarDrag, markDirectScrollInput, updateCombinedDiffScrollbar]
  )

  const handleCopyNotes = useCallback(async (): Promise<void> => {
    if (diffCommentCount === 0) {
      return
    }
    try {
      await window.api.ui.writeClipboardText(diffCommentsPrompt)
      if (!notesCopyMountedRef.current) {
        return
      }
      clearNotesCopiedResetTimer()
      setNotesCopied(true)
      notesCopiedResetTimerRef.current = window.setTimeout(() => {
        setNotesCopied(false)
        notesCopiedResetTimerRef.current = null
      }, 1500)
    } catch {
      // Why: clipboard writes can fail while the app is unfocused; keep the popover non-blocking.
    }
  }, [clearNotesCopiedResetTimer, diffCommentCount, diffCommentsPrompt])

  const handleConfirmClearNotes = useCallback(async (): Promise<void> => {
    if (diffCommentCount === 0 || isClearingNotes) {
      return
    }
    setIsClearingNotes(true)
    try {
      const ok = await clearDiffComments(file.worktreeId)
      if (!mountedRef.current) {
        return
      }
      if (ok) {
        setClearNotesDialogOpen(false)
      } else {
        toast.error(
          translate(
            'auto.components.editor.CombinedDiffViewer.45cf23b418',
            'Failed to clear notes.'
          )
        )
      }
    } finally {
      if (mountedRef.current) {
        setIsClearingNotes(false)
      }
    }
  }, [clearDiffComments, diffCommentCount, file.worktreeId, isClearingNotes])

  const commitBody = getCombinedDiffCommitMessageBody(
    commitCompare?.message,
    commitCompare?.subject
  )
  const commitHeader =
    isCommitMode && commitCompare ? (
      <div className="border-b border-border bg-background px-4 py-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            {commitCompare.subject && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className="truncate text-sm font-semibold text-foreground"
                    title={commitCompare.subject}
                  >
                    {commitCompare.subject}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6} className="max-w-96">
                  {commitCompare.subject}
                </TooltipContent>
              </Tooltip>
            )}
            {commitBody && (
              <div className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground scrollbar-sleek">
                {commitBody}
              </div>
            )}
          </div>
          <span className="shrink-0 font-mono text-[11px] leading-5 text-muted-foreground">
            {commitCompare.compareRef}
          </span>
        </div>
      </div>
    ) : null

  if (sections.length === 0 && (file.skippedConflicts?.length ?? 0) > 0) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {commitHeader}
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div className="max-w-md space-y-3">
            <div className="text-sm font-medium text-foreground">
              {translate(
                'auto.components.editor.CombinedDiffViewer.820ec01f24',
                'Conflicted files are reviewed separately'
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {translate(
                'auto.components.editor.CombinedDiffViewer.eb5f40e49c',
                'This diff view excludes unresolved conflicts because the normal two-way diff pipeline is not conflict-safe.'
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {file.skippedConflicts!.map((entry) => entry.path).join(', ')}
            </div>
            <div className="flex justify-center">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  openConflictReview(
                    file.worktreeId,
                    file.filePath,
                    file.skippedConflicts!.map((entry) => ({
                      path: entry.path,
                      conflictKind: entry.conflictKind
                    })),
                    'combined-diff-exclusion'
                  )
                }
              >
                {translate(
                  'auto.components.editor.CombinedDiffViewer.39f8007549',
                  'Review conflicts'
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (sections.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {commitHeader}
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {translate(
            'auto.components.editor.CombinedDiffViewer.fd8892b120',
            'No changes to display'
          )}
        </div>
      </div>
    )
  }

  const skippedConflictNotice =
    (file.skippedConflicts?.length ?? 0) > 0 ? (
      <div className="mx-4 mt-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs">
        <div className="font-medium text-foreground">
          {translate(
            'auto.components.editor.CombinedDiffViewer.820ec01f24',
            'Conflicted files are reviewed separately'
          )}
        </div>
        <div className="mt-1 text-muted-foreground">
          {file.skippedConflicts!.length}{' '}
          {translate('auto.components.editor.CombinedDiffViewer.689b99f8ad', 'unresolved conflict')}
          {file.skippedConflicts!.length === 1 ? '' : 's'}{' '}
          {translate(
            'auto.components.editor.CombinedDiffViewer.39e73e7181',
            'were excluded from this diff view.'
          )}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() =>
              openConflictReview(
                file.worktreeId,
                file.filePath,
                file.skippedConflicts!.map((entry) => ({
                  path: entry.path,
                  conflictKind: entry.conflictKind
                })),
                'combined-diff-exclusion'
              )
            }
          >
            {translate('auto.components.editor.CombinedDiffViewer.39f8007549', 'Review conflicts')}
          </Button>
        </div>
      </div>
    ) : null
  const allSectionsCollapsed = sections.every((section) => section.collapsed)

  const viewContext = {
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
  }

  return <CombinedDiffViewerView context={viewContext} />
function DiffNotesPreviewPopover({
  comments,
  totalCount,
  copied,
  onCopy,
  onClear
}: {
  comments: DiffComment[]
  totalCount: number
  copied: boolean
  onCopy: () => void
  onClear: () => void
}): React.JSX.Element {
  const remainingCount = Math.max(0, totalCount - comments.length)

  return (
    <div className="text-xs">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
          <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
          <span>
            {translate('auto.components.editor.CombinedDiffViewer.bb84b4c374', 'AI notes')}
          </span>
          <span className="text-[11px] font-normal tabular-nums text-muted-foreground">
            {totalCount}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="h-6 text-muted-foreground hover:text-foreground"
            onClick={onCopy}
            disabled={totalCount === 0}
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {translate('auto.components.editor.CombinedDiffViewer.88b70d0ef5', 'Copy')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="h-6 text-muted-foreground hover:text-destructive"
            onClick={onClear}
            disabled={totalCount === 0}
          >
            <Trash2 className="size-3" />
            {translate('auto.components.editor.CombinedDiffViewer.84898c548d', 'Clear')}
          </Button>
        </div>
      </div>
      <div className="max-h-72 overflow-y-auto p-2 scrollbar-sleek">
        {comments.map((comment) => (
          <div key={comment.id} className="rounded-md px-2 py-1.5 hover:bg-accent/50">
            <div className="flex items-center gap-1.5 text-[11px] leading-none text-muted-foreground">
              <span className="min-w-0 flex-1 truncate font-mono">{comment.filePath}</span>
              {comment.sentAt ? (
                <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] leading-none">
                  {translate('auto.components.editor.CombinedDiffViewer.1da745c551', 'Sent')}
                </span>
              ) : null}
              <span className="shrink-0 tabular-nums">
                {getDiffCommentLineLabel(comment, true)}
              </span>
            </div>
            <div className="mt-1 max-h-10 overflow-hidden whitespace-pre-wrap break-words text-[12px] leading-snug text-foreground">
              {comment.body}
            </div>
          </div>
        ))}
        {remainingCount > 0 && (
          <div className="px-2 py-1 text-[11px] text-muted-foreground">
            {remainingCount}{' '}
            {translate('auto.components.editor.CombinedDiffViewer.e3b9a6ce02', 'more')}
            {remainingCount === 1
              ? translate('auto.components.editor.CombinedDiffViewer.8ab3248fd8', 'note')
              : translate('auto.components.editor.CombinedDiffViewer.0fb870a0fe', 'notes')}{' '}
            {translate('auto.components.editor.CombinedDiffViewer.35cc27aeb2', 'in Source Control')}
          </div>
        )}
      </div>
    </div>
  )
}
