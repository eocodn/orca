// Concrete surface implementation for RemoteFileBrowser.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getClientRuntime } from '@/runtime/client-runtime'
import {
  decideEnterAction,
  decideEscAction,
  filterEntries,
  isRemoteFileBrowserPathResolveTextTooLarge,
  joinPath,
  parentPath,
  parsePathInput,
  type DirEntry
} from './remote-file-browser-helpers'
import { driveBreadcrumbPath, splitBrowsePath } from './remote-file-browser-drive-paths'
import { useRemoteFileBrowserPathInput } from './remote-file-browser-path-input'
import { RemoteFileBrowserView } from './remote-file-browser-view'
import type { RemoteFileBrowserPreviewState } from './remote-file-browser-view'
import { browseRuntimeServerDirectory } from '@/runtime/runtime-server-directory-browser'
import { translate } from '@/i18n/i18n'
import type { FilesystemPathFlavor } from '../../../../shared/types'

type RemoteFileBrowserProps = (
  | { targetId: string; runtimeEnvironmentId?: never }
  | { runtimeEnvironmentId: string; targetId?: never }
) & {
  initialPath?: string
  onSelect: (path: string) => void
  onCancel: () => void
}

const FILE_HINT_MS = 2000
type BrowseResult = {
  resolvedPath: string
  entries: DirEntry[]
  pathFlavor: FilesystemPathFlavor
}

