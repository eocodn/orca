import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { editor as monacoEditor } from 'monaco-editor'
import { useAppStore } from '@/store'
import { selectWorktreeDiffCommentsOrEmpty } from '@/store/worktree-diff-comments-selector'
import { settingsForRuntimeOwner } from '@/runtime/runtime-rpc-client'
import { writeRuntimeFile } from '@/runtime/runtime-file-client'
import { getEditorFileOperationContext } from '@/lib/editor-file-operation-owner'
import { detectLanguage } from '@/lib/language-detect'
import { joinPath } from '@/lib/path'
import { formatDiffComments } from '@/lib/diff-comments-format'
import { setWithLRU } from '@/lib/scroll-cache'
import {
  getRuntimeGitBranchDiff,
  getRuntimeGitCommitDiff,
  getRuntimeGitDiff
} from '@/runtime/runtime-git-client'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import type { OpenFile } from '@/store/slices/editor'
import type { GitBranchChangeEntry, GitDiffResult } from '../../../../shared/types'
import { getCombinedDiffSectionConnectionId } from './combined-diff-section-connection'
import {
  getCombinedBranchEntries,
  getCombinedUncommittedEntries,
  resolveCombinedUncommittedSnapshotEntries,
  shouldAutoReloadCombinedDiffFromGitStatus
} from './combined-diff-entries'
import { getCombinedDiffFileTreeSectionKey } from './combined-diff-file-tree-model'
import { getInitialCombinedDiffSectionLoadIndices } from './combined-diff-initial-section-load'
import { removeDiffSectionMeasuredHeight } from './diff-section-height-cache'
import { getLargeDiffRenderLimit } from './large-diff-render-limit'
import { getStoredTextDiffContent, getStoredTextDiffResult } from './large-diff-section-content'
import type { DiffSection } from './diff-section-types'
import { createCombinedDiffLoadScheduler } from './combined-diff-load-scheduler'
import { combinedDiffSectionsMatchEntryMetadata } from './combined-diff-section-cache-match'
import {
  EMPTY_GIT_BRANCH_ENTRIES,
  EMPTY_GIT_STATUS_ENTRIES,
  buildCombinedGitStatusSignature,
  combinedDiffPreferences,
  combinedDiffScrollTopCache,
  combinedDiffViewStateCache,
  getDiffSectionLoadErrorMessage,
  getInitialCombinedDiffFileTreeCollapsed,
  getInitialCombinedDiffSideBySide,
  getRetainedResolvedSnapshotEntries,
  withDiffSectionLoadTimeout
} from './combined-diff-view-state'

type CombinedDiffModelOptions = { file: OpenFile; viewStateKey: string }

