import React from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { Plus } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { isLinuxUserAgent } from '../terminal-pane/pane-helpers'
import { DiffCommentPopover } from '../diff-comments/DiffCommentPopover'
import { buildFileEditorWordWrapOptions } from './file-editor-word-wrap-options'
import { monacoFindOptions } from './monaco-find-options'
import { MonacoGutterContextMenu } from './MonacoGutterContextMenu'
import type { MonacoEditorProps } from './monaco-editor-contracts'
import type { MonacoEditorRuntime } from './monaco-editor-runtime'
import type { MonacoEditorComments } from './monaco-editor-comments'

export function MonacoEditorRenderer({
  props,
  runtime,
  contentLifecycle,
  comments,
  handleMount
}: {
  props: MonacoEditorProps
  runtime: MonacoEditorRuntime
  contentLifecycle: { handleChange: (value: string | undefined) => void }
  comments: MonacoEditorComments
  handleMount: OnMount
}): React.JSX.Element {
  const { content, filePath, language, relativePath, readOnly } = props
  const {
    editorContainerRef,
    renderedEditorHeight,
    commentPopover,
    shouldShowMarkdownAnnotations,
    setCommentPopover,
    selectionAnnotationTarget,
    setSelectionAnnotationTarget,
    isDark,
    settings,
    editorWordWrap,
    editorFontSize,
    editorFontFamily,
    autoHeight,
    autoHeightUsesInternalScroll,
    toastNode,
    gutterMenuOpen,
    setGutterMenuOpen,
    gutterMenuPoint,
    gutterMenuLine
  } = runtime

  return (
    <div
      ref={editorContainerRef}
      className={autoHeight ? 'relative' : 'relative h-full'}
      style={renderedEditorHeight === null ? undefined : { height: renderedEditorHeight }}
    >
      {commentPopover && shouldShowMarkdownAnnotations && (
        <DiffCommentPopover
          key={commentPopover.lineNumber}
          lineNumber={commentPopover.lineNumber}
          startLine={commentPopover.startLine}
          top={commentPopover.top}
          left={commentPopover.left}
          onCancel={() => setCommentPopover(null)}
          onSubmit={comments.handleSubmitMarkdownComment}
        />
      )}
      {selectionAnnotationTarget && shouldShowMarkdownAnnotations && !commentPopover ? (
        <button
          type="button"
          className="orca-diff-comment-add-btn"
          style={{
            display: 'flex',
            top: Math.max(4, selectionAnnotationTarget.top - 22),
            left: selectionAnnotationTarget.left ?? 4
          }}
          title={translate('auto.components.editor.MonacoEditor.68cb83f4a7', 'Add note on selected text')}
          aria-label={translate('auto.components.editor.MonacoEditor.68cb83f4a7', 'Add note on selected text')}
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setCommentPopover(selectionAnnotationTarget)
            setSelectionAnnotationTarget(null)
          }}
        >
          <Plus className="size-3" />
        </button>
      ) : null}
      <Editor
        height={renderedEditorHeight === null ? '100%' : `${renderedEditorHeight}px`}
        language={language}
        defaultValue={content}
        theme={isDark ? 'vs-dark' : 'vs'}
        onChange={contentLifecycle.handleChange}
        onMount={handleMount}
        options={{
          minimap: { enabled: settings?.editorMinimapEnabled ?? false },
          scrollBeyondLastLine: false,
          ...buildFileEditorWordWrapOptions(editorWordWrap),
          fontSize: editorFontSize,
          fontFamily: editorFontFamily,
          lineNumbers: 'on',
          renderLineHighlight: 'line',
          automaticLayout: true,
          tabSize: 2,
          readOnly,
          scrollbar: autoHeight
            ? {
                vertical: autoHeightUsesInternalScroll ? 'auto' : 'hidden',
                handleMouseWheel: autoHeightUsesInternalScroll
              }
            : undefined,
          smoothScrolling: true,
          cursorSmoothCaretAnimation: 'off',
          padding: { top: 0 },
          find: monacoFindOptions,
          selectionClipboard: settings?.primarySelectionMiddleClickPaste ?? isLinuxUserAgent()
        }}
        path={filePath}
        saveViewState={false}
        keepCurrentModel
      />
      {toastNode}
      <MonacoGutterContextMenu
        open={gutterMenuOpen}
        onOpenChange={setGutterMenuOpen}
        point={gutterMenuPoint}
        line={gutterMenuLine}
        filePath={filePath}
        relativePath={relativePath}
      />
    </div>
  )
}
