import React from 'react'
import { ChevronRight, Folder, ArrowUp, LoaderCircle, Home, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getFileTypeIcon } from '@/lib/file-type-icons'
import { translate } from '@/i18n/i18n'
import type { DirEntry } from './remote-file-browser-helpers'
import type { splitBrowsePath } from './remote-file-browser-drive-paths'

export type RemoteFileBrowserPreviewState = {
  resolvedPath: string
  entries: DirEntry[]
  filter: string
  error: string | null
  loading: boolean
}

const FILE_HINT_TEXT = "Files can't be opened as a project"

type RemoteFileBrowserViewProps = {
  setBrowserRootRef: (node: HTMLDivElement | null) => void
  navigateUp: () => void
  loading: boolean
  navigate: (path: string) => void
  resolvedPath: string
  browseParts: ReturnType<typeof splitBrowsePath>
  pathSegments: string[]
  breadcrumbPathTo: (index: number) => string
  inputRef: React.RefObject<HTMLInputElement | null>
  filter: string
  handleInputChange: (value: string) => void
  handleInputPaste: (event: React.ClipboardEvent<HTMLInputElement>) => void
  handleFilterKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  preview: RemoteFileBrowserPreviewState | null
  showPreviewLoading: boolean
  isPreviewActive: boolean
  entries: DirEntry[]
  displayEntries: DirEntry[]
  displayEmptyDirCopy: string
  displayNoMatchesCopy: string
  error: string | null
  handleRowClick: (entry: DirEntry) => void
  handleRowDoubleClick: (entry: DirEntry) => void
  fileHint: boolean
  handleSelect: () => void
  selectDisabled: boolean
  onCancel: () => void
}

