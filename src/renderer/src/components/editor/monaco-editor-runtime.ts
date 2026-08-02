import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import type { editor } from 'monaco-editor'
import type { DiffComment } from '../../../../shared/types'
import { useAppStore } from '@/store'
import { computeEditorFontSize, resolveEditorFontFamily } from '@/lib/editor-font-zoom'
import type { MarkdownCommentPopoverState, MonacoEditorProps } from './monaco-editor-contracts'
import type { MonacoContentSyncMode } from './monaco-content-sync'
import type { MarkdownDocLinkDecorationController } from './monaco-markdown-doc-link-decorations'
import type { MonacoMarkdownSelectionAnnotationTarget } from './monaco-markdown-selection-annotation'
import { selectWorktreeDiffComments } from '@/store/worktree-diff-comments-selector'
import { getMonacoAutoHeightForContent, isMonacoAutoHeightCapped } from './monaco-auto-height'
import { useContextualCopySetup } from './useContextualCopySetup'

export type MonacoAppState = ReturnType<typeof useAppStore.getState>

export type MonacoEditorRuntime = {
  editorRef: React.MutableRefObject<editor.IStandaloneCodeEditor | null>
  editorContainerRef: React.MutableRefObject<HTMLDivElement | null>
  mountedEditor: editor.IStandaloneCodeEditor | null
  setMountedEditor: React.Dispatch<React.SetStateAction<editor.IStandaloneCodeEditor | null>>
  autoHeightContentHeight: number | null
  setAutoHeightContentHeight: React.Dispatch<React.SetStateAction<number | null>>
  modelKeyRef: React.MutableRefObject<string | null>
  languageRef: React.MutableRefObject<string>
  markdownDocLinkDecorationsRef: React.MutableRefObject<MarkdownDocLinkDecorationController | null>
  conflictDecorationsRef: React.MutableRefObject<editor.IEditorDecorationsCollection | null>
  revealDecorationRef: React.MutableRefObject<editor.IEditorDecorationsCollection | null>
  revealHighlightTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
  revealRafRef: React.MutableRefObject<number | null>
  revealInnerRafRef: React.MutableRefObject<number | null>
  unregisterFileSearchSelectionRef: React.MutableRefObject<(() => void) | null>
  scrollThrottleTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
  propsRef: React.MutableRefObject<{
    relativePath: string
    language: string
    onSave: (content: string) => void
    onContentChange: (content: string) => void
  }>
  readOnlyRef: React.MutableRefObject<boolean>
  contentSyncModeRef: React.MutableRefObject<MonacoContentSyncMode>
  contentRef: React.MutableRefObject<string>
  lastSyncedContentRef: React.MutableRefObject<string>
  isApplyingProgrammaticContentRef: React.MutableRefObject<boolean>
  isApplyingLargePasteRef: React.MutableRefObject<boolean>
  settings: MonacoAppState['settings']
  editorFontZoomLevel: MonacoAppState['editorFontZoomLevel']
  setPendingEditorReveal: MonacoAppState['setPendingEditorReveal']
  setEditorCursorLine: MonacoAppState['setEditorCursorLine']
  addDiffComment: MonacoAppState['addDiffComment']
  deleteDiffComment: MonacoAppState['deleteDiffComment']
  updateDiffComment: MonacoAppState['updateDiffComment']
  scrollToDiffCommentId: MonacoAppState['scrollToDiffCommentId']
  setScrollToDiffCommentId: MonacoAppState['setScrollToDiffCommentId']
  allDiffComments: DiffComment[] | undefined
  editorFontSize: number
  editorFontFamily: string
  editorWordWrap: NonNullable<MonacoAppState['settings']>['editorWordWrap']
  estimatedAutoHeight: number | null
  renderedEditorHeight: number | null
  autoHeightLineHeight: number
  autoHeightUsesInternalScroll: boolean
  gutterMenuOpen: boolean
  setGutterMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  gutterMenuPoint: { x: number; y: number }
  setGutterMenuPoint: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>
  gutterMenuLine: number
  setGutterMenuLine: React.Dispatch<React.SetStateAction<number>>
  commentPopover: MarkdownCommentPopoverState | null
  setCommentPopover: React.Dispatch<React.SetStateAction<MarkdownCommentPopoverState | null>>
  commentPopoverRef: React.MutableRefObject<MarkdownCommentPopoverState | null>
  selectionAnnotationTarget: MonacoMarkdownSelectionAnnotationTarget | null
  setSelectionAnnotationTarget: React.Dispatch<
    React.SetStateAction<MonacoMarkdownSelectionAnnotationTarget | null>
  >
  isDark: boolean
  shouldShowMarkdownAnnotations: boolean
  shouldShowMarkdownAnnotationsRef: React.MutableRefObject<boolean>
  setupCopy: ReturnType<typeof useContextualCopySetup>['setupCopy']
  toastNode: React.ReactNode
}

