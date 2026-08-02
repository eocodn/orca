import { useCallback } from 'react'
import type { OnMount } from '@monaco-editor/react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { cursorPositionCache, scrollTopCache, setWithLRU } from '@/lib/scroll-cache'
import { registerFileSearchSelectedTextProvider } from '@/lib/file-search-selection'
import { translate } from '@/i18n/i18n'
import { getMonacoCodebaseSearchQuery } from './monaco-codebase-search'
import {
  beginProgrammaticContentSync,
  endProgrammaticContentSync
} from './monaco-programmatic-sync'
import { syncContentOnMount } from './monaco-content-sync'
import { ensureMarkdownDocCompletionProvider } from './monaco-markdown-doc-completions'
import { handleMonacoLargeTextPaste } from './monaco-large-text-paste'
import { installMonacoE2EProbe } from './monaco-e2e-probe'
import { getMonacoMarkdownSelectionAnnotationTarget } from './monaco-markdown-selection-annotation'
import { createMarkdownDocLinkDecorationController } from './monaco-markdown-doc-link-decorations'
import { clampMonacoAutoHeight } from './monaco-auto-height'
import { getDiffCommentPopoverLeft } from '../diff-comments/diff-comment-popover-position'
import {
  installEditorAddReviewNoteShortcut,
  installEditorSaveShortcut,
  installMonacoEditorFindShortcut
} from './editor-shortcuts'
import { matchesPendingEditorFocusRequest } from './pending-editor-focus-request'
import type { MonacoEditorProps } from './monaco-editor-contracts'
import type { MonacoEditorRuntime } from './monaco-editor-runtime'
import type { MonacoEditorRevealLifecycle } from './monaco-editor-reveal-lifecycle'

type CompletionLifecycle = {
  updateMarkdownCompletionDocuments: () => void
}

