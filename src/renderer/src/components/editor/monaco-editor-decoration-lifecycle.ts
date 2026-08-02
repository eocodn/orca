import { useEffect } from 'react'
import { buildGitConflictDecorations, hasGitConflictMarkers } from './monaco-conflict-decorations'
import type { MonacoEditorProps } from './monaco-editor-contracts'
import type { MonacoEditorRuntime } from './monaco-editor-runtime'

export function useMonacoEditorDecorationLifecycle(
  runtime: MonacoEditorRuntime,
  props: MonacoEditorProps
): void {
  const { content, language, conflictDecorationsEnabled } = props
  const {
    mountedEditor,
    markdownDocLinkDecorationsRef,
    conflictDecorationsRef
  } = runtime

  useEffect(() => {
    markdownDocLinkDecorationsRef.current?.refresh()
  }, [content, language, markdownDocLinkDecorationsRef])

  useEffect(() => {
    if (!mountedEditor) {
      return
    }
    if (!conflictDecorationsEnabled || !hasGitConflictMarkers(content)) {
      conflictDecorationsRef.current?.clear()
      return
    }
    const decorations = buildGitConflictDecorations(content)
    if (!conflictDecorationsRef.current) {
      conflictDecorationsRef.current = mountedEditor.createDecorationsCollection(decorations)
      return
    }
    conflictDecorationsRef.current.set(decorations)
  }, [conflictDecorationsRef, conflictDecorationsEnabled, content, mountedEditor])

  useEffect(() => {
    return () => {
      markdownDocLinkDecorationsRef.current?.dispose()
      markdownDocLinkDecorationsRef.current = null
      conflictDecorationsRef.current?.clear()
      conflictDecorationsRef.current = null
    }
  }, [conflictDecorationsRef, markdownDocLinkDecorationsRef])
}
