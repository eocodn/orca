import { getClientRuntime } from '@/runtime/client-runtime'
import { useEffect } from 'react'
import { consumeFloatingTerminalOpenMaximizedIntent } from '@/lib/floating-terminal'
import { useFloatingTerminalPanelState } from './floating-terminal-panel-state'
import { useFloatingTerminalPanelBounds } from './floating-terminal-panel-bounds-actions'

type PanelState = ReturnType<typeof useFloatingTerminalPanelState>
type BoundsActions = ReturnType<typeof useFloatingTerminalPanelBounds>

export function useFloatingTerminalPanelLifecycle(state: PanelState, bounds: BoundsActions, open: boolean) {
  const {
    floatingTerminalCwd,
    setCwd,
    setMarkdownCwd,
    terminalPaneRegistry,
    tabs,
    maximized
  } = state
  const { maximizePanel } = bounds

  useEffect(() => {
    let cancelled = false
    void getClientRuntime().app.getFloatingTerminalCwd({ path: floatingTerminalCwd }).then((nextCwd) => {
      if (!cancelled) setCwd(nextCwd)
    })
    return () => { cancelled = true }
  }, [floatingTerminalCwd, setCwd])

  useEffect(() => {
    let cancelled = false
    void getClientRuntime().app.getFloatingMarkdownDirectory().then((nextMarkdownCwd) => {
      if (!cancelled) setMarkdownCwd(nextMarkdownCwd)
    })
    return () => { cancelled = true }
  }, [setMarkdownCwd])

  useEffect(() => {
    if (open && consumeFloatingTerminalOpenMaximizedIntent()) maximizePanel()
  }, [maximizePanel, open])

  useEffect(() => {
    terminalPaneRegistry.retainOnly(tabs.map((tab) => tab.id))
  }, [tabs, terminalPaneRegistry])

  return { maximized }
}
