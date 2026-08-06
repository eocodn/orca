import React, { useCallback } from 'react'
import type { FilesystemPathFlavor } from '../../../../shared/types'
import {
  isRemoteFileBrowserPathResolveTextTooLarge,
  isPathMode,
  joinPath,
  parentPath,
  parsePathInput,
  resolveSegmentStep,
  shouldDeferRemoteFileBrowserPasteResolve,
  type DirEntry
} from './remote-file-browser-helpers'
import type { RemoteFileBrowserPreviewState } from './remote-file-browser-view'

type BrowseListing = {
  resolvedPath: string
  entries: DirEntry[]
  pathFlavor: FilesystemPathFlavor
}

type PathInputControllerProps = {
  pathFlavor: FilesystemPathFlavor
  resolvedPath: string
  fetchListing: (dirPath: string) => Promise<BrowseListing>
  inputRef: React.RefObject<HTMLInputElement | null>
  clearFileHint: () => void
  preview: RemoteFileBrowserPreviewState | null
  setPreview: React.Dispatch<React.SetStateAction<RemoteFileBrowserPreviewState | null>>
  setFilter: React.Dispatch<React.SetStateAction<string>>
  previewGenRef: React.MutableRefObject<number>
  homePathRef: React.MutableRefObject<string | null>
  debounceTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
  pasteResolveTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
  lastCommittedPrefixRef: React.MutableRefObject<string>
}

type PathInputController = {
  handleInputChange: (raw: string) => void
  handleInputPaste: (event: React.ClipboardEvent<HTMLInputElement>) => void
}

const PATH_DEBOUNCE_MS = 300

// Portion before the final separator; distinguishes filter-only edits from committed-path changes.
function committedPrefix(raw: string): string {
  const i = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'))
  return i === -1 ? '' : raw.slice(0, i + 1)
}

export function useRemoteFileBrowserPathInput({
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
}: PathInputControllerProps): PathInputController {
  const resolvePathInput = useCallback(
    async (raw: string) => {
      const parsed = parsePathInput(raw, pathFlavor)
      if (parsed.mode !== 'path') {
        return
      }
      const gen = ++previewGenRef.current

      if (parsed.invalid) {
        setPreview({
          resolvedPath,
          entries: [],
          filter: '',
          error: parsed.invalid,
          loading: false
        })
        return
      }

      // Pick the base path; `~` needs the resolved home, so fetch and cache it once before resolving.
      let basePath: string
      if (parsed.base === 'root') {
        basePath = '/'
      } else if (parsed.base === 'drive') {
        basePath = parsed.driveRoot ?? '/'
      } else if (parsed.base === 'home') {
        if (!homePathRef.current) {
          setPreview({
            resolvedPath,
            entries: [],
            filter: '',
            error: null,
            loading: true
          })
          try {
            const home = await fetchListing('~')
            if (gen !== previewGenRef.current) {
              return
            }
            homePathRef.current = home.resolvedPath
          } catch (err) {
            if (gen !== previewGenRef.current) {
              return
            }
            setPreview({
              resolvedPath,
              entries: [],
              filter: '',
              error: err instanceof Error ? err.message : String(err),
              loading: false
            })
            return
          }
        }
        basePath = homePathRef.current!
      } else {
        basePath = resolvedPath
      }

      setPreview((prev) => ({
        resolvedPath: prev?.resolvedPath ?? basePath,
        entries: prev?.entries ?? [],
        filter: prev?.filter ?? '',
        error: null,
        loading: true
      }))

      let currentPath = basePath
      try {
        for (const segment of parsed.committedSegments) {
          const listing = await fetchListing(currentPath)
          if (gen !== previewGenRef.current) {
            return
          }
          const outcome = resolveSegmentStep(segment, currentPath, listing.entries)
          if (outcome.type === 'error') {
            setPreview({
              resolvedPath: currentPath,
              entries: listing.entries,
              filter: '',
              error: outcome.message,
              loading: false
            })
            return
          }
          if (outcome.type === 'stay') {
            if (segment === '..') {
              currentPath = parentPath(currentPath, listing.pathFlavor)
            }
            continue
          }
          currentPath = joinPath(currentPath, outcome.name, listing.pathFlavor)
        }

        const finalListing = await fetchListing(currentPath)
        if (gen !== previewGenRef.current) {
          return
        }
        lastCommittedPrefixRef.current = committedPrefix(raw)
        setPreview({
          resolvedPath: finalListing.resolvedPath,
          entries: finalListing.entries,
          filter: parsed.trailingFilter,
          error: null,
          loading: false
        })
      } catch (err) {
        if (gen !== previewGenRef.current) {
          return
        }
        setPreview({
          resolvedPath: currentPath,
          entries: [],
          filter: '',
          error: err instanceof Error ? err.message : String(err),
          loading: false
        })
      }
    },
    [
      fetchListing,
      homePathRef,
      pathFlavor,
      previewGenRef,
      resolvedPath,
      setPreview,
      lastCommittedPrefixRef
    ]
  )

  const handleInputChange = useCallback(
    (raw: string) => {
      clearFileHint()
      setFilter(raw)

      if (isRemoteFileBrowserPathResolveTextTooLarge(raw)) {
        if (preview) {
          setPreview(null)
          previewGenRef.current++
        }
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current)
          debounceTimerRef.current = null
        }
        if (pasteResolveTimerRef.current) {
          clearTimeout(pasteResolveTimerRef.current)
          pasteResolveTimerRef.current = null
        }
        return
      }

      if (!isPathMode(raw, pathFlavor)) {
        // Leaving path mode: drop preview immediately so the committed directory reappears without a flicker.
        if (preview) {
          setPreview(null)
          previewGenRef.current++
        }
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current)
          debounceTimerRef.current = null
        }
        return
      }

      const parsed = parsePathInput(raw, pathFlavor)
      // Fast path: unchanged committed prefix updates only the local filter, so intra-segment typing issues no browseDir call.
      if (
        parsed.mode === 'path' &&
        preview &&
        !preview.error &&
        !parsed.invalid &&
        committedPrefix(raw) === lastCommittedPrefixRef.current
      ) {
        // Runs even while preview.loading: unchanged prefix hits the same listing, so blocking keystrokes would only feel laggy.
        setPreview({ ...preview, filter: parsed.trailingFilter })
        return
      }

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null
        resolvePathInput(raw)
      }, PATH_DEBOUNCE_MS)
    },
    [
      clearFileHint,
      debounceTimerRef,
      lastCommittedPrefixRef,
      pathFlavor,
      pasteResolveTimerRef,
      preview,
      previewGenRef,
      resolvePathInput,
      setFilter,
      setPreview
    ]
  )

  const handleInputPaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      if (e.defaultPrevented) {
        return
      }
      if (shouldDeferRemoteFileBrowserPasteResolve(e.clipboardData.getData('text/plain'))) {
        return
      }
      // Paste resolves immediately (no debounce), but defer a tick so onChange has applied the pasted value to filter.
      if (pasteResolveTimerRef.current) {
        clearTimeout(pasteResolveTimerRef.current)
      }
      pasteResolveTimerRef.current = setTimeout(() => {
        pasteResolveTimerRef.current = null
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current)
          debounceTimerRef.current = null
        }
        const value = inputRef.current?.value ?? ''
        if (!isRemoteFileBrowserPathResolveTextTooLarge(value) && isPathMode(value, pathFlavor)) {
          resolvePathInput(value)
        }
      }, 0)
    },
    [debounceTimerRef, inputRef, pathFlavor, pasteResolveTimerRef, resolvePathInput]
  )

  return { handleInputChange, handleInputPaste }
}
