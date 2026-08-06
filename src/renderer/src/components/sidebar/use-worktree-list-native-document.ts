import { useEffect } from 'react'

export type WorktreeListNativeDocumentContext = {
  onDocumentDrop: (event: DragEvent) => void
  onDocumentDragEnd: () => void
  onVisibilityChange: () => void
}

/** Capture browser-level drag termination before external status bridges run. */
export function useWorktreeListNativeDocument({
  onDocumentDrop,
  onDocumentDragEnd,
  onVisibilityChange
}: WorktreeListNativeDocumentContext): void {
  useEffect(() => {
    document.addEventListener('drop', onDocumentDrop, true)
    document.addEventListener('dragend', onDocumentDragEnd, true)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('drop', onDocumentDrop, true)
      document.removeEventListener('dragend', onDocumentDragEnd, true)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [onDocumentDragEnd, onDocumentDrop, onVisibilityChange])
}
