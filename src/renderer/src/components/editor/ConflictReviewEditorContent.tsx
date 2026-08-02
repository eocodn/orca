import React from 'react'
import { detectLanguage } from '@/lib/language-detect'
import { translate } from '@/i18n/i18n'
import type { MarkdownViewMode, OpenFile, PendingEditorReveal } from '@/store/slices/editor'
import type { GitStatusEntry } from '../../../../shared/types'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConflictBanner, ConflictPlaceholderView } from './ConflictComponents'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'

const MonacoEditor = lazy(() => import('./MonacoEditor'))
const ImageViewer = lazy(() => import('./ImageViewer'))

export type ConflictReviewFileContent = {
  content: string
  isBinary: boolean
  isImage?: boolean
  mimeType?: string
  loadError?: string
}

function matchesPendingEditorReveal(
  reveal: PendingEditorReveal | null,
  file: Pick<OpenFile, 'id' | 'filePath'>
): reveal is PendingEditorReveal {
  return Boolean(reveal && (reveal.fileId ? reveal.fileId === file.id : reveal.filePath === file.filePath))
}

export function EditorFileLoadErrorView({
  message,
  onRetry
}: {
  message: string
  onRetry: () => void
}): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center bg-editor-surface p-6 text-sm text-muted-foreground">
      <div className="flex max-w-xl items-start gap-3 rounded-md border border-border bg-background p-4">
        <AlertCircle className="mt-0.5 size-4 flex-shrink-0 text-destructive" />
        <div className="min-w-0">
          <div className="font-medium text-foreground">
            {translate('auto.components.editor.EditorContent.39f018b052', 'Unable to load file')}
          </div>
          <div className="mt-1 break-words">{message}</div>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            <RefreshCw className="size-3.5" />
            {translate('auto.components.editor.EditorContent.2a512bb46a', 'Retry')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function ConflictReviewEditorContent({
  contentFile,
  entry,
  className,
  viewStateScopeId,
  viewStateKeySuffix,
  fileContents,
  editBuffers,
  pendingEditorReveal,
  readOnly = false,
  autoHeight = false,
  onRetry,
  onContentChange,
  onSave,
  getConflictNavigation
}: {
  contentFile: OpenFile
  entry: GitStatusEntry | null
  className: string
  viewStateScopeId: string
  viewStateKeySuffix: string
  fileContents: Record<string, ConflictReviewFileContent>
  editBuffers: Record<string, string>
  pendingEditorReveal: PendingEditorReveal | null
  readOnly?: boolean
  autoHeight?: boolean
  onRetry: (file: OpenFile) => void
  onContentChange: (file: OpenFile, content: string) => void
  onSave: (file: OpenFile, content: string) => Promise<boolean>
  getConflictNavigation: (file: OpenFile, content: string) => {
    currentIndex: number | null
    total: number
    onJump: (direction: 'previous' | 'next') => void
  } | undefined
}): React.JSX.Element {
  if (contentFile.conflict?.kind === 'conflict-placeholder') {
    return <div className={className}><ConflictPlaceholderView file={contentFile} /></div>
  }

  const fileContent = fileContents[contentFile.id]
  if (!fileContent) {
    return <div className={className}><div className="flex h-full items-center justify-center text-sm text-muted-foreground">{translate('auto.components.editor.EditorContent.b2735221f5', 'Loading...')}</div></div>
  }
  if (fileContent.loadError) {
    return <div className={className}><EditorFileLoadErrorView message={fileContent.loadError} onRetry={() => onRetry(contentFile)} /></div>
  }
  if (fileContent.isBinary) {
    if (fileContent.isImage) {
      return <div className={className}><ImageViewer content={fileContent.content} filePath={contentFile.filePath} mimeType={fileContent.mimeType} /></div>
    }
    return <div className={className}><div className="flex h-full items-center justify-center text-sm text-muted-foreground">{translate('auto.components.editor.EditorContent.b9de81ba52', 'Binary file — cannot display')}</div></div>
  }

  const language = detectLanguage(contentFile.relativePath)
  const monacoLanguage = language === 'notebook' ? 'json' : language
  const selectedContent = editBuffers[contentFile.id] ?? fileContent.content
  return (
    <div className={className}>
      {contentFile.conflict && <ConflictBanner file={contentFile} entry={entry} conflictNavigation={getConflictNavigation(contentFile, selectedContent)} />}
      <div className={autoHeight ? 'shrink-0' : 'min-h-0 flex-1'}>
        <MonacoEditor
          key={`${viewStateScopeId}:${contentFile.id}:${viewStateKeySuffix}`}
          fileId={contentFile.id}
          filePath={contentFile.filePath}
          viewStateKey={`${contentFile.filePath}::${viewStateScopeId}:${viewStateKeySuffix}`}
          relativePath={contentFile.relativePath}
          content={selectedContent}
          language={monacoLanguage}
          onContentChange={readOnly ? () => {} : (content) => onContentChange(contentFile, content)}
          onSave={readOnly ? () => {} : (content) => onSave(contentFile, content)}
          worktreeId={contentFile.worktreeId}
          markdownAnnotationsEnabled={false}
          conflictDecorationsEnabled={contentFile.conflict?.conflictStatus === 'unresolved'}
          readOnly={readOnly}
          autoHeight={autoHeight}
          revealLine={matchesPendingEditorReveal(pendingEditorReveal, contentFile) ? pendingEditorReveal.line : undefined}
          revealColumn={matchesPendingEditorReveal(pendingEditorReveal, contentFile) ? pendingEditorReveal.column : undefined}
          revealMatchLength={matchesPendingEditorReveal(pendingEditorReveal, contentFile) ? pendingEditorReveal.matchLength : undefined}
        />
      </div>
    </div>
  )
}
