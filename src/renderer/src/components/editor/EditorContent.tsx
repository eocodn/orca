import React from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { detectLanguage } from '@/lib/language-detect'
import { joinPath } from '@/lib/path'
import { useAppStore } from '@/store'
import { ChangesModeView } from './ChangesModeView'
import {
  ConflictBanner,
  ConflictPlaceholderView,
  ConflictReviewPanel,
  getNextConflictNavigationIndex
} from './ConflictComponents'
import type { MarkdownViewMode, OpenFile, PendingEditorReveal } from '@/store/slices/editor'
import type { GitStatusEntry, GitDiffResult } from '../../../../shared/types'
import { useMarkdownDocuments } from './useMarkdownDocuments'
import {
  findGitConflictBlocks,
  getGitConflictMarkerLineLength
} from './monaco-conflict-decorations'
import { translate } from '@/i18n/i18n'
import { CheckRunDetailsPanel } from './CheckRunDetailsPanel'
import { ExternalFileChangeBanner } from './ExternalFileChangeBanner'
import {
  ConflictReviewEditorContent,
  EditorFileLoadErrorView,
  type ConflictReviewFileContent
} from './ConflictReviewEditorContent'
import { MarkdownEditorContent } from './MarkdownEditorContent'
import { EditorDiffContent } from './EditorDiffContent'
import { matchesPendingEditorReveal } from './editor-content-source-offset'
export { getMarkdownSourceLineOffset } from './editor-content-source-offset'

const MonacoEditor = lazy(() => import('./MonacoEditor'))
const CombinedDiffViewer = lazy(() => import('./CombinedDiffViewer'))
const MarkdownPreview = lazy(() => import('./MarkdownPreview'))
const ImageViewer = lazy(() => import('./ImageViewer'))
const MermaidViewer = lazy(() => import('./MermaidViewer'))
const CsvViewer = lazy(() => import('./CsvViewer'))
const IpynbViewer = lazy(() => import('./IpynbViewer'))

// Why: module-level for a stable no-op identity so read-only tabs don't rebuild callbacks each render.
const noopEditorContentChange = (_content: string): void => {}
const noopEditorSave = async (_content: string): Promise<boolean> => false

type FileContent = ConflictReviewFileContent

const noopCloseMarkdownTableOfContents = (): void => {}

