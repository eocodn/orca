import { useCallback, useLayoutEffect } from 'react'
import { cursorPositionCache, scrollTopCache, setWithLRU } from '@/lib/scroll-cache'
import {
  beginProgrammaticContentSync,
  endProgrammaticContentSync,
  shouldIgnoreMonacoContentChange
} from './monaco-programmatic-sync'
import { syncContentUpdate } from './monaco-content-sync'
import type { MonacoEditorProps } from './monaco-editor-contracts'
import type { MonacoEditorRuntime } from './monaco-editor-runtime'

type RevealCleanup = {
  cancelScheduledReveal: () => void
  clearTransientRevealHighlight: () => void
}

export function useMonacoEditorContentLifecycle(
  runtime: MonacoEditorRuntime,
  props: MonacoEditorProps,
  revealCleanup: RevealCleanup
): { handleChange: (value: string | undefined) => void } {
  const {
    filePath,
    content,
    onContentChange,
    viewStateKey
  } = props
  const {
    editorRef,
    lastSyncedContentRef,
    contentSyncModeRef,
    isApplyingLargePasteRef,
    isApplyingProgrammaticContentRef,
    scrollThrottleTimerRef,
    unregisterFileSearchSelectionRef
  } = runtime
  const { cancelScheduledReveal, clearTransientRevealHighlight } = revealCleanup

  const handleChange = useCallback(
    (value: string | undefined): void => {
      if (value === undefined) {
        return
      }
      if (isApplyingLargePasteRef.current) {
        lastSyncedContentRef.current = value
        return
      }
      if (
        shouldIgnoreMonacoContentChange({
          filePath,
          isApplyingProgrammaticContent: isApplyingProgrammaticContentRef.current
        })
      ) {
        return
      }
      lastSyncedContentRef.current = value
      onContentChange(value)
    },
    [filePath, isApplyingLargePasteRef, isApplyingProgrammaticContentRef, lastSyncedContentRef, onContentChange]
  )

  useLayoutEffect(() => {
    const editorInstance = editorRef.current
    if (!editorInstance || lastSyncedContentRef.current === content) {
      return
    }
    beginProgrammaticContentSync(filePath)
    isApplyingProgrammaticContentRef.current = true
    try {
      syncContentUpdate(editorInstance, content, contentSyncModeRef.current)
      lastSyncedContentRef.current = content
    } finally {
      isApplyingProgrammaticContentRef.current = false
      endProgrammaticContentSync(filePath)
    }
  }, [content, contentSyncModeRef, editorRef, filePath, isApplyingProgrammaticContentRef, lastSyncedContentRef])

  useLayoutEffect(() => {
    return () => {
      if (scrollThrottleTimerRef.current !== null) {
        clearTimeout(scrollThrottleTimerRef.current)
        scrollThrottleTimerRef.current = null
      }
      const editorInstance = editorRef.current
      if (editorInstance) {
        setWithLRU(scrollTopCache, viewStateKey, editorInstance.getScrollTop())
        const position = editorInstance.getPosition()
        if (position) {
          setWithLRU(cursorPositionCache, viewStateKey, {
            lineNumber: position.lineNumber,
            column: position.column
          })
        }
      }
      cancelScheduledReveal()
      clearTransientRevealHighlight()
      unregisterFileSearchSelectionRef.current?.()
      unregisterFileSearchSelectionRef.current = null
    }
  }, [cancelScheduledReveal, clearTransientRevealHighlight, editorRef, scrollThrottleTimerRef, unregisterFileSearchSelectionRef, viewStateKey])

  return { handleChange }
}
