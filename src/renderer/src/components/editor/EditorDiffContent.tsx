import React from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { translate } from '@/i18n/i18n'
import type { MarkdownViewMode, OpenFile } from '@/store/slices/editor'
import type { GitDiffResult } from '../../../../shared/types'
import { ExternalFileChangeBanner } from './ExternalFileChangeBanner'
import { getDiffContentSignature } from './diff-content-signature'

const DiffViewer = lazy(() => import('./DiffViewer'))
const MarkdownPreview = lazy(() => import('./MarkdownPreview'))
const ImageDiffViewer = lazy(() => import('./ImageDiffViewer'))

export function EditorDiffContent({
  file,
  diff,
  editContent,
  viewStateScopeId,
  diffViewStateKey,
  resolvedLanguage,
  sideBySide,
  viewMode,
  showTableOfContents,
  onCloseTableOfContents,
  markdownAnnotationsEnabled,
  previewProps,
  onContentChange,
  onSave,
  reloadContent
}: {
  file: OpenFile
  diff: GitDiffResult | undefined
  editContent: string | undefined
  viewStateScopeId: string
  diffViewStateKey: string
  resolvedLanguage: string
  sideBySide: boolean
  viewMode: MarkdownViewMode
  showTableOfContents: boolean
  onCloseTableOfContents: () => void
  markdownAnnotationsEnabled: boolean
  previewProps: Record<string, unknown>
  onContentChange: (content: string) => void
  onSave: (content: string) => Promise<boolean>
  reloadContent: (file: OpenFile) => void
}): React.JSX.Element {
  if (!diff) {
    return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">{translate('auto.components.editor.EditorContent.c88c73a0d3', 'Loading diff...')}</div>
  }
  const isEditable = file.diffSource === 'unstaged'
  if (diff.kind === 'binary') {
    if (diff.isImage) {
      return <ImageDiffViewer originalContent={diff.originalContent} modifiedContent={diff.modifiedContent} filePath={file.relativePath} mimeType={diff.mimeType} sideBySide={sideBySide} />
    }
    return (
      <div className="flex h-full items-center justify-center px-6 text-center"><div className="space-y-2">
        <div className="text-sm font-medium text-foreground">{translate('auto.components.editor.EditorContent.78541e254e', 'Binary file changed')}</div>
        <div className="text-xs text-muted-foreground">{file.diffSource === 'branch' ? translate('auto.components.editor.EditorContent.3c6e71df22', 'Text diff is unavailable for this file in branch compare.') : translate('auto.components.editor.EditorContent.8a0898ae4c', 'Text diff is unavailable for this file.')}</div>
      </div></div>
    )
  }
  const modifiedContent = editContent ?? diff.modifiedContent
  const saveAvailable = !(diff.largeDiffRenderLimit?.limited === true && editContent === undefined && diff.modifiedContent.length === 0)
  const externalBanner = file.externalMutation === 'changed' ? <ExternalFileChangeBanner file={file} currentContent={modifiedContent} reloadContent={reloadContent} /> : null
  if (isMarkdown && viewMode === 'preview' && diff.largeDiffRenderLimit?.limited !== true) {
    return (
      <div className="flex h-full min-h-0 flex-col">{externalBanner}
        <div className="border-b border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{translate('auto.components.editor.EditorContent.9640d1d3db', 'Previewing the modified version of this diff. Switch to source mode to inspect changes.')}</div>
        <div className="min-h-0 flex-1"><MarkdownPreview key={viewStateScopeId} content={modifiedContent} filePath={file.filePath} sourceFileId={file.id} sourceWorktreeId={file.worktreeId} sourceRuntimeEnvironmentId={file.runtimeEnvironmentId} scrollCacheKey={`${diffViewStateKey}:preview`} showTableOfContents={showTableOfContents} onCloseTableOfContents={onCloseTableOfContents} markdownAnnotationsEnabled={markdownAnnotationsEnabled} {...previewProps} /></div>
      </div>
    )
  }
  const reloadNonce = file.diffContentReloadNonce ?? 0
  const diffViewer = <DiffViewer key={`${viewStateScopeId}:${reloadNonce}`} modelKey={diffViewStateKey} originalModelKey={`${diffViewStateKey}:original:${getDiffContentSignature(diff.originalContent)}`} modifiedModelKey={`${diffViewStateKey}:modified:${getDiffContentSignature(diff.modifiedContent)}:${reloadNonce}`} originalContent={diff.originalContent} modifiedContent={modifiedContent} largeDiffRenderLimit={diff.largeDiffRenderLimit} largeDiffSaveContentAvailable={saveAvailable} language={resolvedLanguage} filePath={file.filePath} relativePath={file.relativePath} sideBySide={sideBySide} editable={isEditable} worktreeId={file.worktreeId} onContentChange={isEditable ? onContentChange : undefined} onSave={isEditable ? onSave : undefined} />
  if (!externalBanner) return diffViewer
  return <div className="flex h-full min-h-0 flex-col">{externalBanner}<div className="flex min-h-0 flex-1 flex-col">{diffViewer}</div></div>
}