export function EditorContent({
  activeFile,
  viewStateScopeId,
  fileContents,
  diffContents,
  editBuffers,
  openFiles,
  worktreeEntries,
  resolvedLanguage,
  isMarkdown,
  isMermaid,
  isCsv,
  isNotebook,
  mdViewMode,
  isChangesMode,
  sideBySide,
  showMarkdownTableOfContents = false,
  showMarkdownFrontmatter = false,
  onCloseMarkdownTableOfContents = noopCloseMarkdownTableOfContents,
  markdownAnnotationsEnabled = true,
  pendingEditorReveal,
  handleContentChange,
  handleContentChangeForFile,
  handleDirtyStateHint,
  handleSave,
  handleSaveForFile,
  reloadContent
}: {
  activeFile: OpenFile
  viewStateScopeId: string
  fileContents: Record<string, FileContent>
  diffContents: Record<string, GitDiffResult>
  editBuffers: Record<string, string>
  openFiles: OpenFile[]
  worktreeEntries: GitStatusEntry[]
  resolvedLanguage: string
  isMarkdown: boolean
  isMermaid: boolean
  isCsv: boolean
  isNotebook: boolean
  mdViewMode: MarkdownViewMode
  isChangesMode: boolean
  sideBySide: boolean
  showMarkdownTableOfContents?: boolean
  showMarkdownFrontmatter?: boolean
  onCloseMarkdownTableOfContents?: () => void
  markdownAnnotationsEnabled?: boolean
  pendingEditorReveal: PendingEditorReveal | null
  handleContentChange: (content: string) => void
  handleContentChangeForFile: (file: OpenFile, content: string) => void
  handleDirtyStateHint: (dirty: boolean) => void
  handleSave: (content: string) => Promise<boolean>
  handleSaveForFile: (file: OpenFile, content: string) => Promise<boolean>
  reloadContent: (file: OpenFile) => void
}): React.JSX.Element {
  const editorViewStateKey =
    viewStateScopeId === activeFile.id
      ? activeFile.filePath
      : `${activeFile.filePath}::${viewStateScopeId}`
  const diffViewStateKey =
    viewStateScopeId === activeFile.id ? activeFile.id : `${activeFile.id}::${viewStateScopeId}`
  const markdownPreviewViewStateKey =
    viewStateScopeId === activeFile.id
      ? `${activeFile.id}:preview`
      : `${activeFile.id}::${viewStateScopeId}:preview`
  const monacoLanguage = resolvedLanguage === 'notebook' ? 'json' : resolvedLanguage

  const openConflictReviewFile = useAppStore((s) => s.openConflictReviewFile)
  const openConflictReview = useAppStore((s) => s.openConflictReview)
  const closeFile = useAppStore((s) => s.closeFile)
  const setRightSidebarTab = useAppStore((s) => s.setRightSidebarTab)
  const setPendingEditorReveal = useAppStore((s) => s.setPendingEditorReveal)
  const reloadOpenCheckRunDetailsTab = useAppStore((s) => s.reloadOpenCheckRunDetailsTab)
  const [conflictNavigationIndexByFile, setConflictNavigationIndexByFile] = React.useState<
    Record<string, number>
  >({})
  const md = useMarkdownDocuments(activeFile, isMarkdown, mdViewMode, handleSave)
  const activeConflictEntry =
    worktreeEntries.find((entry) => entry.path === activeFile.relativePath) ?? null
  const selectedConflictReviewFile =
    activeFile.mode === 'conflict-review' && activeFile.conflictReview?.selectedFileId
      ? (openFiles.find((file) => file.id === activeFile.conflictReview?.selectedFileId) ?? null)
      : null

  const isCombinedDiff =
    activeFile.mode === 'diff' &&
    (activeFile.diffSource === 'combined-all' ||
      activeFile.diffSource === 'combined-uncommitted' ||
      activeFile.diffSource === 'combined-branch' ||
      activeFile.diffSource === 'combined-commit')

  const getConflictNavigation = React.useCallback(
    (file: OpenFile, content: string) => {
      const blocks = findGitConflictBlocks(content)
      if (blocks.length === 0) {
        return undefined
      }

      const currentIndex = conflictNavigationIndexByFile[file.id] ?? null
      return {
        currentIndex,
        total: blocks.length,
        onJump: (direction: 'previous' | 'next') => {
          const nextIndex = getNextConflictNavigationIndex({
            currentIndex,
            direction,
            total: blocks.length
          })
          if (nextIndex === null) {
            return
          }
          const line = blocks[nextIndex].startLine
          const markerLineLength = getGitConflictMarkerLineLength(content, line)
          setConflictNavigationIndexByFile((prev) => ({ ...prev, [file.id]: nextIndex }))
          // Why: clear first so a repeated same-location reveal still changes the prop and re-runs the editor's reveal effect.
          setPendingEditorReveal(null)
          queueMicrotask(() => {
            setPendingEditorReveal({
              filePath: file.filePath,
              line,
              column: 1,
              matchLength: markerLineLength
            })
          })
        }
      }
    },
    [conflictNavigationIndexByFile, setPendingEditorReveal]
  )
  const openConflictEntry = React.useCallback(
    (entry: GitStatusEntry) => {
      if (activeFile.mode !== 'conflict-review') {
        return
      }
      openConflictReviewFile(
        activeFile.id,
        activeFile.worktreeId,
        activeFile.filePath,
        entry,
        detectLanguage(entry.path)
      )
    },
    [
      activeFile.filePath,
      activeFile.id,
      activeFile.mode,
      activeFile.worktreeId,
      openConflictReviewFile
    ]
  )

  const createConflictReviewContentFile = (entry: GitStatusEntry): OpenFile => {
    const absolutePath = joinPath(activeFile.filePath, entry.path)
    const conflict =
      entry.conflictKind && entry.conflictStatus && entry.conflictStatusSource
        ? entry.status === 'deleted'
          ? {
              kind: 'conflict-placeholder' as const,
              conflictKind: entry.conflictKind,
              conflictStatus: entry.conflictStatus,
              conflictStatusSource: entry.conflictStatusSource,
              message: translate(
                'auto.components.editor.EditorContent.8b1a605bae',
                'This file is in a conflict state, but no working-tree file is available to edit.'
              ),
              guidance: 'Resolve the conflict in Git or restore one side before reopening it.'
            }
          : {
              kind: 'conflict-editable' as const,
              conflictKind: entry.conflictKind,
              conflictStatus: entry.conflictStatus,
              conflictStatusSource: entry.conflictStatusSource
            }
        : undefined

    return {
      id: absolutePath,
      filePath: absolutePath,
      relativePath: entry.path,
      worktreeId: activeFile.worktreeId,
      language: detectLanguage(entry.path),
      isDirty: false,
      mode: 'edit',
      conflict
    }
  }

  const renderMonacoEditor = (fc: FileContent): React.JSX.Element => (
    // Why: without a key React reuses the instance and skips cleanup (scroll snapshot); key forces a remount per pane+path.
    <MonacoEditor
      key={`${viewStateScopeId}\u0000${activeFile.filePath}`}
      fileId={activeFile.id}
      filePath={activeFile.filePath}
      viewStateKey={editorViewStateKey}
      viewStateId={viewStateScopeId}
      relativePath={activeFile.relativePath}
      content={editBuffers[activeFile.id] ?? fc.content}
      language={monacoLanguage}
      // Why: read-only tabs no-op the change/save callbacks so no draft, dirty state, or write can occur.
      readOnly={activeFile.readOnly === true}
      liveTail={activeFile.liveTail === true}
      onContentChange={activeFile.readOnly === true ? noopEditorContentChange : handleContentChange}
      onSave={activeFile.readOnly === true ? noopEditorSave : isMarkdown ? md.mdSave : handleSave}
      worktreeId={activeFile.worktreeId}
      markdownAnnotationsEnabled={markdownAnnotationsEnabled && isMarkdown}
      conflictDecorationsEnabled={activeFile.conflict?.conflictStatus === 'unresolved'}
      revealLine={
        matchesPendingEditorReveal(pendingEditorReveal, activeFile)
          ? pendingEditorReveal.line
          : undefined
      }
      revealColumn={
        matchesPendingEditorReveal(pendingEditorReveal, activeFile)
          ? pendingEditorReveal.column
          : undefined
      }
      revealMatchLength={
        matchesPendingEditorReveal(pendingEditorReveal, activeFile)
          ? pendingEditorReveal.matchLength
          : undefined
      }
      markdownDocuments={isMarkdown ? md.markdownDocuments : undefined}
    />
  )

  const renderMarkdownContent = (fc: FileContent): React.JSX.Element => (
    <MarkdownEditorContent
      file={activeFile}
      fileContent={fc.content}
      editContent={editBuffers[activeFile.id]}
      viewMode={mdViewMode}
      viewStateScopeId={viewStateScopeId}
      editorViewStateKey={editorViewStateKey}
      showTableOfContents={showMarkdownTableOfContents}
      showFrontmatter={showMarkdownFrontmatter}
      onCloseTableOfContents={onCloseMarkdownTableOfContents}
      markdownAnnotationsEnabled={markdownAnnotationsEnabled}
      onContentChange={handleContentChange}
      onDirtyStateHint={handleDirtyStateHint}
      onSave={md.mdSave}
      markdownDocuments={md.markdownDocuments}
      onOpenDocLink={md.onOpenDocLink}
      previewProps={md.previewProps}
      sourceLineOffset={getMarkdownSourceLineOffset}
      renderSource={() => renderMonacoEditor(fc)}
    />
  )

  const renderConflictReviewEditorContent = ({
    contentFile,
    entry,
    className,
    viewStateKeySuffix,
    readOnly = false,
    autoHeight = false
  }: {
    contentFile: OpenFile
    entry: GitStatusEntry | null
    className: string
    viewStateKeySuffix: string
    readOnly?: boolean
    autoHeight?: boolean
  }): React.JSX.Element => (
    <ConflictReviewEditorContent
      contentFile={contentFile}
      entry={entry}
      className={className}
      viewStateScopeId={viewStateScopeId}
      viewStateKeySuffix={viewStateKeySuffix}
      fileContents={fileContents}
      editBuffers={editBuffers}
      pendingEditorReveal={pendingEditorReveal}
      readOnly={readOnly}
      autoHeight={autoHeight}
      onRetry={reloadContent}
      onContentChange={handleContentChangeForFile}
      onSave={handleSaveForFile}
      getConflictNavigation={getConflictNavigation}
    />
  )

  const renderConflictReviewSelectedContent = (selectedFile: OpenFile): React.JSX.Element => {
    const selectedConflictEntry =
      worktreeEntries.find((entry) => entry.path === selectedFile.relativePath) ?? null

    return renderConflictReviewEditorContent({
      contentFile: selectedFile,
      entry: selectedConflictEntry,
      className: 'flex min-h-0 flex-1 flex-col',
      viewStateKeySuffix: 'selected'
    })
  }

  const renderConflictReviewInlineFile = (entry: GitStatusEntry): React.JSX.Element => {
    const contentFile = createConflictReviewContentFile(entry)

    return renderConflictReviewEditorContent({
      contentFile,
      entry,
      className: 'flex min-h-[120px] flex-col border-b border-border last:border-b-0',
      viewStateKeySuffix: `overview:${entry.path}`,
      readOnly: true,
      autoHeight: true
    })
  }

  const renderConflictReviewAllContent = (): React.JSX.Element => {
    const snapshotEntries = activeFile.conflictReview?.entries ?? []
    const liveEntriesByPath = new Map(worktreeEntries.map((entry) => [entry.path, entry]))
    const unresolvedEntries = snapshotEntries.flatMap((entry) => {
      const liveEntry = liveEntriesByPath.get(entry.path)
      return liveEntry?.conflictStatus === 'unresolved' && liveEntry.conflictKind ? [liveEntry] : []
    })

    return (
      <div className="min-h-0 flex-1 overflow-y-auto bg-editor-surface scrollbar-sleek">
        {unresolvedEntries.map(renderConflictReviewInlineFile)}
      </div>
    )
  }

  if (activeFile.mode === 'check-details') {
    const checkRunDetails = activeFile.checkRunDetails
    if (!checkRunDetails) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {translate(
            'auto.components.editor.EditorContent.6c4f1a8d2e',
            'Check details are unavailable.'
          )}
        </div>
      )
    }
    const details = checkRunDetails.details
    const openUrl = details?.detailsUrl ?? details?.url ?? checkRunDetails.check.url
    return (
      <CheckRunDetailsPanel
        check={checkRunDetails.check}
        details={checkRunDetails.details}
        loading={checkRunDetails.loading}
        error={checkRunDetails.error}
        openUrl={openUrl}
        worktreeId={activeFile.worktreeId}
        onRefresh={() => {
          void reloadOpenCheckRunDetailsTab(activeFile.id)
        }}
      />
    )
  }

  if (activeFile.mode === 'conflict-review') {
    return (
      <ConflictReviewPanel
        file={activeFile}
        liveEntries={worktreeEntries}
        onOpenEntry={openConflictEntry}
        selectedFile={selectedConflictReviewFile}
        selectedContent={
          selectedConflictReviewFile
            ? renderConflictReviewSelectedContent(selectedConflictReviewFile)
            : renderConflictReviewAllContent()
        }
        onDismiss={() => closeFile(activeFile.id)}
        onRefreshSnapshot={() =>
          openConflictReview(
            activeFile.worktreeId,
            activeFile.filePath,
            worktreeEntries
              .filter((entry) => entry.conflictStatus === 'unresolved' && entry.conflictKind)
              .map((entry) => ({
                path: entry.path,
                conflictKind: entry.conflictKind!
              })),
            'live-summary'
          )
        }
        onReturnToSourceControl={() => setRightSidebarTab('source-control')}
      />
    )
  }

  if (isCombinedDiff) {
    return (
      <CombinedDiffViewer
        key={viewStateScopeId}
        file={activeFile}
        viewStateKey={diffViewStateKey}
      />
    )
  }

  if (activeFile.mode === 'markdown-preview') {
    const fc = fileContents[activeFile.id]
    if (!fc) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          {translate('auto.components.editor.EditorContent.37a0e81fa6', 'Loading preview...')}
        </div>
      )
    }
    if (fc.loadError) {
      return <EditorFileLoadErrorView message={fc.loadError} onRetry={() => reloadContent(activeFile)} />
    }
    if (fc.isBinary) {
      return (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {translate(
            'auto.components.editor.EditorContent.8608ce4cb1',
            'Markdown preview is unavailable for binary files.'
          )}
        </div>
      )
    }
    const previewSourceFileId = activeFile.markdownPreviewSourceFileId ?? activeFile.filePath
    const previewContent = editBuffers[previewSourceFileId] ?? fc.content
    return (
      <div className="min-h-0 flex-1">
        <MarkdownPreview
          key={viewStateScopeId}
          content={previewContent}
          filePath={activeFile.filePath}
          sourceFileId={previewSourceFileId}
          sourceWorktreeId={activeFile.worktreeId}
          sourceRuntimeEnvironmentId={activeFile.runtimeEnvironmentId}
          scrollCacheKey={markdownPreviewViewStateKey}
          initialAnchor={activeFile.markdownPreviewAnchor ?? null}
          showTableOfContents={showMarkdownTableOfContents}
          onCloseTableOfContents={onCloseMarkdownTableOfContents}
          markdownAnnotationsEnabled={markdownAnnotationsEnabled}
          {...md.previewProps}
        />
      </div>
    )
  }

  if (activeFile.mode === 'edit') {
    if (activeFile.conflict?.kind === 'conflict-placeholder') {
      return <ConflictPlaceholderView file={activeFile} />
    }
    const fc = fileContents[activeFile.id]
    if (!fc) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          {translate('auto.components.editor.EditorContent.b2735221f5', 'Loading...')}
        </div>
      )
    }
    if (fc.loadError) {
      return <EditorFileLoadErrorView message={fc.loadError} onRetry={() => reloadContent(activeFile)} />
    }
    if (fc.isBinary) {
      if (fc.isImage) {
        return (
          <ImageViewer content={fc.content} filePath={activeFile.filePath} mimeType={fc.mimeType} />
        )
      }
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          {translate(
            'auto.components.editor.EditorContent.b9de81ba52',
            'Binary file — cannot display'
          )}
        </div>
      )
    }
    const externalChangeBanner =
      activeFile.externalMutation === 'changed' ? (
        <ExternalFileChangeBanner
          file={activeFile}
          currentContent={editBuffers[activeFile.id] ?? fc.content}
          reloadContent={reloadContent}
        />
      ) : null
    if (isChangesMode) {
      const changesView = (
        <ChangesModeView
          activeFile={activeFile}
          dc={diffContents[activeFile.id]}
          modifiedContent={editBuffers[activeFile.id] ?? fc.content}
          activeConflictEntry={activeConflictEntry}
          resolvedLanguage={monacoLanguage}
          sideBySide={sideBySide}
          viewStateScopeId={viewStateScopeId}
          diffViewStateKey={diffViewStateKey}
          onContentChange={handleContentChange}
          onSave={isMarkdown ? md.mdSave : handleSave}
        />
      )
      if (!externalChangeBanner) {
        return changesView
      }
      return (
        <div className="flex flex-1 min-h-0 flex-col">
          {externalChangeBanner}
          <div className="min-h-0 flex-1">{changesView}</div>
        </div>
      )
    }
    return (
      <div className="flex flex-1 min-h-0 flex-col">
        {externalChangeBanner}
        {activeFile.conflict && (
          <ConflictBanner
            file={activeFile}
            entry={activeConflictEntry}
            conflictNavigation={getConflictNavigation(
              activeFile,
              editBuffers[activeFile.id] ?? fc.content
            )}
          />
        )}
        <div className="min-h-0 flex-1 relative">
          {isMarkdown ? (
            renderMarkdownContent(fc)
          ) : isMermaid && mdViewMode === 'rich' ? (
            <MermaidViewer
              key={activeFile.id}
              content={editBuffers[activeFile.id] ?? fc.content}
              filePath={activeFile.filePath}
            />
          ) : isCsv && mdViewMode === 'rich' ? (
            <CsvViewer
              key={activeFile.id}
              content={editBuffers[activeFile.id] ?? fc.content}
              filePath={activeFile.filePath}
            />
          ) : isNotebook && mdViewMode === 'rich' ? (
            <IpynbViewer
              key={activeFile.id}
              content={editBuffers[activeFile.id] ?? fc.content}
              fileId={activeFile.id}
              filePath={activeFile.filePath}
              worktreeId={activeFile.worktreeId}
              scrollCacheKey={`${editorViewStateKey}:notebook`}
              onContentChange={handleContentChange}
              onDirtyStateHint={handleDirtyStateHint}
              onSave={handleSave}
            />
          ) : (
            renderMonacoEditor(fc)
          )}
        </div>
      </div>
    )
  }

  return <EditorDiffContent file={activeFile} diff={diffContents[activeFile.id]} editContent={editBuffers[activeFile.id]} viewStateScopeId={viewStateScopeId} diffViewStateKey={diffViewStateKey} resolvedLanguage={monacoLanguage} sideBySide={sideBySide} viewMode={mdViewMode} showTableOfContents={showMarkdownTableOfContents} onCloseTableOfContents={onCloseMarkdownTableOfContents} markdownAnnotationsEnabled={markdownAnnotationsEnabled} previewProps={md.previewProps} onContentChange={handleContentChange} onSave={isMarkdown ? md.mdSave : handleSave} reloadContent={reloadContent} />
}
