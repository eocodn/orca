import type { IDisposable } from '@xterm/xterm'
import type {
  PaneManagerOptions
} from '@/lib/pane-manager/pane-manager'
import type { ClosedPaneInfo } from '@/lib/pane-manager/pane-manager-types'
import { useAppStore } from '@/store'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { buildWindowsPtyCompatibilityOptions } from '@/lib/pane-manager/windows-pty-compatibility'
import { buildTerminalKeyboardProtocolOptions } from '@/lib/pane-manager/terminal-keyboard-protocol'
import { normalizeDesktopTerminalScrollbackRows } from '../../../../shared/terminal-scrollback-policy'
import { normalizeTerminalLineHeight } from '../../../../shared/terminal-line-height-settings'
import {
  normalizeTerminalFastScrollSensitivity,
  normalizeTerminalScrollSensitivity,
  resolveTerminalCursorInactiveStyle
} from '@/lib/pane-manager/pane-terminal-options'
import { normalizeTerminalTuiMouseWheelMultiplier } from '@/lib/pane-manager/pane-terminal-mouse-wheel'
import { resolveTerminalFontWeights } from '../../../../shared/terminal-fonts'
import { buildFontFamily } from './layout-serialization'
import { resolvePaneKeyboardProtocolAgent } from './terminal-keyboard-protocol-pane-agent'
import { getConnectionId } from '@/lib/connection-context'
import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import { acquireWebviewsDragPassthrough } from '../browser-pane/webview-registry'
import { resolveTerminalLayoutActiveLeafId } from './terminal-layout-leaf-ids'
import { scheduleRuntimeGraphSync } from '@/runtime/sync-runtime-graph'
import {
  retireMountedTerminalPaneSurface,
  suppressIntentionalPaneCloseExit
} from './terminal-pane-lifecycle-support'
import { reportActiveRendererPtyForPane, formatTerminalUrlTooltip } from './terminal-pane-lifecycle-policies'
import type { TerminalPaneLifecycleContext } from './terminal-pane-lifecycle-contracts'
import { createPaneCreatedHandler } from './terminal-pane-lifecycle-pane-creation'
import { handleTerminalWebLinkClick } from './terminal-web-link-click'
import {
  resolveTabTitleAfterPaneClose,
  shouldClearLaunchAgentForClosedPane
} from './terminal-pane-close-identity'

