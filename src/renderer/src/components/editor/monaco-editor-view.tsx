// Concrete surface implementation for MonacoEditor.tsx
/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: selection annotations are synchronized from Monaco editor selection and layout APIs, not derived React props. */
import React, { useRef, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { toast } from 'sonner'
import type { DiffComment } from '../../../../shared/types'
import { useAppStore } from '@/store'
import { scrollTopCache, cursorPositionCache, setWithLRU } from '@/lib/scroll-cache'
import '@/lib/monaco-setup'
import { computeEditorFontSize, resolveEditorFontFamily } from '@/lib/editor-font-zoom'
import { registerFileSearchSelectedTextProvider } from '@/lib/file-search-selection'

import { useContextualCopySetup } from './useContextualCopySetup'
import { MAX_REVEAL_CONTENT_WAIT_FRAMES, performReveal } from './monaco-reveal'
import {
  syncContentOnMount,
  syncContentUpdate,
  type MonacoContentSyncMode
} from './monaco-content-sync'
import { getMonacoCodebaseSearchQuery } from './monaco-codebase-search'
import {
  beginProgrammaticContentSync,
  endProgrammaticContentSync,
  shouldIgnoreMonacoContentChange
} from './monaco-programmatic-sync'
import {
  clearMarkdownDocCompletionDocuments,
  ensureMarkdownDocCompletionProvider,
  setMarkdownDocCompletionDocuments
} from './monaco-markdown-doc-completions'
import { MonacoGutterContextMenu } from './MonacoGutterContextMenu'
import {
  createMarkdownDocLinkDecorationController,
  type MarkdownDocLinkDecorationController
} from './monaco-markdown-doc-link-decorations'
import { buildGitConflictDecorations, hasGitConflictMarkers } from './monaco-conflict-decorations'
import { selectWorktreeDiffComments } from '@/store/worktree-diff-comments-selector'
import { isMarkdownComment } from '@/lib/diff-comment-compat'
import { formatMarkdownReviewNotes, type MarkdownReviewNote } from '@/lib/markdown-review-notes'
import { useDiffCommentDecorator } from '../diff-comments/useDiffCommentDecorator'
import { DiffCommentPopover } from '../diff-comments/DiffCommentPopover'
import {
  getDiffCommentPopoverLeft,
  getDiffCommentPopoverTop
} from '../diff-comments/diff-comment-popover-position'
import { isLinuxUserAgent } from '../terminal-pane/pane-helpers'
import {
  installEditorAddReviewNoteShortcut,
  installEditorSaveShortcut,
  installMonacoEditorFindShortcut
} from './editor-shortcuts'
import { Plus } from 'lucide-react'
import {
  getMonacoMarkdownSelectionAnnotationTarget,
  type MonacoMarkdownSelectionAnnotationTarget
} from './monaco-markdown-selection-annotation'
import { translate } from '@/i18n/i18n'
import { handleMonacoLargeTextPaste } from './monaco-large-text-paste'
import { buildFileEditorWordWrapOptions } from './file-editor-word-wrap-options'
import {
  clampMonacoAutoHeight,
  getMonacoAutoHeightForContent,
  isMonacoAutoHeightCapped
} from './monaco-auto-height'
import { installMonacoE2EProbe } from './monaco-e2e-probe'
import { monacoFindOptions } from './monaco-find-options'
import { matchesPendingEditorFocusRequest } from './pending-editor-focus-request'
import type {
  MarkdownCommentPopoverState,
  MonacoEditorProps
} from './monaco-editor-contracts'


export function MonacoEditorView({ context }: { context: Record<string, any> }): React.JSX.Element {
  const {
    addDiffComment,
    allDiffComments,
    autoHeight,
    autoHeightContentHeight,
    autoHeightLineHeight,
    autoHeightUsesInternalScroll,
    cancelScheduledReveal,
    cleanupAddReviewNoteShortcut,
    cleanupFindShortcut,
    cleanupSaveShortcut,
    clearTransientRevealHighlight,
    commentPopover,
    commentPopoverRef,
    conflictDecorationsEnabled,
    conflictDecorationsRef,
    content,
    contentRef,
    contentSub,
    contentSyncModeRef,
    cursorPositionSub,
    decorations,
    deleteDiffComment,
    didSyncOnMount,
    ed,
    editorContainerRef,
    editorDomNode,
    editorFontFamily,
    editorFontSize,
    editorFontZoomLevel,
    editorRef,
    editorWordWrap,
    estimatedAutoHeight,
    fileId,
    filePath,
    focusRequest,
    formatMarkdownCommentPrompt,
    gutterMenuLine,
    gutterMenuOpen,
    gutterMenuPoint,
    gutterMouseDownSub,
    handleChange,
    handleMount,
    handleSubmitMarkdownComment,
    isApplyingLargePasteRef,
    isApplyingProgrammaticContentRef,
    isDark,
    language,
    languageRef,
    lastSyncedContentRef,
    layoutSub,
    left,
    line,
    liveTail,
    markdownAnnotationsEnabled,
    markdownComments,
    markdownDocLinkDecorationsRef,
    markdownDocuments,
    model,
    modelKey,
    modelKeyRef,
    modelLineCount,
    mountedEditor,
    onContentChange,
    onLargeTextPaste,
    onSave,
    pendingScrollForThisEditor,
    pos,
    propsRef,
    query,
    queueReveal,
    readOnly,
    readOnlyRef,
    relativePath,
    renderedEditorHeight,
    result,
    reveal,
    revealColumn,
    revealDecorationRef,
    revealHighlightTimerRef,
    revealInnerRafRef,
    revealLine,
    revealMatchLength,
    revealMatchesEditor,
    revealRafRef,
    savedCursor,
    savedScrollTop,
    schedule,
    scrollStateSub,
    scrollSub,
    scrollThrottleTimerRef,
    scrollToDiffCommentId,
    searchInFilesAction,
    selection,
    selectionAnnotationTarget,
    selectionSub,
    setAutoHeightContentHeight,
    setCommentPopover,
    setEditorCursorLine,
    setGutterMenuLine,
    setGutterMenuOpen,
    setGutterMenuPoint,
    setMountedEditor,
    setPendingEditorReveal,
    setScrollToDiffCommentId,
    setSelectionAnnotationTarget,
    settings,
    shouldShowMarkdownAnnotations,
    shouldShowMarkdownAnnotationsRef,
    state,
    target,
    top,
    uninstallE2EProbe,
    unregisterFileSearchSelectionRef,
    update,
    updateAutoHeight,
    updateDiffComment,
    updateMarkdownCompletionDocuments,
    value,
    viewStateId,
    viewStateKey,
    worktreeId,
  } = context

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
          onSubmit={handleSubmitMarkdownComment}
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
          title={translate(
            'auto.components.editor.MonacoEditor.68cb83f4a7',
            'Add note on selected text'
          )}
          aria-label={translate(
            'auto.components.editor.MonacoEditor.68cb83f4a7',
            'Add note on selected text'
          )}
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
        // Why: defaultValue, not controlled value — Orca owns post-mount content sync; a controlled path would double setValue.
        defaultValue={content}
        theme={isDark ? 'vs-dark' : 'vs'}
        onChange={handleChange}
        onMount={handleMount}
        options={{
          // Why: only the file editor honors this; Monaco 0.55 DiffEditor hard-overrides minimap.enabled=false on sub-editors (see diffEditorEditors._adjustOptionsForSubEditor).
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
          // Why: Monaco owns its rendered line surface, so align its selection-clipboard with the app opt-out (the global DOM hook can't).
          selectionClipboard: settings?.primarySelectionMiddleClickPaste ?? isLinuxUserAgent()
        }}
        path={filePath}
        // Why: Orca owns cursor/scroll restoration, so disable @monaco-editor/react's competing view-state Map.
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

