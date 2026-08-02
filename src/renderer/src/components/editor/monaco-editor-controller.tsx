// Public Monaco facade; focused lifecycle modules own the editor behavior.
import React from 'react'
import '@/lib/monaco-setup'
import type { MonacoEditorProps } from './monaco-editor-contracts'
import { useMonacoEditorComments } from './monaco-editor-comments'
import { useMonacoEditorContentLifecycle } from './monaco-editor-content-lifecycle'
import { useMonacoEditorDecorationLifecycle } from './monaco-editor-decoration-lifecycle'
import { useMonacoEditorMountLifecycle } from './monaco-editor-mount-lifecycle'
import { useMonacoEditorOptionsLifecycle } from './monaco-editor-options-lifecycle'
import { useMonacoEditorRevealLifecycle } from './monaco-editor-reveal-lifecycle'
import { useMonacoMarkdownCompletionLifecycle } from './monaco-markdown-completion-lifecycle'
import { useMonacoEditorRuntime } from './monaco-editor-runtime'
import { MonacoEditorRenderer } from './monaco-editor-renderer'

export default function MonacoEditor(props: MonacoEditorProps): React.JSX.Element {
  const runtime = useMonacoEditorRuntime(props)
  const reveal = useMonacoEditorRevealLifecycle(runtime, props)
  const comments = useMonacoEditorComments(runtime, props)
  const completion = useMonacoMarkdownCompletionLifecycle(
    runtime,
    props.language,
    props.markdownDocuments
  )
  const content = useMonacoEditorContentLifecycle(runtime, props, reveal)
  const handleMount = useMonacoEditorMountLifecycle(
    runtime,
    props,
    reveal,
    completion
  )
  useMonacoEditorDecorationLifecycle(runtime, props)
  useMonacoEditorOptionsLifecycle(runtime)

  return (
    <MonacoEditorRenderer
      props={props}
      runtime={runtime}
      contentLifecycle={content}
      comments={comments}
      handleMount={handleMount}
    />
  )
}
