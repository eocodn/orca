import { useCallback } from 'react'
import { useFloatingTerminalPanelState } from './floating-terminal-panel-state'
import { useFloatingTerminalPanelBounds } from './floating-terminal-panel-bounds-actions'

const FLOATING_TERMINAL_NO_DRAG_SELECTOR =
  'button,input,textarea,select,[role="menuitem"],[data-testid="sortable-tab"],[data-floating-terminal-no-drag]'

function isFloatingTerminalDragTarget(target: EventTarget): boolean {
  return !(target instanceof HTMLElement && target.closest(FLOATING_TERMINAL_NO_DRAG_SELECTOR))
}

type PanelState = ReturnType<typeof useFloatingTerminalPanelState>
type BoundsActions = ReturnType<typeof useFloatingTerminalPanelBounds>

export function useFloatingTerminalPanelDrag(state: PanelState, bounds: BoundsActions, focusPanelForShortcuts: (preserve?: boolean) => void) {
  const { maximized, bounds: currentBounds, dragRef } = state
  const { previewUserBounds, commitUserBounds, toggleMaximized } = bounds

  const handleDragStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (maximized || event.button !== 0 || !isFloatingTerminalDragTarget(event.target)) return
    focusPanelForShortcuts()
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, bounds: currentBounds, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [currentBounds, dragRef, focusPanelForShortcuts, maximized])

  const handleDragMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (dx === 0 && dy === 0) return
    drag.moved = true
    previewUserBounds({ ...drag.bounds, left: drag.bounds.left + dx, top: drag.bounds.top + dy })
  }, [dragRef, previewUserBounds])

  const handleDragEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.moved) commitUserBounds()
    dragRef.current = null
  }, [commitUserBounds, dragRef])

  const handleTitlebarDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !isFloatingTerminalDragTarget(event.target)) return
    event.preventDefault()
    toggleMaximized()
  }, [toggleMaximized])

  return { handleDragStart, handleDragMove, handleDragEnd, handleTitlebarDoubleClick }
}
