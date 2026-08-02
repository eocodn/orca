import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { elementScroll, useVirtualizer } from '@tanstack/react-virtual'
import {
  useVirtualizedScrollAnchor,
  VIRTUALIZED_SCROLL_ANCHOR_RECORD_EVENT,
  type VirtualizedScrollAnchor
} from '@/hooks/useVirtualizedScrollAnchor'
import { getVirtualizedScrollAnchorForOffset } from '@/hooks/virtualized-scroll-anchor-recording'
import { createProgrammaticScrollMarks } from '@/hooks/programmatic-scroll-marks'
import { setWithLRU } from '@/lib/scroll-cache'
import type { GitBranchChangeEntry, GitStatusEntry } from '../../../../shared/types'
import {
  ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT,
  type EditorPathMutationTarget
} from './editor-autosave'
import {
  createCombinedDiffSectionIndexMap,
  handleCombinedDiffFileTreeNavigation
} from './CombinedDiffFileTree'
import { getCombinedDiffFileTreeSectionKey } from './combined-diff-file-tree-model'
import { getDiffSectionEstimatedHeight, isIntrinsicHeightImageDiff } from './diff-section-layout'
import { getInitialCombinedDiffSectionLoadIndices } from './combined-diff-initial-section-load'
import {
  COMBINED_DIFF_OVERSCAN,
  COMBINED_DIFF_SCROLLBAR_THUMB_MIN_HEIGHT,
  buildCombinedGitStatusSignature,
  combinedDiffScrollAnchorCache,
  combinedDiffScrollTopCache,
  combinedDiffViewStateCache
} from './combined-diff-view-state'
import {
  beginCombinedDiffScrollbarDrag,
  type CombinedDiffScrollbarDragCleanup
} from './combined-diff-scrollbar-drag'
import { shouldRequestCombinedDiffSectionLoad } from './combined-diff-section-load-state'
import type { DiffSection } from './diff-section-types'
import type { CombinedDiffViewerModel } from './combined-diff-viewer-model'

