import { useCallback } from 'react'
import { isTerminalImeInputContextRefreshing } from '@/components/terminal-pane/terminal-ime-input-context-refresh'
import { FloatingTerminalPanelTitlebar } from './floating-terminal-panel-render-titlebar'
import { FloatingTerminalPanelContent } from './floating-terminal-panel-render-content'
import { FloatingTerminalPanelOverlays } from './floating-terminal-panel-render-overlays'
import type { FloatingTerminalPanelRenderContext } from './floating-terminal-panel-render-types'

export function FloatingTerminalPanelView({ context }: { context: FloatingTerminalPanelRenderContext }): React.JSX.Element {
  const { setPanelNode, open, bounds, maximized, stagedBoundsRef, commitUserBounds, reportFloatingFocusFromTarget, handleShortcutSurfaceKeyDown } = context
  const handleMouseUp = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (maximized || !stagedBoundsRef.current) return
    const rect = event.currentTarget.getBoundingClientRect()
    commitUserBounds({ ...stagedBoundsRef.current, width: rect.width, height: rect.height })
  }, [commitUserBounds, maximized, stagedBoundsRef])
  return <div ref={setPanelNode} data-floating-terminal-panel aria-hidden={!open} tabIndex={-1} className={`fixed z-[45] flex min-h-[280px] min-w-[420px] rounded-lg bg-transparent text-card-foreground shadow-[0_4px_12px_rgba(0,0,0,0.16),0_24px_64px_rgba(0,0,0,0.32)] outline-none dark:shadow-[0_8px_20px_rgba(0,0,0,0.35),0_28px_72px_rgba(0,0,0,0.58)] ${open ? 'opacity-100' : 'invisible pointer-events-none opacity-0'}`} style={{ visibility: open ? 'visible' : 'hidden', left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }} onMouseUp={handleMouseUp} onFocusCapture={(event) => reportFloatingFocusFromTarget(event.target)} onBlurCapture={(event) => { if (!isTerminalImeInputContextRefreshing(event.target)) reportFloatingFocusFromTarget(event.relatedTarget) }} onKeyDownCapture={handleShortcutSurfaceKeyDown}>
    <div className="relative flex h-full w-full min-h-0 flex-col overflow-hidden rounded-lg border border-black/14 bg-card dark:border-white/14">
      <FloatingTerminalPanelTitlebar context={context} />
      <FloatingTerminalPanelContent context={context} />
    </div>
    <FloatingTerminalPanelOverlays context={context} />
  </div>
}
