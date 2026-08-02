import { useCallback, useEffect } from 'react'
import { isOrcaCliAvailableOnPath } from '@/lib/agent-skill-cli-prerequisite'
import {
  ORCHESTRATION_SETUP_DISMISSED_STORAGE_KEY,
  ORCHESTRATION_SETUP_STATE_EVENT,
  hasOrchestrationSetupMarker,
  isOrchestrationSetupDismissed,
  notifyOrchestrationSetupStateChanged
} from '@/lib/orchestration-setup-state'
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
    mountedRef,
    setShowOrchestrationSetup,
    setOrchestrationDialogOpen,
    terminalPaneRegistry,
    tabs,
    maximized
  } = state
  const { maximizePanel } = bounds

  useEffect(() => {
    let cancelled = false
    void window.api.app.getFloatingTerminalCwd({ path: floatingTerminalCwd }).then((nextCwd) => {
      if (!cancelled) setCwd(nextCwd)
    })
    return () => { cancelled = true }
  }, [floatingTerminalCwd, setCwd])

  useEffect(() => {
    let cancelled = false
    void window.api.app.getFloatingMarkdownDirectory().then((nextMarkdownCwd) => {
      if (!cancelled) setMarkdownCwd(nextMarkdownCwd)
    })
    return () => { cancelled = true }
  }, [setMarkdownCwd])

  const refreshOrchestrationSetupVisibility = useCallback(async () => {
    if (isOrchestrationSetupDismissed()) {
      setShowOrchestrationSetup(false)
      return
    }
    if (!hasOrchestrationSetupMarker()) {
      setShowOrchestrationSetup(true)
      return
    }
    try {
      const status = await window.api.cli.getInstallStatus()
      if (mountedRef.current) setShowOrchestrationSetup(!isOrcaCliAvailableOnPath(status))
    } catch {
      if (mountedRef.current) setShowOrchestrationSetup(true)
    }
  }, [mountedRef, setShowOrchestrationSetup])

  useEffect(() => {
    if (open) void refreshOrchestrationSetupVisibility()
  }, [open, refreshOrchestrationSetupVisibility])

  useEffect(() => {
    const handleSetupStateChange = () => void refreshOrchestrationSetupVisibility()
    window.addEventListener(ORCHESTRATION_SETUP_STATE_EVENT, handleSetupStateChange)
    return () => window.removeEventListener(ORCHESTRATION_SETUP_STATE_EVENT, handleSetupStateChange)
  }, [refreshOrchestrationSetupVisibility])

  const dismissOrchestrationSetup = useCallback(() => {
    localStorage.setItem(ORCHESTRATION_SETUP_DISMISSED_STORAGE_KEY, '1')
    setShowOrchestrationSetup(false)
    notifyOrchestrationSetupStateChanged()
  }, [setShowOrchestrationSetup])

  useEffect(() => {
    if (open && consumeFloatingTerminalOpenMaximizedIntent()) maximizePanel()
  }, [maximizePanel, open])

  useEffect(() => {
    terminalPaneRegistry.retainOnly(tabs.map((tab) => tab.id))
  }, [tabs, terminalPaneRegistry])

  return { refreshOrchestrationSetupVisibility, dismissOrchestrationSetup, maximized }
}
