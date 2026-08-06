import { useEffect, useRef } from 'react'
import { useAppStore } from '../store'
import { isWebRuntimeSessionActive } from '@/runtime/web-runtime-session'
import { resumeSleepingAgentSessionsForWorktree } from '@/lib/resume-sleeping-agent-session'
import { shouldAutoCreateInitialTerminal } from './terminal/initial-terminal'

export function useTerminalSurfaceStartupEffects(context: Record<string, any>): void {
  const {
    workspaceSessionReady,
    activeWorktreeId,
    hydrationSucceeded,
    createTab,
    reconcileWorktreeTabModel,
    resumeSleepingAgentSessionsForWorktree,
    getActiveWorktreeRuntimeEnvironmentId
  } = context
  // Auto-create first tab when worktree activates
  useEffect(() => {
    if (!workspaceSessionReady) {
      return
    }
    if (!activeWorktreeId) {
      return
    }
    // Why: host session-tabs are authoritative in the paired web client; a local fallback races the host's initial terminal and duplicates tabs.
    if (isWebRuntimeSessionActive(getActiveWorktreeRuntimeEnvironmentId(activeWorktreeId))) {
      return
    }

    // Why: give a newly activated worktree a focusable surface when nothing renders, without recreating one after the user closes the last visible tab.
    const { renderableTabCount } = reconcileWorktreeTabModel(activeWorktreeId)
    if (!shouldAutoCreateInitialTerminal(renderableTabCount)) {
      return
    }
    // Why: tag this never-visited-worktree tab so its PTY spawn doesn't count as activity and reshuffle the sidebar (explicit New Tab still bumps).
    createTab(activeWorktreeId, undefined, undefined, { pendingActivationSpawn: true })
  }, [workspaceSessionReady, activeWorktreeId, createTab, reconcileWorktreeTabModel])

  const startupResumeWorktreeIdsRef = useRef(new Set<string>())
  useEffect(() => {
    if (!workspaceSessionReady || !hydrationSucceeded || !activeWorktreeId) {
      return
    }
    if (startupResumeWorktreeIdsRef.current.has(activeWorktreeId)) {
      return
    }
    startupResumeWorktreeIdsRef.current.add(activeWorktreeId)
    // Why: startup hydration restores the worktree without activateAndRevealWorktree, so orphaned live/quit records need a terminal-surface pass after cold restore.
    resumeSleepingAgentSessionsForWorktree(activeWorktreeId)
  }, [activeWorktreeId, hydrationSucceeded, workspaceSessionReady])

}

