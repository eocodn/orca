import { useCallback, useRef, useState } from 'react'

export function useWorktreeListRevealHighlight() {
  const [highlightedRevealRowKey, setHighlightedRevealRowKey] = useState<string | null>(null)
  const revealHighlightFrameIdRef = useRef<number | null>(null)
  const revealHighlightTimeoutRef = useRef<number | null>(null)
  const clearRevealHighlightFrame = useCallback(() => {
    if (revealHighlightFrameIdRef.current !== null) {
      window.cancelAnimationFrame(revealHighlightFrameIdRef.current)
      revealHighlightFrameIdRef.current = null
    }
  }, [])
  const clearRevealHighlightTimeout = useCallback(() => {
    if (revealHighlightTimeoutRef.current !== null) {
      window.clearTimeout(revealHighlightTimeoutRef.current)
      revealHighlightTimeoutRef.current = null
    }
  }, [])
  const flashRevealedRow = useCallback(
    (rowKey: string) => {
      clearRevealHighlightTimeout()
      clearRevealHighlightFrame()
      setHighlightedRevealRowKey(null)
      revealHighlightFrameIdRef.current = window.requestAnimationFrame(() => {
        revealHighlightFrameIdRef.current = null
        setHighlightedRevealRowKey(rowKey)
        revealHighlightTimeoutRef.current = window.setTimeout(() => {
          revealHighlightTimeoutRef.current = null
          setHighlightedRevealRowKey(null)
        }, 1500)
      })
    },
    [clearRevealHighlightFrame, clearRevealHighlightTimeout]
  )
  return {
    highlightedRevealRowKey,
    flashRevealedRow,
    clearRevealHighlightFrame,
    clearRevealHighlightTimeout
  }
}
