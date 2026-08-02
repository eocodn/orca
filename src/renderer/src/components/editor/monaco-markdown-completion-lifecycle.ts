import { useCallback, useEffect } from 'react'
import { clearMarkdownDocCompletionDocuments, setMarkdownDocCompletionDocuments } from './monaco-markdown-doc-completions'
import type { MarkdownDocument } from '../../../../shared/types'
import type { MonacoEditorRuntime } from './monaco-editor-runtime'

export function useMonacoMarkdownCompletionLifecycle(
  runtime: MonacoEditorRuntime,
  language: string,
  markdownDocuments?: MarkdownDocument[]
): { updateMarkdownCompletionDocuments: () => void } {
  const { editorRef, modelKeyRef } = runtime
  const updateMarkdownCompletionDocuments = useCallback((): void => {
    const modelKey = editorRef.current?.getModel()?.uri.toString() ?? null
    if (modelKeyRef.current && modelKeyRef.current !== modelKey) {
      clearMarkdownDocCompletionDocuments(modelKeyRef.current)
    }
    modelKeyRef.current = modelKey
    if (!modelKey) {
      return
    }
    if (language === 'markdown' && markdownDocuments) {
      setMarkdownDocCompletionDocuments(modelKey, markdownDocuments)
    } else {
      clearMarkdownDocCompletionDocuments(modelKey)
    }
  }, [editorRef, language, markdownDocuments, modelKeyRef])

  useEffect(() => {
    updateMarkdownCompletionDocuments()
  }, [updateMarkdownCompletionDocuments])

  useEffect(() => {
    return () => {
      if (modelKeyRef.current) {
        clearMarkdownDocCompletionDocuments(modelKeyRef.current)
      }
    }
  }, [modelKeyRef])

  return { updateMarkdownCompletionDocuments }
}
