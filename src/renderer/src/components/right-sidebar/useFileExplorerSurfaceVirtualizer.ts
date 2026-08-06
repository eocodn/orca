import { useVirtualizer } from '@tanstack/react-virtual'
import type { RefObject } from 'react'
import type { FileExplorerRowProjection } from './file-explorer-row-projection'

export function useFileExplorerSurfaceVirtualizer({
  count,
  inlineInputIndex,
  rowProjection,
  scrollRef
}: {
  count: number
  inlineInputIndex: number
  rowProjection: FileExplorerRowProjection
  scrollRef: RefObject<HTMLDivElement | null>
}) {
  return useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 26,
    overscan: 20,
    getItemKey: (index) => {
      if (inlineInputIndex >= 0) {
        if (index === inlineInputIndex) {
          return '__inline_input__'
        }
        const rowIndex = index > inlineInputIndex ? index - 1 : index
        return rowProjection.getRowAtIndex(rowIndex)?.path ?? `__fallback_${index}`
      }
      return rowProjection.getRowAtIndex(index)?.path ?? `__fallback_${index}`
    }
  })
}
