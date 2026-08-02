import { useCallback, useEffect } from 'react'
import type { editor } from 'monaco-editor'
import { MAX_REVEAL_CONTENT_WAIT_FRAMES, performReveal } from './monaco-reveal'
import type { MonacoEditorProps } from './monaco-editor-contracts'
import type { MonacoEditorRuntime } from './monaco-editor-runtime'

export type MonacoEditorRevealLifecycle = {
  clearTransientRevealHighlight: () => void
  cancelScheduledReveal: () => void
  queueReveal: (
    editorInstance: editor.IStandaloneCodeEditor,
    line: number,
    column: number,
    matchLength: number,
    onApplied?: () => void
  ) => void
}

export function useMonacoEditorRevealLifecycle(
  runtime: MonacoEditorRuntime,
  props: MonacoEditorProps
): MonacoEditorRevealLifecycle {
  const {
    revealLine,
    revealColumn,
    revealMatchLength
  } = props
  const {
    editorRef,
    revealDecorationRef,
    revealHighlightTimerRef,
    revealRafRef,
    revealInnerRafRef,
    setPendingEditorReveal
  } = runtime

  const clearTransientRevealHighlight = useCallback((): void => {
    if (revealHighlightTimerRef.current !== null) {
      clearTimeout(revealHighlightTimerRef.current)
      revealHighlightTimerRef.current = null
    }
    revealDecorationRef.current?.clear()
    revealDecorationRef.current = null
  }, [revealDecorationRef, revealHighlightTimerRef])

  const cancelScheduledReveal = useCallback((): void => {
    if (revealRafRef.current !== null) {
      cancelAnimationFrame(revealRafRef.current)
      revealRafRef.current = null
    }
    if (revealInnerRafRef.current !== null) {
      cancelAnimationFrame(revealInnerRafRef.current)
      revealInnerRafRef.current = null
    }
  }, [revealInnerRafRef, revealRafRef])

  const queueReveal = useCallback(
    (
      editorInstance: editor.IStandaloneCodeEditor,
      line: number,
      column: number,
      matchLength: number,
      onApplied?: () => void
    ): void => {
      cancelScheduledReveal()
      let waitFrames = 0
      const schedule = (): void => {
        revealRafRef.current = requestAnimationFrame(() => {
          revealInnerRafRef.current = requestAnimationFrame(() => {
            revealRafRef.current = null
            revealInnerRafRef.current = null
            const modelLineCount = editorInstance.getModel()?.getLineCount() ?? 0
            if (line > 1 && modelLineCount < line && waitFrames < MAX_REVEAL_CONTENT_WAIT_FRAMES) {
              waitFrames += 2
              schedule()
              return
            }
            performReveal(
              editorInstance,
              line,
              column,
              matchLength,
              clearTransientRevealHighlight,
              revealDecorationRef,
              revealHighlightTimerRef
            )
            onApplied?.()
          })
        })
      }
      schedule()
    },
    [cancelScheduledReveal, clearTransientRevealHighlight, revealDecorationRef, revealHighlightTimerRef, revealInnerRafRef, revealRafRef]
  )

  useEffect(() => {
    if (!revealLine || !editorRef.current) {
      return
    }
    queueReveal(editorRef.current, revealLine, revealColumn ?? 1, revealMatchLength ?? 0, () => {
      setPendingEditorReveal(null)
    })
  }, [editorRef, queueReveal, revealColumn, revealLine, revealMatchLength, setPendingEditorReveal])

  return { clearTransientRevealHighlight, cancelScheduledReveal, queueReveal }
}
