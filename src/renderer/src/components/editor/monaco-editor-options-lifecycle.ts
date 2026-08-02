import { useEffect } from 'react'
import { buildFileEditorWordWrapOptions } from './file-editor-word-wrap-options'
import type { MonacoEditorRuntime } from './monaco-editor-runtime'

export function useMonacoEditorOptionsLifecycle(runtime: MonacoEditorRuntime): void {
  const { editorRef, editorFontFamily, editorFontSize, editorWordWrap } = runtime
  useEffect(() => {
    editorRef.current?.updateOptions({
      fontSize: editorFontSize,
      fontFamily: editorFontFamily,
      ...buildFileEditorWordWrapOptions(editorWordWrap)
    })
  }, [editorFontFamily, editorFontSize, editorRef, editorWordWrap])
}
