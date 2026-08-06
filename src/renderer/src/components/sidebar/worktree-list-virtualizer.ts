import { useCallback, useEffect, useRef } from 'react'
import {
  measureElement as measureVirtualElementSize,
  useVirtualizer
} from '@tanstack/react-virtual'
import type { Range, Virtualizer } from '@tanstack/react-virtual'
import type { RenderRow } from './worktree-list-virtual-rows'
import {
  estimateRenderRowSize,
  extractWorktreeVirtualRowIndexes,
  getRenderRowKey,
  getVirtualRowIndex,
  pruneStaleVirtualRowElementCache
} from './worktree-list-virtual-rows'
import { WORKTREE_SIDEBAR_REVEAL_TOP_INSET } from './worktree-sidebar-reveal'
import { SUPPRESS_WORKTREE_LIST_SCROLL_ADJUSTMENT_EVENT } from './WorktreeCardAgents'
import { shouldAdjustWorktreeSidebarMeasuredRowScroll } from './worktree-list-row-dom'

const USER_SCROLL_MEASUREMENT_ADJUSTMENT_SUPPRESS_MS = 500
const EXPANDING_CARD_MEASUREMENT_ADJUSTMENT_SUPPRESS_MS = 300

export type WorktreeListVirtualizerOptions = {
  renderRows: RenderRow[]
  firstHeaderIndex: number
  stickyHeaderIndexes: readonly number[]
  scrollRef: React.RefObject<HTMLDivElement | null>
  scrollOffsetRef: React.MutableRefObject<number>
  suppressMeasurementAdjustmentUntilRef: React.MutableRefObject<number>
  directScrollInputUntilRef: React.MutableRefObject<number>
}

export type WorktreeListVirtualizerResult = {
  virtualizer: Virtualizer<HTMLDivElement, Element>
  renderRowsRef: React.MutableRefObject<RenderRow[]>
  firstHeaderIndexRef: React.MutableRefObject<number>
  activeStickyHeaderIndexRef: React.MutableRefObject<number | null>
  stickyRangeStartIndexRef: React.MutableRefObject<number>
  isCurrentVirtualRowElement: (element: Element) => boolean
  measureVirtualRowElement: (element: HTMLDivElement | null) => void
  markScrollMovement: () => void
  markDirectScrollInput: () => void
  hasDirectScrollInput: () => boolean
  shouldSkipScrollAnchorRestore: () => boolean
}