export function RemoteFileBrowser({
  targetId,
  runtimeEnvironmentId,
  initialPath = '~',
  onSelect,
  onCancel
}: RemoteFileBrowserProps): React.JSX.Element {
  const [resolvedPath, setResolvedPath] = useState('')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [pathFlavor, setPathFlavor] = useState<FilesystemPathFlavor>('posix')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [fileHint, setFileHint] = useState(false)
  // Drives the list during path mode; separate from committed state so typing doesn't move the Select target before commit.
  const [preview, setPreview] = useState<RemoteFileBrowserPreviewState | null>(null)
  const genRef = useRef(0)
  const previewGenRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Why: paste resolution runs next tick; closing the picker before then must cancel stale preview work.
  const pasteResolveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Per-picker listing cache keyed by resolved path, so typing issues at most one remote call per committed segment.
  const listingCacheRef = useRef<Map<string, BrowseResult>>(new Map())
  // Resolved remote home, cached after the first browseDir('~'); anchors `~`/`~/...` without hardcoding a home dir.
  const homePathRef = useRef<string | null>(null)
  // Committed-path portion (through the final `/`) the preview reflects; if unchanged next keystroke, skip re-resolving.
  const lastCommittedPrefixRef = useRef<string>('')

  const clearFileHint = useCallback(() => {
    if (fileHintTimerRef.current) {
      clearTimeout(fileHintTimerRef.current)
      fileHintTimerRef.current = null
    }
    setFileHint(false)
  }, [])

  const invalidateBrowseRequests = useCallback(() => {
    genRef.current++
    previewGenRef.current++
  }, [])

  const setBrowserRootRef = useCallback(
    (node: HTMLDivElement | null): void => {
      if (node !== null) {
        return
      }
      // Why: browse generations and timers are scoped to this picker owner; clear them when it detaches.
      invalidateBrowseRequests()
      for (const timerRef of [
        fileHintTimerRef,
        debounceTimerRef,
        pasteResolveTimerRef,
        clickTimerRef
      ]) {
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
      }
    },
    [invalidateBrowseRequests]
  )

  const fetchListing = useCallback(
    async (dirPath: string): Promise<BrowseResult> => {
      const cached = listingCacheRef.current.get(dirPath)
      if (cached) {
        return cached
      }
      const result = targetId
        ? await getClientRuntime().ssh.browseDir({ targetId, dirPath })
        : await browseRuntimeServerDirectory(
            requireRuntimeEnvironmentId(runtimeEnvironmentId),
            dirPath
          )
      listingCacheRef.current.set(result.resolvedPath, result)
      // Also key by the requested dirPath (e.g. `~`, relative) so an identical request doesn't re-hit the SSH backend.
      if (dirPath !== result.resolvedPath) {
        listingCacheRef.current.set(dirPath, result)
      }
      return result
    },
    [runtimeEnvironmentId, targetId]
  )

  const loadDir = useCallback(
    async (dirPath: string) => {
      const gen = ++genRef.current
      setLoading(true)
      setError(null)
      try {
        const result = await fetchListing(dirPath)
        if (gen !== genRef.current) {
          return
        }
        setResolvedPath(result.resolvedPath)
        setEntries(result.entries)
        setPathFlavor(result.pathFlavor)
        // Only bare `~` yields the home dir itself; `~/sub` resolves elsewhere and must not overwrite the home anchor.
        if (dirPath === '~') {
          homePathRef.current = result.resolvedPath
        }
      } catch (err) {
        if (gen !== genRef.current) {
          return
        }
        setError(err instanceof Error ? err.message : String(err))
        setEntries([])
      } finally {
        if (gen === genRef.current) {
          setLoading(false)
        }
      }
    },
    [fetchListing]
  )

  // Central nav clears filter/preview/hint and bumps previewGenRef so a stale in-flight preview won't clobber committed state.
  const navigate = useCallback(
    (dirPath: string) => {
      setFilter('')
      setPreview(null)
      previewGenRef.current++
      lastCommittedPrefixRef.current = ''
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
      clearFileHint()
      loadDir(dirPath)
    },
    [loadDir, clearFileHint]
  )

  useEffect(() => {
    loadDir(initialPath)
  }, [loadDir, initialPath])

  const navigateInto = useCallback(
    (name: string) => {
      navigate(joinPath(resolvedPath, name, pathFlavor))
    },
    [resolvedPath, navigate, pathFlavor]
  )

  const navigateUp = useCallback(() => {
    if (resolvedPath === '/') {
      return
    }
    navigate(parentPath(resolvedPath, pathFlavor))
  }, [resolvedPath, navigate, pathFlavor])

  const filteredEntries = useMemo(() => filterEntries(entries, filter), [entries, filter])

  const previewFilteredEntries = useMemo(
    () => (preview ? filterEntries(preview.entries, preview.filter) : []),
    [preview]
  )

  const triggerFileHint = useCallback(() => {
    if (fileHintTimerRef.current) {
      clearTimeout(fileHintTimerRef.current)
    }
    setFileHint(true)
    fileHintTimerRef.current = setTimeout(() => {
      setFileHint(false)
      fileHintTimerRef.current = null
    }, FILE_HINT_MS)
  }, [])

  // Filter-mode edits stay local; path-mode edits trigger a debounced resolve, but trailing-filter-only edits stay local too.
  const { handleInputChange, handleInputPaste } = useRemoteFileBrowserPathInput({
    pathFlavor,
    resolvedPath,
    fetchListing,
    inputRef,
    clearFileHint,
    preview,
    setPreview,
    setFilter,
    previewGenRef,
    homePathRef,
    debounceTimerRef,
    pasteResolveTimerRef,
    lastCommittedPrefixRef
  })

  // Select always returns the committed directory; disabled during a path preview to avoid a mismatched selection.
  const handleSelect = useCallback(() => {
    onSelect(resolvedPath)
  }, [resolvedPath, onSelect])

  // When a preview is active, row clicks resolve relative to the preview path, not the committed resolvedPath.
  const listParentPath = preview?.resolvedPath ?? resolvedPath

  const handleRowClick = useCallback(
    (entry: DirEntry) => {
      // Stale rows from the prior listing may still show while a preview resolves; clicking them would navigate a mismatched path.
      if (preview?.loading) {
        return
      }
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current)
      }
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null
        if (entry.isDirectory) {
          navigate(joinPath(listParentPath, entry.name, pathFlavor))
        } else {
          triggerFileHint()
        }
      }, 220)
    },
    [navigate, triggerFileHint, listParentPath, preview?.loading, pathFlavor]
  )

  const handleRowDoubleClick = useCallback(
    (entry: DirEntry) => {
      // Same as handleRowClick: don't act on stale rows while the preview listing re-resolves.
      if (!entry.isDirectory || preview?.loading) {
        return
      }
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current)
        clickTimerRef.current = null
      }
      onSelect(joinPath(listParentPath, entry.name, pathFlavor))
    },
    [listParentPath, onSelect, preview?.loading, pathFlavor]
  )

  const handleFilterKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        if (preview) {
          // Path mode Enter.
          if (preview.error || preview.loading) {
            e.preventDefault()
            return
          }
          const parsed = parsePathInput(filter, pathFlavor)
          // Fully-resolved directory (trailing `/` or bare base marker): navigate to the preview path itself.
          if (parsed.mode === 'path' && parsed.trailingFilter === '') {
            e.preventDefault()
            navigate(preview.resolvedPath)
            return
          }
          // Trailing filter: resolve to a single folder match in the preview listing, mirroring filter-mode Enter.
          const filtered = filterEntries(preview.entries, preview.filter)
          const action = decideEnterAction(filtered)
          if (action.type === 'navigate') {
            e.preventDefault()
            navigate(joinPath(preview.resolvedPath, action.name, pathFlavor))
          } else if (action.type === 'fileHint') {
            e.preventDefault()
            triggerFileHint()
          } else {
            e.preventDefault()
          }
          return
        }
        const action = decideEnterAction(filteredEntries)
        if (action.type === 'navigate') {
          e.preventDefault()
          navigateInto(action.name)
        } else if (action.type === 'fileHint') {
          e.preventDefault()
          triggerFileHint()
        }
        return
      }
      if (e.key === 'Escape') {
        const action = decideEscAction(filter)
        if (action.type === 'clearFilter') {
          e.stopPropagation()
          e.preventDefault()
          setFilter('')
          setPreview(null)
          previewGenRef.current++
          // Cancel any pending debounced resolve so it can't fire after Escape dismisses the preview.
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current)
            debounceTimerRef.current = null
          }
          clearFileHint()
        } else {
          onCancel()
        }
      }
      if (e.key === 'Backspace' && filter === '' && !preview) {
        // Backspace in an empty input climbs to the parent; in-word backspaces are untouched.
        if (resolvedPath !== '/') {
          e.preventDefault()
          navigateUp()
        }
      }
    },
    [
      filter,
      filteredEntries,
      preview,
      navigate,
      navigateInto,
      navigateUp,
      resolvedPath,
      triggerFileHint,
      clearFileHint,
      onCancel,
      pathFlavor
    ]
  )

  // Preserve the separator shape when rebuilding drive breadcrumbs.
  const browseParts = splitBrowsePath(resolvedPath, pathFlavor)
  const pathSegments = browseParts.segments
  const breadcrumbPathTo = useCallback(
    (segmentIndex: number): string =>
      browseParts.kind === 'drive'
        ? driveBreadcrumbPath(browseParts.driveRoot, browseParts.segments, segmentIndex)
        : `/${browseParts.segments.slice(0, segmentIndex + 1).join('/')}`,
    [browseParts]
  )

  // Render the preview listing (own filter/error) during path mode, the committed listing otherwise.
  const isPreviewActive = preview !== null
  const showPreviewLoading = isPreviewActive && preview!.loading
  const displayEntries = isPreviewActive ? previewFilteredEntries : filteredEntries
  const displayEmptyDirCopy = isPreviewActive
    ? `${preview!.resolvedPath} is empty`
    : 'Empty directory'
  const noMatchesFilter = isPreviewActive ? preview!.filter : filter
  const displayNoMatchesCopy = isRemoteFileBrowserPathResolveTextTooLarge(noMatchesFilter)
    ? translate(
        'auto.components.sidebar.RemoteFileBrowser.largeInputNoMatches',
        'No matches for this long input'
      )
    : translate(
        'auto.components.sidebar.RemoteFileBrowser.00c4235c10',
        "No matches for '{{value0}}'",
        { value0: noMatchesFilter }
      )

  // Disable Select during a non-empty path preview so the committed dir isn't silently selected under a different-looking list.
  const selectDisabled = loading || (isPreviewActive && filter !== '')

  return (
    <RemoteFileBrowserView
      setBrowserRootRef={setBrowserRootRef}
      navigateUp={navigateUp}
      loading={loading}
      navigate={navigate}
      resolvedPath={resolvedPath}
      browseParts={browseParts}
      pathSegments={pathSegments}
      breadcrumbPathTo={breadcrumbPathTo}
      inputRef={inputRef}
      filter={filter}
      handleInputChange={handleInputChange}
      handleInputPaste={handleInputPaste}
      handleFilterKeyDown={handleFilterKeyDown}
      preview={preview}
      showPreviewLoading={showPreviewLoading}
      isPreviewActive={isPreviewActive}
      entries={entries}
      displayEntries={displayEntries}
      displayEmptyDirCopy={displayEmptyDirCopy}
      displayNoMatchesCopy={displayNoMatchesCopy}
      error={error}
      handleRowClick={handleRowClick}
      handleRowDoubleClick={handleRowDoubleClick}
      fileHint={fileHint}
      handleSelect={handleSelect}
      selectDisabled={selectDisabled}
      onCancel={onCancel}
    />
  )
}

function requireRuntimeEnvironmentId(runtimeEnvironmentId: string | undefined): string {
  if (!runtimeEnvironmentId) {
    throw new Error('Runtime environment is required')
  }
  return runtimeEnvironmentId
}