export function useCombinedDiffViewerDecorator(model: CombinedDiffViewerModel) {
  const {
    file,
    viewStateKey,
    settings,
    updateSettings,
    sections,
    setSections,
    sectionHeights,
    generation,
    sectionsRef,
    loadedIndicesRef,
    loadingIndicesRef,
    loadSchedulerRef,
    retrySectionRef,
    entrySignature,
    gitStatusEntries,
    treeMode,
    shouldAutoReloadFromGitStatus,
  } = model
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [scrollThumb, setScrollThumb] = useState({
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
  const [clampRestoreCount, setClampRestoreCount] = useState(0)
  const lastScrollHeightRef = useRef(0)
  const activeScrollbarDragCleanupRef = useRef<CombinedDiffScrollbarDragCleanup | null>(null)

  useLayoutEffect(() => {
    const cached = combinedDiffViewStateCache.get(viewStateKey)
    if (!cached || cached.entrySignature !== entrySignature) return
    scrollOffsetRef.current = combinedDiffScrollTopCache.get(viewStateKey) ?? cached.scrollTop
    scrollAnchorRef.current = combinedDiffScrollAnchorCache.get(viewStateKey) ?? null
    latestDomScrollAnchorRef.current = scrollAnchorRef.current
  }, [entrySignature, viewStateKey])

  const updateCombinedDiffScrollbar = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container || container.scrollHeight <= container.clientHeight + 1) {
      setScrollThumb((previous) => previous.visible ? { visible: false, top: 0, height: COMBINED_DIFF_SCROLLBAR_THUMB_MIN_HEIGHT } : previous)
      return
    }
    const trackHeight = Math.max(1, container.clientHeight - 8)
    const maxScrollTop = Math.max(1, container.scrollHeight - container.clientHeight)
    const height = Math.min(trackHeight, Math.max(COMBINED_DIFF_SCROLLBAR_THUMB_MIN_HEIGHT, (container.clientHeight / container.scrollHeight) * trackHeight))
    setScrollThumb({ visible: true, top: ((trackHeight - height) * container.scrollTop) / maxScrollTop, height })
  }, [])
  const markDirectScrollInput = useCallback(() => {
    directScrollInputUntilRef.current = window.performance.now() + 250
  }, [])
  const hasDirectScrollInput = useCallback(
    () => window.performance.now() < directScrollInputUntilRef.current,
    []
  )
  const cleanupActiveScrollbarDrag = useCallback(() => {
    activeScrollbarDragCleanupRef.current?.()
  }, [])
  const setScrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    scrollContainerRef.current = node
    if (node === null) {
      cleanupActiveScrollbarDrag()
      return
    }
    window.requestAnimationFrame(updateCombinedDiffScrollbar)
  }, [cleanupActiveScrollbarDrag, updateCombinedDiffScrollbar])

  const virtualizer = useVirtualizer({
    count: sections.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => {
      const section = sections[index]
      if (!section) return 88
      return getDiffSectionEstimatedHeight({
        collapsed: section.collapsed,
        measuredContentHeight: sectionHeights[index],
        originalContent: section.originalContent,
        modifiedContent: section.modifiedContent,
        changedLineCount: section.added === undefined && section.removed === undefined ? undefined : (section.added ?? 0) + (section.removed ?? 0),
        useIntrinsicImageHeight: isIntrinsicHeightImageDiff(section.diffResult),
        isLargeDiffLimited: section.largeDiffRenderLimit?.limited === true,
        lineCounts: section.largeDiffRenderLimit?.lineCounts
      })
    },
    overscan: COMBINED_DIFF_OVERSCAN,
    initialOffset: () => scrollOffsetRef.current,
    scrollToFn: (offset, options, instance) => {
      const target = offset + (options.adjustments ?? 0)
      if (instance.scrollElement?.scrollTop !== target) programmaticScrollMarks.mark(target)
      elementScroll(offset, options, instance)
    },
    getItemKey: (index) => `${sections[index]?.key ?? index}:${sections[index]?.collapsed ? 'collapsed' : 'expanded'}:${generation}`
  })
  const combinedDiffTotalSize = virtualizer.getTotalSize()
  const getCombinedDiffSectionKey = useCallback((section: DiffSection) => section.key, [])
  const getCombinedDiffSectionElementKey = useCallback(
    (element: Element) => element instanceof HTMLElement ? element.dataset.combinedDiffSectionKey ?? null : null,
    []
  )
  const recordCombinedDiffVirtualScrollAnchor = useCallback((scrollTop: number) => {
    scrollAnchorRef.current = getVirtualizedScrollAnchorForOffset({
      getRowKey: getCombinedDiffSectionKey,
      rows: sectionsRef.current,
      scrollTop,
      virtualItems: virtualizer.getVirtualItems()
    })
    latestDomScrollAnchorRef.current = null
  }, [getCombinedDiffSectionKey, sectionsRef, virtualizer])
  const recordCombinedDiffDomScrollAnchor = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return false
    const containerRect = container.getBoundingClientRect()
    const visibleRows = Array.from(container.querySelectorAll<HTMLElement>('[data-combined-diff-section-row]'))
      .map((row) => {
        const key = row.dataset.combinedDiffSectionKey
        const rect = row.getBoundingClientRect()
        return !key || !row.isConnected || rect.height <= 0 || rect.bottom <= containerRect.top || rect.top >= containerRect.bottom ? null : { key, rect }
      })
      .filter((row): row is { key: string; rect: DOMRect } => row !== null)
      .sort((a, b) => a.rect.top - b.rect.top)
    const firstVisible = visibleRows[0]
    if (!firstVisible) return false
    const anchor: NonNullable<VirtualizedScrollAnchor> = {
      fallbackKeys: visibleRows.slice(1).map((row) => row.key),
      key: firstVisible.key,
      offset: Math.min(firstVisible.rect.height, Math.max(0, containerRect.top - firstVisible.rect.top)),
      scrollTop: container.scrollTop
    }
    scrollAnchorRef.current = anchor
    latestDomScrollAnchorRef.current = anchor
    return true
  }, [])
  const writeCombinedDiffScrollAnchor = useCallback(() => {
    const anchor = scrollAnchorRef.current
    if (anchor) setWithLRU(combinedDiffScrollAnchorCache, viewStateKey, anchor)
    else combinedDiffScrollAnchorCache.delete(viewStateKey)
  }, [viewStateKey])
  const persistCombinedDiffScrollAnchor = useCallback((refreshDomAnchor = true) => {
    if (refreshDomAnchor) recordCombinedDiffDomScrollAnchor()
    writeCombinedDiffScrollAnchor()
  }, [recordCombinedDiffDomScrollAnchor, writeCombinedDiffScrollAnchor])
  const combinedDiffRestoreSignal = useMemo(
    () => `${generation}|${model.sideBySide ? 'sbs' : 'inline'}|${clampRestoreCount}|${sections.map((section) => `${section.key}:${section.collapsed ? 'c' : 'e'}`).join(',')}`,
    [clampRestoreCount, generation, model.sideBySide, sections]
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
  useLayoutEffect(() => virtualizer.measure(), [model.sideBySide, virtualizer])

  const toggleSection = useCallback((index: number) => {
    const shouldLoadAfterExpand = sectionsRef.current[index]?.collapsed ?? false
    setSections((previous) => previous.map((section, sectionIndex) => sectionIndex === index ? { ...section, collapsed: !section.collapsed } : section))
    if (shouldLoadAfterExpand) loadSchedulerRef.current.request(index)
  }, [loadSchedulerRef, sectionsRef, setSections])
  const sectionIndexByKey = useMemo(() => createCombinedDiffSectionIndexMap(sections), [sections])
  const sectionIndexByKeyRef = useRef(sectionIndexByKey)
  sectionIndexByKeyRef.current = sectionIndexByKey
  const requestCombinedDiffSectionReload = useCallback((index: number) => {
    const section = sectionsRef.current[index]
    if (section && !section.dirty) retrySectionRef.current(index)
  }, [retrySectionRef, sectionsRef])
  const ensureCombinedDiffSectionLoaded = useCallback((index: number) => {
    const section = sectionsRef.current[index]
    if (!shouldRequestCombinedDiffSectionLoad(section, loadingIndicesRef.current.has(index))) return
    loadedIndicesRef.current.delete(index)
    loadSchedulerRef.current.request(index)
  }, [loadSchedulerRef, loadedIndicesRef, loadingIndicesRef, sectionsRef])
  const [activeTreeSectionState, setActiveTreeSectionState] = useState<{ entrySignature: string; key: string | null }>(() => ({ entrySignature, key: null }))
  const activeTreeSectionKey = activeTreeSectionState.entrySignature === entrySignature ? activeTreeSectionState.key : null
  if (activeTreeSectionState.entrySignature !== entrySignature) setActiveTreeSectionState({ entrySignature, key: null })
  const viewedSectionKeys = useMemo(() => new Set(sections.filter((section) => !section.loading).map((section) => section.key)), [sections])
  const handleTreeNavigate = useCallback((entry: GitStatusEntry | GitBranchChangeEntry) => {
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
        window.requestAnimationFrame(() => scrollContainerRef.current?.dispatchEvent(new Event(VIRTUALIZED_SCROLL_ANCHOR_RECORD_EVENT)))
      }
    })
    if (navigatedIndex !== null) setActiveTreeSectionState({ entrySignature, key: sectionsRef.current[navigatedIndex]?.key ?? null })
  }, [ensureCombinedDiffSectionLoaded, entrySignature, markDirectScrollInput, sectionIndexByKey, sectionsRef, toggleSection, treeMode, virtualizer])
  const combinedGitStatusSignature = useMemo(() => shouldAutoReloadFromGitStatus ? buildCombinedGitStatusSignature(sections, gitStatusEntries) : '', [gitStatusEntries, sections, shouldAutoReloadFromGitStatus])
  const previousGitStatusSignatureRef = useRef<string | null>(null)
  useEffect(() => {
    if (!shouldAutoReloadFromGitStatus) {
      previousGitStatusSignatureRef.current = null
      return
    }
    if (previousGitStatusSignatureRef.current === null) {
      previousGitStatusSignatureRef.current = combinedGitStatusSignature
      return
    }
    if (previousGitStatusSignatureRef.current === combinedGitStatusSignature) return
    previousGitStatusSignatureRef.current = combinedGitStatusSignature
    for (const index of loadedIndicesRef.current) requestCombinedDiffSectionReload(index)
  }, [combinedGitStatusSignature, loadedIndicesRef, requestCombinedDiffSectionReload, shouldAutoReloadFromGitStatus])
  useEffect(() => {
    if (treeMode !== 'all' && treeMode !== 'uncommitted') return
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<EditorPathMutationTarget>).detail
      if (!detail || detail.worktreeId !== file.worktreeId) return
      const hasRuntimeOwnerFilter = Object.prototype.hasOwnProperty.call(detail, 'runtimeEnvironmentId')
      if (hasRuntimeOwnerFilter && (detail.runtimeEnvironmentId?.trim() || null) !== (file.runtimeEnvironmentId?.trim() || null)) return
      for (const area of ['unstaged', 'staged', 'untracked'] as const) {
        const key = getCombinedDiffFileTreeSectionKey('uncommitted', { path: detail.relativePath, status: 'modified', area })
        const index = sectionIndexByKeyRef.current.get(key)
        if (index !== undefined) requestCombinedDiffSectionReload(index)
      }
    }
    window.addEventListener(ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT, handler as EventListener)
    return () => window.removeEventListener(ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT, handler as EventListener)
  }, [file.runtimeEnvironmentId, file.worktreeId, requestCombinedDiffSectionReload, treeMode])
  const setAllSectionsCollapsed = useCallback((collapsed: boolean) => {
    combinedDiffPreferences.collapsed = collapsed
    setSections((previous) => previous.map((section) => ({ ...section, collapsed })))
    if (!collapsed) {
      for (const index of getInitialCombinedDiffSectionLoadIndices({ sectionCount: sectionsRef.current.length, loadedIndices: loadedIndicesRef.current })) {
        loadSchedulerRef.current.request(index)
      }
    }
  }, [loadSchedulerRef, loadedIndicesRef, setSections])
  const toggleSideBySide = useCallback(() => {
    model.setSideBySide((previous) => {
      const next = !previous
      combinedDiffPreferences.sideBySide = next
      return next
    })
  }, [model])
  const toggleDiffWordWrap = useCallback(() => {
    void updateSettings({ diffWordWrap: settings?.diffWordWrap !== true })
  }, [settings?.diffWordWrap, updateSettings])

  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const cached = combinedDiffViewStateCache.get(viewStateKey)
    if (cached?.entrySignature === entrySignature) scrollOffsetRef.current = combinedDiffScrollTopCache.get(viewStateKey) ?? cached.scrollTop
    let idleTimer: number | null = null
    let frame: number | null = null
    const cancelScheduledAnchorPersist = () => {
      if (idleTimer !== null) window.clearTimeout(idleTimer)
      if (frame !== null) window.cancelAnimationFrame(frame)
      idleTimer = null
      frame = null
    }
    const scheduleSettledAnchorPersist = () => {
      cancelScheduledAnchorPersist()
      idleTimer = window.setTimeout(() => {
        idleTimer = null
        if (hasDirectScrollInput()) {
          scheduleSettledAnchorPersist()
          return
        }
        frame = window.requestAnimationFrame(() => {
          frame = null
          persistCombinedDiffScrollAnchor()
        })
      }, 150)
    }
    const updateCachedScrollPosition = (scrollTop: number, writeAnchor: boolean, scheduleSettled: boolean) => {
      scrollOffsetRef.current = scrollTop
      setWithLRU(combinedDiffScrollTopCache, viewStateKey, scrollTop)
      if (writeAnchor) writeCombinedDiffScrollAnchor()
      if (scheduleSettled) scheduleSettledAnchorPersist()
      updateCombinedDiffScrollbar()
      const existing = combinedDiffViewStateCache.get(viewStateKey)
      if (existing?.entrySignature === entrySignature) setWithLRU(combinedDiffViewStateCache, viewStateKey, { ...existing, scrollTop })
    }
    lastScrollHeightRef.current = container.scrollHeight
    const handleScroll = (event: Event) => {
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
        setClampRestoreCount((count) => count + 1)
        updateCombinedDiffScrollbar()
        return
      }
      recordCombinedDiffVirtualScrollAnchor(scrollTop)
      updateCachedScrollPosition(scrollTop, true, true)
    }
    updateCombinedDiffScrollbar()
    const resizeObserver = new ResizeObserver(updateCombinedDiffScrollbar)
    resizeObserver.observe(container)
    container.addEventListener('scroll', handleScroll)
    return () => {
      cancelScheduledAnchorPersist()
      if (latestDomScrollAnchorRef.current) scrollAnchorRef.current = latestDomScrollAnchorRef.current
      updateCachedScrollPosition(scrollOffsetRef.current, true, false)
      resizeObserver.disconnect()
      container.removeEventListener('scroll', handleScroll)
    }
  }, [entrySignature, hasDirectScrollInput, persistCombinedDiffScrollAnchor, programmaticScrollMarks, recordCombinedDiffVirtualScrollAnchor, sections.length, updateCombinedDiffScrollbar, viewStateKey, writeCombinedDiffScrollAnchor])
  useLayoutEffect(() => {
    updateCombinedDiffScrollbar()
    const container = scrollContainerRef.current
    if (!container || container.scrollTop <= 0) return
    let frame: number | null = null
    const timer = window.setTimeout(() => {
      if (!container.isConnected || hasDirectScrollInput()) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        persistCombinedDiffScrollAnchor()
      })
    }, 300)
    return () => {
      window.clearTimeout(timer)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [hasDirectScrollInput, persistCombinedDiffScrollAnchor, sectionHeights, sections, updateCombinedDiffScrollbar])

  const handleCombinedDiffScrollbarPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const container = scrollContainerRef.current
    if (!container) return
    event.preventDefault()
    markDirectScrollInput()
    const track = event.currentTarget
    const thumb = event.target instanceof HTMLElement ? event.target.closest('[data-combined-diff-scrollbar-thumb]') : null
    const getThumbHeight = () => {
      const trackHeight = Math.max(1, track.getBoundingClientRect().height)
      return Math.min(trackHeight, Math.max(COMBINED_DIFF_SCROLLBAR_THUMB_MIN_HEIGHT, (container.clientHeight / container.scrollHeight) * trackHeight))
    }
    const getScrollTop = (clientY: number, grabOffset: number) => {
      const rect = track.getBoundingClientRect()
      const trackHeight = Math.max(1, rect.height)
      const thumbHeight = getThumbHeight()
      const maxThumbTop = Math.max(1, trackHeight - thumbHeight)
      const maxScrollTop = Math.max(1, container.scrollHeight - container.clientHeight)
      return (Math.max(0, Math.min(maxThumbTop, clientY - rect.top - grabOffset)) / maxThumbTop) * maxScrollTop
    }
    const grabOffset = thumb ? event.clientY - thumb.getBoundingClientRect().top : getThumbHeight() / 2
    const move = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault()
      markDirectScrollInput()
      container.scrollTop = getScrollTop(moveEvent.clientY, grabOffset)
      updateCombinedDiffScrollbar()
    }
    if (!thumb) {
      container.scrollTop = getScrollTop(event.clientY, grabOffset)
      updateCombinedDiffScrollbar()
    }
    cleanupActiveScrollbarDrag()
    let cleanup: CombinedDiffScrollbarDragCleanup
    cleanup = beginCombinedDiffScrollbarDrag({ track, pointerId: event.pointerId, onPointerMove: move, onEnd: () => { if (activeScrollbarDragCleanupRef.current === cleanup) activeScrollbarDragCleanupRef.current = null } })
    activeScrollbarDragCleanupRef.current = cleanup
  }, [cleanupActiveScrollbarDrag, markDirectScrollInput, updateCombinedDiffScrollbar])

  return {
    scrollContainerRef, setScrollContainerRef, scrollThumb, setScrollThumb, updateCombinedDiffScrollbar,
    markDirectScrollInput, hasDirectScrollInput, cleanupActiveScrollbarDrag,
    activeScrollbarDragCleanupRef, scrollOffsetRef, scrollAnchorRef, latestDomScrollAnchorRef,
    directScrollInputUntilRef, programmaticScrollMarks, clampRestoreCount, setClampRestoreCount,
    lastScrollHeightRef, virtualizer, combinedDiffTotalSize, getCombinedDiffSectionKey,
    getCombinedDiffSectionElementKey, recordCombinedDiffVirtualScrollAnchor,
    recordCombinedDiffDomScrollAnchor, writeCombinedDiffScrollAnchor, persistCombinedDiffScrollAnchor,
    combinedDiffRestoreSignal, toggleSection, sectionIndexByKey, sectionIndexByKeyRef,
    requestCombinedDiffSectionReload, ensureCombinedDiffSectionLoaded, activeTreeSectionState,
    activeTreeSectionKey, setActiveTreeSectionState, viewedSectionKeys, handleTreeNavigate,
    combinedGitStatusSignature, setAllSectionsCollapsed, toggleSideBySide, toggleDiffWordWrap,
    handleCombinedDiffScrollbarPointerDown
  }
}

export type CombinedDiffViewerDecorator = ReturnType<typeof useCombinedDiffViewerDecorator>
