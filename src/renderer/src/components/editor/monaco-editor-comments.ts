import { useCallback, useEffect, useMemo } from 'react'
import type { DiffComment } from '../../../../shared/types'
import { formatMarkdownReviewNotes, type MarkdownReviewNote } from '@/lib/markdown-review-notes'
import { useDiffCommentDecorator } from '../diff-comments/useDiffCommentDecorator'
import {
  getDiffCommentPopoverLeft,
  getDiffCommentPopoverTop
} from '../diff-comments/diff-comment-popover-position'
import { getMonacoMarkdownSelectionAnnotationTarget } from './monaco-markdown-selection-annotation'
import type { MonacoEditorProps } from './monaco-editor-contracts'
import type { MonacoEditorRuntime } from './monaco-editor-runtime'
import { isMarkdownComment } from '@/lib/diff-comment-compat'

export type MonacoEditorComments = {
  markdownComments: DiffComment[]
  pendingScrollForThisEditor: string | null
  formatMarkdownCommentPrompt: (comment: DiffComment) => string
  handleSubmitMarkdownComment: (body: string) => Promise<void>
}

export function useMonacoEditorComments(
  runtime: MonacoEditorRuntime,
  props: MonacoEditorProps
): MonacoEditorComments {
  const { content, relativePath, worktreeId } = props
  const {
    allDiffComments,
    mountedEditor,
    editorContainerRef,
    shouldShowMarkdownAnnotations,
    commentPopover,
    setCommentPopover,
    setSelectionAnnotationTarget,
    commentPopoverRef,
    setScrollToDiffCommentId,
    scrollToDiffCommentId,
    addDiffComment,
    deleteDiffComment,
    updateDiffComment
  } = runtime
  const markdownComments = useMemo(
    () =>
      (allDiffComments ?? []).filter((comment) => {
        return comment.filePath === relativePath && isMarkdownComment(comment)
      }),
    [allDiffComments, relativePath]
  )
  const pendingScrollForThisEditor = useMemo(() => {
    if (!shouldShowMarkdownAnnotations || !scrollToDiffCommentId) {
      return null
    }
    return markdownComments.some((comment) => comment.id === scrollToDiffCommentId)
      ? scrollToDiffCommentId
      : null
  }, [markdownComments, scrollToDiffCommentId, shouldShowMarkdownAnnotations])
  const formatMarkdownCommentPrompt = useCallback(
    (comment: DiffComment) => formatMarkdownReviewNotes([comment as MarkdownReviewNote], content),
    [content]
  )

  useDiffCommentDecorator({
    editor: shouldShowMarkdownAnnotations ? mountedEditor : null,
    filePath: relativePath,
    worktreeId: worktreeId ?? '',
    comments: shouldShowMarkdownAnnotations ? markdownComments : [],
    onAddCommentClick: ({ lineNumber, startLine, top }) => {
      setSelectionAnnotationTarget(null)
      setCommentPopover({
        lineNumber,
        startLine,
        top,
        left: mountedEditor
          ? (getDiffCommentPopoverLeft(mountedEditor, editorContainerRef.current) ?? undefined)
          : undefined
      })
    },
    onDeleteComment: (id) => {
      if (worktreeId) {
        void deleteDiffComment(worktreeId, id)
      }
    },
    onUpdateComment: worktreeId ? (id, body) => updateDiffComment(worktreeId, id, body) : undefined,
    formatCommentPrompt: formatMarkdownCommentPrompt,
    pendingScrollCommentId: pendingScrollForThisEditor,
    onPendingScrollConsumed: () => setScrollToDiffCommentId(null)
  })

  useEffect(() => {
    if (!mountedEditor || !commentPopover) {
      return
    }
    const update = (): void => {
      const top = getDiffCommentPopoverTop(mountedEditor, commentPopover.lineNumber, undefined)
      const left = getDiffCommentPopoverLeft(mountedEditor, editorContainerRef.current)
      setCommentPopover((previous) =>
        previous
          ? { ...previous, top: top ?? previous.top, left: left == null ? previous.left : left }
          : previous
      )
    }
    const scrollSub = mountedEditor.onDidScrollChange(update)
    const contentSub = mountedEditor.onDidContentSizeChange(update)
    const layoutSub = mountedEditor.onDidLayoutChange(update)
    return () => {
      scrollSub.dispose()
      contentSub.dispose()
      layoutSub.dispose()
    }
  }, [commentPopover?.lineNumber, editorContainerRef, mountedEditor, setCommentPopover])

  useEffect(() => {
    if (!mountedEditor || !shouldShowMarkdownAnnotations || commentPopover) {
      setSelectionAnnotationTarget(null)
      return
    }
    const update = (): void => {
      const left = getDiffCommentPopoverLeft(mountedEditor, editorContainerRef.current)
      setSelectionAnnotationTarget(
        getMonacoMarkdownSelectionAnnotationTarget(
          mountedEditor,
          mountedEditor.getSelection(),
          left ?? undefined
        )
      )
    }
    update()
    const selectionSub = mountedEditor.onDidChangeCursorSelection(update)
    const scrollSub = mountedEditor.onDidScrollChange(update)
    const layoutSub = mountedEditor.onDidLayoutChange(update)
    return () => {
      selectionSub.dispose()
      scrollSub.dispose()
      layoutSub.dispose()
    }
  }, [commentPopover, editorContainerRef, mountedEditor, setSelectionAnnotationTarget, shouldShowMarkdownAnnotations])

  const handleSubmitMarkdownComment = useCallback(
    async (body: string): Promise<void> => {
      if (!commentPopover || !worktreeId) {
        return
      }
      const result = await addDiffComment({
        worktreeId,
        filePath: relativePath,
        source: 'markdown',
        startLine: commentPopover.startLine,
        lineNumber: commentPopover.lineNumber,
        selectedText: commentPopover.selectedText,
        body,
        side: 'modified'
      })
      if (result) {
        commentPopoverRef.current = null
        setCommentPopover(null)
      } else {
        console.error('Failed to add markdown comment — draft preserved')
      }
    },
    [addDiffComment, commentPopover, commentPopoverRef, relativePath, setCommentPopover, worktreeId]
  )

  return {
    markdownComments,
    pendingScrollForThisEditor,
    formatMarkdownCommentPrompt,
    handleSubmitMarkdownComment
  }
}