export function useMonacoEditorRuntime(props: MonacoEditorProps): MonacoEditorRuntime {
  const {
    relativePath,
    content,
    language,
    onContentChange,
    onSave,
    worktreeId,
    markdownAnnotationsEnabled,
    readOnly,
    liveTail,
    autoHeight
  } = props
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const editorContainerRef = useRef<HTMLDivElement | null>(null)
  const [mountedEditor, setMountedEditor] = useState<editor.IStandaloneCodeEditor | null>(null)
  const [autoHeightContentHeight, setAutoHeightContentHeight] = useState<number | null>(null)
  const modelKeyRef = useRef<string | null>(null)
  const languageRef = useRef(language)
  languageRef.current = language
  const markdownDocLinkDecorationsRef = useRef<MarkdownDocLinkDecorationController | null>(null)
  const conflictDecorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null)
  const revealDecorationRef = useRef<editor.IEditorDecorationsCollection | null>(null)
  const revealHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const revealRafRef = useRef<number | null>(null)
  const revealInnerRafRef = useRef<number | null>(null)
  const unregisterFileSearchSelectionRef = useRef<(() => void) | null>(null)
  const scrollThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const propsRef = useRef({ relativePath, language, onSave, onContentChange })
  propsRef.current = { relativePath, language, onSave, onContentChange }
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const contentSyncModeRef = useRef<MonacoContentSyncMode>('undoable')
  contentSyncModeRef.current = readOnly && liveTail ? 'read-only-live-tail' : 'undoable'
  const contentRef = useRef(content)
  contentRef.current = content
  const lastSyncedContentRef = useRef(content)
  const isApplyingProgrammaticContentRef = useRef(false)
  const isApplyingLargePasteRef = useRef(false)
  const settings = useAppStore((state) => state.settings)
  const editorFontZoomLevel = useAppStore((state) => state.editorFontZoomLevel)
  const setPendingEditorReveal = useAppStore((state) => state.setPendingEditorReveal)
  const setEditorCursorLine = useAppStore((state) => state.setEditorCursorLine)
  const addDiffComment = useAppStore((state) => state.addDiffComment)
  const deleteDiffComment = useAppStore((state) => state.deleteDiffComment)
  const updateDiffComment = useAppStore((state) => state.updateDiffComment)
  const scrollToDiffCommentId = useAppStore((state) => state.scrollToDiffCommentId)
  const setScrollToDiffCommentId = useAppStore((state) => state.setScrollToDiffCommentId)
  const allDiffComments = useAppStore((state): DiffComment[] | undefined =>
    selectWorktreeDiffComments(state, worktreeId)
  )
  const editorFontSize = computeEditorFontSize(settings?.terminalFontSize ?? 13, editorFontZoomLevel)
  const editorFontFamily = resolveEditorFontFamily(settings)
  const editorWordWrap = settings?.editorWordWrap
  const estimatedAutoHeight = useMemo(() => {
    if (!autoHeight) {
      return null
    }
    return getMonacoAutoHeightForContent(content, Math.ceil(editorFontSize * 1.45))
  }, [autoHeight, content, editorFontSize])
  const renderedEditorHeight = autoHeight
    ? (autoHeightContentHeight ?? estimatedAutoHeight ?? 80)
    : null
  const autoHeightLineHeight = Math.ceil(editorFontSize * 1.45)
  const autoHeightUsesInternalScroll =
    autoHeight && isMonacoAutoHeightCapped(renderedEditorHeight, autoHeightLineHeight)
  const [gutterMenuOpen, setGutterMenuOpen] = useState(false)
  const [gutterMenuPoint, setGutterMenuPoint] = useState({ x: 0, y: 0 })
  const [gutterMenuLine, setGutterMenuLine] = useState(1)
  const [commentPopover, setCommentPopover] = useState<MarkdownCommentPopoverState | null>(null)
  const [selectionAnnotationTarget, setSelectionAnnotationTarget] =
    useState<MonacoMarkdownSelectionAnnotationTarget | null>(null)
  const commentPopoverRef = useRef<MarkdownCommentPopoverState | null>(null)
  useEffect(() => {
    commentPopoverRef.current = commentPopover
  }, [commentPopover])
  const isDark =
    settings?.theme === 'dark' ||
    (settings?.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const shouldShowMarkdownAnnotations =
    Boolean(markdownAnnotationsEnabled) && language === 'markdown' && Boolean(worktreeId)
  const shouldShowMarkdownAnnotationsRef = useRef(shouldShowMarkdownAnnotations)
  useEffect(() => {
    shouldShowMarkdownAnnotationsRef.current = shouldShowMarkdownAnnotations
  }, [shouldShowMarkdownAnnotations])
  const { setupCopy, toastNode } = useContextualCopySetup()

  return {
    editorRef,
    editorContainerRef,
    mountedEditor,
    setMountedEditor,
    autoHeightContentHeight,
    setAutoHeightContentHeight,
    modelKeyRef,
    languageRef,
    markdownDocLinkDecorationsRef,
    conflictDecorationsRef,
    revealDecorationRef,
    revealHighlightTimerRef,
    revealRafRef,
    revealInnerRafRef,
    unregisterFileSearchSelectionRef,
    scrollThrottleTimerRef,
    propsRef,
    readOnlyRef,
    contentSyncModeRef,
    contentRef,
    lastSyncedContentRef,
    isApplyingProgrammaticContentRef,
    isApplyingLargePasteRef,
    settings,
    editorFontZoomLevel,
    setPendingEditorReveal,
    setEditorCursorLine,
    addDiffComment,
    deleteDiffComment,
    updateDiffComment,
    scrollToDiffCommentId,
    setScrollToDiffCommentId,
    allDiffComments,
    editorFontSize,
    editorFontFamily,
    editorWordWrap,
    estimatedAutoHeight,
    renderedEditorHeight,
    autoHeightLineHeight,
    autoHeightUsesInternalScroll,
    gutterMenuOpen,
    setGutterMenuOpen,
    gutterMenuPoint,
    setGutterMenuPoint,
    gutterMenuLine,
    setGutterMenuLine,
    commentPopover,
    setCommentPopover,
    commentPopoverRef,
    selectionAnnotationTarget,
    setSelectionAnnotationTarget,
    isDark,
    shouldShowMarkdownAnnotations,
    shouldShowMarkdownAnnotationsRef,
    setupCopy,
    toastNode
  }
}