export function createTerminalPaneManagerOptions(
  context: TerminalPaneLifecycleContext,
  releaseDragRef: { current: (() => void) | null }
): PaneManagerOptions {
  const { deps: d, refs } = context
  return {
    onPaneCreated: createPaneCreatedHandler(context),
    onPaneClosed: createPaneClosedHandler(context),
    onActivePaneChange: (pane) => {
      const layout = useAppStore.getState().terminalLayoutsByTabId[d.tabId]
      const ptyIdsByLeafId = layout?.ptyIdsByLeafId ?? {}
      if (Object.keys(ptyIdsByLeafId).length > 0 && !ptyIdsByLeafId[pane.leafId]) {
        const fallbackLeafId = resolveTerminalLayoutActiveLeafId({
          root: layout?.root,
          activeLeafId: pane.leafId,
          ptyIdsByLeafId
        })
        const fallbackPaneId = fallbackLeafId
          ? (d.managerRef.current?.getNumericIdForLeaf(fallbackLeafId) ?? null)
          : null
        if (fallbackPaneId != null && fallbackPaneId !== pane.id) {
          d.managerRef.current?.setActivePane(fallbackPaneId, { focus: true })
          return
        }
      }
      scheduleRuntimeGraphSync()
      context.syncPaneLayoutRevision()
      if (context.shouldPersistLayout.value) {
        d.persistLayoutSnapshot()
      }
      reportActiveRendererPtyForPane(d.paneTransportsRef.current, pane.id)
      const focusedBinding = d.panePtyBindingsRef.current.get(pane.id) as
        | (IDisposable & { sampleForegroundAgentOnFocus?: () => void })
        | undefined
      focusedBinding?.sampleForegroundAgentOnFocus?.()
      const paneTitle = useAppStore.getState().runtimePaneTitlesByTabId[d.tabId]?.[pane.id]
      if (paneTitle) {
        d.updateTabTitle(d.tabId, paneTitle)
      }
    },
    onLayoutChanged: () => {
      scheduleRuntimeGraphSync()
      d.syncExpandedLayout()
      context.syncCanExpandState()
      context.syncPaneCount()
      context.syncPaneLayoutRevision()
      context.queueResizeAll(false)
      if (context.shouldPersistLayout.value) {
        d.persistLayoutSnapshot()
      }
    },
    onPaneDragActiveChange: (active) => {
      if (active) {
        releaseDragRef.current?.()
        releaseDragRef.current = acquireWebviewsDragPassthrough()
        return
      }
      releaseDragRef.current?.()
      releaseDragRef.current = null
    },
    resolveExternalPaneDropTarget: d.resolveExternalPaneDropTarget,
    onExternalPaneDrop: d.onExternalPaneDrop,
    terminalOptions: () => {
      const settings = d.settingsRef.current
      const terminalFontWeights = resolveTerminalFontWeights(settings?.terminalFontWeight)
      const cursorStyle = settings?.terminalCursorStyle ?? 'block'
      const storeState = useAppStore.getState()
      const currentTab = storeState.tabsByWorktree[d.worktreeId]?.find(
        (candidate) => candidate.id === d.tabId
      )
      const platformInfo = window.api.platform?.get?.()
      const knownTuiAgent = resolvePaneKeyboardProtocolAgent(
        context.ptyDeps.startup,
        currentTab?.launchAgent
      )
      const backendContext = {
        userAgent: navigator.userAgent,
        osRelease: platformInfo?.osRelease,
        connectionId: getConnectionId(d.worktreeId),
        cwd: context.startupCwd,
        shellOverride: currentTab?.shellOverride,
        executionHostId: getExecutionHostIdForWorktree(storeState, d.worktreeId),
        tuiAgent: knownTuiAgent
      }
      return {
        ...buildWindowsPtyCompatibilityOptions(backendContext),
        ...buildTerminalKeyboardProtocolOptions(backendContext),
        fontSize: settings?.terminalFontSize ?? 14,
        fontFamily: buildFontFamily(settings?.terminalFontFamily ?? ''),
        fontWeight: terminalFontWeights.fontWeight,
        fontWeightBold: terminalFontWeights.fontWeightBold,
        scrollback: normalizeDesktopTerminalScrollbackRows(settings?.terminalScrollbackRows),
        cursorStyle,
        cursorInactiveStyle: resolveTerminalCursorInactiveStyle(cursorStyle),
        cursorBlink: settings?.terminalCursorBlink ?? true,
        scrollSensitivity: normalizeTerminalScrollSensitivity(settings?.terminalScrollSensitivity),
        fastScrollSensitivity: normalizeTerminalFastScrollSensitivity(settings?.terminalFastScrollSensitivity),
        macOptionIsMeta: d.effectiveMacOptionAsAltRef.current === 'true',
        lineHeight: normalizeTerminalLineHeight(settings?.terminalLineHeight),
        wordSeparator: settings?.terminalWordSeparator
      }
    },
    terminalTuiScrollSensitivity: () =>
      normalizeTerminalTuiMouseWheelMultiplier(d.settingsRef.current?.terminalTuiScrollSensitivity),
    onLinkClick: (event, url) => {
      const activePane = d.managerRef.current?.getActivePane()
      handleTerminalWebLinkClick(url, event, {
        ...context.linkDeps,
        terminal: activePane?.terminal ?? null,
        startupCwd: activePane ? context.getPaneLinkCwd(activePane.id) : context.startupCwd,
        runtimeEnvironmentId: activePane
          ? (context.linkDeps.getRuntimeEnvironmentIdForPane?.(activePane.id) ?? null)
          : null,
        requestOpenLinksInAppPreference: d.requestOpenLinksInAppPreference
      })
    },
    linkOpenHint: context.getUrlOpenLinkHint,
    formatLinkTooltip: formatTerminalUrlTooltip,
    initialRenderingSuspended: !d.isVisibleRef.current,
    terminalGpuAcceleration: d.settingsRef.current?.terminalGpuAcceleration ?? 'auto',
    debugLabel: `tab:${d.tabId}/wt:${d.worktreeId}`
  }
}

