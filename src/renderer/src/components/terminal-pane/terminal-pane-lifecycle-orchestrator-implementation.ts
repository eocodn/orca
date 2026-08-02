import { useEffect, useRef } from 'react'
import type { IDisposable } from '@xterm/xterm'
import { PaneManager } from '@/lib/pane-manager/pane-manager'
import { configureTerminalOutputBacklogCap } from '@/lib/pane-manager/pane-terminal-output-scheduler'
import { normalizeDesktopTerminalScrollbackRows } from '../../../../shared/terminal-scrollback-policy'
import { applyTerminalAppearance } from './terminal-appearance'
import { fitAndFocusPanes, fitPanes } from './pane-helpers'
import { getRemoteRuntimePtyEnvironmentId } from '@/runtime/runtime-terminal-stream'
import { mountTerminalPaneManager } from './terminal-pane-lifecycle-manager-mount'
import { installTerminalPaneLifecycleEffects } from './terminal-pane-lifecycle-effects'
import type {
  TerminalPaneLifecycleDeps,
  TerminalPaneLifecycleRefs,
  TerminalPaneLifecycleSetupContext
} from './terminal-pane-lifecycle-contracts'
import type { TerminalPaneVisibilitySnapshot } from './terminal-pane-lifecycle-contracts'
import { resolvePaneLinkCwd } from './terminal-pane-lifecycle-policies'
import type { LinkHandlerDeps } from './terminal-link-handlers'

export * from './terminal-pane-lifecycle-policies'
export * from './terminal-pane-lifecycle-support'

export function useTerminalPaneLifecycle(deps: TerminalPaneLifecycleDeps): void {
  const terminalScrollbackRows = normalizeDesktopTerminalScrollbackRows(
    deps.settings?.terminalScrollbackRows
  )
  configureTerminalOutputBacklogCap(deps.settings?.terminalScrollbackRows)
  const refs = useTerminalPaneLifecycleRefs(deps.systemPrefersDark)
  refs.systemPrefersDarkRef.current = deps.systemPrefersDark
  const shouldPersistLayoutRef = useRef({ value: false })
  const initialStartupCwd = deps.cwd ?? ''
  const linkDeps: LinkHandlerDeps = {
    worktreeId: deps.worktreeId,
    worktreePath: deps.cwd ?? '',
    startupCwd: initialStartupCwd,
    getPaneLinkCwd: (paneId) =>
      resolvePaneLinkCwd(deps.paneCwdRef.current, paneId, initialStartupCwd),
    terminalHomePath: null,
    managerRef: deps.managerRef,
    linkProviderDisposablesRef: refs.linkProviderDisposablesRef,
    pathExistsCache: new Map<string, boolean>(),
    getRuntimeEnvironmentIdForPane: (paneId) => {
      const ptyId = deps.paneTransportsRef.current.get(paneId)?.getPtyId()
      return ptyId ? getRemoteRuntimePtyEnvironmentId(ptyId) : null
    }
  }
  let resizeRaf: number | null = null
  const queueResizeAll = (focusActive: boolean): void => {
    if (resizeRaf !== null) cancelAnimationFrame(resizeRaf)
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = null
      const manager = deps.managerRef.current
      if (!manager) return
      focusActive ? fitAndFocusPanes(manager) : fitPanes(manager)
    })
  }
  const syncCanExpandState = (): void => {
    deps.setTabCanExpandPane(deps.tabId, (deps.managerRef.current?.getPanes().length ?? 1) > 1)
  }
  const syncPaneCount = (): void => {
    deps.setPaneCount(deps.managerRef.current?.getPanes().length ?? 0)
  }
  const syncPaneLayoutRevision = (): void => {
    deps.setPaneLayoutRevision((revision) => revision + 1)
  }
  const cancelResizeAll = (): void => {
    if (resizeRaf !== null) {
      cancelAnimationFrame(resizeRaf)
      resizeRaf = null
    }
  }
  const applyAppearance = (manager: PaneManager): void => {
    const settings = deps.settingsRef.current
    if (!settings) return
    applyTerminalAppearance(
      manager,
      settings,
      refs.systemPrefersDarkRef.current,
      deps.paneFontSizesRef.current,
      deps.paneTransportsRef.current,
      deps.effectiveMacOptionAsAltRef.current,
      deps.paneMode2031Ref.current,
      deps.paneLastThemeModeRef.current
    )
  }
  const setupContext: TerminalPaneLifecycleSetupContext = {
    deps,
    refs,
    terminalScrollbackRows,
    applyAppearance,
    startupCwd: initialStartupCwd,
    defaultTabCwd: initialStartupCwd,
    worktreePath: deps.cwd ?? '',
    terminalHomePath: null,
    getPaneLinkCwd: (paneId) => resolvePaneLinkCwd(deps.paneCwdRef.current, paneId, initialStartupCwd),
    linkDeps,
    queueResizeAll,
    cancelResizeAll,
    syncCanExpandState,
    syncPaneCount,
    syncPaneLayoutRevision,
    getUrlOpenLinkHint: () => '',
    fileOpenLinkHint: '',
    osc7UncHost: null,
    shouldPersistLayout: shouldPersistLayoutRef.current
  }

  useEffect(() => mountTerminalPaneManager(setupContext), [deps.tabId, deps.cwd])
  installTerminalPaneLifecycleEffects(setupContext)
}

function useTerminalPaneLifecycleRefs(systemPrefersDark: boolean): TerminalPaneLifecycleRefs {
  return {
    systemPrefersDarkRef: useRef(systemPrefersDark),
    previousVisibleForReconcileRef: useRef<TerminalPaneVisibilitySnapshot | null>(null),
    linkProviderDisposablesRef: useRef(new Map<number, IDisposable>()),
    terminalHandleLinkDisposablesRef: useRef(new Map<number, IDisposable>()),
    linkifierClickPrimingDisposablesRef: useRef(new Map<number, IDisposable>()),
    fileLinkClickFallbackDisposablesRef: useRef(new Map<number, IDisposable>()),
    httpLinkClickFallbackDisposablesRef: useRef(new Map<number, IDisposable>()),
    selectionDisposablesRef: useRef(new Map<number, IDisposable>()),
    selectionCaptureTimersRef: useRef(new Map<number, number>()),
    osc52DisposablesRef: useRef(new Map<number, IDisposable>()),
    osc7DisposablesRef: useRef(new Map<number, IDisposable>()),
    mouseHideDisposablesRef: useRef(new Map<number, IDisposable>()),
    imeCompositionDisposablesRef: useRef(new Map<number, IDisposable>()),
    imeNativeTextForwarderDisposablesRef: useRef(new Map<number, IDisposable>()),
    queuedInitialCwdRef: useRef<string | null | undefined>(undefined),
    restoredViewportBlankingPanesRef: useRef(new Set<number>())
  }
}