export function useCombinedDiffViewerModel({
  file,
  viewStateKey
}: CombinedDiffModelOptions) {
  const settings = useAppStore((s) => s.settings)
  const gitStatusEntries = useAppStore(
    (s) => s.gitStatusByWorktree[file.worktreeId] ?? EMPTY_GIT_STATUS_ENTRIES
  )
  const liveBranchEntries = useAppStore(
    (s) => s.gitBranchChangesByWorktree[file.worktreeId] ?? EMPTY_GIT_BRANCH_ENTRIES
  )
  const branchSummary = useAppStore((s) => s.gitBranchCompareSummaryByWorktree[file.worktreeId])
  const openFile = useAppStore((s) => s.openFile)
  const openBranchDiff = useAppStore((s) => s.openBranchDiff)
  const openCommitDiff = useAppStore((s) => s.openCommitDiff)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const diffCommentsForWorktree = useAppStore((s) =>
    selectWorktreeDiffCommentsOrEmpty(s, file.worktreeId)
  )
  const activeGroupId = useAppStore((s) => s.activeGroupIdByWorktree[file.worktreeId])
  const diffCommentsPrompt = useMemo(
    () => formatDiffComments(diffCommentsForWorktree),
    [diffCommentsForWorktree]
  )
  const previewDiffComments = useMemo(
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
  const [fileTreeCollapsed, setFileTreeCollapsedState] = useState(() =>
    getInitialCombinedDiffFileTreeCollapsed(settings?.combinedDiffFileTreeVisibleByDefault)
  )
  const [generation, setGeneration] = useState(0)
  const sectionsRef = useRef<DiffSection[]>([])
  const generationRef = useRef(0)
  const loadedIndicesRef = useRef<Set<number>>(new Set())
  const loadingIndicesRef = useRef<Set<number>>(new Set())
  const modifiedEditorsRef = useRef<Map<number, monacoEditor.IStandaloneCodeEditor>>(new Map())
  const loadSectionRef = useRef<(index: number) => Promise<void>>(async () => {})
  const retrySectionRef = useRef<(index: number) => void>(() => {})
  const loadSchedulerRef = useRef(
    createCombinedDiffLoadScheduler({ loadSection: (index) => loadSectionRef.current(index) })
  )
  sectionsRef.current = sections

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
  const snapshotEntries = useMemo(
    () => file.uncommittedEntriesSnapshot?.filter((entry) => entry.conflictStatus !== 'unresolved'),
    [file.uncommittedEntriesSnapshot]
  )
  const uncommittedEntries = useMemo(() => {
    if (!snapshotEntries) {
      return getCombinedUncommittedEntries(gitStatusEntries, file.combinedAreaFilter)
    }
    return resolveCombinedUncommittedSnapshotEntries(
      snapshotEntries,
      gitStatusEntries,
      getRetainedResolvedSnapshotEntries(sectionsRef.current)
    )
  }, [file.combinedAreaFilter, gitStatusEntries, snapshotEntries])
  const branchEntries = useMemo<GitBranchChangeEntry[]>(
    () => getCombinedBranchEntries(file.branchEntriesSnapshot, liveBranchEntries),
    [file.branchEntriesSnapshot, liveBranchEntries]
  )
  const renderableBranchEntries = useMemo(
    () => (branchCompare ? branchEntries : []),
    [branchCompare, branchEntries]
  )
  const commitEntries = useMemo<GitBranchChangeEntry[]>(
    () => file.commitEntriesSnapshot ?? [],
    [file.commitEntriesSnapshot]
  )
  const allEntries = useMemo(
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
  const entrySignature = useMemo(
    () =>
      JSON.stringify({
        mode: file.diffSource,
        areaFilter: file.combinedAreaFilter ?? null,
        compareVersion: file.branchCompare?.compareVersion ?? null,
        commitVersion: file.commitCompare?.compareVersion ?? null,
        compare:
          isBranchMode && branchCompare
            ? { baseOid: branchCompare.baseOid, headOid: branchCompare.headOid, mergeBase: branchCompare.mergeBase }
            : null,
        commit:
          isCommitMode && commitCompare
            ? { commitOid: commitCompare.commitOid, parentOid: commitCompare.parentOid ?? null }
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

  useLayoutEffect(() => {
    const cached = combinedDiffViewStateCache.get(viewStateKey)
    const canRestoreSnapshotSectionsByKey =
      hasUncommittedEntriesSnapshot &&
      cached !== undefined &&
      combinedDiffSectionsMatchEntryMetadata({ entries, sections: cached.sections, treeMode })
    const canRestoreCachedSections =
      cached &&
      (cached.entrySignature === entrySignature || canRestoreSnapshotSectionsByKey) &&
      (!shouldAutoReloadFromGitStatus ||
        (cached.gitStatusSignature ?? '') === buildCombinedGitStatusSignature(cached.sections, gitStatusEntries)) &&
      (cached.sections.length > 0 || entries.length === 0)
    if (canRestoreCachedSections && cached) {
      const restoredSections =
        combinedDiffPreferences.collapsed === null
          ? cached.sections
          : cached.sections.map((section) => ({
              ...section,
              collapsed: combinedDiffPreferences.collapsed as boolean
            }))
      setSections(restoredSections)
      setSectionHeights(cached.sectionHeights)
      setSideBySide(combinedDiffPreferences.sideBySide ?? cached.sideBySide)
      loadedIndicesRef.current = new Set(
        cached.loadedIndices.filter((index) => !restoredSections[index]?.loading)
      )
      loadingIndicesRef.current.clear()
      return
    }
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
    setGeneration((previous) => previous + 1)
  }, [entries, entrySignature, gitStatusEntries, hasUncommittedEntriesSnapshot, shouldAutoReloadFromGitStatus, treeMode, viewStateKey])

  const loadSectionNow = useCallback(
    async (index: number) => {
      if (loadedIndicesRef.current.has(index) || loadingIndicesRef.current.has(index)) return
      loadingIndicesRef.current.add(index)
      const generationAtStart = generationRef.current
      const currentEntries = isAllMode
        ? allEntries
        : isBranchMode
          ? renderableBranchEntries
          : isCommitMode
            ? commitEntries
            : uncommittedEntries
      const entry = currentEntries[index]
      if (!entry) {
        loadingIndicesRef.current.delete(index)
        return
      }
      let result: GitDiffResult
      let error: string | undefined
      try {
        const connectionId = getCombinedDiffSectionConnectionId(file.worktreeId, file.filePath, entry.path)
        const state = useAppStore.getState()
        const fileSettings = settingsForRuntimeOwner(state.settings, file.runtimeEnvironmentId)
        if ((isBranchMode || (isAllMode && !('area' in entry))) && branchCompare) {
          result = await withDiffSectionLoadTimeout(getRuntimeGitBranchDiff(
            { settings: fileSettings, worktreeId: file.worktreeId, worktreePath: file.filePath, connectionId },
            { compare: { baseRef: branchCompare.baseRef, baseOid: branchCompare.baseOid!, headOid: branchCompare.headOid!, mergeBase: branchCompare.mergeBase! }, filePath: entry.path, oldPath: entry.oldPath }
          ))
        } else if (isCommitMode && commitCompare) {
          result = await withDiffSectionLoadTimeout(getRuntimeGitCommitDiff(
            { settings: fileSettings, worktreeId: file.worktreeId, worktreePath: file.filePath, connectionId },
            { commitOid: commitCompare.commitOid, parentOid: commitCompare.parentOid, filePath: entry.path, oldPath: entry.oldPath }
          ))
        } else {
          result = await withDiffSectionLoadTimeout(getRuntimeGitDiff(
            { settings: fileSettings, worktreeId: file.worktreeId, worktreePath: file.filePath, connectionId },
            { filePath: entry.path, staged: 'area' in entry && entry.area === 'staged' }
          ))
        }
      } catch (cause) {
        error = getDiffSectionLoadErrorMessage(cause)
        result = { kind: 'text', originalContent: '', modifiedContent: '', originalIsBinary: false, modifiedIsBinary: false } as GitDiffResult
      }
      const largeDiffRenderLimit = !error && result.kind === 'text'
        ? result.largeDiffRenderLimit ?? getLargeDiffRenderLimit({ originalContent: result.originalContent, modifiedContent: result.modifiedContent })
        : null
      loadingIndicesRef.current.delete(index)
      if (generationRef.current !== generationAtStart) return
      const storedContent = getStoredTextDiffContent(result, largeDiffRenderLimit)
      const storedResult = getStoredTextDiffResult(result, largeDiffRenderLimit)
      loadedIndicesRef.current.add(index)
      setSections((previous) => previous.map((section, sectionIndex) =>
        sectionIndex === index
          ? { ...section, diffResult: storedResult, originalContent: storedContent.originalContent, modifiedContent: storedContent.modifiedContent, loading: false, error, largeDiffRenderLimit }
          : section
      ))
    }, [allEntries, branchCompare?.baseOid, branchCompare?.headOid, branchCompare?.mergeBase, commitCompare?.commitOid, commitCompare?.parentOid, commitEntries, file.filePath, file.runtimeEnvironmentId, file.worktreeId, isAllMode, isBranchMode, isCommitMode, renderableBranchEntries, uncommittedEntries]
  )
  loadSectionRef.current = loadSectionNow
  useEffect(() => {
    const scheduler = loadSchedulerRef.current
    scheduler.reset()
    return () => scheduler.dispose()
  }, [])
  const loadSection = useCallback((index: number) => {
    if (!sectionsRef.current[index]?.collapsed) loadSchedulerRef.current.request(index)
  }, [])
  useEffect(() => {
    const currentSections = sectionsRef.current
    for (let index = 0; index < currentSections.length; index += 1) {
      if (currentSections[index]?.loading && loadedIndicesRef.current.has(index)) loadedIndicesRef.current.delete(index)
    }
    for (const index of getInitialCombinedDiffSectionLoadIndices({ sectionCount: currentSections.length, loadedIndices: loadedIndicesRef.current })) {
      if (!currentSections[index]?.collapsed) loadSection(index)
    }
  }, [entrySignature, loadSection, sections.length])
  const invalidateCombinedDiffViewStateCache = useCallback(() => {
    combinedDiffViewStateCache.delete(viewStateKey)
  }, [viewStateKey])
  const retrySection = useCallback((index: number) => {
    const collapsed = sectionsRef.current[index]?.collapsed ?? false
    loadedIndicesRef.current.delete(index)
    loadingIndicesRef.current.delete(index)
    invalidateCombinedDiffViewStateCache()
    generationRef.current += 1
    setGeneration((previous) => previous + 1)
    setSectionHeights((previous) => removeDiffSectionMeasuredHeight(previous, index))
    setSections((previous) => previous.map((section, sectionIndex) => sectionIndex === index
      ? { ...section, loading: !collapsed, error: undefined, diffResult: null, originalContent: '', modifiedContent: '', largeDiffRenderLimit: null, contentGeneration: (section.contentGeneration ?? 0) + 1 }
      : section))
    if (!collapsed) loadSchedulerRef.current.rerequest(index)
  }, [invalidateCombinedDiffViewStateCache])
  retrySectionRef.current = retrySection

  const openSection = useCallback((index: number) => {
    const section = sectionsRef.current[index]
    if (!section) return
    const language = detectLanguage(section.path)
    const entry: GitBranchChangeEntry = { path: section.path, status: section.status as GitBranchChangeEntry['status'], oldPath: section.oldPath, added: section.added, removed: section.removed }
    if ((isBranchMode || (isAllMode && section.area === undefined)) && branchCompare) {
      openBranchDiff(file.worktreeId, file.filePath, entry, branchCompare, language)
    } else if (isCommitMode && commitCompare) {
      openCommitDiff(file.worktreeId, file.filePath, entry, commitCompare, language)
    } else {
      openFile({ filePath: joinPath(file.filePath, section.path), relativePath: section.path, worktreeId: file.worktreeId, runtimeEnvironmentId: file.runtimeEnvironmentId, language, mode: 'edit' })
    }
  }, [branchCompare, commitCompare, file.filePath, file.runtimeEnvironmentId, file.worktreeId, isAllMode, isBranchMode, isCommitMode, openBranchDiff, openCommitDiff, openFile])

  const handleSectionSave = useCallback(async (index: number) => {
    const section = sections[index]
    if (!section) return
    const editor = modifiedEditorsRef.current.get(index)
    if (!editor && !section.dirty) return
    const content = editor?.getValue() ?? section.modifiedContent
    try {
      const state = useAppStore.getState()
      const worktree = file.worktreeId ? findWorktreeById(state.worktreesByRepo, file.worktreeId) : null
      await writeRuntimeFile(getEditorFileOperationContext(state, { worktreeId: file.worktreeId, runtimeEnvironmentId: file.runtimeEnvironmentId, operationProvenance: file.operationProvenance }, worktree?.path ?? null), joinPath(file.filePath, section.path), content)
      setSectionHeights((previous) => removeDiffSectionMeasuredHeight(previous, index))
      setSections((previous) => previous.map((current, sectionIndex) => {
        if (sectionIndex !== index) return current
        if (current.diffResult?.kind !== 'text') return { ...current, modifiedContent: content, dirty: false }
        const nextResult = { ...current.diffResult, modifiedContent: content }
        const nextLimit = getLargeDiffRenderLimit({ originalContent: current.originalContent, modifiedContent: content })
        const storedContent = getStoredTextDiffContent(nextResult, nextLimit)
        return { ...current, modifiedContent: storedContent.modifiedContent, originalContent: storedContent.originalContent, dirty: false, diffResult: getStoredTextDiffResult(nextResult, nextLimit), largeDiffRenderLimit: nextLimit }
      }))
    } catch (cause) {
      console.error('Save failed:', cause)
    }
  }, [file.filePath, file.operationProvenance, file.runtimeEnvironmentId, file.worktreeId, sections])
  const handleSectionSaveRef = useRef(handleSectionSave)
  handleSectionSaveRef.current = handleSectionSave
  const combinedGitStatusSignature = useMemo(
    () => shouldAutoReloadFromGitStatus ? buildCombinedGitStatusSignature(sections, gitStatusEntries) : '',
    [gitStatusEntries, sections, shouldAutoReloadFromGitStatus]
  )
  useEffect(() => {
    if (sections.length === 0 && entries.length > 0) return
    const scrollTop = combinedDiffScrollTopCache.get(viewStateKey) ?? 0
    setWithLRU(combinedDiffViewStateCache, viewStateKey, { entrySignature, gitStatusSignature: combinedGitStatusSignature, sections, sectionHeights, loadedIndices: Array.from(loadedIndicesRef.current).filter((index) => !sections[index]?.loading), scrollTop, sideBySide })
  }, [combinedGitStatusSignature, entries.length, entrySignature, sectionHeights, sections, sideBySide, viewStateKey])

  return {
    file, viewStateKey, settings, updateSettings, branchSummary, activeGroupId, diffCommentsForWorktree,
    diffCommentsPrompt, previewDiffComments, sections, setSections, sideBySide, setSideBySide,
    sectionHeights, setSectionHeights, fileTreeCollapsed, setFileTreeCollapsed, generation,
    generationRef, sectionsRef, loadedIndicesRef, loadingIndicesRef, modifiedEditorsRef,
    loadSectionRef, retrySectionRef, loadSchedulerRef, loadSectionNow, loadSection, retrySection,
    openSection, handleSectionSave, handleSectionSaveRef, invalidateCombinedDiffViewStateCache,
    combinedGitStatusSignature, entrySignature, gitStatusEntries, liveBranchEntries, entries,
    allEntries, uncommittedEntries, branchEntries, renderableBranchEntries, commitEntries,
    snapshotEntries, treeMode, isAllMode, isBranchMode, isCommitMode, branchCompare, commitCompare,
    hasUncommittedEntriesSnapshot, shouldAutoReloadFromGitStatus
  }
}

export type CombinedDiffViewerModel = ReturnType<typeof useCombinedDiffViewerModel>
