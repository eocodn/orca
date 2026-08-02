import React from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import type { MarkdownViewMode, OpenFile } from '@/store/slices/editor'
import { extractFrontMatter, prependFrontMatter } from './markdown-frontmatter'
import { getMarkdownRenderMode } from './markdown-render-mode'
import { getMarkdownRichModeUnsupportedMessage } from './markdown-rich-mode'
import { exceedsMarkdownRichModeSizeLimit } from './markdown-rich-size-limit'
import { RichMarkdownErrorBoundary } from './RichMarkdownErrorBoundary'
import { translate } from '@/i18n/i18n'

const RichMarkdownEditor = lazy(() => import('./RichMarkdownEditor'))
const MarkdownPreview = lazy(() => import('./MarkdownPreview'))

export function MarkdownFrontMatterBanner({ raw }: { raw: string }): React.JSX.Element {
  const inner = raw
    .replace(/^(?:---|\+\+\+)\r?\n/, '')
    .replace(/\r?\n(?:---|\+\+\+)\r?\n?$/, '')
    .trim()
  return (
    <div className="border-b border-border/60 bg-muted/40 px-3 py-2">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {translate('auto.components.editor.EditorContent.e4b074749d', 'Front Matter')}
        <span className="ml-2 font-normal normal-case tracking-normal opacity-70">
          {translate('auto.components.editor.EditorContent.56dba34e1a', '(edit in source mode)')}
        </span>
      </div>
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground font-mono scrollbar-editor">{inner}</pre>
    </div>
  )
}

export function MarkdownEditorContent({
  file,
  fileContent,
  editContent,
  viewMode,
  viewStateScopeId,
  editorViewStateKey,
  showTableOfContents,
  showFrontmatter,
  onCloseTableOfContents,
  markdownAnnotationsEnabled,
  onContentChange,
  onDirtyStateHint,
  onSave,
  markdownDocuments,
  onOpenDocLink,
  previewProps,
  sourceLineOffset,
  renderSource
}: {
  file: OpenFile
  fileContent: string
  editContent: string | undefined
  viewMode: MarkdownViewMode
  viewStateScopeId: string
  editorViewStateKey: string
  showTableOfContents: boolean
  showFrontmatter: boolean
  onCloseTableOfContents: () => void
  markdownAnnotationsEnabled: boolean
  onContentChange: (content: string) => void
  onDirtyStateHint: (dirty: boolean) => void
  onSave: (content: string) => Promise<boolean>
  markdownDocuments: React.ComponentProps<typeof RichMarkdownEditor>['markdownDocuments']
  onOpenDocLink: React.ComponentProps<typeof RichMarkdownEditor>['onOpenDocLink']
  previewProps: Record<string, unknown>
  sourceLineOffset: (raw: string) => number
  renderSource: () => React.JSX.Element
}): React.JSX.Element {
  const currentContent = editContent ?? fileContent
  const richModeUnsupportedMessage = getMarkdownRichModeUnsupportedMessage(currentContent)
  const renderMode = getMarkdownRenderMode({
    exceedsRichModeSizeLimit: exceedsMarkdownRichModeSizeLimit(currentContent),
    hasRichModeUnsupportedContent: richModeUnsupportedMessage !== null,
    viewMode
  })

  if (file.conflict?.conflictStatus === 'unresolved') {
    return <div className="h-full min-h-0">{renderSource()}</div>
  }
  if (renderMode === 'source' && viewMode === 'rich') {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-border/60 bg-blue-500/10 px-3 py-2 text-xs text-blue-950 dark:text-blue-100">
          {richModeUnsupportedMessage ?? 'File is too large for rich editing. Showing source mode instead.'}
        </div>
        <div className="min-h-0 flex-1 h-full">{renderSource()}</div>
      </div>
    )
  }
  if (renderMode === 'rich-editor') {
    const frontMatter = extractFrontMatter(currentContent)
    const editorContent = frontMatter ? frontMatter.body : currentContent
    const change = frontMatter ? (body: string) => onContentChange(prependFrontMatter(frontMatter.raw, body)) : onContentChange
    const save = frontMatter ? (body: string) => onSave(prependFrontMatter(frontMatter.raw, body)) : onSave
    return (
      <div className="flex h-full min-h-0 flex-col"><div className="min-h-0 flex-1">
        <RichMarkdownErrorBoundary key={viewStateScopeId} fileId={file.id}>
          <RichMarkdownEditor
            fileId={file.id} viewStateId={viewStateScopeId} content={editorContent}
            filePath={file.filePath} worktreeId={file.worktreeId}
            externalSshTargetId={file.externalSshTargetId} runtimeEnvironmentId={file.runtimeEnvironmentId}
            scrollCacheKey={`${editorViewStateKey}:rich`} onContentChange={change}
            onDirtyStateHint={onDirtyStateHint} onSave={save} onOpenDocLink={onOpenDocLink}
            markdownDocuments={markdownDocuments} showTableOfContents={showTableOfContents}
            onCloseTableOfContents={onCloseTableOfContents}
            markdownAnnotationsEnabled={markdownAnnotationsEnabled}
            markdownAnnotationFilePath={file.relativePath}
            markdownSourceLineOffset={frontMatter ? sourceLineOffset(frontMatter.raw) : 0}
            markdownReviewContent={currentContent}
            headerSlot={frontMatter && showFrontmatter ? <MarkdownFrontMatterBanner raw={frontMatter.raw} /> : null}
          />
        </RichMarkdownErrorBoundary>
      </div></div>
    )
  }
  if (renderMode === 'preview') {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {viewMode === 'rich' && richModeUnsupportedMessage ? <div className="border-b border-border/60 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-100">{richModeUnsupportedMessage}</div> : null}
        <div className="min-h-0 flex-1"><MarkdownPreview key={viewStateScopeId} content={currentContent} filePath={file.filePath} sourceFileId={file.id} sourceWorktreeId={file.worktreeId} sourceRuntimeEnvironmentId={file.runtimeEnvironmentId} scrollCacheKey={`${editorViewStateKey}:preview`} showTableOfContents={showTableOfContents} onCloseTableOfContents={onCloseTableOfContents} markdownAnnotationsEnabled={markdownAnnotationsEnabled} {...previewProps} /></div>
      </div>
    )
  }
  return <div className="h-full min-h-0">{renderSource()}</div>
}
