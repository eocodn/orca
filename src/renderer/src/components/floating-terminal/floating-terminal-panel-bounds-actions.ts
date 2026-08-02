import { useCallback, useEffect, useLayoutEffect } from 'react'
import {
  anchorFloatingTerminalPanelBounds,
  clampFloatingTerminalBounds,
  getDefaultFloatingTerminalBounds,
  getDefaultFloatingTerminalCommittedBounds,
  getMaximizedFloatingTerminalBounds,
  persistFloatingTerminalPanelBounds,
  resolveFloatingTerminalPanelBounds,
  shouldReconcileFloatingTerminalPanelBounds,
  type FloatingTerminalPanelBounds,
  type FloatingTerminalPanelCommittedBounds
} from './floating-terminal-panel-bounds'
import { useFloatingTerminalPanelState } from './floating-terminal-panel-state'

type PanelState = ReturnType<typeof useFloatingTerminalPanelState>

function areCommittedBoundsEqual(
  left: FloatingTerminalPanelCommittedBounds | null,
  right: FloatingTerminalPanelCommittedBounds
): boolean {
  return left !== null && JSON.stringify(left) === JSON.stringify(right)
}

export function useFloatingTerminalPanelBounds(state: PanelState) {
  const {
    bounds,
    setBounds,
    maximized,
    setMaximized,
    boundsSourceRef,
    committedBoundsRef,
    stagedBoundsRef,
    restoreBoundsRef,
    lastPersistedBoundsRef
  } = state

  const persistUserBounds = useCallback((nextBounds: FloatingTerminalPanelCommittedBounds) => {
    if (areCommittedBoundsEqual(lastPersistedBoundsRef.current, nextBounds)) return
    lastPersistedBoundsRef.current = nextBounds
    persistFloatingTerminalPanelBounds(nextBounds)
  }, [lastPersistedBoundsRef])

  const previewUserBounds = useCallback((nextBounds: FloatingTerminalPanelBounds) => {
    const clampedBounds = clampFloatingTerminalBounds(nextBounds)
    stagedBoundsRef.current = clampedBounds
    setBounds(clampedBounds)
  }, [setBounds, stagedBoundsRef])

  const commitUserBounds = useCallback((nextBounds: FloatingTerminalPanelBounds | null = stagedBoundsRef.current) => {
    if (!nextBounds) return
    const clampedBounds = clampFloatingTerminalBounds(nextBounds)
    stagedBoundsRef.current = null
    setBounds(clampedBounds)
    const anchoredBounds = anchorFloatingTerminalPanelBounds(clampedBounds)
    if (!anchoredBounds) return
    committedBoundsRef.current = anchoredBounds
    boundsSourceRef.current = 'user'
    persistUserBounds(anchoredBounds)
  }, [boundsSourceRef, committedBoundsRef, persistUserBounds, setBounds, stagedBoundsRef])

  const reconcileBounds = useCallback(() => {
    if (maximized) {
      setBounds(getMaximizedFloatingTerminalBounds())
      return
    }
    setBounds((currentBounds) => {
      const source = boundsSourceRef.current
      if (!shouldReconcileFloatingTerminalPanelBounds(source)) return currentBounds
      return resolveFloatingTerminalPanelBounds(committedBoundsRef.current, source)
    })
  }, [boundsSourceRef, committedBoundsRef, maximized, setBounds])

  useLayoutEffect(() => {
    reconcileBounds()
  }, [reconcileBounds])

  useEffect(() => {
    const handleResize = () => reconcileBounds()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [reconcileBounds])

  const toggleMaximized = useCallback(() => {
    if (maximized) {
      const restoredState = restoreBoundsRef.current ?? {
        committedBounds: getDefaultFloatingTerminalCommittedBounds(),
        renderedBounds: getDefaultFloatingTerminalBounds(),
        source: 'default' as const
      }
      restoreBoundsRef.current = null
      boundsSourceRef.current = restoredState.source
      committedBoundsRef.current = restoredState.committedBounds
      const restoredBounds = shouldReconcileFloatingTerminalPanelBounds(restoredState.source)
        ? resolveFloatingTerminalPanelBounds(restoredState.committedBounds, restoredState.source)
        : restoredState.renderedBounds
      stagedBoundsRef.current = null
      setBounds(restoredBounds)
      setMaximized(false)
      return
    }
    restoreBoundsRef.current = {
      committedBounds: committedBoundsRef.current,
      renderedBounds: bounds,
      source: boundsSourceRef.current
    }
    stagedBoundsRef.current = null
    setBounds(getMaximizedFloatingTerminalBounds())
    setMaximized(true)
  }, [bounds, boundsSourceRef, committedBoundsRef, maximized, restoreBoundsRef, setBounds, setMaximized, stagedBoundsRef])

  const maximizePanel = useCallback(() => {
    if (maximized) return
    restoreBoundsRef.current = {
      committedBounds: committedBoundsRef.current,
      renderedBounds: bounds,
      source: boundsSourceRef.current
    }
    stagedBoundsRef.current = null
    setBounds(getMaximizedFloatingTerminalBounds())
    setMaximized(true)
  }, [bounds, boundsSourceRef, committedBoundsRef, maximized, restoreBoundsRef, setBounds, setMaximized, stagedBoundsRef])

  return { persistUserBounds, previewUserBounds, commitUserBounds, reconcileBounds, toggleMaximized, maximizePanel }
}