export function RemoteFileBrowserView({
  setBrowserRootRef,
  navigateUp,
  loading,
  navigate,
  resolvedPath,
  browseParts,
  pathSegments,
  breadcrumbPathTo,
  inputRef,
  filter,
  handleInputChange,
  handleInputPaste,
  handleFilterKeyDown,
  preview,
  showPreviewLoading,
  isPreviewActive,
  entries,
  displayEntries,
  displayEmptyDirCopy,
  displayNoMatchesCopy,
  error,
  handleRowClick,
  handleRowDoubleClick,
  fileHint,
  handleSelect,
  selectDisabled,
  onCancel
}: RemoteFileBrowserViewProps): React.JSX.Element {
  return (
    <div ref={setBrowserRootRef} className="flex flex-col gap-2 min-w-0 w-full">
      {/* Breadcrumb bar */}
      <div className="flex items-center gap-0.5 min-h-[28px] overflow-x-auto scrollbar-none">
        <button
          type="button"
          onClick={navigateUp}
          disabled={resolvedPath === '/' || loading}
          className="shrink-0 p-1 rounded hover:bg-accent disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-default"
        >
          <ArrowUp className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => navigate('~')}
          disabled={loading}
          className="shrink-0 p-1 rounded hover:bg-accent transition-colors cursor-pointer"
        >
          <Home className="size-3.5" />
        </button>
        <div className="flex items-center gap-0 text-[11px] text-muted-foreground ml-1 min-w-0">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="shrink-0 hover:text-foreground transition-colors cursor-pointer px-0.5"
          >
            /
          </button>
          {browseParts.kind === 'drive' && (
            <>
              <ChevronRight className="size-2.5 shrink-0 text-muted-foreground/50" />
              <button
                type="button"
                onClick={() => navigate(browseParts.driveRoot)}
                className={cn(
                  'truncate max-w-[120px] hover:text-foreground transition-colors cursor-pointer px-0.5',
                  pathSegments.length === 0 && 'text-foreground font-medium'
                )}
              >
                {browseParts.driveRoot.slice(0, 2)}
              </button>
            </>
          )}
          {pathSegments.map((segment, i) => (
            <React.Fragment key={breadcrumbPathTo(i)}>
              <ChevronRight className="size-2.5 shrink-0 text-muted-foreground/50" />
              <button
                type="button"
                onClick={() => navigate(breadcrumbPathTo(i))}
                className={cn(
                  'truncate max-w-[120px] hover:text-foreground transition-colors cursor-pointer px-0.5',
                  i === pathSegments.length - 1 && 'text-foreground font-medium'
                )}
              >
                {segment}
              </button>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Filter input */}
      <div className="relative">
        <Search className="size-3.5 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          autoFocus
          value={filter}
          onChange={(e) => handleInputChange(e.target.value)}
          onPaste={handleInputPaste}
          onKeyDown={handleFilterKeyDown}
          placeholder={translate(
            'auto.components.sidebar.RemoteFileBrowser.2300612806',
            'Type to filter or enter a path…'
          )}
          aria-invalid={!!preview?.error}
          aria-describedby={preview?.error ? 'remote-file-browser-path-error' : undefined}
          className={cn(
            'w-full h-7 pl-7 pr-7 text-xs rounded-md bg-background',
            'border border-border focus:outline-none focus:ring-1 focus:ring-ring',
            preview?.error && 'border-destructive/60 focus:ring-destructive/60'
          )}
        />
        {showPreviewLoading && (
          <LoaderCircle className="size-3.5 absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {preview?.error && (
        <p
          id="remote-file-browser-path-error"
          role="alert"
          className="text-[11px] text-destructive px-0.5 -mt-1"
        >
          {preview.error}
        </p>
      )}

      {/* File listing */}
      <div className="border border-border rounded-md overflow-hidden bg-background">
        <div className="h-[240px] overflow-y-auto scrollbar-sleek">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full px-4">
              <p className="text-xs text-destructive text-center">{error}</p>
            </div>
          ) : isPreviewActive &&
            preview!.entries.length === 0 &&
            !preview!.error &&
            !preview!.loading ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-xs text-muted-foreground">{displayEmptyDirCopy}</p>
            </div>
          ) : !isPreviewActive && entries.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.sidebar.RemoteFileBrowser.51001182e3',
                  'Empty directory'
                )}
              </p>
            </div>
          ) : displayEntries.length === 0 && !preview?.error ? (
            // Directory has contents but the filter hides them all — distinct from an empty directory so copy stays accurate.
            <div className="flex items-center justify-center h-full">
              <p className="text-xs text-muted-foreground">{displayNoMatchesCopy}</p>
            </div>
          ) : (
            displayEntries.map((entry) => {
              const FileIcon = getFileTypeIcon(entry.name)
              return (
                <button
                  key={entry.name}
                  type="button"
                  onClick={() => handleRowClick(entry)}
                  onDoubleClick={() => handleRowDoubleClick(entry)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    inputRef.current?.focus()
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors cursor-pointer',
                    'hover:bg-accent/60'
                  )}
                >
                  {entry.isDirectory ? (
                    <Folder className="size-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <FileIcon className="size-3.5 text-muted-foreground/60 shrink-0" />
                  )}
                  <span className="truncate flex-1 min-w-0">{entry.name}</span>
                  {entry.isDirectory && (
                    <ChevronRight className="size-3.5 text-muted-foreground/60 shrink-0" />
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Footer */}
      <p
        className="block text-[10px] text-muted-foreground truncate w-full"
        title={fileHint ? undefined : resolvedPath}
      >
        {fileHint
          ? FILE_HINT_TEXT
          : translate(
              'auto.components.sidebar.RemoteFileBrowser.971d85cc84',
              'Opens as a project on this host · {{value0}}',
              { value0: resolvedPath }
            )}
      </p>
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onCancel}>
          {translate('auto.components.sidebar.RemoteFileBrowser.f8b1deb1a4', 'Cancel')}
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={handleSelect}
          disabled={selectDisabled}
          title={resolvedPath}
        >
          {translate('auto.components.sidebar.RemoteFileBrowser.9e060f5815', 'Select folder')}
        </Button>
      </div>
    </div>
  )
}