export function useMonacoEditorMountLifecycle(
  runtime: MonacoEditorRuntime,
  props: MonacoEditorProps,
  reveal: MonacoEditorRevealLifecycle,
  completion: CompletionLifecycle
): OnMount {
  const {
    fileId,
    filePath,
    viewStateKey,
    viewStateId,
    worktreeId,
    autoHeight
  } = props
  const {
    editorRef,
    setMountedEditor,
    autoHeightLineHeight,
    setAutoHeightContentHeight,
    markdownDocLinkDecorationsRef,
    languageRef,
    contentRef,
    contentSyncModeRef,
    lastSyncedContentRef,
    setupCopy,
    propsRef,
    unregisterFileSearchSelectionRef,
    scrollThrottleTimerRef,
    setEditorCursorLine,
    setGutterMenuOpen,
    setGutterMenuPoint,
    setGutterMenuLine,
    isApplyingProgrammaticContentRef,
    isApplyingLargePasteRef,
    readOnlyRef,
    shouldShowMarkdownAnnotationsRef,
    commentPopoverRef,
    setCommentPopover,
    setSelectionAnnotationTarget,
    editorContainerRef,
    setPendingEditorReveal
  } = runtime
  const { queueReveal } = reveal
  const { updateMarkdownCompletionDocuments } = completion

  return useCallback<OnMount>(
    (editorInstance, monaco) => {
      editorRef.current = editorInstance
      setMountedEditor(editorInstance)
      const uninstallE2EProbe = installMonacoE2EProbe(editorInstance, filePath)
      let autoHeightSub: { dispose: () => void } | null = null
      let autoHeightFrame: number | null = null
      const updateAutoHeight = (): void => {
        if (!autoHeight || autoHeightFrame !== null) {
          return
        }
        autoHeightFrame = window.requestAnimationFrame(() => {
          autoHeightFrame = null
          setAutoHeightContentHeight(
            clampMonacoAutoHeight(
              Math.ceil(editorInstance.getContentHeight()) + 1,
              autoHeightLineHeight
            )
          )
        })
      }
      if (autoHeight) {
        updateAutoHeight()
        autoHeightSub = editorInstance.onDidContentSizeChange(updateAutoHeight)
      }
      markdownDocLinkDecorationsRef.current = createMarkdownDocLinkDecorationController(
        editorInstance,
        () => languageRef.current
      )
      ensureMarkdownDocCompletionProvider(monaco)
      updateMarkdownCompletionDocuments()

      beginProgrammaticContentSync(filePath)
      isApplyingProgrammaticContentRef.current = true
      try {
        const didSyncOnMount = syncContentOnMount(
          editorInstance,
          contentRef.current,
          contentSyncModeRef.current
        )
        if (didSyncOnMount) {
          lastSyncedContentRef.current = contentRef.current
        }
      } finally {
        isApplyingProgrammaticContentRef.current = false
        endProgrammaticContentSync(filePath)
      }

      setupCopy(editorInstance, monaco, filePath, propsRef)
      unregisterFileSearchSelectionRef.current?.()
      unregisterFileSearchSelectionRef.current = registerFileSearchSelectedTextProvider(() => {
        if (!editorInstance.hasTextFocus()) {
          return null
        }
        const model = editorInstance.getModel()
        const selection = editorInstance.getSelection()
        if (!model || !selection || selection.isEmpty()) {
          return null
        }
        return model.getValueInRange(selection)
      })

      const editorDomNode = editorInstance.getContainerDomNode()
      const cleanupSaveShortcut = installEditorSaveShortcut(editorDomNode, () => {
        propsRef.current.onSave(editorInstance.getValue())
      })
      const cleanupFindShortcut = installMonacoEditorFindShortcut(editorInstance)
      const cleanupAddReviewNoteShortcut = installEditorAddReviewNoteShortcut(editorDomNode, () => {
        if (commentPopoverRef.current) {
          return true
        }
        if (!shouldShowMarkdownAnnotationsRef.current) {
          return false
        }
        const target = getMonacoMarkdownSelectionAnnotationTarget(
          editorInstance,
          editorInstance.getSelection(),
          getDiffCommentPopoverLeft(editorInstance, editorContainerRef.current) ?? undefined
        )
        if (!target) {
          return false
        }
        commentPopoverRef.current = target
        setCommentPopover(target)
        setSelectionAnnotationTarget(null)
        return true
      })
      const searchInFilesAction = editorInstance.addAction({
        id: 'orca.searchInFiles',
        label: translate('auto.components.editor.MonacoEditor.fd68ae03b3', 'Search in Files'),
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 2,
        run: () => {
          if (!worktreeId) {
            return
          }
          const query = getMonacoCodebaseSearchQuery(
            editorInstance.getModel(),
            editorInstance.getSelection(),
            editorInstance.getPosition()
          )
          if (query) {
            useAppStore.getState().showRightSidebarSearch({ query })
          }
        }
      })
      const onLargeTextPaste = (event: ClipboardEvent): void => {
        handleMonacoLargeTextPaste(editorInstance, event, {
          readOnly: readOnlyRef.current,
          onPasteStart: () => {
            isApplyingLargePasteRef.current = true
          },
          onPasteResult: (result) => {
            isApplyingLargePasteRef.current = false
            if (result.status === 'pasted' || result.status === 'cancelled') {
              const value = editorInstance.getValue()
              lastSyncedContentRef.current = value
              propsRef.current.onContentChange(value)
            }
            if (result.status === 'rejected' && result.reason === 'too-large') {
              toast.error(
                translate('auto.components.editor.MonacoEditor.largePasteTooLarge', 'Paste is too large.')
              )
            }
          }
        })
      }
      editorDomNode.addEventListener('paste', onLargeTextPaste, { capture: true })

      const position = editorInstance.getPosition()
      if (position) {
        setEditorCursorLine(filePath, position.lineNumber)
      }
      const cursorPositionSub = editorInstance.onDidChangeCursorPosition((event) => {
        setEditorCursorLine(filePath, event.position.lineNumber)
        setWithLRU(cursorPositionCache, viewStateKey, {
          lineNumber: event.position.lineNumber,
          column: event.position.column
        })
      })
      const scrollStateSub = editorInstance.onDidScrollChange((event) => {
        if (scrollThrottleTimerRef.current !== null) {
          clearTimeout(scrollThrottleTimerRef.current)
        }
        scrollThrottleTimerRef.current = setTimeout(() => {
          setWithLRU(scrollTopCache, viewStateKey, event.scrollTop)
          scrollThrottleTimerRef.current = null
        }, 150)
      })
      const gutterMouseDownSub = editorInstance.onMouseDown((event) => {
        if (
          event.event.rightButton &&
          event.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
        ) {
          event.event.preventDefault()
          event.event.stopPropagation()
          const line = event.target.position?.lineNumber ?? 1
          editorInstance.setPosition({ lineNumber: line, column: 1 })
          setGutterMenuLine(line)
          setGutterMenuPoint({ x: event.event.posx, y: event.event.posy })
          setGutterMenuOpen(true)
        }
      })

      editorInstance.onDidDispose(() => {
        cursorPositionSub.dispose()
        scrollStateSub.dispose()
        gutterMouseDownSub.dispose()
        cleanupSaveShortcut()
        cleanupFindShortcut()
        cleanupAddReviewNoteShortcut()
        editorDomNode.removeEventListener('paste', onLargeTextPaste, { capture: true })
        searchInFilesAction.dispose()
        autoHeightSub?.dispose()
        if (autoHeightFrame !== null) {
          window.cancelAnimationFrame(autoHeightFrame)
        }
        uninstallE2EProbe()
        editorRef.current = null
        setMountedEditor(null)
        setCommentPopover(null)
      })

      const pendingReveal = useAppStore.getState().pendingEditorReveal
      const revealMatchesEditor = pendingReveal?.fileId
        ? pendingReveal.fileId === fileId
        : pendingReveal?.filePath === filePath
      if (pendingReveal && revealMatchesEditor) {
        queueReveal(
          editorInstance,
          pendingReveal.line,
          pendingReveal.column,
          pendingReveal.matchLength,
          () => setPendingEditorReveal(null)
        )
      } else {
        const savedCursor = cursorPositionCache.get(viewStateKey)
        const savedScrollTop = scrollTopCache.get(viewStateKey)
        if (savedCursor || savedScrollTop !== undefined) {
          requestAnimationFrame(() => {
            if (savedCursor) {
              editorInstance.setPosition(savedCursor)
            }
            if (savedScrollTop !== undefined) {
              editorInstance.setScrollTop(savedScrollTop)
            }
            editorInstance.focus()
          })
        } else {
          editorInstance.focus()
        }
      }

      const focusRequest = useAppStore.getState().pendingEditorFocusRequest
      if (focusRequest && matchesPendingEditorFocusRequest(focusRequest, { fileId, worktreeId, viewStateId })) {
        useAppStore.getState().consumeEditorFocusRequest(focusRequest.token)
      }
    },
    [
      autoHeight,
      autoHeightLineHeight,
      editorContainerRef,
      editorRef,
      fileId,
      filePath,
      isApplyingLargePasteRef,
      isApplyingProgrammaticContentRef,
      markdownDocLinkDecorationsRef,
      propsRef,
      queueReveal,
      scrollThrottleTimerRef,
      setAutoHeightContentHeight,
      setCommentPopover,
      setEditorCursorLine,
      setGutterMenuLine,
      setGutterMenuOpen,
      setGutterMenuPoint,
      setMountedEditor,
      setPendingEditorReveal,
      setSelectionAnnotationTarget,
      setupCopy,
      updateMarkdownCompletionDocuments,
      viewStateId,
      viewStateKey,
      worktreeId
    ]
  )
}
