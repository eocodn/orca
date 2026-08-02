import { useCallback, useEffect } from 'react'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import {
  clearFloatingPanelReclaimIntent,
  consumeFloatingPanelReclaimIntent
} from '@/lib/floating-workspace-focus-reclaim'
import {
  isEventTargetInsideFloatingWorkspacePanel,
  isFloatingWorkspaceTerminalInputTarget
} from '@/lib/floating-workspace-terminal-actions'
import { useFloatingTerminalPanelState } from './floating-terminal-panel-state'

let lastReportedFloatingFocus: { panelFocused: boolean; terminalFocused: boolean } | null = null
let lastReportedFloatingFocusFn: unknown = null

function reportFloatingFocus(next: EventTarget | null, release = false): void {
  const setFloatingFocus = window.api.ui.setFloatingFocus
  if (typeof setFloatingFocus !== 'function') return
  if (setFloatingFocus !== lastReportedFloatingFocusFn) {
    lastReportedFloatingFocus = null
    lastReportedFloatingFocusFn = setFloatingFocus
  }
  const terminalFocused = !release && isFloatingWorkspaceTerminalInputTarget(next)
  const panelFocused = !release && (terminalFocused || isEventTargetInsideFloatingWorkspacePanel(next))
  if (lastReportedFloatingFocus?.panelFocused === panelFocused && lastReportedFloatingFocus?.terminalFocused === terminalFocused) return
  lastReportedFloatingFocus = { panelFocused, terminalFocused }
  setFloatingFocus({ panelFocused, terminalFocused })
}

export function clearReportedFloatingFocusCache(): void {
  lastReportedFloatingFocus = null
  lastReportedFloatingFocusFn = null
}

type PanelState = ReturnType<typeof useFloatingTerminalPanelState>