export function useWorktreeListVirtualizer({
  renderRows,
  firstHeaderIndex,
  stickyHeaderIndexes,
  scrollRef,
  scrollOffsetRef,
  suppressMeasurementAdjustmentUntilRef,
  directScrollInputUntilRef
}: WorktreeListVirtualizerOptions): WorktreeListVirtualizerResult {
  const firstHeaderIndexRef = useRef(firstHeaderIndex)
  firstHeaderIndexRef.current = firstHeaderIndex
  const activeStickyHeaderIndexRef = useRef<number | null>(null)
  const stickyRangeStartIndexRef = useRef(0)
  const renderRowsRef = useRef(renderRows)
  renderRowsRef.current = renderRows

  const getVirtualItemKey = useCallback(
    (index: number) => {
      const row = renderRows[index]
      return row ? getRenderRowKey(row) : `__stale_${index}`
    },
    [renderRows]
  )
  const getExpectedVirtualRowKey = useCallback((element: Element) => {
    const index = getVirtualRowIndex(element)
    const row = index === null ? undefined : renderRowsRef.current[index]
    return row ? getRenderRowKey(row) : null
  }, [])
  const isCurrentVirtualRowElement = useCallback(
    (element: Element) => {
      const expectedKey = getExpectedVirtualRowKey(element)
      return (
        element.isConnected &&
        expectedKey !== null &&
        element.getAttribute('data-worktree-virtual-row-key') === expectedKey
      )
    },
    [getExpectedVirtualRowKey]
  )
  const measureCurrentVirtualRowElement = useCallback(
    (
      element: HTMLDivElement,
      entry: ResizeObserverEntry | undefined,
      instance: Parameters<typeof measureVirtualElementSize<HTMLDivElement>>[2]
    ) => {
      if (!isCurrentVirtualRowElement(element)) {
        const index = getVirtualRowIndex(element)
        const measured = instance.getVirtualItems().find((item) => item.index === index)
        return (
          measured?.size ??
          estimateRenderRowSize(
            renderRowsRef.current,
            index ?? -1,
            firstHeaderIndexRef.current,
            activeStickyHeaderIndexRef.current
          )
        )
      }
      const index = getVirtualRowIndex(element)
      if (
        index !== null &&
        (renderRowsRef.current[index]?.type === 'header' ||
          renderRowsRef.current[index]?.type === 'host-header')
      ) {
        return estimateRenderRowSize(
          renderRowsRef.current,
          index,
          firstHeaderIndexRef.current,
          activeStickyHeaderIndexRef.current
        )
      }
      return measureVirtualElementSize(element, entry, instance)
    },
    [isCurrentVirtualRowElement]
  )
  const markScrollMovement = useCallback(() => {
    suppressMeasurementAdjustmentUntilRef.current =
      window.performance.now() + USER_SCROLL_MEASUREMENT_ADJUSTMENT_SUPPRESS_MS
  }, [suppressMeasurementAdjustmentUntilRef])
  const markDirectScrollInput = useCallback(() => {
    const suppressUntil = window.performance.now() + USER_SCROLL_MEASUREMENT_ADJUSTMENT_SUPPRESS_MS
    suppressMeasurementAdjustmentUntilRef.current = suppressUntil
    directScrollInputUntilRef.current = suppressUntil
  }, [directScrollInputUntilRef, suppressMeasurementAdjustmentUntilRef])
  const hasDirectScrollInput = useCallback(
    () => window.performance.now() < directScrollInputUntilRef.current,
    [directScrollInputUntilRef]
  )
  const shouldSkipScrollAnchorRestore = useCallback(
    () => window.performance.now() < directScrollInputUntilRef.current,
    [directScrollInputUntilRef]
  )

  const virtualizer = useVirtualizer({
    count: renderRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      estimateRenderRowSize(
        renderRows,
        index,
        firstHeaderIndex,
        activeStickyHeaderIndexRef.current
      ),
    measureElement: measureCurrentVirtualRowElement,
    rangeExtractor: useCallback(
      (range: Range) => {
        stickyRangeStartIndexRef.current = range.startIndex
        return extractWorktreeVirtualRowIndexes({
          range,
          stickyHeaderIndexes,
          rows: renderRowsRef.current
        })
      },
      [stickyHeaderIndexes]
    ),
    overscan: 10,
    gap: 6,
    scrollPaddingStart: WORKTREE_SIDEBAR_REVEAL_TOP_INSET,
    isScrollingResetDelay: USER_SCROLL_MEASUREMENT_ADJUSTMENT_SUPPRESS_MS,
    useFlushSync: false,
    initialOffset: () => scrollOffsetRef.current,
    getItemKey: getVirtualItemKey
  })
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (_item, _delta, instance) =>
    shouldAdjustWorktreeSidebarMeasuredRowScroll({
      isScrolling: instance.isScrolling,
      now: window.performance.now(),
      suppressUntil: suppressMeasurementAdjustmentUntilRef.current
    })

  useEffect(() => {
    const handleSuppress = () => {
      suppressMeasurementAdjustmentUntilRef.current =
        window.performance.now() + EXPANDING_CARD_MEASUREMENT_ADJUSTMENT_SUPPRESS_MS
    }
    window.addEventListener(SUPPRESS_WORKTREE_LIST_SCROLL_ADJUSTMENT_EVENT, handleSuppress)
    return () => {
      window.removeEventListener(SUPPRESS_WORKTREE_LIST_SCROLL_ADJUSTMENT_EVENT, handleSuppress)
    }
  }, [suppressMeasurementAdjustmentUntilRef])

  const measureVirtualRowElement = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) {
        virtualizer.measureElement(null)
        return
      }
      if (!isCurrentVirtualRowElement(element)) {
        return
      }
      virtualizer.measureElement(element)
    },
    [isCurrentVirtualRowElement, virtualizer]
  )

  return {
    virtualizer,
    renderRowsRef,
    firstHeaderIndexRef,
    activeStickyHeaderIndexRef,
    stickyRangeStartIndexRef,
    isCurrentVirtualRowElement,
    measureVirtualRowElement,
    markScrollMovement,
    markDirectScrollInput,
    hasDirectScrollInput,
    shouldSkipScrollAnchorRestore
  }
}

export { pruneStaleVirtualRowElementCache }