function createPaneClosedHandler(
  context: TerminalPaneLifecycleContext
): NonNullable<PaneManagerOptions['onPaneClosed']> {
  const { deps: d, refs } = context
  return (paneId, closedPane: ClosedPaneInfo | undefined) => {
    d.onPtyRecoveryStateRef?.current?.(paneId, null)
    const isDetachedToTab = closedPane?.reason === 'detach'
    const isRetiredSurface = closedPane?.reason === 'retire'
    disposeMapEntry(refs.linkProviderDisposablesRef.current, paneId)
    disposeMapEntry(refs.terminalHandleLinkDisposablesRef.current, paneId)
    disposeMapEntry(refs.linkifierClickPrimingDisposablesRef.current, paneId)
    disposeMapEntry(refs.fileLinkClickFallbackDisposablesRef.current, paneId)
    disposeMapEntry(refs.httpLinkClickFallbackDisposablesRef.current, paneId)
    disposeMapEntry(refs.selectionDisposablesRef.current, paneId)
    const timer = refs.selectionCaptureTimersRef.current.get(paneId)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      refs.selectionCaptureTimersRef.current.delete(paneId)
    }
    disposeMapEntry(refs.imeCompositionDisposablesRef.current, paneId)
    disposeMapEntry(refs.imeNativeTextForwarderDisposablesRef.current, paneId)
    disposeMapEntry(refs.osc52DisposablesRef.current, paneId)
    disposeMapEntry(refs.osc7DisposablesRef.current, paneId)
    d.paneMode2031Ref.current.delete(paneId)
    d.paneKittyKeyboardModesRef.current.delete(paneId)
    d.paneLastThemeModeRef.current.delete(paneId)
    disposeMapEntry(refs.mouseHideDisposablesRef.current, paneId)
    d.paneCwdRef.current.delete(paneId)
    const transport = d.paneTransportsRef.current.get(paneId)
    const closedPtyId = transport?.getPtyId() ?? null
    const terminalTab = useAppStore.getState().tabsByWorktree[d.worktreeId]?.find(
      (candidate) => candidate.id === d.tabId
    )
    if (!isDetachedToTab && shouldClearLaunchAgentForClosedPane(terminalTab, closedPtyId)) {
      useAppStore.getState().clearTabLaunchAgent(d.tabId)
    }
    const panePtyBinding = d.panePtyBindingsRef.current.get(paneId)
    panePtyBinding?.dispose()
    d.panePtyBindingsRef.current.delete(paneId)
    const leafId = closedPane?.leafId
    if (leafId && isRetiredSurface) {
      retireMountedTerminalPaneSurface({
        paneKey: makePaneKey(d.tabId, leafId),
        paneId,
        tabId: d.tabId,
        ptyId: closedPtyId,
        retireAgentPaneAuthority: useAppStore.getState().retireAgentPaneAuthority,
        syncPanePtyLayoutBinding: d.syncPanePtyLayoutBinding,
        clearTabPtyId: d.clearTabPtyId,
        ...(transport ? { transport } : {})
      })
    } else if (leafId && !isDetachedToTab) {
      useAppStore.getState().retireAgentPaneAuthority(makePaneKey(d.tabId, leafId))
    }
    if (transport && !isRetiredSurface) {
      if (isDetachedToTab) {
        transport.detach?.()
      } else {
        const ptyId = suppressIntentionalPaneCloseExit(
          transport,
          useAppStore.getState().suppressPtyExit
        )
        if (ptyId) {
          d.syncPanePtyLayoutBinding(paneId, null)
          d.clearTabPtyId(d.tabId, ptyId)
        }
        transport.destroy?.()
      }
      d.paneTransportsRef.current.delete(paneId)
    }
    d.clearRuntimePaneTitle(d.tabId, paneId)
    d.paneFontSizesRef.current.delete(paneId)
    d.replayingPanesRef.current.delete(paneId)
    refs.restoredViewportBlankingPanesRef.current.delete(paneId)
    d.setPaneTitles((previous) => {
      if (!(paneId in previous)) return previous
      const next = { ...previous }
      delete next[paneId]
      return next
    })
    if (paneId in d.paneTitlesRef.current) {
      const next = { ...d.paneTitlesRef.current }
      delete next[paneId]
      d.paneTitlesRef.current = next
    }
    d.setRenamingPaneId((previous) => (previous === paneId ? null : previous))
    context.syncPaneCount()
    const activePane = d.managerRef.current?.getActivePane()
    if (activePane) {
      reportActiveRendererPtyForPane(d.paneTransportsRef.current, activePane.id)
      const paneTitles = useAppStore.getState().runtimePaneTitlesByTabId[d.tabId] ?? {}
      d.updateTabTitle(
        d.tabId,
        resolveTabTitleAfterPaneClose(paneTitles, activePane.id)
      )
    }
    scheduleRuntimeGraphSync()
  }
}

function disposeMapEntry(map: Map<number, IDisposable>, paneId: number): void {
  map.get(paneId)?.dispose()
  map.delete(paneId)
}