export function useFloatingTerminalPanelFocus(state: PanelState, open: boolean, callbacks: {
  closeFloatingItemConfirmed: (visibleId: string, options?: { guestOwned?: boolean }) => void
  visibleFloatingItemCount: number
}) {
  const {
    panelRef,
    shortcutFocusFrameRef,
    shortcutFocusTimeoutRef,
    pendingReclaimArmByFileIdRef,
    reclaimTerminalInputOnWindowFocusRef,
    activeTerminalId,
    hasVisibleFloatingTabs,
    floatingFiles
  } = state
  const { visibleFloatingItemCount } = callbacks

  const focusPanelForShortcuts = useCallback((preserveExistingPanelFocus = true) => {
    const active = document.activeElement
    if (preserveExistingPanelFocus && active instanceof HTMLElement && active.closest('[data-floating-terminal-panel]')) return
    panelRef.current?.focus({ preventScroll: true })
  }, [panelRef])

  const cancelShortcutFocusFrame = useCallback(() => {
    if (shortcutFocusFrameRef.current !== null) {
      cancelAnimationFrame(shortcutFocusFrameRef.current)
      shortcutFocusFrameRef.current = null
    }
    if (shortcutFocusTimeoutRef.current !== null) {
      window.clearTimeout(shortcutFocusTimeoutRef.current)
      shortcutFocusTimeoutRef.current = null
    }
  }, [shortcutFocusFrameRef, shortcutFocusTimeoutRef])

  const setPanelNode = useCallback((node: HTMLDivElement | null) => {
    if (!node) cancelShortcutFocusFrame()
    panelRef.current = node
  }, [cancelShortcutFocusFrame, panelRef])

  const focusPanelForShortcutsAfterClose = useCallback(() => {
    if (typeof window === 'undefined') return
    cancelShortcutFocusFrame()
    const focusPanel = () => {
      shortcutFocusFrameRef.current = null
      shortcutFocusTimeoutRef.current = null
      focusPanelForShortcuts(false)
    }
    if (typeof window.requestAnimationFrame === 'function') shortcutFocusFrameRef.current = window.requestAnimationFrame(focusPanel)
    else shortcutFocusTimeoutRef.current = window.setTimeout(focusPanel, 0)
  }, [cancelShortcutFocusFrame, focusPanelForShortcuts, shortcutFocusFrameRef, shortcutFocusTimeoutRef])

  const reportFloatingFocusFromTarget = useCallback((target: EventTarget | null) => reportFloatingFocus(target), [])

  useEffect(() => {
    const pending = pendingReclaimArmByFileIdRef.current
    if (pending.size === 0) return
    for (const [fileId, armIfEmptying] of pending) {
      if (!floatingFiles.some((file) => file.id === fileId)) {
        pending.delete(fileId)
        armIfEmptying()
      }
    }
  }, [floatingFiles, pendingReclaimArmByFileIdRef])

  useEffect(() => {
    if (visibleFloatingItemCount > 0) {
      clearFloatingPanelReclaimIntent()
      return
    }
    if (consumeFloatingPanelReclaimIntent()) focusPanelForShortcutsAfterClose()
  }, [focusPanelForShortcutsAfterClose, visibleFloatingItemCount])

  useEffect(() => {
    if (!open || !activeTerminalId) return
    focusTerminalTabSurface(activeTerminalId, null, {
      onImeRefocusSkipped: (active) => reportFloatingFocus(active),
      refreshImeContext: true
    })
  }, [activeTerminalId, open])

  useEffect(() => {
    if (!open || hasVisibleFloatingTabs) return
    panelRef.current?.focus({ preventScroll: true })
  }, [hasVisibleFloatingTabs, open, panelRef])

  useEffect(() => {
    const pendingReclaimArms = pendingReclaimArmByFileIdRef.current
    if (!open) {
      reportFloatingFocus(null, true)
      clearFloatingPanelReclaimIntent()
      pendingReclaimArms.clear()
    }
    return () => {
      reportFloatingFocus(null, true)
      clearFloatingPanelReclaimIntent()
      pendingReclaimArms.clear()
    }
  }, [open, pendingReclaimArmByFileIdRef])

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const panel = panelRef.current
      if (!panel || !(event.target instanceof Node) || panel.contains(event.target)) return
      reportFloatingFocus(null, true)
      clearFloatingPanelReclaimIntent()
      const active = document.activeElement
      if (active instanceof HTMLElement && panel.contains(active)) active.blur()
    }
    const handleWindowBlur = () => {
      const panel = panelRef.current
      const active = document.activeElement
      reclaimTerminalInputOnWindowFocusRef.current = null
      if (!panel || !(active instanceof HTMLElement) || !panel.contains(active)) return
      reportFloatingFocus(null, true)
      clearFloatingPanelReclaimIntent()
      if (isFloatingWorkspaceTerminalInputTarget(active)) {
        reclaimTerminalInputOnWindowFocusRef.current = { helper: active, leafId: active.closest('[data-leaf-id]')?.getAttribute('data-leaf-id') ?? null }
      } else active.blur()
    }
    const handleWindowFocus = () => {
      const reclaim = reclaimTerminalInputOnWindowFocusRef.current
      if (!reclaim) return
      reclaimTerminalInputOnWindowFocusRef.current = null
      const panel = panelRef.current
      const active = document.activeElement
      if (panel && active instanceof HTMLElement && panel.contains(active) && isFloatingWorkspaceTerminalInputTarget(active)) {
        reportFloatingFocus(active)
        return
      }
      if ((active === null || active === document.body) && activeTerminalId) {
        if (reclaim.helper.isConnected && panel?.contains(reclaim.helper)) return
        focusTerminalTabSurface(activeTerminalId, reclaim.leafId, {
          onlyIfFocusUnclaimed: true,
          onImeRefocusSkipped: (nextActive) => reportFloatingFocus(nextActive),
          refreshImeContext: true
        })
      }
    }
    document.addEventListener('pointerdown', handleOutsidePointerDown, true)
    window.addEventListener('blur', handleWindowBlur)
    window.addEventListener('focus', handleWindowFocus)
    return () => {
      reclaimTerminalInputOnWindowFocusRef.current = null
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true)
      window.removeEventListener('blur', handleWindowBlur)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [activeTerminalId, open, panelRef, reclaimTerminalInputOnWindowFocusRef])

  return { focusPanelForShortcuts, cancelShortcutFocusFrame, setPanelNode, focusPanelForShortcutsAfterClose, reportFloatingFocusFromTarget }
}
