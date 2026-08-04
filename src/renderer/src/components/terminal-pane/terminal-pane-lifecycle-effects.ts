import { useEffect } from 'react'
import type { IDisposable } from '@xterm/xterm'
import {
  WAKE_HIBERNATED_AGENTS_WORKTREE_EVENT,
  type WakeHibernatedAgentsWorktreeDetail
} from '@/constants/terminal'
import {
  reconcileMissingSessions,
  type ReconcilableBinding
} from './terminal-dead-session-reconcile'
import { installMouseHideWhileTyping } from './mouse-hide-while-typing'
import {
  getPreviousVisibleForTerminalPane,
  isTerminalPaneVisibilityResume
} from './terminal-pane-lifecycle-policies'
import type { TerminalPaneLifecycleSetupContext } from './terminal-pane-lifecycle-contracts'
import { applyTerminalScrollbackRowsToMountedPanes } from './terminal-pane-lifecycle-support'
import { getClientRuntime } from '../../runtime/client-runtime'

export function installTerminalPaneLifecycleEffects(
  context: TerminalPaneLifecycleSetupContext
): void {
  const { deps: d, refs } = context

  useEffect(() => {
    const onWakeHibernatedAgents = (event: Event): void => {
      const detail = (event as CustomEvent<WakeHibernatedAgentsWorktreeDetail>).detail
      if (!detail || detail.worktreeId !== d.worktreeId) return
      for (const binding of d.panePtyBindingsRef.current.values()) {
        const claimKey = (
          binding as IDisposable & {
            wakeHibernatedAgentIfArmed?: (claimedProviderSessions?: Set<string>) => string | null
          }
        ).wakeHibernatedAgentIfArmed?.(detail.wokenClaimKeys)
        if (claimKey) detail.wokenClaimKeys?.add(claimKey)
      }
    }
    window.addEventListener(WAKE_HIBERNATED_AGENTS_WORKTREE_EVENT, onWakeHibernatedAgents)
    return () =>
      window.removeEventListener(WAKE_HIBERNATED_AGENTS_WORKTREE_EVENT, onWakeHibernatedAgents)
  }, [d.worktreeId, d.panePtyBindingsRef])

  useEffect(() => {
    const previousIsVisible = getPreviousVisibleForTerminalPane({
      previous: refs.previousVisibleForReconcileRef.current,
      tabId: d.tabId,
      cwd: d.cwd
    })
    refs.previousVisibleForReconcileRef.current = {
      tabId: d.tabId,
      cwd: d.cwd,
      isVisible: d.isVisible
    }
    d.isVisibleRef.current = d.isVisible
    const resumedFromHidden = isTerminalPaneVisibilityResume({
      previousIsVisible,
      isVisible: d.isVisible
    })
    for (const binding of d.panePtyBindingsRef.current.values()) {
      const bindingWithVisibility = binding as IDisposable & {
        syncProcessTracking?: () => void
        noteVisibilityResume?: () => void
      }
      bindingWithVisibility.syncProcessTracking?.()
      if (resumedFromHidden) bindingWithVisibility.noteVisibilityResume?.()
    }
    if (resumedFromHidden && typeof getClientRuntime().terminal.hasPty === 'function') {
      reconcileMissingSessions({
        bindings: d.panePtyBindingsRef.current.values() as Iterable<ReconcilableBinding>,
        hasPty: getClientRuntime().terminal.hasPty
      })
    }
  }, [
    d.cwd,
    d.isVisible,
    d.isVisibleRef,
    d.panePtyBindingsRef,
    d.tabId,
    refs.previousVisibleForReconcileRef
  ])

  useEffect(() => {
    if (!d.isActive || !d.isVisible || typeof window === 'undefined') return
    const onWindowFocus = (): void => {
      const activePane = d.managerRef.current?.getActivePane()
      if (!activePane) return
      const binding = d.panePtyBindingsRef.current.get(activePane.id) as
        | (IDisposable & { sampleForegroundAgentOnFocus?: () => void })
        | undefined
      binding?.sampleForegroundAgentOnFocus?.()
    }
    window.addEventListener('focus', onWindowFocus)
    return () => window.removeEventListener('focus', onWindowFocus)
  }, [d.isActive, d.isVisible, d.managerRef, d.panePtyBindingsRef])

  useEffect(() => {
    const manager = d.managerRef.current
    if (!manager || !d.settings) return
    context.applyAppearance(manager)
  }, [d.settings, d.systemPrefersDark, d.effectiveMacOptionAsAlt])

  useEffect(() => {
    d.managerRef.current?.setTerminalGpuAcceleration(d.settings?.terminalGpuAcceleration ?? 'auto')
  }, [d.settings?.terminalGpuAcceleration, d.managerRef])

  useEffect(() => {
    const manager = d.managerRef.current
    if (!manager) return
    applyTerminalScrollbackRowsToMountedPanes(manager, context.terminalScrollbackRows)
  }, [d.managerRef, context.terminalScrollbackRows])

  useEffect(() => {
    const manager = d.managerRef.current
    if (!manager) return
    const hide = d.settings?.terminalMouseHideWhileTyping ?? false
    for (const pane of manager.getPanes()) {
      const existing = refs.mouseHideDisposablesRef.current.get(pane.id)
      if (hide && !existing) {
        refs.mouseHideDisposablesRef.current.set(
          pane.id,
          installMouseHideWhileTyping(pane.terminal, pane.container)
        )
      } else if (!hide && existing) {
        existing.dispose()
        refs.mouseHideDisposablesRef.current.delete(pane.id)
      }
    }
  }, [d.settings?.terminalMouseHideWhileTyping])
}
